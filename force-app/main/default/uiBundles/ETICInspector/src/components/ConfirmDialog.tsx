import { AlertTriangle } from "lucide-react";
import { useRef, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Spinner } from "./ui/spinner";
import { Button } from "./ui/button";

/**
 * `destructive` — data is removed or overwritten irreversibly (red).
 * `caution` — data is written and the outcome is worth reading first (amber).
 */
export type ConfirmTone = "destructive" | "caution";

interface ConfirmDialogProps {
  open: boolean;
  tone: ConfirmTone;
  title: ReactNode;
  description: ReactNode;
  /**
   * Caveats listed in the muted box under the description. Falsy entries are
   * dropped, so a call site can build the list conditionally without also
   * having to decide whether the box should exist at all.
   */
  notes?: ReactNode[];
  confirmLabel: string;
  /** Label while `busy` — "Deleting…", "Importing…". */
  busyLabel: string;
  /** True while the confirmed action is in flight. */
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const ICON_TONE: Record<ConfirmTone, string> = {
  destructive: "text-destructive bg-destructive/10",
  caution: "bg-warning/10 text-warning",
};

const CONFIRM_TONE: Record<ConfirmTone, string> = {
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  caution: "bg-primary text-primary-foreground hover:bg-primary/90",
};

/**
 * The app's only modal: a last stop before something is written to the org.
 *
 * There were two of these — one for bulk delete, one for import — each with its
 * own hand-rolled overlay, Escape listener and focus handling, and they had
 * already drifted apart. Nothing about "am I sure?" differs between them except
 * the words and the colour, so the mechanics live here once, on the `ui/dialog`
 * primitive that was sitting in the repo unused.
 *
 * Radix supplies what the hand-rolled versions only approximated: a real focus
 * trap, focus restored to whatever opened the dialog, `aria-modal` wiring from
 * the title and description, and the rest of the page hidden from assistive
 * tech. Three behaviours are ours, and are deliberate:
 *
 * - **Cancel takes focus, not Confirm.** A stray Enter should hit the safe
 *   option, so the default auto-focus is overridden.
 * - **Nothing dismisses the dialog while `busy`.** Escape, the backdrop and
 *   Cancel are all routed through one guard, because a write is in flight and
 *   closing would strand the user with no view of the result.
 * - **No close X.** Cancel is the way out; a second one only invites a click
 *   that means something less clear.
 */
export function ConfirmDialog({
  open,
  tone,
  title,
  description,
  notes,
  confirmLabel,
  busyLabel,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const items = (notes ?? []).filter(Boolean);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/50"
        className="bg-card border-border gap-0 border p-5 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader className="mb-3 flex-row items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${ICON_TONE[tone]}`}
          >
            <AlertTriangle className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-foreground text-base font-bold">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm">
              {description}
            </DialogDescription>
          </div>
        </DialogHeader>

        {items.length > 0 && (
          <ul className="text-muted-foreground border-border bg-muted/40 mb-4 space-y-1 rounded-md border px-3 py-2 text-xs">
            {items.map((note, index) => (
              // Notes are a fixed, ordered list built by the call site from its
              // own state; there is no identity to key by and no reordering.
              <li key={index}>{note}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${CONFIRM_TONE[tone]}`}
          >
            {busy && <Spinner size="sm" />}
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
