import { useCallback, useSyncExternalStore } from "react";
import type { QuerySpec } from "../features/data-export/query/types";

/**
 * Query history, held in memory only.
 *
 * Deliberately not `localStorage`/`sessionStorage`: the app's security
 * assessment states, as a verified fact, that nothing is persisted in the
 * browser. Query text can contain filter values (a customer email, a record
 * name), so persisting it would put potentially sensitive strings on disk and
 * invalidate that claim. History therefore survives navigation between pages
 * and is lost on reload — a deliberate trade, not an oversight.
 *
 * Entries are stored as structured `QuerySpec`s rather than text, which is what
 * lets restoring one repopulate the builder controls exactly.
 */
const MAX_ENTRIES = 25;

export interface HistoryEntry {
  id: string;
  spec: QuerySpec;
  at: number;
}

let _entries: HistoryEntry[] = [];
const _listeners = new Set<() => void>();

function emit(): void {
  for (const listener of _listeners) listener();
}

function subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function getSnapshot(): HistoryEntry[] {
  return _entries;
}

/** Structural identity, so re-running the same query doesn't stack duplicates. */
function sameSpec(a: QuerySpec, b: QuerySpec): boolean {
  return (
    a.objectApiName === b.objectApiName &&
    a.limit === b.limit &&
    a.fields.join(",") === b.fields.join(",") &&
    a.orderBy?.field === b.orderBy?.field &&
    a.orderBy?.direction === b.orderBy?.direction &&
    a.filters.length === b.filters.length &&
    a.filters.every((f, i) => {
      const other = b.filters[i];
      return (
        other &&
        f.field === other.field &&
        f.operator === other.operator &&
        f.value === other.value
      );
    })
  );
}

function recordQuery(spec: QuerySpec): void {
  // Deep-copy so later edits to the builder can't mutate a stored entry.
  const snapshot: QuerySpec = {
    ...spec,
    fields: [...spec.fields],
    filters: spec.filters.map((f) => ({ ...f })),
    orderBy: spec.orderBy ? { ...spec.orderBy } : null,
  };

  const withoutDuplicate = _entries.filter((e) => !sameSpec(e.spec, snapshot));
  _entries = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      spec: snapshot,
      at: Date.now(),
    },
    ...withoutDuplicate,
  ].slice(0, MAX_ENTRIES);

  emit();
}

/** Drop one entry. Ids are stable for an entry's lifetime, so this is exact. */
function removeQuery(id: string): void {
  const next = _entries.filter((e) => e.id !== id);
  if (next.length === _entries.length) return;
  _entries = next;
  emit();
}

function clearHistory(): void {
  _entries = [];
  emit();
}

export function useQueryHistory() {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const clear = useCallback(() => clearHistory(), []);
  const remove = useCallback((id: string) => removeQuery(id), []);
  return { entries, record: recordQuery, remove, clear };
}
