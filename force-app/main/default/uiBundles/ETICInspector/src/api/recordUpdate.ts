import { markDataMutated } from "../lib/dataFreshness";
import { codeFromHttpStatus, InspectorError } from "../lib/errors";
import { isAbortError, sfFetch, type SfRequestInit } from "../lib/sfFetch";
import type { UiFieldValue } from "./recordDetail";

export type UpdateFieldValue = string | number | boolean | null;

export interface UpdateRecordInput {
  recordId: string;
  fields: Record<string, UpdateFieldValue>;
}

export interface UpdateRecordErrorDetail {
  message: string;
  fieldErrors: Record<string, string>;
}

/**
 * What Salesforce echoed back after a successful save.
 *
 * UI API returns the updated record representation on PATCH, so the caller can
 * refresh its view from this instead of re-fetching the record. That keeps a
 * save at one API call rather than replaying the whole ~7-call load.
 */
export interface UpdateRecordResult {
  fields: Record<string, UiFieldValue>;
  lastModifiedDate: string | null;
}

interface UiRecordResponse {
  fields?: Record<string, UiFieldValue>;
  lastModifiedDate?: string;
}

function readError(body: unknown): UpdateRecordErrorDetail {
  const fieldErrors: Record<string, string> = {};
  let message = "Salesforce could not save the record.";

  // Some Salesforce errors are returned as an array, while UI API validation
  // errors commonly use an object containing output.errors/fieldErrors.
  const root = Array.isArray(body) ? body[0] : body;
  if (!root || typeof root !== "object") return { message, fieldErrors };

  const value = root as Record<string, any>;
  if (typeof value.message === "string" && value.message.trim()) {
    message = value.message;
  }

  if (Array.isArray(value.fields) && value.fields.length > 0) {
    for (const apiName of value.fields) fieldErrors[String(apiName)] = message;
  }

  const output = value.output;
  if (output && typeof output === "object") {
    if (Array.isArray(output.errors) && output.errors[0]?.message) {
      message = String(output.errors[0].message);
    }

    const fields = output.fieldErrors;
    if (fields && typeof fields === "object") {
      for (const [apiName, errors] of Object.entries(fields)) {
        const first = Array.isArray(errors) ? errors[0] : null;
        if (first?.message) fieldErrors[apiName] = String(first.message);
      }
    }
  }

  return { message, fieldErrors };
}

export class RecordUpdateError extends InspectorError {
  readonly fieldErrors: Record<string, string>;

  constructor(
    code: ReturnType<typeof codeFromHttpStatus>,
    detail: UpdateRecordErrorDetail,
  ) {
    super(code, detail.message);
    this.fieldErrors = detail.fieldErrors;
  }
}

/** Update all dirty fields in one UI API PATCH request. */
export async function updateRecordFields(
  { recordId, fields }: UpdateRecordInput,
  init?: SfRequestInit,
): Promise<UpdateRecordResult> {
  if (Object.keys(fields).length === 0) {
    return { fields: {}, lastModifiedDate: null };
  }

  const res = await sfFetch(`/ui-api/records/${encodeURIComponent(recordId)}`, {
    ...init,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields, allowSaveOnDuplicate: false }),
  });

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Keep the normalized fallback when Salesforce returns no JSON body.
    }
    const detail = readError(body);
    console.error("UI API record update failed", {
      status: res.status,
      statusText: res.statusText,
      body,
    });
    throw new RecordUpdateError(codeFromHttpStatus(res.status), detail);
  }

  // An inline edit is a write like any other: cached GraphQL reads covering
  // this record are now stale, even though this went out over UI API REST.
  markDataMutated();

  // The echoed record is an optimization, not a requirement — a save that
  // succeeds but returns an unreadable body should still count as a success.
  try {
    const updated = (await res.json()) as UiRecordResponse;
    return {
      fields: updated?.fields ?? {},
      lastModifiedDate: updated?.lastModifiedDate ?? null,
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { fields: {}, lastModifiedDate: null };
  }
}
