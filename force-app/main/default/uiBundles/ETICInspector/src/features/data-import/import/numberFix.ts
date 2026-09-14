/**
 * Bulk conversion of spreadsheet numbers into the plain form Salesforce wants.
 *
 * Sibling of `dateFix.ts`, and for the same reason: a column exported from a
 * spreadsheet arrives as `$1,234.50`, `(1,200)` or `45%`, none of which is a
 * number to `Number()`. The row is rejected, correctly, and the user is left
 * retyping cells one at a time.
 *
 * This module is also the **single** numeric reader for the import path. The
 * cleaning rule used to be written twice — once in `validate.ts` to decide
 * whether a cell was acceptable, once in `toMutation.ts` to decide what to
 * send — as `value.replace(/[,\s$€£]/g, "")` in both places. They agreed, which
 * is what made the shared bug invisible: stripping every comma unconditionally
 * turns `1,23` into `123`. That passes validation and writes a value a hundred
 * times too large, on currency fields, with nothing on screen to suggest
 * anything happened. A comma with two digits after it cannot be a thousands
 * separator, and this reader knows that.
 *
 * Where a genuine ambiguity survives — `1,234` is 1234 to a US sheet and 1.234
 * to a German one — the same doctrine as dates applies: the person who knows
 * where the file came from resolves it once, for every cell.
 */

/** Which character the file uses as the decimal point. */
export type DecimalSeparator = "." | ",";

/**
 * Which of the two whole-column offers is being applied.
 *
 * `format` is the safe one — symbols, separators and currency codes come off a
 * value that is already a number. `salvage` reaches into cells that are *not*
 * numbers and pulls a number out, which is a different promise and is offered
 * separately for that reason.
 */
export type NumberFixMode = "format" | "salvage";

export const DECIMAL_LABELS: Record<DecimalSeparator, string> = {
  ".": "1,234.56 (dot is the decimal point)",
  ",": "1.234,56 (comma is the decimal point)",
};

/**
 * Symbols a spreadsheet adds for display and Salesforce has no use for.
 *
 * Symbols only, never letters. Stripping letters would turn `12abc` into `12`,
 * quietly importing half of a value that is much more likely to be a mis-mapped
 * column than a formatted number. Currency *codes* are the one exception, and
 * they are handled separately by `stripCurrencyCode` — which is allowed to
 * remove letters precisely because it checks them against a fixed list first.
 *
 * `\u00A0` and `\u202F` are the non-breaking spaces Excel and Numbers put
 * between a currency symbol and its digits — invisible on screen, and the
 * reason a cell that looks identical to a working one gets rejected.
 */
const DECORATION = /[$€£¥₹₽₺¢%\s\u00A0\u202F]/g;

/**
 * ISO 4217 alphabetic codes.
 *
 * A multi-currency Salesforce org renders currency fields as `USD 125,000.00`
 * rather than `$125,000.00`, and so do plenty of reports and finance systems, so
 * this shape arrives in pasted data often enough to be worth reading rather than
 * rejecting.
 *
 * **The list is the point.** The rule everywhere else in this module is that
 * letters are never removed, because removing them turns `12abc` into a
 * confidently wrong `12`. Membership is what makes the exception safe: `abc` is
 * not a currency, so `12abc` stays rejected, while `125,000.00 USD` doesn't rest
 * on a guess about what three trailing letters meant.
 *
 * Withdrawn codes (`HRK`, `SLL`, `ZWL`) are kept — historical exports outlive
 * the currencies they were written in. A code missing from this list fails
 * safely: the row is blocked with "isn't a number", exactly as it is today.
 */
const CURRENCY_CODES = new Set(
  `AED AFN ALL AMD ANG AOA ARS AUD AWG AZN
   BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD
   CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK
   DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP
   GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF
   IDR ILS INR IQD IRR ISK JMD JOD JPY
   KES KGS KHR KMF KPW KRW KWD KYD KZT
   LAK LBP LKR LRD LSL LYD
   MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN
   NAD NGN NIO NOK NPR NZD OMR
   PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF
   SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL
   THB TJS TMT TND TOP TRY TTD TWD TZS
   UAH UGX USD UYU UZS VED VES VND VUV WST
   XAF XCD XCG XOF XPF YER ZAR ZMW ZWG ZWL`.split(/\s+/),
);

/**
 * Remove a leading or trailing ISO currency code.
 *
 * At most one, and from one end only — `USD 100 EUR` is not a number in any
 * convention, and quietly reading it as 100 would be inventing an answer.
 */
function stripCurrencyCode(value: string): string {
  const leading = /^([A-Za-z]{3})\s*/.exec(value);
  if (leading && CURRENCY_CODES.has(leading[1].toUpperCase())) {
    return value.slice(leading[0].length);
  }
  const trailing = /\s*([A-Za-z]{3})$/.exec(value);
  if (trailing && CURRENCY_CODES.has(trailing[1].toUpperCase())) {
    return value.slice(0, value.length - trailing[0].length);
  }
  return value;
}

/** Digits, grouping separators and decimal points — nothing else may remain. */
const NUMERIC_ONLY = /^[\d.,]*\d[\d.,]*$/;

/**
 * Whether repeated separators look like digit grouping rather than noise.
 *
 * Groups of three cover `1,234,567`; groups of two cover the Indian
 * `12,34,567`, which the previous strip-everything rule handled by accident and
 * which would be a real regression to start rejecting. `1.2.3` matches neither
 * and stays rejected — it is a version string in the wrong column, not a
 * number, and the old code rejected it too.
 */
function isGrouped(digits: string, separator: string): boolean {
  const parts = digits.split(separator);
  if (parts.length < 2) return true;
  if (!/^\d{1,3}$/.test(parts[0])) return false;
  return parts.slice(1).every((part) => /^\d{2,3}$/.test(part));
}

/**
 * Read one cell as a number, or return null when it isn't one.
 *
 * `decimal` only matters for values where both readings are real numbers; every
 * other case is decided by the text itself and ignores it.
 */
export function parseNumericCell(
  raw: string,
  decimal: DecimalSeparator = ".",
): number | null {
  let value = raw.trim();
  if (value === "") return null;

  // The apostrophe Excel (and `exportFormats.ts`) prefixes to stop a leading
  // `-` being read as a formula. `delimitedParse` removes it on the way in;
  // this covers text that arrived by some other route.
  if (value.startsWith("'")) value = value.slice(1).trim();

  // Stripped on both sides of the bracket check, because the two decorations
  // combine in either order: `USD (1,200)` and `(1,200 USD)` are both real.
  value = stripCurrencyCode(value);

  // Accounting format: (1,200) is negative twelve hundred.
  let negative = false;
  const bracketed = /^\((.*)\)$/.exec(value);
  if (bracketed) {
    negative = true;
    value = stripCurrencyCode(bracketed[1].trim());
  }

  value = value.replace(DECORATION, "");

  const sign = /^[+-]/.exec(value);
  if (sign) {
    if (sign[0] === "-") negative = !negative;
    value = value.slice(1);
  }

  if (!NUMERIC_ONLY.test(value)) return null;

  const dots = value.split(".").length - 1;
  const commas = value.split(",").length - 1;

  let decimalSeparator: string | null = null;
  let groupSeparator: string | null = null;

  if (dots > 0 && commas > 0) {
    // Both present: whichever comes last is the decimal point. `1,234.50` and
    // `1.234,50` are each unambiguous, whatever the caller chose.
    decimalSeparator =
      value.lastIndexOf(".") > value.lastIndexOf(",") ? "." : ",";
    groupSeparator = decimalSeparator === "." ? "," : ".";
  } else if (dots > 0 || commas > 0) {
    const separator = dots > 0 ? "." : ",";
    const occurrences = dots > 0 ? dots : commas;
    const trailing = value.length - value.lastIndexOf(separator) - 1;

    if (occurrences > 1) {
      groupSeparator = separator;
    } else if (trailing === 3 && value.indexOf(separator) > 0) {
      // The genuinely ambiguous shape — `1,234`. Both readings are real
      // numbers, so the caller's choice is what decides.
      if (separator === decimal) decimalSeparator = separator;
      else groupSeparator = separator;
    } else {
      // Any other digit count settles it: no thousands group is 1, 2 or 4
      // digits long, so this separator is a decimal point.
      decimalSeparator = separator;
    }
  }

  if (groupSeparator) {
    const integerPart = decimalSeparator
      ? value.slice(0, value.lastIndexOf(decimalSeparator))
      : value;
    if (!isGrouped(integerPart, groupSeparator)) return null;
    value = value.split(groupSeparator).join("");
  }
  if (decimalSeparator === ",") value = value.replace(",", ".");

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

/**
 * The cleaned-up text for a cell, or null when there is nothing to do.
 *
 * Null covers three cases the caller treats identically: not a number at all,
 * blank, and already plain. A value that is already `1200` is not broken, so
 * "fixing" it is not this function's job — the same reason `toIsoDate` leaves an
 * ISO date alone, and what makes running the fix twice a no-op.
 */
export function toPlainNumber(
  raw: string,
  decimal: DecimalSeparator = ".",
): string | null {
  const parsed = parseNumericCell(raw, decimal);
  if (parsed === null) return null;
  const plain = String(parsed);
  return plain === raw.trim() ? null : plain;
}

/** One run of digits, with the sign attached when it is written against them. */
const NUMBER_RUN = /-?\d[\d.,]*/g;

/**
 * Pull a number out of a cell that also contains text — `12abc` → `12`.
 *
 * **Deliberately not part of `parseNumericCell`, and this separation is the
 * whole safety story.** That function feeds the validator *and* the compiler, so
 * anything it accepts imports with nobody having pressed anything: `12abc`
 * silently becoming 12 in the org is a different class of event from a person
 * clicking a button labelled "extract" and then seeing `12` sitting in the grid.
 * Salvage is therefore only ever reachable by an explicit press.
 *
 * Two rules keep even that press honest:
 *
 * - **Only cells the strict reader rejects.** A value that already reads as a
 *   number is never re-interpreted by this.
 * - **Exactly one run of digits, or nothing.** `12abc` yields one and converts;
 *   `12-34` (a range), `2026-01-15` (a date in the wrong column) and
 *   `1 Main St 2` yield several, and picking one of them would be inventing an
 *   answer rather than reading one.
 */
export function toSalvagedNumber(
  raw: string,
  decimal: DecimalSeparator = ".",
): string | null {
  if (raw.trim() === "") return null;
  // Formatting is the other button's job; this one only handles what that
  // button can't, so the two offers never fight over the same cell.
  if (parseNumericCell(raw, decimal) !== null) return null;

  const runs = raw.match(NUMBER_RUN);
  if (runs === null || runs.length !== 1) return null;

  const parsed = parseNumericCell(runs[0], decimal);
  return parsed === null ? null : String(parsed);
}

/**
 * Whether the two readings of a cell disagree — i.e. the choice of decimal
 * separator actually changes the number.
 *
 * `1,234.50` reads the same either way; `1,234` does not. Used to decide
 * whether to ask the user at all, so the question only appears when the answer
 * matters.
 */
export function isAmbiguousNumber(raw: string): boolean {
  const asDot = parseNumericCell(raw, ".");
  const asComma = parseNumericCell(raw, ",");
  return asDot !== null && asComma !== null && asDot !== asComma;
}
