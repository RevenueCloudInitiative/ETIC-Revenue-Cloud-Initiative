import type { ReactNode } from "react";

/**
 * Why the header background is opaque and the bottom border is a shadow.
 *
 * `bg-muted` rather than the `bg-muted/40`–`/60` the four grids each used:
 * rows scroll *underneath* a sticky header, so a translucent one shows the
 * data sliding through the column names.
 *
 * The border is painted as an inset shadow because every table here sets
 * `border-collapse`, and a collapsed border belongs to the table's border grid
 * rather than to the cell — it stays behind at the row's original position
 * while the sticky cell moves, so `border-b` simply vanishes on scroll. A
 * shadow is drawn by the cell itself and travels with it.
 */
const STICKY_HEAD =
  "bg-muted sticky z-10 shadow-[inset_0_-1px_0_var(--color-border)]";

/**
 * Header cell for a table inside a {@link TableScroller} — sticks to the top of
 * the scroller.
 */
export const stickyHeaderCell = `${STICKY_HEAD} top-0`;

/**
 * Header cell for a table that scrolls with the *page* rather than in its own
 * box. `top-14` is the height of the sticky nav in `navigationMenu.tsx`, and
 * `z-10` keeps it under that nav's `z-30` so it slides beneath rather than over.
 *
 * Only for tables whose container is not a scroll container — see the note on
 * {@link TableScroller} for when that applies.
 */
export const stickyHeaderCellBelowNav = `${STICKY_HEAD} top-14`;

/**
 * A bounded, scrollable box for a wide data table, so its header can stay put.
 *
 * The height cap is not cosmetic. `position: sticky` resolves against the
 * nearest scroll container, and a table that needs horizontal scrolling is
 * already inside one: `overflow-x: auto` forces the computed `overflow-y` from
 * `visible` to `auto`, making the wrapper a scroll container on both axes. With
 * no height limit that box never scrolls vertically, so a `sticky top-0` header
 * pins to a point that is itself scrolling away with the page — the header
 * looks broken rather than sticky. Capping the height gives the box something
 * to scroll, and the header holds.
 *
 * A table with no horizontal overflow (`FieldGrid`) doesn't need this and is
 * better off scrolling with the page — especially in its two-column mode, where
 * two independent scrollboxes side by side would be worse than one page. Those
 * use `overflow-clip`, which clips without creating a scroll container, plus
 * {@link stickyHeaderCellBelowNav}.
 */
export function TableScroller({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border-border bg-card max-h-[70vh] overflow-auto rounded-lg border ${className}`}
    >
      {children}
    </div>
  );
}
