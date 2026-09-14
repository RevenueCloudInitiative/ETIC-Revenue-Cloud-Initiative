import { ConfirmDialog } from "../../../components/ConfirmDialog";
import type { ImportOperation } from "../import/types";

interface ImportConfirmDialogProps {
  open: boolean;
  operation: ImportOperation;
  count: number;
  blocked: number;
  objectLabel: string;
  /** True when at least one mapped column will send blanks on an update. */
  clearsFields: boolean;
  /** True when the run writes only the cells the user edited. */
  narrowedToEditedCells: boolean;
  /** Ready rows the chosen scope is leaving out. */
  heldBack: number;
  running: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Last stop before anything is written.
 *
 * Shares `ConfirmDialog` with the bulk-delete confirmation, and for the same
 * reason both exist: this is the point where a reversible mistake becomes a
 * real one in the org's data.
 *
 * The blank-cells line is the part that earns its place. On update an empty
 * cell is sent as an explicit `null`, which *clears* the field — the only way
 * to express "empty this out", and a genuinely surprising outcome for someone
 * who left a column blank because they had nothing to say about it. It is
 * stated here rather than only in a code comment because this is the last
 * moment it can change the user's mind.
 */
export function ImportConfirmDialog({
  open,
  operation,
  count,
  blocked,
  objectLabel,
  clearsFields,
  narrowedToEditedCells,
  heldBack,
  running,
  onCancel,
  onConfirm,
}: ImportConfirmDialogProps) {
  const verb = operation === "insert" ? "Create" : "Update";

  return (
    <ConfirmDialog
      open={open}
      tone="caution"
      title={
        <>
          {verb} {count.toLocaleString()} {objectLabel}
          {count === 1 ? " record" : " records"}?
        </>
      }
      description={
        operation === "insert"
          ? "New records are created in the org. You can undo this straight afterwards, while the result is on screen."
          : "Existing records are changed in the org. This cannot be undone from this app."
      }
      notes={[
        blocked > 0 &&
          `${blocked.toLocaleString()} ${blocked === 1 ? "row is" : "rows are"} blocked and will be skipped.`,
        // Narrowing is a choice made in a control the dialog covers up, so the
        // count above is smaller than the grid's for a reason the user has to
        // be able to see from here.
        heldBack > 0 &&
          `${heldBack.toLocaleString()} ready ${heldBack === 1 ? "row has" : "rows have"} no edits and will be left alone.`,
        narrowedToEditedCells &&
          "Only the cells you edited are written; every other field on those records keeps its current value.",
        operation === "update" && clearsFields && (
          <span className="text-warning">
            Blank cells in mapped columns will <strong>clear</strong> those
            fields on the record.
          </span>
        ),
        operation === "insert" &&
          "Blank cells are left out, so Salesforce's defaults apply.",
      ]}
      confirmLabel={verb}
      busyLabel="Importing…"
      busy={running}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
