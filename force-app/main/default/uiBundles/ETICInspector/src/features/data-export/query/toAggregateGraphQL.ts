/**
 * AggregateSpec -> GraphQL document for `uiapi.aggregate`.
 *
 * Shares `buildWhere` with the row compiler because both connections take the
 * same `{Object}_Filter` input, but nothing else is shared: the aggregate
 * connection nests its values under `node.aggregate` and applies functions as
 * *subfields* of the field rather than returning the field itself.
 *
 * Deliberately omitted, both for the same reason — the schema does not support
 * them the way the published guide implies, and a rejected document costs an
 * API call for nothing:
 *
 * - **`orderBy`.** The guide shows `orderBy: { Name: { order: DESC, function:
 *   COUNT } }`, but `{Object}_OrderBy` resolves to `OrderByClause`, which has
 *   only `order` and `nulls`. Group ordering is done client-side instead, which
 *   is free and cannot fail.
 * - **Date-part grouping.** `groupBy: { CreatedDate: { function: CALENDAR_YEAR } }`
 *   works only because DateTime fields are typed `GroupByDateFunction`; ordinary
 *   fields use `GroupByClause`, whose only input is `group: Boolean`. Supporting
 *   both is a feature in its own right, so DateTime fields are not offered as
 *   dimensions here.
 */
import {
  clampGroupLimit,
  functionsForType,
  groupColumnKey,
  isGroupableType,
  measureColumnKey,
  type AggregateFunction,
  type AggregateSpec,
} from "./aggregate";
import { buildWhere } from "./toGraphQL";
import type { FieldMetaMap } from "../../../lib/fieldMeta";

/** One column in the summary table, and how to read it out of a result node. */
export interface AggregateColumn {
  /** Stable key, unique across dimensions and measures. */
  key: string;
  /** Field API name to read under `node.aggregate`. */
  field: string;
  /** Absent for a grouping dimension; the subfield to read for a measure. */
  fn: AggregateFunction | null;
  /** Column heading. */
  label: string;
}

export interface CompiledAggregate {
  document: string;
  columns: AggregateColumn[];
}

/**
 * Every selection needed for one field, merged.
 *
 * A field can be a dimension and carry several measures at once — grouping by
 * StageName while also counting it is legitimate. GraphQL would let those be
 * written as separate selections and merge them itself, but building the merged
 * form here keeps the emitted document readable and, more importantly, makes
 * the result parser's job unambiguous: each field appears exactly once.
 */
interface FieldSelection {
  /** True when the field is a grouping dimension, which reads `value`. */
  dimension: boolean;
  functions: Set<AggregateFunction>;
}

function fieldLabel(field: string, meta: FieldMetaMap): string {
  return meta[field]?.label ?? field;
}

/**
 * `COUNT(Id)` is the record count, and "Count of Id" reads like a mistake.
 * Every other combination is named after the field it measures.
 */
function measureLabel(
  field: string,
  fn: AggregateFunction,
  meta: FieldMetaMap,
): string {
  if (field === "Id" && fn === "count") return "Records";
  const labels: Record<AggregateFunction, string> = {
    count: "Count",
    countDistinct: "Distinct",
    sum: "Sum",
    avg: "Avg",
    min: "Min",
    max: "Max",
  };
  return `${labels[fn]} of ${fieldLabel(field, meta)}`;
}

export function toAggregateGraphQL(
  spec: AggregateSpec,
  meta: FieldMetaMap,
): CompiledAggregate {
  if (!spec.objectApiName) {
    throw new Error("Choose an object before running the summary.");
  }
  if (spec.groupBy.length === 0 && spec.measures.length === 0) {
    throw new Error("Add at least one measure or grouping.");
  }

  const selections = new Map<string, FieldSelection>();
  const columns: AggregateColumn[] = [];

  const touch = (field: string): FieldSelection => {
    let entry = selections.get(field);
    if (!entry) {
      entry = { dimension: false, functions: new Set() };
      selections.set(field, entry);
    }
    return entry;
  };

  // Dimensions first: they are the left-hand columns of the table, and the
  // order the user arranged them in is the order Salesforce groups by.
  for (const group of spec.groupBy) {
    if (!group.field) continue;
    const dataType = meta[group.field]?.dataType;
    // Only reject when metadata is actually loaded and says no. An unknown
    // field is passed through so the server can give the authoritative answer
    // rather than this table silently vetoing something valid.
    if (dataType && !isGroupableType(dataType)) {
      throw new Error(
        `${fieldLabel(group.field, meta)} can't be grouped by — Salesforce doesn't allow grouping on ${dataType} fields.`,
      );
    }
    if (selections.get(group.field)?.dimension) continue; // duplicate dimension
    touch(group.field).dimension = true;
    columns.push({
      key: groupColumnKey(group.field),
      field: group.field,
      fn: null,
      label: fieldLabel(group.field, meta),
    });
  }

  for (const measure of spec.measures) {
    if (!measure.field) continue;
    const dataType = meta[measure.field]?.dataType;
    if (dataType && !functionsForType(dataType).includes(measure.fn)) {
      throw new Error(
        `${measureLabel(measure.field, measure.fn, meta)} isn't available — Salesforce doesn't support that function on ${dataType} fields.`,
      );
    }
    const entry = touch(measure.field);
    if (entry.functions.has(measure.fn)) continue; // duplicate measure
    entry.functions.add(measure.fn);
    columns.push({
      key: measureColumnKey(measure.field, measure.fn),
      field: measure.field,
      fn: measure.fn,
      label: measureLabel(measure.field, measure.fn, meta),
    });
  }

  const selectionLines: string[] = [];
  for (const [field, entry] of selections) {
    const parts: string[] = [];
    // A dimension reads the grouped value itself. `displayValue` is requested
    // alongside it but is genuinely null for some types (Boolean and reference
    // Ids both came back null), so the reader falls back to `value`.
    if (entry.dimension) parts.push("value", "displayValue");
    for (const fn of entry.functions) {
      parts.push(`${fn} { value displayValue }`);
    }
    // `@optional` matters as much here as in the row query: without it a single
    // field the running user lacks FLS on fails the whole document, and an
    // aggregate document carries every measure at once.
    selectionLines.push(
      `              ${field} @optional { ${parts.join(" ")} }`,
    );
  }

  const args: string[] = [];
  // Summarize doesn't traverse relationships, so the queried object's own
  // fields are the whole resolution space.
  const where = buildWhere(spec.filters, (path) => meta[path]);
  if (where) args.push(`where: ${where}`);

  const dimensions = spec.groupBy.filter((g) => g.field);
  if (dimensions.length > 0) {
    const clauses = [...new Set(dimensions.map((g) => g.field))].map(
      (field) => `${field}: { group: true }`,
    );
    args.push(`groupBy: { ${clauses.join(", ")} }`);
  }

  args.push(`first: ${clampGroupLimit(spec.limit)}`);

  const document = `query DataExportSummary {
  uiapi {
    aggregate {
      ${spec.objectApiName}(
        ${args.join("\n        ")}
      ) {
        edges {
          node {
            aggregate {
${selectionLines.join("\n")}
            }
          }
        }
        totalCount
      }
    }
  }
}`;

  return { document, columns };
}
