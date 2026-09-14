import { useCallback, useRef, useState } from "react";
import {
  listQueryableObjects,
  requestFreshObjectList,
  type ObjectListSource,
} from "../api/objectList";
import { getObjectLabel } from "../lib/objectLabels";
import { describeObject, type ObjectEntry } from "../lib/objectSearch";
import { useInFlight } from "./useInFlight";

/**
 * The org's object list, fetched the first time the user reaches for it.
 *
 * ## Why `ensure()` rather than an effect
 *
 * Mounting Data Export would otherwise bill a GraphQL call for a list the
 * session may never open — and landing on the page to re-run a query you
 * already have is the common case. Same principle as `useApiLimit` being
 * strictly passive: the app does not spend the user's daily limit on something
 * they did not ask for. `ensure()` is wired to the object box's focus handler,
 * which reliably precedes the first keystroke, so the list has arrived by the
 * time anything is typed and the search still feels instant.
 *
 * `started` is a ref, so StrictMode's double-invoke and a user clicking in and
 * out of the box cannot fire two requests. `useInFlight` supplies the rest of
 * the house pattern: its controller is aborted on unmount, and the signal is
 * read as the "is this answer still wanted" token so a late response can't set
 * state on a dead component.
 */
export interface UseQueryableObjects {
  /** Every queryable object, described for search. Empty until loaded. */
  entries: readonly ObjectEntry[];
  loading: boolean;
  /** "fallback" when the org wouldn't list them and these are the built-in names. */
  source: ObjectListSource | null;
  /** Load the list if it hasn't been loaded yet. Safe to call on every focus. */
  ensure: () => void;
  /** Throw the list away and fetch it again — for "I just deployed an object". */
  refresh: () => void;
}

export function useQueryableObjects(): UseQueryableObjects {
  const [entries, setEntries] = useState<readonly ObjectEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<ObjectListSource | null>(null);

  /** Whether a fetch has been kicked off at all this mount. */
  const started = useRef(false);
  const { begin, finish } = useInFlight();

  const fetchList = useCallback(() => {
    const controller = begin();
    setLoading(true);
    void listQueryableObjects()
      .then((list) => {
        if (controller.signal.aborted) return;
        // The directory carries a label for every object; `getObjectLabel` is
        // the fallback path's only source, where the built-in names have none
        // and the only labels available are those an `object-info` call
        // elsewhere in the app happened to teach.
        setEntries(
          list.objects.map((object) =>
            describeObject(
              object.apiName,
              object.label ?? getObjectLabel(object.apiName),
            ),
          ),
        );
        setSource(list.source);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
        finish(controller);
      });
  }, [begin, finish]);

  const ensure = useCallback(() => {
    if (started.current) return;
    started.current = true;
    fetchList();
  }, [fetchList]);

  const refresh = useCallback(() => {
    requestFreshObjectList();
    started.current = true;
    fetchList();
  }, [fetchList]);

  return { entries, loading, source, ensure, refresh };
}
