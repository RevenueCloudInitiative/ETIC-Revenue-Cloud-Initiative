/**
 * ImportSpec -> aliased GraphQL create/update mutation.
 *
 * Structurally the same trick as `toDeleteMutation`: Salesforce exposes one
 * `{Object}Create` / `{Object}Update` field per object, so writing many records
 * in one request means GraphQL aliases. That is the difference between an
 * import of 500 rows costing 10 API calls and costing 500.
 *
 * **Write literals are bare scalars, and that is not what a filter uses.** The
 * `*CreateRepresentation` input types take `CloseDate: Date`, `Amount: Currency`,
 * `AccountId: IdOrRef` — plain values — while `{Object}_Filter` takes
 * `{ CloseDate: { gte: { value: "…" } } }`. Reusing the filter renderer here
 * would have produced documents Salesforce rejects, so this file has its own.
 * Both forms verified against a live org.
 * https://developer.salesforce.com/docs/platform/graphql/guide/mutations-create.html
 */
import {
  isBooleanType,
  isDateType,
  isNumericType,
  type FieldMetaMap,
} from "../../../lib/fieldMeta";
import { parseNumericCell } from "./numberFix";
import { parseBooleanCell } from "./validate";
import {
  mappedColumns,
  IMPORT_CHUNK_SIZE,
  MAX_OPERATIONS_PER_MUTATION,
  type ImportSpec,
} from "./types";

/**
 * GraphQL string literals escape exactly like JSON, so `JSON.stringify` is the
 * correct escaper — it covers quotes, backslashes and control characters.
 * Hand-rolling this is how injection bugs get written.
 */
function gqlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Render one cell in the form its field's input type expects.
 *
 * Returns `null` when the value can't be rendered, which only happens for input
 * the validator would already have blocked — the compiler is not the place to
 * report data problems, so it renders defensively rather than throwing.
 */
export function renderInputLiteral(
  raw: string,
  dataType: string,
): string | null {
  const value = raw.trim();

  if (isBooleanType(dataType)) {
    const parsed = parseBooleanCell(value);
    return parsed === null ? null : String(parsed);
  }

  if (isNumericType(dataType)) {
    // Spreadsheets export "1,234.50" and "$1,234.50"; the number underneath is
    // what Salesforce wants. Read by the shared reader rather than a local
    // regex — `numberFix.ts` explains why the second copy of that regex, in
    // `validate.ts`, made a silent hundred-fold error invisible.
    const parsed = parseNumericCell(value);
    return parsed === null ? null : String(parsed);
  }

  // Dates are quoted strings here, *not* the `{ value: "…" }` object a filter
  // takes. The validator has already enforced ISO form.
  if (isDateType(dataType)) return gqlString(value);

  return gqlString(value);
}

export interface CompiledImport {
  document: string;
  /** Alias -> the row index it came from, so results can name the right row. */
  aliases: Record<string, number>;
}

/**
 * Split row indexes into batches below the 75-operation ceiling.
 *
 * Takes indexes rather than rows so a batch can always be mapped back to the
 * user's original row numbers, including after the validator has removed
 * blocked rows from the middle of the file.
 */
export function chunkRows(
  rowIndexes: number[],
  size = IMPORT_CHUNK_SIZE,
): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < rowIndexes.length; i += size) {
    chunks.push(rowIndexes.slice(i, i + size));
  }
  return chunks;
}

/**
 * Build the field assignments for one row.
 *
 * Blank cells are the one place insert and update must disagree:
 *
 * - **insert** omits the field, so Salesforce's own default value and required
 *   -field rules apply, exactly as they would in the UI.
 * - **update** sends an explicit `null`, which clears the field. Verified live:
 *   `Description: null` on an update empties it, while omitting the key leaves
 *   the existing value untouched.
 *
 * Anything else would make one of the two operations impossible to express —
 * you could never clear a field, or you could never take a default.
 *
 * `allowed` narrows the row to the columns the user edited (see `scope.ts`).
 * The blank rule still applies inside it: an edited cell emptied on purpose is
 * how you clear one field without touching the rest of the record.
 */
function fieldAssignments(
  spec: ImportSpec,
  fields: FieldMetaMap,
  rowIndex: number,
  allowed: ReadonlySet<number> | undefined,
): string[] {
  const row = spec.rows[rowIndex] ?? [];
  const out: string[] = [];

  for (const { column, field, meta } of mappedColumns(spec, fields)) {
    // Id is the mutation's own argument on update, never a field assignment.
    if (field === "Id") continue;
    if (!meta) continue;
    if (allowed && !allowed.has(column)) continue;

    const raw = row[column] ?? "";
    if (raw.trim() === "") {
      if (spec.operation === "update") out.push(`${field}: null`);
      continue;
    }

    const literal = renderInputLiteral(raw, meta.dataType);
    if (literal !== null) out.push(`${field}: ${literal}`);
  }

  return out;
}

export function toImportMutation(
  spec: ImportSpec,
  fields: FieldMetaMap,
  rowIndexes: number[],
  /**
   * Per-row column restriction from a narrowed run. Omitted — the ordinary
   * case — writes every mapped column.
   *
   * Rows are expected to arrive with at least one writable column each;
   * `planImport` guarantees that, and a row with none would compile to an
   * update that assigns nothing.
   */
  columnsByRow?: ReadonlyMap<number, ReadonlySet<number>> | null,
): CompiledImport {
  if (!spec.objectApiName) {
    throw new Error("Choose an object before importing.");
  }
  if (rowIndexes.length === 0) {
    throw new Error("There are no rows to import.");
  }
  if (rowIndexes.length > MAX_OPERATIONS_PER_MUTATION) {
    // Callers chunk with `chunkRows`; reaching here means a caller didn't.
    throw new Error(
      `A mutation can carry at most ${MAX_OPERATIONS_PER_MUTATION} operations; got ${rowIndexes.length}.`,
    );
  }

  const idColumn = spec.mapping.indexOf("Id");
  const aliases: Record<string, number> = {};

  const operations = rowIndexes.map((rowIndex, position) => {
    const alias = `r${position}`;
    aliases[alias] = rowIndex;
    const assignments = fieldAssignments(
      spec,
      fields,
      rowIndex,
      columnsByRow?.get(rowIndex),
    );
    const body = `${spec.objectApiName}: { ${assignments.join(", ")} }`;

    if (spec.operation === "update") {
      const id = (spec.rows[rowIndex]?.[idColumn] ?? "").trim();
      return `    ${alias}: ${spec.objectApiName}Update(input: { Id: ${gqlString(id)}, ${body} }) { success Record { Id } }`;
    }
    return `    ${alias}: ${spec.objectApiName}Create(input: { ${body} }) { Record { Id } }`;
  });

  // `allOrNone: false` so one bad row doesn't roll back the batch. Verified
  // live: the successful aliases genuinely commit, and the failed ones come
  // back null alongside an error naming them.
  const document = `mutation DataImport${spec.operation === "update" ? "Update" : "Insert"} {
  uiapi(input: { allOrNone: false }) {
${operations.join("\n")}
  }
}`;

  return { document, aliases };
}
