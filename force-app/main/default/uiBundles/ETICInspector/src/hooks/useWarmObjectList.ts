import { useEffect } from "react";

/**
 * Start the org's object directory downloading at app launch.
 *
 * ## Why at launch, and not when the picker asks
 *
 * `GET /ui-api/object-info` (the directory — see `api/objectList.ts`) has been
 * measured at **10–20 seconds** on a large org, essentially all of it
 * server-side. Nothing in this app can make it faster, so the only lever left
 * is starting it sooner. Mounted from `AppLayout`, the request overlaps the
 * first page chunk, that page's own data calls, and however long the user
 * spends before reaching Data Export or Data Import — typically a few seconds
 * of the wait paid for free.
 *
 * It is a real trade, made deliberately: a session that only ever inspects a
 * record now pays one UI API call and ~107–309 KB for a list it never opens.
 * Data Export and Data Import are the two most-used pages, so the odds favour
 * spending it. `useQueryableObjects`' `ensure()` stays as the fallback for a
 * deep link straight into a picker, where there was no time to warm anything.
 *
 * ## The import is dynamic on purpose
 *
 * `AppLayout` is on the **synchronous entry graph**, so a static
 * `import { listQueryableObjects } from "../api/objectList"` here pulls
 * `sfFetch` — and with it `@salesforce/platform-sdk/data` — into the entry
 * chunk. Measured: 336.06 KB → 417.40 KB raw, 107.52 → 130.96 KB gzip, paid by
 * every route including Users and the 404 page, and paid *before* React mounts
 * and this effect can fire. Deferring the whole module keeps the SDK in the
 * lazy chunks that already need it. The extra chunk round-trip costs the fetch
 * perhaps 50–200 ms of its 10–20 second head start; first paint keeps 23 KB.
 * Same trap as `cn()` in `components/ui/spinner.tsx` — see `ARCHITECTURE-QA.md`
 * §15 before making any import in this file static.
 *
 * Fire-and-forget: nothing renders from it. `listQueryableObjects` never
 * rejects, it carries its own timeout, and the result lands in the cache
 * `useQueryableObjects` reads, so a later `ensure()` is a hit — or, if the user
 * is quicker than the org, joins the request already in flight.
 */
export function useWarmObjectList(): void {
  useEffect(() => {
    // Deliberately not aborted on unmount, unlike the `useInFlight` hooks: the
    // point is to finish and populate the cache. StrictMode's double-invoke is
    // harmless — `createMetadataCache` dedupes the second call onto the first.
    void import("../api/objectList").then((m) => m.listQueryableObjects());
  }, []);
}
