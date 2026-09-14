import { useCallback, useEffect, useRef } from "react";

/**
 * One in-flight request at a time, aborted on unmount.
 *
 * Five hooks — `useDataExport`, `useAggregate`, `useUserSearch`,
 * `useRecordInspector` and `useDataImport` — each wrote out the same four
 * pieces: a ref holding the current `AbortController`, an unmount effect that
 * aborts it, an abort-then-claim on start, and an identity check in `finally`
 * so a stale request's cleanup can't clear a newer one's slot. `useUserSearch`
 * had already pulled its own `begin`/`finish` out locally, which is the shape
 * lifted here.
 *
 * This is not just tidiness. In this app aborting is a **cost** control: every
 * request bills the org's shared daily API limit, which the nav bar shows the
 * user. Correcting a mistyped record Id, or pressing Run twice, must not pay
 * for both lookups — so the abort has to happen on every one of these paths,
 * and a hook that forgot it would leak calls silently.
 *
 * `begin()` returns the controller so the caller can pass `controller.signal`
 * down and re-check `controller.signal.aborted` after each await. Call
 * `finish(controller)` from `finally`.
 */
export function useInFlight() {
  const current = useRef<AbortController | null>(null);

  useEffect(() => () => current.current?.abort(), []);

  /** Claim the slot, cancelling whatever was running. */
  const begin = useCallback(() => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    return controller;
  }, []);

  /**
   * Release the slot — but only if it is still ours. Without the identity
   * check, a superseded request settling late would clear the slot belonging to
   * the request that replaced it, and the next `begin()` would have nothing to
   * abort.
   */
  const finish = useCallback((controller: AbortController) => {
    if (current.current === controller) current.current = null;
  }, []);

  /** Cancel whatever is running and leave the slot empty. For `reset`/`clear`. */
  const abort = useCallback(() => {
    current.current?.abort();
    current.current = null;
  }, []);

  return { begin, finish, abort };
}
