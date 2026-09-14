import { Check } from "lucide-react";
import { INPUT_CHROME } from "../../../components/inputStyles";

/**
 * Shared pieces for the two comboboxes on this page.
 *
 * They behave differently on purpose — the field picker only ever commits a
 * field the object actually has, while the object box also accepts a freely
 * typed API name, since its list comes from GraphQL introspection and that is
 * one more thing an org can have switched off — but they should not *look*
 * different, so the dropdown chrome lives here rather than being written twice.
 *
 * The field chrome itself comes from `components/inputStyles.ts` so these two
 * match every other input in the app; only `rounded-md` and the width are added
 * here, because each combobox sets its own padding to clear the chevron or the
 * search button sharing its box.
 */
export const COMBO_INPUT_CLASS = `${INPUT_CHROME} w-full min-w-0 rounded-md`;

/**
 * The list hangs off the left edge and sizes to its content rather than to the
 * input. Constraining it to the input's width made it unreadably narrow in the
 * sidebar, where the field box is one of three controls sharing ~20rem. The
 * 22rem cap below is therefore wider than the sidebar on purpose — the list
 * overhangs it rather than being squeezed into it.
 */
export const COMBO_LIST_CLASS =
  "border-border bg-popover absolute left-0 top-full z-30 mt-1 max-h-64 w-max min-w-full max-w-[22rem] overflow-y-auto rounded-md border shadow-lg";

export function ComboOption({
  label,
  sub,
  active,
  chosen,
  onPick,
}: {
  label: string;
  sub?: string;
  active: boolean;
  chosen: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      // Mousedown would blur the input and close the list before the click
      // could land, so the default is suppressed and the click does the work.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={`flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
        active ? "bg-muted" : "hover:bg-muted/60"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate font-medium">
          {label}
        </span>
        {sub && (
          <span className="text-muted-foreground block truncate font-mono text-[10px]">
            {sub}
          </span>
        )}
      </span>
      {chosen && <Check className="text-primary h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}
