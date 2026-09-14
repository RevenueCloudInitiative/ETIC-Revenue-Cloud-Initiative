import { Pencil } from "lucide-react";
import { useState } from "react";
import type { PicklistValue } from "../../../api/picklists";
import { PicklistSelect } from "../../../components/PicklistSelect";

/**
 * A picklist cell in the import grid.
 *
 * Uses the app's shared `PicklistSelect` so it looks like every other picklist
 * in the project, with one addition the other screens don't need: **free text**.
 *
 * That isn't a convenience. An unrestricted picklist genuinely accepts values
 * outside its list — verified live, `Industry: "NotARealIndustry"` saves — and
 * `object-info` doesn't say which picklists are restricted. A control that only
 * offered the known values would block imports Salesforce would have accepted,
 * so the list is a shortcut, not a constraint.
 *
 * The escape hatch is an explicit option rather than an always-editable combo
 * box: picking from the list is the common case by a wide margin, and a plain
 * select is both the house style and the thing that can't be typo'd.
 */

/** Sentinel option value. `__` prefixed so it can't collide with a real one. */
const CUSTOM = "__custom__";

export function PicklistCell({
  value,
  options,
  multi,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: PicklistValue[];
  multi: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const known = new Set(options.map((option) => option.value));
  // A value that isn't in the list is already custom, so the cell opens in text
  // mode rather than making the user rediscover the escape hatch.
  const [freeText, setFreeText] = useState(
    () => value.trim() !== "" && !multi && !known.has(value),
  );

  if (freeText) {
    return (
      <div className="flex items-center gap-1 px-1">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          aria-label={ariaLabel}
          className="text-foreground focus:bg-background focus:ring-ring/30 w-full min-w-[8rem] bg-transparent px-1 py-1 font-mono text-xs outline-none focus:ring-1"
        />
        <button
          type="button"
          onClick={() => setFreeText(false)}
          title="Choose from the picklist instead"
          aria-label="Choose from the picklist instead"
          className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer rounded p-0.5"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="px-1 py-0.5">
      <PicklistSelect
        value={value}
        options={options}
        multi={multi}
        size="sm"
        ariaLabel={ariaLabel}
        extraOptions={multi ? [] : [{ value: CUSTOM, label: "Type a value…" }]}
        onChange={(next) => {
          if (next === CUSTOM) {
            // Switch to text without destroying what was already there.
            setFreeText(true);
            return;
          }
          onChange(next);
        }}
      />
    </div>
  );
}
