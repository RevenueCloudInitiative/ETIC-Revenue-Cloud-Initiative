import { describe, expect, it } from "vitest";
import {
  sameFieldMeta,
  sameFieldMetaMap,
  type FieldMeta,
  type FieldMetaMap,
} from "./fieldMeta";

function field(apiName: string, extra: Partial<FieldMeta> = {}): FieldMeta {
  return {
    apiName,
    label: apiName,
    dataType: "String",
    filterable: true,
    sortable: true,
    updateable: true,
    createable: true,
    required: false,
    length: null,
    compound: false,
    relationshipName: null,
    referenceTo: null,
    ...extra,
  };
}

describe("sameFieldMeta", () => {
  it("accepts two descriptions of the same field", () => {
    expect(sameFieldMeta(field("Name"), field("Name"))).toBe(true);
  });

  /**
   * The comparison is generic over own keys rather than a hand-written list, so
   * every property counts — including one added to `FieldMeta` after this test
   * was written.
   */
  it("notices a change in any property", () => {
    const base = field("Name");
    for (const changed of [
      field("Other"),
      field("Name", { label: "Account Name" }),
      field("Name", { dataType: "TextArea" }),
      field("Name", { filterable: false }),
      field("Name", { sortable: false }),
      field("Name", { updateable: false }),
      field("Name", { createable: false }),
      field("Name", { required: true }),
      field("Name", { length: 255 }),
      field("Name", { compound: true }),
      field("Name", { relationshipName: "Account" }),
      field("Name", { referenceTo: "Account" }),
    ]) {
      expect(sameFieldMeta(base, changed)).toBe(false);
    }
  });

  it("separates null from a value", () => {
    expect(
      sameFieldMeta(field("N", { length: null }), field("N", { length: 0 })),
    ).toBe(false);
  });
});

describe("sameFieldMetaMap", () => {
  const before: FieldMetaMap = { Id: field("Id"), Name: field("Name") };

  it("accepts an identical map", () => {
    expect(
      sameFieldMetaMap(before, { Id: field("Id"), Name: field("Name") }),
    ).toBe(true);
  });

  /**
   * `object-info` makes no promise about field order, and a comparison that
   * noticed reordering would report a change on every background refresh —
   * which would make the revalidation pointless.
   */
  it("ignores key order", () => {
    expect(
      sameFieldMetaMap(before, { Name: field("Name"), Id: field("Id") }),
    ).toBe(true);
  });

  it("notices a field added in Setup", () => {
    expect(
      sameFieldMetaMap(before, { ...before, Region__c: field("Region__c") }),
    ).toBe(false);
  });

  it("notices a field removed", () => {
    expect(sameFieldMetaMap(before, { Id: field("Id") })).toBe(false);
  });

  it("notices a field that changed underneath the same name", () => {
    expect(
      sameFieldMetaMap(before, {
        Id: field("Id"),
        Name: field("Name", { length: 255 }),
      }),
    ).toBe(false);
  });

  /** Same size, different keys — the length check alone would pass this. */
  it("notices a rename", () => {
    expect(
      sameFieldMetaMap(before, { Id: field("Id"), Title: field("Title") }),
    ).toBe(false);
  });

  it("accepts two empty maps", () => {
    expect(sameFieldMetaMap({}, {})).toBe(true);
  });
});
