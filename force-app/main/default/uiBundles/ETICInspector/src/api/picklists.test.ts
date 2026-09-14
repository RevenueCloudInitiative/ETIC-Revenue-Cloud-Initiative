import { beforeEach, describe, expect, it, vi } from "vitest";

const { uiApiGet } = vi.hoisted(() => ({ uiApiGet: vi.fn() }));
vi.mock("../lib/sfFetch", () => ({ uiApiGet }));

import {
  clearPicklistCache,
  getPicklistValues,
  isPicklistType,
  MASTER_RECORD_TYPE_ID,
  optionsFor,
  type PicklistField,
} from "./picklists";

const collection = {
  picklistFieldValues: {
    Industry: {
      controllerValues: {},
      defaultValue: { value: "Banking", label: "Banking", validFor: [] },
      values: [
        { value: "Banking", label: "Banking", validFor: [] },
        { value: "Energy", label: "Energy", validFor: [] },
      ],
    },
  },
};

beforeEach(() => {
  uiApiGet.mockReset();
  clearPicklistCache();
});

describe("getPicklistValues", () => {
  it("asks the collection endpoint for the given object and record type", async () => {
    uiApiGet.mockResolvedValue(collection);

    await getPicklistValues("Account");

    expect(uiApiGet).toHaveBeenCalledTimes(1);
    expect(uiApiGet.mock.calls[0][0]).toBe(
      `/ui-api/object-info/Account/picklist-values/${MASTER_RECORD_TYPE_ID}`,
    );
  });

  it("parses values, the default, and the controller map", async () => {
    uiApiGet.mockResolvedValue(collection);

    const picklists = await getPicklistValues("Account");

    expect(picklists.Industry.values).toEqual([
      { value: "Banking", label: "Banking", validFor: [] },
      { value: "Energy", label: "Energy", validFor: [] },
    ]);
    expect(picklists.Industry.defaultValue).toBe("Banking");
    expect(picklists.Industry.controllerValues).toEqual({});
  });

  it("falls back to the stored value when a label is missing", async () => {
    uiApiGet.mockResolvedValue({
      picklistFieldValues: {
        Rating: { values: [{ value: "Hot", label: null, validFor: [] }] },
      },
    });

    const picklists = await getPicklistValues("Account");

    expect(picklists.Rating.values[0].label).toBe("Hot");
    expect(picklists.Rating.defaultValue).toBeNull();
  });

  it("drops entries with no stored value, which can't be saved back", async () => {
    uiApiGet.mockResolvedValue({
      picklistFieldValues: {
        Rating: {
          values: [
            { value: null, label: "—", validFor: [] },
            { value: "Hot", label: "Hot", validFor: [] },
          ],
        },
      },
    });

    const picklists = await getPicklistValues("Account");

    expect(picklists.Rating.values).toHaveLength(1);
    expect(picklists.Rating.values[0].value).toBe("Hot");
  });

  it("serves the second call from cache", async () => {
    uiApiGet.mockResolvedValue(collection);

    const first = await getPicklistValues("Account");
    const second = await getPicklistValues("Account");

    expect(uiApiGet).toHaveBeenCalledTimes(1);
    // Same identity, which is what keeps the grids' memoization intact.
    expect(second).toBe(first);
  });

  it("collapses concurrent calls into one request", async () => {
    uiApiGet.mockResolvedValue(collection);

    const [a, b, c] = await Promise.all([
      getPicklistValues("Account"),
      getPicklistValues("Account"),
      getPicklistValues("Account"),
    ]);

    expect(uiApiGet).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("does not cache a failure", async () => {
    uiApiGet.mockRejectedValueOnce(new Error("boom"));
    await expect(getPicklistValues("Account")).rejects.toThrow("boom");

    uiApiGet.mockResolvedValue(collection);
    await expect(getPicklistValues("Account")).resolves.toHaveProperty(
      "Industry",
    );
    expect(uiApiGet).toHaveBeenCalledTimes(2);
  });

  it("keys the cache by record type as well as object", async () => {
    uiApiGet.mockResolvedValue(collection);

    await getPicklistValues("Account");
    await getPicklistValues("Account", "012000000000001AAA");

    expect(uiApiGet).toHaveBeenCalledTimes(2);
  });

  it("clears only the named object", async () => {
    uiApiGet.mockResolvedValue(collection);
    await getPicklistValues("Account");
    await getPicklistValues("Contact");

    clearPicklistCache("Account");
    await getPicklistValues("Account");
    await getPicklistValues("Contact");

    expect(uiApiGet).toHaveBeenCalledTimes(3);
  });
});

describe("optionsFor", () => {
  const dependent: PicklistField = {
    defaultValue: null,
    controllerValues: { Banking: 0, Energy: 1 },
    values: [
      { value: "Retail Banking", label: "Retail Banking", validFor: [0] },
      { value: "Investment", label: "Investment", validFor: [0] },
      { value: "Solar", label: "Solar", validFor: [1] },
    ],
  };

  const independent: PicklistField = {
    defaultValue: null,
    controllerValues: {},
    values: [
      { value: "Hot", label: "Hot", validFor: [] },
      { value: "Cold", label: "Cold", validFor: [] },
    ],
  };

  it("returns every value for an independent picklist", () => {
    expect(optionsFor(independent, "anything")).toEqual(independent.values);
  });

  it("narrows a dependent picklist to the controlling value", () => {
    expect(optionsFor(dependent, "Banking").map((v) => v.value)).toEqual([
      "Retail Banking",
      "Investment",
    ]);
    expect(optionsFor(dependent, "Energy").map((v) => v.value)).toEqual([
      "Solar",
    ]);
  });

  it("offers everything when the controlling field is empty", () => {
    // An empty dropdown reads as a broken field; a wide one still lets the
    // user pick, and Salesforce rejects a genuinely invalid pair on save.
    expect(optionsFor(dependent, "")).toEqual(dependent.values);
    expect(optionsFor(dependent, null)).toEqual(dependent.values);
    expect(optionsFor(dependent)).toEqual(dependent.values);
  });

  it("offers everything when the controlling value is unknown", () => {
    expect(optionsFor(dependent, "Nonexistent")).toEqual(dependent.values);
  });
});

describe("isPicklistType", () => {
  it("matches both UI API picklist data types", () => {
    expect(isPicklistType("Picklist")).toBe(true);
    expect(isPicklistType("MultiPicklist")).toBe(true);
  });

  it("rejects everything else", () => {
    for (const type of ["String", "Reference", "Boolean", "ComboBox", ""]) {
      expect(isPicklistType(type)).toBe(false);
    }
  });
});
