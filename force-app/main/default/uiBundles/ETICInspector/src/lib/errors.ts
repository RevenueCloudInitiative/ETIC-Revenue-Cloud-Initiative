/**
 * Central place to turn known/predictable failures into friendly, actionable
 * messages. Anything not explicitly mapped falls back to a safe generic line.
 */

export type InspectorErrorCode =
  | "NOT_FOUND" // record or object doesn't exist
  | "NO_ACCESS" // FLS / object / record not visible to this user
  | "UNSUPPORTED_OBJECT" // real object, but UI API refuses to serve it
  | "INVALID_ID" // malformed id / bad checksum reached the API
  | "BAD_REQUEST" // 400 we couldn't classify further
  | "SESSION_EXPIRED" // 401
  | "RATE_LIMITED" // 429
  | "SERVER" // 5xx
  | "NETWORK" // fetch threw / offline
  | "SDK_UNAVAILABLE" // Data SDK surface missing
  | "UNKNOWN";

export class InspectorError extends Error {
  readonly code: InspectorErrorCode;
  readonly cause?: unknown;
  constructor(code: InspectorErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "InspectorError";
    this.code = code;
    this.cause = cause;
  }
}

/** Map an HTTP status from a UI-API call to an error code. */
export function codeFromHttpStatus(status: number): InspectorErrorCode {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "SESSION_EXPIRED";
  if (status === 403) return "NO_ACCESS";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER";
  return "UNKNOWN";
}

/**
 * Same mapping, refined by UI API's own `errorCode` when the body carried one.
 *
 * Only one refinement so far, and it earns its place: `INVALID_TYPE` arrives as
 * a 400, which the status mapping calls `BAD_REQUEST` and the copy renders as
 * "isn't a valid object API name". Measured against a live org (2026-09-11,
 * v67.0), that is what `Dashboard`, `Idea`, `Vote`, `Site`, `AccountShare`,
 * `ApexClass`, `LoginHistory` and `PermissionSetAssignment` all produce — every
 * one a real object with a correctly spelled name, none of them served by UI
 * API. Telling an admin the name is invalid sends them to re-check a spelling
 * that was right all along.
 */
export function codeFromUiApiError(
  status: number,
  errorCode?: string,
): InspectorErrorCode {
  if (errorCode === "INVALID_TYPE") return "UNSUPPORTED_OBJECT";
  return codeFromHttpStatus(status);
}

interface FriendlyContext {
  /** The raw thing the user searched for, for a more specific message. */
  query?: string;
  /** "record" | "object" — what we were trying to resolve. */
  target?: "record" | "object";
}

/**
 * Produce a friendly message from any thrown value.
 * Always returns a string safe to show the user.
 */
export function toFriendlyMessage(
  err: unknown,
  ctx: FriendlyContext = {},
): string {
  const q = ctx.query ? `"${ctx.query}"` : "that";

  // Network / offline (fetch throws a TypeError, not an HTTP response).
  if (err instanceof TypeError) {
    return "Couldn't reach Salesforce. Check your connection and try again.";
  }

  if (err instanceof InspectorError) {
    switch (err.code) {
      case "NOT_FOUND":
        return ctx.target === "object"
          ? `No object matches ${q}. Check the API name and try again.`
          : `No record found for ${q}. It may have been deleted, or you might not have access to it.`;
      case "UNSUPPORTED_OBJECT":
        return `${q} is a real object, but Salesforce's UI API doesn't serve it — so it can't be queried here.`;
      case "NO_ACCESS":
        // An object lookup must not assert a cause here, because Salesforce
        // doesn't give us one. `object-info` has no "not found" response: every
        // unresolvable name — a plural, a typo, a custom object missing its
        // `__c` — returns the same 403 INSUFFICIENT_ACCESS as an object that
        // genuinely exists and is hidden. Verified against a live org
        // (2026-09-11, v67.0): `Accounts`, `Opportunty` and `Foo__c` are all
        // indistinguishable from a real permission problem at this layer.
        //
        // The old copy picked the *less* likely of the two causes and stated it
        // as fact, which is what sent admins hunting permission problems that
        // didn't exist. Naming both, spelling first, is the honest version.
        return ctx.target === "object"
          ? `Couldn't open ${q} — either no object has that API name, or it isn't visible to you. Check the spelling: custom objects end in "__c", and objects from a managed package need their namespace (ns__Object__c).`
          : `You don't have permission to view ${q}. Ask your admin to check object and field-level access.`;
      case "INVALID_ID":
        return `${q} isn't a valid Salesforce Id — check for a mistyped character.`;
      case "BAD_REQUEST":
        return ctx.target === "object"
          ? `${q} isn't a valid object API name.`
          : `${q} couldn't be resolved. Make sure it's a valid record Id or object name.`;
      case "SESSION_EXPIRED":
        return "Your session expired. Refresh the page to sign in again.";
      case "RATE_LIMITED":
        return "Too many requests right now. Wait a moment and try again.";
      case "SERVER":
        return "Salesforce returned a server error. Please try again shortly.";
      case "SDK_UNAVAILABLE":
        return "The data connection isn't available in this context. Try reloading the app.";
      case "NETWORK":
        return "Couldn't reach Salesforce. Check your connection and try again.";
      default:
        return `Something went wrong resolving ${q}. Please try again.`;
    }
  }

  return "Something went wrong. Please try again.";
}

/**
 * Friendly message for a failure while *running* something the user built — a
 * Data Export query, a Summarize, an import.
 *
 * These differ from a plain lookup failure in one way worth preserving: when
 * Salesforce rejects a compiled GraphQL document it says which field it
 * objected to, and so does this app's own compiler when it refuses to build one
 * (an ungroupable dimension, a function a field's type doesn't have). Both
 * arrive as an ordinary `Error` rather than an `InspectorError`, so the check
 * for a missing `code` is what separates "we have something specific to say"
 * from "map an HTTP status to a sentence".
 *
 * Replacing that with the generic line would throw away the only part of the
 * message that tells the user what to change. This was written out identically
 * in `useDataExport`, `useAggregate` and `useDataImport`; it lives here so a
 * fourth run-style hook cannot get it subtly wrong.
 */
export function toRunErrorMessage(
  err: unknown,
  ctx: FriendlyContext = {},
): string {
  if (err instanceof Error && !("code" in err)) {
    return err.message.replace(/^GraphQL Error:\s*/, "");
  }
  return toFriendlyMessage(err, ctx);
}
