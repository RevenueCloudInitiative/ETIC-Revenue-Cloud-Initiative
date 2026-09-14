/**
 * The dry run: everything that can be known about an import without spending an
 * API call.
 *
 * Pure by design. Field metadata and picklist values are already in the session
 * cache by the time the user has picked an object, so checking 2,000 rows costs
 * nothing against the org's daily limit — which is the whole reason to check
 * before sending rather than letting Salesforce reject rows one batch at a time.
 *
 * The split between `error` and `warning` is load-bearing:
 *
 * - **error** — this app knows the row cannot work, so it is not sent.
 * - **warning** — this app suspects, but Salesforce is the authority, so the
 *   row *is* sent.
 *
 * Unknown picklist values are the case that forced the distinction. An
 * unrestricted picklist accepts values outside its list, verified live: writing
 * `Industry: "NotARealIndustry"` to an Account succeeds and stores it. UI API's
 * `object-info` doesn't say whether a picklist is restricted, so blocking on an
 * unknown value would refuse imports Salesforce would have accepted.
 */
import { isPicklistType, type PicklistMap } from "../../../api/picklists";
import {
  isBooleanType,
  isDateType,
  isNumericType,
  isReferenceType,
  type FieldMetaMap,
} from "../../../lib/fieldMeta";
import { COMPOUND_TYPES } from "../../../lib/fieldMeta";
import { parseNumericCell } from "./numberFix";
import { isSalesforceId, isValidIdChecksum } from "../../../lib/salesforce";
import { mappedColumns, type ImportSpec } from "./types";

export type IssueLevel = "error" | "warning";

export interface Issue {
  /** Row index into `spec.rows`, or -1 for a problem with the mapping itself. */
  row: number;
  /** Column index, or -1 when the issue isn't about one column. */
  column: number;
  level: IssueLevel;
  message: string;
}

export interface ValidationReport {
  issues: Issue[];
  /** Row indexes carrying at least one error. These are never sent. */
  blockedRows: Set<number>;
  /** Row indexes that will be sent, in order. */
  readyRows: number[];
  errorCount: number;
  warningCount: number;
  /** Problems with the mapping rather than the data — these block everything. */
  mappingErrors: Issue[];
}

/** Values Salesforce's Boolean fields accept from a spreadsheet. */
const TRUE_VALUES = new Set(["true", "yes", "y", "1", "x"]);
const FALSE_VALUES = new Set(["false", "no", "n", "0"]);

export function parseBooleanCell(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return null;
}

/**
 * Dates are accepted in ISO form only — `YYYY-MM-DD`, plus a time part for
 * DateTime.
 *
 * Deliberately strict. `03/04/2026` is the 4th of March to a US spreadsheet and
 * the 3rd of April to a European one, and nothing in the file says which. A
 * silently wrong date is worse than a rejected row, so the row is rejected with
 * a message naming the format instead of being guessed at.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function isValidDateCell(raw: string, dataType: string): boolean {
  const v = raw.trim();
  const shapeOk =
    dataType === "DateTime" ? ISO_DATETIME.test(v) : ISO_DATE.test(v);
  if (!shapeOk) return false;

  // The shape check passes 2026-02-31, and `Date.parse` does *not* reject it —
  // JavaScript rolls the overflow forward to the 3rd of March. Comparing the
  // parsed components back against the digits is what actually catches a day
  // that doesn't exist, rather than silently importing the wrong date.
  const [year, month, day] = v.slice(0, 10).split("-").map(Number);
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    return false;
  }

  // The time half still needs checking for DateTime (25:00, minute 61, …).
  return dataType !== "DateTime" || !Number.isNaN(Date.parse(v));
}

function checkMapping(spec: ImportSpec, fields: FieldMetaMap): Issue[] {
  const issues: Issue[] = [];
  const add = (message: string, column = -1) =>
    issues.push({ row: -1, column, level: "error", message });

  if (!spec.objectApiName) add("Choose an object before importing.");

  const mapped = mappedColumns(spec, fields);
  if (mapped.length === 0) {
    add("Map at least one column to a Salesforce field.");
  }

  const seen = new Map<string, number>();
  for (const { column, field, meta } of mapped) {
    const previous = seen.get(field);
    if (previous !== undefined) {
      add(
        `"${spec.headers[column] ?? column}" and "${spec.headers[previous] ?? previous}" are both mapped to ${field}. Map each field once.`,
        column,
      );
      continue;
    }
    seen.set(field, column);

    if (!meta) {
      add(`${field} isn't a field on ${spec.objectApiName}.`, column);
      continue;
    }
    if (COMPOUND_TYPES.has(meta.dataType)) {
      add(
        `${meta.label} is a compound ${meta.dataType} field and can't be written directly — map its parts instead.`,
        column,
      );
      continue;
    }
    if (field === "Id") {
      if (spec.operation === "insert") {
        add("Id can't be set on insert — Salesforce assigns it.", column);
      }
      continue;
    }
    if (spec.operation === "insert" && !meta.createable) {
      add(`${meta.label} can't be set when creating a record.`, column);
    }
    if (spec.operation === "update" && !meta.updateable) {
      add(`${meta.label} isn't editable.`, column);
    }
  }

  if (spec.operation === "update" && !seen.has("Id")) {
    add(
      "Updating needs an Id column so each row knows which record to change.",
    );
  }

  return issues;
}

/**
 * Check one cell.
 *
 * Returns null when the cell is fine. Blank is handled by the caller, because
 * whether blank is a problem depends on the operation, not on the value.
 */
function checkCell(
  raw: string,
  dataType: string,
  label: string,
  length: number | null,
  picklists: PicklistMap,
  field: string,
): { level: IssueLevel; message: string } | null {
  const value = raw.trim();

  if (isBooleanType(dataType)) {
    return parseBooleanCell(value) === null
      ? {
          level: "error",
          message: `${label}: "${raw}" isn't a checkbox value. Use true/false, yes/no or 1/0.`,
        }
      : null;
  }

  if (isNumericType(dataType)) {
    // The same reader the compiler uses, so a cell that validates is a cell
    // that sends the number the user saw. They were two separate copies of one
    // cleaning regex before — see `numberFix.ts`.
    return parseNumericCell(value) !== null
      ? null
      : { level: "error", message: `${label}: "${raw}" isn't a number.` };
  }

  if (isDateType(dataType)) {
    return isValidDateCell(value, dataType)
      ? null
      : {
          level: "error",
          message:
            dataType === "DateTime"
              ? `${label}: "${raw}" isn't an ISO date-time. Use YYYY-MM-DDTHH:MM:SSZ.`
              : `${label}: "${raw}" isn't an ISO date. Use YYYY-MM-DD.`,
        };
  }

  if (isReferenceType(dataType)) {
    if (!isSalesforceId(value)) {
      return {
        level: "error",
        message: `${label}: "${raw}" isn't a record Id. Lookups are matched by Id, not by name.`,
      };
    }
    if (!isValidIdChecksum(value)) {
      return {
        level: "error",
        message: `${label}: "${raw}" is Id-shaped but its checksum is wrong — check for a mistyped character.`,
      };
    }
    return null;
  }

  if (isPicklistType(dataType)) {
    const picklist = picklists[field];
    // No cached picklist means "can't judge", not "invalid".
    if (picklist && picklist.values.length > 0) {
      const allowed = new Set(picklist.values.map((v) => v.value));
      const parts =
        dataType === "MultiPicklist"
          ? value.split(";").map((p) => p.trim())
          : [value];
      const unknown = parts.filter((p) => p !== "" && !allowed.has(p));
      if (unknown.length > 0) {
        return {
          level: "warning",
          message: `${label}: ${unknown.map((u) => `"${u}"`).join(", ")} ${unknown.length === 1 ? "isn't" : "aren't"} in the picklist. Salesforce accepts this only if the picklist is unrestricted.`,
        };
      }
    }
    return null;
  }

  if (length != null && value.length > length) {
    return {
      level: "error",
      message: `${label}: ${value.length} characters, but the field holds ${length}.`,
    };
  }

  return null;
}

export function validateImport(
  spec: ImportSpec,
  fields: FieldMetaMap,
  picklists: PicklistMap = {},
): ValidationReport {
  const mappingErrors = checkMapping(spec, fields);
  const issues: Issue[] = [...mappingErrors];
  const blockedRows = new Set<number>();

  // A broken mapping applies to every row, so there is nothing useful to say
  // about individual cells until it is fixed.
  if (mappingErrors.length === 0) {
    const columns = mappedColumns(spec, fields);

    spec.rows.forEach((row, rowIndex) => {
      for (const { column, field, meta } of columns) {
        if (!meta) continue;
        const raw = row[column] ?? "";
        const blank = raw.trim() === "";

        if (field === "Id") {
          if (blank) {
            issues.push({
              row: rowIndex,
              column,
              level: "error",
              message: "Id is blank, so there's no record to update.",
            });
            blockedRows.add(rowIndex);
          } else if (!isSalesforceId(raw.trim())) {
            issues.push({
              row: rowIndex,
              column,
              level: "error",
              message: `"${raw}" isn't a record Id.`,
            });
            blockedRows.add(rowIndex);
          } else if (!isValidIdChecksum(raw.trim())) {
            issues.push({
              row: rowIndex,
              column,
              level: "error",
              message: `"${raw}" is Id-shaped but its checksum is wrong.`,
            });
            blockedRows.add(rowIndex);
          }
          continue;
        }

        if (blank) {
          // Required is a create-time rule. On update a blank means "clear this
          // field", and Salesforce rejects clearing a required field itself
          // with a better message than a guess here would be.
          if (spec.operation === "insert" && meta.required) {
            issues.push({
              row: rowIndex,
              column,
              level: "error",
              message: `${meta.label} is required.`,
            });
            blockedRows.add(rowIndex);
          }
          continue;
        }

        const problem = checkCell(
          raw,
          meta.dataType,
          meta.label,
          meta.length,
          picklists,
          field,
        );
        if (problem) {
          issues.push({ row: rowIndex, column, ...problem });
          if (problem.level === "error") blockedRows.add(rowIndex);
        }
      }
    });
  }

  const readyRows =
    mappingErrors.length > 0
      ? []
      : spec.rows.map((_, i) => i).filter((i) => !blockedRows.has(i));

  return {
    issues,
    blockedRows,
    readyRows,
    errorCount: issues.filter((i) => i.level === "error").length,
    warningCount: issues.filter((i) => i.level === "warning").length,
    mappingErrors,
  };
}

/** Issues grouped by row, for rendering the preview table. */
export function issuesByRow(report: ValidationReport): Map<number, Issue[]> {
  const map = new Map<number, Issue[]>();
  for (const issue of report.issues) {
    if (issue.row < 0) continue;
    const list = map.get(issue.row);
    if (list) list.push(issue);
    else map.set(issue.row, [issue]);
  }
  return map;
}
