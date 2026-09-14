import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * `useState` that survives navigation between tabs.
 *
 * Routing unmounts a page when you leave it, so every page previously came back
 * blank — a query you had built, the object you had loaded, the user you had
 * looked up. Re-running the work costs API calls against the org's daily limit,
 * which is the one thing this app exists to make visible, so losing it is not
 * just annoying.
 *
 * This generalises what `useRecordDetail`'s `getLastRecordId()` already did for
 * the Show all data page: keep the value in a module-level map so it outlives
 * the component, and read it back when the page mounts again.
 *
 * Deliberately **not** `localStorage`/`sessionStorage`. The security assessment
 * states as a verified fact that this app persists nothing in the browser, and
 * the values held here — filter terms, record rows, usernames — are exactly the
 * data that claim is about. State therefore survives navigation and is lost on
 * reload, the same trade `useQueryHistory` makes.
 */
const _store = new Map<string, unknown>();

export function useSessionState<T>(
  key: string,
  initial: T | (() => T),
  /**
   * Optional gate on what is worth keeping. Used to keep in-flight states out
   * of the store: a request aborted by navigating away would otherwise be
   * restored as a "loading" that nothing is left to resolve.
   */
  shouldPersist?: (value: T) => boolean,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (_store.has(key)) return _store.get(key) as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  // Write through from an effect rather than from inside the state updater:
  // StrictMode double-invokes updaters, so a side effect there runs twice.
  const keep = shouldPersist ? shouldPersist(value) : true;
  useEffect(() => {
    if (keep) _store.set(key, value);
  }, [key, value, keep]);

  return [value, setValue];
}
