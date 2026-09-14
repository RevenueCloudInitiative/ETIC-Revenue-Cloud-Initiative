/**
 * Data layer for the Data Export page.
 *
 * Queries run through GraphQL `uiapi` because AGENT.md blocks the Enterprise
 * `/query` SOQL endpoint. Field metadata comes from UI API REST, which is the
 * only place object/field metadata (`filterable`, `sortable`, `updateable`,
 * `dataType`) is exposed.
 */
import { executeGraphQL, executeGraphQLRaw } from "./graphqlClient";
import {
  isGroupableType,
  isMeasurableType,
  type AggregateSpec,
} from "../features/data-export/query/aggregate";
import {
  toAggregateGraphQL,
  type AggregateColumn,
} from "../features/data-export/query/toAggregateGraphQL";
import {
  chunkIds,
  toDeleteMutation,
  toGraphQL,
} from "../features/data-export/query/toGraphQL";
import {
  splitFieldPath,
  type QuerySpec,
} from "../features/data-export/query/types";
import {
  COMPOUND_TYPES,
  sameFieldMetaMap,
  type FieldMeta,
  type FieldMetaMap,
} from "../lib/fieldMeta";
import { decodeHtmlEntities } from "../lib/htmlEntities";
import { rememberKeyPrefix } from "../lib/keyPrefixes";
import { rememberObjectLabel } from "../lib/objectLabels";
import { createMetadataCache } from "../lib/metadataCache";
import { forgetRecord } from "../lib/recordDetailCache";
import { uiApiGet, type SfRequestInit } from "../lib/sfFetch";
import { runMutationBatches } from "./mutationBatch";

/* ---- UI API object-info shapes -------------------------------------- */

interface UiFieldMeta {
  apiName: string;
  label: string;
  dataType: string;
  filterable?: boolean;
  sortable?: boolean;
  updateable?: boolean;
  createable?: boolean;
  required?: boolean;
  length?: number;
  compound?: boolean;
  /** e.g. "Account" for AccountId. Null on non-reference fields. */
  relationshipName?: string | null;
  /** One entry per object the reference can point at; >1 means polymorphic. */
  referenceToInfos?: { apiName: string; nameFields?: string[] }[];
}

interface UiObjectInfo {
  apiName: string;
  label: string;
  /** First three characters of every Id of this object, e.g. "001" for Account. */
  keyPrefix?: string | null;
  fields: Record<string, UiFieldMeta>;
}

/* ---- GraphQL result shapes ------------------------------------------ */

interface GqlScalar {
  value: unknown;
  displayValue: string | null;
}

interface GqlNode {
  Id: string;
  [field: string]: unknown;
}

interface QueryResult {
  uiapi?: {
    query?: Record<
      string,
      {
        totalCount?: number;
        edges?: ({ node?: GqlNode | null } | null)[] | null;
        pageInfo?: { hasNextPage?: boolean } | null;
      } | null
    > | null;
  } | null;
}

/* ---- Object metadata ------------------------------------------------- */

export interface ObjectFields {
  apiName: string;
  label: string;
  /**
   * The object's Id key prefix, straight from `object-info`.
   *
   * Carried so a caller that reached this object by *guessing* from an Id can
   * check its guess against the org's own answer rather than trusting a static
   * table. Null when Salesforce didn't send one.
   */
  keyPrefix: string | null;
  fields: FieldMetaMap;
}

/**
 * Object metadata, cached under the shared metadata policy: reused for
 * `METADATA_CACHE_TTL_MS`, and dropped on demand when the user explicitly picks
 * the object. The nav bar shows the user their own API consumption, so
 * re-fetching a value that rarely changes is a visible waste — but "rarely"
 * stopped meaning "never" the moment someone added a field in Setup and the
 * picker refused to show it.
 *
 * One map rather than the separate `_fieldCache` and `_labelCache` this used to
 * keep: they were written and read under the same key on the same code paths,
 * so nothing could populate one without the other, and the only thing two maps
 * bought was the chance for a future edit to fill one and forget the other.
 *
 * `apiName` is stored alongside them so a hit and a miss answer identically.
 * The miss returned Salesforce's canonical casing and the hit returned whatever
 * the caller typed, which `loadObject` uses as a state key.
 */
const _objectCache = createMetadataCache<ObjectFields>();

/**
 * The user explicitly picked this object — reload its metadata rather than
 * reusing what was cached earlier in the session.
 *
 * Wired to the object picker only. Expanding a lookup in `FieldPicker` must
 * *not* call this: browsing a parent's fields is incidental, and re-billing an
 * `object-info` call per expansion is exactly what the cache exists to avoid.
 */
export function requestFreshObjectFields(objectApiName: string): void {
  _objectCache.requestFresh(objectApiName);
}

/**
 * What's already cached for this object, if anything still fresh. No fetch.
 *
 * Exists so an explicit pick can put something on screen *now* and check with
 * the org behind it — see `useObjectLoader`.
 */
export function peekObjectFields(
  objectApiName: string,
): ObjectFields | undefined {
  return _objectCache.peek(objectApiName);
}

/**
 * Whether the org's answer differs from the one already on screen.
 *
 * The test for "was that background refresh worth acting on". Answering yes
 * when nothing moved is not harmless: it replaces `fields` with a new object
 * identity, and every memo on the page — the whole dry run over every row
 * included — is keyed on that.
 */
export function sameObjectFields(a: ObjectFields, b: ObjectFields): boolean {
  return (
    a.apiName === b.apiName &&
    a.label === b.label &&
    a.keyPrefix === b.keyPrefix &&
    sameFieldMetaMap(a.fields, b.fields)
  );
}

export async function getObjectFields(
  objectApiName: string,
  init?: SfRequestInit,
): Promise<ObjectFields> {
  return _objectCache.load(objectApiName, async () => {
    const info = await uiApiGet<UiObjectInfo>(
      `/ui-api/object-info/${encodeURIComponent(objectApiName)}`,
      init,
    );
    return parseObjectInfo(objectApiName, info);
  });
}

/** Shape one `object-info` payload into the field map the builders read. */
function parseObjectInfo(
  objectApiName: string,
  info: UiObjectInfo,
): ObjectFields {
  const fields: FieldMetaMap = {};
  for (const [apiName, meta] of Object.entries(info.fields ?? {})) {
    const dataType = meta.dataType ?? "String";
    // Traversable only when the reference points at exactly one object. A
    // polymorphic reference (Task.WhoId → Contact or Lead) resolves to a union
    // type in the GraphQL schema, which `Rel { Field }` can't select through.
    const targets = meta.referenceToInfos ?? [];
    const traversable = Boolean(meta.relationshipName) && targets.length === 1;
    fields[apiName] = {
      apiName,
      label: decodeHtmlEntities(meta.label ?? apiName),
      dataType,
      // Compound parents can't be selected or filtered directly, so they are
      // marked unusable rather than offered and then failing server-side.
      filterable: (meta.filterable ?? false) && !COMPOUND_TYPES.has(dataType),
      sortable: (meta.sortable ?? false) && !COMPOUND_TYPES.has(dataType),
      updateable: meta.updateable ?? false,
      // Read by Data Import to decide which fields a column may be mapped to,
      // and to flag a blank required cell before the row costs an API call.
      // Absent from `object-info` means "no", which is the safe default in both
      // directions: an unwritable field is simply not offered.
      createable: meta.createable ?? false,
      required: meta.required ?? false,
      // Only text types carry a length; 0 is UI API's "not applicable" and would
      // otherwise read as "every value is too long".
      length:
        typeof meta.length === "number" && meta.length > 0 ? meta.length : null,
      // Only the compound *parents* — the ones whose own dataType is Address or
      // Location — are unusable. UI API also sets `compound: true` on fields
      // that merely have parts, notably `Account.Name` once Person Accounts are
      // enabled (FirstName + LastName), and those query and filter perfectly
      // well. Trusting the flag hid Name from every picker while the builder
      // still selected it by default, so it appeared as a column nobody could
      // remove and nobody could filter on.
      compound: COMPOUND_TYPES.has(dataType),
      relationshipName: traversable ? (meta.relationshipName ?? null) : null,
      referenceTo: traversable ? targets[0].apiName : null,
    };
  }

  const objectLabel = decodeHtmlEntities(info.label ?? objectApiName);
  const apiName = info.apiName ?? objectApiName;
  const keyPrefix = info.keyPrefix ?? null;
  // Every object the app loads, for any reason on any page, teaches the prefix
  // table — which is what lets Data Import recognise a custom object's Ids
  // after it has been used once.
  rememberKeyPrefix(keyPrefix, apiName);
  // Same trade, for the object picker search: the label is in this response
  // already, and fetching one for search purposes would cost a call per object.
  rememberObjectLabel(apiName, objectLabel);
  return { apiName, label: objectLabel, keyPrefix, fields };
}

/** Field list suitable for the picker: usable fields, sorted by label. */
export function selectableFields(fields: FieldMetaMap): FieldMeta[] {
  return Object.values(fields)
    .filter((f) => !f.compound)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function filterableFields(fields: FieldMetaMap): FieldMeta[] {
  return selectableFields(fields).filter((f) => f.filterable);
}

export function sortableFields(fields: FieldMetaMap): FieldMeta[] {
  return selectableFields(fields).filter((f) => f.sortable);
}

/**
 * Fields Summarize can group by / measure.
 *
 * Narrower than `selectableFields` in ways that surprise people, so the pickers
 * offer only these rather than letting the server reject the document: currency
 * and text-area fields can be measured but not grouped, Boolean can be grouped
 * but not measured, and DateTime is neither (it needs date-part grouping, which
 * this version doesn't ship). See the tables in `query/aggregate.ts`.
 */
export function groupableFields(fields: FieldMetaMap): FieldMeta[] {
  return selectableFields(fields).filter((f) => isGroupableType(f.dataType));
}

export function measurableFields(fields: FieldMetaMap): FieldMeta[] {
  return selectableFields(fields).filter((f) => isMeasurableType(f.dataType));
}

/* ---- Query execution -------------------------------------------------- */

export interface ResultRow {
  id: string;
  /** Raw values keyed by field API name, for editing and export. */
  values: Record<string, unknown>;
  /** Human-readable values keyed by field API name, for display. */
  display: Record<string, string>;
}

export interface QueryOutcome {
  /**
   * The object these rows came from. Carried on the result rather than read
   * back off the builder, so record links and deletes keep pointing at the
   * object that was queried even after the builder moves on to another one.
   */
  objectApiName: string;
  columns: string[];
  rows: ResultRow[];
  /** Total matching records in Salesforce, which may exceed `rows.length`. */
  totalCount: number;
  /** True when Salesforce has more records than the limit returned. */
  truncated: boolean;
}

function toText(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

/**
 * Unwrap one `{ value, displayValue }` cell.
 *
 * `displayValue` carries Salesforce's own formatting when present — "$565,000.00"
 * for a currency sum, the label rather than the API name for a picklist — so it
 * is preferred. It is genuinely `null` for Boolean and reference-Id fields
 * though, and an *empty string* for some others, which is why the fallback tests
 * both rather than using `??`.
 *
 * Written out identically by the row reader and the aggregate reader before
 * this; they read different envelopes but decide the text the same way.
 */
function cellText(cell: GqlScalar): string {
  return cell.displayValue != null && cell.displayValue !== ""
    ? cell.displayValue
    : toText(cell.value);
}

/**
 * Unwrap the `{ value, displayValue }` envelope every non-Id field uses,
 * walking relationship segments first for a parent path like `Account.Name`.
 */
function readField(
  node: GqlNode,
  field: string,
): { raw: unknown; text: string } {
  const segments = splitFieldPath(field);

  // Descend through the relationship nodes. A missing parent is the same
  // "@optional dropped it" case as a missing field, so it reads as blank.
  let current: Record<string, unknown> = node;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = current[segments[i]];
    if (next == null || typeof next !== "object")
      return { raw: null, text: "" };
    current = next as Record<string, unknown>;
  }

  const leaf = segments[segments.length - 1];
  // `Id` is a bare scalar at every level, with no envelope to unwrap.
  if (leaf === "Id") {
    const id = current.Id;
    return { raw: id ?? null, text: id == null ? "" : String(id) };
  }

  const cell = current[leaf] as GqlScalar | null | undefined;
  if (cell == null) {
    // A field the running user can't see is omitted by `@optional` rather than
    // failing the query — surfaced as blank, same as a genuinely empty value.
    return { raw: null, text: "" };
  }
  return { raw: cell.value, text: cellText(cell) };
}

export async function runQuery(
  spec: QuerySpec,
  /** Every loaded object's fields; the queried object is read out of it. */
  metaByObject: Record<string, FieldMetaMap>,
  init: { signal?: AbortSignal } = {},
): Promise<QueryOutcome> {
  const { document, columns } = toGraphQL(spec, metaByObject);

  // Run is an explicit request for current data. Without this, pressing Run
  // again after a record was created or changed *outside* this app replays the
  // cached rows for up to 300s — no request, nothing in the usage meter, and
  // no way for the user to tell. See `GraphQLCallOptions.fresh`.
  const result = await executeGraphQL<QueryResult, undefined>(
    document,
    undefined,
    { fresh: true },
  );
  if (init.signal?.aborted) {
    return {
      objectApiName: spec.objectApiName,
      columns,
      rows: [],
      totalCount: 0,
      truncated: false,
    };
  }

  const connection = result?.uiapi?.query?.[spec.objectApiName];
  const edges = connection?.edges ?? [];

  const rows: ResultRow[] = [];
  for (const edge of edges) {
    const node = edge?.node;
    if (!node?.Id) continue;

    const values: Record<string, unknown> = {};
    const display: Record<string, string> = {};
    for (const field of columns) {
      const { raw, text } = readField(node, field);
      values[field] = raw;
      display[field] = text;
    }
    rows.push({ id: node.Id, values, display });
  }

  const totalCount = connection?.totalCount ?? rows.length;

  return {
    objectApiName: spec.objectApiName,
    columns,
    rows,
    totalCount,
    truncated: totalCount > rows.length,
  };
}

/* ---- Summarize (aggregate) -------------------------------------------- */

interface GqlAggregateNode {
  [field: string]:
    | ({ value?: unknown; displayValue?: string | null } & Record<
        string,
        unknown
      >)
    | null
    | undefined;
}

interface AggregateQueryResult {
  uiapi?: {
    aggregate?: Record<
      string,
      {
        totalCount?: number;
        edges?:
          | ({ node?: { aggregate?: GqlAggregateNode | null } | null } | null)[]
          | null;
      } | null
    > | null;
  } | null;
}

export interface AggregateRow {
  /** Cell text keyed by `AggregateColumn.key`, ready to display or export. */
  display: Record<string, string>;
  /** Raw values keyed by the same keys, for client-side sorting. */
  values: Record<string, unknown>;
}

export interface AggregateOutcome {
  objectApiName: string;
  columns: AggregateColumn[];
  rows: AggregateRow[];
  /**
   * Records that went into the summary — NOT the number of groups returned.
   * Salesforce reports `totalCount` on the aggregate connection as the size of
   * the underlying record set, so a 7-row summary of 13 records reports 13.
   * Verified live; showing it as a row count would be wrong by design.
   */
  recordCount: number;
}

/**
 * Read one cell.
 *
 * A dimension reads `{ value, displayValue }` off the field itself; a measure
 * reads the same envelope off the function subfield. `displayValue` carries
 * Salesforce's own formatting when present ("$565,000.00" for a currency sum),
 * but is genuinely null for Boolean and reference-Id dimensions, so `value` is
 * the fallback rather than the other way round.
 */
function readAggregateCell(
  node: GqlAggregateNode,
  column: AggregateColumn,
): { raw: unknown; text: string } {
  const field = node[column.field];
  // `@optional` drops fields the running user can't see rather than failing the
  // document, so a missing field here is an access result, not a bug.
  if (field == null) return { raw: null, text: "" };

  const cell = (
    column.fn == null
      ? field
      : (field[column.fn] as GqlScalar | null | undefined)
  ) as GqlScalar | null | undefined;
  if (cell == null) return { raw: null, text: "" };

  return { raw: cell.value, text: cellText(cell) };
}

/**
 * Run a Summarize query — one GraphQL call, same as a row query.
 *
 * Aggregation happens in Salesforce, so this returns one row per group rather
 * than the underlying records. That is the point of the mode: counting 50,000
 * Opportunities by stage costs a single call and returns a handful of rows,
 * where the row query would refuse past its 2,000-record ceiling.
 */
export async function runAggregate(
  spec: AggregateSpec,
  meta: FieldMetaMap,
  init: { signal?: AbortSignal } = {},
): Promise<AggregateOutcome> {
  const { document, columns } = toAggregateGraphQL(spec, meta);

  // Same reasoning as `runQuery`: a summary of stale rows is a stale summary,
  // and it hides it better — one changed number looks like a correct number.
  const result = await executeGraphQL<AggregateQueryResult, undefined>(
    document,
    undefined,
    { fresh: true },
  );
  if (init.signal?.aborted) {
    return {
      objectApiName: spec.objectApiName,
      columns,
      rows: [],
      recordCount: 0,
    };
  }

  const connection = result?.uiapi?.aggregate?.[spec.objectApiName];
  const edges = connection?.edges ?? [];

  const rows: AggregateRow[] = [];
  for (const edge of edges) {
    const node = edge?.node?.aggregate;
    if (!node) continue;

    const values: Record<string, unknown> = {};
    const display: Record<string, string> = {};
    for (const column of columns) {
      const { raw, text } = readAggregateCell(node, column);
      values[column.key] = raw;
      display[column.key] = text;
    }
    rows.push({ values, display });
  }

  return {
    objectApiName: spec.objectApiName,
    columns,
    rows,
    recordCount: connection?.totalCount ?? 0,
  };
}

/* ---- Delete ----------------------------------------------------------- */

export interface DeleteOutcome {
  deleted: string[];
  failed: { id: string; message: string }[];
  /** API calls actually spent, so the UI can report the real cost. */
  calls: number;
}

/**
 * Delete records in batches.
 *
 * Salesforce exposes one `{Object}Delete` mutation field per object, so a batch
 * is expressed with GraphQL aliases. It rejects any mutation carrying more than
 * 75 operations ("Limit of 75 reached for number of graphs in Graph Api" — an
 * undocumented ceiling found by testing), so `chunkIds` keeps each request
 * comfortably below it.
 *
 * Runs with `allOrNone: false` and reads `data` and `errors` together, so a
 * partial failure reports exactly which records went and which didn't rather
 * than collapsing into a single thrown error. Attribution lives in
 * `api/mutationBatch.ts`, shared with the importer — see the note there about
 * Salesforce sending `paths` where the GraphQL spec says `path`.
 */
export async function deleteRecords(
  objectApiName: string,
  ids: string[],
  init: { signal?: AbortSignal } = {},
): Promise<DeleteOutcome> {
  const deleted: string[] = [];
  const failed: { id: string; message: string }[] = [];

  const { calls } = await runMutationBatches(
    chunkIds(ids).map((chunk) => toDeleteMutation(objectApiName, chunk)),
    (document) =>
      executeGraphQLRaw<Record<string, unknown>, undefined>(document),
    (id, outcome) => {
      if (outcome.ok) {
        deleted.push(id);
        // Show all data keeps a 10-entry LRU of loaded records, and remembers
        // the last one it loaded. Without this a record deleted here would
        // still open from cache afterwards — or be restored by the page on the
        // next visit — showing fields for something that no longer exists.
        forgetRecord(id);
      } else {
        failed.push({ id, message: outcome.message });
      }
    },
    { signal: init.signal },
  );

  return { deleted, failed, calls };
}
