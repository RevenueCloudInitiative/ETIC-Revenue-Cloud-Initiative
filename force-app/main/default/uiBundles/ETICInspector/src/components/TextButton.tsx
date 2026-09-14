import type { MouseEvent, ReactNode } from "react";

/**
 * A button that reads as a link — a secondary action with no chrome around it.
 *
 * These are not `ui/button.tsx`. That component is `inline-flex` with a height,
 * a radius and padding, which is right for a control that occupies its own
 * space and wrong for the two jobs here: a word inside a running sentence
 * ("…record Ids. **Switch to Update existing**"), and a bare action tucked
 * against a section label ("Clear", "Select all (69)"). Its `link` variant
 * still carries the box.
 *
 * There were eight hand-rolled copies across six files in three colour
 * treatments, and they had drifted the way unnamed shared things do:
 * `text-[11px]` in three places and `text-xs` in a fourth doing the same job,
 * `hover:underline` in some and a permanent `underline` in others, and the
 * `type="button"` that stops a button inside a form submitting it repeated at
 * every site.
 *
 * The three tones are a real distinction, not a palette:
 *
 * - **`quiet`** (default) — a secondary action beside a section label. Grey
 *   until hovered, so it doesn't compete with the panel it sits on.
 * - **`accent`** — an offer the user is meant to notice, in a neutral bar.
 * - **`inherit`** — inside a `Banner`, where the surrounding tone already
 *   carries the meaning. Taking `text-primary` here would put a blue link in an
 *   amber warning and break the one signal the banner exists to send.
 */
type TextButtonTone = "quiet" | "accent" | "inherit";

const TONES: Record<TextButtonTone, string> = {
  quiet:
    "text-muted-foreground hover:text-foreground text-[11px] hover:underline",
  accent: "text-primary underline underline-offset-2",
  inherit: "underline underline-offset-2",
};

export function TextButton({
  tone = "quiet",
  onClick,
  onMouseDown,
  className = "",
  children,
}: {
  tone?: TextButtonTone;
  onClick: () => void;
  /**
   * For a link inside a dropdown that closes on blur. Mousedown fires first
   * and takes focus off the input, closing the list before the click can
   * land — the same reason `ComboOption` suppresses it.
   */
  onMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Layout only — the tone owns colour, size and decoration. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onMouseDown}
      className={`cursor-pointer font-medium ${TONES[tone]} ${className}`.trim()}
    >
      {children}
    </button>
  );
}
