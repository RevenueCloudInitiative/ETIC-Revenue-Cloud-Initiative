import { useCallback, useEffect, useRef, useState } from "react";
import {
  getObjectFields,
  peekObjectFields,
  requestFreshObjectFields,
  sameObjectFields,
  type ObjectFields,
} from "../api/dataExport";
import { clearPicklistCache } from "../api/picklists";
import { toFriendlyMessage } from "../lib/errors";

/**
 * Picking an object: answer instantly, then check with the org.
 *
 * ## The problem this replaces
 *
 * Both object pickers used to do the same three things in the same order —
 * `requestFreshObjectFields`, `clearPicklistCache`, `await getObjectFields` —
 * which forces a network round-trip on **every** pick, including one for an
 * object loaded ten seconds earlier. Measured against a live org through the
 * CLI dev proxy: 709 ms, 524 ms, and 276 ms for the *same* object picked again.
 * The forced refresh is there for a real reason (add a field in Setup, re-pick,
 * see it), but paying it in front of the user every time is the wrong place to
 * put the cost.
 *
 * ## Stale-while-revalidate, with the emphasis on *only when it changed*
 *
 * A cache hit is served synchronously, so the box resolves with no wait at all.
 * The refresh still happens, behind the user; when it comes back it is compared
 * against what was served, and **only a real difference reaches the page**.
 * That last part is what makes this safe rather than merely fast:
 *
 * - Re-applying identical metadata would hand the page a new `fields` identity,
 *   and every memo keyed on it — Data Import's dry run over every pasted row
 *   included — would recompute for nothing.
 * - More importantly, the two callbacks are **not** the same. Picking an object
 *   is a licence to throw away the query or the column mapping, because they
 *   described a different object. A background refresh is not: the object is
 *   the same one, only its field list moved. `onRefreshed` therefore gets a
 *   deliberately narrower job than `onPicked`, and the difference check is what
 *   guarantees the destructive path runs only when the user actually asked.
 *
 * The staleness is bounded by the metadata TTL, since `peek` returns nothing
 * once an entry ages out — an entry older than that goes down the blocking path
 * exactly as before.
 */
export interface UseObjectLoader {
  /** True only while a pick with nothing to show is waiting on the network. */
  loading: boolean;
  error: string | null;
  load: (objectApiName: string) => void;
}

export function useObjectLoader(callbacks: {
  /**
   * A different object is now the subject. The page may reset whatever the old
   * object's metadata was propping up.
   */
  onPicked: (fields: ObjectFields) => void;
  /**
   * The background check disagreed with the cached copy that was already
   * served. Same object, newer field list — update the metadata and leave the
   * user's work alone.
   */
  onRefreshed: (fields: ObjectFields, previous: ObjectFields) => void;
}): UseObjectLoader {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Callbacks read through a ref so `load` stays referentially stable however
   * the caller writes them. An inline arrow at the call site would otherwise
   * make `load` a new function every render, and it is handed straight to the
   * object picker.
   *
   * Written from an effect rather than during render — a ref assignment in the
   * render body is what `react-hooks/set-state-in-effect`'s sibling rule
   * rejects, and there is no need for it here: `load` only ever runs from an
   * event handler, which is long after the effect has committed.
   */
  const latest = useRef(callbacks);
  useEffect(() => {
    latest.current = callbacks;
  });

  /**
   * The object the newest pick is for.
   *
   * Picking B while A is still in flight has to discard A's answer — without
   * this, A's late response overwrites B and the page shows metadata for an
   * object the box no longer names. Not an abort: the response is going into
   * the cache either way, so the call is not wasted, only ignored.
   */
  const wanted = useRef<string | null>(null);

  const load = useCallback((objectApiName: string) => {
    const name = objectApiName.trim();
    if (!name) return;
    wanted.current = name;
    setError(null);

    // Serve what we already have, if it is still within the metadata TTL.
    const cached = peekObjectFields(name);
    if (cached) latest.current.onPicked(cached);
    else setLoading(true);

    // Picking an object is an explicit request for it as it is *now*, so the
    // refresh happens either way — it just no longer blocks the screen.
    requestFreshObjectFields(name);
    clearPicklistCache(name);

    void getObjectFields(name)
      .then((fresh) => {
        if (wanted.current !== name) return;
        if (!cached) latest.current.onPicked(fresh);
        else if (!sameObjectFields(cached, fresh))
          latest.current.onRefreshed(fresh, cached);
      })
      .catch((err: unknown) => {
        if (wanted.current !== name) return;
        // With a cached copy already on screen, a failed background check is
        // not the user's problem, and replacing correct metadata with an error
        // banner would be a worse answer than the slightly older truth.
        if (!cached) {
          setError(toFriendlyMessage(err, { query: name, target: "object" }));
        }
      })
      .finally(() => {
        if (wanted.current === name) setLoading(false);
      });
  }, []);

  return { loading, error, load };
}
