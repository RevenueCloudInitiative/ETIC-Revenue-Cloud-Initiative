/**
 * Picklist values — the one place any page gets the options for a picklist.
 *
 * Uses the *collection* endpoint,
 * `GET /ui-api/object-info/{objectApiName}/picklist-values/{recordTypeId}`,
 * which returns every picklist on the object in a single response keyed by
 * field API name. The per-field endpoint (`.../{recordTypeId}/{fieldApiName}`)
 * exists too, but on a record with a dozen picklists it would cost a dozen
 * calls to learn the same thing — and this app bills every call to the user's
 * daily limit and shows them the number.
 *
 * https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_resources_picklist_values_collection.htm
 */
import { createMetadataCache } from "../lib/metadataCache";
import { uiApiGet, type SfRequestInit } from "../lib/sfFetch";

/**
 * The record type an object falls back to when it defines none — Salesforce's
 * "master" record type, which `object-info` also reports as
 * `defaultRecordTypeId` in that case.
 * https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_responses_object_info.htm
 */
export const MASTER_RECORD_TYPE_ID = "012000000000000AAA";

/** UI API dataTypes that have picklist values behind them. */
const PICKLIST_TYPES = new Set(["Picklist", "MultiPicklist"]);

export function isPicklistType(dataType: string): boolean {
  return PICKLIST_TYPES.has(dataType);
}

/** MultiPicklist values travel as one semicolon-delimited string. */
export const MULTI_PICKLIST_SEPARATOR = ";";

export interface PicklistValue {
  label: string;
  value: string;
  /**
   * Indexes into the controlling field's `controllerValues`. Empty for an
   * independent picklist, which is the common case.
   */
  validFor: number[];
}

export interface PicklistField {
  values: PicklistValue[];
  /** The value Salesforce pre-selects, or null when there is no default. */
  defaultValue: string | null;
  /**
   * Controlling field value -> its index in each value's `validFor`. Empty
   * unless this picklist depends on another field.
   */
  controllerValues: Record<string, number>;
}

/** Field API name -> its picklist. Non-picklist fields are absent. */
export type PicklistMap = Record<string, PicklistField>;

/* ---- UI API shapes --------------------------------------------------- */

interface UiPicklistValue {
  label?: string | null;
  value?: string | null;
  validFor?: number[] | null;
}

interface UiPicklist {
  values?: UiPicklistValue[] | null;
  defaultValue?: UiPicklistValue | null;
  controllerValues?: Record<string, number> | null;
}

interface UiPicklistCollection {
  picklistFieldValues?: Record<string, UiPicklist> | null;
}

/* ---- Cache ------------------------------------------------------------ */

/**
 * Picklist definitions change rarely, so one call per object+record type covers
 * a long stretch of the session — but not the whole of it. A value deactivated
 * or added in Setup used to stay invisible here until the page was reloaded,
 * which is why this now expires under the shared metadata policy.
 *
 * The in-flight deduplication that policy provides matters as much as the cache
 * itself: the grid can mount several editors in the same commit, and without it
 * each one would fire its own identical request before the first resolved.
 */
const cache = createMetadataCache<PicklistMap>();

function cacheKey(objectApiName: string, recordTypeId: string): string {
  return `${objectApiName}:${recordTypeId}`;
}

function parse(payload: UiPicklistCollection): PicklistMap {
  const out: PicklistMap = {};
  for (const [apiName, picklist] of Object.entries(
    payload.picklistFieldValues ?? {},
  )) {
    out[apiName] = {
      values: (picklist.values ?? []).flatMap((entry) =>
        entry?.value == null
          ? []
          : [
              {
                value: entry.value,
                label: entry.label ?? entry.value,
                validFor: entry.validFor ?? [],
              },
            ],
      ),
      defaultValue: picklist.defaultValue?.value ?? null,
      controllerValues: picklist.controllerValues ?? {},
    };
  }
  return out;
}

/**
 * Every picklist on an object, for one record type.
 *
 * `recordTypeId` is what makes the answer correct rather than merely plausible:
 * record types restrict which values are available, so asking under the master
 * record type would offer values the record can't actually take. Callers that
 * have no record in hand (the Data Export builder, which filters across all
 * records) pass the master type deliberately.
 */
export async function getPicklistValues(
  objectApiName: string,
  recordTypeId: string = MASTER_RECORD_TYPE_ID,
  init?: SfRequestInit,
): Promise<PicklistMap> {
  return cache.load(cacheKey(objectApiName, recordTypeId), async () => {
    const payload = await uiApiGet<UiPicklistCollection>(
      `/ui-api/object-info/${encodeURIComponent(objectApiName)}/picklist-values/${encodeURIComponent(recordTypeId)}`,
      init,
    );
    return parse(payload);
  });
}

/**
 * The values to offer for one field.
 *
 * For a dependent picklist, `controllingValue` narrows the list to what
 * Salesforce would actually accept. When the controlling field is empty or
 * holds a value the map doesn't know, every value is offered rather than none —
 * an empty dropdown reads as "this field is broken", while a slightly wide one
 * still lets the user pick, and Salesforce rejects a genuinely invalid pair on
 * save with its own message.
 */
export function optionsFor(
  field: PicklistField,
  controllingValue?: string | null,
): PicklistValue[] {
  const index = controllingValue
    ? field.controllerValues[controllingValue]
    : undefined;
  if (index === undefined) return field.values;
  return field.values.filter((value) => value.validFor.includes(index));
}

/**
 * Drop cached picklists — used when the user asks for genuinely fresh metadata.
 *
 * Called for real now, from the Data Export and Data Import object pickers.
 * For most of this file's life only its own tests called it, so a picklist
 * value added in Setup stayed invisible for the rest of the session.
 *
 * One object drops every record type beneath it: the keys are `object:type`,
 * and someone asking for an object's current picklists means all of them, not
 * whichever record type happens to be on screen.
 */
export function clearPicklistCache(objectApiName?: string): void {
  if (!objectApiName) cache.clear();
  else cache.invalidatePrefix(`${objectApiName}:`);
}
