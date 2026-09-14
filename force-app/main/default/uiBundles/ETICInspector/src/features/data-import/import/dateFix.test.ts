import { describe, expect, it } from "vitest";
import { isAmbiguousDate, toIsoDate } from "./dateFix";

describe("toIsoDate", () => {
  it("converts US order", () => {
    expect(toIsoDate("1/19/2027", "MDY")).toBe("2027-01-19");
    expect(toIsoDate("12/25/2026", "MDY")).toBe("2026-12-25");
  });

  it("converts European order", () => {
    expect(toIsoDate("19/1/2027", "DMY")).toBe("2027-01-19");
    expect(toIsoDate("25/12/2026", "DMY")).toBe("2026-12-25");
  });

  // The whole reason the user is asked rather than guessed at.
  it("reads the same input differently depending on the order", () => {
    expect(toIsoDate("3/4/2026", "MDY")).toBe("2026-03-04");
    expect(toIsoDate("3/4/2026", "DMY")).toBe("2026-04-03");
  });

  it.each(["-", ".", "/"])("accepts %s as a separator", (sep) => {
    expect(toIsoDate(`1${sep}19${sep}2027`, "MDY")).toBe("2027-01-19");
  });

  it("pads single-digit months and days", () => {
    expect(toIsoDate("1/2/2027", "MDY")).toBe("2027-01-02");
  });

  it("expands two-digit years the way spreadsheets do", () => {
    expect(toIsoDate("1/19/27", "MDY")).toBe("2027-01-19");
    expect(toIsoDate("1/19/99", "MDY")).toBe("1999-01-19");
    expect(toIsoDate("1/19/68", "MDY")).toBe("2068-01-19");
    expect(toIsoDate("1/19/69", "MDY")).toBe("1969-01-19");
  });

  it("refuses a date that doesn't exist", () => {
    expect(toIsoDate("2/31/2027", "MDY")).toBeNull();
    expect(toIsoDate("13/1/2027", "MDY")).toBeNull();
    expect(toIsoDate("2/29/2027", "MDY")).toBeNull();
    expect(toIsoDate("2/29/2028", "MDY")).toBe("2028-02-29");
  });

  // Already-valid values are not this function's business.
  it("leaves an ISO date alone by returning null", () => {
    expect(toIsoDate("2027-01-19", "MDY")).toBeNull();
  });

  it("returns null for something that isn't a date at all", () => {
    expect(toIsoDate("", "MDY")).toBeNull();
    expect(toIsoDate("Closed Won", "MDY")).toBeNull();
    expect(toIsoDate("15000", "MDY")).toBeNull();
  });

  it("produces a full ISO timestamp for DateTime fields", () => {
    expect(toIsoDate("1/19/2027", "MDY", "DateTime")).toBe(
      "2027-01-19T00:00:00Z",
    );
    expect(toIsoDate("1/19/2027 14:30", "MDY", "DateTime")).toBe(
      "2027-01-19T14:30:00Z",
    );
  });
});

describe("isAmbiguousDate", () => {
  it("is true when both readings are real and different", () => {
    expect(isAmbiguousDate("3/4/2026")).toBe(true);
  });

  it("is false when only one reading is a real date", () => {
    expect(isAmbiguousDate("1/19/2027")).toBe(false);
    expect(isAmbiguousDate("19/1/2027")).toBe(false);
  });

  it("is false for a non-date", () => {
    expect(isAmbiguousDate("Closed Won")).toBe(false);
  });
});
