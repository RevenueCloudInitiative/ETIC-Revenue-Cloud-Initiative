import { useCallback } from "react";
import {
  deleteRecords,
  runQuery,
  type DeleteOutcome,
  type QueryOutcome,
} from "../api/dataExport";
import type { QuerySpec } from "../features/data-export/query/types";
import type { FieldMetaMap } from "../lib/fieldMeta";
import { toFriendlyMessage, toRunErrorMessage } from "../lib/errors";
import { useSessionState } from "../lib/sessionState";
import { isAbortError } from "../lib/sfFetch";
import { useInFlight } from "./useInFlight";

interface ExportState {
  status: "idle" | "loading" | "success" | "error";
  result: QueryOutcome | null;
  error: string | null;
}

export interface UseDataExport extends ExportState {
  run: (spec: QuerySpec, metaByObject: Record<string, FieldMetaMap>) => void;
  remove: (
    objectApiName: string,
    ids: string[],
  ) => Promise<DeleteOutcome | null>;
  /** Drop rows from local state after a confirmed delete — no refetch needed. */
  dropRows: (ids: string[]) => void;
  /** Merge saved field values back in without re-running the query. */
  applyRowUpdate: (id: string, values: Record<string, unknown>) => void;
  reset: () => void;
}

/**
 * Runs the Data Export query.
 *
 * Executes only on explicit submit — never on a change to the builder — for the
 * same reason the Users tab searches only on submit: every request bills the
 * org's shared daily API limit, and this app shows the user that number.
 *
 * A new run aborts the previous one, so a fast re-submit doesn't pay twice and
 * an abandoned query can never overwrite newer results.
 */
export function useDataExport(): UseDataExport {
  /**
   * Results outlive the page, so switching tabs doesn't throw away rows the org
   * was already billed for.
   *
   * "loading" is never stored: leaving mid-query aborts the request, and a
   * restored "loading" would be a spinner nothing is left to resolve. The last
   * settled result stays instead, which is a truthful account of what was
   * actually fetched.
   */
  const [state, setState] = useSessionState<ExportState>(
    "dataExport.result",
    { status: "idle", result: null, error: null },
    (s) => s.status !== "loading",
  );
  const { begin, finish, abort } = useInFlight();

  const run = useCallback(
    (spec: QuerySpec, metaByObject: Record<string, FieldMetaMap>) => {
      const controller = begin();

      setState({ status: "loading", result: null, error: null });

      runQuery(spec, metaByObject, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          setState({ status: "success", result, error: null });
        })
        .catch((err: unknown) => {
          if (isAbortError(err) || controller.signal.aborted) return;
          setState({
            status: "error",
            result: null,
            error: toRunErrorMessage(err, { target: "object" }),
          });
        })
        .finally(() => finish(controller));
    },
    [begin, finish, setState],
  );

  const remove = useCallback(
    async (objectApiName: string, ids: string[]) => {
      if (ids.length === 0) return null;
      try {
        return await deleteRecords(objectApiName, ids);
      } catch (err) {
        if (isAbortError(err)) return null;
        setState((prev) => ({
          ...prev,
          error: toFriendlyMessage(err, { target: "record" }),
        }));
        return null;
      }
    },
    [setState],
  );

  const dropRows = useCallback(
    (ids: string[]) => {
      const gone = new Set(ids);
      setState((prev) => {
        if (!prev.result) return prev;
        const rows = prev.result.rows.filter((r) => !gone.has(r.id));
        const removed = prev.result.rows.length - rows.length;
        return {
          ...prev,
          result: {
            ...prev.result,
            rows,
            totalCount: Math.max(0, prev.result.totalCount - removed),
          },
        };
      });
    },
    [setState],
  );

  const applyRowUpdate = useCallback(
    (id: string, values: Record<string, unknown>) => {
      setState((prev) => {
        if (!prev.result) return prev;
        return {
          ...prev,
          result: {
            ...prev.result,
            rows: prev.result.rows.map((row) =>
              row.id === id
                ? {
                    ...row,
                    values: { ...row.values, ...values },
                    display: {
                      ...row.display,
                      ...Object.fromEntries(
                        Object.entries(values).map(([k, v]) => [
                          k,
                          v == null ? "" : String(v),
                        ]),
                      ),
                    },
                  }
                : row,
            ),
          },
        };
      });
    },
    [setState],
  );

  const reset = useCallback(() => {
    abort();
    setState({ status: "idle", result: null, error: null });
  }, [abort, setState]);

  return { ...state, run, remove, dropRows, applyRowUpdate, reset };
}
