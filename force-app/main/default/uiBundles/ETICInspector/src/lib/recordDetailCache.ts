/**
 * Bounded, session-lived cache of loaded records — with an expiry policy.
 *
 * Survives component unmounts (switching tabs away from All Data and back)
 * without growing without limit. Keys are canonical 18-character Ids so the
 * same record reached via its 15-char form is a cache hit, not a second fetch.
 *
 * ## Why this file has a policy at all
 *
 * It used to have none: an entry lived until the Refresh button removed it, so
 * a record loaded once was frozen for the rest of the session. That shipped a
 * reproducible bug — load Account A, load Account B, have A changed in
 * Salesforce by anyone (including this same user in another tab), reopen A, and
 * the grid replays the copy from before the change. **No request is issued at
 * all**, so nothing in the network log or the API-usage meter hints at why.
 *
 * That is the same failure `lib/dataFreshness.ts` documents for the SDK's
 * GraphQL cache, on the other transport. Show all data never touches GraphQL —
 * it reads UI API REST through `sfFetch`, and the SDK caches only GraphQL
 * (`buildCachedGraphQL`: "queries hit the OneStore cache"; `sdk.fetch` carries
 * CSRF handling and nothing else). So the SDK's cache-control could not have
 * fixed it, and this module had to grow the same doctrine itself.
 *
 * ## The rule
 *
 * A cached record is served only when **all three** hold:
 *
 * 1. **It is younger than {@link RECORD_CACHE_TTL_MS}.** Age is the only thing
 *    we know about data changed by someone else, and the cache's real job —
 *    tab-switching and back-and-forth between records — plays out in seconds.
 * 2. **It is at least as new as this session's last write.** Not a blunt
 *    bypass: an entry stored *after* the write already reflects it, so an
 *    inline edit doesn't make the user re-pay ~9 API calls for the record they
 *    just saved and are still looking at. Entries predating the write are
 *    dropped, which also catches records changed indirectly by a trigger,
 *    roll-up or flow that our write set off.
 * 3. **Nobody explicitly asked for the record.** Submitting an Id, or pressing
 *    "Show all data", is a request for *current* data — see
 *    {@link requestFreshDetail}.
 *
 * Rules 1 and 2 lapse on their own, so there is no invalidation bookkeeping to
 * get wrong and no write path that can be forgotten.
 */
import type { RecordDetail } from "../api/recordDetail";
import { getLastMutationAt } from "./dataFreshness";
import { toRecordId18 } from "./salesforce";

/**
 * A record's field list is large (hundreds of rows). Ten is enough to make
 * back-and-forth navigation instant without holding a session's worth of
 * records in memory.
 */
const MAX_ENTRIES = 10;

/**
 * How long a loaded record may be reused without asking Salesforce again.
 *
 * One minute, chosen for freshness over cost on the user's explicit
 * instruction. Explicit requests bypass the cache outright regardless of this
 * value, so all this window governs is *incidental* reads — a tab switch back
 * to All Data, a browser Back, a remount — and those play out in seconds. Past
 * a minute the cache is no longer saving the user a wait, it is only raising
 * the odds of showing a record somebody else has since changed.
 *
 * The cost of shortening it is bounded and small: at worst one record reload
 * (~1 + N + 1 calls) per tab switch that lands more than a minute later.
 */
export const RECORD_CACHE_TTL_MS = 60_000;

interface Entry {
  detail: RecordDetail;
  /** When this entry was stored, for the TTL and write-generation checks. */
  cachedAt: number;
}

/** Map preserves insertion order, which is all an LRU needs. */
const cache = new Map<string, Entry>();
let lastRecordId: string | null = null;

export function cacheKey(recordId: string): string {
  return toRecordId18(recordId);
}

export function getCachedDetail(
  recordId: string,
  now: number = Date.now(),
): RecordDetail | undefined {
  const key = cacheKey(recordId);
  const hit = cache.get(key);
  if (!hit) return undefined;

  // Aged out, or older than something this session wrote. Either way the entry
  // can never be served again, so drop it rather than re-testing it on every
  // read.
  if (now - hit.cachedAt >= RECORD_CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  if (hit.cachedAt < getLastMutationAt()) {
    cache.delete(key);
    return undefined;
  }

  // Refresh recency.
  cache.delete(key);
  cache.set(key, hit);
  return hit.detail;
}

export function setCachedDetail(
  recordId: string,
  detail: RecordDetail,
  now: number = Date.now(),
): void {
  const key = cacheKey(recordId);
  cache.delete(key);
  cache.set(key, { detail, cachedAt: now });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  lastRecordId = key;
}

export function invalidateCachedDetail(recordId: string): void {
  cache.delete(cacheKey(recordId));
}

/**
 * The record no longer exists — drop it and stop offering to restore it.
 *
 * Deleting needs more than {@link invalidateCachedDetail}. `lastRecordId` is
 * what Show all data loads when it is reached without an Id in the query string
 * (a tab switch, or the nav link), so a record that was only *invalidated*
 * would be fetched again on the next visit and answered with a NOT_FOUND the
 * user never asked for — one wasted call, and an error screen for a deletion
 * that succeeded.
 */
export function forgetRecord(recordId: string): void {
  const key = cacheKey(recordId);
  cache.delete(key);
  if (lastRecordId === key) lastRecordId = null;
}

/**
 * The user just asked for this record — the next read must hit the network.
 *
 * Same reasoning as `GraphQLCallOptions.fresh` in `api/graphqlClient.ts`, and
 * deliberately worded as intent rather than as invalidation: a cache hit is
 * only possible for a record we already hold, and nobody types an Id or presses
 * "Show all data" for a record on their screen except to see its current state.
 * The cache's benefit on *these* reads is therefore zero by construction, while
 * its cost is a wrong answer.
 *
 * Call it from the explicit entry points only. A remount, a tab switch, or the
 * page restoring the last-viewed record must **not** call it — those are
 * incidental reads, they are what the cache exists for, and marking them fresh
 * would re-bill the org every time the user glances back at All Data.
 */
export function requestFreshDetail(recordId: string): void {
  cache.delete(cacheKey(recordId));
}

/** The most recently loaded record Id (for restoring on remount). */
export function getLastRecordId(): string | null {
  return lastRecordId;
}

/** Test seam. Nothing in the app should need to clear the whole cache. */
export function resetRecordDetailCache(): void {
  cache.clear();
  lastRecordId = null;
}
