/**
 * Which cells the user has changed since the data was pasted.
 *
 * ## What is stored, and why it isn't just a set of coordinates
 *
 * An `EditMap` holds **the original value** of every changed cell, keyed by
 * position — not merely the fact that the cell was touched. That buys two
 * things a `Set` could not:
 *
 * - **Typing a value back the way it was un-marks it.** A cell that reads
 *   exactly what it read when it was pasted is not a change, and highlighting
 *   it as one would put it in the "only what I edited" run.
 * - **The grid can say what it was.** `Edited — was "9000"` next to the cell is
 *   the whole reason to look at a highlight, and it costs nothing extra once
 *   the original is already here.
 *
 * Only changed cells are stored, so the map stays proportional to the work
 * done rather than to the size of the paste — a 5,000-row file with three
 * corrections holds three entries.
 *
 * ## Row indexes move
 *
 * Keys embed the row index, and deleting a row renumbers every row beneath it.
 * `shiftEditsForDeletedRow` is not optional bookkeeping: without it, deleting
 * row 1 silently reassigns row 2's edits to row 3, and the import would then
 * write the wrong cells to the wrong records.
 */

/** Cell position -> the value that cell held when the data was pasted. */
export type EditMap = ReadonlyMap<string, string>;

export const NO_EDITS: EditMap = new Map<string, string>();

export function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

/**
 * Fold one cell edit in.
 *
 * Returns the same map when nothing about the tracking changed, so an edit to
 * an already-tracked cell doesn't allocate a new identity and re-render every
 * memoized row in the grid.
 */
export function recordEdit(
  edits: EditMap,
  row: number,
  column: number,
  /** What the cell held immediately before this edit. */
  previous: string,
  next: string,
): EditMap {
  const key = cellKey(row, column);
  const tracked = edits.get(key);
  // The first edit of a cell is the one that establishes what "original"
  // means; later edits keep the value already recorded.
  const original = tracked !== undefined ? tracked : previous;

  if (original === next) {
    if (tracked === undefined) return edits;
    const out = new Map(edits);
    out.delete(key);
    return out;
  }

  if (tracked !== undefined) return edits;
  const out = new Map(edits);
  out.set(key, original);
  return out;
}

/**
 * Fold in a whole-table rewrite — what the bulk date and number fixes do.
 *
 * Compares row identities first, which is why those passes are careful to
 * return the same array for a row they didn't touch: a 5,000-row file where
 * one column was cleaned then costs one comparison per untouched row rather
 * than one per cell.
 */
export function recordRewrite(
  edits: EditMap,
  before: readonly string[][],
  after: readonly string[][],
): EditMap {
  let out: Map<string, string> | null = null;
  const write = (key: string, original: string) => {
    out ??= new Map(edits);
    out.set(key, original);
  };
  const erase = (key: string) => {
    out ??= new Map(edits);
    out.delete(key);
  };

  after.forEach((row, rowIndex) => {
    const was = before[rowIndex];
    if (!was || was === row) return;
    const width = Math.max(was.length, row.length);
    for (let column = 0; column < width; column++) {
      const from = was[column] ?? "";
      const to = row[column] ?? "";
      if (from === to) continue;
      const key = cellKey(rowIndex, column);
      const tracked = edits.get(key);
      const original = tracked !== undefined ? tracked : from;
      if (original === to) {
        if (tracked !== undefined) erase(key);
      } else if (tracked === undefined) {
        write(key, original);
      }
    }
  });

  return out ?? edits;
}

/** Renumber the tracking after a row is removed from the middle of the table. */
export function shiftEditsForDeletedRow(
  edits: EditMap,
  deletedRow: number,
): EditMap {
  if (edits.size === 0) return edits;
  const out = new Map<string, string>();
  for (const [key, original] of edits) {
    const [row, column] = key.split(":").map(Number);
    if (row === deletedRow) continue;
    out.set(cellKey(row > deletedRow ? row - 1 : row, column), original);
  }
  return out;
}

/** Edited columns for one row, keyed by row index. Empty rows are absent. */
export function editedColumnsByRow(edits: EditMap): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const key of edits.keys()) {
    const [row, column] = key.split(":").map(Number);
    const columns = out.get(row);
    if (columns) columns.add(column);
    else out.set(row, new Set([column]));
  }
  return out;
}

/**
 * Every edited row's original values, serialized as `{ column: value }`.
 *
 * Serialized because `GridRow` is memoized on primitives: handing it a `Map`
 * would allocate a new identity every render and defeat the memo, which is the
 * same reasoning behind the existing `badColumns` string.
 *
 * Built for the whole table in one pass rather than per row on demand. Asking
 * "what did row N change?" 200 times costs `rows × columns` map lookups — 10,000
 * on a 50-column file — to answer a question the edit map can answer in
 * `edits.size` steps. Rows with no edits are simply absent, and the grid reads
 * `?? ""`.
 */
export function originalsByRow(edits: EditMap): Map<number, string> {
  const grouped = new Map<number, Record<number, string>>();
  for (const [key, original] of edits) {
    const [row, column] = key.split(":").map(Number);
    const columns = grouped.get(row);
    if (columns) columns[column] = original;
    else grouped.set(row, { [column]: original });
  }
  const out = new Map<number, string>();
  for (const [row, columns] of grouped) out.set(row, JSON.stringify(columns));
  return out;
}

/** Read back what `originalsByRow` wrote. */
export function parseOriginals(serialized: string): Record<number, string> {
  if (serialized === "") return {};
  return JSON.parse(serialized) as Record<number, string>;
}

/**
 * Put one row back the way it was pasted.
 *
 * Returns both halves of the change, because they have to move together: the
 * restored cells, and the edit map with that row's entries dropped. Doing it as
 * a sequence of `recordEdit` calls would work — each cell would prune itself on
 * reaching its original — but it would also walk the map once per cell and
 * leave the row half-reverted if any step were skipped.
 */
export function revertRow(
  edits: EditMap,
  row: readonly string[],
  rowIndex: number,
): { row: string[]; edits: EditMap } | null {
  const restored = [...row];
  let touched = false;
  const remaining = new Map(edits);

  for (const [key, original] of edits) {
    const [editRow, column] = key.split(":").map(Number);
    if (editRow !== rowIndex) continue;
    remaining.delete(key);
    // A column past the end of a ragged row has nothing to restore into, but
    // its tracking still goes — otherwise the row would never look clean.
    if (column < restored.length) {
      restored[column] = original;
      touched = true;
    }
  }

  if (remaining.size === edits.size) return null;
  return { row: touched ? restored : [...row], edits: remaining };
}
