/**
 * The small grey capitals that title a panel or sit above a control —
 * OBJECT, FIELDS, DATA, HISTORY, COLUMNS.
 *
 * Written out **fifteen times across ten files** before this existed, in five
 * variants: with `mb-1.5 block`, with `mb-2`, with `flex items-center gap-1.5`,
 * with nothing, and one with `mb-1.5` but no `block`. Nothing decided which a
 * given label got. Same reasoning as `inputStyles.ts` and `stickyHeaderCell` —
 * a class string used across files is a shared thing whether or not anyone
 * named it, and the unnamed version is the one that drifts.
 *
 * The **element** deliberately stays at the call site rather than being wrapped
 * in a component. These are `<h2>` when they title a region, `<label>` when
 * they name a form control, and `<span>` when they are neither — that
 * distinction is semantic, it is the accessibility tree, and a polymorphic
 * `as` prop would only obscure it while fighting the type checker.
 *
 * Spacing is baked into the two variants, not appended by callers, for the same
 * reason `inputStyles.ts` bakes geometry: without `tailwind-merge` an appended
 * `mb-2` does not reliably beat the variant's `mb-1.5`.
 */

/** For a label inside a flex row, or one whose parent already spaces it. */
export const sectionLabel =
  "text-muted-foreground text-xs font-semibold uppercase tracking-wide";

/** For a label sitting directly above the thing it names. */
export const sectionLabelSpaced = `${sectionLabel} mb-1.5 block`;
