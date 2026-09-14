/**
 * The structured import the Data Import page produces.
 *
 * Same shape of design as the Data Export builder: a plain spec compiles one
 * way into a GraphQL document (`toMutation.ts`) and is checked one way by a
 * pure validator (`validate.ts`). Nothing parses a mutation back, so the page
 * can only express writes the compiler can produce.
 */
import type { FieldMeta, FieldMetaMap } from "../../../lib/fieldMeta";
import { COMPOUND_TYPES } from "../../../lib/fieldMeta";

export type ImportOperation = "insert" | "update";

export interface ImportSpec {
  objectApiName: string;
  operation: ImportOperation;
  /** Column headers exactly as parsed, for display and error messages. */
  headers: string[];
  /**
   * Field API name for each column, positionally. `null` means the column is
   * ignored — spreadsheets routinely carry notes and working columns, and
   * refusing to import because of one is hostile.
   */
  mapping: (string | null)[];
  rows: string[][];
}

/**
 * Salesforce rejects a mutation carrying more than 75 aliased operations
 * ("Limit of 75 reached for number of graphs in Graph Api"). Undocumented, and
 * verified live for **both** delete and create — 76 fails outright while 75
 * executes. Chunking below it rather than at it leaves headroom.
 */
export const MAX_OPERATIONS_PER_MUTATION = 75;
export const IMPORT_CHUNK_SIZE = 50;

/**
 * Upper bound on a single import.
 *
 * Not a platform limit — it is a guard against a paste that would quietly spend
 * hundreds of API calls from the org's shared daily budget. At the chunk size
 * above this is 100 calls, which is a lot but recoverable; ten times that is
 * not.
 */
export const MAX_IMPORT_ROWS = 5000;

/**
 * Covers both the FLS case and the calculated-field case, because
 * `object-info` reports them identically — an unwritable field arrives as
 * `updateable: false` whether Salesforce maintains it or the running user
 * simply isn't allowed to edit it, and nothing in the payload separates the
 * two. Naming both is honest; picking one would be a guess.
 */
const READ_ONLY =
  "read-only — a formula, roll-up, auto-number or system field, or one your field-level security doesn't let you edit";

/**
 * Why this operation can't write to a field, as a sentence fragment — or null
 * when it can.
 *
 * This is the single rule behind both the list of fields the mapper offers and
 * the explanation it gives for the ones it doesn't. Keeping them as one
 * function is the point: a field vanishing from the dropdown with no reason
 * given is exactly the confusion this is here to end, and two functions would
 * eventually disagree about which fields those are.
 *
 * `createable` and `updateable` are independent, so the four combinations are
 * genuinely different situations and get genuinely different sentences —
 * "you can set this later, just not now" is useful, and "read-only" in its
 * place would be false.
 */
export function unavailableReason(
  field: FieldMeta,
  operation: ImportOperation,
): string | null {
  if (COMPOUND_TYPES.has(field.dataType)) {
    return `a compound ${field.dataType} field — map its parts instead`;
  }
  // Id is the row key on update and is assigned by Salesforce on insert, so it
  // is offered for exactly one of the two.
  if (field.apiName === "Id") {
    return operation === "update"
      ? null
      : "assigned by Salesforce when it creates the record";
  }
  if (operation === "insert") {
    if (field.createable) return null;
    return field.updateable
      ? "not settable until the record exists — create the records first, then update them"
      : READ_ONLY;
  }
  if (field.updateable) return null;
  return field.createable
    ? "settable only at the moment the record is created"
    : READ_ONLY;
}

/** Fields a column may be mapped to, given what the operation can write. */
export function writableFields(
  fields: FieldMetaMap,
  operation: ImportOperation,
): FieldMeta[] {
  return Object.values(fields)
    .filter((field) => unavailableReason(field, operation) === null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export interface UnavailableField {
  field: FieldMeta;
  /** Why it can't be mapped, as a fragment following the field's label. */
  reason: string;
}

/**
 * The other half of `writableFields`: everything the object has that this
 * operation can't write, each with its reason.
 *
 * Shown rather than hidden because "the field isn't in the list" and "the field
 * isn't on this object" look identical from the outside, and are fixed in
 * completely different ways.
 */
export function unavailableFields(
  fields: FieldMetaMap,
  operation: ImportOperation,
): UnavailableField[] {
  const out: UnavailableField[] = [];
  for (const field of Object.values(fields)) {
    const reason = unavailableReason(field, operation);
    if (reason !== null) out.push({ field, reason });
  }
  return out.sort((a, b) => a.field.label.localeCompare(b.field.label));
}

/**
 * The object's own spelling of a hand-typed API name.
 *
 * Someone typing a field by hand types `age`, not `Age`, and the difference
 * decides whether the validator can say *"Age is read-only"* or has to fall
 * back to *"age isn't a field on Opportunity"* — the unhelpful half of the
 * answer. Unrecognised text is returned untouched so the validator still gets
 * to reject it by name.
 */
export function canonicalFieldName(
  typed: string,
  fields: FieldMetaMap,
): string {
  const trimmed = typed.trim();
  if (fields[trimmed]) return trimmed;
  const lower = trimmed.toLowerCase();
  return (
    Object.keys(fields).find((apiName) => apiName.toLowerCase() === lower) ??
    trimmed
  );
}

/** Normalize a header or field name for fuzzy matching: "Close Date" -> "closedate". */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s_]+/g, "");
}

/**
 * Index the ways a column header might name one of these fields.
 *
 * Shared by auto-mapping, which indexes the writable fields, and by the
 * mapper's "why isn't this here?" hint, which indexes the unwritable ones. The
 * two must agree on what counts as a match — otherwise a header that
 * auto-mapping recognised could come back as unrecognised when the operation
 * changes, which is precisely when the user needs the explanation.
 */
function nameIndex(candidates: FieldMeta[]): (header: string) => string | null {
  const byApiName = new Map(candidates.map((f) => [f.apiName, f.apiName]));
  const byLabel = new Map<string, string>();
  const byNormalized = new Map<string, string>();
  for (const field of candidates) {
    // First writer wins: two fields can share a label ("Owner"), and the one
    // that sorts first is at least deterministic.
    if (!byLabel.has(field.label)) byLabel.set(field.label, field.apiName);
    for (const key of [normalize(field.apiName), normalize(field.label)]) {
      if (!byNormalized.has(key)) byNormalized.set(key, field.apiName);
    }
  }

  return (header: string) => {
    const trimmed = header.trim();
    return (
      byApiName.get(trimmed) ??
      byLabel.get(trimmed) ??
      byNormalized.get(normalize(trimmed)) ??
      null
    );
  };
}

/** Which of `candidates` a header names, or null. Same rules as auto-mapping. */
export function matchHeader(
  header: string,
  candidates: FieldMeta[],
): FieldMeta | null {
  const apiName = nameIndex(candidates)(header);
  return apiName === null
    ? null
    : (candidates.find((f) => f.apiName === apiName) ?? null);
}

/**
 * Guess which field each column means.
 *
 * Tried in descending order of confidence: exact API name, exact label, then
 * both again ignoring case, spaces and underscores. That last pass is what
 * makes a hand-typed "close date" or "Account_Id" land, which is the common
 * case for a spreadsheet someone built by hand rather than exported.
 *
 * A column that matches nothing is left unmapped rather than guessed at — a
 * wrong guess writes real data to the wrong field.
 */
export function autoMapColumns(
  headers: string[],
  fields: FieldMetaMap,
  operation: ImportOperation,
): (string | null)[] {
  const lookup = nameIndex(writableFields(fields, operation));

  const used = new Set<string>();
  return headers.map((header) => {
    const match = lookup(header);
    // The same field must not be mapped twice — the compiler would emit a
    // duplicate key and Salesforce would reject the whole document.
    if (!match || used.has(match)) return null;
    used.add(match);
    return match;
  });
}

/** Column indexes that carry a field, paired with that field's metadata. */
export function mappedColumns(
  spec: ImportSpec,
  fields: FieldMetaMap,
): { column: number; field: string; meta: FieldMeta | undefined }[] {
  const out: { column: number; field: string; meta: FieldMeta | undefined }[] =
    [];
  spec.mapping.forEach((field, column) => {
    if (field) out.push({ column, field, meta: fields[field] });
  });
  return out;
}

export function emptySpec(objectApiName = ""): ImportSpec {
  return {
    objectApiName,
    operation: "insert",
    headers: [],
    mapping: [],
    rows: [],
  };
}
