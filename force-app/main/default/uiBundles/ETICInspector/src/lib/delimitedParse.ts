/**
 * Reading side of the delimited-text pair whose writing side is
 * `src/lib/exportFormats.ts`.
 *
 * The Data Import page accepts three sources — a pasted block from Excel, a
 * dropped file, a picked file — and they differ only in how the string arrives.
 * Parsing is therefore one function, and it is pure: nothing here touches the
 * network, so building and checking an import costs nothing against the org's
 * daily API limit.
 *
 * Everything is RFC 4180 as Excel, Sheets and Salesforce all implement it:
 * quoted fields, `""` for a literal quote, and delimiters and line breaks kept
 * verbatim inside quotes.
 */

/** Delimiters worth guessing between. Tab first — an Excel paste is TSV. */
const CANDIDATE_DELIMITERS = ["\t", ",", ";", "|"] as const;

export type Delimiter = (typeof CANDIDATE_DELIMITERS)[number];

export interface ParsedTable {
  /** First row, treated as column headers. */
  headers: string[];
  /** Every subsequent row, padded to `headers.length`. */
  rows: string[][];
  /** The delimiter actually used, so the UI can report what it guessed. */
  delimiter: Delimiter;
  /**
   * Rows whose cell count didn't match the header count. Padded rather than
   * rejected — a trailing empty column is common and harmless — but surfaced so
   * the UI can warn when a file is genuinely misaligned.
   */
  raggedRows: number;
}

/**
 * Count delimiters in the first line, ignoring anything inside quotes.
 *
 * Counting on the *header* line rather than the whole text is deliberate: a
 * free-text column full of commas would otherwise outvote the real tab
 * delimiter of an Excel paste. Headers are short and rarely quoted, which makes
 * them the most reliable line in the file to judge by.
 */
export function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ",";
  let bestCount = 0;

  for (const candidate of CANDIDATE_DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        // A doubled quote inside a quoted field is an escaped quote, not a
        // close-then-reopen, but the two are indistinguishable for counting.
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && (char === "\n" || char === "\r")) break;
      if (!inQuotes && char === candidate) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

/**
 * Undo the spreadsheet-formula guard that `escapeDelimited` applies on export.
 *
 * Exported values beginning with `=`, `+`, `-`, `@`, tab or CR are prefixed
 * with an apostrophe so Excel can't execute them as formulas. Without the
 * matching removal here, a round trip through this app's own Data Export turns
 * every negative currency into the literal text `'-1200` — so this is what
 * makes export → edit → import lossless rather than quietly destructive.
 *
 * Narrow on purpose: the apostrophe is only stripped when the character it
 * guards is one this app would actually have guarded. `'tis` survives intact.
 */
export function stripFormulaGuard(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

/**
 * Parse delimited text into a header row plus data rows.
 *
 * `delimiter` is auto-detected when not given. An empty or whitespace-only
 * input yields an empty table rather than throwing — the paste box starts empty
 * and re-parses as the user types, so "nothing yet" is a normal state, not an
 * error.
 */
export function parseDelimited(
  text: string,
  delimiter?: Delimiter,
): ParsedTable {
  // A UTF-8 BOM survives file reads and would otherwise become part of the
  // first header, so a column named "Id" silently stops matching the Id field.
  // Written as the escape rather than the literal character so it stays visible
  // to anyone reading this file.
  const input = text.replace(/^\uFEFF/, "");
  const sep = delimiter ?? detectDelimiter(input);

  if (input.trim() === "") {
    return { headers: [], rows: [], delimiter: sep, raggedRows: 0 };
  }

  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  /** A cell is only "quoted" if it opened with a quote — see pushCell. */
  let quoted = false;

  const pushCell = () => {
    // The formula guard is only ever applied by the writer to a value it then
    // may or may not have quoted, so unguarding runs for both cases.
    row.push(stripFormulaGuard(cell));
    cell = "";
    quoted = false;
  };

  const pushRow = () => {
    pushCell();
    records.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          // Escaped quote: consume both, emit one.
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
        continue;
      }
      cell += char;
      continue;
    }

    if (char === '"' && cell === "") {
      inQuotes = true;
      quoted = true;
      continue;
    }

    if (char === sep) {
      pushCell();
      continue;
    }

    if (char === "\r" || char === "\n") {
      // CRLF is one break, not two. CR-only (old Mac, and some clipboard
      // sources) is handled by treating a lone CR as a break too.
      if (char === "\r" && input[i + 1] === "\n") i++;
      pushRow();
      continue;
    }

    cell += char;
  }

  // Flush whatever is still buffered. A file ending in a newline has already
  // flushed its last row, and would otherwise gain a phantom empty one.
  if (cell !== "" || quoted || row.length > 0) pushRow();

  const [headerRow = [], ...dataRows] = records;
  const headers = headerRow.map((h) => h.trim());
  const width = headers.length;

  let raggedRows = 0;
  const rows: string[][] = [];
  for (const record of dataRows) {
    // A row of nothing but empty cells is blank-line noise from a spreadsheet
    // paste, not a record the user meant to import.
    if (record.every((value) => value.trim() === "")) continue;
    if (record.length !== width) raggedRows++;
    const padded =
      record.length === width
        ? record
        : record.length > width
          ? record.slice(0, width)
          : [...record, ...Array<string>(width - record.length).fill("")];
    rows.push(padded);
  }

  return { headers, rows, delimiter: sep, raggedRows };
}
