import { useEffect, useState } from "react";
import {
  getPicklistValues,
  MASTER_RECORD_TYPE_ID,
  type PicklistMap,
} from "../api/picklists";
import { isAbortError } from "../lib/sfFetch";

interface PicklistState {
  picklists: PicklistMap | null;
  loading: boolean;
  /** Null unless the fetch failed; the UI degrades to a text input. */
  error: string | null;
}

/** Stable empty identity — a fresh `{}` would break every downstream memo. */
const NONE: PicklistMap = Object.freeze({});

const IDLE: PicklistState = { picklists: null, loading: false, error: null };
const LOADING: PicklistState = { picklists: null, loading: true, error: null };

/** What the last completed fetch was for, so a stale answer can't be shown. */
interface Loaded {
  key: string;
  picklists: PicklistMap;
  error: string | null;
}

/**
 * Picklist options for an object, fetched lazily.
 *
 * `enabled` is the whole point: this costs one API call, so nothing is
 * requested until something on screen actually needs a dropdown. A page that
 * shows no picklist editor never pays for one. Once fetched, the api layer
 * memoizes for the session, so remounting or reopening an editor is free.
 *
 * State is written only from the request's own callbacks, never from the effect
 * body — the "nothing requested" and "waiting" states are derived from the
 * request key instead. Tagging the result with that key is also what stops one
 * object's picklists from being shown for another after a switch.
 */
export function usePicklistValues(
  objectApiName: string | null | undefined,
  recordTypeId: string | null | undefined,
  enabled: boolean,
): PicklistState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const recordType = recordTypeId || MASTER_RECORD_TYPE_ID;
  const key =
    enabled && objectApiName ? `${objectApiName}:${recordType}` : null;

  useEffect(() => {
    if (!key || !objectApiName) return;

    const controller = new AbortController();

    getPicklistValues(objectApiName, recordType, { signal: controller.signal })
      .then((picklists) => {
        if (controller.signal.aborted) return;
        setLoaded({ key, picklists, error: null });
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        // Not fatal: the editors fall back to free text, which is what they
        // did before picklists were wired up at all.
        setLoaded({
          key,
          picklists: NONE,
          error:
            err instanceof Error
              ? err.message
              : "Could not load picklist values.",
        });
      });

    return () => {
      controller.abort();
    };
  }, [key, objectApiName, recordType]);

  if (!key) return IDLE;
  if (loaded?.key !== key) return LOADING;
  return { picklists: loaded.picklists, loading: false, error: loaded.error };
}
