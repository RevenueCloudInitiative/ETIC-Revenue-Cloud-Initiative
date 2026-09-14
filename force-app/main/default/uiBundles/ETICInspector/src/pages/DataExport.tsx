import { useCallback, useMemo, useState } from "react";
import { Spinner } from "../components/ui/spinner";
import { Banner } from "../components/Banner";
import { PageHeader, PageShell } from "../components/PageShell";
import { SegmentedControl } from "../components/SegmentedControl";
import {
  filterableFields,
  getObjectFields,
  groupableFields,
  measurableFields,
  selectableFields,
  sortableFields,
  type ObjectFields,
} from "../api/dataExport";
import { isPicklistType } from "../api/picklists";
import { updateRecordFields } from "../api/recordUpdate";
import { AggregateResultsGrid } from "../features/data-export/components/AggregateResultsGrid";
import { DeleteConfirmDialog } from "../features/data-export/components/DeleteConfirmDialog";
import { ExportBar } from "../features/data-export/components/ExportBar";
import { FieldPicker } from "../features/data-export/components/FieldPicker";
import { FilterBuilder } from "../features/data-export/components/FilterBuilder";
import { ObjectPicker } from "../features/data-export/components/ObjectPicker";
import { QueryHistoryPanel } from "../features/data-export/components/QueryHistoryPanel";
import { QueryPreview } from "../features/data-export/components/QueryPreview";
import { ResultsGrid } from "../features/data-export/components/ResultsGrid";
import { SummarizeBuilder } from "../features/data-export/components/SummarizeBuilder";
import { SetupLinks } from "../features/inspector/components/SetupLinks";
import {
  AGGREGATE_MAX_LIMIT,
  emptyAggregateSpec,
  RECORD_COUNT_MEASURE,
  type AggregateSpec,
  type GroupByField,
  type Measure,
} from "../features/data-export/query/aggregate";
import {
  toAggregateSoqlText,
  toSoqlText,
} from "../features/data-export/query/toSoqlText";
import {
  emptySpec,
  MAX_LIMIT,
  type Filter,
  type OrderBy,
  type QuerySpec,
} from "../features/data-export/query/types";
import type { FieldMeta, FieldMetaMap } from "../lib/fieldMeta";
import { useAggregate } from "../hooks/useAggregate";
import { useDataExport } from "../hooks/useDataExport";
import { useObjectLoader } from "../hooks/useObjectLoader";
import { usePicklistValues } from "../hooks/usePicklistValues";
import { useQueryHistory, type HistoryEntry } from "../hooks/useQueryHistory";
import { toFriendlyMessage } from "../lib/errors";
import { useSessionState } from "../lib/sessionState";
import { toast } from "../components/ui/sonner";

/** Which builder the page is showing. */
type Mode = "rows" | "summarize";

/**
 * Stable empty metadata. A literal `{}` fallback would allocate a new object on
 * every render, which changes the identity `meta` is keyed on and silently
 * defeats every useMemo below it.
 */
const NO_META: FieldMetaMap = Object.freeze({});

export default function DataExportPage() {
  // Everything the user built by hand outlives a tab switch. The transient
  // bits below it — a request in flight, an open dialog — deliberately do not.
  const [mode, setMode] = useSessionState<Mode>("dataExport.mode", "rows");
  const [spec, setSpec] = useSessionState<QuerySpec>(
    "dataExport.spec",
    emptySpec,
  );
  /**
   * Summarize keeps its own spec and its own results. Switching modes is a
   * change of question, not a change of query — flipping back should show what
   * you had, not a cleared builder, and neither mode's results are discarded
   * because both cost API calls the org was already billed for.
   */
  const [aggSpec, setAggSpec] = useSessionState<AggregateSpec>(
    "dataExport.aggSpec",
    emptyAggregateSpec,
  );
  const [metaByObject, setMetaByObject] = useSessionState<
    Record<string, FieldMetaMap>
  >("dataExport.meta", {});
  const [labelByObject, setLabelByObject] = useSessionState<
    Record<string, string>
  >("dataExport.labels", {});
  const [selected, setSelected] = useSessionState<Set<string>>(
    "dataExport.selected",
    () => new Set(),
  );

  /** Parent objects currently being fetched by a relationship expansion. */
  const [loadingObjects, setLoadingObjects] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { status, result, error, run, remove, dropRows, applyRowUpdate } =
    useDataExport();
  const {
    status: aggStatus,
    result: aggResult,
    error: aggError,
    run: runAggregateQuery,
  } = useAggregate();
  const {
    entries,
    record,
    remove: removeHistoryEntry,
    clear,
  } = useQueryHistory();

  const meta = useMemo(
    () => metaByObject[spec.objectApiName] ?? NO_META,
    [metaByObject, spec.objectApiName],
  );

  /**
   * A different object is now the subject, so the builder starts over.
   *
   * `useObjectLoader` serves a cached copy straight away and checks with the
   * org behind it — picking an object is still an explicit request for it as it
   * is *now*, the wait for that answer just no longer sits in front of the
   * user. `loadRelatedObject` below deliberately does not force a refresh at
   * all: expanding a lookup is incidental browsing, and re-fetching on every
   * expansion is what the cache exists to prevent.
   */
  const pickObject = useCallback(
    (loaded: ObjectFields) => {
      setMetaByObject((m) => ({ ...m, [loaded.apiName]: loaded.fields }));
      setLabelByObject((l) => ({ ...l, [loaded.apiName]: loaded.label }));
      // A new object invalidates field and filter choices entirely. Id leads
      // the default selection because it's the link back to the record — it
      // can be unticked like any other field, and the query still requests it
      // internally as the row key.
      setSpec({
        ...emptySpec(loaded.apiName),
        fields: loaded.fields.Name ? ["Id", "Name"] : ["Id"],
      });
      // Summarize starts on the one measure valid for every object, so the mode
      // is runnable the moment an object is picked.
      setAggSpec({
        ...emptyAggregateSpec(loaded.apiName),
        measures: [{ id: "records", ...RECORD_COUNT_MEASURE }],
      });
      setSelected(new Set());
    },
    [setMetaByObject, setLabelByObject, setSpec, setAggSpec, setSelected],
  );

  /**
   * The background check found a newer field list for the object already
   * loaded.
   *
   * Metadata only. Resetting `spec` here would throw away a query the user has
   * been building since the click, which is the one thing a refresh they never
   * asked for must not do — and unlike a fresh pick, nothing about it is
   * invalidated: the object is the same, so every field already chosen is still
   * a field on it.
   */
  const refreshObject = useCallback(
    (fresh: ObjectFields) => {
      setMetaByObject((m) => ({ ...m, [fresh.apiName]: fresh.fields }));
      setLabelByObject((l) => ({ ...l, [fresh.apiName]: fresh.label }));
      toast.info(`${fresh.label}'s field list changed since it was loaded.`);
    },
    [setMetaByObject, setLabelByObject],
  );

  const {
    loading: objectLoading,
    error: objectError,
    load: loadObject,
  } = useObjectLoader({ onPicked: pickObject, onRefreshed: refreshObject });

  /**
   * Load a *parent* object's metadata so its fields can be picked through a
   * relationship. Separate from `loadObject` because it must not touch the
   * builder — expanding Account on an Opportunity query changes what you can
   * select, not what you're querying.
   */
  const loadRelatedObject = useCallback(
    async (objectApiName: string) => {
      setLoadingObjects((prev) => new Set(prev).add(objectApiName));
      try {
        const loaded = await getObjectFields(objectApiName);
        setMetaByObject((m) => ({ ...m, [loaded.apiName]: loaded.fields }));
        setLabelByObject((l) => ({ ...l, [loaded.apiName]: loaded.label }));
      } catch {
        // A parent the user can't read simply doesn't expand. The row stays
        // open with no children rather than raising an error over the query
        // the user is actually building.
      } finally {
        setLoadingObjects((prev) => {
          const next = new Set(prev);
          next.delete(objectApiName);
          return next;
        });
      }
    },
    [setMetaByObject, setLabelByObject],
  );

  const allFields = useMemo(() => selectableFields(meta), [meta]);

  /*
   * `FieldPicker` is `memo`'d, and these three are what let the memo hold.
   * Written inline they allocated a new function on every render of this page,
   * so ticking a result-row checkbox or opening the delete dialog re-rendered
   * up to 100 field rows — measured at 52 ms and 66 ms respectively on Account.
   * `setSpec` is stable, so the empty dependency list is correct.
   */
  const toggleField = useCallback(
    (path: string) =>
      setSpec((s) => ({
        ...s,
        fields: s.fields.includes(path)
          ? s.fields.filter((f) => f !== path)
          : [...s.fields, path],
      })),
    [setSpec],
  );

  const selectAllFields = useCallback(
    (paths: string[]) =>
      setSpec((s) => ({ ...s, fields: [...new Set([...s.fields, ...paths])] })),
    [setSpec],
  );

  const clearFields = useCallback(
    () => setSpec((s) => ({ ...s, fields: [] })),
    [setSpec],
  );

  /**
   * Fields on parent records, offered to the filter and sort selectors as
   * dotted paths.
   *
   * Limited to **one** level, and only through relationships whose target
   * object is already loaded — which in practice means "ones you expanded in
   * the field picker". Going deeper would multiply an already-long list on wide
   * objects and needs a cycle guard (Account › Owner › Account …), while the
   * value drops off sharply: filtering on `Account.Name` is common, on
   * `Account.Owner.Manager.Name` it is not. Selecting columns is unrestricted —
   * the compiler nests to any depth.
   */
  const parentFields = useMemo(() => {
    const out: FieldMeta[] = [];
    for (const field of Object.values(meta)) {
      if (!field.relationshipName || !field.referenceTo) continue;
      const target = metaByObject[field.referenceTo];
      if (!target) continue;
      const prefix = field.relationshipName;
      // "Account ID" reads wrong as the parent step; the step is the account.
      const parentLabel = field.label.replace(/\s*ID$/i, "");
      for (const child of Object.values(target)) {
        if (child.compound) continue;
        out.push({
          ...child,
          apiName: `${prefix}.${child.apiName}`,
          label: `${parentLabel} › ${child.label}`,
        });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [meta, metaByObject]);

  const filterable = useMemo(
    () => [
      ...filterableFields(meta),
      ...parentFields.filter((f) => f.filterable),
    ],
    [meta, parentFields],
  );
  const sortable = useMemo(
    () => [...sortableFields(meta), ...parentFields.filter((f) => f.sortable)],
    [meta, parentFields],
  );
  const groupable = useMemo(() => groupableFields(meta), [meta]);
  const measurable = useMemo(() => measurableFields(meta), [meta]);

  const summarizing = mode === "summarize";

  const soql = useMemo(
    () =>
      summarizing
        ? toAggregateSoqlText(aggSpec, meta)
        : // The full map, not just the queried object: the preview types parent
          // filter literals through the same resolver the query compiler uses,
          // so the two cannot describe different filters.
          toSoqlText(spec, metaByObject),
    [summarizing, aggSpec, spec, meta, metaByObject],
  );

  const canRun = summarizing
    ? Boolean(aggSpec.objectApiName) &&
      (aggSpec.measures.length > 0 || aggSpec.groupBy.length > 0)
    : Boolean(spec.objectApiName) && spec.fields.length > 0;

  /**
   * Picklist options cost one call per object, so they are fetched only once a
   * picklist is actually in play: a filter on one, or a picklist column in the
   * results that a row edit could touch. Picking an object and choosing fields
   * still costs nothing.
   *
   * Fetched under the master record type deliberately. The builder queries
   * across every record of the object, so scoping the values to one record type
   * would hide values that genuinely occur in the data being filtered.
   */
  const needsPicklists = useMemo(() => {
    if (!spec.objectApiName) return false;
    const isPicklist = (apiName: string) =>
      isPicklistType(meta[apiName]?.dataType ?? "");
    // Either mode's filters can put a picklist in play; Summarize results
    // never need them, since a group value is displayed, never edited.
    if (spec.filters.some((filter) => isPicklist(filter.field))) return true;
    if (aggSpec.filters.some((filter) => isPicklist(filter.field))) return true;
    return (
      result?.objectApiName === spec.objectApiName &&
      result.columns.some(isPicklist)
    );
  }, [spec.objectApiName, spec.filters, aggSpec.filters, meta, result]);

  const { picklists } = usePicklistValues(
    spec.objectApiName,
    null,
    needsPicklists,
  );

  // The results may still be showing an earlier object while the builder has
  // moved on. Handing that grid another object's picklists would offer values
  // from the wrong object entirely.
  const resultPicklists =
    result?.objectApiName === spec.objectApiName ? picklists : null;

  const handleRun = useCallback(() => {
    if (!canRun) return;
    if (summarizing) {
      runAggregateQuery(aggSpec, meta);
      return;
    }
    setSelected(new Set());
    record(spec);
    run(spec, metaByObject);
  }, [
    canRun,
    summarizing,
    runAggregateQuery,
    aggSpec,
    record,
    run,
    spec,
    meta,
    metaByObject,
    setSelected,
  ]);

  const restore = useCallback(
    (entry: HistoryEntry) => {
      // History holds row queries only, so restoring one is also a request to
      // be looking at the row builder.
      setMode("rows");
      setSpec(entry.spec);
      setSelected(new Set());
      // Metadata for a previously used object is already cached, so this is
      // free unless the page was remounted.
      if (!metaByObject[entry.spec.objectApiName]) {
        void loadObject(entry.spec.objectApiName);
      }
    },
    [loadObject, metaByObject, setMode, setSpec, setSelected],
  );

  const toggleRow = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [setSelected],
  );

  const selectRange = useCallback(
    (ids: string[]) => {
      setSelected((prev) => new Set([...prev, ...ids]));
    },
    [setSelected],
  );

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, [setSelected]);

  const toggleAll = useCallback(
    (ids: string[]) => {
      setSelected((prev) => {
        const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
        const next = new Set(prev);
        for (const id of ids) {
          if (allSelected) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    },
    [setSelected],
  );

  const saveRow = useCallback(
    async (id: string, values: Record<string, string>) => {
      try {
        const updated = await updateRecordFields({
          recordId: id,
          fields: values,
        });
        applyRowUpdate(
          id,
          Object.fromEntries(
            Object.entries(updated.fields).map(([k, v]) => [
              k,
              v?.value ?? null,
            ]),
          ),
        );
        toast.success(`Saved ${id}.`);
        return true;
      } catch (err) {
        toast.error(toFriendlyMessage(err, { query: id, target: "record" }));
        return false;
      }
    },
    [applyRowUpdate],
  );

  const confirmDelete = useCallback(async () => {
    const ids = [...selected];
    setDeleting(true);
    // The object the rows came from, not whatever the builder is showing now.
    const outcome = await remove(
      result?.objectApiName ?? spec.objectApiName,
      ids,
    );
    setDeleting(false);
    setConfirmOpen(false);

    if (!outcome) return;
    dropRows(outcome.deleted);
    setSelected(new Set());

    const parts = [`Deleted ${outcome.deleted.length} of ${ids.length}`];
    if (outcome.failed.length > 0) {
      parts.push(
        `${outcome.failed.length} failed — ${outcome.failed[0].message}`,
      );
    }
    parts.push(
      `${outcome.calls} API ${outcome.calls === 1 ? "call" : "calls"}`,
    );
    // Any failure makes the whole outcome worth looking at: a partial delete
    // needs attention just as much as a total one, and it gets longer on screen
    // because it carries counts someone may want to read twice.
    const text = parts.join(" · ");
    if (outcome.failed.length > 0) toast.error(text, { duration: 10_000 });
    else toast.success(text);
  }, [
    selected,
    remove,
    result?.objectApiName,
    spec.objectApiName,
    dropRows,
    setSelected,
  ]);

  const exportTable = useMemo(
    () => ({
      columns: result?.columns ?? [],
      rows: (result?.rows ?? []).map((r) => r.display),
    }),
    [result],
  );

  /**
   * The summary exports under its column *labels* ("Sum of Amount"), not the
   * internal keys — a spreadsheet headed `m:Amount:sum` would be unreadable.
   */
  const aggExportTable = useMemo(
    () => ({
      columns: (aggResult?.columns ?? []).map((c) => c.label),
      rows: (aggResult?.rows ?? []).map((row) =>
        Object.fromEntries(
          (aggResult?.columns ?? []).map((c) => [c.label, row.display[c.key]]),
        ),
      ),
    }),
    [aggResult],
  );

  // The loading, error and idle panels are identical in both modes; only the
  // success panel differs, so the shared ones read from whichever is active.
  const activeStatus = summarizing ? aggStatus : status;
  const activeError = summarizing ? aggError : error;

  return (
    <PageShell>
      <PageHeader
        title="Data Export"
        description={
          summarizing
            ? "Group records and calculate totals — one call, however many records it covers."
            : "Build a query, review the results, export them, or clean them up."
        }
        actions={
          <>
            {/*
              Both modes share the object, its metadata and the filter builder,
              so this is a switch between two questions about the same object
              rather than two pages. Switching costs nothing: the metadata is
              already cached, and neither mode's results are thrown away.
            */}
            <SegmentedControl
              label="Query mode"
              size="sm"
              value={mode}
              options={[
                { value: "rows", label: "Rows" },
                { value: "summarize", label: "Summarize" },
              ]}
              onChange={setMode}
            />
            {/* Disabled until an object is picked — every link here is object-scoped. */}
            <SetupLinks objectApiName={spec.objectApiName || undefined} />
          </>
        }
      />

      {/*
        20rem, matching the Users tab's sidebar — the results table is the wide
        thing on this page and every rem the builder doesn't take is a column
        that doesn't need horizontal scrolling. It doesn't go much below this:
        the filter rows are already stacked two-per-row (see `FilterBuilder`)
        precisely because these controls side by side truncate their labels.
      */}
      <div className="grid gap-6 xl:grid-cols-[20rem_1fr]">
        {/* Builder */}
        <aside className="flex flex-col gap-5">
          <ObjectPicker
            value={spec.objectApiName}
            loading={objectLoading}
            resolvedLabel={labelByObject[spec.objectApiName] ?? null}
            error={objectError}
            onSubmit={loadObject}
          />

          {spec.objectApiName && !objectLoading && !summarizing && (
            <>
              <FieldPicker
                fields={allFields}
                selected={spec.fields}
                metaByObject={metaByObject}
                onLoadObject={loadRelatedObject}
                loadingObjects={loadingObjects}
                onToggle={toggleField}
                onSelectAll={selectAllFields}
                onClear={clearFields}
              />

              <FilterBuilder
                filters={spec.filters}
                filterable={filterable}
                sortable={sortable}
                orderBy={spec.orderBy}
                limit={spec.limit}
                maxLimit={MAX_LIMIT}
                picklists={picklists}
                onChange={(filters: Filter[]) =>
                  setSpec((s) => ({ ...s, filters }))
                }
                onOrderByChange={(orderBy: OrderBy | null) =>
                  setSpec((s) => ({ ...s, orderBy }))
                }
                onLimitChange={(limit) => setSpec((s) => ({ ...s, limit }))}
              />
            </>
          )}

          {spec.objectApiName && !objectLoading && summarizing && (
            <>
              <SummarizeBuilder
                groupBy={aggSpec.groupBy}
                measures={aggSpec.measures}
                groupable={groupable}
                measurable={measurable}
                onGroupByChange={(groupBy: GroupByField[]) =>
                  setAggSpec((s) => ({ ...s, groupBy }))
                }
                onMeasuresChange={(measures: Measure[]) =>
                  setAggSpec((s) => ({ ...s, measures }))
                }
              />

              {/*
                No sort control: `uiapi.aggregate` has no usable server-side
                ordering, so the summary sorts by clicking a column header.
              */}
              <FilterBuilder
                filters={aggSpec.filters}
                filterable={filterable}
                limit={aggSpec.limit}
                maxLimit={AGGREGATE_MAX_LIMIT}
                limitLabel="Max groups"
                picklists={picklists}
                onChange={(filters: Filter[]) =>
                  setAggSpec((s) => ({ ...s, filters }))
                }
                onLimitChange={(limit) => setAggSpec((s) => ({ ...s, limit }))}
              />
            </>
          )}

          <QueryHistoryPanel
            entries={entries}
            metaByObject={metaByObject}
            onRestore={restore}
            onRemove={removeHistoryEntry}
            onClear={clear}
          />
        </aside>

        {/* Query + results */}
        <section className="min-w-0">
          <div className="mb-4">
            <QueryPreview
              soql={soql}
              loading={(summarizing ? aggStatus : status) === "loading"}
              canRun={canRun}
              onRun={handleRun}
            />
          </div>

          {activeStatus === "loading" && (
            <div className="text-muted-foreground border-border bg-card flex items-center justify-center gap-2 rounded-lg border px-4 py-12 text-sm">
              <Spinner />
              {summarizing ? "Summarizing…" : "Running query…"}
            </div>
          )}

          {activeStatus === "error" && activeError && (
            <Banner tone="destructive">
              <span className="break-words">{activeError}</span>
            </Banner>
          )}

          {activeStatus === "idle" && (
            <div className="text-muted-foreground bg-muted/50 border-border rounded-lg border px-4 py-10 text-center text-sm">
              {summarizing
                ? "Choose an object, then add a grouping or a measure and Run."
                : "Choose an object and at least one field, then Run."}
            </div>
          )}

          {summarizing && aggStatus === "success" && aggResult && (
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground text-sm">
                {aggResult.rows.length.toLocaleString()}{" "}
                {aggResult.rows.length === 1 ? "group" : "groups"} over{" "}
                {aggResult.recordCount.toLocaleString()} matching{" "}
                {aggResult.recordCount === 1 ? "record" : "records"}
                {aggResult.rows.length >= aggSpec.limit && (
                  <span className="ml-2 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                    Capped at {aggSpec.limit.toLocaleString()} groups — raise
                    the limit or group by fewer fields
                  </span>
                )}
              </p>

              <ExportBar
                table={aggExportTable}
                baseName={`${aggResult.objectApiName}-summary`}
              />

              <AggregateResultsGrid
                columns={aggResult.columns}
                rows={aggResult.rows}
              />
            </div>
          )}

          {!summarizing && status === "success" && result && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-sm">
                  {result.rows.length.toLocaleString()} of{" "}
                  {result.totalCount.toLocaleString()} matching records
                  {result.truncated && (
                    <span className="ml-2 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                      Limited — narrow the filters or raise the limit
                    </span>
                  )}
                </p>
              </div>

              <ExportBar
                table={exportTable}
                baseName={`${result.objectApiName}-export`}
                selectedCount={selected.size}
                onDeleteClick={() => setConfirmOpen(true)}
              />

              <ResultsGrid
                columns={result.columns}
                rows={result.rows}
                // Metadata for the queried object — a plain lookup, so the
                // reference stays stable and the grid's memoization holds.
                meta={metaByObject[result.objectApiName] ?? NO_META}
                metaByObject={metaByObject}
                picklists={resultPicklists}
                objectApiName={result.objectApiName}
                selected={selected}
                onToggleRow={toggleRow}
                onToggleAll={toggleAll}
                onSelectRange={selectRange}
                onClearSelection={clearSelection}
                onSaveRow={saveRow}
              />
            </div>
          )}
        </section>
      </div>

      <DeleteConfirmDialog
        open={confirmOpen}
        count={selected.size}
        objectLabel={
          result
            ? (labelByObject[result.objectApiName] ?? result.objectApiName)
            : spec.objectApiName
        }
        deleting={deleting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmDelete}
      />
    </PageShell>
  );
}
