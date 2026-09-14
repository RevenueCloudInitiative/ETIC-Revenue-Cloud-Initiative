/**
 * Shared expiry policy for cached Salesforce **metadata** — object field maps
 * and picklist values.
 *
 * ## Why this exists
 *
 * `dataExport.ts` and `picklists.ts` each hand-rolled a `Map` that cached for
 * the whole session with **no expiry and no way to refresh**. Both shipped the
 * same complaint in different clothes: add a field, or a picklist value, in
 * Setup, and the app cannot see it until the page is reloaded. `picklists.ts`
 * even exported a `clearPicklistCache` "used when the user asks for genuinely
 * fresh metadata" — and nothing but its own tests ever called it.
 *
 * They had also already drifted in a way that cost real API calls. Picklists
 * deduplicated concurrent misses through an `inFlight` map; object metadata did
 * not, so two simultaneous requests for the same object both reached the
 * network. That is the trap documented at `FieldPicker.tsx`'s `toggleExpand`,
 * where StrictMode's double-invoke made one lookup expansion cost 2 calls
 * instead of 1. Folding both onto this module gives object metadata the
 * deduplication for free.
 *
 * ## What this does *not* borrow from `recordDetailCache`
 *
 * That cache drops any entry older than the session's last write. Metadata gets
 * **no such rule, deliberately**: this app writes records, never metadata — no
 * Apex, no Metadata API, only record PATCHes and `uiapi` mutations. A field's
 * type and a picklist's values cannot change because a row was imported, so
 * expiring them on a write would re-fetch a constant and bill the org for it.
 * Age and an explicit request are the only two signals that mean anything here.
 */

/**
 * How long metadata may be reused without asking Salesforce again.
 *
 * A separate dial from `RECORD_CACHE_TTL_MS` even though both currently hold
 * the same value, because the cost of a miss differs by roughly an order of
 * magnitude: re-reading one object's metadata is a single `object-info` call,
 * while reloading a record is ~1 + N + 1.
 */
export const METADATA_CACHE_TTL_MS = 60_000;

interface Entry<T> {
  value: T;
  cachedAt: number;
}

export interface MetadataCache<T> {
  /**
   * Serve `key` from cache, or run `loader` and store the result.
   *
   * Concurrent misses for the same key share one request — without this, any
   * caller that fires twice before the first resolves pays twice, and a cache
   * that stores only on success cannot prevent it.
   */
  load(key: string, loader: () => Promise<T>, now?: number): Promise<T>;
  /** The cached value, if one is present and still fresh. No fetch. */
  peek(key: string, now?: number): T | undefined;
  /**
   * The user explicitly asked for this metadata — the next read must hit the
   * network. Same doctrine as `requestFreshDetail` in `recordDetailCache`:
   * picking an object is a request for that object as it is *now*, whereas
   * expanding a lookup to browse its fields is incidental and stays cached.
   */
  requestFresh(key: string): void;
  /** Drop every key at or beneath `prefix` (picklists key on `object:type`). */
  invalidatePrefix(prefix: string): void;
  clear(): void;
}

export function createMetadataCache<T>(
  ttlMs: number = METADATA_CACHE_TTL_MS,
): MetadataCache<T> {
  const entries = new Map<string, Entry<T>>();
  const inFlight = new Map<string, Promise<T>>();

  function peek(key: string, now: number = Date.now()): T | undefined {
    const hit = entries.get(key);
    if (!hit) return undefined;
    // Aged out. Drop it rather than re-testing it on every subsequent read.
    if (now - hit.cachedAt >= ttlMs) {
      entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  return {
    peek,

    load(
      key: string,
      loader: () => Promise<T>,
      now: number = Date.now(),
    ): Promise<T> {
      const hit = peek(key, now);
      if (hit !== undefined) return Promise.resolve(hit);

      const pending = inFlight.get(key);
      if (pending) return pending;

      // A failure is never cached: the `.finally` clears the in-flight entry
      // while the rejection propagates, so the next caller retries.
      //
      // The entry is stamped with `now` — when the request was *issued* — not
      // with the clock at the moment it resolved. One clock per call keeps an
      // injected one meaningful, and dating the entry from the request rather
      // than the response errs on the side of expiring early, which is the
      // side this cache is supposed to err on.
      const request = loader()
        .then((value) => {
          entries.set(key, { value, cachedAt: now });
          return value;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, request);
      return request;
    },

    requestFresh(key: string): void {
      entries.delete(key);
    },

    invalidatePrefix(prefix: string): void {
      for (const key of [...entries.keys()]) {
        if (key === prefix || key.startsWith(prefix)) entries.delete(key);
      }
    },

    clear(): void {
      entries.clear();
    },
  };
}
