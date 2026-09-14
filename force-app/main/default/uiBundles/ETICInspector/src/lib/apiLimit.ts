/**
 * Daily API-usage tracking, sourced from the `Sforce-Limit-Info` response
 * header that rides along on every Salesforce API response.
 *
 * This lives in its own module (rather than inside a data module) so that
 * `sfFetch` can record a snapshot from *every* call without creating an import
 * cycle. Previously only the home-page path captured the header, so the page
 * making ~7 calls contributed nothing to the meter while the page making one
 * contributed everything.
 */

export interface ApiLimit {
  max: number;
  remaining: number;
  used: number;
  usedPercent: number;
}

let _lastLimit: ApiLimit | null = null;
const _subscribers = new Set<(limit: ApiLimit) => void>();

/** Subscribe to limit updates. Fires immediately if a snapshot already exists. */
export function subscribeApiLimit(fn: (limit: ApiLimit) => void): () => void {
  _subscribers.add(fn);
  if (_lastLimit) fn(_lastLimit);
  return () => {
    _subscribers.delete(fn);
  };
}

export function getLastApiLimit(): ApiLimit | null {
  return _lastLimit;
}

/**
 * Read `Sforce-Limit-Info` off a response and notify subscribers.
 * No-ops when the header is absent (some runtime surfaces don't expose it),
 * which is what keeps the nav widget hidden rather than showing zeroes.
 */
export function captureLimitHeader(res: Response): void {
  const raw = res.headers.get("Sforce-Limit-Info");
  if (!raw) return;
  const match = /api-usage=(\d+)\/(\d+)/.exec(raw);
  if (!match) return;

  const used = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) return;

  const snapshot: ApiLimit = {
    used,
    max,
    remaining: Math.max(max - used, 0),
    usedPercent: Math.round((used / max) * 100),
  };
  _lastLimit = snapshot;
  _subscribers.forEach((fn) => fn(snapshot));
}
