import { Check, Copy, Download, Trash2 } from "lucide-react";
import { useCopyFeedback } from "../../../hooks/useCopyFeedback";
import {
  downloadFile,
  serialize,
  type ExportFormat,
  type ExportTable,
} from "../../../lib/exportFormats";
import { Button } from "../../../components/ui/button";

interface ExportBarProps {
  table: ExportTable;
  baseName: string;
  /**
   * Delete is omitted entirely when this is absent. Summarize results are
   * groups rather than records — there is no Id behind a row to delete — so the
   * button is not merely disabled there, it doesn't apply.
   */
  selectedCount?: number;
  onDeleteClick?: () => void;
}

/**
 * Export controls. Every action here is pure client-side string work on results
 * already in memory, so none of it costs an API call no matter how often it is
 * used.
 */
export function ExportBar({
  table,
  baseName,
  selectedCount,
  onDeleteClick,
}: ExportBarProps) {
  // Three copy buttons share this row, so the flag carries *which* format was
  // copied rather than a bare boolean.
  const { copied, copy } = useCopyFeedback<ExportFormat>();

  const empty = table.rows.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(["csv", "tsv", "json"] as ExportFormat[]).map((format) => (
        <Button
          key={format}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => copy(serialize(table, format), format)}
          disabled={empty}
          title={
            format === "tsv"
              ? "Tab-separated — paste straight into Excel or Sheets"
              : `Copy all loaded rows as ${format.toUpperCase()}`
          }
        >
          {copied === format ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied === format ? "Copied" : `Copy ${format.toUpperCase()}`}
        </Button>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => downloadFile(serialize(table, "csv"), baseName, "csv")}
        disabled={empty}
      >
        <Download className="h-3.5 w-3.5" />
        Download CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => downloadFile(serialize(table, "json"), baseName, "json")}
        disabled={empty}
      >
        <Download className="h-3.5 w-3.5" />
        Download JSON
      </Button>

      {onDeleteClick && (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onDeleteClick}
          disabled={!selectedCount}
          className="ml-auto"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete {selectedCount ? `${selectedCount} selected` : "selected"}
        </Button>
      )}
    </div>
  );
}
