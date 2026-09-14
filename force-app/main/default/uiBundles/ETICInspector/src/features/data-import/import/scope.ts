/**
 * How much of the table a run actually writes.
 *
 * The page's default is every ready row and every mapped column, which is the
 * right default for a file you pasted in order to import. It is the wrong one
 * for the other way this page gets used: paste an export, fix three cells,
 * write back. Sending all 500 rows there re-writes 497 records with values they
 * already hold — which costs API calls, fires workflow, bumps
 * `LastModifiedDate` on records nobody touched, and buries the three real
 * changes in the results.
 *
 * So the run can be narrowed to what the user changed, at two granularities:
 *
 * - **`editedRows`** — only rows with at least one edited cell, writing every
 *   mapped column of those rows. This is the only narrowing an insert can have:
 *   a create needs all its fields, so "only the edited fields" would mean
 *   creating records with one column filled in.
 * - **`editedCells`** — update only. Rows with at least one edited cell, each
 *   writing *only* the columns edited in that row. This is the precise version:
 *   the three corrections go back and nothing else moves.
 *
 * ## An unmapped column is not an edit
 *
 * Edits are counted only in columns that are actually mapped to a field.
 * Correcting a typo in a "Notes" column that isn't being imported doesn't
 * change what would be written, so treating it as an edit would pull the row
 * into the run and write cells the user never touched — the exact outcome
 * narrowing exists to avoid.
 *
 * ## Under `editedCells`, a row is judged on the cells it sends
 *
 * The validator reports every problem in the file, which is right — the grid
 * should show them all. But a row whose only error sits in a column this run
 * will not write is perfectly sendable, and blocking it would leave the user
 * staring at a cell they just fixed, unable to send it because of a different
 * cell that isn't going anywhere. `Id` is the exception and is always checked:
 * it is the mutation's key, so it goes with every row whether it was edited or
 * not.
 */
import type { ValidationReport } from "./validate";
import { mappedColumns, type ImportOperation, type ImportSpec } from "./types";
import { editedColumnsByRow, type EditMap } from "./edits";
import type { FieldMetaMap } from "../../../lib/fieldMeta";

export type ImportScope = "all" | "editedRows" | "editedCells";

export interface ImportPlan {
  /** Rows to send, ascending. */
  rowIndexes: number[];
  /**
   * The columns each row may write, when the run is narrowed to edited cells.
   *
   * `null` — the ordinary case — means every mapped column, and is what keeps
   * the compiler's normal path untouched rather than making every import go
   * through a filter it doesn't need.
   */
  columnsByRow: ReadonlyMap<number, ReadonlySet<number>> | null;
}

/** Nothing to write. Not exported — a caller wanting this wants `planImport`. */
const EMPTY_PLAN: ImportPlan = { rowIndexes: [], columnsByRow: null };

/**
 * The scope that actually applies.
 *
 * `editedCells` is meaningless for an insert, and a stale selection left over
 * from switching the operation must not silently become "create records with
 * one field set".
 */
export function effectiveScope(
  scope: ImportScope,
  operation: ImportOperation,
): ImportScope {
  if (scope === "editedCells" && operation === "insert") return "editedRows";
  return scope;
}

/** Column indexes carrying a real field, split by whether they are the key. */
function writableColumns(
  spec: ImportSpec,
  fields: FieldMetaMap,
): { value: Set<number>; idColumn: number } {
  const value = new Set<number>();
  let idColumn = -1;
  for (const { column, field, meta } of mappedColumns(spec, fields)) {
    if (!meta) continue;
    if (field === "Id") idColumn = column;
    else value.add(column);
  }
  return { value, idColumn };
}

/**
 * Which rows and columns a run writes, given the scope the user chose.
 *
 * Pure, and derived from the validation report rather than re-deriving what is
 * valid — one validator, one answer about what is broken.
 */
export function planImport(
  spec: ImportSpec,
  fields: FieldMetaMap,
  report: ValidationReport,
  edits: EditMap,
  scope: ImportScope,
): ImportPlan {
  // A broken mapping applies to every row, so no scope can rescue any of them.
  if (report.mappingErrors.length > 0) return EMPTY_PLAN;

  const applied = effectiveScope(scope, spec.operation);
  if (applied === "all") {
    return { rowIndexes: report.readyRows, columnsByRow: null };
  }

  const { value: valueColumns, idColumn } = writableColumns(spec, fields);
  const editedByRow = editedColumnsByRow(edits);

  /** Edited columns that this operation would actually write, per row. */
  const writesByRow = new Map<number, Set<number>>();
  for (const [row, columns] of editedByRow) {
    if (row >= spec.rows.length) continue;
    const writes = new Set<number>();
    for (const column of columns) {
      if (valueColumns.has(column)) writes.add(column);
    }
    if (writes.size > 0) writesByRow.set(row, writes);
  }

  if (applied === "editedRows") {
    return {
      rowIndexes: report.readyRows.filter((row) => writesByRow.has(row)),
      columnsByRow: null,
    };
  }

  // editedCells: judge each row on the cells it is about to send.
  const errorColumnsByRow = new Map<number, Set<number>>();
  for (const issue of report.issues) {
    if (issue.row < 0 || issue.level !== "error") continue;
    const columns = errorColumnsByRow.get(issue.row);
    if (columns) columns.add(issue.column);
    else errorColumnsByRow.set(issue.row, new Set([issue.column]));
  }

  const rowIndexes: number[] = [];
  const columnsByRow = new Map<number, ReadonlySet<number>>();
  for (const [row, writes] of [...writesByRow].sort((a, b) => a[0] - b[0])) {
    const errors = errorColumnsByRow.get(row);
    if (errors) {
      // A row-level error (column -1) has no cell to exclude it from, and a bad
      // Id can't be worked around — the key goes with every row.
      if (errors.has(-1) || (idColumn >= 0 && errors.has(idColumn))) continue;
      if ([...writes].some((column) => errors.has(column))) continue;
    }
    rowIndexes.push(row);
    columnsByRow.set(row, writes);
  }

  return { rowIndexes, columnsByRow };
}

/**
 * The distinct fields a plan writes, in mapped order, excluding `Id`.
 *
 * These are the columns of the before/after report an update produces, so they
 * have to follow the narrowing: reading back a field the run never wrote would
 * pad the report with rows that could only ever say "unchanged".
 */
export function planFields(
  spec: ImportSpec,
  fields: FieldMetaMap,
  plan: ImportPlan,
): string[] {
  const wanted = plan.columnsByRow
    ? new Set(
        plan.rowIndexes.flatMap((row) => [
          ...(plan.columnsByRow?.get(row) ?? []),
        ]),
      )
    : null;

  const out: string[] = [];
  for (const { column, field, meta } of mappedColumns(spec, fields)) {
    if (field === "Id" || !meta) continue;
    if (wanted && !wanted.has(column)) continue;
    if (!out.includes(field)) out.push(field);
  }
  return out;
}

/** How many cells a plan writes — the number the scope control counts. */
export function planCellCount(
  spec: ImportSpec,
  fields: FieldMetaMap,
  plan: ImportPlan,
): number {
  if (plan.columnsByRow) {
    let total = 0;
    for (const row of plan.rowIndexes) {
      total += plan.columnsByRow.get(row)?.size ?? 0;
    }
    return total;
  }
  const { value } = writableColumns(spec, fields);
  return plan.rowIndexes.length * value.size;
}
