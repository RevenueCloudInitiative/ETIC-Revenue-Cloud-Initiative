import { History, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { HistoryEntry } from "../../../hooks/useQueryHistory";
import type { FieldMetaMap } from "../../../lib/fieldMeta";
import { toSoqlOneLine } from "../query/toSoqlText";
import { selectClass } from "../../../components/inputStyles";
import { sectionLabel } from "../../../components/sectionLabel";
import { TextButton } from "../../../components/TextButton";

interface QueryHistoryPanelProps {
  entries: HistoryEntry[];
  metaByObject: Record<string, FieldMetaMap>;
  onRestore: (entry: HistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

/**
 * Recent queries.
 *
 * Entries are stored structurally, so restoring one repopulates the builder
 * controls exactly rather than dropping text somewhere. Held in memory only —
 * filter values can contain record data, and this app deliberately persists
 * nothing to the browser.
 */
export function QueryHistoryPanel({
  entries,
  metaByObject,
  onRestore,
  onRemove,
  onClear,
}: QueryHistoryPanelProps) {
  const [objectFilter, setObjectFilter] = useState("");

  // Objects actually present in history, in most-recent-first order.
  const objects = useMemo(
    () => [...new Set(entries.map((e) => e.spec.objectApiName))],
    [entries],
  );

  // A filter on an object whose last entry has since aged out would hide
  // everything with no way back, so an unrepresented selection falls through
  // to showing all.
  const active = objects.includes(objectFilter) ? objectFilter : "";
  const visible = active
    ? entries.filter((e) => e.spec.objectApiName === active)
    : entries;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className={`${sectionLabel} flex items-center gap-1.5`}>
          <History className="h-3.5 w-3.5" />
          History
        </span>
        {entries.length > 0 && <TextButton onClick={onClear}>Clear</TextButton>}
      </div>

      {objects.length > 1 && (
        <select
          value={active}
          onChange={(e) => setObjectFilter(e.target.value)}
          aria-label="Filter history by object"
          className={`${selectClass("sm")} mb-1.5 w-full`}
        >
          <option value="">All objects ({entries.length})</option>
          {objects.map((name) => (
            <option key={name} value={name}>
              {name} (
              {entries.filter((e) => e.spec.objectApiName === name).length})
            </option>
          ))}
        </select>
      )}

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Queries you run appear here for this session.
        </p>
      ) : (
        <ul className="border-border divide-border/60 max-h-56 divide-y overflow-y-auto rounded-md border">
          {visible.map((entry) => (
            <li
              key={entry.id}
              className="hover:bg-muted group flex items-start"
            >
              <button
                type="button"
                onClick={() => onRestore(entry)}
                title="Restore this query into the builder"
                className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 px-2.5 py-2 text-left"
              >
                <RotateCcw className="text-muted-foreground mt-0.5 h-3 w-3 shrink-0" />
                <span className="text-foreground min-w-0 break-words font-mono text-[10px] leading-relaxed">
                  {/*
                    The whole map, not one object's slice: an entry may filter
                    on a parent field, and narrowing here would type its literal
                    differently from the query that actually ran.
                  */}
                  {toSoqlOneLine(entry.spec, metaByObject)}
                </span>
              </button>
              {/*
                Sits outside the restore button — nesting it would make one
                click both remove the entry and restore it.
              */}
              <button
                type="button"
                onClick={() => onRemove(entry.id)}
                title="Remove from history"
                aria-label="Remove from history"
                className="text-muted-foreground/60 hover:text-destructive shrink-0 cursor-pointer px-1.5 py-2"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
