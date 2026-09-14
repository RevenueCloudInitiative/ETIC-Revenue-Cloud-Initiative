import type { ReactNode } from "react";

/**
 * `standard` — the data pages (Show all data, Data Export, Data Import, Users).
 * These render wide tables and want the room.
 * `narrow` — Home, which is a single search box and one summary card. At full
 * width the search bar stretches across the viewport and looks unfinished.
 */
export type PageWidth = "standard" | "narrow";

/**
 * The outer container every page sits in.
 *
 * Five pages had five different widths — `max-w-2xl`, `max-w-6xl`, `max-w-7xl`,
 * `max-w-[110rem]` and `max-w-[120rem]` — so the content column visibly jumped
 * as you moved between them. The widths lived inline in each page, which is why
 * they drifted in the first place: nothing tied them together, so each new page
 * picked a plausible-looking value.
 *
 * Keeping the value here means "the app's content width" is one edit, not five.
 * `narrow` exists because Home genuinely differs, not as an escape hatch — a new
 * data page should take the default.
 */
const WIDTHS: Record<PageWidth, string> = {
  standard: "max-w-[120rem] px-4 py-8 sm:px-6 lg:px-8 xl:px-12",
  narrow: "max-w-2xl px-4 py-10 sm:px-6",
};

interface PageShellProps {
  width?: PageWidth;
  children: ReactNode;
  className?: string;
}

export function PageShell({
  width = "standard",
  children,
  className = "",
}: PageShellProps) {
  return (
    <div className={`mx-auto w-full ${WIDTHS[width]} ${className}`.trim()}>
      {children}
    </div>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned controls (Setup links, view toggles). */
  actions?: ReactNode;
}

/**
 * Title + description, with optional right-aligned actions.
 *
 * Users, Data Export and Data Import had this block copy-pasted verbatim, down
 * to the `mb-6 flex flex-wrap items-start justify-between gap-3` wrapper.
 *
 * **`flex-1` on the text block is load-bearing, not cosmetic.** Without it the
 * block is sized by its own content, so with `justify-between` the *actions*
 * land wherever the description happens to end. Data Export changes its
 * description when you switch Rows/Summarize, and the longer Summarize wording
 * moved the mode toggle **93px to the right** — the control you just clicked
 * slid out from under the pointer. Letting the text absorb the free space pins
 * the actions to the right edge, so their position no longer depends on how
 * much prose sits beside them.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-foreground mb-1 text-xl font-bold">{title}</h1>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}
