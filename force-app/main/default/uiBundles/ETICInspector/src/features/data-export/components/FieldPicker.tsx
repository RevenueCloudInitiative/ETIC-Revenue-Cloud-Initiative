import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { memo, useDeferredValue, useMemo, useState } from "react";
import { MAX_RELATIONSHIP_DEPTH } from "../query/types";
import type { FieldMeta, FieldMetaMap } from "../../../lib/fieldMeta";
import { Spinner } from "../../../components/ui/spinner";
import { searchInputClass } from "../../../components/inputStyles";
import { sectionLabel } from "../../../components/sectionLabel";
import { TextButton } from "../../../components/TextButton";

interface FieldPickerProps {
  /** Root object's selectable fields, already sorted by label. */
  fields: FieldMeta[];
  selected: string[];
  onToggle: (path: string) => void;
  onSelectAll: (paths: string[]) => void;
  onClear: () => void;
  /** Every object whose metadata has been loaded, keyed by API name. */
  metaByObject: Record<string, FieldMetaMap>;
  /** Loads a parent object's metadata — one cached call per object. */
  onLoadObject: (objectApiName: string) => void;
  /** Objects currently being fetched, so an expanded row can show a spinner. */
  loadingObjects: Set<string>;
}

/**
 * How many rows to mount at once.
 *
 * Relationship expansion multiplies this list fast: Opportunity alone is 48
 * fields, and expanding five lookups took it to **809** — every one mounted and
 * re-rendered on each keystroke, which measured **301 ms** for a single
 * character. `User` is the worst offender at 219 fields, and `OwnerId`,
 * `CreatedById` and `LastModifiedById` all point at it.
 *
 * `FieldCombobox` already solved this with the same cap (at 50; this list is a
 * scrollable panel rather than a dropdown, so it can afford more). Nobody
 * scrolls past a hundred — they type.
 */
const MAX_VISIBLE = 100;

/** One rendered line: either a selectable field or an expandable relationship. */
interface Row {
  /** Full dotted path — what goes into `spec.fields`. */
  path: string;
  field: FieldMeta;
  depth: number;
  /** Set when this row can be expanded to reveal the parent's fields. */
  relationPath: string | null;
  /**
   * Whether the field itself matched the search. An *open* relationship row is
   * kept on screen even when it doesn't match, so the user can collapse it —
   * which means row count alone can't tell you whether the search found
   * anything.
   */
  matched: boolean;
}

function sortByLabel(fields: FieldMeta[]): FieldMeta[] {
  return [...fields].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Field selection, with parent-record traversal.
 *
 * A reference field holds an **Id**, so exporting `AccountId` gives a column of
 * `001gK00000TvFw8QAF` rather than "Dickenson plc" — the name lives on the
 * Account. Expanding the relationship selects `Account.Name` instead, which is
 * what makes an export readable.
 *
 * Expanding costs one `object-info` call for the parent object, cached for the
 * session, and nothing thereafter. Only single-target references expand:
 * polymorphic ones (`WhoId` → Contact *or* Lead) resolve to a union type that
 * this compiler's `Rel { Field }` selection can't traverse, so the data layer
 * leaves them without a `relationshipName` and they render as ordinary fields.
 *
 * Wide objects have hundreds of fields, so search drives filtering off
 * `useDeferredValue` — the same approach that keeps the Show all data grid
 * responsive.
 *
 * **Memoized**, because it is the most expensive thing on the page and almost
 * nothing that happens on the page concerns it.
 *
 * Row selection, the delete dialog opening, the results filter — all of that is
 * state on `DataExport`, so every one of those re-rendered up to
 * {@link MAX_VISIBLE} field rows for nothing. Measured on Account (69 fields):
 * ticking one row checkbox cost **52 ms**, and opening the confirm dialog was a
 * **66 ms** long task. With the field list empty the same interactions produced
 * no long task at all, which is what identified this rather than the dialog it
 * looked like.
 *
 * The memo only holds because `DataExport` passes `useCallback`-stable
 * handlers. An inline `onToggle={(path) => …}` there silently undoes all of
 * this — the component still renders correctly, just always.
 */
export const FieldPicker = memo(function FieldPicker({
  fields,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  metaByObject,
  onLoadObject,
  loadingObjects,
}: FieldPickerProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  /** Relationship paths the user has opened, e.g. "Account", "Account.Owner". */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const matches = (f: FieldMeta) =>
      !q ||
      f.apiName.toLowerCase().includes(q) ||
      f.label.toLowerCase().includes(q);

    const out: Row[] = [];

    const walk = (
      levelFields: FieldMeta[],
      prefix: string,
      depth: number,
    ): void => {
      for (const field of levelFields) {
        const path = prefix ? `${prefix}.${field.apiName}` : field.apiName;
        const relationPath =
          field.relationshipName && depth < MAX_RELATIONSHIP_DEPTH
            ? prefix
              ? `${prefix}.${field.relationshipName}`
              : field.relationshipName
            : null;

        const isOpen = relationPath !== null && expanded.has(relationPath);

        // A relationship row stays visible while it's open even if its own
        // label doesn't match the search, or its matching children would have
        // nothing to hang from.
        const matched = matches(field);
        if (matched || isOpen) {
          out.push({ path, field, depth, relationPath, matched });
        }

        if (isOpen && field.referenceTo) {
          const childMeta = metaByObject[field.referenceTo];
          if (childMeta) {
            walk(
              sortByLabel(Object.values(childMeta).filter((f) => !f.compound)),
              relationPath,
              depth + 1,
            );
          }
        }
      }
    };

    walk(fields, "", 0);
    return out;
  }, [fields, deferredQuery, expanded, metaByObject]);

  /**
   * What actually mounts: the first `MAX_VISIBLE` rows, **plus any selected row
   * the cap would otherwise have pushed off**.
   *
   * That exception is the point of doing this by index rather than by slice: a
   * cap that hid a ticked checkbox would leave the user unable to untick it, or
   * even to see the field was in the query. Filtering preserves tree order, so
   * a re-surfaced selection still sits under its parent.
   *
   * Note this rescues selections from the *cap* only. A search that a selected
   * field doesn't match still hides it, which is what a search is for — the
   * "N selected" counter above stays accurate either way.
   */
  const visible = useMemo(
    () =>
      rows.filter(
        (row, index) => index < MAX_VISIBLE || selectedSet.has(row.path),
      ),
    [rows, selectedSet],
  );
  const hidden = rows.length - visible.length;

  /**
   * True when the search matched no actual field. Can't be `rows.length === 0`:
   * open relationship rows survive a non-matching search on purpose, so a
   * fruitless search would otherwise render a few bare lookups and no
   * explanation.
   */
  const noMatches =
    deferredQuery.trim() !== "" && !rows.some((row) => row.matched);

  const toggleExpand = (relationPath: string, referenceTo: string) => {
    const isOpen = expanded.has(relationPath);
    const next = new Set(expanded);
    if (isOpen) next.delete(relationPath);
    else next.add(relationPath);
    setExpanded(next);

    // Deliberately outside the updater. StrictMode double-invokes state
    // updaters, so a fetch placed in there fires twice — and because
    // `getObjectFields` only caches *after* a success, two concurrent misses
    // both reach the network. Measured: expanding one lookup cost 2 calls
    // instead of 1 until this moved out. Reading `expanded` from the closure is
    // safe here because this only ever runs from a click.
    if (!isOpen && !metaByObject[referenceTo]) onLoadObject(referenceTo);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className={sectionLabel}>Fields</span>
        <span className="text-muted-foreground text-[11px]">
          {selected.length} selected
        </span>
      </div>

      <div className="relative mb-2">
        <Search className="text-muted-foreground absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter fields…"
          spellCheck={false}
          aria-label="Filter fields"
          className={`${searchInputClass("sm")} w-full`}
        />
      </div>

      {/* Paired actions, so they share one weight and colour. */}
      <div className="mb-2 flex gap-3">
        {/*
          Operates on every match, not just the mounted rows — the cap is a
          rendering concern and shouldn't quietly change what "select all"
          means. The count is spelled out because with a cap in play "shown"
          would otherwise be ambiguous about which number it refers to.
        */}
        <TextButton onClick={() => onSelectAll(rows.map((r) => r.path))}>
          Select {query ? "matching" : "all"} ({rows.length.toLocaleString()})
        </TextButton>
        <TextButton onClick={onClear}>Clear</TextButton>
      </div>

      <div className="border-border max-h-72 min-h-0 flex-1 overflow-y-auto rounded-md border">
        {(rows.length === 0 || noMatches) && (
          <p className="text-muted-foreground px-3 py-4 text-center text-xs">
            No fields match.
          </p>
        )}
        {visible.map((row) => {
          const { path, field, depth, relationPath } = row;
          const isOpen = relationPath !== null && expanded.has(relationPath);
          const loading =
            isOpen && field.referenceTo
              ? loadingObjects.has(field.referenceTo) &&
                !metaByObject[field.referenceTo]
              : false;

          return (
            <div
              key={path}
              className="hover:bg-muted flex items-start gap-1 px-2.5 py-1.5 text-xs"
              style={{ paddingLeft: `${0.625 + depth * 1.1}rem` }}
            >
              {/*
                The expander sits outside the label so clicking it opens the
                relationship rather than ticking the Id field next to it.
              */}
              {relationPath && field.referenceTo ? (
                <button
                  type="button"
                  onClick={() => toggleExpand(relationPath, field.referenceTo!)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Collapse" : "Expand"} ${field.label}`}
                  title={`Fields on the related ${field.referenceTo}`}
                  className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0 cursor-pointer"
                >
                  {loading ? (
                    <Spinner size="sm" />
                  ) : isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-3.5 shrink-0" />
              )}

              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={selectedSet.has(path)}
                  onChange={() => onToggle(path)}
                  className="mt-0.5 cursor-pointer"
                />
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate font-medium">
                    {field.label}
                  </span>
                  <span className="text-muted-foreground block truncate font-mono text-[10px]">
                    {path} · {field.dataType}
                  </span>
                </span>
              </label>
            </div>
          );
        })}

        {/*
          Mirrors FieldCombobox's footer, so the list never silently lies about
          being complete. Nothing hidden here is ticked — selections are
          exempted from the cap above.
        */}
        {hidden > 0 && (
          <p className="text-muted-foreground border-border border-t px-2.5 py-1.5 text-[10px]">
            {hidden.toLocaleString()} more — keep typing to narrow, or collapse
            a lookup.
          </p>
        )}
      </div>

      {rows.some((r) => r.relationPath) && (
        <p className="text-muted-foreground mt-1.5 text-[10px]">
          Expand a lookup (›) to pick fields from the related record — e.g. the
          account&apos;s name instead of its Id.
        </p>
      )}
    </div>
  );
});
