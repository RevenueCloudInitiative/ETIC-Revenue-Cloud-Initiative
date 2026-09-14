/**
 * Bulk conversion of spreadsheet dates into the ISO form Salesforce wants.
 *
 * The validator refuses `1/19/2027` on purpose: `03/04/2026` is the 4th of
 * March to a US spreadsheet and the 3rd of April to a European one, and nothing
 * in the file says which. Silently guessing would write the wrong date into the
 * org, and the row would import cleanly, so nobody would ever find out.
 *
 * Rejecting it outright is correct but unhelpful when a whole column is in the
 * local format. The way out is to have the user resolve the ambiguity **once**
 * — "these are month/day/year" — and then convert every affected cell. The
 * ambiguity is settled by a person who knows where the file came from, which is
 * the only place that information exists.
 */

/** Which of the first two numbers is the month. */
export type DateOrder = "MDY" | "DMY";

export const DATE_ORDER_LABELS: Record<DateOrder, string> = {
  MDY: "Month / Day / Year",
  DMY: "Day / Month / Year",
};

/**
 * Numeric dates separated by `/`, `-` or `.`, with a 1–2 digit day and month
 * and a 2- or 4-digit year. An optional time part is kept for DateTime fields.
 */
const NUMERIC_DATE =
  /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})(?:[T\s]+(.*))?$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Two-digit years follow the POSIX convention Excel also uses: 69–99 are 1900s,
 * 00–68 are 2000s. Salesforce dates are overwhelmingly recent or near-future,
 * and this at least makes the choice explicit rather than accidental.
 */
function expandYear(raw: string): number {
  const year = Number(raw);
  if (raw.length === 4) return year;
  return year >= 69 ? 1900 + year : 2000 + year;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

/**
 * Convert one cell, or return null when it isn't a numeric date this can fix.
 *
 * Returning null rather than throwing lets the caller run this over every cell
 * and simply count the ones it could help with. A value already in ISO form is
 * left alone — it is not broken, so "fixing" it is not this function's job.
 */
export function toIsoDate(
  raw: string,
  order: DateOrder,
  dataType: "Date" | "DateTime" = "Date",
): string | null {
  const value = raw.trim();
  const match = NUMERIC_DATE.exec(value);
  if (!match) return null;

  const [, first, second, yearPart, timePart] = match;
  const year = expandYear(yearPart);
  const month = Number(order === "MDY" ? first : second);
  const day = Number(order === "MDY" ? second : first);

  if (!isRealDate(year, month, day)) return null;

  const date = `${year}-${pad(month)}-${pad(day)}`;
  if (dataType !== "DateTime") return date;

  // A date-only value in a DateTime field needs a time to be valid ISO;
  // midnight UTC is the same assumption Salesforce makes for a bare date.
  const time = (timePart ?? "").trim();
  if (time === "") return `${date}T00:00:00Z`;
  return `${date}T${/^\d{2}:\d{2}(:\d{2})?$/.test(time) ? (time.length === 5 ? `${time}:00` : time) : time}${
    /(Z|[+-]\d{2}:?\d{2})$/.test(time) ? "" : "Z"
  }`;
}

/**
 * Whether a value is ambiguous between the two orders — i.e. both readings are
 * real dates, so the choice actually changes the result.
 *
 * `19/1/2027` is unambiguous (there is no month 19) and converts identically
 * either way; `1/12/2027` is not. Used to tell the user how much the choice
 * matters before they make it.
 */
export function isAmbiguousDate(raw: string): boolean {
  const mdy = toIsoDate(raw, "MDY");
  const dmy = toIsoDate(raw, "DMY");
  return mdy !== null && dmy !== null && mdy !== dmy;
}
