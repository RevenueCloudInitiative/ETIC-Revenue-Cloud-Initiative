import { Check, Copy } from "lucide-react";
import { useCopyFeedback } from "../../../hooks/useCopyFeedback";

interface IdCopyProps {
  value: string;
  label?: string;
}

/** Inline copy button for a record Id, with a brief confirmation tick. */
export function IdCopy({ value, label = "Copy Id" }: IdCopyProps) {
  const { copied, copy } = useCopyFeedback();

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => copy(value)}
      className="text-muted-foreground hover:text-foreground cursor-pointer"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
