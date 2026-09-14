/**
 * QuerySpec -> GraphQL document.
 *
 * Values are inlined as literals rather than passed as GraphQL variables. That
 * is deliberate: filter input types in the `uiapi` schema are per-field
 * (`Email` is its own scalar, `Date` takes an input object, and so on), so
 * declaring correctly-typed variables would mean resolving every chosen
 * field's GraphQL type first. Inlining properly-escaped literals sidesteps the
 * problem entirely — verified against Picklist, Currency, Boolean, Reference,
 * `in` arrays and `ne: null` on a live org.
 */
import {
  isFilterActive,
  isParentPath,
  clampLimit,
  resolverFor,
  splitFieldPath,
  toLikePattern,
  type Filter,
  type QuerySpec,
} from "./types";
import {
  COMPOUND_TYPES,
  isBooleanType,
  isDateType,
  isNumericType,
  type FieldMeta,
  type FieldMetaMap,
} from "../../../lib/fieldMeta";

/**
 * GraphQL string literals use the same escaping rules as JSON, so
 * `JSON.stringify` is the correct escape here — it handles quotes,
 * backslashes and control characters. Hand-rolling this is how injection bugs
 * get written.
 */
function gqlString(value: string): string {
  return JSON.stringify(value);
}

/** Split a comma-separated list for `in` / `nin`, dropping blanks. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function isNullLiteral(value: string): boolean {
  return value.trim().toLowerCase() === "null";
}

/** Render one scalar value in the form the field's data type requires. */
function renderScalar(raw: string, dataType: string): string {
  const trimmed = raw.trim();

  if (isNullLiteral(trimmed)) return "null";

  if (isBooleanType(dataType)) {
    return trimmed.toLowerCase() === "true" ? "true" : "false";
  }

  if (isNumericType(dataType)) {
    const n = Number(trimmed);
    // A non-numeric entry in a numeric field would produce invalid GraphQL;
    // fall back to a quoted string so the server rejects it with a clear
    // message rather than the document failing to parse.
    return Number.isFinite(n) ? String(n) : gqlString(trimmed);
  }

  return gqlString(trimmed);
}

/**
 * Date and DateTime filters take an input object, not a bare scalar:
 *   { CloseDate: { gte: { value: "2020-01-01" } } }
 * https://developer.salesforce.com/docs/platform/graphql/guide/filter-fields.html
 */
function renderDateValue(raw: string): string {
  const trimmed = raw.trim();
  if (isNullLiteral(trimmed)) return "null";
  return `{ value: ${gqlString(trimmed)} }`;
}

function renderFilterValue(filter: Filter, dataType: string): string {
  const listOperator = filter.operator === "in" || filter.operator === "nin";

  // `like` is always a pattern, never a null comparison — `LIKE NULL` is
  // meaningless — so the value goes through the wildcard wrapper untouched by
  // the null-literal handling the comparison operators need.
  if (filter.operator === "like") {
    return gqlString(toLikePattern(filter.value));
  }

  if (listOperator) {
    const items = splitList(filter.value).map((item) =>
      isDateType(dataType)
        ? renderDateValue(item)
        : renderScalar(item, dataType),
    );
    return `[${items.join(", ")}]`;
  }

  return isDateType(dataType)
    ? renderDateValue(filter.value)
    : renderScalar(filter.value, dataType);
}

/**
 * Compile a filter list to a GraphQL `where:` value, or null when nothing is
 * usable.
 *
 * Exported because the Summarize compiler filters with exactly the same
 * semantics — `uiapi.aggregate` takes the same `{Object}_Filter` input type as
 * `uiapi.query`. Sharing this is what keeps a filter from behaving differently
 * depending on which mode the user is in.
 */
/**
 * Wrap a clause in one object per relationship segment, innermost last:
 *   Account.Owner.Name  ->  { Account: { Owner: { Name: <clause> } } }
 * A plain field is the zero-relationship case and comes back unchanged.
 */
function nestByPath(path: string, innermost: string): string {
  const segments = splitFieldPath(path);
  let built = `${segments[segments.length - 1]}: ${innermost}`;
  for (let i = segments.length - 2; i >= 0; i--) {
    built = `${segments[i]}: { ${built} }`;
  }
  return `{ ${built} }`;
}

export function buildWhere(
  filters: Filter[],
  /**
   * Resolves a field path to its metadata. A function rather than a map because
   * a path may cross objects (`Account.AnnualRevenue`), and because one
   * resolution rule is the only way the GraphQL and SOQL compilers can be held
   * to typing the same filter identically.
   */
  metaFor: (path: string) => FieldMeta | undefined,
): string | null {
  const usable = filters.filter(isFilterActive);
  if (usable.length === 0) return null;

  // Each filter becomes its own `{ Field: { op: value } }` entry — nested
  // through its relationships when it targets a parent field. They are combined
  // under `and:` rather than merged into one object so that two filters on the
  // *same* field don't silently collide as duplicate keys, and so that two
  // filters on different fields of the *same parent* don't either.
  const clauses = usable.map((f) => {
    const dataType = metaFor(f.field)?.dataType ?? "String";
    return nestByPath(
      f.field,
      `{ ${f.operator}: ${renderFilterValue(f, dataType)} }`,
    );
  });

  if (clauses.length === 1) return clauses[0];
  return `{ and: [${clauses.join(", ")}] }`;
}

/**
 * A node in the selection tree built from dotted field paths.
 *
 * `Account.Name` and `Account.Industry` have to become **one** `Account { … }`
 * block containing both, not two sibling blocks — so the flat path list is
 * grouped into a tree before anything is emitted.
 */
interface SelectionNode {
  /** Leaf fields selected directly on this node's object. */
  leaves: Set<string>;
  /** Child relationships, keyed by relationship name. */
  children: Map<string, SelectionNode>;
}

function emptyNode(): SelectionNode {
  return { leaves: new Set(), children: new Map() };
}

function buildSelectionTree(paths: string[]): SelectionNode {
  const root = emptyNode();
  for (const path of paths) {
    const segments = splitFieldPath(path);
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const relation = segments[i];
      let child = node.children.get(relation);
      if (!child) {
        child = emptyNode();
        node.children.set(relation, child);
      }
      node = child;
    }
    node.leaves.add(segments[segments.length - 1]);
  }
  return root;
}

/**
 * `Id` is a bare scalar in the uiapi schema — at *every* level, including
 * inside a parent block; every other field is a wrapper exposing `value` and
 * `displayValue`. Requesting a subselection on `Id`, or omitting one elsewhere,
 * fails the whole document.
 *
 * `@optional` goes on every field and on every relationship node. Without it a
 * single field the running user lacks FLS on fails the entire query instead of
 * being omitted — and a parent the user can't read would take the whole row
 * with it.
 */
function emitNode(node: SelectionNode, indent: string): string[] {
  const lines: string[] = [];

  // `Id` first and without a subselection, matching how the row key is read.
  if (node.leaves.has("Id")) lines.push(`${indent}Id`);

  for (const leaf of node.leaves) {
    if (leaf === "Id") continue;
    lines.push(`${indent}${leaf} @optional { value displayValue }`);
  }

  for (const [relation, child] of node.children) {
    lines.push(`${indent}${relation} @optional {`);
    lines.push(...emitNode(child, `${indent}  `));
    lines.push(`${indent}}`);
  }

  return lines;
}

function buildFieldSelection(fields: string[], meta: FieldMetaMap): string {
  // Compound parents can't be selected. Only the root object's metadata is
  // consulted here, so a compound field reached through a relationship is left
  // to the server — the same "don't veto what we can't see" rule used elsewhere.
  const selected = fields.filter(
    (f) => isParentPath(f) || !COMPOUND_TYPES.has(meta[f]?.dataType ?? ""),
  );

  // The row key is always requested even when the user unticked the column.
  const tree = buildSelectionTree(["Id", ...selected]);
  return emitNode(tree, "            ").join("\n");
}

export interface CompiledQuery {
  document: string;
  /** Fields actually requested, in the order the grid should show them. */
  columns: string[];
}

export function toGraphQL(
  spec: QuerySpec,
  /**
   * Metadata for every loaded object, keyed by API name. The queried object's
   * own fields are read out of it rather than passed alongside it: taking both
   * meant two sources of truth for the same thing, and a caller that passed a
   * mismatched pair would silently compile a query against the wrong object's
   * types.
   */
  metaByObject: Record<string, FieldMetaMap>,
): CompiledQuery {
  if (!spec.objectApiName) {
    throw new Error("Choose an object before running the query.");
  }

  const meta = metaByObject[spec.objectApiName] ?? {};
  const metaFor = resolverFor(spec.objectApiName, metaByObject);

  // Columns are exactly what the user picked, in their order. `Id` is always
  // *requested* — it is the row key selection, delete and save all depend on —
  // but it is only *shown* when the user kept it selected, so unticking it
  // hides the column without breaking anything downstream.
  const columns = spec.fields.filter(
    (f) => isParentPath(f) || !COMPOUND_TYPES.has(meta[f]?.dataType ?? ""),
  );

  const limit = clampLimit(spec.limit);

  const args: string[] = [];
  const where = buildWhere(spec.filters, metaFor);
  if (where) args.push(`where: ${where}`);
  // `first` is always emitted — omitting it silently returns only 10 records.
  args.push(`first: ${limit}`);
  if (spec.orderBy?.field) {
    // Nested the same way a filter is: orderBy: { Account: { Name: {...} } }.
    args.push(
      `orderBy: ${nestByPath(spec.orderBy.field, `{ order: ${spec.orderBy.direction} }`)}`,
    );
  }

  const document = `query DataExport {
  uiapi {
    query {
      ${spec.objectApiName}(
        ${args.join("\n        ")}
      ) {
        totalCount
        edges {
          node {
${buildFieldSelection(columns, meta)}
          }
        }
        pageInfo { hasNextPage }
      }
    }
  }
}`;

  return { document, columns };
}

/**
 * Batched delete. Salesforce exposes a per-object `{Object}Delete` mutation
 * field, so deleting many records in one request means GraphQL aliases.
 *
 * `allOrNone: false` so one bad Id doesn't roll back the whole batch — the
 * caller reports per-record outcomes instead.
 * https://developer.salesforce.com/docs/platform/graphql/guide/mutations-delete.html
 */
export function toDeleteMutation(
  objectApiName: string,
  ids: string[],
): { document: string; aliases: Record<string, string> } {
  const aliases: Record<string, string> = {};
  const lines = ids.map((id, index) => {
    const alias = `d${index}`;
    aliases[alias] = id;
    return `    ${alias}: ${objectApiName}Delete(input: { Id: ${gqlString(id)} }) { Id }`;
  });

  const document = `mutation DataExportDelete {
  uiapi(input: { allOrNone: false }) {
${lines.join("\n")}
  }
}`;

  return { document, aliases };
}

/**
 * Salesforce rejects a mutation carrying more than 75 operations with
 * "Limit of 75 reached for number of graphs in Graph Api". That ceiling is not
 * in the published guide — it was found by testing against a live org — so we
 * chunk below it rather than at it.
 */
export const DELETE_CHUNK_SIZE = 50;

export function chunkIds(ids: string[], size = DELETE_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}
