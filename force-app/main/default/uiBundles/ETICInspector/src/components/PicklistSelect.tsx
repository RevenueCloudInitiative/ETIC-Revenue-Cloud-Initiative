import { MULTI_PICKLIST_SEPARATOR, type PicklistValue } from "../api/picklists";
import { selectClass } from "./inputStyles";

/**
 * The one picklist control in this app.
 *
 * Every screen that lets someone choose a picklist value renders this: the
 * record editor in Show all data, the inline row editor in Data Export, and the
 * cell editor in Data Import. It existed twice before — `PicklistCell` in
 * `ResultsGrid` and `PicklistEditor` in `FieldGrid` — which had already drifted
 * apart (only one of them kept a value that wasn't in the list), and a third
 * copy in the importer briefly used a native `<datalist>`, which renders with
 * the operating system's own chrome and looked nothing like the rest of the app.
 *
 * **New picklist UI goes through this component.** A styled `<select>` is the
 * house style; anything that needs to look different should change it here so
 * every screen changes together.
 *
 * Two behaviours are load-bearing rather than cosmetic:
 *
 * - **A current value that isn't in the options is kept** and labelled, instead
 *   of being dropped. Values get deactivated in Setup, belong to another record
 *   type, or — on an unrestricted picklist — were simply never in the list. A
 *   select that silently dropped the value would show the field as blank and
 *   then erase it on the next save.
 * - **While options are loading, an unknown value isn't accused of being
 *   unknown.** Every value looks missing before the list arrives, and saying so
 *   would be alarming and wrong a moment later.
 *
 * Options are keyed by position rather than by value, because a State/Country
 * picklist repeats a code across countries — `TN` is both Tennessee and Tamil
 * Nadu — so the stored value is not unique within the list even though each row
 * is distinct.
 */

export interface PicklistSelectProps {
  /** Stored value. For MultiPicklist, semicolon-separated. */
  value: string;
  options: PicklistValue[];
  multi?: boolean;
  /** Options are still on their way; suppresses the "not in this list" label. */
  loading?: boolean;
  onChange: (value: string) => void;
  /**
   * `sm` matches the dense grids (Data Export rows, Data Import cells); `md`
   * matches the record editor, where a field editor is a full-width control.
   */
  size?: "sm" | "md";
  /** Extra entries appended to the list, e.g. an escape hatch to free text. */
  extraOptions?: { value: string; label: string }[];
  ariaLabel?: string;
  className?: string;
}

/**
 * Chrome comes from `components/inputStyles.ts`, which is also what the plain
 * inputs beside these use. `sm` previously had no focus ring at all, so a dense
 * grid row mixing a picklist cell and a text cell showed the focused one as
 * unfocused; both are `xs` there now and match.
 */
const SIZES = {
  sm: `${selectClass("xs")} w-full`,
  md: `${selectClass("md")} w-full`,
} as const;

export function PicklistSelect({
  value,
  options,
  multi = false,
  loading = false,
  onChange,
  size = "md",
  extraOptions = [],
  ariaLabel,
  className = "",
}: PicklistSelectProps) {
  const current = multi
    ? value === ""
      ? []
      : value.split(MULTI_PICKLIST_SEPARATOR)
    : value === ""
      ? []
      : [value];

  const known = new Set(options.map((option) => option.value));
  const shown: PicklistValue[] = [
    ...options,
    ...current
      .filter((v) => !known.has(v))
      .map((v) => ({
        value: v,
        label: loading ? v : `${v} (not in this list)`,
        validFor: [],
      })),
  ];

  const classes = `${SIZES[size]} ${className}`.trim();

  if (multi) {
    return (
      <div>
        <select
          multiple
          value={current}
          disabled={loading}
          aria-label={ariaLabel}
          onChange={(event) =>
            onChange(
              [...event.target.selectedOptions]
                .map((option) => option.value)
                .join(MULTI_PICKLIST_SEPARATOR),
            )
          }
          size={Math.min(6, Math.max(2, shown.length))}
          className={classes}
        >
          {shown.map((option, index) => (
            <option key={`${option.value}-${index}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground mt-1 text-[11px]">
          {loading ? "Loading values…" : "Ctrl-click to select more than one."}
        </p>
      </div>
    );
  }

  return (
    <select
      value={value}
      disabled={loading}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className={classes}
    >
      <option value="">{loading ? "Loading values…" : "— None —"}</option>
      {shown.map((option, index) => (
        <option key={`${option.value}-${index}`} value={option.value}>
          {option.label}
        </option>
      ))}
      {extraOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
