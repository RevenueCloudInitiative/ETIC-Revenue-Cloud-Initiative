/**
 * The subset of UI API object/field metadata the app works from.
 *
 * This lived in `features/data-export/query/types.ts` while Data Export was its
 * only consumer. Data Import needs exactly the same shape — it reads the same
 * `object-info` response, out of the same session cache in `api/dataExport.ts` —
 * so the type moved here rather than one feature importing out of another's
 * internals. The old module re-exports it, so existing imports still resolve.
 */

/** Compound parents (Address, Location) can't be selected, filtered or written. */
export const COMPOUND_TYPES = new Set(["Address", "Location"]);

export interface FieldMeta {
  apiName: string;
  label: string;
  dataType: string;
  filterable: boolean;
  sortable: boolean;
  updateable: boolean;
  compound: boolean;
  /**
   * Whether the field can be set on create. Distinct from `updateable`: an
   * audit field like `CreatedDate` is neither, a formula field is neither, and
   * `Opportunity.Probability` is both — but a "create only" field exists too, so
   * the importer has to check the flag matching the operation rather than
   * assuming one implies the other.
   */
  createable: boolean;
  /** Salesforce will reject a create that leaves this blank. */
  required: boolean;
  /** Maximum length for text types; null when the concept doesn't apply. */
  length: number | null;
  /**
   * The relationship name used to traverse to the parent record — `Account` for
   * `AccountId`, `Owner` for `OwnerId`. This is the name GraphQL and SOQL use;
   * the field's own API name is the one holding the Id.
   *
   * `null` when the field isn't a reference, and deliberately also null for
   * **polymorphic** references (`Task.WhoId` → Contact *or* Lead). Those resolve
   * to a union type in the schema (`Task_Who`) rather than a record type, so the
   * plain `Rel { Field }` selection the query compiler emits doesn't apply.
   */
  relationshipName: string | null;
  /** Target object API name. Only set for single-target references. */
  referenceTo: string | null;
}

export type FieldMetaMap = Record<string, FieldMeta>;

/**
 * Whether two field descriptions are the same in every respect.
 *
 * Compared **generically**, over the union of own keys, rather than against a
 * hand-written list of properties. Every value in `FieldMeta` is a scalar, so
 * `===` is exact — and a property added to the interface later is covered
 * automatically instead of being silently excluded from the comparison, which
 * is the failure mode a listed-keys version would have. Adding a *nested* value
 * to `FieldMeta` is the one change that would need this revisited.
 */
export function sameFieldMeta(a: FieldMeta, b: FieldMeta): boolean {
  const keys = Object.keys(a) as (keyof FieldMeta)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/**
 * Whether two field maps describe the same object, ignoring key order.
 *
 * Order-insensitive on purpose. This decides whether a background metadata
 * refresh is a *change*, and `object-info` makes no promise about the order it
 * lists fields in — a comparison that noticed reordering would report a change
 * on every refresh, which would make the whole revalidation pointless.
 */
export function sameFieldMetaMap(a: FieldMetaMap, b: FieldMetaMap): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const other = b[key];
    return other !== undefined && sameFieldMeta(a[key], other);
  });
}

/** Field data types that compile to bare GraphQL numbers rather than strings. */
const NUMERIC_TYPES = new Set(["Int", "Double", "Currency", "Percent", "Long"]);

/**
 * Date and DateTime need special handling, but *which* special handling depends
 * on the direction:
 *
 * - **Filtering** takes an input object — `{ CloseDate: { gte: { value: "…" } } }`
 * - **Writing** takes a bare scalar — `{ CloseDate: "2026-12-31" }`
 *
 * Both verified against a live org. The two compilers therefore share this
 * predicate but not the renderer built on it, which is exactly the trap that
 * would have shipped had the importer reused the filter value renderer.
 */
const DATE_TYPES = new Set(["Date", "DateTime"]);

export function isNumericType(dataType: string): boolean {
  return NUMERIC_TYPES.has(dataType);
}

export function isDateType(dataType: string): boolean {
  return DATE_TYPES.has(dataType);
}

export function isBooleanType(dataType: string): boolean {
  return dataType === "Boolean";
}

/** Reference types whose value is a record Id. */
export function isReferenceType(dataType: string): boolean {
  return dataType === "Reference";
}
