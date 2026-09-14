/**
 * Client-side serialization for the Data Export results.
 *
 * Everything here is pure string work plus a Blob download — no API calls, so
 * exporting a loaded result set costs nothing against the org's daily limit
 * regardless of how many times the user does it.
 */

export type ExportFormat = "csv" | "tsv" | "json";

export interface ExportTable {
  columns: string[];
  rows: Record<string, string>[];
}

/**
 * RFC 4180 quoting: wrap in double quotes when the value contains a delimiter,
 * a quote, or a line break, and double any embedded quotes.
 *
 * The leading-formula guard is deliberate. A value beginning with `=`, `+`,
 * `-`, or `@` is interpreted as a formula when the file is opened in Excel or
 * Sheets, which turns exported data into executable content. Prefixing a
 * single quote keeps the value inert and visible.
 */
function escapeDelimited(value: string, delimiter: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  const needsQuotes =
    guarded.includes(delimiter) ||
    guarded.includes('"') ||
    guarded.includes("\n") ||
    guarded.includes("\r");
  if (!needsQuotes) return guarded;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function toDelimited(table: ExportTable, delimiter: string): string {
  const header = table.columns
    .map((c) => escapeDelimited(c, delimiter))
    .join(delimiter);
  const lines = table.rows.map((row) =>
    table.columns
      .map((c) => escapeDelimited(row[c] ?? "", delimiter))
      .join(delimiter),
  );
  return [header, ...lines].join("\r\n");
}

export function toCsv(table: ExportTable): string {
  return toDelimited(table, ",");
}

/** Tab-separated — what Excel and Sheets accept from a plain paste. */
export function toTsv(table: ExportTable): string {
  return toDelimited(table, "\t");
}

export function toJson(table: ExportTable): string {
  const objects = table.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const column of table.columns) out[column] = row[column] ?? "";
    return out;
  });
  return JSON.stringify(objects, null, 2);
}

export function serialize(table: ExportTable, format: ExportFormat): string {
  if (format === "csv") return toCsv(table);
  if (format === "tsv") return toTsv(table);
  return toJson(table);
}

const MIME: Record<ExportFormat, string> = {
  csv: "text/csv;charset=utf-8",
  tsv: "text/tab-separated-values;charset=utf-8",
  json: "application/json;charset=utf-8",
};

const EXTENSION: Record<ExportFormat, string> = {
  csv: "csv",
  tsv: "tsv",
  json: "json",
};

export function downloadFile(
  content: string,
  baseName: string,
  format: ExportFormat,
): void {
  const blob = new Blob([content], { type: MIME[format] });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}.${EXTENSION[format]}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers; a tick is
  // enough for the click to have been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    return false;
  }
}
