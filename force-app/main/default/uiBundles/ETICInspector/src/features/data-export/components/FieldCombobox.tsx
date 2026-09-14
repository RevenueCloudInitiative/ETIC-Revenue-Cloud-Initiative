import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { FieldMeta } from "../../../lib/fieldMeta";
import {
  COMBO_INPUT_CLASS,
  COMBO_LIST_CLASS,
  ComboOption,
} from "./comboOption";

/** A field the object has that this box won't accept, and why. */
export interface DisabledField {
  field: FieldMeta;
  /** Sentence fragment following the field's label. */
  reason: string;
}

interface FieldComboboxProps {
  fields: FieldMeta[];
  /** Committed field API name; `""` when nothing is chosen. */
  value: string;
  onChange: (apiName: string) => void;
  /** Offers a "None" row — used by the sort selector, which is optional. */
  allowEmpty?: boolean;
  emptyLabel?: string;
  ariaLabel: string;
  className?: string;
  /**
   * Fields that exist but can't be chosen here, listed greyed-out with their
   * reason when the search matches them.
   *
   * Without this, a field that is real but unusable is indistinguishable from
   * one that doesn't exist — both are simply absent — and the two are fixed in
   * completely different ways.
   */
  unavailable?: DisabledField[];
  /**
   * Offer to commit whatever was typed, even when it matches no field.
   *
   * Off by default, and deliberately so: Data Export relies on this box being
   * a *search*, so that a filter can never name a field the object doesn't
   * have. Data Import turns it on because there the typed name is checked by
   * the validator before anything is sent, and getting a named reason back is
   * more useful than the field silently not being in the list.
   */
  allowCustomValue?: boolean;
}

/**
 * How many matches to mount at once. Wide objects run to several hundred
 * filterable fields, and mounting all of them makes every keystroke re-render
 * the whole list for no benefit — nobody scrolls past fifty. The count of what
 * is hidden is shown so the list never lies about being complete.
 */
const MAX_VISIBLE = 50;

/**
 * The unavailable list is an explanation, not a menu — a handful is enough to
 * answer "where did my field go?", and a wide object would otherwise bury the
 * fields that *can* be picked under the ones that can't.
 */
const MAX_DISABLED = 6;

/**
 * Searchable field selector.
 *
 * A plain `<select>` on a wide object is a several-hundred-row scroll, so this
 * lets the field be typed. The typing is a *search*, not an input: `onChange`
 * fires only when a row from the list is chosen, so `filter.field` can never
 * hold a name the object doesn't have. Free text that matches nothing simply
 * finds nothing, and abandoning the input reverts to the committed field rather
 * than committing a guess — the validation is structural, not a check that
 * could be skipped.
 *
 * `allowCustomValue` is the one exception, and it stays an exception. It adds a
 * row that commits the typed text verbatim, which Data Import opts into because
 * its validator checks every mapped name against the object before a single
 * call is spent. Data Export must not turn it on: a filter naming a field that
 * doesn't exist has no such gate in front of it and would reach the org.
 */
export function FieldCombobox({
  fields,
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = "None",
  ariaLabel,
  className = "",
  unavailable,
  allowCustomValue = false,
}: FieldComboboxProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Typing stays responsive on wide objects; the re-filter runs at lower
  // priority, matching how the field picker and results grid behave.
  const deferredDraft = useDeferredValue(draft);

  const selected = useMemo(
    () => fields.find((f) => f.apiName === value) ?? null,
    [fields, value],
  );

  const matches = useMemo(() => {
    const q = deferredDraft.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      (f) =>
        f.label.toLowerCase().includes(q) ||
        f.apiName.toLowerCase().includes(q),
    );
  }, [fields, deferredDraft]);

  const visible = matches.slice(0, MAX_VISIBLE);
  const hidden = matches.length - visible.length;

  /**
   * Unavailable fields matching the same search.
   *
   * Only ever shown while the user is typing. Listing every read-only field on
   * an idle dropdown would be noise; showing the one they just searched for is
   * the answer to the question they were asking.
   */
  const disabled = useMemo(() => {
    const q = deferredDraft.trim().toLowerCase();
    if (!unavailable || q === "") return [];
    return unavailable
      .filter(
        (u) =>
          u.field.label.toLowerCase().includes(q) ||
          u.field.apiName.toLowerCase().includes(q),
      )
      .slice(0, MAX_DISABLED);
  }, [unavailable, deferredDraft]);

  /**
   * The typed text, when it is offered as a literal API name.
   *
   * Suppressed once it exactly names something already in the list, so the
   * escape hatch never sits directly beneath the ordinary row that does the
   * same thing.
   */
  const custom = useMemo(() => {
    if (!allowCustomValue) return null;
    const typed = deferredDraft.trim();
    if (typed === "") return null;
    return fields.some((f) => f.apiName === typed) ? null : typed;
  }, [allowCustomValue, deferredDraft, fields]);

  /**
   * Rows the keyboard can land on, in the order they are rendered — the
   * optional "None" row sits at index 0, and the unavailable list is left out
   * because it can't be chosen.
   */
  const options = useMemo(() => {
    const rows = allowEmpty ? [""] : [];
    rows.push(...visible.map((f) => f.apiName));
    if (custom !== null) rows.push(custom);
    return rows;
  }, [allowEmpty, visible, custom]);

  const close = useCallback(() => {
    setOpen(false);
    setDraft("");
    setHighlight(0);
  }, []);

  const commit = useCallback(
    (apiName: string) => {
      onChange(apiName);
      close();
      inputRef.current?.blur();
    },
    [onChange, close],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => {
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = h + step;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (open && options[highlight] !== undefined) commit(options[highlight]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const displayValue = open ? draft : (selected?.label ?? value);

  return (
    <div
      className={`relative ${className}`}
      // Closing on focus leaving the whole widget, rather than on the input's
      // own blur, is what lets a click land on an option first.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        value={displayValue}
        placeholder={allowEmpty && !value ? emptyLabel : "Search fields…"}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        className={`${COMBO_INPUT_CLASS} py-1.5 pl-2 pr-6 text-xs`}
      />
      <ChevronDown className="text-muted-foreground pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />

      {open && (
        <ul className={COMBO_LIST_CLASS}>
          {allowEmpty && (
            <li>
              <ComboOption
                label={emptyLabel}
                active={highlight === 0}
                chosen={value === ""}
                onPick={() => commit("")}
              />
            </li>
          )}

          {visible.map((field, index) => (
            <li key={field.apiName}>
              <ComboOption
                label={field.label}
                sub={`${field.apiName} · ${field.dataType}`}
                active={highlight === (allowEmpty ? index + 1 : index)}
                chosen={value === field.apiName}
                onPick={() => commit(field.apiName)}
              />
            </li>
          ))}

          {custom !== null && (
            <li>
              <ComboOption
                label={`Use "${custom}" as an API name`}
                sub="checked before anything is imported"
                active={highlight === options.length - 1}
                chosen={value === custom}
                onPick={() => commit(custom)}
              />
            </li>
          )}

          {/*
            Listed, not offered. A field that exists but can't be written is a
            different problem from a field that doesn't exist, and the user
            can't tell which they have unless the box says so.
          */}
          {disabled.length > 0 && (
            <>
              <li className="text-muted-foreground border-border border-t px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide">
                On this object, but not importable
              </li>
              {disabled.map(({ field, reason }) => (
                <li
                  key={field.apiName}
                  className="px-2.5 py-1.5 text-xs opacity-60"
                >
                  <span className="text-foreground block truncate font-medium">
                    {field.label}
                  </span>
                  <span className="text-muted-foreground block font-mono text-[10px]">
                    {field.apiName}
                  </span>
                  <span className="text-muted-foreground block text-[10px] italic">
                    {reason}
                  </span>
                </li>
              ))}
            </>
          )}

          {matches.length === 0 && disabled.length === 0 && custom === null && (
            <li className="text-muted-foreground px-2.5 py-3 text-center text-[11px]">
              No field matches — only fields on this object can be used.
            </li>
          )}

          {hidden > 0 && (
            <li className="text-muted-foreground border-border border-t px-2.5 py-1.5 text-[10px]">
              {hidden.toLocaleString()} more — keep typing to narrow.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
