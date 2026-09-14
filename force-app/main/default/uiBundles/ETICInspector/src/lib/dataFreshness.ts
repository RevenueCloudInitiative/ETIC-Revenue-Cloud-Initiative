/**
 * Keeps reads honest after the app writes something.
 *
 * The Data SDK caches GraphQL query results for **300 seconds**, keyed on the
 * query and its variables. That is a genuine saving while browsing — re-running
 * a search you already ran costs nothing against the org's daily limit — but it
 * is wrong the moment the app itself changes the data:
 *
 * > Export 2,000 records → delete all 2,000 → run the same query again → the
 * > grid shows the 2,000 deleted records, because the identical query is served
 * > from cache. Deleting them a second time then fails with "entity is deleted"
 * > for every row.
 *
 * That was a real, reproduced bug, and the cache made it invisible: no request
 * was issued, so nothing in the network log or the API-usage meter hinted at
 * what was happening.
 *
 * The rule here is deliberately blunt: **once this session writes anything, all
 * subsequent queries bypass the cache until the cache would have expired
 * anyway.** After that window the cached entries are gone and normal caching
 * resumes on its own, so no invalidation bookkeeping is needed and no query can
 * be missed. The cost is bounded — at most 300 seconds of uncached reads
 * following a write, which is exactly the period during which a cached read
 * could have been wrong.
 *
 * This is *not* an app-level cache. It holds one timestamp and decides a flag.
 */

/**
 * The SDK's documented default TTL for a cached GraphQL query.
 * @see CacheControl in `@salesforce/platform-sdk` — "the default `max-age`
 * strategy with a 300-second TTL applies".
 */
export const SDK_CACHE_TTL_MS = 300_000;

let lastMutationAt = 0;

/**
 * Record that this session changed data in the org.
 *
 * Called from every write path, not just the GraphQL ones — an inline edit goes
 * out as a UI API `PATCH`, and it invalidates cached GraphQL reads of the same
 * record just as surely as a mutation does.
 */
export function markDataMutated(now: number = Date.now()): void {
  lastMutationAt = now;
}

/**
 * When this session last changed data, as a timestamp (0 = never).
 *
 * A cache we own can do better than the blunt bypass below. An entry stored
 * *after* the last write already reflects it, so only entries older than this
 * timestamp need dropping — which keeps an edit-then-browse session from
 * re-paying for records it already holds correct copies of.
 *
 * The SDK's GraphQL cache can't use this: we don't control when it stores an
 * entry or what that entry covers. That is precisely why `shouldBypassCache`
 * has to be blunt and `recordDetailCache` does not.
 */
export function getLastMutationAt(): number {
  return lastMutationAt;
}

/**
 * True when a query must go to the network rather than be served from cache.
 *
 * Returns false before any write, so a browse-only session keeps the full
 * benefit of the SDK cache and the app's measured call counts are unchanged.
 */
export function shouldBypassCache(now: number = Date.now()): boolean {
  return lastMutationAt > 0 && now - lastMutationAt < SDK_CACHE_TTL_MS;
}

/** Test seam. Nothing in the app should need to clear this. */
export function resetDataFreshness(): void {
  lastMutationAt = 0;
}
