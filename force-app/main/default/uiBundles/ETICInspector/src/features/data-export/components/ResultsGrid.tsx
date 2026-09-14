import { Check, Pencil, Search, X } from "lucide-react";
import React, {
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ResultRow } from "../../../api/dataExport";
import { PicklistSelect } from "../../../components/PicklistSelect";
import { StickyActionBar } from "../../../components/StickyActionBar";
import { Spinner } from "../../../components/ui/spinner";
import { Button } from "../../../components/ui/button";
import {
  TableScroller,
  stickyHeaderCell,
} from "../../../components/TableScroller";
import { optionsFor, type PicklistMap } from "../../../api/picklists";
import { inputClass, searchInputClass } from "../../../components/inputStyles";
import { recordViewUrl } from "../../../lib/salesforce";
import { isParentPath, resolveFieldPath } from "../query/types";
import type { FieldMetaMap } from "../../../lib/fieldMeta";
import { TextButton } from "../../../components/TextButton";

/**
 * Column heading for a field path.
 *
 * A plain field shows its label. A parent path shows the trail — "Account ›
 * Name" — because the bare label "Name" in a column next to the Opportunity's
 * own "Name" would be genuinely ambiguous. The raw path stays available as the
 * cell's `title`.
 */
function columnLabel(
  path: string,
  meta: FieldMetaMap,
  metaByObject: Record<string, FieldMetaMap>,
  objectApiName: string,
): string {
  if (!isParentPath(path)) return meta[path]?.label ?? path;
  const resolved = resolveFieldPath(path, objectApiName, metaByObject);
  return resolved ? resolved.trail.join(" › ") : path;
}

interface ResultsGridProps {
  columns: string[];
  rows: ResultRow[];
  meta: FieldMetaMap;
  /** Every loaded object, so parent-path columns can be labelled. */
  metaByObject: Record<string, FieldMetaMap>;
  /** Null until a picklist column makes them worth fetching. */
  picklists: PicklistMap | null;
  /** Needed to build record links; the grid never queries with it. */
  objectApiName: string;
  selected: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  /**
   * Add rows to the selection without removing any. Used both by shift-click
   * for a contiguous run and by "select all" for every filtered row.
   */
  onSelectRange: (ids: string[]) => void;
  /** Drop the whole selection, however it was built up. */
  onClearSelection: () => void;
  /** Save one row's edited fields. Resolves false if the save failed. */
  onSaveRow: (id: string, values: Record<string, string>) => Promise<boolean>;
}

const PAGE_SIZE = 200;

/**
 * One result row.
 *
 * Memoized and fed only primitives plus a stable `row` and stable callbacks —
 * passing the selection Set or the drafts Map straight in would defeat the memo,
 * because every selection change allocates a new collection identity. This is
 * the same constraint that keeps the Show all data grid usable on wide objects.
 */
const Row = React.memo(function Row({
  row,
  columns,
  index,
  objectApiName,
  isSelected,
  isEditing,
  isSaving,
  editableColumns,
  picklists,
  multiPicklistColumns,
  onToggle,
  onStartEdit,
  onCancelEdit,
  onSave,
}: {
  row: ResultRow;
  columns: string[];
  /** Position within the visible page — the anchor for shift-selection. */
  index: number;
  objectApiName: string;
  isSelected: boolean;
  isEditing: boolean;
  isSaving: boolean;
  editableColumns: string;
  /** Stable identity straight from the api-layer cache, so the memo holds. */
  picklists: PicklistMap | null;
  multiPicklistColumns: string;
  onToggle: (id: string, index: number, shiftKey: boolean) => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSave: (id: string, values: Record<string, string>) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const editable = useMemo(
    () => new Set(editableColumns.split(",").filter(Boolean)),
    [editableColumns],
  );
  const multiPicklist = useMemo(
    () => new Set(multiPicklistColumns.split(",").filter(Boolean)),
    [multiPicklistColumns],
  );

  const begin = () => {
    setDrafts({});
    onStartEdit(row.id);
  };

  return (
    <tr className={isSelected ? "bg-primary/5" : "hover:bg-muted/40"}>
      <td className="border-border w-9 border-b px-2 py-1.5 align-top">
        <input
          type="checkbox"
          checked={isSelected}
          // The shift key is only on the mouse event — React's ChangeEvent
          // doesn't carry modifiers — so the click does the work and onChange
          // exists purely to keep the input controlled.
          onClick={(e) => onToggle(row.id, index, e.shiftKey)}
          onChange={() => {}}
          aria-label={`Select ${row.id}`}
          className="cursor-pointer"
        />
      </td>
      {columns.map((column) => {
        const canEdit = isEditing && editable.has(column) && column !== "Id";
        const picklist = canEdit ? picklists?.[column] : undefined;
        return (
          <td
            key={column}
            className="border-border max-w-[22rem] border-b px-2 py-1.5 align-top text-xs"
          >
            {picklist ? (
              // Keyed on the stored value, not `display`, which holds the
              // label — saving the label back would be rejected as an invalid
              // picklist value whenever the two differ.
              <PicklistSelect
                size="sm"
                value={
                  drafts[column] ??
                  (row.values[column] == null ? "" : String(row.values[column]))
                }
                multi={multiPicklist.has(column)}
                options={optionsFor(picklist)}
                onChange={(value) =>
                  setDrafts((d) => ({ ...d, [column]: value }))
                }
              />
            ) : canEdit ? (
              <input
                type="text"
                defaultValue={row.display[column] ?? ""}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [column]: e.target.value }))
                }
                className={`${inputClass("xs")} w-full`}
              />
            ) : column === "Id" ? (
              // Opens the Lightning record page in a new tab. The app runs on
              // its own *.my.salesforce.app origin, so navigating in place
              // would throw away whatever query the user just built.
              <a
                href={recordViewUrl(objectApiName, row.id)}
                target="_blank"
                rel="noreferrer"
                className="text-primary font-mono text-[11px] hover:underline"
              >
                {row.id}
              </a>
            ) : (
              <span className="break-words">
                {row.display[column] || (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </span>
            )}
          </td>
        );
      })}
      <td className="border-border w-20 border-b px-2 py-1.5 align-top">
        {isEditing ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSave(row.id, drafts)}
              disabled={isSaving}
              aria-label="Save row"
              className="text-success hover:text-success/80 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSaving ? (
                <Spinner size="sm" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              aria-label="Cancel edit"
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={begin}
            aria-label="Edit row"
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
});

export function ResultsGrid({
  columns,
  rows,
  meta,
  metaByObject,
  picklists,
  objectApiName,
  selected,
  onToggleRow,
  onToggleAll,
  onSelectRange,
  onClearSelection,
  onSaveRow,
}: ResultsGridProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  /** Last row clicked without shift — the fixed end of a shift-selected run. */
  const anchorRef = useRef<number | null>(null);

  // Typing stays responsive; the expensive re-filter runs at lower priority.
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((c) => (row.display[c] ?? "").toLowerCase().includes(q)),
    );
  }, [rows, columns, deferredQuery]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () =>
      filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePage],
  );

  // A single comma-joined string keeps the memoized Row's props primitive.
  //
  // Parent-path columns are excluded here for free, and must stay excluded:
  // `meta` holds only the queried object's own fields, so `Account.Name` finds
  // nothing and is never editable. That is correct — saving goes through a
  // PATCH on *this* record, and `Account.Name` doesn't live on it. Editing it
  // would mean writing to a different record entirely.
  const editableColumns = useMemo(
    () => columns.filter((c) => meta[c]?.updateable).join(","),
    [columns, meta],
  );

  // Which picklist columns take several values. The picklist map itself says a
  // column *is* a picklist but not which kind, and the two need different
  // controls, so the distinction comes from the field metadata.
  const multiPicklistColumns = useMemo(
    () =>
      columns.filter((c) => meta[c]?.dataType === "MultiPicklist").join(","),
    [columns, meta],
  );

  const startEdit = useCallback((id: string) => setEditingId(id), []);
  const cancelEdit = useCallback(() => setEditingId(null), []);

  const save = useCallback(
    (id: string, values: Record<string, string>) => {
      if (Object.keys(values).length === 0) {
        setEditingId(null);
        return;
      }
      setSavingId(id);
      onSaveRow(id, values)
        .then((ok) => {
          if (ok) setEditingId(null);
        })
        .finally(() => setSavingId(null));
    },
    [onSaveRow],
  );

  const pageIds = useMemo(() => pageRows.map((r) => r.id), [pageRows]);

  /**
   * Shift-click selects everything between the last plain click and this one.
   * The anchor deliberately survives a shift-click, so repeated shift-clicks
   * re-extend from the same starting row instead of walking it forward.
   * Indexes are positions in the *visible* page, so filtering or paging can
   * never make a range span rows the user can't see.
   */
  const handleToggle = useCallback(
    (id: string, index: number, shiftKey: boolean) => {
      const anchor = anchorRef.current;
      if (
        shiftKey &&
        anchor !== null &&
        anchor !== index &&
        anchor < pageRows.length
      ) {
        const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
        onSelectRange(pageRows.slice(from, to + 1).map((r) => r.id));
        return;
      }
      anchorRef.current = index;
      onToggleRow(id);
    },
    [onSelectRange, onToggleRow, pageRows],
  );
  const allOnPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Filter loaded results by keyword…"
            spellCheck={false}
            aria-label="Filter results"
            className={`${searchInputClass("sm")} w-full`}
          />
        </div>
        <span className="text-muted-foreground text-xs">
          {filtered.length.toLocaleString()}
          {filtered.length !== rows.length &&
            ` of ${rows.length.toLocaleString()}`}{" "}
          rows
          {selected.size > 0 && ` · ${selected.size} selected`}
          {filtered.length > 1 && (
            <span className="hidden sm:inline">
              {" "}
              · shift-click to select a range
            </span>
          )}
        </span>
      </div>

      {/*
        The header checkbox can only ever mean "this page" — it sits in a table
        that shows 200 of up to 2,000 rows. Selecting a page and then deleting
        looked like it had covered everything matching the query, so the wider
        selection is offered explicitly, with the count spelled out, rather than
        being hidden behind a checkbox whose scope you have to infer.
      */}
      {allOnPageSelected && filtered.length > pageIds.length && (
        <div className="border-border bg-muted/40 mb-2 flex flex-wrap items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            All {pageIds.length.toLocaleString()} rows on this page are
            selected.
          </span>
          {selected.size >= filtered.length ? (
            <TextButton tone="accent" onClick={onClearSelection}>
              Clear selection
            </TextButton>
          ) : (
            <TextButton
              tone="accent"
              onClick={() => onSelectRange(filtered.map((r) => r.id))}
            >
              Select all {filtered.length.toLocaleString()} rows
              {filtered.length !== rows.length ? " matching the filter" : ""}
            </TextButton>
          )}
        </div>
      )}

      <TableScroller>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${stickyHeaderCell} w-9 px-2 py-2`}>
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={() => onToggleAll(pageIds)}
                  aria-label="Select all rows on this page"
                  className="cursor-pointer"
                />
              </th>
              {columns.map((column) => (
                <th
                  key={column}
                  title={column}
                  className={`${stickyHeaderCell} text-muted-foreground px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide`}
                >
                  {columnLabel(column, meta, metaByObject, objectApiName)}
                </th>
              ))}
              <th className={`${stickyHeaderCell} w-20 px-2 py-2`} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, index) => (
              <Row
                key={row.id}
                row={row}
                columns={columns}
                index={index}
                objectApiName={objectApiName}
                isSelected={selected.has(row.id)}
                isEditing={editingId === row.id}
                isSaving={savingId === row.id}
                editableColumns={editableColumns}
                picklists={picklists}
                multiPicklistColumns={multiPicklistColumns}
                onToggle={handleToggle}
                onStartEdit={startEdit}
                onCancelEdit={cancelEdit}
                onSave={save}
              />
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">
            No rows match that filter.
          </p>
        )}
      </TableScroller>

      {pageCount > 1 && (
        <StickyActionBar className="justify-center text-xs">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
          >
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {safePage + 1} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
          >
            Next
          </Button>
        </StickyActionBar>
      )}
    </div>
  );
}
