/**
 * Standard object API names — the **fallback** list for the object box.
 *
 * These were the object picker's only suggestions until `api/objectList.ts`
 * started fetching the org's real list, and the demotion is deliberate: a
 * hard-coded list of standard names cannot know what a given org has switched
 * off. Three of the thirty below (`Quote`, `QuoteLineItem`,
 * `AccountContactRelation`) return 403 in a test org where those features are
 * disabled — so the picker was offering names, in its own dropdown, that
 * produced an error when clicked. That is a large part of the "I searched for a
 * standard object and got an error" feedback this list was meant to prevent.
 *
 * It survives because introspection is one more thing that can fail or be
 * switched off, and a picker with no suggestions at all is worse than one with
 * imperfect ones. When it is in use the UI says so, and every name — suggested
 * or typed — is still validated against `/ui-api/object-info/{name}` on submit.
 *
 * Hard-coding *these particular* names remains safe in a way that hard-coding
 * almost nothing else about an org would be: standard object API names are part
 * of Salesforce's public API contract and don't change between orgs or
 * releases. Whether the org exposes them is the part this list can't answer.
 */
export const STANDARD_OBJECTS: readonly string[] = [
  "Account",
  "AccountContactRelation",
  "Asset",
  "Campaign",
  "CampaignMember",
  "Case",
  "CaseComment",
  "Contact",
  "ContentDocument",
  "ContentVersion",
  "Contract",
  "Entitlement",
  "Event",
  "Individual",
  "Lead",
  "Opportunity",
  "OpportunityContactRole",
  "OpportunityLineItem",
  "Order",
  "OrderItem",
  "Pricebook2",
  "PricebookEntry",
  "Product2",
  "Quote",
  "QuoteLineItem",
  "ServiceContract",
  "Task",
  "User",
  "WorkOrder",
  "WorkOrderLineItem",
];
