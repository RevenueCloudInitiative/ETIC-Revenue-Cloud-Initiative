/**
 * Searching the org's object list by something other than its exact API name.
 *
 * ## Why this exists
 *
 * The object box used to be free-typed against a 30-name hard-coded list of
 * standard objects, because UI API has no "list all objects" route. That put
 * the whole burden of knowing the API name on the user, and `object-info`
 * answers a name it can't resolve with **403 INSUFFICIENT_ACCESS** — the same
 * response it gives for an object that genuinely exists and is hidden. So a
 * plural, a typo, or a custom object typed without `__c` all came back as an
 * accusation that the admin lacked permission.
 *
 * `api/objectList.ts` now fetches the real list, so the job here is to let a
 * human find a name in it. Two things stand between a user and `OrderItem`:
 * they think in labels ("Order Products"), and they think in words rather than
 * in CamelCase.
 *
 * ## What this can and can't do about labels
 *
 * GraphQL introspection returns names only — every field's `description` is the
 * same constant string, so there are no labels in the payload. Fetching real
 * labels means `object-info` per object, which is exactly the per-keystroke
 * billing this app exists to make visible.
 *
 * The free approximation is to **humanize the API name**: `OpportunityLineItem`
 * becomes "Opportunity Line Item" and `ADP_Details__c` becomes "ADP Details",
 * so word-based searches land without a single extra call. It is an
 * approximation and not a label — searching Salesforce's *label* for
 * `OpportunityLineItem` ("Opportunity Product") still won't match, because the
 * word "Product" appears nowhere in the API name. Labels the app has already
 * paid for elsewhere (picking an object costs an `object-info` call, and that
 * response carries the label) are layered on by the caller.
 */

/**
 * Trailing tokens that are a *type marker* rather than part of the name.
 *
 * Split off before humanizing so `ADP_Details__c` reads as "ADP Details" rather
 * than "ADP Details c". Every one of these must be recognised, or the marker
 * leaks into the searchable text and a search for the object's own words stops
 * matching cleanly.
 */
const TYPE_SUFFIXES = new Set([
  "c", // custom object
  "mdt", // custom metadata type
  "e", // platform event
  "x", // external object
  "b", // big object
  "kav", // knowledge article version
  "ka", // knowledge article
  "chn", // change event channel
  "Share",
  "History",
  "Feed",
  "ChangeEvent",
]);

/**
 * Suffixes marking an object Salesforce generated *for* another object rather
 * than one an admin models data in.
 *
 * These are hidden behind a toggle rather than dropped: `AccountHistory` is a
 * legitimate thing to export, it just shouldn't sit next to `Account` in the
 * results by default. Measured on a real org, 208 of 919 queryable objects were
 * `*History` alone — 23% of the list, none of it what anyone typing "account"
 * is looking for.
 *
 * Platform events (`__e`) are in for the same reason: they're a bus, not a
 * table. Custom metadata types (`__mdt`) are deliberately **out** — an admin
 * authored those by hand and querying them is an ordinary thing to want.
 */
const SYSTEM_SUFFIXES = new Set([
  "Share",
  "History",
  "Feed",
  "ChangeEvent",
  "e",
  "chn",
]);

/** Standard objects carry the same markers without a `__` separator. */
const SYSTEM_STANDARD_PATTERN = /(?:History|Share|Feed|ChangeEvent)$/;

export interface ObjectEntry {
  /** Exactly what gets submitted — the only string Salesforce will accept. */
  apiName: string;
  /** `APXTConga4` for a managed-package object, else null. */
  namespace: string | null;
  /** `OpportunityLineItem` → "Opportunity Line Item". Never empty. */
  humanized: string;
  /** A generated companion object (history, share, feed, change event). */
  system: boolean;
  /**
   * The object's real label, once something in the app has paid for it.
   *
   * Never fetched for the sake of search — it arrives from the `object-info`
   * call that picking an object already costs, so it is present for objects the
   * user has touched this session and null for the rest.
   */
  label: string | null;
}

interface NameParts {
  namespace: string | null;
  base: string;
  suffix: string | null;
}

function splitApiName(apiName: string): NameParts {
  const parts = apiName.split("__");
  let suffix: string | null = null;
  if (parts.length > 1 && TYPE_SUFFIXES.has(parts[parts.length - 1])) {
    suffix = parts.pop() ?? null;
  }
  // Anything still ahead of the name is the managed-package namespace. This is
  // the piece users can't guess, which is why it is surfaced separately rather
  // than left buried in the middle of the string.
  const namespace = parts.length > 1 ? (parts.shift() ?? null) : null;
  return { namespace, base: parts.join("_"), suffix };
}

/** `ADPDetails_ActivityMapping` → "ADP Details Activity Mapping". */
function humanizeBase(base: string): string {
  return (
    base
      .replace(/_/g, " ")
      // A lowercase letter or digit followed by a capital starts a new word.
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      // An acronym run followed by a capitalised word: "ADPDetails" → "ADP Details".
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function describeObject(
  apiName: string,
  label: string | null = null,
): ObjectEntry {
  const { namespace, base, suffix } = splitApiName(apiName);
  const humanized = humanizeBase(base) || apiName;
  const system =
    (suffix !== null && SYSTEM_SUFFIXES.has(suffix)) ||
    (suffix === null && SYSTEM_STANDARD_PATTERN.test(apiName));
  return { apiName, namespace, humanized, system, label };
}

/** True when `query` begins any word of `text`. */
function startsWord(text: string, query: string): boolean {
  if (text.startsWith(query)) return true;
  let from = text.indexOf(" ");
  while (from !== -1) {
    if (text.startsWith(query, from + 1)) return true;
    from = text.indexOf(" ", from + 1);
  }
  return false;
}

/**
 * Tier a match falls into, lowest first. Mirrors `userSearchRank.ts`: the org
 * can't rank for us, so relevance is decided here and alphabetically within
 * each tier.
 *
 * Returns null when the entry doesn't match at all.
 */
function matchTier(entry: ObjectEntry, query: string): number | null {
  const api = entry.apiName.toLowerCase();
  const human = entry.humanized.toLowerCase();
  const label = entry.label?.toLowerCase() ?? "";

  if (api === query) return 0;
  if (api.startsWith(query)) return 1;
  // A word boundary in the readable forms: "line item" finds
  // OpportunityLineItem, "details" finds ADP_Details__c.
  if (startsWord(human, query) || (label !== "" && startsWord(label, query)))
    return 2;
  if (api.includes(query)) return 3;
  if (human.includes(query) || (label !== "" && label.includes(query)))
    return 4;
  return null;
}

export interface RankOptions {
  /** Include generated companion objects (history, share, feed, events). */
  includeSystem?: boolean;
}

/**
 * Entries matching `query`, best first.
 *
 * An empty query matches nothing on purpose. The list runs to hundreds of
 * objects, so an unfiltered dropdown would be a hundred alphabetical rows
 * starting at "Account" — noise in front of a box whose whole job is to narrow.
 */
export function rankObjectMatches(
  entries: readonly ObjectEntry[],
  rawQuery: string,
  options: RankOptions = {},
): ObjectEntry[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const scored: { entry: ObjectEntry; tier: number }[] = [];
  for (const entry of entries) {
    if (entry.system && !options.includeSystem) continue;
    const tier = matchTier(entry, query);
    if (tier === null) continue;
    // System objects never outrank a real one, however well they match — with
    // the toggle on, "account" must still put Account above AccountHistory.
    scored.push({ entry, tier: entry.system ? tier + 10 : tier });
  }

  scored.sort(
    (a, b) => a.tier - b.tier || a.entry.apiName.localeCompare(b.entry.apiName),
  );
  return scored.map((s) => s.entry);
}

/** How many matches the system toggle is currently holding back. */
export function countSystemMatches(
  entries: readonly ObjectEntry[],
  rawQuery: string,
): number {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return 0;
  let count = 0;
  for (const entry of entries) {
    if (entry.system && matchTier(entry, query) !== null) count += 1;
  }
  return count;
}

/**
 * Levenshtein distance, abandoned as soon as it exceeds `limit`.
 *
 * The early exit is what makes this safe to run over a 900-entry list: without
 * it, a full matrix per candidate on every failed lookup is real work for an
 * answer that is thrown away the moment it crosses the threshold.
 */
function editDistance(a: string, b: string, limit: number): number | null {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
      current.push(value);
      if (value < rowBest) rowBest = value;
    }
    if (rowBest > limit) return null;
    previous = current;
  }
  const distance = previous[b.length];
  return distance > limit ? null : distance;
}

/**
 * Closest name to something that didn't resolve, for a "did you mean" line.
 *
 * Only reached after a lookup has already failed, so it runs over the whole
 * list including system objects — if someone typed `AccountHistry`, hiding the
 * answer because of a display toggle would be perverse.
 *
 * Deliberately strict. A suggestion that is merely the least-bad of several
 * hundred names is worse than no suggestion, so a candidate must be within a
 * third of its own length in edits and share a first character.
 */
export function nearestObjectName(
  entries: readonly ObjectEntry[],
  typed: string,
): string | null {
  const query = typed.trim().toLowerCase();
  if (query.length < 3) return null;

  let best: string | null = null;
  let bestDistance = Infinity;

  for (const entry of entries) {
    const candidate = entry.apiName.toLowerCase();
    if (candidate[0] !== query[0]) continue;
    const limit = Math.max(1, Math.floor(candidate.length / 3));
    if (Math.abs(candidate.length - query.length) > limit) continue;
    const distance = editDistance(query, candidate, limit);
    if (distance !== null && distance < bestDistance) {
      bestDistance = distance;
      best = entry.apiName;
    }
  }
  return best;
}
