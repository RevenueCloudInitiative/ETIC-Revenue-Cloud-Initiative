import { afterEach, describe, expect, it } from "vitest";
import {
  clearLearnedKeyPrefixes,
  rememberKeyPrefix,
} from "../../../lib/keyPrefixes";
import { detectObjectFromIds } from "./detectObject";

/** Real Ids — the checksum matters, so these can't be invented freehand. */
const ACCOUNT_A = "001gK00000TvFw5QAF";
const ACCOUNT_B = "001gK00000TvFw6QAF";
const CONTACT = "003gK00000TvFw5QAF";

afterEach(() => {
  clearLearnedKeyPrefixes();
});

describe("detectObjectFromIds", () => {
  it("reads the object off an Id column", () => {
    expect(detectObjectFromIds(["Id", "Name"], [[ACCOUNT_A, "Edge"]])).toEqual({
      objectApiName: "Account",
      keyPrefix: "001",
      column: 0,
      header: "Id",
    });
  });

  it("accepts the header spelled loosely", () => {
    for (const header of ["ID", "record id", "Record_Id", "SFID"]) {
      expect(detectObjectFromIds([header], [[ACCOUNT_A]])?.objectApiName).toBe(
        "Account",
      );
    }
  });

  /**
   * The whole reason detection is header-driven. A Contact file carrying
   * AccountId would otherwise load Account and take the mapping with it.
   */
  it("ignores lookup columns, however Id-shaped their values are", () => {
    expect(
      detectObjectFromIds(
        ["FirstName", "LastName", "AccountId"],
        [["Ada", "Lovelace", ACCOUNT_A]],
      ),
    ).toBeNull();
  });

  it("ignores an object-qualified header", () => {
    expect(detectObjectFromIds(["Account ID"], [[ACCOUNT_A]])).toBeNull();
  });

  it("skips blank cells rather than giving up on them", () => {
    expect(
      detectObjectFromIds(["Id"], [[""], ["  "], [ACCOUNT_A], [ACCOUNT_B]])
        ?.objectApiName,
    ).toBe("Account");
  });

  it("refuses a column headed Id that doesn't hold Ids", () => {
    expect(detectObjectFromIds(["Id"], [["1001"], ["1002"]])).toBeNull();
  });

  it("refuses a column mixing two objects", () => {
    expect(detectObjectFromIds(["Id"], [[ACCOUNT_A], [CONTACT]])).toBeNull();
  });

  it("refuses when no Id in the column has a sound checksum", () => {
    // Id-shaped and 18 characters, but the suffix doesn't match the first 15.
    expect(detectObjectFromIds(["Id"], [["001gK00000TvFw5QAA"]])).toBeNull();
  });

  it("still names the object when only some rows are mistyped", () => {
    // The bad row is the validator's problem; naming Account is what makes its
    // message readable.
    expect(
      detectObjectFromIds(["Id"], [[ACCOUNT_A], ["001gK00000TvFw5QAA"]])
        ?.objectApiName,
    ).toBe("Account");
  });

  it("says nothing about a prefix nothing knows", () => {
    expect(detectObjectFromIds(["Id"], [["a0BgK00000TvFw5UAF"]])).toBeNull();
  });

  it("recognises a custom object once its metadata has been loaded", () => {
    rememberKeyPrefix("a0B", "Invoice__c");
    expect(
      detectObjectFromIds(["Id"], [["a0BgK00000TvFw5UAF"]])?.objectApiName,
    ).toBe("Invoice__c");
  });

  /**
   * The org's own answer outranks the static table, which is the same doctrine
   * as `schema.graphql` outranking the docs.
   */
  it("prefers what object-info said over the built-in table", () => {
    rememberKeyPrefix("001", "SomethingElse");
    expect(detectObjectFromIds(["Id"], [[ACCOUNT_A]])?.objectApiName).toBe(
      "SomethingElse",
    );
  });

  it("has nothing to say about an empty table", () => {
    expect(detectObjectFromIds([], [])).toBeNull();
    expect(detectObjectFromIds(["Id"], [])).toBeNull();
    expect(detectObjectFromIds(["Id"], [[""]])).toBeNull();
  });
});
