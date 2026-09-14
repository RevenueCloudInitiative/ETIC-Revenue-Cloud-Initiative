/**
 * Inspector data-access layer (home page: record/object summary).
 *
 * Requests go through `sfFetch`, which owns SDK acquisition, API-limit header
 * capture, cancellation, and error mapping.
 */
import { uiApiGet, type SfRequestInit } from "../lib/sfFetch";
import { InspectorError } from "../lib/errors";
import { decodeHtmlEntities } from "../lib/htmlEntities";

/** Normalized summary the Home card renders. */
export interface RecordSummary {
  objectApiName: string;
  objectLabel: string;
  isCustom: boolean;
  recordId: string;
  recordName: string;
  createdDate: string | null;
  createdByName: string | null;
  lastModifiedDate: string | null;
  lastModifiedByName: string | null;
}

/** Object-level summary when the user searched by name (no record). */
export interface ObjectSummary {
  objectApiName: string;
  objectLabel: string;
  isCustom: boolean;
}

/* ---- UI-API shapes ------------------------------------------------- */

interface UiField {
  value: unknown;
  displayValue: string | null;
}
interface UiObjectInfo {
  apiName: string;
  label: string;
  custom: boolean;
}
interface UiRecord {
  apiName: string;
  fields: Record<string, UiField>;
}
interface RecordUiResponse {
  objectInfos: Record<string, UiObjectInfo>;
  records: Record<string, UiRecord>;
}

function str(field?: UiField): string | null {
  if (!field) return null;
  if (field.displayValue != null) return field.displayValue;
  return field.value != null ? String(field.value) : null;
}

/* ---- Public API ---------------------------------------------------- */

export async function getRecordSummaryById(
  recordId: string,
  init?: SfRequestInit,
): Promise<RecordSummary> {
  const data = await uiApiGet<RecordUiResponse>(
    `/ui-api/record-ui/${recordId}?layoutTypes=Full&modes=View`,
    init,
  );

  const record = data.records[recordId];
  if (!record) {
    throw new InspectorError("NOT_FOUND", `No record found for Id ${recordId}`);
  }
  const info = data.objectInfos[record.apiName];

  return {
    objectApiName: record.apiName,
    objectLabel: decodeHtmlEntities(info?.label ?? record.apiName),
    isCustom: info?.custom ?? record.apiName.endsWith("__c"),
    recordId,
    recordName:
      str(record.fields.Name) ??
      str(record.fields.CaseNumber) ??
      str(record.fields.Subject) ??
      recordId,
    createdDate: str(record.fields.CreatedDate),
    createdByName: str(record.fields.CreatedBy),
    lastModifiedDate: str(record.fields.LastModifiedDate),
    lastModifiedByName: str(record.fields.LastModifiedBy),
  };
}

export async function getObjectSummaryByName(
  objectApiName: string,
  init?: SfRequestInit,
): Promise<ObjectSummary> {
  const info = await uiApiGet<UiObjectInfo>(
    `/ui-api/object-info/${objectApiName}`,
    init,
  );
  return {
    objectApiName: info.apiName,
    objectLabel: decodeHtmlEntities(info.label),
    isCustom: info.custom,
  };
}
