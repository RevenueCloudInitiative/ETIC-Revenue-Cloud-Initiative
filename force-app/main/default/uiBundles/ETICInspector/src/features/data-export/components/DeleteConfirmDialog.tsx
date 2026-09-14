import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { DELETE_CHUNK_SIZE } from "../query/toGraphQL";

interface DeleteConfirmDialogProps {
  open: boolean;
  count: number;
  objectLabel: string;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation for a bulk delete.
 *
 * States the record count, that deletion is permanent, and the number of API
 * calls it will spend — the last because deletes are chunked below Salesforce's
 * 75-operation mutation ceiling, so a large selection costs several calls
 * against the org's shared daily limit and the user should see that before
 * committing rather than discover it in the usage meter afterwards.
 *
 * The modal mechanics live in `ConfirmDialog`; what's left here is the wording,
 * which is the part worth reading.
 */
export function DeleteConfirmDialog({
  open,
  count,
  objectLabel,
  deleting,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const calls = Math.ceil(count / DELETE_CHUNK_SIZE);

  return (
    <ConfirmDialog
      open={open}
      tone="destructive"
      title={
        <>
          Delete {count.toLocaleString()} {objectLabel}
          {count === 1 ? " record" : " records"}?
        </>
      }
      description="This sends the records to the org's Recycle Bin and cannot be undone from this app."
      notes={[
        `Costs ${calls} API ${calls === 1 ? "call" : "calls"} against the org's daily limit.`,
      ]}
      confirmLabel="Delete"
      busyLabel="Deleting…"
      busy={deleting}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
