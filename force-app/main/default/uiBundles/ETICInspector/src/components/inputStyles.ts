/**
 * The app's one source of form-field chrome.
 *
 * This string was written out by hand fourteen times across ten files, and the
 * copies had drifted into five variants: some carried
 * `placeholder:text-muted-foreground` and some didn't, some carried the focus
 * ring (`focus:ring-ring/20 focus:ring-2`) and some settled for a border colour
 * change, and rounding alternated between `rounded`, `rounded-md` and
 * `rounded-lg` at the same visual size. Nothing tied them together, so each new
 * field picked whichever nearby field it was copied from.
 *
 * Two of those divergences were real defects rather than taste. The dense
 * picklist (`PicklistSelect` at `sm`) and the results-grid cell editor sit side
 * by side in the same row while editing, and only one of them drew a focus ring
 * — so tabbing between them made the focused cell look unfocused. Both take
 * `xs` here and now agree.
 *
 * ## Why these are classes and not a component
 *
 * The call sites are `<input>`, `<textarea>` and `<select>`, several carrying
 * refs, `role="combobox"`, ARIA wiring and their own keyboard handlers. A
 * wrapper component would have to forward all of it and would earn nothing, so
 * the shared part is the class string and the elements stay where they are.
 *
 * ## Why the geometry is baked into each variant
 *
 * Same reasoning as `components/ui/spinner.tsx`: these are plain concatenated
 * strings with no `cn()`, because `cn()` drags `tailwind-merge` (~9 KB gzip)
 * into whatever chunk imports it. Without tailwind-merge, a caller appending
 * `px-4` after a base `px-2` does **not** reliably win — both rules exist and
 * the generated stylesheet's order decides, not the call site's. So every
 * padding/rounding combination the app actually uses is a named variant here,
 * and callers append only classes that cannot conflict: width (`w-full`,
 * `flex-1`, `min-w-0`) and layout.
 *
 * Adding a new field means picking a variant, or adding one here — not writing
 * a fifteenth copy of the chrome.
 */

/**
 * Colour, border and focus treatment. No geometry and no width, so it never
 * conflicts with what a call site adds.
 */
const CHROME =
  "border-input bg-background text-foreground focus:border-ring focus:ring-ring/20 border outline-none focus:ring-2";

/** `CHROME` plus placeholder colour, for fields that show placeholder text. */
const CHROME_WITH_PLACEHOLDER = `${CHROME} placeholder:text-muted-foreground`;

/**
 * `xs` — a control inside a dense table row (the results-grid cell editor, the
 *        picklist editor beside it).
 * `sm` — a control in a builder panel (filter values, the operator and function
 *        selects, the history object filter).
 * `md` — a record-editor field, where the value is the main thing on the row.
 * `lg` — a page-level field the user types into first (the Home search box).
 */
export type InputSize = "xs" | "sm" | "md" | "lg";

const GEOMETRY: Record<InputSize, string> = {
  xs: "rounded px-1.5 py-1 text-xs",
  sm: "rounded-md px-2 py-1.5 text-xs",
  md: "rounded-md px-2.5 py-1.5 text-sm",
  lg: "rounded-lg px-4 py-2.5 text-sm shadow-sm",
};

/**
 * Geometry for a field with a search icon pinned inside its left edge, and
 * (at `lg`) a submit button inside the right edge. The horizontal padding is
 * asymmetric to clear them, which is why these can't just be `GEOMETRY` with a
 * class appended.
 *
 * Keep the icon's own offset in step with the left padding here: `pl-8` pairs
 * with `left-2.5` + `h-3.5`, `pl-9` with `left-3` + `h-4`.
 */
const SEARCH_GEOMETRY: Record<"sm" | "md" | "lg", string> = {
  sm: "rounded-md py-1.5 pl-8 pr-2 text-xs",
  md: "rounded-lg py-2 pl-9 pr-3 text-sm",
  lg: "rounded-lg py-2.5 pl-4 pr-11 text-sm shadow-sm",
};

/** A text input or textarea. Add width at the call site. */
export function inputClass(size: InputSize): string {
  return `${CHROME_WITH_PLACEHOLDER} ${GEOMETRY[size]}`;
}

/** A `<select>`. Same chrome; no placeholder colour, since selects have none. */
export function selectClass(size: InputSize): string {
  return `${CHROME} ${GEOMETRY[size]}`;
}

/** A text input with a search icon inside its left edge. */
export function searchInputClass(size: "sm" | "md" | "lg"): string {
  return `${CHROME_WITH_PLACEHOLDER} ${SEARCH_GEOMETRY[size]}`;
}

/**
 * Chrome with no geometry at all, for the two comboboxes, whose padding is set
 * by the caller because the input shares its box with a chevron or a spinner.
 */
export const INPUT_CHROME = CHROME_WITH_PLACEHOLDER;
