/**
 * Object labels the app has already paid for.
 *
 * The object list comes from GraphQL introspection, which carries names and no
 * labels (see `api/objectList.ts`), so the picker searches a humanized form of
 * the API name. Real labels exist, but only behind an `object-info` call per
 * object — per-keystroke billing, in an app whose nav bar shows the user what
 * it is costing them.
 *
 * What it *can* have for free is the label of every object something in the app
 * has already loaded, because that response carried one. Same doctrine as
 * `rememberKeyPrefix` in `keyPrefixes.ts`, which learns from exactly the same
 * place: the org's own answer is recorded as it goes by, and nothing is fetched
 * for the sake of recording it.
 *
 * The effect is that labels accumulate over a session — pick Opportunity once
 * and "Opportunity Product" starts finding `OpportunityLineItem` for the rest
 * of it — while a cold page falls back to the humanized name. Deliberately a
 * module-level map and not `localStorage`, for the reason `sessionState.ts`
 * gives: the security assessment states as a verified fact that this app
 * persists nothing in the browser.
 */
const _labels = new Map<string, string>();

/**
 * Record what Salesforce called this object.
 *
 * Called from `parseObjectInfo`, so every object loaded anywhere in the app —
 * the Home page, a lookup expansion, Data Import's auto-fill — teaches the
 * picker, not just an explicit pick on the Data Export page.
 */
export function rememberObjectLabel(
  apiName: string | null | undefined,
  label: string | null | undefined,
): void {
  if (!apiName || !label) return;
  _labels.set(apiName, label);
}

/** The label learned for this object, or null if nothing has loaded it yet. */
export function getObjectLabel(apiName: string): string | null {
  return _labels.get(apiName) ?? null;
}

/** Test seam. Nothing in the app clears this — a label cannot go stale enough to matter. */
export function clearObjectLabels(): void {
  _labels.clear();
}
