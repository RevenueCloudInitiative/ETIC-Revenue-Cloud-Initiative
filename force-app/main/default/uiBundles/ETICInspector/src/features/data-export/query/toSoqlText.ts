/**
 * QuerySpec -> readable SOQL.
 *
 * This is a **one-way, display-only** rendering. Nothing in the app parses SOQL
 * back into a QuerySpec, and nothing should: the generated text exists so the
 * query preview, the history list, and the copy button are meaningful to an
 * admin who thinks in SOQL. The query that actually executes is the GraphQL
 * document from `toGraphQL`.
 *
 * One consequence worth stating plainly: the text below is a faithful
 * description of what the builder asked for, but it is not the string that ran.
 * Pasting it into a different SOQL tool should give the same records, though
 * it has not been round-trip verified.
 */
import {
  clampGroupLimit,
  FUNCTION_SOQL,
  type AggregateSpec,
} from "./aggregate";
import {
  clampLimit,
  isFilterActive,
  resolverFor,
  toLikePattern,
  type FieldResolver,
  type Filter,
  type QuerySpec,
} from "./types";
import {
  isBooleanType,
  isNumericType,
  type FieldMetaMap,
} from "../../../lib/fieldMeta";

const OPERATOR_SQL: Record<Filter["operator"], string> = {
  eq: "=",
  ne: "!=",
  lt: "<",
  gt: ">",
  lte: "<=",
  gte: ">=",
  like: "LIKE",
  in: "IN",
  nin: "NOT IN",
};

function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function renderValue(filter: Filter, dataType: string): string {
  const trimmed = filter.value.trim();

  // Show the wildcards the query actually runs with, or the preview would
  // describe a stricter query than the one that executes.
  if (filter.operator === "like") return quote(toLikePattern(trimmed));

  if (filter.operator === "in" || filter.operator === "nin") {
    const items = trimmed
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => (isNumericType(dataType) ? v : quote(v)));
    return `(${items.join(", ")})`;
  }

  if (trimmed.toLowerCase() === "null") return "NULL";
  if (isBooleanType(dataType)) {
    return trimmed.toLowerCase() === "true" ? "TRUE" : "FALSE";
  }
  if (isNumericType(dataType)) return trimmed;
  // Dates read more naturally unquoted in SOQL, matching how admins write them.
  if (dataType === "Date" || dataType === "DateTime") return trimmed;
  return quote(trimmed);
}

/**
 * `WHERE …`, or null when no filter carries a value. Shared by both modes.
 *
 * Takes the same `FieldResolver` the GraphQL compiler uses rather than a plain
 * map, which is what keeps the preview honest about parent fields: a flat
 * `meta[path]` lookup misses `Account.AnnualRevenue`, falls back to String, and
 * renders `> '1000'` for a filter that actually runs as `> 1000`.
 */
function whereClause(filters: Filter[], metaFor: FieldResolver): string | null {
  const usable = filters.filter(isFilterActive);
  if (usable.length === 0) return null;

  const clauses = usable.map((f) => {
    const dataType = metaFor(f.field)?.dataType ?? "String";
    return `${f.field} ${OPERATOR_SQL[f.operator]} ${renderValue(f, dataType)}`;
  });
  return `WHERE ${clauses.join(" AND ")}`;
}

export function toSoqlText(
  spec: QuerySpec,
  metaByObject: Record<string, FieldMetaMap> = {},
): string {
  if (!spec.objectApiName) return "";

  const fields = spec.fields.length > 0 ? spec.fields : ["Id"];
  const parts = [`SELECT ${fields.join(", ")}`, `FROM ${spec.objectApiName}`];

  const where = whereClause(
    spec.filters,
    resolverFor(spec.objectApiName, metaByObject),
  );
  if (where) parts.push(where);

  if (spec.orderBy?.field) {
    parts.push(`ORDER BY ${spec.orderBy.field} ${spec.orderBy.direction}`);
  }

  parts.push(`LIMIT ${clampLimit(spec.limit)}`);

  return parts.join("\n");
}

/** Single-line form for the history list. */
export function toSoqlOneLine(
  spec: QuerySpec,
  metaByObject: Record<string, FieldMetaMap> = {},
): string {
  return toSoqlText(spec, metaByObject).replace(/\s*\n\s*/g, " ");
}

/**
 * AggregateSpec -> readable SOQL, under the same display-only contract as
 * `toSoqlText`: nothing parses this back, and the document that actually runs
 * is the GraphQL one from `toAggregateGraphQL`.
 *
 * The GROUP BY form is what makes Summarize legible to an admin — the GraphQL
 * equivalent buries the same intent in nested selections.
 */
export function toAggregateSoqlText(
  spec: AggregateSpec,
  meta: FieldMetaMap = {},
): string {
  if (!spec.objectApiName) return "";

  const dimensions = spec.groupBy.map((g) => g.field).filter(Boolean);
  const selected = [
    ...new Set([
      ...dimensions,
      ...spec.measures
        .filter((m) => m.field)
        .map((m) => `${FUNCTION_SOQL[m.fn]}(${m.field})`),
    ]),
  ];

  const parts = [
    `SELECT ${selected.length > 0 ? selected.join(", ") : "COUNT(Id)"}`,
    `FROM ${spec.objectApiName}`,
  ];

  // Summarize has no parent traversal, so its own fields are the whole story.
  const where = whereClause(spec.filters, (path) => meta[path]);
  if (where) parts.push(where);

  if (dimensions.length > 0) {
    parts.push(`GROUP BY ${[...new Set(dimensions)].join(", ")}`);
  }

  parts.push(`LIMIT ${clampGroupLimit(spec.limit)}`);

  return parts.join("\n");
}

/** Single-line form for the history list. */
export function toAggregateSoqlOneLine(
  spec: AggregateSpec,
  meta: FieldMetaMap = {},
): string {
  return toAggregateSoqlText(spec, meta).replace(/\s*\n\s*/g, " ");
}
