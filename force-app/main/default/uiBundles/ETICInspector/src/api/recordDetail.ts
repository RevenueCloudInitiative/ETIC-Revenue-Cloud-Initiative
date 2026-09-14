/**
 * "Show all data" data layer: every field on the object, with the values for
 * the ones this user can read. Client-only (no Apex).
 *
 * `record-ui` returns only the fields on this user's layout, so the rest are
 * re-requested via `optionalFields`. Two outcomes there are deliberately not
 * "empty", because neither one means the record is blank:
 *
 * - `unavailable` — asked for by name in a request that **succeeded**, still
 *   absent from it. UI API won't serve this field; the row is dropped.
 * - `unknown` — the request **failed**, even bisected down to this field
 *   alone. We know nothing, so the row stays and says so.
 */
import { InspectorError } from "../lib/errors";
import { decodeHtmlEntities } from "../lib/htmlEntities";
import { isAbortError, uiApiGet, type SfRequestInit } from "../lib/sfFetch";
import { MASTER_RECORD_TYPE_ID } from "./picklists";

/**
 * Budget for one `optionalFields` query string.
 *
 * Larger batches mean fewer API calls, and an over-long URL is no longer a
 * correctness risk: `probeFields` splits and retries a failed batch, so an
 * oversized request self-heals into smaller ones instead of dropping the
 * values of every field it carried.
 */
const MAX_OPTIONAL_FIELDS_CHARS = 4000;

export type FieldStatus = "value" | "empty" | "compound" | "unknown";

export interface FieldRow {
  apiName: string;
  label: string;
  dataType: string;
  updateable: boolean;
  /** Raw UI API value used to initialize type-safe editors. */
  rawValue: unknown;
  /** Best human-readable value for ordinary fields. */
  display: string | null;
  status: FieldStatus;
  isSystem: boolean;
  isCompoundParent: boolean;
  compoundParent: string | null;
  componentName: string | null;
  /**
   * Immediate controlling field for a dependent picklist, so an editor can
   * narrow its options to the ones Salesforce would accept. UI API orders
   * `controllingFields` parent-first up the tree.
   */
  controllerField: string | null;
  /** User.Name resolved in one shared batch call for 005 references. */
  userName: string | null;
}

export interface RecordDetail {
  objectApiName: string;
  objectLabel: string;
  recordId: string;
  recordName: string;
  /**
   * Which record type this record uses. Picklist values are scoped by record
   * type, so an editor that ignored this would offer values the record can't
   * take.
   */
  recordTypeId: string;
  rows: FieldRow[];
  /** Used by If-Unmodified-Since to prevent overwriting newer changes. */
  lastModifiedDate: string | null;
}

interface UiFieldMeta {
  apiName: string;
  label: string;
  dataType: string;
  updateable: boolean;
  createable?: boolean;
  custom?: boolean;
  nameField?: boolean;
  compound?: boolean;
  compoundFieldName?: string | null;
  compoundComponentName?: string | null;
  controllingFields?: string[] | null;
}
interface UiObjectInfo {
  apiName: string;
  label: string;
  fields: Record<string, UiFieldMeta>;
  defaultRecordTypeId?: string | null;
}
export interface UiFieldValue {
  value: unknown;
  displayValue: string | null;
}
interface UiRecord {
  apiName: string;
  fields: Record<string, UiFieldValue>;
  id?: string;
  lastModifiedDate?: string;
  recordTypeId?: string | null;
}
interface UiBatchResult {
  statusCode: number;
  result: UiRecord & { id?: string };
}
interface UiBatchResponse {
  results: UiBatchResult[];
}
interface RecordUiResponse {
  objectInfos: Record<string, UiObjectInfo>;
  records: Record<string, UiRecord>;
}

const COMPOUND_TYPES = new Set(["Address", "Location"]);
const SYSTEM_FIELD_NAMES = new Set([
  "Id",
  "IsDeleted",
  "MasterRecordId",
  "SystemModstamp",
  "LastActivityDate",
  "LastViewedDate",
  "LastReferencedDate",
  "Fiscal",
  "FiscalQuarter",
  "FiscalYear",
  "ConnectionReceivedId",
  "ConnectionSentId",
  "UserRecordAccessId",
  "PhotoUrl",
  "CleanStatus",
  "JigsawCompanyId",
]);

function isSystemField(apiName: string, meta?: UiFieldMeta): boolean {
  if (SYSTEM_FIELD_NAMES.has(apiName)) return true;
  const custom = meta?.custom ?? apiName.endsWith("__c");
  const createable = meta?.createable ?? false;
  const updateable = meta?.updateable ?? false;
  const nameField = meta?.nameField ?? false;
  return !custom && !createable && !updateable && !nameField;
}

function rawString(f?: UiFieldValue): string | null {
  if (!f || f.value == null || f.value === "") return null;
  if (typeof f.value === "object") return JSON.stringify(f.value);
  return String(f.value);
}

export function toDisplay(f?: UiFieldValue): string | null {
  if (!f) return null;
  if (f.displayValue != null && f.displayValue !== "") return f.displayValue;
  return rawString(f);
}

/** Resolve all unique User references in one UI API batch request. */
async function resolveUserNames(
  metaFields: Record<string, UiFieldMeta>,
  values: Map<string, UiFieldValue>,
  init?: SfRequestInit,
): Promise<Map<string, string>> {
  const userIds = new Set<string>();

  for (const [apiName, meta] of Object.entries(metaFields)) {
    if (meta.dataType !== "Reference") continue;
    const raw = values.get(apiName)?.value;
    if (typeof raw === "string" && raw.startsWith("005")) userIds.add(raw);
  }

  if (userIds.size === 0) return new Map();

  try {
    const ids = [...userIds].map(encodeURIComponent).join(",");
    const data = await uiApiGet<UiBatchResponse>(
      `/ui-api/records/batch/${ids}?fields=${encodeURIComponent("User.Name")}`,
      init,
    );
    const names = new Map<string, string>();

    for (const item of data.results ?? []) {
      if (item.statusCode !== 200 || item.result?.apiName !== "User") continue;
      const id = item.result.id;
      const name = toDisplay(item.result.fields?.Name);
      if (id && name) names.set(id, name);
    }
    return names;
  } catch (error) {
    if (isAbortError(error)) throw error;
    // Name enrichment is optional. Keep the raw Ids if the batch call fails.
    return new Map();
  }
}

function batchFieldNames(objectApiName: string, names: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const name of names) {
    const add = encodeURIComponent(`${objectApiName}.${name}`).length + 3;
    if (current.length > 0 && length + add > MAX_OPTIONAL_FIELDS_CHARS) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(name);
    length += add;
  }
  if (current.length) batches.push(current);
  return batches;
}

interface ProbeResult {
  /** Values returned by any request that succeeded. */
  values: Map<string, UiFieldValue>;
  /**
   * Fields carried by a request that succeeded, whether or not they came back
   * in it. A field in here but absent from `values` is one UI API declines to
   * serve — see `unavailable` in `getRecordDetail`.
   */
  covered: Set<string>;
}

/**
 * Ask for a set of fields via `optionalFields` and record what came back.
 *
 * A failed request tells us nothing about its fields, so rather than writing
 * off the whole batch we bisect and retry: the blast radius shrinks to the
 * individual field that actually fails, and the ~50 others in an over-long
 * request keep their values instead of all rendering as empty. Only a
 * *successful* request adds to `covered`, which is what makes the "UI API
 * won't serve this" verdict safe to act on.
 */
async function probeFields(
  recordId: string,
  objectApiName: string,
  fields: string[],
  out: ProbeResult,
  init?: SfRequestInit,
): Promise<void> {
  if (fields.length === 0) return;

  const query = fields
    .map((f) => encodeURIComponent(`${objectApiName}.${f}`))
    .join(",");

  try {
    const record = await uiApiGet<UiRecord>(
      `/ui-api/records/${recordId}?optionalFields=${query}`,
      init,
    );
    for (const f of fields) out.covered.add(f);
    if (record?.fields) {
      for (const [k, v] of Object.entries(record.fields)) out.values.set(k, v);
    }
  } catch (error) {
    if (isAbortError(error)) throw error;

    // Never covered, so a field we genuinely couldn't ask about is kept and
    // rendered as empty rather than being hidden on the strength of a failure.
    if (fields.length === 1) return;

    const mid = Math.ceil(fields.length / 2);
    await Promise.all([
      probeFields(recordId, objectApiName, fields.slice(0, mid), out, init),
      probeFields(recordId, objectApiName, fields.slice(mid), out, init),
    ]);
  }
}

export async function getRecordDetail(
  recordId: string,
  init?: SfRequestInit,
): Promise<RecordDetail> {
  const base = await uiApiGet<RecordUiResponse>(
    `/ui-api/record-ui/${recordId}?layoutTypes=Full&modes=View`,
    init,
  );

  const record = base.records[recordId];
  if (!record) {
    throw new InspectorError("NOT_FOUND", `No record found for Id ${recordId}`);
  }
  const objectApiName = record.apiName;
  const info = base.objectInfos[objectApiName];
  const metaFields = info?.fields ?? {};

  const values = new Map<string, UiFieldValue>(Object.entries(record.fields));
  const returned = new Set<string>(Object.keys(record.fields));

  const toRequest = Object.keys(metaFields).filter(
    (f) =>
      !returned.has(f) && !COMPOUND_TYPES.has(metaFields[f]?.dataType ?? ""),
  );

  const probe: ProbeResult = { values: new Map(), covered: new Set() };

  if (toRequest.length > 0) {
    await Promise.all(
      batchFieldNames(objectApiName, toRequest).map((batch) =>
        probeFields(recordId, objectApiName, batch, probe, init),
      ),
    );
    for (const [k, v] of probe.values) {
      values.set(k, v);
      returned.add(k);
    }
  }

  /**
   * Fields UI API refuses to serve, which are dropped from the grid entirely.
   *
   * We asked for these by name in a request that returned 200, and they still
   * weren't in the response. That is not the same as blank: `Opportunity.Fiscal`
   * behaves this way while holding a real value SOQL returns happily, so
   * rendering it as "—" would state something false about the record. Omitting
   * the row is the honest option — the app can't show the value and shouldn't
   * claim there isn't one.
   *
   * Deliberately narrow: only a *successful* request can condemn a field. One
   * whose probe failed stays visible as empty, since hiding a field on the
   * strength of a network blip would lose data the user can actually read.
   */
  const unavailable = new Set(
    toRequest.filter((f) => probe.covered.has(f) && !returned.has(f)),
  );

  /**
   * Fields whose probe never succeeded, even bisected down to the field alone.
   *
   * We asked and got an error, so we know nothing: the field may well hold a
   * value. These render as `unknown` rather than as empty, because a "—" here
   * would claim the record is blank on the strength of a request that failed.
   * Distinct from `unavailable` above, which is a *successful* answer of "not
   * this one" and is safe to hide outright.
   */
  const unresolved = new Set(
    toRequest.filter((f) => !probe.covered.has(f) && !returned.has(f)),
  );

  // One optional enrichment call regardless of how many distinct User Ids exist.
  const userNames = await resolveUserNames(metaFields, values, init);

  const rows: FieldRow[] = Object.keys(metaFields)
    .filter((apiName) => !unavailable.has(apiName))
    .map((apiName) => {
      const meta = metaFields[apiName];
      const dataType = meta?.dataType ?? "—";
      const fieldValue = values.get(apiName);

      let status: FieldStatus;
      let display: string | null = null;

      if (COMPOUND_TYPES.has(dataType)) {
        status = "compound";
      } else if (returned.has(apiName)) {
        display = toDisplay(fieldValue);
        status = display == null ? "empty" : "value";
      } else if (unresolved.has(apiName)) {
        status = "unknown";
      } else {
        status = "empty";
      }

      return {
        apiName,
        label: decodeHtmlEntities(meta?.label ?? apiName),
        dataType,
        updateable: meta?.updateable ?? false,
        rawValue: fieldValue?.value ?? null,
        display,
        status,
        isSystem: isSystemField(apiName, meta),
        // Only the true compound *parents* — the ones whose own dataType is
        // Address or Location. UI API also sets `compound: true` on fields that
        // merely have parts, notably `Account.Name` once Person Accounts are
        // enabled (FirstName + LastName). Trusting that flag badged Account Name
        // as compound and, because compound parents are never inline-editable,
        // made the record's own name field read-only for no reason.
        isCompoundParent: COMPOUND_TYPES.has(dataType),
        compoundParent: meta?.compoundFieldName ?? null,
        componentName: meta?.compoundComponentName ?? null,
        controllerField: meta?.controllingFields?.[0] ?? null,
        userName:
          dataType === "Reference" && typeof fieldValue?.value === "string"
            ? (userNames.get(fieldValue.value) ?? null)
            : null,
      };
    })
    // Sorted by label, because the label is what the grid shows. Sorting by API
    // name instead put "Account Name" (apiName `Name`) between `Jigsaw` and
    // `NumberOfEmployees`, which reads as unsorted to anyone scanning the
    // left-hand column.
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label) || a.apiName.localeCompare(b.apiName),
    );

  return {
    objectApiName,
    objectLabel: decodeHtmlEntities(info?.label ?? objectApiName),
    recordId,
    recordTypeId:
      record.recordTypeId ||
      (typeof values.get("RecordTypeId")?.value === "string"
        ? (values.get("RecordTypeId")!.value as string)
        : null) ||
      info?.defaultRecordTypeId ||
      MASTER_RECORD_TYPE_ID,
    recordName:
      toDisplay(values.get("Name")) ??
      toDisplay(values.get("CaseNumber")) ??
      toDisplay(values.get("Subject")) ??
      recordId,
    rows,
    lastModifiedDate: record.lastModifiedDate ?? null,
  };
}
