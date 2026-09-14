/**
 * The single Salesforce request path for the whole app.
 *
 * Everything funnels through here so that four concerns are handled in exactly
 * one place instead of being duplicated (and drifting) per data module:
 *   1. Data SDK acquisition + availability check
 *   2. `Sforce-Limit-Info` capture on every response
 *   3. Cancellation via AbortSignal
 *   4. HTTP status -> InspectorError mapping
 *
 * Sanctioned MFW paths only. We never call fetch()/axios directly.
 */
import { createDataSDK } from "@salesforce/platform-sdk/data";
import { captureLimitHeader } from "./apiLimit";
import { codeFromUiApiError, InspectorError } from "./errors";
import { API_VERSION } from "./salesforce";

/**
 * Thrown when a request is abandoned because the caller moved on (e.g. the
 * user typed a different record Id). Callers must swallow this rather than
 * surfacing it as a user-facing error.
 */
export class AbortedError extends Error {
  constructor() {
    super("Request aborted");
    this.name = "AbortedError";
  }
}

/** True for both our own AbortedError and the platform's DOMException. */
export function isAbortError(error: unknown): boolean {
  if (error instanceof AbortedError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export interface SfRequestInit {
  signal?: AbortSignal;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

let _sdkPromise: ReturnType<typeof createDataSDK> | null = null;
function getSdk() {
  if (!_sdkPromise) _sdkPromise = createDataSDK();
  return _sdkPromise;
}

/**
 * Issue a request against `/services/data/{version}{path}`.
 *
 * The signal is forwarded to the SDK for true network cancellation, and we
 * *also* re-check it after every await. The second check is what actually
 * guarantees an abandoned request can never resolve into a state update, even
 * if the SDK's fetch implementation ignores the signal.
 */
export async function sfFetch(
  path: string,
  init: SfRequestInit = {},
): Promise<Response> {
  const { signal } = init;
  if (signal?.aborted) throw new AbortedError();

  const sdk = await getSdk();
  if (signal?.aborted) throw new AbortedError();

  if (!sdk.fetch) {
    throw new InspectorError(
      "SDK_UNAVAILABLE",
      "Data SDK fetch is unavailable in this runtime surface.",
    );
  }

  let res: Response;
  try {
    res = await sdk.fetch(`/services/data/${API_VERSION}${path}`, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal,
    });
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw new AbortedError();
    throw new InspectorError("NETWORK", "Network request failed.", error);
  }

  if (signal?.aborted) throw new AbortedError();

  // Every response carries the usage header — record it regardless of status.
  captureLimitHeader(res);

  return res;
}

/**
 * UI API's own error code and message, when the body carries them.
 *
 * Worth reading rather than throwing away, because the HTTP status alone loses
 * the only distinction that matters on an object lookup. `object-info` answers
 * 400 for *"Object Dashboard is not supported in UI API"* — a real object name
 * this app simply cannot query — and the status maps that to "invalid API
 * name", which is false and sends the user off to check a spelling that was
 * right. The errorCode is what separates the two.
 *
 * Never throws: a body that isn't the shape we expect, or can't be read at all,
 * just means falling back to the status. The response has already failed; a
 * parse failure on top of it must not replace the error with a different one.
 */
async function readErrorDetail(
  res: Response,
): Promise<{ errorCode?: string; message?: string } | null> {
  try {
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) return null;
    const body: unknown = await res.json();
    // UI API sends a bare array for most failures and a single object for
    // some. Both shapes appear on routes this app calls.
    const first = Array.isArray(body) ? body[0] : body;
    if (typeof first !== "object" || first === null) return null;
    const { errorCode, message } = first as {
      errorCode?: unknown;
      message?: unknown;
    };
    return {
      errorCode: typeof errorCode === "string" ? errorCode : undefined,
      message: typeof message === "string" ? message : undefined,
    };
  } catch {
    return null;
  }
}

/** GET a UI API resource and parse it as JSON. */
export async function uiApiGet<T>(
  path: string,
  init: SfRequestInit = {},
): Promise<T> {
  const res = await sfFetch(path, init);

  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new InspectorError(
      codeFromUiApiError(res.status, detail?.errorCode),
      `UI API request failed (${res.status}) for ${path}` +
        (detail?.message ? `: ${detail.message}` : ""),
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    // Hitting the app outside the Salesforce proxy returns HTML, not JSON.
    throw new InspectorError(
      "SDK_UNAVAILABLE",
      `Expected JSON but received "${contentType || "unknown"}" for ${path}. ` +
        "Are you connecting through the Salesforce CLI proxy URL (sf ui-bundle dev)?",
    );
  }

  const parsed = (await res.json()) as T;
  if (init.signal?.aborted) throw new AbortedError();
  return parsed;
}
