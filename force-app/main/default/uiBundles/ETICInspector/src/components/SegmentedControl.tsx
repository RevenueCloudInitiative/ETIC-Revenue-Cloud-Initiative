import type { ReactNode } from "react";

/**
 * The app's one pick-one-of-a-few control.
 *
 * There were two before this existed — Data Export's Rows/Summarize switch and
 * Data Import's Create/Update switch — and they had already drifted in four
 * ways despite being the same control: `rounded-lg` against `rounded-md`,
 * `text-xs` against `text-sm`, `transition-colors` on one only, and one of them
 * declaring `role="tablist"` while the other declared nothing. Data Import's
 * import-scope switch would have been the third copy.
 *
 * The ARIA is a deliberate correction rather than a merge of the two. A
 * `tablist` promises tabs with panels, and that page has no `tabpanel` for a
 * screen reader to be sent to; a group of toggle buttons carrying `aria-pressed`
 * describes what these actually are, needs no roving focus to be correct, and
 * leaves every option reachable by Tab.
 *
 * Geometry is baked into each size rather than passed in, the same rule as
 * `inputStyles.ts`: without `tailwind-merge` a caller appending `px-4` does not
 * reliably beat a variant's `px-3`, so add a size here instead of overriding one
 * from outside.
 */

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  /** Native tooltip — for an option whose consequences need a sentence. */
  title?: string;
  disabled?: boolean;
}

const SIZES = {
  sm: {
    wrap: "rounded-lg p-0.5",
    button: "rounded-md px-3 py-1.5 text-xs",
  },
  md: {
    wrap: "rounded-md p-0.5",
    button: "rounded px-3 py-1.5 text-sm",
  },
} as const;

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
  className = "",
}: {
  /** Accessible name for the group, e.g. "Operation". */
  label: string;
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const chrome = SIZES[size];

  return (
    <div
      role="group"
      aria-label={label}
      className={`border-border bg-muted/40 inline-flex shrink-0 border ${chrome.wrap} ${className}`.trim()}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          title={option.title}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={`cursor-pointer font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${chrome.button} ${
            value === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
