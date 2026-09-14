/**
 * What an update actually did, field by field.
 *
 * "12 records updated" is true and almost useless — it doesn't say whether the
 * import changed what you meant it to, whether it changed anything at all, or
 * whether a value landed in a different shape than you typed. This module turns
 * two snapshots of the same records into that answer.
 *
 * Pure on purpose. The two snapshots are read by `api/dataImport.ts`; comparing
 * them involves no I/O and no API cost, so it is testable without a live org and
 * cheap to run over a few thousand rows.
 *
 * **Comparison is on `displayValue`, not the raw value**, because that is what
 * both the grid and the org show a person. It also sidesteps a class of false
 * positives: the same currency read back as `125000` and `125000.0` is one
 * change to `===` on raw numbers and no change at all to a reader.
 */

export interface FieldChange {
  field: string;
  /** Formatted value before the import ran. */
  before: string;
  /** Formatted value after it ran. */
  after: string;
}

export interface RecordChanges {
  /** The user's row, so the report lines up with the grid they were editing. */
  rowIndex: number;
  id: string;
  changes: FieldChange[];
}

export interface ChangeReport {
  changed: RecordChanges[];
  /**
   * Records that were updated successfully and came back identical.
   *
   * Not a failure, and worth stating rather than hiding: re-running the same
   * import is the usual cause, and a run that reports "40 updated, 40 with no
   * change" has told you something real.
   */
  unchanged: number;
  /**
   * Records the comparison couldn't cover — one of the two reads didn't return
   * them.
   *
   * Counted rather than silently folded into `unchanged`, because "nothing
   * changed" and "we don't know" are different claims and only one of them is
   * safe to make.
   */
  unread: number;
}

/** One record's values, keyed by field API name, already formatted for display. */
export type ValueSnapshot = Map<string, Record<string, string>>;

/**
 * Compare two snapshots of the same records.
 *
 * `fields` is the set the import wrote — comparing anything else would report
 * changes this import didn't make, which on an active org it certainly would.
 */
export function diffSnapshots(
  rows: { rowIndex: number; id: string }[],
  before: ValueSnapshot,
  after: ValueSnapshot,
  fields: string[],
): ChangeReport {
  const changed: RecordChanges[] = [];
  let unchanged = 0;
  let unread = 0;

  for (const row of rows) {
    const was = before.get(row.id);
    const now = after.get(row.id);
    if (!was || !now) {
      unread++;
      continue;
    }

    const changes: FieldChange[] = [];
    for (const field of fields) {
      const previous = was[field] ?? "";
      const current = now[field] ?? "";
      if (previous !== current) {
        changes.push({ field, before: previous, after: current });
      }
    }

    if (changes.length === 0) unchanged++;
    else changed.push({ rowIndex: row.rowIndex, id: row.id, changes });
  }

  return { changed, unchanged, unread };
}

/** Every field that changed anywhere, in the order the import wrote them. */
export function changedFields(
  report: ChangeReport,
  fields: string[],
): string[] {
  const seen = new Set<string>();
  for (const record of report.changed) {
    for (const change of record.changes) seen.add(change.field);
  }
  return fields.filter((field) => seen.has(field));
}
