/**
 * The first three characters of a record Id say which object it belongs to.
 *
 * Salesforce calls this the **key prefix**, and for standard objects it is a
 * global constant: `001` is Account in every org that has ever existed. That is
 * what makes a static table safe here, in the same way `standardObjects.ts` is
 * safe — these are part of the public API contract, not org configuration.
 *
 * Custom objects are the opposite: their prefixes are assigned per org from the
 * `a00` block upward, so no static table can hold them. They are learned
 * instead — every `object-info` response carries the object's own `keyPrefix`
 * ([Object Info response
 * body](https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_responses_object_info.htm)),
 * so any object the session has already loaded can be recognised from an Id for
 * free. A custom object is therefore recognised after it has been used once,
 * which is a rule that can be explained; guessing would not be.
 *
 * **Nothing here is trusted on its own.** The caller resolves a prefix to a
 * name, loads that object, and then checks the `keyPrefix` the org sends back
 * against the prefix it started from. A wrong entry in this table costs one
 * metadata call and produces no wrong state — see `useDetectedObject`.
 */

/**
 * Learned prefixes, filled in from `object-info` as objects are loaded.
 *
 * Read before the static table: this is the org's own answer, and it covers
 * custom objects the table cannot.
 */
const _learned = new Map<string, string>();

/**
 * Standard-object prefixes.
 *
 * Deliberately limited to objects someone would realistically mass-update from
 * a spreadsheet. Prefixes are **case-sensitive** — `00k` is OpportunityLineItem
 * and `00K` is OpportunityContactRole — so never fold the case of one.
 */
const STANDARD_KEY_PREFIXES: Readonly<Record<string, string>> = Object.freeze({
  "001": "Account",
  "003": "Contact",
  "005": "User",
  "006": "Opportunity",
  "00K": "OpportunityContactRole",
  "00Q": "Lead",
  "00T": "Task",
  "00U": "Event",
  "00a": "CaseComment",
  "00k": "OpportunityLineItem",
  "00v": "CampaignMember",
  "01s": "Pricebook2",
  "01t": "Product2",
  "01u": "PricebookEntry",
  "02i": "Asset",
  "02s": "EmailMessage",
  "0PK": "Individual",
  "0Q0": "Quote",
  "0QL": "QuoteLineItem",
  "0WO": "WorkOrder",
  "1WL": "WorkOrderLineItem",
  "500": "Case",
  "550": "Entitlement",
  "701": "Campaign",
  "800": "Contract",
  "801": "Order",
  "802": "OrderItem",
  "810": "ServiceContract",
  "811": "ContractLineItem",
});

/**
 * Record what an `object-info` response said this object's prefix is.
 *
 * Called from the one place object metadata is parsed, so every object the app
 * touches — for any reason, on any page — teaches this map.
 */
export function rememberKeyPrefix(
  keyPrefix: string | null | undefined,
  objectApiName: string,
): void {
  if (!keyPrefix || !objectApiName) return;
  _learned.set(keyPrefix, objectApiName);
}

/** The object a key prefix belongs to, or null when nothing knows. */
export function objectForKeyPrefix(prefix: string): string | null {
  return _learned.get(prefix) ?? STANDARD_KEY_PREFIXES[prefix] ?? null;
}

/**
 * The key prefix of a record Id, or null when the value isn't Id-shaped.
 *
 * Shape only — the caller checks the checksum, because a mistyped Id still has
 * a perfectly good prefix and pointing at the right object is the more useful
 * half of the answer.
 */
export function keyPrefixOf(value: string): string | null {
  const v = value.trim();
  if (v.length !== 15 && v.length !== 18) return null;
  if (!/^[a-zA-Z0-9]+$/.test(v)) return null;
  return v.slice(0, 3);
}

/** Test seam: forget everything learned from `object-info` this session. */
export function clearLearnedKeyPrefixes(): void {
  _learned.clear();
}
