import { AlertCircle, Play, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getObjectFields, type ObjectFields } from "../api/dataExport";
import { Spinner } from "../components/ui/spinner";
import { Button } from "../components/ui/button";
import { Banner } from "../components/Banner";
import { PageHeader, PageShell } from "../components/PageShell";
import { toast } from "../components/ui/sonner";
import { SegmentedControl } from "../components/SegmentedControl";
import { ColumnMapper } from "../features/data-import/components/ColumnMapper";
import { DataGrid } from "../features/data-import/components/DataGrid";
import { ImportConfirmDialog } from "../features/data-import/components/ImportConfirmDialog";
import { ImportResults } from "../features/data-import/components/ImportResults";
import { SourceInput } from "../features/data-import/components/SourceInput";
import { StickyActionBar } from "../components/StickyActionBar";
import { ObjectPicker } from "../features/data-export/components/ObjectPicker";
import { SetupLinks } from "../features/inspector/components/SetupLinks";
import {
  autoMapColumns,
  canonicalFieldName,
  MAX_IMPORT_ROWS,
  type ImportOperation,
  type ImportSpec,
} from "../features/data-import/import/types";
import {
  detectObjectFromIds,
  type DetectedObject,
} from "../features/data-import/import/detectObject";
import {
  NO_EDITS,
  recordEdit,
  recordRewrite,
  revertRow,
  shiftEditsForDeletedRow,
  type EditMap,
} from "../features/data-import/import/edits";
import {
  effectiveScope,
  planCellCount,
  planImport,
  type ImportScope,
} from "../features/data-import/import/scope";
import {
  toIsoDate,
  type DateOrder,
} from "../features/data-import/import/dateFix";
import {
  toPlainNumber,
  toSalvagedNumber,
  type DecimalSeparator,
  type NumberFixMode,
} from "../features/data-import/import/numberFix";
import { validateImport } from "../features/data-import/import/validate";
import type { PicklistMap } from "../api/picklists";
import { isDateType, isNumericType } from "../lib/fieldMeta";
import { useDataImport } from "../hooks/useDataImport";
import { useObjectLoader } from "../hooks/useObjectLoader";
import { usePicklistValues } from "../hooks/usePicklistValues";
import { parseDelimited } from "../lib/delimitedParse";
import type { FieldMetaMap } from "../lib/fieldMeta";
import { isSalesforceId } from "../lib/salesforce";
import { useSessionState } from "../lib/sessionState";
import { sectionLabelSpaced } from "../components/sectionLabel";
import { TextButton } from "../components/TextButton";

/**
 * Stable empty metadata. A literal `{}` fallback allocates a new object every
 * render, changing the identity every memo below is keyed on.
 */
const NO_META: FieldMetaMap = Object.freeze({});
const NO_PICKLISTS: PicklistMap = Object.freeze({});

const DELIMITER_LABELS: Record<string, string> = {
  "\t": "tab-separated",
  ",": "comma-separated",
  ";": "semicolon-separated",
  "|": "pipe-separated",
};

/** The parsed table, which becomes the authoritative data once text is parsed. */
interface Table {
  headers: string[];
  rows: string[][];
  delimiter: string;
  ragged: number;
}

const EMPTY_TABLE: Table = Object.freeze({
  headers: [],
  rows: [],
  delimiter: "\t",
  ragged: 0,
});

/** What the page filled in by itself, so it can say so. */
interface AutoFill extends DetectedObject {
  objectLabel: string;
  /** True when it also moved the page off "Create new". */
  switchedOperation: boolean;
}

export default function DataImportPage() {
  // The work the user did by hand survives a tab switch, the same as the Data
  // Export builder. Transient things — a dialog, a request in flight — do not.
  const [objectApiName, setObjectApiName] = useSessionState<string>(
    "dataImport.object",
    "",
  );
  const [operation, setOperation] = useSessionState<ImportOperation>(
    "dataImport.operation",
    "insert",
  );
  const [source, setSource] = useSessionState<string>("dataImport.source", "");
  /**
   * Parsed rows are the authoritative data, not the pasted text.
   *
   * Editing a cell mutates these directly and is deliberately *not* written
   * back to the text: re-serializing would have to re-apply the spreadsheet
   * formula guard from `exportFormats.ts`, so a cell holding `'-5` would gain
   * and lose a leading apostrophe on every keystroke. Text flows one way, into
   * the table.
   */
  const [table, setTable] = useSessionState<Table>(
    "dataImport.table",
    EMPTY_TABLE,
  );
  const [mapping, setMapping] = useSessionState<(string | null)[]>(
    "dataImport.mapping",
    [],
  );
  const [meta, setMeta] = useSessionState<FieldMetaMap>(
    "dataImport.meta",
    NO_META,
  );
  const [objectLabel, setObjectLabel] = useSessionState<string>(
    "dataImport.label",
    "",
  );
  /**
   * Cells changed since the paste, and what they held before.
   *
   * Kept beside the table rather than derived from it, because the pasted text
   * is not a usable "before" picture — it has already been through the
   * spreadsheet formula guard, and a 5,000-row second copy of the table is not
   * worth keeping to answer a question three edits can answer.
   */
  const [edits, setEdits] = useSessionState<EditMap>(
    "dataImport.edits",
    NO_EDITS,
  );
  const [scope, setScope] = useSessionState<ImportScope>(
    "dataImport.scope",
    "all",
  );

  /**
   * The auto-fill's own spinner. It can't share the object loader's, because it
   * deliberately doesn't go through it — a guess must not force a fresh fetch.
   */
  const [autoFilling, setAutoFilling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [textCollapsed, setTextCollapsed] = useState(false);
  const [autoFilled, setAutoFilled] = useState<AutoFill | null>(null);

  const { status, result, error, progress, undone, run, undo, reset } =
    useDataImport();

  /**
   * Re-parse when the pasted text changes — during render rather than from an
   * effect, so the table and the text can never be shown a frame out of step.
   * `parsedFrom` is what stops it looping: parsing sets it to the text it just
   * consumed, and cell edits change `table` without touching `source`.
   */
  const [parsedFrom, setParsedFrom] = useState<string | null>(null);
  const [mappedFor, setMappedFor] = useState<string | null>(null);
  if (source !== parsedFrom) {
    setParsedFrom(source);
    const parsed = parseDelimited(source);
    setTable({
      headers: parsed.headers,
      rows: parsed.rows,
      delimiter: parsed.delimiter,
      ragged: parsed.raggedRows,
    });
    // New text means new columns; the old mapping described a different file.
    setMappedFor(null);
    setTextCollapsed(parsed.rows.length > 0);
    // Edits belong to the rows they were made in, and these are different rows.
    setEdits(NO_EDITS);
    setScope("all");
  }

  const spec: ImportSpec = useMemo(
    () => ({
      objectApiName,
      operation,
      headers: table.headers,
      // A mapping shorter than the header row reads as "not mapped" rather than
      // as undefined.
      mapping: table.headers.map((_, i) => mapping[i] ?? null),
      rows: table.rows,
    }),
    [objectApiName, operation, table, mapping],
  );

  // Picklists are only fetched once there is something to validate against.
  const { picklists } = usePicklistValues(
    objectApiName || null,
    null,
    Boolean(objectApiName) && table.rows.length > 0,
  );

  const report = useMemo(
    () => validateImport(spec, meta, picklists ?? {}),
    [spec, meta, picklists],
  );

  // Auto-map once per new header set, without clobbering manual corrections.
  // JSON rather than a joined string: headers are user data, so any separator
  // character could legitimately appear inside one and make two different header
  // sets compare equal.
  const headerKey = JSON.stringify(table.headers);
  if (
    objectApiName &&
    table.headers.length > 0 &&
    headerKey !== mappedFor &&
    status !== "running"
  ) {
    setMappedFor(headerKey);
    setMapping(autoMapColumns(table.headers, meta, operation));
  }

  /** Everything an object load has to settle, however the object was chosen. */
  const applyLoadedObject = useCallback(
    (loaded: ObjectFields) => {
      setObjectApiName(loaded.apiName);
      setObjectLabel(loaded.label);
      setMeta(loaded.fields);
      // A different object invalidates every column guess.
      setMapping([]);
      setMappedFor(null);
    },
    [setObjectApiName, setObjectLabel, setMeta, setMapping],
  );

  /**
   * The background check found a newer field list for the object already on
   * screen.
   *
   * Narrower than `applyLoadedObject` on purpose: the object hasn't changed, so
   * the mapping isn't invalidated by *identity* — but it was guessed against a
   * field list that has since moved, so it is re-guessed rather than left
   * pointing at fields that may no longer be there. Said out loud, because a
   * column mapping rearranging itself half a second after a click is otherwise
   * indistinguishable from a glitch.
   */
  const refreshLoadedObject = useCallback(
    (fresh: ObjectFields) => {
      setObjectLabel(fresh.label);
      setMeta(fresh.fields);
      setMappedFor(null);
      toast.info(
        `${fresh.label}'s field list changed since it was last loaded — the column mapping was re-checked.`,
      );
    },
    [setObjectLabel, setMeta],
  );

  const {
    loading: objectLoading,
    error: objectError,
    load: loadObject,
  } = useObjectLoader({
    onPicked: (loaded) => {
      // Whatever the page guessed, the user has now said otherwise.
      setAutoFilled(null);
      applyLoadedObject(loaded);
    },
    onRefreshed: refreshLoadedObject,
  });

  const switchOperation = useCallback(
    (next: ImportOperation) => {
      setOperation(next);
      // Which fields are writable changes with the operation, so a mapping made
      // for the other one is re-guessed rather than silently kept.
      setMappedFor(null);
      // A note saying the page moved the operation is wrong the moment the user
      // moves it back.
      setAutoFilled(null);
    },
    [setOperation],
  );

  /** The object this file's Id column belongs to, if it has one. */
  const detected = useMemo(
    () =>
      table.rows.length > 0
        ? detectObjectFromIds(table.headers, table.rows)
        : null,
    [table.headers, table.rows],
  );

  /**
   * The Id column belongs to something other than the object that's loaded.
   *
   * Reported rather than acted on. Filling an *empty* box is help; changing a
   * box the user filled in themselves is an argument, and they may well be
   * right — so this says what it sees, names the object, and leaves the press
   * to them. Without it the page would sit silently in front of an import
   * Salesforce is certain to reject row by row.
   */
  const wrongObject =
    detected && objectApiName && detected.objectApiName !== objectApiName
      ? detected
      : null;

  /**
   * Fill the object in from the Id column, and confirm the guess with the org.
   *
   * The static prefix table is a shortcut, not an authority: the object is
   * loaded and then asked what its own `keyPrefix` is, and a mismatch throws
   * the guess away. That is what keeps a wrong entry in that table from
   * quietly pointing an import at the wrong object — the worst outcome this
   * feature could have.
   *
   * A failure here is silent on purpose. Nobody asked for this lookup, so an
   * object UI API doesn't support has to leave the page exactly as it found it
   * rather than posting an error about a request the user never made.
   */
  const autoFillObject = useCallback(
    async (found: DetectedObject) => {
      setAutoFilling(true);
      try {
        const loaded = await getObjectFields(found.objectApiName);
        if (loaded.keyPrefix && loaded.keyPrefix !== found.keyPrefix) return;
        applyLoadedObject(loaded);
        // An Id column means these records already exist. Filling the object in
        // and leaving "Create new" selected would be half a fix — the mapper
        // would immediately refuse the Id column it just recognised.
        const switchedOperation = operation === "insert";
        if (switchedOperation) switchOperation("update");
        setAutoFilled({
          ...found,
          objectLabel: loaded.label,
          switchedOperation,
        });
      } catch {
        // Deliberately silent — see above.
      } finally {
        setAutoFilling(false);
      }
    },
    [applyLoadedObject, operation, switchOperation],
  );

  /**
   * One attempt per distinct guess.
   *
   * A ref rather than state: it survives StrictMode's simulated remount, so the
   * auto-fill can't cost two `object-info` calls in development, and it never
   * re-fires for data the page has already tried.
   */
  const autoFillTried = useRef<string | null>(null);
  useEffect(() => {
    if (!detected || objectApiName) return;
    const attempt = `${detected.objectApiName}:${detected.keyPrefix}`;
    if (autoFillTried.current === attempt) return;
    autoFillTried.current = attempt;
    void autoFillObject(detected);
  }, [detected, objectApiName, autoFillObject]);

  /**
   * Replace every row in one pass, recording which cells actually moved.
   *
   * Rows that come back unchanged must keep their identity — the grid's rows
   * are memoized on it, and so is the edit diff, which skips an untouched row
   * with a single reference comparison instead of one per cell.
   */
  const rewriteRows = useCallback(
    (rewrite: (row: string[]) => string[]) => {
      const before = table.rows;
      const after = before.map(rewrite);
      setTable((current) => ({ ...current, rows: after }));
      setEdits((current) => recordRewrite(current, before, after));
    },
    [table.rows, setTable, setEdits],
  );

  const autoMap = useCallback(() => {
    setMapping(autoMapColumns(table.headers, meta, operation));
  }, [table.headers, meta, operation, setMapping]);

  const setColumn = useCallback(
    (column: number, field: string | null) => {
      // A hand-typed API name arrives spelled however the user typed it.
      // Matching it against the object's own casing is what lets the validator
      // answer "Age is read-only" rather than "age isn't a field here" — the
      // unhelpful half of the answer. A name picked from the list is already
      // canonical, so this is a no-op on that path.
      const resolved = field ? canonicalFieldName(field, meta) : null;
      setMapping((current) => {
        const next = table.headers.map((_, i) => current[i] ?? null);
        next[column] = resolved;
        return next;
      });
    },
    [table.headers, meta, setMapping],
  );

  const setCell = useCallback(
    (row: number, column: number, value: string) => {
      const previous = table.rows[row]?.[column] ?? "";
      setTable((current) => ({
        ...current,
        rows: current.rows.map((r, i) =>
          i === row ? r.map((c, j) => (j === column ? value : c)) : r,
        ),
      }));
      setEdits((current) => recordEdit(current, row, column, previous, value));
    },
    [table.rows, setTable, setEdits],
  );

  /**
   * Put one row back the way it was pasted.
   *
   * Both halves — the restored cells and the dropped tracking — come from one
   * pure call, so a row can't end up visually reverted while still counting as
   * edited, or vice versa.
   */
  const revertRowEdits = useCallback(
    (row: number) => {
      const current = table.rows[row];
      if (!current) return;
      const reverted = revertRow(edits, current, row);
      if (!reverted) return;
      setTable((table) => ({
        ...table,
        rows: table.rows.map((r, i) => (i === row ? reverted.row : r)),
      }));
      setEdits(reverted.edits);
    },
    [edits, table.rows, setTable, setEdits],
  );

  const deleteRow = useCallback(
    (row: number) => {
      setTable((current) => ({
        ...current,
        rows: current.rows.filter((_, i) => i !== row),
      }));
      // Every row below this one is about to be renumbered, and the edit keys
      // hold row indexes — without this, deleting row 1 hands row 2's edits to
      // row 3 and the narrowed run writes the wrong cells.
      setEdits((current) => shiftEditsForDeletedRow(current, row));
    },
    [setTable, setEdits],
  );

  /**
   * Rewrite every convertible cell in the date-mapped columns in one pass.
   *
   * Cells that are already ISO, blank, or not a numeric date are left exactly
   * as they are — `toIsoDate` returns null for all three — so running this
   * twice, or on a half-corrected column, can't damage anything.
   */
  const fixDates = useCallback(
    (order: DateOrder) => {
      const dateColumns = spec.mapping
        .map((field, column) => ({
          column,
          meta: field ? meta[field] : undefined,
        }))
        .filter((c) => c.meta && isDateType(c.meta.dataType));
      if (dateColumns.length === 0) return;

      rewriteRows((row) => {
        let changed = false;
        const next = [...row];
        for (const { column, meta: fieldMeta } of dateColumns) {
          const iso = toIsoDate(
            next[column] ?? "",
            order,
            fieldMeta!.dataType as "Date" | "DateTime",
          );
          if (iso !== null) {
            next[column] = iso;
            changed = true;
          }
        }
        // Rows with nothing to fix keep their identity, so the memoized grid
        // rows that didn't change don't re-render.
        return changed ? next : row;
      });
    },
    [spec.mapping, meta, rewriteRows],
  );

  /**
   * Rewrite every numeric column in one pass.
   *
   * Same shape and same safety as `fixDates`, in both modes: the reader returns
   * null for blank cells, for values it can't read, and for values that already
   * need no change, so running either twice — or over a half-corrected column —
   * changes nothing the second time.
   *
   * The two modes stay two deliberate presses. `format` cleans values that are
   * already numbers; `salvage` pulls a number out of a cell that isn't one, and
   * folding that into the same button would let it quietly rewrite a column that
   * is merely mapped to the wrong field — the all-red grid is the signal that
   * something is wrong, and one button shouldn't be able to erase it by
   * accident.
   */
  const fixNumbers = useCallback(
    (decimal: DecimalSeparator, mode: NumberFixMode) => {
      const numericColumns = spec.mapping
        .map((field, column) => ({
          column,
          meta: field ? meta[field] : undefined,
        }))
        .filter((c) => c.meta && isNumericType(c.meta.dataType));
      if (numericColumns.length === 0) return;

      const read = mode === "salvage" ? toSalvagedNumber : toPlainNumber;

      rewriteRows((row) => {
        let changed = false;
        const next = [...row];
        for (const { column } of numericColumns) {
          const plain = read(next[column] ?? "", decimal);
          if (plain !== null) {
            next[column] = plain;
            changed = true;
          }
        }
        // Rows with nothing to fix keep their identity, so the memoized grid
        // rows that didn't change don't re-render.
        return changed ? next : row;
      });
    },
    [spec.mapping, meta, rewriteRows],
  );

  /**
   * True when the data plainly describes existing records but the page is set
   * to create new ones — a header called Id, or a column whose values are
   * record Ids.
   */
  const looksLikeUpdate = useMemo(() => {
    if (operation !== "insert" || table.rows.length === 0) return false;
    const headerSaysId = table.headers.some(
      (h) => h.trim().toLowerCase() === "id",
    );
    const valuesAreIds = table.headers.some((_, column) => {
      const sample = table.rows.find((r) => (r[column] ?? "").trim() !== "");
      return sample ? isSalesforceId((sample[column] ?? "").trim()) : false;
    });
    return headerSaysId || valuesAreIds;
  }, [operation, table]);

  /**
   * The scope actually in force.
   *
   * A narrowing that has nothing to narrow to would leave the Run button
   * offering to write zero records with no visible reason, so with no edits on
   * the table the page is back to "everything" whatever was last selected.
   */
  const activeScope: ImportScope =
    edits.size === 0 ? "all" : effectiveScope(scope, operation);

  const plan = useMemo(
    () => planImport(spec, meta, report, edits, activeScope),
    [spec, meta, report, edits, activeScope],
  );

  /** True when this run would send at least one blank cell as a clear. */
  const clearsFields = useMemo(() => {
    if (operation !== "update") return false;
    return plan.rowIndexes.some((rowIndex) => {
      const allowed = plan.columnsByRow?.get(rowIndex);
      return spec.mapping.some(
        (field, column) =>
          field &&
          field !== "Id" &&
          (!allowed || allowed.has(column)) &&
          (spec.rows[rowIndex]?.[column] ?? "").trim() === "",
      );
    });
  }, [operation, plan, spec]);

  const tooManyRows = table.rows.length > MAX_IMPORT_ROWS;

  const canRun =
    Boolean(objectApiName) &&
    report.mappingErrors.length === 0 &&
    plan.rowIndexes.length > 0 &&
    !tooManyRows &&
    status !== "running";

  /** Rows the scope left out, so narrowing never looks like data going missing. */
  const heldBack = report.readyRows.length - plan.rowIndexes.length;
  const writtenCells = planCellCount(spec, meta, plan);

  const startOver = () => {
    reset();
    setSource("");
    setMapping([]);
    setMappedFor(null);
    setEdits(NO_EDITS);
    setScope("all");
  };

  return (
    <PageShell>
      <PageHeader
        title="Data Import"
        description="Paste rows from a spreadsheet or drop a CSV, map the columns, and fix anything flagged before it's written."
        actions={<SetupLinks objectApiName={objectApiName || undefined} />}
      />

      {status === "success" && result ? (
        <ImportResults
          spec={spec}
          result={result}
          undone={undone}
          onUndo={undo}
          onStartOver={startOver}
        />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <ObjectPicker
              value={objectApiName}
              loading={objectLoading || autoFilling}
              resolvedLabel={objectApiName ? objectLabel : null}
              error={objectError}
              onSubmit={loadObject}
            />

            <div>
              <span className={sectionLabelSpaced}>Operation</span>
              <SegmentedControl
                label="Operation"
                value={operation}
                options={[
                  { value: "insert", label: "Create new" },
                  { value: "update", label: "Update existing" },
                ]}
                onChange={switchOperation}
              />
            </div>
          </div>

          {/*
            Said out loud rather than left as a filled-in box, because the page
            changed two things the user didn't ask it to. Naming the column the
            guess came from is what makes it checkable at a glance — and picking
            a different object in the box above clears this.
          */}
          {autoFilled && (
            <Banner tone="info" size="sm">
              <span className="flex flex-wrap items-center gap-1">
                <Wand2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  The <span className="font-mono">{autoFilled.header}</span>{" "}
                  column holds{" "}
                  <span className="font-mono">{autoFilled.keyPrefix}…</span>{" "}
                  Ids, so the object was set to{" "}
                  <strong>{autoFilled.objectLabel}</strong>
                  {autoFilled.switchedOperation
                    ? " and the operation to Update existing."
                    : "."}{" "}
                  Change either above if that isn&apos;t right.
                </span>
              </span>
            </Banner>
          )}

          {wrongObject && (
            <Banner tone="warning" size="sm">
              <span className="flex flex-wrap items-center gap-2">
                <span>
                  The <span className="font-mono">{wrongObject.header}</span>{" "}
                  column holds{" "}
                  <span className="font-mono">{wrongObject.keyPrefix}…</span>{" "}
                  Ids, which belong to{" "}
                  <strong>{wrongObject.objectApiName}</strong> — not{" "}
                  {objectLabel || objectApiName}. Salesforce will reject every
                  row unless one of the two is wrong on purpose.
                </span>
                <TextButton
                  tone="inherit"
                  onClick={() => loadObject(wrongObject.objectApiName)}
                >
                  Switch to {wrongObject.objectApiName}
                </TextButton>
              </span>
            </Banner>
          )}

          <SourceInput
            value={source}
            onChange={setSource}
            rowCount={table.rows.length}
            delimiterLabel={
              table.rows.length > 0
                ? (DELIMITER_LABELS[table.delimiter] ?? null)
                : null
            }
            collapsed={textCollapsed}
            onToggleCollapsed={() => setTextCollapsed((c) => !c)}
          />

          {table.ragged > 0 && (
            <p className="text-xs text-warning">
              {table.ragged.toLocaleString()}{" "}
              {table.ragged === 1 ? "row doesn't" : "rows don't"} have the same
              number of columns as the header. Missing cells are treated as
              blank and extra cells are ignored.
            </p>
          )}

          {tooManyRows && (
            <Banner tone="destructive">
              {table.rows.length.toLocaleString()} rows is more than this page
              imports at once (limit {MAX_IMPORT_ROWS.toLocaleString()}). Split
              the file and run it in parts.
            </Banner>
          )}

          {objectApiName && table.headers.length > 0 && (
            <>
              <ColumnMapper
                headers={table.headers}
                mapping={spec.mapping}
                fields={meta}
                operation={operation}
                objectLabel={objectLabel || objectApiName}
                sampleRow={table.rows[0]}
                looksLikeUpdate={looksLikeUpdate}
                onChange={setColumn}
                onSwitchToUpdate={() => switchOperation("update")}
              />
              <TextButton onClick={autoMap}>Re-guess the mapping</TextButton>
            </>
          )}

          {report.mappingErrors.length > 0 && (
            // `hideIcon`: each row carries its own icon, so the banner's single
            // leading one would sit orphaned above the list.
            <Banner tone="destructive" hideIcon>
              <ul className="space-y-1">
                {report.mappingErrors.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            </Banner>
          )}

          {objectApiName && (
            <DataGrid
              spec={spec}
              report={report}
              fields={meta}
              picklists={picklists ?? NO_PICKLISTS}
              edits={edits}
              onCellChange={setCell}
              onDeleteRow={deleteRow}
              onRevertRow={revertRowEdits}
              onFixDates={fixDates}
              onFixNumbers={fixNumbers}
            />
          )}

          {status === "error" && error && (
            <Banner tone="destructive">{error}</Banner>
          )}

          <StickyActionBar>
            <Button
              type="button"
              variant="default"
              size="lg"
              onClick={() => setConfirmOpen(true)}
              disabled={!canRun}
            >
              {status === "running" ? (
                <Spinner />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {operation === "insert" ? "Create" : "Update"}{" "}
              {plan.rowIndexes.length.toLocaleString()}{" "}
              {plan.rowIndexes.length === 1 ? "record" : "records"}
            </Button>

            {/*
              Only once there is something to narrow to. Before the first edit
              every option means the same thing, and two of them would mean
              "nothing".
            */}
            {edits.size > 0 && (
              <SegmentedControl
                label="What to write"
                size="sm"
                value={activeScope}
                onChange={setScope}
                options={[
                  {
                    value: "all",
                    label: "All rows",
                    title: "Write every ready row, as pasted.",
                  },
                  {
                    value: "editedRows",
                    label: "Edited rows",
                    title:
                      "Write only rows containing a cell you changed — all of their mapped columns.",
                  },
                  ...(operation === "update"
                    ? ([
                        {
                          value: "editedCells" as const,
                          label: "Edited cells",
                          title:
                            "Write only the cells you changed, and nothing else on those records.",
                        },
                      ] as const)
                    : []),
                ]}
              />
            )}

            {activeScope !== "all" && (
              <span className="text-muted-foreground text-xs">
                {writtenCells.toLocaleString()}{" "}
                {writtenCells === 1 ? "cell" : "cells"}
                {heldBack > 0 &&
                  ` · ${heldBack.toLocaleString()} ready ${heldBack === 1 ? "row" : "rows"} untouched`}
              </span>
            )}

            {status === "running" && progress && progress.total > 0 && (
              <span className="text-muted-foreground text-xs">
                Batch {progress.done} of {progress.total}
              </span>
            )}
          </StickyActionBar>
        </div>
      )}

      <ImportConfirmDialog
        open={confirmOpen}
        operation={operation}
        count={plan.rowIndexes.length}
        blocked={report.blockedRows.size}
        objectLabel={objectLabel || objectApiName}
        clearsFields={clearsFields}
        narrowedToEditedCells={activeScope === "editedCells"}
        heldBack={heldBack}
        running={status === "running"}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          run(spec, meta, plan);
        }}
      />
    </PageShell>
  );
}
