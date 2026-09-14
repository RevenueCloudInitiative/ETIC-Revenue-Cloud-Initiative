import { describe, expect, it } from "vitest";
import {
  countSystemMatches,
  describeObject,
  nearestObjectName,
  rankObjectMatches,
  type ObjectEntry,
} from "./objectSearch";

/** Names taken from real orgs, so the shapes under test are ones that exist. */
const ORG_NAMES = [
  "Account",
  "AccountHistory",
  "AccountShare",
  "AccountContactRelation",
  "Opportunity",
  "OpportunityLineItem",
  "OrderItem",
  "Order",
  "ADP_Details__c",
  "ADPDetails_ActivityMapping__c",
  "APXTConga4__Conga_Collection__c",
  "DS_Invoice__c",
  "Invoice_Line__c",
  "Product2",
  "MyObj__History",
  "Order_Event__e",
  "Shipping_Rule__mdt",
];

const entries = ORG_NAMES.map((name) => describeObject(name));

function names(list: readonly ObjectEntry[]): string[] {
  return list.map((entry) => entry.apiName);
}

describe("describeObject", () => {
  it("humanizes CamelCase into words", () => {
    expect(describeObject("OpportunityLineItem").humanized).toBe(
      "Opportunity Line Item",
    );
  });

  it("keeps an acronym run whole", () => {
    // "ADPDetails" must not become "A D P Details" or "ADPDetails".
    expect(describeObject("ADPDetails_ActivityMapping__c").humanized).toBe(
      "ADP Details Activity Mapping",
    );
  });

  it("strips the type suffix rather than reading it as a word", () => {
    const entry = describeObject("ADP_Details__c");
    expect(entry.humanized).toBe("ADP Details");
    expect(entry.namespace).toBeNull();
  });

  it("separates a managed-package namespace from the name", () => {
    const entry = describeObject("APXTConga4__Conga_Collection__c");
    expect(entry.namespace).toBe("APXTConga4");
    expect(entry.humanized).toBe("Conga Collection");
  });

  it("flags generated companion objects, standard and custom", () => {
    expect(describeObject("AccountHistory").system).toBe(true);
    expect(describeObject("AccountShare").system).toBe(true);
    expect(describeObject("MyObj__History").system).toBe(true);
    expect(describeObject("Order_Event__e").system).toBe(true);
  });

  it("does not flag ordinary objects that merely end in a marker word", () => {
    // A custom object is suffixed `__c`, so the marker pattern must not reach
    // into its name and hide it.
    expect(describeObject("Invoice_History__c").system).toBe(false);
    expect(describeObject("Account").system).toBe(false);
    // Custom metadata is authored by an admin — querying it is ordinary.
    expect(describeObject("Shipping_Rule__mdt").system).toBe(false);
  });

  it("never leaves the readable form empty", () => {
    expect(describeObject("Account").humanized).toBe("Account");
    expect(describeObject("Product2").humanized).toBe("Product2");
  });
});

describe("rankObjectMatches", () => {
  it("matches nothing until something is typed", () => {
    expect(rankObjectMatches(entries, "")).toEqual([]);
    expect(rankObjectMatches(entries, "   ")).toEqual([]);
  });

  it("puts an exact name first, then prefixes", () => {
    const ranked = names(rankObjectMatches(entries, "order"));
    expect(ranked[0]).toBe("Order");
    expect(ranked[1]).toBe("OrderItem");
  });

  it("finds an object by a word in the middle of its name", () => {
    // The whole point of humanizing: nobody types "OpportunityLineItem".
    expect(names(rankObjectMatches(entries, "line item"))).toContain(
      "OpportunityLineItem",
    );
    expect(names(rankObjectMatches(entries, "details"))).toContain(
      "ADP_Details__c",
    );
  });

  it("finds a package object without its namespace", () => {
    expect(names(rankObjectMatches(entries, "conga collection"))).toContain(
      "APXTConga4__Conga_Collection__c",
    );
  });

  it("finds a custom object whose name is buried behind a prefix", () => {
    // `DS_Invoice__c` is the case a plain "starts with" search can't reach: the
    // package prefix means nobody types the first characters of the API name.
    // It ranks below `Invoice_Line__c`, which the query does prefix, and that
    // ordering is the point — a prefix match is a stronger signal than a word
    // found in the middle.
    expect(names(rankObjectMatches(entries, "invoice"))).toEqual([
      "Invoice_Line__c",
      "DS_Invoice__c",
    ]);
  });

  it("hides generated companion objects by default", () => {
    const ranked = names(rankObjectMatches(entries, "account"));
    expect(ranked).toContain("Account");
    expect(ranked).not.toContain("AccountHistory");
    expect(ranked).not.toContain("AccountShare");
  });

  it("ranks companion objects last when they are shown", () => {
    const ranked = names(
      rankObjectMatches(entries, "account", { includeSystem: true }),
    );
    expect(ranked[0]).toBe("Account");
    // AccountContactRelation is a real object and must outrank both companions
    // even though they sort earlier alphabetically.
    expect(ranked.indexOf("AccountContactRelation")).toBeLessThan(
      ranked.indexOf("AccountHistory"),
    );
    expect(ranked).toContain("AccountShare");
  });

  it("is case-insensitive in both directions", () => {
    expect(names(rankObjectMatches(entries, "ACCOUNT"))[0]).toBe("Account");
    expect(names(rankObjectMatches(entries, "aCcOuNt"))[0]).toBe("Account");
  });

  it("searches a learned label the API name doesn't contain", () => {
    // The gap humanizing can't close: "Product" appears nowhere in
    // "OpportunityLineItem". Once an object-info call has taught the label,
    // Salesforce's own word finds it.
    const withLabel = [
      describeObject("OpportunityLineItem", "Opportunity Product"),
    ];
    expect(names(rankObjectMatches(withLabel, "product"))).toEqual([
      "OpportunityLineItem",
    ]);
  });
});

describe("countSystemMatches", () => {
  it("counts only the companion objects a search would have matched", () => {
    // Account, AccountHistory, AccountShare, AccountContactRelation all match;
    // two of them are companions.
    expect(countSystemMatches(entries, "account")).toBe(2);
    expect(countSystemMatches(entries, "invoice")).toBe(0);
    expect(countSystemMatches(entries, "")).toBe(0);
  });
});

describe("nearestObjectName", () => {
  it("recovers a plural and a transposition", () => {
    expect(nearestObjectName(entries, "Accounts")).toBe("Account");
    expect(nearestObjectName(entries, "Oppotunity")).toBe("Opportunity");
  });

  it("suggests the custom object behind a missing suffix", () => {
    expect(nearestObjectName(entries, "DS_Invoice")).toBe("DS_Invoice__c");
  });

  it("stays silent rather than guessing", () => {
    // Nothing in the list is plausibly this, and a wrong suggestion is worse
    // than none — it sends the user to load an unrelated object.
    expect(nearestObjectName(entries, "Zebra")).toBeNull();
    expect(nearestObjectName(entries, "Contact")).toBeNull();
  });

  it("ignores anything too short to be a near miss", () => {
    expect(nearestObjectName(entries, "Ac")).toBeNull();
  });

  it("will suggest a companion object, which the display toggle hides", () => {
    // The toggle is about scanning a list; a name that has already failed is a
    // different question, and hiding the answer to it would be perverse.
    expect(nearestObjectName(entries, "AccountHistry")).toBe("AccountHistory");
  });
});
