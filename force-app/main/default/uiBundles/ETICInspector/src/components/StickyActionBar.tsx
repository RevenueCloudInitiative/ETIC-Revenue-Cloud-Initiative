import type { ReactNode } from "react";

/**
 * An action bar pinned to the bottom of the viewport while its section is on
 * screen.
 *
 * Long tables push their controls off the bottom: Data Export's pager sat under
 * 200 rows, so paging meant scrolling down, clicking Next, and scrolling back
 * up; Data Import's submit button sat under as many rows as you pasted. Both
 * needed the same treatment, so it lives here rather than being written twice
 * with slightly different padding.
 *
 * It sticks only while its own container is in view, which is the point — the
 * bar shouldn't hover over the query builder above the results.
 *
 * `backdrop-blur` plus a translucent background rather than a solid one: rows
 * scrolling underneath should stay faintly visible, so the bar reads as
 * floating over the table instead of truncating it.
 */
export function StickyActionBar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-background/95 border-border sticky bottom-0 z-20 mt-3 flex flex-wrap items-center gap-3 border-t py-2 backdrop-blur ${className}`}
    >
      {children}
    </div>
  );
}
