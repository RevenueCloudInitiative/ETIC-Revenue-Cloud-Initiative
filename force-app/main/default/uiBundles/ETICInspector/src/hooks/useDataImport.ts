import { useCallback, useState } from "react";
import { deleteRecords, type DeleteOutcome } from "../api/dataExport";
import {
  importRecords,
  type ImportOutcome,
  type ImportProgress,
} from "../api/dataImport";
import type { ImportPlan } from "../features/data-import/import/scope";
import type { ImportSpec } from "../features/data-import/import/types";
import { toFriendlyMessage, toRunErrorMessage } from "../lib/errors";
import type { FieldMetaMap } from "../lib/fieldMeta";
import { useSessionState } from "../lib/sessionState";
import { isAbortError } from "../lib/sfFetch";
import { useInFlight } from "./useInFlight";

interface ImportState {
  status: "idle" | "running" | "success" | "error";
  result: ImportOutcome | null;
  error: string | null;
  /** Ids removed by "undo", so the result can say so without re-running. */
  undone: boolean;
}

export interface UseDataImport extends ImportState {
  /** Chunk progress while running; null otherwise. */
  progress: ImportProgress | null;
  run: (spec: ImportSpec, fields: FieldMetaMap, plan: ImportPlan) => void;
  /** Delete the records the last insert created. Inserts only. */
  undo: () => Promise<DeleteOutcome | null>;
  reset: () => void;
}

/**
 * Runs the import.
 *
 * Mirrors `useDataExport`: explicit submit only, one in-flight run at a time,
 * aborted on unmount, and `isAbortError` treated as "ignore" rather than as a
 * failure to show the user.
 *
 * The one addition is progress. An import is the only operation in this app
 * that costs more than a couple of API calls, so a 2,000-row run spends 40
 * requests over several seconds — without a chunk counter that is
 * indistinguishable from a hang.
 */
export function useDataImport(): UseDataImport {
  /**
   * The outcome outlives the page so navigating away and back doesn't lose the
   * record of what was written — the one piece of state here that cannot be
   * recreated by re-running, because re-running would write everything twice.
   *
   * "running" is never persisted: leaving aborts the run, and a restored
   * "running" would be a progress bar nothing is left to advance.
   */
  const [state, setState] = useSessionState<ImportState>(
    "dataImport.result",
    { status: "idle", result: null, error: null, undone: false },
    (s) => s.status !== "running",
  );
  // Progress is intentionally plain component state: it is meaningless once the
  // run it describes has ended.
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const { begin, finish, abort } = useInFlight();

  const run = useCallback(
    (spec: ImportSpec, fields: FieldMetaMap, plan: ImportPlan) => {
      const controller = begin();

      setState({ status: "running", result: null, error: null, undone: false });
      setProgress({ done: 0, total: 0 });

      importRecords(spec, fields, plan, {
        signal: controller.signal,
        onProgress: (next) => {
          if (!controller.signal.aborted) setProgress(next);
        },
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          setState({ status: "success", result, error: null, undone: false });
        })
        .catch((err: unknown) => {
          if (isAbortError(err) || controller.signal.aborted) return;
          setState({
            status: "error",
            result: null,
            error: toRunErrorMessage(err, { target: "record" }),
            undone: false,
          });
        })
        .finally(() => {
          finish(controller);
          setProgress(null);
        });
    },
    [begin, finish, setState],
  );

  /**
   * Undo an insert by deleting exactly the records it created.
   *
   * Only offered for inserts, and only while the result is on screen. An update
   * cannot be undone this way — reversing it would need the values the records
   * held beforehand, which the importer never read.
   */
  const undo = useCallback(async () => {
    const result = state.result;
    if (
      !result ||
      result.operation !== "insert" ||
      result.createdIds.length === 0
    ) {
      return null;
    }
    try {
      const outcome = await deleteRecords(
        result.objectApiName,
        result.createdIds,
      );
      setState((prev) => ({ ...prev, undone: true }));
      return outcome;
    } catch (err) {
      if (isAbortError(err)) return null;
      setState((prev) => ({
        ...prev,
        error: toFriendlyMessage(err, { target: "record" }),
      }));
      return null;
    }
  }, [state.result, setState]);

  const reset = useCallback(() => {
    abort();
    setProgress(null);
    setState({ status: "idle", result: null, error: null, undone: false });
  }, [abort, setState]);

  return { ...state, progress, run, undo, reset };
}
