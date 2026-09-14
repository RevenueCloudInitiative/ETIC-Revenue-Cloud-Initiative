import { useCallback, useEffect, useState } from "react";
import {
  getRecordDetail,
  toDisplay,
  type FieldRow,
  type RecordDetail,
  type UiFieldValue,
} from "../api/recordDetail";
import { toFriendlyMessage } from "../lib/errors";
import {
  cacheKey,
  getCachedDetail,
  invalidateCachedDetail,
  setCachedDetail,
} from "../lib/recordDetailCache";
import { isAbortError } from "../lib/sfFetch";
import { isSalesforceId } from "../lib/salesforce";

export { getLastRecordId } from "../lib/recordDetailCache";

interface DetailState {
  status: "idle" | "loading" | "success" | "error";
  data: RecordDetail | null;
  error: string | null;
}

export interface UseRecordDetail extends DetailState {
  /**
   * Merge saved values (echoed by the UI API PATCH) into the loaded record.
   * Lets a save update the view without re-fetching — no extra API calls, and
   * the display values are still Salesforce's own formatting.
   */
  applyFieldUpdates: (
    fields: Record<string, UiFieldValue>,
    lastModifiedDate?: string | null,
  ) => void;
  /** Discard the cached copy and load the record again. */
  refresh: () => void;
}

function mergeUpdatedFields(
  detail: RecordDetail,
  updates: Record<string, UiFieldValue>,
  lastModifiedDate?: string | null,
): RecordDetail {
  if (Object.keys(updates).length === 0 && !lastModifiedDate) return detail;

  const rows: FieldRow[] = detail.rows.map((row) => {
    const updated = updates[row.apiName];
    if (!updated) return row;
    const display = toDisplay(updated);
    return {
      ...row,
      rawValue: updated.value ?? null,
      display,
      // A field we just wrote is by definition accessible.
      status: display == null ? "empty" : "value",
    };
  });

  return {
    ...detail,
    rows,
    lastModifiedDate: lastModifiedDate ?? detail.lastModifiedDate,
  };
}

/**
 * Loads a record's full field list, using the cache when `recordDetailCache`
 * says it may be. Both reads below go through `getCachedDetail`, so the TTL,
 * write-generation and explicit-request rules apply to the render-time seed
 * and to the load effect alike — a policy enforced in only one of the two
 * would leave the other serving records the first had already rejected.
 */
export function useRecordDetail(recordId: string | null): UseRecordDetail {
  const [state, setState] = useState<DetailState>(() => {
    const cached = recordId ? getCachedDetail(recordId) : undefined;
    return cached
      ? { status: "success", data: cached, error: null }
      : { status: "idle", data: null, error: null };
  });
  // Bumping this re-runs the load effect for an explicit reload.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!recordId) {
      setState({ status: "idle", data: null, error: null });
      return;
    }
    if (!isSalesforceId(recordId)) {
      setState({
        status: "error",
        data: null,
        error: "That isn't a valid Salesforce record Id.",
      });
      return;
    }

    // Serve from cache instantly (no refetch / no flicker) — but only if the
    // cache's own rules allow it. A stale, superseded or explicitly re-
    // requested record returns undefined here and falls through to the load.
    const cached = getCachedDetail(recordId);
    if (cached) {
      setState({ status: "success", data: cached, error: null });
      return;
    }

    // Aborting matters for cost, not just correctness: without it, correcting
    // a mistyped Id still pays for every request the first Id kicked off.
    const controller = new AbortController();
    setState({ status: "loading", data: null, error: null });

    getRecordDetail(recordId, { signal: controller.signal })
      .then((data) => {
        setState({ status: "success", data, error: null });
      })
      .catch((err) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        setState({
          status: "error",
          data: null,
          error: toFriendlyMessage(err, { query: recordId, target: "record" }),
        });
      });

    return () => {
      controller.abort();
    };
  }, [recordId, reloadToken]);

  // Single write-through point for the cache. Keeping it out of the state
  // updater keeps that updater pure, which StrictMode's double-invoke requires.
  useEffect(() => {
    if (state.status === "success" && state.data) {
      setCachedDetail(state.data.recordId, state.data);
    }
  }, [state.status, state.data]);

  const applyFieldUpdates = useCallback(
    (
      fields: Record<string, UiFieldValue>,
      lastModifiedDate?: string | null,
    ) => {
      setState((current) => {
        if (current.status !== "success" || !current.data) return current;
        return {
          ...current,
          data: mergeUpdatedFields(current.data, fields, lastModifiedDate),
        };
      });
    },
    [],
  );

  const refresh = useCallback(() => {
    if (recordId) invalidateCachedDetail(recordId);
    setReloadToken((n) => n + 1);
  }, [recordId]);

  /**
   * The record being held and the record being asked for disagree briefly every
   * time `recordId` changes, because the load effect only sets `loading` *after*
   * the commit. Without this the page paints the previous record's name and full
   * field grid underneath the new record's Id, then swaps to a spinner.
   *
   * Measured on a live org, Opportunity (47 rows) → Account: **2 committed
   * renders, 15.3 ms** showing the old record under the new Id. With the
   * override: 0. Re-measure by logging `{recordId, state.data.recordId,
   * state.status}` here and switching records — the flash is far too short to
   * catch by eye, and a MutationObserver can't see it either (React commits the
   * stale frame and the spinner inside one observer batch).
   *
   * This is deliberately a **read-time override, not a state change**: nothing
   * here writes to `state`, so `applyFieldUpdates`' merge of the PATCH echo and
   * the cache write-through above are untouched. Setting the status from an
   * effect instead would paint the stale frame first — that *is* the bug.
   *
   * `cacheKey` canonicalises both sides, so the same record reached by its 15-
   * and 18-character forms is a match rather than a false mismatch.
   *
   * Scope: this stops the *wrong* record being painted. It does **not** make a
   * cached record appear instantly — that needs the state seeded during render
   * rather than in an effect, which is a larger change to this hook and is also
   * what would clear the two `react-hooks/set-state-in-effect` warnings on the
   * load effect above. Both were deliberately left alone.
   */
  const stale =
    state.data != null &&
    recordId != null &&
    cacheKey(state.data.recordId) !== cacheKey(recordId);

  return {
    ...state,
    status: stale ? "loading" : state.status,
    applyFieldUpdates,
    refresh,
  };
}
