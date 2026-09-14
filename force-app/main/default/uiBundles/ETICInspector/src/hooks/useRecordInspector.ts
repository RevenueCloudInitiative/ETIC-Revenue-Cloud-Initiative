import { useCallback, useState } from "react";
import {
  getObjectSummaryByName,
  getRecordSummaryById,
  type ObjectSummary,
  type RecordSummary,
} from "../api/inspector";
import { validateQuery } from "../lib/salesforce";
import { toFriendlyMessage } from "../lib/errors";
import { isAbortError } from "../lib/sfFetch";
import { useInFlight } from "./useInFlight";

export type InspectResult =
  | { kind: "record"; data: RecordSummary }
  | { kind: "object"; data: ObjectSummary };

interface InspectorState {
  status: "idle" | "loading" | "success" | "error";
  result: InspectResult | null;
  error: string | null;
}

/**
 * Orchestrates resolving whatever the user typed (record Id or object name)
 * into a summary the Home page can render.
 *
 * Flow: validate (client-side) -> resolve (Data SDK) -> friendly error mapping.
 * A new search aborts the previous one so a superseded lookup stops costing
 * API calls.
 */
export function useRecordInspector() {
  const [state, setState] = useState<InspectorState>({
    status: "idle",
    result: null,
    error: null,
  });
  const { begin, finish, abort } = useInFlight();

  const inspect = useCallback(
    async (rawQuery: string) => {
      // 1) Client-side validation gate — no network call for invalid input.
      const check = validateQuery(rawQuery);
      if (!check.ok) {
        abort();
        setState({ status: "error", result: null, error: check.reason });
        return;
      }

      const { kind, value } = check;

      const controller = begin();

      setState({ status: "loading", result: null, error: null });

      // 2) Resolve via the Data SDK.
      try {
        const init = { signal: controller.signal };
        if (kind === "id") {
          const data = await getRecordSummaryById(value, init);
          setState({
            status: "success",
            result: { kind: "record", data },
            error: null,
          });
        } else {
          const data = await getObjectSummaryByName(value, init);
          setState({
            status: "success",
            result: { kind: "object", data },
            error: null,
          });
        }
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted) return;
        // 3) Friendly, predictable error messaging.
        const target = kind === "id" ? "record" : "object";
        setState({
          status: "error",
          result: null,
          error: toFriendlyMessage(err, { query: value, target }),
        });
      } finally {
        finish(controller);
      }
    },
    [begin, finish, abort],
  );

  const reset = useCallback(() => {
    abort();
    setState({ status: "idle", result: null, error: null });
  }, [abort]);

  return { ...state, inspect, reset };
}
