import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import type { AggregateRow } from "../../../api/dataExport";
import type { AggregateColumn } from "../query/toAggregateGraphQL";
import {
  TableScroller,
  stickyHeaderCell,
} from "../../../components/TableScroller";

interface AggregateResultsGridProps {
  columns: AggregateColumn[];
  rows: AggregateRow[];
}

interface SortState {
  key: string;
  direction: "asc" | "desc";
}

/**
 * Compare two cells of the same column.
 *
 * Sorts on the raw value rather than the displayed text, because the display
 * side carries Salesforce's formatting — "$1,071,125,000" sorts before "$565.00"
 * as a string, and every currency column would be wrong. Numbers compare
 * numerically, everything else compares as locale text, and blanks sort last in
 * both directions so an empty group never sits above real data.
 */
function compareCells(a: unknown, b: unknown): number {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (typeof a === "number" && typeof b === "number") return a - b;

  const aNum = Number(a);
  const bNum = Number(b);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;

  return String(a).localeCompare(String(b));
}

/**
 * The summary table.
 *
 * Sorting is client-side and always will be: `{Object}_OrderBy` resolves to
 * `OrderByClause`, which carries only `order` and `nulls` — the
 * `function: COUNT` form shown in Salesforce's aggregate guide isn't in the
 * schema this org serves. Sorting here instead costs nothing, works on every
 * column including computed measures, and can't fail a query.
 *
 * There is no row selection and no delete: a row here is a group of records,
 * not a record, so there is nothing with an Id to act on.
 */
export function AggregateResultsGrid({
  columns,
  rows,
}: AggregateResultsGridProps) {
  const [sort, setSort] = useState<SortState | null>(null);

  const ordered = useMemo(() => {
    if (!sort) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    // Copy first — Array.prototype.sort mutates, and `rows` is the hook's state.
    return [...rows].sort(
      (a, b) => compareCells(a.values[sort.key], b.values[sort.key]) * factor,
    );
  }, [rows, sort]);

  const toggleSort = (key: string) => {
    setSort((prev) =>
      prev?.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  if (columns.length === 0) return null;

  return (
    <TableScroller>
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className={`${stickyHeaderCell} px-3 py-2 text-left font-semibold`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    title={
                      column.fn
                        ? `${column.label} — sort by this measure`
                        : `${column.field} — sort by this grouping`
                    }
                    className="text-foreground hover:text-primary inline-flex cursor-pointer items-center gap-1.5"
                  >
                    <span>{column.label}</span>
                    {active ? (
                      sort.direction === "asc" ? (
                        <ArrowUp className="h-3 w-3 shrink-0" />
                      ) : (
                        <ArrowDown className="h-3 w-3 shrink-0" />
                      )
                    ) : (
                      <ArrowUpDown className="text-muted-foreground/50 h-3 w-3 shrink-0" />
                    )}
                  </button>
                  {/*
                    Dimensions and measures look alike once they're both just
                    columns, so each says which it is and where it came from.
                  */}
                  <span className="text-muted-foreground mt-0.5 block font-mono text-[10px] font-normal">
                    {column.fn ? `${column.fn}(${column.field})` : column.field}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordered.map((row, index) => (
            <tr
              key={index}
              className="border-border/60 hover:bg-muted/30 border-b last:border-b-0"
            >
              {columns.map((column) => {
                const text = row.display[column.key];
                return (
                  <td
                    key={column.key}
                    className={`px-3 py-2 ${column.fn ? "text-right font-mono tabular-nums" : ""}`}
                  >
                    {text === "" ? (
                      // A grouped field is genuinely null for records that have
                      // no value — that is a real group, not a missing cell.
                      <span className="text-muted-foreground italic">
                        {column.fn ? "—" : "(blank)"}
                      </span>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {ordered.length === 0 && (
        <p className="text-muted-foreground px-3 py-8 text-center text-sm">
          No records matched the filters.
        </p>
      )}
    </TableScroller>
  );
}
