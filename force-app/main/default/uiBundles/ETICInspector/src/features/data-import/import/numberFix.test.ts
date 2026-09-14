import { describe, expect, it } from "vitest";
import {
  isAmbiguousNumber,
  parseNumericCell,
  toPlainNumber,
  toSalvagedNumber,
} from "./numberFix";

describe("parseNumericCell", () => {
  it("reads a plain number", () => {
    expect(parseNumericCell("1200")).toBe(1200);
    expect(parseNumericCell("-99")).toBe(-99);
    expect(parseNumericCell("0.5")).toBe(0.5);
    expect(parseNumericCell(" 42 ")).toBe(42);
  });

  it("strips the decoration a spreadsheet adds", () => {
    expect(parseNumericCell("$1,200.50")).toBe(1200.5);
    expect(parseNumericCell("£1,200")).toBe(1200);
    expect(parseNumericCell("45%")).toBe(45);
    expect(parseNumericCell("1 234.5")).toBe(1234.5);
  });

  // Invisible on screen, and the reason a cell that looks identical to a
  // working one gets rejected.
  it("strips non-breaking spaces", () => {
    expect(parseNumericCell("1\u00A0234,56")).toBe(1234.56);
    expect(parseNumericCell("€\u202F1200")).toBe(1200);
  });

  it("reads accounting negatives", () => {
    expect(parseNumericCell("(1,200)")).toBe(-1200);
    expect(parseNumericCell("($1,200.50)")).toBe(-1200.5);
  });

  it("strips the apostrophe that stops Excel running a value as a formula", () => {
    expect(parseNumericCell("'-1200")).toBe(-1200);
  });

  /*
   * The bug this module exists for. Both call sites used to strip every comma
   * unconditionally, so this wrote 123 — a hundred times the intended value,
   * silently, on a currency field.
   */
  it("treats a comma with two digits after it as a decimal point", () => {
    expect(parseNumericCell("1,23")).toBe(1.23);
    expect(parseNumericCell("1,2345")).toBe(1.2345);
  });

  it("uses the last separator as the decimal point when both appear", () => {
    expect(parseNumericCell("1,234.50")).toBe(1234.5);
    expect(parseNumericCell("1.234,50")).toBe(1234.5);
    expect(parseNumericCell("1.234.567,89")).toBe(1234567.89);
    expect(parseNumericCell("1,234,567.89")).toBe(1234567.89);
  });

  it("reads repeated separators as digit grouping", () => {
    expect(parseNumericCell("1,234,567")).toBe(1234567);
    expect(parseNumericCell("1.234.567")).toBe(1234567);
    // Indian grouping, which the old strip-everything rule handled by accident.
    expect(parseNumericCell("12,34,567")).toBe(1234567);
  });

  it("refuses separators that aren't digit grouping", () => {
    expect(parseNumericCell("1.2.3")).toBeNull();
    expect(parseNumericCell("1,2,3")).toBeNull();
  });

  it.each(["abc", "", "12abc", "N/A", "-"])("refuses %o", (value) => {
    expect(parseNumericCell(value)).toBeNull();
  });

  /*
   * The multi-currency display format — a Salesforce org with multiple
   * currencies renders `USD 125,000.00` rather than `$125,000.00`, and so do
   * plenty of reports and finance systems.
   */
  describe("ISO currency codes", () => {
    it("reads a leading or trailing code", () => {
      expect(parseNumericCell("USD 125,000.00 ")).toBe(125000);
      expect(parseNumericCell("125,000.00 USD")).toBe(125000);
      expect(parseNumericCell("AED1200")).toBe(1200);
      expect(parseNumericCell("eur 1.234,50")).toBe(1234.5);
    });

    it("combines with accounting brackets in either order", () => {
      expect(parseNumericCell("USD (1,200)")).toBe(-1200);
      expect(parseNumericCell("(1,200 USD)")).toBe(-1200);
    });

    // Membership in the list is what makes stripping letters safe at all.
    it("refuses three letters that aren't a currency", () => {
      expect(parseNumericCell("12abc")).toBeNull();
      expect(parseNumericCell("abc 12")).toBeNull();
    });

    it("refuses a code on both ends", () => {
      expect(parseNumericCell("USD 100 EUR")).toBeNull();
    });

    it("refuses a code with no number", () => {
      expect(parseNumericCell("USD")).toBeNull();
    });
  });

  describe("the ambiguous shape", () => {
    // 1,234 is 1234 to a US sheet and 1.234 to a German one, and nothing in
    // the file says which.
    it("follows the chosen decimal separator", () => {
      expect(parseNumericCell("1,234", ".")).toBe(1234);
      expect(parseNumericCell("1,234", ",")).toBe(1.234);
      expect(parseNumericCell("1.234", ".")).toBe(1.234);
      expect(parseNumericCell("1.234", ",")).toBe(1234);
    });

    it("defaults to the dot reading", () => {
      expect(parseNumericCell("1,234")).toBe(1234);
    });
  });
});

describe("toPlainNumber", () => {
  it("returns the cleaned text", () => {
    expect(toPlainNumber("$1,200.50")).toBe("1200.5");
    expect(toPlainNumber("(1,200)")).toBe("-1200");
    expect(toPlainNumber("45%")).toBe("45");
  });

  // What makes pressing the button twice a no-op. Surrounding whitespace
  // counts as already plain: every reader trims, so rewriting the cell would
  // change what is on screen without changing what gets imported.
  it("leaves a value that is already plain alone", () => {
    expect(toPlainNumber("1200")).toBeNull();
    expect(toPlainNumber("-99.5")).toBeNull();
    expect(toPlainNumber(" 1200 ")).toBeNull();
  });

  it("returns null for anything it can't read", () => {
    expect(toPlainNumber("abc")).toBeNull();
    expect(toPlainNumber("")).toBeNull();
  });
});

describe("toSalvagedNumber", () => {
  it("pulls a number out of text", () => {
    expect(toSalvagedNumber("12abc")).toBe("12");
    expect(toSalvagedNumber("abc12")).toBe("12");
    expect(toSalvagedNumber("500 units")).toBe("500");
    expect(toSalvagedNumber("Qty: 1,250")).toBe("1250");
    expect(toSalvagedNumber("~500")).toBe("500");
    expect(toSalvagedNumber("-12abc")).toBe("-12");
  });

  /*
   * Several runs means several candidate answers, and picking one would be
   * inventing rather than reading. A date pasted into a numeric column is the
   * case that matters — turning `2026-01-15` into 2026 would be catastrophic
   * and completely silent.
   */
  it("refuses a cell with more than one number in it", () => {
    expect(toSalvagedNumber("12-34")).toBeNull();
    expect(toSalvagedNumber("2026-01-15")).toBeNull();
    expect(toSalvagedNumber("1 Main St 2")).toBeNull();
  });

  it("refuses a cell with no digits at all", () => {
    expect(toSalvagedNumber("abc")).toBeNull();
    expect(toSalvagedNumber("N/A")).toBeNull();
    expect(toSalvagedNumber("")).toBeNull();
  });

  // The two offers must never fight over the same cell: anything the strict
  // reader can already handle belongs to "Strip formatting", not to this.
  it("leaves anything the strict reader accepts alone", () => {
    expect(toSalvagedNumber("$1,200.50")).toBeNull();
    expect(toSalvagedNumber("USD 125,000.00")).toBeNull();
    expect(toSalvagedNumber("(1,200)")).toBeNull();
    expect(toSalvagedNumber("1200")).toBeNull();
  });
});

describe("isAmbiguousNumber", () => {
  it("is true only when the choice changes the number", () => {
    expect(isAmbiguousNumber("1,234")).toBe(true);
    expect(isAmbiguousNumber("1.234")).toBe(true);
  });

  it("is false when the text settles it", () => {
    expect(isAmbiguousNumber("1,234.50")).toBe(false);
    expect(isAmbiguousNumber("1,23")).toBe(false);
    expect(isAmbiguousNumber("1200")).toBe(false);
    expect(isAmbiguousNumber("abc")).toBe(false);
  });
});
