/**
 * Work out which object a pasted file describes, from its Id column.
 *
 * A spreadsheet exported for an update already says what it is: the Ids in it
 * carry the object's key prefix. Making the user retype that is busywork, and
 * getting it wrong — picking Contact for a file of Account Ids — produces a
 * screen full of red that says nothing about the real mistake.
 *
 * ## Why this only ever looks at a column *headed* as the record Id
 *
 * Id-shaped values are everywhere in exported data. A file for creating
 * Contacts routinely carries `AccountId`, and a file of Opportunities carries
 * `OwnerId`, `Pricebook2Id` and `AccountId` — every one of them a real Id with
 * a real prefix pointing at the wrong object. Guessing from "the first column
 * that looks like Ids" would confidently load Account for a Contact import.
 *
 * So the header has to name the column as *the record's own* Id. That is a rule
 * that can be stated in one sentence, never fights a file it doesn't
 * understand, and covers the case people actually hit: an export with an `Id`
 * column, which is exactly the file you get when you export in order to update.
 *
 * The looser signal — Id-shaped values in *any* column — is still used, but for
 * a different job: it drives the "this data contains record Ids" warning in
 * `ColumnMapper`, which suggests rather than acts.
 */
import { isSalesforceId, isValidIdChecksum } from "../../../lib/salesforce";
import { keyPrefixOf, objectForKeyPrefix } from "../../../lib/keyPrefixes";

/**
 * Headers that mean "this column holds the record's own Id".
 *
 * Compared after stripping spaces and underscores, so `Record Id` and
 * `RECORD_ID` both land. Anything object-qualified (`Account ID`,
 * `Opportunity Id`) is deliberately *not* here — in a file about something
 * else, those are lookups.
 */
const ID_HEADERS = new Set(["id", "recordid", "sfid", "salesforceid"]);

/**
 * How many non-blank cells to read before deciding.
 *
 * A 5,000-row paste re-runs this on every keystroke in the paste box, and the
 * hundredth row cannot change an answer the first hundred agreed on. A column
 * that turns inconsistent below the sample is caught by the validator, which
 * reads every row.
 */
const SAMPLE_LIMIT = 100;

export interface DetectedObject {
  /** The object the prefix resolves to — a guess until the org confirms it. */
  objectApiName: string;
  /** The three characters the guess came from, for verifying it afterwards. */
  keyPrefix: string;
  /** Column the Ids were read from. */
  column: number;
  /** That column's header, for saying where the guess came from. */
  header: string;
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "");
}

/**
 * The object this file's Id column belongs to, or null.
 *
 * Null covers every uncertain case, and they are all the same answer as far as
 * the caller is concerned: there is no Id column, its values aren't Ids, they
 * disagree about which object they belong to, or nothing knows that prefix. In
 * each of those the page does nothing and waits to be told.
 */
export function detectObjectFromIds(
  headers: string[],
  rows: string[][],
): DetectedObject | null {
  const column = headers.findIndex((header) =>
    ID_HEADERS.has(normalizeHeader(header)),
  );
  if (column < 0) return null;

  let prefix: string | null = null;
  let seen = 0;

  for (const row of rows) {
    const raw = (row[column] ?? "").trim();
    if (raw === "") continue;

    // One value that isn't an Id at all settles it: this isn't an Id column,
    // whatever it is called. A column of order numbers headed "ID" is a real
    // spreadsheet, and loading an object off its first three characters would
    // be worse than doing nothing.
    if (!isSalesforceId(raw)) return null;

    const rowPrefix = keyPrefixOf(raw);
    if (rowPrefix === null) return null;
    if (prefix === null) prefix = rowPrefix;
    // Mixed objects in one column. Salesforce would reject the import anyway,
    // and picking whichever one came first would just hide that.
    else if (rowPrefix !== prefix) return null;

    // A mistyped character keeps the prefix intact, so a bad checksum doesn't
    // stop the guess — the validator flags that row on its own, and naming the
    // right object is what makes its message readable.
    if (++seen >= SAMPLE_LIMIT) break;
  }

  if (prefix === null || seen === 0) return null;

  // At least one Id has to be intact before an API call is spent on the guess.
  const trustworthy = rows.some((row) => {
    const raw = (row[column] ?? "").trim();
    return raw !== "" && isSalesforceId(raw) && isValidIdChecksum(raw);
  });
  if (!trustworthy) return null;

  const objectApiName = objectForKeyPrefix(prefix);
  if (!objectApiName) return null;

  return {
    objectApiName,
    keyPrefix: prefix,
    column,
    header: headers[column] ?? "Id",
  };
}
