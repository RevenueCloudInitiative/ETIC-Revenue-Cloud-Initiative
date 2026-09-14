import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  PencilLine,
  Scissors,
  Sigma,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import { memo, useMemo, useState, type ReactNode } from "react";
import {
  isPicklistType,
  optionsFor,
  type PicklistMap,
  type PicklistValue,
} from "../../../api/picklists";
import { PicklistCell } from "./PicklistCell";
import {
  TableScroller,
  stickyHeaderCell,
} from "../../../components/TableScroller";
import {
  isDateType,
  isNumericType,
  type FieldMetaMap,
} from "../../../lib/fieldMeta";
import {
  DATE_ORDER_LABELS,
  toIsoDate,
  type DateOrder,
} from "../import/dateFix";
import {
  DECIMAL_LABELS,
  isAmbiguousNumber,
  toPlainNumber,
  toSalvagedNumber,
  type DecimalSeparator,
  type NumberFixMode,
} from "../import/numberFix";
import { originalsByRow, parseOriginals, type EditMap } from "../import/edits";
import type { ImportSpec } from "../import/types";
import { issuesByRow, type ValidationReport } from "../import/validate";
import { sectionLabel } from "../../../components/sectionLabel";

interface DataGridProps {
  spec: ImportSpec;
  report: ValidationReport;
  fields: FieldMetaMap;
  picklists: PicklistMap;
  /** Cells changed since the data was pasted, with what they used to hold. */
  edits: EditMap;
  onCellChange: (row: number, column: number, value: string) => void;
  onDeleteRow: (row: number) => void;
  /** Puts every changed cell in one row back the way it was pasted. */
  onRevertRow: (row: number) => void;
  /** Applies a whole-column date conversion in one edit. */
  onFixDates: (order: DateOrder) => void;
  /** Applies a whole-column numeric clean-up in one edit. */
  onFixNumbers: (decimal: DecimalSeparator, mode: NumberFixMode) => void;
}

/**
 * Chrome for the whole-column fix offers.
 *
 * Three of these can sit above the grid, and they must not drift apart — one
 * styled slightly differently reads as a different *kind* of message rather than
 * as the same offer about a different problem. The controls differ, so they come
 * in as children; everything around them is fixed here.
 *
 * `tone` is the one deliberate difference. Two of the offers only reformat
 * values that are already valid; the third reaches into cells that aren't
 * numbers at all and pulls a number out. That one is worth a second look before
 * pressing, and amber is how the rest of the app says so.
 */
function BulkFix({
  icon,
  tone = "info",
  children,
}: {
  icon: ReactNode;
  tone?: "info" | "caution";
  children: ReactNode;
}) {
  const palette =
    tone === "caution"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
      : "border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-200";
  return (
    <div
      className={`mb-2 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs ${palette}`}
    >
      {icon}
      {children}
    </div>
  );
}

const FIX_SELECT_CLASS =
  "border-border bg-background text-foreground cursor-pointer rounded border px-1.5 py-0.5 text-xs";
const FIX_BUTTON_CLASS =
  "bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer rounded px-2 py-0.5 font-medium";

/**
 * How many rows to mount. A 5,000-row import is legitimate; 5,000 rows of live
 * inputs is not, and nobody scrolls that far to fix a cell. The counts in the
 * header cover the whole file, so nothing is hidden — only unrendered.
 */
const MAX_VISIBLE_ROWS = 200;

/**
 * Editable view of the pasted data.
 *
 * The paste box is how data gets *in*; this is how it gets *looked at*. Text in
 * a textarea gives you no idea which cell Salesforce is going to reject, so the
 * same rows are shown as a grid with the failing cells outlined and the reason
 * beside them — and, because the reason is usually a one-character fix, the
 * cells are editable rather than read-only. Correcting a date here beats going
 * back to the spreadsheet, re-exporting and re-pasting.
 *
 * Rows are the authoritative state once parsed; edits mutate them directly and
 * are never round-tripped back through the delimited text. That is deliberate —
 * re-serializing would have to re-apply the spreadsheet formula guard, so a cell
 * containing `'-5` would gain and lose apostrophes on every keystroke.
 */
const GridRow = memo(function GridRow({
  rowIndex,
  cells,
  columns,
  worst,
  badColumns,
  originals,
  messages,
  picklistColumns,
  onCellChange,
  onDeleteRow,
  onRevertRow,
}: {
  rowIndex: number;
  cells: string[];
  columns: number[];
  worst: "error" | "warning" | null;
  /** Comma-joined column indexes with a problem — a primitive, so memo holds. */
  badColumns: string;
  /**
   * JSON of `{ column: valueBeforeTheEdit }` for this row, or `""`.
   *
   * A primitive for the same reason as `badColumns`: this component is
   * memoized, and a `Map` or an object literal would allocate a new identity on
   * every parent render and defeat it.
   */
  originals: string;
  messages: string;
  /** Column index -> its picklist, for columns mapped to a picklist field. */
  picklistColumns: Record<number, { options: PicklistValue[]; multi: boolean }>;
  onCellChange: (row: number, column: number, value: string) => void;
  onDeleteRow: (row: number) => void;
  onRevertRow: (row: number) => void;
}) {
  const bad = new Set(
    badColumns === "" ? [] : badColumns.split(",").map(Number),
  );
  const wasBefore = parseOriginals(originals);

  return (
    <tr className={worst === "error" ? "bg-destructive/5" : undefined}>
      <td className="text-muted-foreground border-border/60 border-b px-2 py-1 text-right align-middle font-mono text-[11px]">
        {rowIndex + 1}
      </td>
      <td className="border-border/60 border-b px-1 py-1 align-middle">
        {worst === "error" ? (
          <XCircle
            className="text-destructive h-3.5 w-3.5"
            aria-label="Blocked"
          />
        ) : worst === "warning" ? (
          <AlertTriangle
            className="h-3.5 w-3.5 text-warning"
            aria-label="Warning"
          />
        ) : (
          <CheckCircle2
            className="h-3.5 w-3.5 text-success"
            aria-label="Ready"
          />
        )}
      </td>

      {columns.map((column) => {
        const original = wasBefore[column];
        const edited = original !== undefined;
        const label = edited
          ? `Row ${rowIndex + 1}, column ${column + 1}, edited, was ${
              original === "" ? "empty" : original
            }`
          : `Row ${rowIndex + 1}, column ${column + 1}`;

        return (
          <td
            key={column}
            className={`border-border/60 border-b p-0 align-top ${
              edited ? "bg-sky-500/10" : ""
            }`}
          >
            {picklistColumns[column] ? (
              <PicklistCell
                value={cells[column] ?? ""}
                options={picklistColumns[column].options}
                multi={picklistColumns[column].multi}
                ariaLabel={label}
                onChange={(next) => onCellChange(rowIndex, column, next)}
              />
            ) : (
              <input
                value={cells[column] ?? ""}
                onChange={(e) => onCellChange(rowIndex, column, e.target.value)}
                spellCheck={false}
                aria-label={label}
                className={`w-full min-w-[8rem] bg-transparent px-2 py-1 font-mono text-xs outline-none focus:bg-background focus:ring-1 ${
                  bad.has(column)
                    ? "text-destructive ring-destructive/40 ring-1"
                    : "text-foreground focus:ring-ring/30"
                }`}
              />
            )}
            {/*
              On the page rather than in a `title`. The old value is the whole
              point of marking the cell, and a tooltip hides it behind a hover
              nobody performs on a grid they are scanning — and not at all on a
              touch screen. It costs a line only in the cells that changed.
            */}
            {edited && (
              <span className="text-muted-foreground block truncate px-2 pb-1 font-mono text-[10px]">
                was{" "}
                {original === "" ? (
                  <em className="not-italic opacity-70">empty</em>
                ) : (
                  <span className="line-through">{original}</span>
                )}
              </span>
            )}
          </td>
        );
      })}

      <td className="border-border/60 max-w-[22rem] border-b px-2 py-1 align-middle text-xs">
        {messages && (
          <span
            className={worst === "error" ? "text-destructive" : "text-warning"}
          >
            {messages}
          </span>
        )}
      </td>

      <td className="border-border/60 border-b px-1 py-1 align-top">
        <div className="flex items-center gap-0.5">
          {/*
            Only on rows that changed, and it puts back every cell in the row
            at once — the alternative is retyping values you can see but can no
            longer remember exactly, which is precisely what the originals are
            being kept for.
          */}
          {originals !== "" && (
            <button
              type="button"
              onClick={() => onRevertRow(rowIndex)}
              aria-label={`Undo the changes in row ${rowIndex + 1}`}
              className="cursor-pointer rounded p-1 text-sky-700 hover:bg-sky-500/10 dark:text-sky-300"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onDeleteRow(rowIndex)}
            aria-label={`Remove row ${rowIndex + 1}`}
            className="text-muted-foreground hover:text-destructive cursor-pointer rounded p-1"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
});

export function DataGrid({
  spec,
  report,
  fields,
  picklists,
  edits,
  onCellChange,
  onDeleteRow,
  onRevertRow,
  onFixDates,
  onFixNumbers,
}: DataGridProps) {
  const byRow = useMemo(() => issuesByRow(report), [report]);
  // Grouped once for the whole table rather than asked per row — see the note
  // on `originalsByRow`.
  const originals = useMemo(() => originalsByRow(edits), [edits]);
  const [dateOrder, setDateOrder] = useState<DateOrder>("MDY");
  const [decimal, setDecimal] = useState<DecimalSeparator>(".");

  /**
   * The picklist behind each mapped column, resolved once rather than per cell
   * — a 200-row grid would otherwise rebuild the same option list 200 times.
   *
   * `optionsFor` is the same helper the other two picklist screens use, so a
   * dependent picklist narrows here exactly as it does elsewhere.
   */
  const picklistColumns = useMemo(() => {
    const out: Record<number, { options: PicklistValue[]; multi: boolean }> =
      {};
    spec.mapping.forEach((field, column) => {
      if (!field) return;
      const meta = fields[field];
      if (!meta || !isPicklistType(meta.dataType)) return;
      const picklist = picklists[field];
      if (!picklist || picklist.values.length === 0) return;
      out[column] = {
        options: optionsFor(picklist),
        multi: meta.dataType === "MultiPicklist",
      };
    });
    return out;
  }, [spec.mapping, fields, picklists]);

  /**
   * How many cells a bulk date conversion would actually fix.
   *
   * Counted rather than assumed, so the offer only appears when it would do
   * something — and so the button can say how much.
   */
  const fixableDates = useMemo(() => {
    let count = 0;
    let ambiguous = false;
    spec.mapping.forEach((field, column) => {
      if (!field) return;
      const meta = fields[field];
      if (!meta || !isDateType(meta.dataType)) return;
      for (const row of spec.rows) {
        const raw = row[column] ?? "";
        if (raw.trim() === "") continue;
        const asMdy = toIsoDate(
          raw,
          "MDY",
          meta.dataType as "Date" | "DateTime",
        );
        const asDmy = toIsoDate(
          raw,
          "DMY",
          meta.dataType as "Date" | "DateTime",
        );
        if (asMdy === null && asDmy === null) continue;
        count++;
        if (asMdy !== null && asDmy !== null && asMdy !== asDmy)
          ambiguous = true;
      }
    });
    return { count, ambiguous };
  }, [spec.mapping, spec.rows, fields]);

  /**
   * How many numeric cells carry formatting Salesforce won't take — `$1,200.50`,
   * `(1,200)`, `45%`, or the non-breaking space Excel puts after a currency
   * symbol.
   *
   * `ambiguous` is much rarer here than for dates: only a lone separator with
   * exactly three digits after it (`1,234`) reads differently depending on the
   * convention, and everything else is settled by the text itself. So the
   * question is asked only when it changes an answer, and the common case stays
   * a single button.
   */
  const fixableNumbers = useMemo(() => {
    let count = 0;
    let ambiguous = false;
    spec.mapping.forEach((field, column) => {
      if (!field) return;
      const meta = fields[field];
      if (!meta || !isNumericType(meta.dataType)) return;
      for (const row of spec.rows) {
        const raw = row[column] ?? "";
        if (raw.trim() === "") continue;
        if (
          toPlainNumber(raw, ".") === null &&
          toPlainNumber(raw, ",") === null
        )
          continue;
        count++;
        if (isAmbiguousNumber(raw)) ambiguous = true;
      }
    });
    return { count, ambiguous };
  }, [spec.mapping, spec.rows, fields]);

  /**
   * Cells in a numeric column that aren't numbers but contain exactly one.
   *
   * A concrete example beats a generic one here — "12abc" tells you nothing
   * about *your* data, while showing the first real cell and what it would
   * become is enough to judge the offer without pressing it. That matters more
   * for this button than the others, because the honest reading of a full column
   * of these is often "the column is mapped to the wrong field".
   */
  const salvageableNumbers = useMemo(() => {
    let count = 0;
    let sampleFrom = "";
    let sampleTo = "";
    spec.mapping.forEach((field, column) => {
      if (!field) return;
      const meta = fields[field];
      if (!meta || !isNumericType(meta.dataType)) return;
      for (const row of spec.rows) {
        const raw = row[column] ?? "";
        const salvaged = toSalvagedNumber(raw, decimal);
        if (salvaged === null) continue;
        count++;
        if (sampleFrom === "") {
          sampleFrom = raw.trim();
          sampleTo = salvaged;
        }
      }
    });
    return { count, sampleFrom, sampleTo };
  }, [spec.mapping, spec.rows, fields, decimal]);

  // Every column is shown, mapped or not — this is the user's data, and hiding
  // the columns they chose not to import would make the grid stop matching what
  // they pasted. The header says which ones are ignored.
  const columns = useMemo(
    () => spec.headers.map((_, index) => index),
    [spec.headers],
  );

  if (spec.rows.length === 0 || columns.length === 0) return null;

  const shown = Math.min(spec.rows.length, MAX_VISIBLE_ROWS);
  const hidden = spec.rows.length - shown;

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={sectionLabel}>Data</h2>
        <span className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {report.readyRows.length.toLocaleString()} ready
          </span>
          {report.blockedRows.size > 0 && (
            <span className="text-destructive inline-flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" />
              {report.blockedRows.size.toLocaleString()} blocked
            </span>
          )}
          {report.warningCount > 0 && (
            <span className="inline-flex items-center gap-1 text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              {report.warningCount.toLocaleString()} warning
              {report.warningCount === 1 ? "" : "s"}
            </span>
          )}
          {edits.size > 0 && (
            <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300">
              <PencilLine className="h-3.5 w-3.5" />
              {edits.size.toLocaleString()}{" "}
              {edits.size === 1 ? "cell" : "cells"} edited
            </span>
          )}
        </span>
      </div>

      {/*
        Offered only when it would change something, and it states the
        interpretation being applied rather than picking one quietly. The
        ambiguity is real — 3/4/2026 is two different days — so the person who
        knows where the file came from resolves it once, for the whole column.
      */}
      {fixableDates.count > 0 && (
        <BulkFix icon={<CalendarClock className="h-3.5 w-3.5 shrink-0" />}>
          <span>
            {fixableDates.count.toLocaleString()}{" "}
            {fixableDates.count === 1 ? "date isn't" : "dates aren't"} in ISO
            form.
            {fixableDates.ambiguous &&
              " Some are ambiguous, so pick how to read them:"}
          </span>
          <select
            value={dateOrder}
            onChange={(e) => setDateOrder(e.target.value as DateOrder)}
            aria-label="How to read the dates"
            className={FIX_SELECT_CLASS}
          >
            {(Object.keys(DATE_ORDER_LABELS) as DateOrder[]).map((order) => (
              <option key={order} value={order}>
                {DATE_ORDER_LABELS[order]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onFixDates(dateOrder)}
            className={FIX_BUTTON_CLASS}
          >
            Convert to YYYY-MM-DD
          </button>
        </BulkFix>
      )}

      {/*
        The decimal-point selector only appears when at least one cell reads
        differently depending on it. Showing it always would ask a question with
        no consequence, and the answer would still have to be given before the
        common case — a column of `$1,200.50` — could be cleaned.
      */}
      {fixableNumbers.count > 0 && (
        <BulkFix icon={<Sigma className="h-3.5 w-3.5 shrink-0" />}>
          <span>
            {fixableNumbers.count.toLocaleString()}{" "}
            {fixableNumbers.count === 1 ? "number carries" : "numbers carry"}{" "}
            currency symbols, separators or spaces.
            {fixableNumbers.ambiguous &&
              " Some read differently depending on the decimal point:"}
          </span>
          {fixableNumbers.ambiguous && (
            <select
              value={decimal}
              onChange={(e) => setDecimal(e.target.value as DecimalSeparator)}
              aria-label="Which character is the decimal point"
              className={FIX_SELECT_CLASS}
            >
              {(Object.keys(DECIMAL_LABELS) as DecimalSeparator[]).map(
                (sep) => (
                  <option key={sep} value={sep}>
                    {DECIMAL_LABELS[sep]}
                  </option>
                ),
              )}
            </select>
          )}
          <button
            type="button"
            onClick={() => onFixNumbers(decimal, "format")}
            className={FIX_BUTTON_CLASS}
          >
            Strip formatting
          </button>
        </BulkFix>
      )}

      {/*
        Kept out of "Strip formatting" on purpose. That button only ever
        reformats values that are already numbers; this one reads a number out
        of a cell that isn't one, which is a guess about intent rather than a
        change of notation. A whole column of these usually means the column is
        pointed at the wrong field, and the all-red grid is the only thing
        saying so — one press should not be able to erase that by accident.
      */}
      {salvageableNumbers.count > 0 && (
        <BulkFix
          tone="caution"
          icon={<Scissors className="h-3.5 w-3.5 shrink-0" />}
        >
          <span>
            {salvageableNumbers.count.toLocaleString()}{" "}
            {salvageableNumbers.count === 1 ? "cell mixes" : "cells mix"} text
            and numbers
            {salvageableNumbers.sampleFrom !== "" && (
              <>
                {" — "}
                <span className="font-mono">
                  {salvageableNumbers.sampleFrom}
                </span>
                {" would become "}
                <span className="font-mono font-semibold">
                  {salvageableNumbers.sampleTo}
                </span>
              </>
            )}
            . Check the column is mapped to the right field first.
          </span>
          <button
            type="button"
            onClick={() => onFixNumbers(decimal, "salvage")}
            className={FIX_BUTTON_CLASS}
          >
            Extract the numbers
          </button>
        </BulkFix>
      )}

      <TableScroller>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th
                className={`${stickyHeaderCell} text-muted-foreground px-2 py-1.5 text-right text-[11px] font-medium`}
              >
                #
              </th>
              <th className={`${stickyHeaderCell} w-6`} />
              {columns.map((column) => {
                const field = spec.mapping[column];
                return (
                  <th
                    key={column}
                    className={`${stickyHeaderCell} px-2 py-1.5 text-left`}
                  >
                    <span className="text-foreground block truncate text-[11px] font-medium">
                      {spec.headers[column] || `Column ${column + 1}`}
                    </span>
                    <span
                      className={`block truncate font-mono text-[10px] ${
                        field
                          ? "text-muted-foreground"
                          : "text-muted-foreground/50 italic"
                      }`}
                    >
                      {field ?? "not imported"}
                    </span>
                  </th>
                );
              })}
              <th
                className={`${stickyHeaderCell} text-muted-foreground px-2 py-1.5 text-left text-[11px] font-medium`}
              >
                Notes
              </th>
              <th className={`${stickyHeaderCell} w-16`} />
            </tr>
          </thead>
          <tbody>
            {spec.rows.slice(0, shown).map((cells, rowIndex) => {
              const issues = byRow.get(rowIndex);
              const worst = !issues?.length
                ? null
                : issues.some((i) => i.level === "error")
                  ? ("error" as const)
                  : ("warning" as const);
              return (
                <GridRow
                  key={rowIndex}
                  rowIndex={rowIndex}
                  cells={cells}
                  columns={columns}
                  worst={worst}
                  badColumns={(issues ?? [])
                    .filter((i) => i.column >= 0)
                    .map((i) => i.column)
                    .join(",")}
                  originals={originals.get(rowIndex) ?? ""}
                  messages={(issues ?? []).map((i) => i.message).join(" ")}
                  picklistColumns={picklistColumns}
                  onCellChange={onCellChange}
                  onDeleteRow={onDeleteRow}
                  onRevertRow={onRevertRow}
                />
              );
            })}
          </tbody>
        </table>
      </TableScroller>

      {hidden > 0 && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          Showing the first {shown.toLocaleString()} of{" "}
          {spec.rows.length.toLocaleString()} rows. The counts above cover all
          of them.
        </p>
      )}
    </div>
  );
}
