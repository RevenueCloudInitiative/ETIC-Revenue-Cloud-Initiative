/**
 * The structured query the Data Export builder produces.
 *
 * There is deliberately no SOQL *parser* anywhere in this feature. The builder
 * emits a `QuerySpec`, which compiles one way to GraphQL (`toGraphQL`) and one
 * way to readable SOQL (`toSoqlText`, for display and clipboard only). Nothing
 * ever reads SOQL text back in, so there is no path by which a query can be
 * misread — the builder can only express what the compiler can translate.
 */
import {
  isBooleanType,
  isDateType,
  isNumericType,
  type FieldMeta,
  type FieldMetaMap,
} from "../../../lib/fieldMeta";

/**
 * Operators supported by the builder.
 *
 * GraphQL `uiapi` also offers `inq`/`ninq` (semi-join / anti-join), which are
 * omitted: they take a subquery rather than a literal, and carry their own
 * restrictions (max 2 per query, no combining with `or`/`orderBy`).
 * See https://developer.salesforce.com/docs/platform/graphql/guide/filter-fields.html
 */
export type FilterOperator =
  "eq" | "ne" | "lt" | "gt" | "lte" | "gte" | "like" | "in" | "nin";

export interface Filter {
  /** Stable identity for React keys — not part of the emitted query. */
  id: string;
  /** Field API name. */
  field: string;
  operator: FilterOperator;
  /** Raw text from the input; typed at compile time from field metadata. */
  value: string;
  /**
   * Kept in the list but excluded from the compiled query.
   *
   * Deleting a filter to see what it was doing means retyping it to get it
   * back, so this is the "off" switch the X button isn't. Optional rather than
   * required because every filter ever persisted to session state predates it,
   * and `undefined` must read as enabled.
   */
  disabled?: boolean;
}

/**
 * Whether a filter reaches the query at all — the single rule both compilers
 * and the UI answer this question with.
 *
 * Three conditions, and each one shipped as its own bug at some point: a filter
 * with no field, a filter with no value (which used to look exactly like a
 * filter that ran and matched everything), and now a deliberately disabled one.
 * `toGraphQL` and `toSoqlText` each had their own copy of the first two, which
 * is precisely the drift that §14 of ARCHITECTURE-QA.md documents three prior
 * instances of — a disabled filter that the preview still printed would be the
 * fourth.
 */
export function isFilterActive(filter: Filter): boolean {
  return (
    !filter.disabled && Boolean(filter.field) && filter.value.trim() !== ""
  );
}

export interface OrderBy {
  field: string;
  direction: "ASC" | "DESC";
}

export interface QuerySpec {
  objectApiName: string;
  /** Field API names, in display order. `Id` is always included by the builder. */
  fields: string[];
  /** Combined with AND. */
  filters: Filter[];
  orderBy: OrderBy | null;
  /** Salesforce caps `first` at 2000; see MAX_LIMIT. */
  limit: number;
}

/**
 * GraphQL `first` accepts at most 2000 records per subquery, and omitting it
 * silently returns only 10.
 * https://developer.salesforce.com/docs/platform/graphql/guide/query-limits.html
 */
export const MAX_LIMIT = 2000;
export const DEFAULT_LIMIT = 200;

/**
 * The limit that will actually be sent. Salesforce caps `first` at 2,000, so a
 * larger number is reduced rather than rejected.
 *
 * Both the GraphQL compiler and the SOQL preview go through this, so the
 * preview can never advertise a limit the query doesn't use — it previously
 * printed the raw number and read `LIMIT 5000` for a query that ran with
 * `first: 2000`.
 *
 * A non-finite value falls back to the default: an empty number input reads as
 * 0, and `first: NaN` would be a document Salesforce cannot even parse.
 */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

/**
 * Salesforce allows 5 levels of child-to-parent nesting (raised from 2 in
 * API v58.0). The picker stops offering expansion at this depth rather than
 * letting the user build a query the platform will reject.
 * https://developer.salesforce.com/docs/platform/graphql/guide/query-limits.html
 */
export const MAX_RELATIONSHIP_DEPTH = 5;

/**
 * Split a field path into its segments. A path is relationship names followed
 * by a field API name — `Account.Owner.Name` — and a plain field is just a
 * one-segment path, so every caller can treat the two uniformly.
 */
export function splitFieldPath(path: string): string[] {
  return path.split(".");
}

/** True when the path traverses at least one relationship. */
export function isParentPath(path: string): boolean {
  return path.includes(".");
}

/** Resolves any field path — plain or dotted — against loaded metadata. */
export type FieldResolver = (path: string) => FieldMeta | undefined;

/**
 * Build the one field-resolution rule both compilers use.
 *
 * `toGraphQL` and `toSoqlText` must type a filter literal identically or the
 * preview describes a query that didn't run — drift that has already shipped
 * twice here (`LIKE` without wildcards, and `LIMIT 5000` against `first: 2000`).
 * Sharing the resolver is what makes the two physically unable to disagree
 * about a field's type, including across a relationship.
 */
export function resolverFor(
  rootObject: string,
  metaByObject: Record<string, FieldMetaMap>,
): FieldResolver {
  return (path) =>
    isParentPath(path)
      ? resolveFieldPath(path, rootObject, metaByObject)?.meta
      : metaByObject[rootObject]?.[path];
}

export interface ResolvedField {
  meta: FieldMeta;
  /** Object the final field belongs to. */
  objectApiName: string;
  /** Labels of each segment, for display. */
  trail: string[];
}

/**
 * Walk a dotted path through already-loaded object metadata.
 *
 * Returns `null` when any segment can't be resolved — an unloaded parent object,
 * a relationship that doesn't exist, a polymorphic reference. Callers treat that
 * as "can't judge locally" rather than "invalid": a path the app hasn't got
 * metadata for is still sent to Salesforce, which is the authority.
 */
export function resolveFieldPath(
  path: string,
  rootObject: string,
  metaByObject: Record<string, FieldMetaMap>,
): ResolvedField | null {
  const segments = splitFieldPath(path);
  let objectApiName = rootObject;
  const trail: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const fields = metaByObject[objectApiName];
    if (!fields) return null;
    const segment = segments[i];
    const last = i === segments.length - 1;

    if (last) {
      const meta = fields[segment];
      if (!meta) return null;
      trail.push(meta.label);
      return { meta, objectApiName, trail };
    }

    // Intermediate segments are relationship names, not field API names, so
    // the lookup is by `relationshipName` rather than by key.
    const relation = Object.values(fields).find(
      (f) => f.relationshipName === segment && f.referenceTo,
    );
    if (!relation?.referenceTo) return null;
    // Reference labels read "Account ID"; the relationship step is the account
    // itself, so the trailing "ID" would be actively misleading here.
    trail.push(relation.label.replace(/\s*ID$/i, ""));
    objectApiName = relation.referenceTo;
  }

  return null;
}

/** Operators that make sense for a given field type, for narrowing the UI. */
export function operatorsForType(dataType: string): FilterOperator[] {
  if (isBooleanType(dataType)) return ["eq", "ne"];
  if (isNumericType(dataType) || isDateType(dataType)) {
    return ["eq", "ne", "lt", "gt", "lte", "gte"];
  }
  return ["eq", "ne", "like", "in", "nin"];
}

/**
 * `like` is SOQL LIKE, not "contains": it matches the *whole* value unless the
 * pattern carries wildcards, which is why an unadorned term behaved exactly
 * like `eq`. Wrapping in `%` on both sides makes the operator do what its label
 * promises.
 * https://developer.salesforce.com/docs/platform/graphql/guide/filter-fields.html
 *
 * A value that already contains `%` is passed through untouched, so an anchored
 * pattern typed by hand ("Burlington%") still means what it says.
 *
 * `_` — LIKE's single-character wildcard — is deliberately *not* treated as a
 * user-supplied wildcard. Underscores are ordinary characters in Salesforce
 * names, so honouring them here would silently stop wrapping for a value like
 * `My_Account` and reintroduce the same bug for exactly the values most likely
 * to hit it.
 */
export function toLikePattern(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.includes("%")) return trimmed;
  return `%${trimmed}%`;
}

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: "equals",
  ne: "not equals",
  lt: "less than",
  gt: "greater than",
  lte: "less or equal",
  gte: "greater or equal",
  like: "contains (like)",
  in: "in list",
  nin: "not in list",
};

export function emptySpec(objectApiName = ""): QuerySpec {
  return {
    objectApiName,
    fields: [],
    filters: [],
    orderBy: null,
    limit: DEFAULT_LIMIT,
  };
}
