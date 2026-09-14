/**
 * The structured query behind Data Export's "Summarize" mode.
 *
 * This is a sibling of `QuerySpec`, not an extension of it. GraphQL exposes
 * aggregation under `uiapi.aggregate`, which is a different connection from
 * `uiapi.query` with its own arguments, its own result shape (values live under
 * `node.aggregate`, not `node`) and its own per-type rules about what may be
 * grouped or aggregated. Trying to express both through one compiler would mean
 * a spec where most combinations are invalid.
 *
 * Everything in the capability tables below was verified against this org's
 * `schema.graphql` and confirmed with live queries — see the notes on each
 * table. The published guide disagrees with the schema in two places, so prefer
 * these over the docs page.
 * https://developer.salesforce.com/docs/platform/graphql/guide/aggregate.html
 */
import type { Filter } from "./types";

/**
 * The aggregate functions the builder offers.
 *
 * These are the field names selected under an aggregate type, e.g.
 * `Amount { sum { value displayValue } }`. `grouping`, `label` and the
 * date-part fields (`calendarYear`, `dayInWeek`, …) also exist on some types
 * but are not measures, so they are deliberately absent.
 */
export type AggregateFunction =
  "count" | "countDistinct" | "sum" | "avg" | "min" | "max";

export interface Measure {
  /** Stable identity for React keys — not part of the emitted query. */
  id: string;
  /** Field API name. `Id` with `count` is the record count. */
  field: string;
  fn: AggregateFunction;
}

export interface GroupByField {
  /** Stable identity for React keys — not part of the emitted query. */
  id: string;
  /** Field API name. */
  field: string;
}

export interface AggregateSpec {
  objectApiName: string;
  /** Grouping dimensions, in display order. Empty means one grand-total row. */
  groupBy: GroupByField[];
  measures: Measure[];
  /** Combined with AND — the same `Filter` the row builder produces. */
  filters: Filter[];
  /** Caps the number of *groups* returned. See AGGREGATE_MAX_LIMIT. */
  limit: number;
}

/**
 * Unlike the row query — where omitting `first` silently returns 10 records —
 * the aggregate connection returns every group when `first` is absent
 * (verified: 13 distinct Account names came back with no `first`). We emit it
 * anyway so a high-cardinality grouping can't produce an unbounded table, and
 * cap it at the same 2,000 the row query uses for consistency.
 */
export const AGGREGATE_MAX_LIMIT = 2000;
export const AGGREGATE_DEFAULT_LIMIT = 200;

export function clampGroupLimit(limit: number): number {
  if (!Number.isFinite(limit)) return AGGREGATE_DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), AGGREGATE_MAX_LIMIT);
}

/**
 * UI API `dataType` -> the functions that field's aggregate type actually
 * exposes.
 *
 * Derived from the aggregate output types in `schema.graphql`: a `dataType` maps
 * to one `*Aggregate` type, and that type's fields are exactly the functions
 * available. Getting this wrong is not a soft failure — selecting `count` on a
 * Boolean fails the *whole* document with
 * "Field 'count' in type 'BooleanAggregate' is undefined", taking every other
 * measure down with it. That is why the picker offers only what is listed here
 * rather than offering all six and letting the server object.
 */
const NUMERIC_FUNCTIONS: AggregateFunction[] = [
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "countDistinct",
];

/** Text-like and date-like types: everything except the arithmetic two. */
const COMPARABLE_FUNCTIONS: AggregateFunction[] = [
  "min",
  "max",
  "count",
  "countDistinct",
];

const FUNCTIONS_BY_TYPE: Record<string, AggregateFunction[]> = {
  // CurrencyAggregate / IntAggregate / DoubleAggregate / PercentAggregate /
  // LongAggregate — the only types carrying `sum` and `avg`.
  Currency: NUMERIC_FUNCTIONS,
  Int: NUMERIC_FUNCTIONS,
  Double: NUMERIC_FUNCTIONS,
  Percent: NUMERIC_FUNCTIONS,
  Long: NUMERIC_FUNCTIONS,

  // StringAggregate / PicklistAggregate / TextAreaAggregate / UrlAggregate /
  // EmailAggregate / PhoneNumberAggregate / IDAggregate / DateAggregate.
  String: COMPARABLE_FUNCTIONS,
  Picklist: COMPARABLE_FUNCTIONS,
  ComboBox: COMPARABLE_FUNCTIONS,
  TextArea: COMPARABLE_FUNCTIONS,
  Url: COMPARABLE_FUNCTIONS,
  Email: COMPARABLE_FUNCTIONS,
  Phone: COMPARABLE_FUNCTIONS,
  EncryptedString: COMPARABLE_FUNCTIONS,
  // Reference fields and Id are both IDAggregate.
  Reference: COMPARABLE_FUNCTIONS,
  Id: COMPARABLE_FUNCTIONS,
  // DateTime is backed by DateAggregate too, so "latest CreatedDate" works
  // even though DateTime cannot be a grouping dimension (see below).
  Date: COMPARABLE_FUNCTIONS,
  DateTime: COMPARABLE_FUNCTIONS,

  // BooleanAggregate exposes only `value` and `grouping` — no functions at all.
  // MultiPicklist, LongTextArea, Base64, Address, Location and Time have either
  // no aggregate type or nothing usable as a measure. All are omitted, which
  // `functionsForType` reports as an empty list.
};

/**
 * Field types that can be a grouping dimension.
 *
 * Read off the per-object `*_GroupBy` input types in `schema.graphql`: a field
 * appears there only if it is groupable. Two results are worth stating because
 * they are not what you would guess, and both were confirmed live:
 *
 * - **Currency, Double and Percent are not groupable** — grouping by a raw
 *   money amount would produce a row per distinct value, so Salesforce simply
 *   doesn't offer it. `Int` and `Long` are groupable.
 * - **TextArea is not groupable** either, despite being aggregatable.
 *
 * `DateTime` is deliberately absent: the schema types DateTime fields as
 * `GroupByDateFunction`, which accepts *only* `{ function: CALENDAR_YEAR }` and
 * rejects `{ group: true }`. Supporting them therefore means shipping date-part
 * grouping as a feature, which this version does not — so DateTime fields are
 * offered as measures but not as dimensions. `Date` fields are ordinary
 * `GroupByClause` and group fine.
 */
const GROUPABLE_TYPES = new Set([
  "String",
  "Picklist",
  "ComboBox",
  "Boolean",
  "Date",
  "Int",
  "Long",
  "Reference",
  "Id",
  "Email",
  "Phone",
  "Url",
  "EncryptedString",
]);

/** Functions offered for a field of this type; empty when it can't be a measure. */
export function functionsForType(dataType: string): AggregateFunction[] {
  return FUNCTIONS_BY_TYPE[dataType] ?? [];
}

export function isGroupableType(dataType: string): boolean {
  return GROUPABLE_TYPES.has(dataType);
}

export function isMeasurableType(dataType: string): boolean {
  return functionsForType(dataType).length > 0;
}

export const FUNCTION_LABELS: Record<AggregateFunction, string> = {
  count: "Count",
  countDistinct: "Distinct count",
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
};

/** SOQL spelling, for the generated preview text only. */
export const FUNCTION_SOQL: Record<AggregateFunction, string> = {
  count: "COUNT",
  countDistinct: "COUNT_DISTINCT",
  sum: "SUM",
  avg: "AVG",
  min: "MIN",
  max: "MAX",
};

/**
 * The record-count measure, spelled `COUNT(Id)`.
 *
 * `Id` is an `IDAggregate`, so `Id { count { value } }` is the one measure
 * guaranteed to be valid on every object regardless of which fields the user
 * can see — which is why it is the default the builder starts with.
 */
export const RECORD_COUNT_MEASURE: Omit<Measure, "id"> = {
  field: "Id",
  fn: "count",
};

export function emptyAggregateSpec(objectApiName = ""): AggregateSpec {
  return {
    objectApiName,
    groupBy: [],
    measures: [],
    filters: [],
    limit: AGGREGATE_DEFAULT_LIMIT,
  };
}

/**
 * Stable key identifying one output column.
 *
 * Group dimensions and measures share a namespace in the results table, and the
 * same field can legitimately appear as both (group by StageName, count
 * StageName), so the prefix is what keeps them distinct.
 */
export function groupColumnKey(field: string): string {
  return `g:${field}`;
}

export function measureColumnKey(field: string, fn: AggregateFunction): string {
  return `m:${field}:${fn}`;
}
