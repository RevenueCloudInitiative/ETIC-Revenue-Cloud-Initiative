/**
 * Every object this user can query, with its label, in one call.
 *
 * ## The endpoint
 *
 * `GET /ui-api/object-info` — no object name in the path — is UI API's
 * [directory of supported objects](https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_resources_object_info_directory.htm).
 * Each entry is light: `apiName`, `label`, `labelPlural`, `keyPrefix`,
 * `nameFields` and a link to that object's full metadata
 * ([entry shape](https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_responses_object_info_directory_entry.htm)).
 *
 * `ARCHITECTURE-QA.md` §7 had recorded this endpoint as a real option while the
 * picker was still a hard-coded list of 30 standard names. The feedback that
 * people were getting errors for objects they could see in Setup is what made
 * it worth spending, and re-reading the note cost one fetch — the standing rule
 * about checking the docs rather than recalling them, paying for itself again.
 * A GraphQL introspection query on the `RecordQuery` type answers nearly the
 * same question, but returns names with **no labels** (every field's
 * `description` is the same constant string) and needs a second transport for a
 * job the metadata layer already owns, so this is the better of the two.
 *
 * ## The property that makes it worth doing
 *
 * The list is **pre-filtered by the org**, which is the whole point — it is not
 * a longer version of the hard-coded list, it is the set of names that cannot
 * fail. Verified against two live orgs (2026-09-11, v67.0) by cross-checking
 * every name against `object-info` for that object:
 *
 * - Objects UI API refuses (`Dashboard`, `Idea`, `ApexClass`,
 *   `PermissionSetAssignment` — HTTP 400 `INVALID_TYPE`) are **absent**.
 * - Objects the org has switched off or the user can't see (`Quote`,
 *   `QuoteLineItem`, `AccountContactRelation` in one of those orgs — HTTP 403)
 *   are **absent**.
 * - Every name that returned 200 is **present**, custom and managed-package
 *   objects included.
 *
 * So a picker built on this cannot offer a name that errors — which is what it
 * replaced a suggestion list that offered three of them.
 *
 * ## Cost
 *
 * One call per session — see {@link OBJECT_LIST_TTL_MS}. Measured: 334 objects /
 * 107 KB and 921 objects / 309 KB. Against what it replaces this is cheap —
 * every *failed* guess costs a full `object-info` round trip, so it pays for
 * itself on the first typo.
 *
 * **Latency, not call count, is what this call actually costs.** On a large org
 * it has been measured at 10–20 seconds, all of it server-side: the client work
 * is a handful of regexes per object (`objectSearch.describeObject`) and does
 * not register. Nothing here can make it faster, so `useWarmObjectList` starts
 * it at app launch and the picker joins whatever is already in flight. The
 * trade that buys is deliberate: a session that never opens a picker now pays
 * one call it doesn't need, in exchange for Data Export and Data Import — the
 * two most-used pages — finding the list already warm.
 *
 * Two things ride along for free, because the payload already carries them:
 * every object's **label** (so the picker can search Salesforce's own words —
 * "Opportunity Product" finds `OpportunityLineItem`, which no amount of
 * humanizing its API name could), and every object's **key prefix**, which
 * teaches `keyPrefixes.ts` the whole org at once instead of one object at a
 * time as Data Import happens to load them.
 */
import { STANDARD_OBJECTS } from "../features/data-export/standardObjects";
import { rememberKeyPrefix } from "../lib/keyPrefixes";
import { createMetadataCache } from "../lib/metadataCache";
import { rememberObjectLabel } from "../lib/objectLabels";
import { uiApiGet } from "../lib/sfFetch";

/**
 * How long the object list may be reused: the whole session.
 *
 * Unbounded rather than `METADATA_CACHE_TTL_MS`'s minute, because the two answer
 * different questions. A field list changes whenever someone edits a field in
 * Setup, which is why picking an object forces a refresh. *Which objects exist*
 * changes only on a metadata deploy or a permission change, the payload is two
 * orders of magnitude larger, and on a large org this call has been measured at
 * **10–20 seconds** — so an expiry here buys a rare correctness win and charges a
 * 20-second wait for it.
 *
 * A timed TTL was also never doing what its name suggested.
 * `useQueryableObjects` guards `ensure()` with a per-mount ref, so an expiry
 * could only ever fire by navigating away and back after the window had passed.
 * The case it claimed to cover — deploying an object and going straight to it —
 * was always served by the picker's refresh link instead, and that link is now
 * the only way to re-ask the org short of a page reload.
 */
export const OBJECT_LIST_TTL_MS = Infinity;

/**
 * How long one attempt at the directory may run before it is abandoned.
 *
 * Not a performance dial — a stuck-promise guard. `sfFetch` imposes no timeout
 * of its own, and `createMetadataCache` clears its in-flight entry from a
 * `.finally`, which a request that never settles never reaches. Under an
 * unbounded TTL that entry would then be joined by every later `ensure()` for
 * the life of the tab, so the picker would spin forever with no way out but a
 * reload. An abort rejects instead: the in-flight entry clears, and the next
 * focus retries.
 *
 * Sixty seconds rather than thirty, because the slowest measured response is
 * 20s and cutting off a slow-but-alive org would trade a long wait for a silent
 * fallback to the 30-name list. This should only ever fire on a true hang.
 */
const OBJECT_LIST_TIMEOUT_MS = 60_000;

/** One entry of the directory response. */
interface DirectoryEntry {
  apiName?: string;
  label?: string;
  keyPrefix?: string | null;
}

interface ObjectDirectory {
  objects?: Record<string, DirectoryEntry> | null;
}

export interface ObjectSummary {
  apiName: string;
  /** Salesforce's own label. Null only on the fallback list, which has none. */
  label: string | null;
}

/** Where the names on screen came from, so the UI can say so when it matters. */
export type ObjectListSource = "org" | "fallback";

export interface QueryableObjects {
  objects: readonly ObjectSummary[];
  source: ObjectListSource;
}

const _cache =
  createMetadataCache<readonly ObjectSummary[]>(OBJECT_LIST_TTL_MS);
const CACHE_KEY = "queryable-objects";

async function fetchObjectDirectory(
  signal?: AbortSignal,
): Promise<readonly ObjectSummary[]> {
  const directory = await uiApiGet<ObjectDirectory>("/ui-api/object-info", {
    signal,
  });

  const objects: ObjectSummary[] = [];
  for (const entry of Object.values(directory.objects ?? {})) {
    const apiName = entry?.apiName;
    if (!apiName) continue;
    const label = entry.label ?? null;
    // Same doctrine as `parseObjectInfo`: the org's answer is recorded as it
    // goes past, and nothing is fetched for the sake of recording it. This one
    // response teaches every prefix and every label at once.
    rememberKeyPrefix(entry.keyPrefix ?? null, apiName);
    rememberObjectLabel(apiName, label);
    objects.push({ apiName, label });
  }

  // An empty directory is a failure wearing a success's clothes — it would
  // cache a picker that can never match anything. Throwing routes it to the
  // fallback, and `createMetadataCache` never stores a rejection, so the next
  // attempt retries rather than being pinned to the short list for the rest of
  // the session.
  if (objects.length === 0) {
    throw new Error("Object directory returned no objects.");
  }

  objects.sort((a, b) => a.apiName.localeCompare(b.apiName));
  return objects;
}

/**
 * Every object this user can query, or the hard-coded standard names if the org
 * won't say.
 *
 * Never rejects. The fallback matters because the box it feeds must keep
 * working: the picker still accepts a freely typed API name, exactly as it did
 * before this existed, so falling back costs discoverability and nothing else.
 */
export async function listQueryableObjects(): Promise<QueryableObjects> {
  try {
    // The signal belongs to the *attempt*, not to a caller. Concurrent callers
    // share one request through the cache's in-flight map, so a caller-supplied
    // signal would let whoever arrived second cancel the request the first is
    // still waiting on.
    const objects = await _cache.load(CACHE_KEY, () =>
      fetchObjectDirectory(AbortSignal.timeout(OBJECT_LIST_TIMEOUT_MS)),
    );
    return { objects, source: "org" };
  } catch {
    // Reached by the timeout above as well as by a real failure. Neither is
    // cached, so the next caller retries rather than inheriting the short list.
    return {
      objects: STANDARD_OBJECTS.map((apiName) => ({ apiName, label: null })),
      source: "fallback",
    };
  }
}

/**
 * Forget the cached list so the next read asks the org again.
 *
 * For the refresh link the picker shows when a name isn't in the list: deploying
 * a new object and not finding it in the box is the complaint the metadata TTL
 * was invented to answer. Since {@link OBJECT_LIST_TTL_MS} is unbounded, this is
 * the only way to re-ask the org short of reloading the page — which would cost
 * the 10–20 second fetch again anyway.
 */
export function requestFreshObjectList(): void {
  _cache.requestFresh(CACHE_KEY);
}
