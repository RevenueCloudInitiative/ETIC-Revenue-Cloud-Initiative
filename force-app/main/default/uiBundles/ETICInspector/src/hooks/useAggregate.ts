import { useCallback } from "react";
import { runAggregate, type AggregateOutcome } from "../api/dataExport";

import type { AggregateSpec } from "../features/data-export/query/aggregate";
import type { FieldMetaMap } from "../lib/fieldMeta";
import { toRunErrorMessage } from "../lib/errors";
import { useSessionState } from "../lib/sessionState";
import { isAbortError } from "../lib/sfFetch";
import { useInFlight } from "./useInFlight";

interface AggregateState {
  status: "idle" | "loading" | "success" | "error";
  result: AggregateOutcome | null;
  error: string | null;
}

export interface UseAggregate extends AggregateState {
  run: (spec: AggregateSpec, meta: FieldMetaMap) => void;
  reset: () => void;
}

/**
 * Runs the Summarize query.
 *
 * Deliberately a separate hook from `useDataExport` with its own session key,
 * so switching between Rows and Summarize doesn't discard the other mode's
 * results — those cost API calls the org was already billed for, and throwing
 * them away on a tab flip is exactly the waste this app exists to avoid.
 *
 * Everything else mirrors `useDataExport`: submit-only execution, a new run
 * aborts the previous one, and "loading" is never persisted because leaving the
 * page aborts the request that would have resolved it.
 */
export function useAggregate(): UseAggregate {
  const [state, setState] = useSessionState<AggregateState>(
    "dataExport.aggregate",
    { status: "idle", result: null, error: null },
    (s) => s.status !== "loading",
  );
  const { begin, finish, abort } = useInFlight();

  const run = useCallback(
    (spec: AggregateSpec, meta: FieldMetaMap) => {
      const controller = begin();

      setState({ status: "loading", result: null, error: null });

      // A spec Salesforce would reject — an ungroupable dimension, a function
      // the field's type doesn't have — is caught by the compiler, which runs
      // before the request is built. Those surface through the `catch` below as
      // an ordinary message and never cost an API call.
      runAggregate(spec, meta, { signal: controller.signal })
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

  const reset = useCallback(() => {
    abort();
    setState({ status: "idle", result: null, error: null });
  }, [abort, setState]);

  return { ...state, run, reset };
}
