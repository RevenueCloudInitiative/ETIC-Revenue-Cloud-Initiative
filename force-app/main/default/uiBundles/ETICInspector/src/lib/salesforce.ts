/**
 * Salesforce helpers shared across the Inspector app.
 * Pure, framework-agnostic utilities — no SDK calls live here.
 */

/** Salesforce API version shared by every Data SDK request. */
export const API_VERSION = "v67.0" as const;

/** A 15- or 18-character Salesforce record Id (shape only, no checksum). */
export function isSalesforceId(value: string): boolean {
  const v = value.trim();
  return /^[a-zA-Z0-9]{15}$/.test(v) || /^[a-zA-Z0-9]{18}$/.test(v);
}

/**
 * Recompute the 3-character case-insensitivity suffix for a 15-char Id.
 * This is the standard Salesforce 15->18 algorithm.
 */
function computeIdSuffix(id15: string): string {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
  let suffix = "";
  for (let block = 0; block < 3; block++) {
    let bits = 0;
    for (let i = 0; i < 5; i++) {
      const c = id15[block * 5 + i];
      if (c >= "A" && c <= "Z") bits += 1 << i;
    }
    suffix += table[bits];
  }
  return suffix;
}

/**
 * Validate an 18-character Id's checksum (the last 3 chars).
 * Catches single-character typos like ...QAA vs ...QAF that are otherwise
 * shaped like a valid Id. 15-char Ids have no checksum, so they pass.
 */
export function isValidIdChecksum(value: string): boolean {
  const v = value.trim();
  if (v.length === 15) return true; // no checksum to verify
  if (v.length !== 18) return false;
  return computeIdSuffix(v.slice(0, 15)) === v.slice(15).toUpperCase();
}

/**
 * Canonicalize a record Id to its 18-character form.
 *
 * `isSalesforceId` accepts both 15- and 18-char Ids, so the same record can be
 * reached by two different strings. Normalizing before using an Id as a cache
 * key stops us from fetching the same record twice.
 *
 * Returns the input unchanged when it isn't Id-shaped, so callers can apply it
 * unconditionally.
 */
export function toRecordId18(value: string): string {
  const v = value.trim();
  if (v.length === 18) return v.slice(0, 15) + computeIdSuffix(v.slice(0, 15));
  if (v.length === 15) return v + computeIdSuffix(v);
  return v;
}

/** A syntactically valid object API name, e.g. Account, My_Object__c. */
function isObjectApiName(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*(?:__(?:c|C|x|X|mdt|MDT|e|E|b|B|Share|ChangeEvent|History))?$/.test(
    value.trim(),
  );
}

/** What the user typed resolved to — a record Id, or an object API name. */
export type QueryKind = "id" | "name";

/** Result of pre-flight validation before we hit any Salesforce API. */
export type ValidationResult =
  { ok: true; kind: QueryKind; value: string } | { ok: false; reason: string };

/**
 * Client-side gate so the user can't fire a request for arbitrary junk.
 * Runs BEFORE any network call.
 */
export function validateQuery(raw: string): ValidationResult {
  const value = raw.trim();

  if (!value) {
    return { ok: false, reason: "Enter a record Id or object name." };
  }

  if (isSalesforceId(value)) {
    if (!isValidIdChecksum(value)) {
      return {
        ok: false,
        reason:
          "That looks like a record Id but its checksum is invalid — check for a mistyped character.",
      };
    }
    return { ok: true, kind: "id", value };
  }

  if (
    (value.length === 15 || value.length === 18) &&
    /[^a-zA-Z0-9]/.test(value)
  ) {
    return {
      ok: false,
      reason:
        "Record Ids contain only letters and numbers — remove any spaces or symbols.",
    };
  }

  if (value.length < 2) {
    return {
      ok: false,
      reason: "Enter at least 2 characters to search by object name.",
    };
  }
  if (!isObjectApiName(value)) {
    return {
      ok: false,
      reason:
        "That isn't a valid object name. Use an API name like Account, Case, or My_Object__c.",
    };
  }

  return { ok: true, kind: "name", value };
}

/**
 * Format a Salesforce ISO datetime the way Inspector does, e.g.
 * "11/25/2025 10:28:34 AM". Returns "—" for empty values.
 */
export function formatSfDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

/**
 * Base URL of the org's Lightning Experience (where Setup lives).
 *
 * The app runs on the isolated `*.my.salesforce.app` origin. Lightning UI is
 * served from `*.lightning.force.com` — NOT `*.my.salesforce.com` (that's the
 * core/auth domain and forces a redirect that can prompt re-login). We map the
 * app host straight to the Lightning host so links land on an already-
 * authenticated origin.
 *
 * Override with VITE_LIGHTNING_BASE_URL for local dev.
 *
 * The override is gated on `import.meta.env.DEV` deliberately. Vite loads
 * `.env.local` during production builds too and inlines `VITE_*` statically, so
 * an ungated read would bake whichever org the developer last tested against
 * into `dist/` and ship it everywhere. `DEV` is a compile-time constant, so in a
 * production build this branch is eliminated entirely and the app can only ever
 * derive its org from the host it is actually served from.
 */
export function getLightningBaseUrl(): string {
  const override = import.meta.env?.DEV
    ? (import.meta.env?.VITE_LIGHTNING_BASE_URL as string | undefined)
    : undefined;
  if (override) return override.replace(/\/$/, "");

  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    if (hostname.includes(".my.salesforce.app")) {
      //   acme--c.my.salesforce.app              -> acme.lightning.force.com
      //   acme--sbx--c.sandbox.my.salesforce.app -> acme--sbx.sandbox.lightning.force.com
      //   acme--c.scratch.my.salesforce.app      -> acme.scratch.lightning.force.com
      const lightningHost = hostname
        .replace(/--c\./, ".")
        .replace(".my.salesforce.app", ".lightning.force.com");
      return `https://${lightningHost}`;
    }
    return origin; // localhost / other — rely on VITE override in dev
  }
  return "";
}

/**
 * Base URL of the org's dedicated Setup domain (`*.my.salesforce-setup.com`).
 *
 * Derived from `getLightningBaseUrl()` by swapping the suffix rather than by
 * parsing the hostname a second time, so the two can never disagree about
 * which org they point at — including under the dev override.
 *
 * Linking here directly avoids relying on Salesforce's redirect from the
 * Lightning host, which would carry a long encoded `address=` query string
 * through a cross-domain hop.
 */
function getSetupBaseUrl(): string {
  return getLightningBaseUrl().replace(
    ".lightning.force.com",
    ".my.salesforce-setup.com",
  );
}

/** Setup / navigation deep links for the object links row. */
export function objectSetupLinks(objectApiName: string) {
  const base = getLightningBaseUrl();
  return {
    fields: `${base}/lightning/setup/ObjectManager/${objectApiName}/FieldsAndRelationships/view`,
    recordTypes: `${base}/lightning/setup/ObjectManager/${objectApiName}/RecordTypes/view`,
    list: `${base}/lightning/o/${objectApiName}/list`,
    access: `${base}/lightning/setup/ObjectManager/${objectApiName}/Details/view`,
  };
}

/** URL to create a new record of the given object. */
export function newRecordUrl(objectApiName: string): string {
  return `${getLightningBaseUrl()}/lightning/o/${objectApiName}/new`;
}

/** Lightning record page for one record. */
export function recordViewUrl(objectApiName: string, recordId: string): string {
  return `${getLightningBaseUrl()}/lightning/r/${objectApiName}/${recordId}/view`;
}

/** Salesforce Ids are 15-char case-sensitive; Setup's classic pages want that form. */
function toRecordId15(value: string): string {
  return value.trim().slice(0, 15);
}

/**
 * Wrap a classic Setup path so it renders inside Lightning Setup rather than
 * bouncing the user out to the classic UI.
 *
 * `node` is the Setup tree node that hosts the page — it is not cosmetic. The
 * permission-set page only resolves under `PermSets`, not under `ManageUsers`.
 */
function setupAddress(node: string, classicPath: string): string {
  return `${getSetupBaseUrl()}/lightning/setup/${node}/page?address=${encodeURIComponent(classicPath)}`;
}

/**
 * Setup deep links for a single user.
 *
 * `noredirect=1` is load-bearing. Without it the classic user page bounces
 * straight to the Lightning record view, so the link appears to "flash Setup
 * and then land on the normal detail page" — which is not the Setup page the
 * admin wanted.
 *
 * `permSets` is the classic Permission Set Assignments page, which takes the
 * user Id as an ordinary query parameter — swapping the Id is all that varies
 * between users. It has to be linked rather than rendered in-app because
 * `PermissionSetAssignment` is rejected by UI API three ways over
 * (`object-info` -> "not supported in UI API", `related-list-records` -> "does
 * not support this related list", and `FieldUndefined` in GraphQL `uiapi`).
 */
export function userSetupLinks(userId: string) {
  const id = toRecordId15(userId);
  return {
    details: setupAddress("ManageUsers", `/${id}?noredirect=1`),
    permSets: setupAddress(
      "PermSets",
      `/udd/PermissionSet/assignPermissionSet.apexp?userId=${id}`,
    ),
  };
}

/**
 * "Login As" URL for the given user.
 *
 * This is deliberately not an API call. Salesforce implements Login As as a
 * plain servlet navigation: the browser sends it with the admin's existing
 * session cookie, Salesforce checks Manage Users / ModifyAllData plus the
 * target user's login-access grant, swaps the session, and redirects. That is
 * why the feature needs no Apex, no metadata, and no post-deployment step —
 * it is just an href.
 *
 * `oid` must be the 15-char org Id; see `getOrgId` in src/api/users.ts.
 *
 * Note there is no way to open this in a private window from a web page:
 * incognito is a browser-extension capability (`chrome.windows.create`), which
 * is why the UI also offers copying this URL to paste into one manually.
 */
export function loginAsUrl(orgId: string, userId: string): string {
  const params = new URLSearchParams({
    oid: toRecordId15(orgId),
    suorgadminid: toRecordId18(userId),
    retURL: "/lightning/page/home",
    targetURL: "/lightning/page/home",
  });
  return `${getLightningBaseUrl()}/servlet/servlet.su?${params.toString()}`;
}
