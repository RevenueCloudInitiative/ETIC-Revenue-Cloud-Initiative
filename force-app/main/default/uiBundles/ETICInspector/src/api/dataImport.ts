/**
 * Data layer for the Data Import page.
 *
 * Writes go through GraphQL `uiapi` rather than UI API REST for one reason:
 * REST creates one record per request, while an aliased GraphQL mutation
 * carries up to 75. Importing 500 rows costs ~10 calls instead of 500 against
 * the org's shared daily limit — the difference between a usable feature and
 * one nobody can afford to run.
 *
 * Field metadata and picklist values come from the same cached helpers Data
 * Export uses (`getObjectFields`, `getPicklistValues`), so opening the importer
 * on an object already loaded elsewhere costs nothing.
 */
import { executeGraphQLRaw } from "./graphqlClient";
import { runQuery } from "./dataExport";
import { runMutationBatches } from "./mutationBatch";
import {
  diffSnapshots,
  type ChangeReport,
  type ValueSnapshot,
} from "../features/data-import/import/changes";
import {
  chunkRows,
  toImportMutation,
} from "../features/data-import/import/toMutation";
import {
  planFields,
  type ImportPlan,
} from "../features/data-import/import/scope";
import type { ImportSpec } from "../features/data-import/import/types";
import { MAX_LIMIT } from "../features/data-export/query/types";
import { COMPOUND_TYPES, type FieldMetaMap } from "../lib/fieldMeta";

export interface RowOutcome {
  /** Index into `spec.rows` — the user's row, not the batch's. */
  rowIndex: number;
  /** Id of the record created or updated. */
  id: string | null;
  /** Salesforce's own message when the row failed. */
  message: string | null;
}

export interface ImportOutcome {
  objectApiName: string;
  operation: ImportSpec["operation"];
  succeeded: RowOutcome[];
  failed: RowOutcome[];
  /** API calls actually spent, so the UI reports the real cost. */
  calls: number;
  /**
   * Ids created by an insert, in row order.
   *
   * This is what makes "undo" possible: after an insert the created records are
   * known exactly, so removing them is the existing delete path rather than a
   * guess about what changed. Empty for an update.
   */
  createdIds: string[];
  /**
   * Field-level before/after for an update, or null when it couldn't be read.
   *
   * Null is deliberately distinct from an empty report: "we didn't manage to
   * look" and "nothing changed" are different claims, and only one of them is
   * safe to put on screen. Always null for an insert, where there is no before.
   */
  changes: ChangeReport | null;
  /** The fields the update wrote, in mapped order — the report's columns. */
  changedFieldOrder: string[];
}

export interface ImportProgress {
  /** Chunks finished so far. */
  done: number;
  /** Chunks in total. */
  total: number;
}

interface CreatePayload {
  Record?: { Id?: string } | null;
}

/**
 * Which fields an update actually writes.
 *
 * Taken from the plan rather than from the whole mapping, so a run narrowed to
 * the cells the user edited reports on exactly those fields. `Id` is the
 * mutation's argument rather than an assignment, so it never changes and
 * reporting it as unchanged would be noise. Compound parents are dropped
 * because they can't be selected in a query, and one unselectable field fails
 * the whole document rather than one column.
 */
function writtenFields(
  spec: ImportSpec,
  fields: FieldMetaMap,
  plan: ImportPlan,
): string[] {
  return planFields(spec, fields, plan).filter(
    (field) => !COMPOUND_TYPES.has(fields[field]?.dataType ?? ""),
  );
}

/**
 * Read the current formatted values of a set of records.
 *
 * Goes through `runQuery` rather than a second GraphQL compiler — it already
 * knows how to select fields, unwrap the `{ value, displayValue }` envelope and
 * pass `fresh: true`, and it is the code path the rest of the app exercises
 * constantly. `Id in (…)` is one call per 2,000 records
 * ([query limits](https://developer.salesforce.com/docs/platform/graphql/guide/query-limits.html)),
 * so a 500-row import pays one extra call for its before picture and one for
 * its after.
 */
async function snapshotValues(
  objectApiName: string,
  ids: string[],
  fields: string[],
  metaByObject: Record<string, FieldMetaMap>,
  signal?: AbortSignal,
): Promise<{ snapshot: ValueSnapshot; calls: number }> {
  const snapshot: ValueSnapshot = new Map();
  let calls = 0;

  for (let i = 0; i < ids.length; i += MAX_LIMIT) {
    const chunk = ids.slice(i, i + MAX_LIMIT);
    const outcome = await runQuery(
      {
        objectApiName,
        fields: ["Id", ...fields],
        filters: [
          { id: "ids", field: "Id", operator: "in", value: chunk.join(",") },
        ],
        orderBy: null,
        limit: MAX_LIMIT,
      },
      metaByObject,
      { signal },
    );
    calls++;
    for (const row of outcome.rows) snapshot.set(row.id, row.display);
  }

  return { snapshot, calls };
}

/**
 * Run the import.
 *
 * Chunks are sent **sequentially, not in parallel**. Two reasons: a partially
 * completed import should stop at the point the user aborted rather than have
 * an unknown number of requests already in flight, and firing twenty concurrent
 * mutations at one org is a good way to meet a concurrency limit that is much
 * harder to explain than a slow progress bar.
 */
export async function importRecords(
  spec: ImportSpec,
  fields: FieldMetaMap,
  /** Which rows, and how much of each — see `scope.ts`. */
  plan: ImportPlan,
  init: {
    signal?: AbortSignal;
    onProgress?: (progress: ImportProgress) => void;
  } = {},
): Promise<ImportOutcome> {
  const succeeded: RowOutcome[] = [];
  const failed: RowOutcome[] = [];
  const createdIds: string[] = [];

  const rowIndexes = plan.rowIndexes;
  const tracking = spec.operation === "update";
  const trackedFields = tracking ? writtenFields(spec, fields, plan) : [];
  const metaByObject = { [spec.objectApiName]: fields };

  /**
   * Read the "before" picture *before* anything is written, obviously — but
   * also treat failing to get it as a non-event. This is a report about the
   * import, not part of it, and refusing to run someone's update because the
   * reporting query didn't come back would be the wrong trade every time.
   */
  const idColumn = spec.mapping.indexOf("Id");
  const attemptedIds = tracking
    ? rowIndexes.map((rowIndex) =>
        (spec.rows[rowIndex]?.[idColumn] ?? "").trim(),
      )
    : [];

  let before: ValueSnapshot | null = null;
  let readCalls = 0;
  if (tracking && trackedFields.length > 0) {
    try {
      const read = await snapshotValues(
        spec.objectApiName,
        attemptedIds.filter(Boolean),
        trackedFields,
        metaByObject,
        init.signal,
      );
      before = read.snapshot;
      readCalls += read.calls;
    } catch {
      before = null;
    }
  }

  const chunks = chunkRows(rowIndexes).map((chunk) =>
    toImportMutation(spec, fields, chunk, plan.columnsByRow),
  );
  init.onProgress?.({ done: 0, total: chunks.length });

  const { calls } = await runMutationBatches(
    chunks,
    (document) =>
      executeGraphQLRaw<Record<string, unknown>, undefined>(document),
    (rowIndex, outcome) => {
      if (!outcome.ok) {
        failed.push({ rowIndex, id: null, message: outcome.message });
        return;
      }
      const id = (outcome.value as CreatePayload)?.Record?.Id ?? null;
      succeeded.push({ rowIndex, id, message: null });
      if (spec.operation === "insert" && id) createdIds.push(id);
    },
    {
      signal: init.signal,
      onChunkDone: (done, total) => init.onProgress?.({ done, total }),
    },
  );

  // Row order is the user's order, not the order aliases happened to resolve in.
  const byRow = (a: RowOutcome, b: RowOutcome) => a.rowIndex - b.rowIndex;
  succeeded.sort(byRow);
  failed.sort(byRow);

  /**
   * The "after" picture, read only for the records that actually succeeded.
   *
   * This is a genuinely fresh read rather than a replay of what was sent, which
   * is the point: Salesforce rounds, truncates to field scale, applies formulas
   * and runs workflow, so "what we sent" and "what is stored" are not always the
   * same value — and the case where they differ is exactly the one worth
   * showing. `runQuery` passes `fresh: true`, and the mutation has already
   * called `markDataMutated()`, so nothing here can be served from cache.
   */
  let changes: ChangeReport | null = null;
  if (before && succeeded.length > 0) {
    const updated = succeeded
      .filter((row) => row.id)
      .map((row) => ({ rowIndex: row.rowIndex, id: row.id as string }));
    try {
      const read = await snapshotValues(
        spec.objectApiName,
        updated.map((row) => row.id),
        trackedFields,
        metaByObject,
        init.signal,
      );
      readCalls += read.calls;
      changes = diffSnapshots(updated, before, read.snapshot, trackedFields);
    } catch {
      changes = null;
    }
  }

  return {
    objectApiName: spec.objectApiName,
    operation: spec.operation,
    succeeded,
    failed,
    // The reporting reads are billed to the org like anything else, so they are
    // counted here rather than quietly left out of the number shown to the user.
    calls: calls + readCalls,
    createdIds,
    changes,
    changedFieldOrder: trackedFields,
  };
}
