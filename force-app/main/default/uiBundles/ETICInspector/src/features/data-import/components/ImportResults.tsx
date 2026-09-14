import {
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  Undo2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import type { ImportOutcome } from "../../../api/dataImport";
import { Spinner } from "../../../components/ui/spinner";
import { Button } from "../../../components/ui/button";
import {
  TableScroller,
  stickyHeaderCell,
} from "../../../components/TableScroller";
import { downloadFile, toCsv } from "../../../lib/exportFormats";
import { getLightningBaseUrl } from "../../../lib/salesforce";
import type { ImportSpec } from "../import/types";
import {
  sectionLabel,
  sectionLabelSpaced,
} from "../../../components/sectionLabel";

interface ImportResultsProps {
  spec: ImportSpec;
  result: ImportOutcome;
  undone: boolean;
  onUndo: () => Promise<unknown>;
  onStartOver: () => void;
}

/**
 * Build the "failed rows" file.
 *
 * The user's original columns, verbatim, plus the reason Salesforce gave. That
 * shape is deliberate: it is re-importable. Fix the values in the offending
 * column, delete the error column or leave it (it maps to nothing), and paste
 * it straight back in — which is the actual recovery path for a partly failed
 * import of a few hundred rows.
 */
function failedRowsCsv(spec: ImportSpec, result: ImportOutcome): string {
  const columns = [...spec.headers, "Import error"];
  const rows = result.failed.map((failure) => {
    const cells = spec.rows[failure.rowIndex] ?? [];
    const row: Record<string, string> = {};
    spec.headers.forEach((header, column) => {
      row[header] = cells[column] ?? "";
    });
    row["Import error"] = failure.message ?? "";
    return row;
  });
  return toCsv({ columns, rows });
}

/**
 * A notch larger than the grids elsewhere in the app, on purpose. Those are
 * dense editing surfaces you scan; this is a report you read once and check
 * carefully, and the values in it are the whole point of the screen.
 */
const CHANGE_HEAD = `${stickyHeaderCell} text-muted-foreground px-2 py-1.5 text-left text-xs font-medium`;
const CHANGE_CELL =
  "border-border/60 border-b px-2 py-1.5 align-middle font-mono text-[13px]";

/**
 * What the update changed, field by field.
 *
 * One row per *change*, not per record: a record that moved two fields gets two
 * lines. That reads better than a matrix once more than a couple of fields are
 * mapped — most cells in that matrix would be empty, and the eye has to hunt
 * for the ones that aren't.
 *
 * Records that came back identical are counted rather than listed. They are the
 * common result of re-running an import, and listing forty unchanged rows would
 * bury the three that moved.
 */
function ChangeTable({ result }: { result: ImportOutcome }) {
  const report = result.changes;

  if (report === null) {
    return (
      <p className="text-muted-foreground text-xs">
        The before/after values couldn&apos;t be read, so this run has no change
        report. The records themselves updated normally.
      </p>
    );
  }

  const total = report.changed.length + report.unchanged + report.unread;
  if (total === 0) return null;

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={sectionLabel}>What changed</h2>
        <span className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
          <span>
            {report.changed.length.toLocaleString()}{" "}
            {report.changed.length === 1 ? "record" : "records"} changed
          </span>
          {report.unchanged > 0 && (
            <span>
              {report.unchanged.toLocaleString()} already had these values
            </span>
          )}
          {report.unread > 0 && (
            <span className="text-warning">
              {report.unread.toLocaleString()} couldn&apos;t be compared
            </span>
          )}
        </span>
      </div>

      {report.changed.length === 0 ? (
        <p className="text-muted-foreground border-border bg-card rounded-lg border px-3 py-2 text-xs">
          Every record already held the values in the file, so nothing actually
          changed.
        </p>
      ) : (
        <TableScroller>
          <table className="w-full border-collapse">
            {/*
              Without this the four narrow columns each take a share of the
              surplus a `w-full` table has to distribute, so `Row` ends up
              several times wider than the digit in it — and, being
              right-aligned, pushes that digit to the far side of the gap. `1px`
              is the standard way to say "as narrow as your content"; the two
              value columns then absorb everything left over, which is where the
              width is actually wanted.
            */}
            <colgroup>
              <col className="w-px" />
              <col className="w-px" />
              <col className="w-px" />
              <col className="w-1/2" />
              <col className="w-px" />
              <col className="w-1/2" />
            </colgroup>
            <thead>
              <tr>
                <th className={`${CHANGE_HEAD} text-right`}>Row</th>
                <th className={CHANGE_HEAD}>Record</th>
                <th className={CHANGE_HEAD}>Field</th>
                <th className={CHANGE_HEAD}>Before</th>
                <th className={`${stickyHeaderCell} w-6`} />
                <th className={CHANGE_HEAD}>After</th>
              </tr>
            </thead>
            <tbody>
              {report.changed.flatMap((record) =>
                record.changes.map((change, index) => (
                  <tr key={`${record.id}-${change.field}`}>
                    <td
                      className={`${CHANGE_CELL} text-muted-foreground whitespace-nowrap pr-3 text-right`}
                    >
                      {/* Only on the first line of a record, so the eye groups them. */}
                      {index === 0 ? record.rowIndex + 1 : ""}
                    </td>
                    <td className={`${CHANGE_CELL} whitespace-nowrap pr-4`}>
                      {index === 0 && (
                        <a
                          href={`${getLightningBaseUrl()}/lightning/r/${result.objectApiName}/${record.id}/view`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary inline-flex items-center gap-1 hover:underline"
                        >
                          {record.id}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </td>
                    <td
                      className={`${CHANGE_CELL} text-foreground whitespace-nowrap pr-4`}
                    >
                      {change.field}
                    </td>
                    <td
                      className={`${CHANGE_CELL} text-muted-foreground line-through`}
                    >
                      {change.before === "" ? "(empty)" : change.before}
                    </td>
                    <td className="text-muted-foreground border-border/60 border-b px-1 py-1 align-middle">
                      <ArrowRight className="h-3.5 w-3.5" />
                    </td>
                    <td className={`${CHANGE_CELL} font-semibold text-success`}>
                      {change.after === "" ? "(empty)" : change.after}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </TableScroller>
      )}
    </div>
  );
}

export function ImportResults({
  spec,
  result,
  undone,
  onUndo,
  onStartOver,
}: ImportResultsProps) {
  const [undoing, setUndoing] = useState(false);

  const canUndo =
    result.operation === "insert" && result.createdIds.length > 0 && !undone;

  const runUndo = async () => {
    setUndoing(true);
    try {
      await onUndo();
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="border-border bg-card rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
              <CheckCircle2 className="h-4 w-4" />
              {result.succeeded.length.toLocaleString()}{" "}
              {result.operation === "insert" ? "created" : "updated"}
            </span>
            {result.failed.length > 0 && (
              <span className="text-destructive inline-flex items-center gap-1.5 text-sm font-medium">
                <XCircle className="h-4 w-4" />
                {result.failed.length.toLocaleString()} failed
              </span>
            )}
            <span className="text-muted-foreground text-xs">
              {result.calls} API {result.calls === 1 ? "call" : "calls"}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {result.failed.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadFile(
                    failedRowsCsv(spec, result),
                    `${spec.objectApiName}-failed-rows`,
                    "csv",
                  )
                }
              >
                <Download className="h-3.5 w-3.5" />
                Download failed rows
              </Button>
            )}

            {canUndo && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={runUndo}
                disabled={undoing}
              >
                {undoing ? (
                  <Spinner size="sm" />
                ) : (
                  <Undo2 className="h-3.5 w-3.5" />
                )}
                {undoing ? "Undoing…" : "Undo"}
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onStartOver}
            >
              Start over
            </Button>
          </div>
        </div>

        {undone && (
          <p className="text-muted-foreground mt-3 text-xs">
            The {result.createdIds.length.toLocaleString()} created{" "}
            {result.createdIds.length === 1 ? "record was" : "records were"}{" "}
            deleted.
          </p>
        )}

        {result.operation === "update" && (
          <p className="text-muted-foreground mt-3 text-xs">
            Updates can&apos;t be undone from here. The previous values are
            listed below so they can be put back by hand, or by pasting the
            &ldquo;before&rdquo; column into a new import.
          </p>
        )}
      </div>

      {result.operation === "update" && <ChangeTable result={result} />}

      {result.failed.length > 0 && (
        <div>
          <h2 className={sectionLabelSpaced}>Failures</h2>
          <div className="border-border bg-card divide-border/60 divide-y overflow-hidden rounded-lg border">
            {result.failed.map((failure) => (
              <div key={failure.rowIndex} className="px-3 py-2">
                <span className="text-muted-foreground font-mono text-[11px]">
                  Row {failure.rowIndex + 1}
                </span>
                <p className="text-destructive text-xs">{failure.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.succeeded.length > 0 && !undone && (
        <details className="border-border bg-card rounded-lg border">
          <summary className="text-muted-foreground cursor-pointer px-3 py-2 text-xs font-medium">
            {result.succeeded.length.toLocaleString()} successful{" "}
            {result.succeeded.length === 1 ? "record" : "records"}
          </summary>
          <div className="divide-border/60 max-h-72 divide-y overflow-y-auto border-t">
            {result.succeeded.map((row) => (
              <div
                key={row.rowIndex}
                className="flex items-center justify-between gap-3 px-3 py-1.5"
              >
                <span className="text-muted-foreground font-mono text-[11px]">
                  Row {row.rowIndex + 1}
                </span>
                {row.id && (
                  <a
                    href={`${getLightningBaseUrl()}/lightning/r/${result.objectApiName}/${row.id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary inline-flex items-center gap-1 font-mono text-[11px] hover:underline"
                  >
                    {row.id}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
