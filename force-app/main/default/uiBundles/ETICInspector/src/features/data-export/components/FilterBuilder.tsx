import { Eye, EyeOff, Plus, X } from "lucide-react";
import { useState } from "react";
import {
  isPicklistType,
  optionsFor,
  type PicklistMap,
} from "../../../api/picklists";
import {
  isBooleanType,
  isDateType,
  isNumericType,
  type FieldMeta,
} from "../../../lib/fieldMeta";
import {
  clampLimit,
  isFilterActive,
  OPERATOR_LABELS,
  operatorsForType,
  type Filter,
  type FilterOperator,
  type OrderBy,
} from "../query/types";
import { FieldCombobox } from "./FieldCombobox";
import { Button } from "../../../components/ui/button";
import { inputClass, selectClass } from "../../../components/inputStyles";
import { sectionLabelSpaced } from "../../../components/sectionLabel";

/**
 * Which value editor a type needs. Switching fields within one family leaves a
 * typed value perfectly valid, so it is kept — wiping it on every field change
 * silently emptied the filter, and an empty filter is dropped from the query
 * entirely, so the run came back with every record and no visible reason why.
 */
function inputKind(dataType: string): "boolean" | "date" | "numeric" | "text" {
  if (isBooleanType(dataType)) return "boolean";
  if (isDateType(dataType)) return "date";
  if (isNumericType(dataType)) return "numeric";
  return "text";
}

interface FilterBuilderProps {
  filters: Filter[];
  filterable: FieldMeta[];
  limit: number;
  maxLimit: number;
  /** Null until a picklist filter makes them worth fetching. */
  picklists: PicklistMap | null;
  onChange: (filters: Filter[]) => void;
  onLimitChange: (limit: number) => void;
  /**
   * Sort controls are omitted entirely when these are absent, which is how
   * Summarize mode reuses this component: `uiapi.aggregate` has no usable
   * server-side ordering, so its results are sorted by clicking a column
   * instead, and offering a "Sort by" that did nothing would be a lie.
   */
  sortable?: FieldMeta[];
  orderBy?: OrderBy | null;
  onOrderByChange?: (orderBy: OrderBy | null) => void;
  /** Overrides the "Limit" caption — Summarize limits groups, not records. */
  limitLabel?: string;
}

const SELECT = selectClass("sm");

function newFilter(field: FieldMeta): Filter {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    field: field.apiName,
    operator: "eq",
    // A boolean renders as a two-option select with no blank state, so leaving
    // the value empty would show "true" while the filter was in fact ignored.
    value: isBooleanType(field.dataType) ? "true" : "",
  };
}

/**
 * Filter rows.
 *
 * Only `filterable` fields are offered and the operator list is narrowed by the
 * field's data type, so the builder cannot construct a filter Salesforce will
 * reject — the metadata is used to prevent the error rather than to explain it
 * afterwards.
 */
export function FilterBuilder({
  filters,
  filterable,
  sortable,
  orderBy = null,
  limit,
  maxLimit,
  picklists,
  onChange,
  onOrderByChange,
  onLimitChange,
  limitLabel = "Limit",
}: FilterBuilderProps) {
  /** Lets the limit box be emptied while retyping without snapping to a value. */
  const [cleared, setCleared] = useState(false);

  const update = (id: string, patch: Partial<Filter>) => {
    onChange(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const metaFor = (apiName: string) =>
    filterable.find((f) => f.apiName === apiName);

  const valueInputFor = (filter: Filter) => {
    const dataType = metaFor(filter.field)?.dataType ?? "String";
    const listOperator = filter.operator === "in" || filter.operator === "nin";

    // A picklist's values are known, so offer them instead of asking the user
    // to remember the exact stored value — which is what a filter has to match,
    // and which often differs from the label shown on the record.
    const picklist =
      picklists && isPicklistType(dataType)
        ? picklists[filter.field]
        : undefined;

    if (picklist && filter.operator !== "like") {
      const options = optionsFor(picklist);
      const selected = filter.value ? filter.value.split(",") : [];

      if (listOperator) {
        return (
          <select
            multiple
            value={selected}
            onChange={(e) =>
              update(filter.id, {
                value: [...e.target.selectedOptions]
                  .map((option) => option.value)
                  .join(","),
              })
            }
            size={Math.min(5, Math.max(2, options.length))}
            aria-label="Value"
            className={`${SELECT} min-w-0 flex-1`}
          >
            {/*
              Keyed by position: a State/Country picklist repeats a code across
              countries (TN is Tennessee and Tamil Nadu both), so the stored
              value is not unique within the list.
            */}
            {options.map((option, index) => (
              <option key={`${option.value}-${index}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );
      }

      return (
        <select
          value={filter.value}
          onChange={(e) => update(filter.id, { value: e.target.value })}
          aria-label="Value"
          className={`${SELECT} min-w-0 flex-1`}
        >
          <option value="">— pick a value —</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    if (isBooleanType(dataType) && !listOperator) {
      return (
        <select
          value={filter.value || "true"}
          onChange={(e) => update(filter.id, { value: e.target.value })}
          aria-label="Value"
          className={`${SELECT} flex-1`}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }

    return (
      <input
        type={isDateType(dataType) && !listOperator ? "date" : "text"}
        value={filter.value}
        onChange={(e) => update(filter.id, { value: e.target.value })}
        placeholder={
          listOperator ? "comma, separated, values" : "value — or null"
        }
        spellCheck={false}
        aria-label="Value"
        className={`${inputClass("sm")} min-w-0 flex-1`}
      />
    );
  };

  return (
    <div>
      <span className={sectionLabelSpaced}>Filters</span>

      {filters.length === 0 && (
        <p className="text-muted-foreground mb-2 text-xs">
          No filters — every record is returned, up to the limit.
        </p>
      )}

      {/*
        Same predicate the compilers use, so this line can't claim a filter is
        in effect that the query drops. Worth saying out loud: a list of three
        filters that are all switched off looks like a filtered query and is not
        one.
      */}
      {filters.length > 0 && !filters.some(isFilterActive) && (
        <p className="text-muted-foreground mb-2 text-xs">
          No filter is active — every record is returned, up to the limit.
        </p>
      )}

      {/*
        Two rows per filter rather than one. Field, operator and value side by
        side inside a ~20rem sidebar left every control too narrow to read the
        thing it held — field labels truncated after a word.
      */}
      <div className="mb-2 flex flex-col gap-2">
        {filters.map((filter) => {
          const dataType = metaFor(filter.field)?.dataType ?? "String";
          const operators = operatorsForType(dataType);
          const disabled = filter.disabled === true;
          // Only worth saying when the filter would otherwise have applied —
          // "no value yet" on top of "disabled" is two reasons for one outcome.
          const ignored = !disabled && filter.value.trim() === "";
          return (
            <div
              key={filter.id}
              className={`border-border bg-muted/30 rounded-md border p-2 ${
                /*
                 * Dimmed, not disabled: the controls stay live so a filter can
                 * be corrected while it is switched off, which is most of the
                 * point of switching it off rather than deleting it.
                 *
                 * Dimmed by *colour*, never by `opacity`. Opacity composites
                 * the whole subtree, and the field combobox renders its
                 * dropdown as a child of this card — so `opacity-55` here made
                 * the popup itself translucent, with the sort controls and the
                 * history panel showing through the option list. No child rule
                 * can undo an ancestor's opacity, so the only fix is not to set
                 * it. The controls are targeted individually and the popup's
                 * own `ul` holds neither an input nor a select, so it keeps its
                 * solid background.
                 */
                disabled
                  ? "border-dashed [&_input]:text-muted-foreground [&_select]:text-muted-foreground [&_input]:bg-muted/40 [&_select]:bg-muted/40"
                  : ""
              }`}
            >
              <div className="flex items-center gap-1.5">
                <FieldCombobox
                  fields={filterable}
                  value={filter.field}
                  ariaLabel="Field"
                  className="min-w-0 flex-1"
                  onChange={(apiName) => {
                    const nextType =
                      filterable.find((f) => f.apiName === apiName)?.dataType ??
                      "String";
                    // Reset the operator only when the new type disallows it,
                    // and the value only when it needs a different editor.
                    const allowed = operatorsForType(nextType);
                    update(filter.id, {
                      field: apiName,
                      operator: allowed.includes(filter.operator)
                        ? filter.operator
                        : allowed[0],
                      value:
                        inputKind(nextType) === inputKind(dataType)
                          ? filter.value
                          : isBooleanType(nextType)
                            ? "true"
                            : "",
                    });
                  }}
                />
                {/*
                  A switch rather than an icon that toggles meaning: the eye
                  shows the filter's current state, and `role="switch"` +
                  `aria-checked` is what tells a screen reader that this is an
                  on/off control rather than a second delete.

                  Off state gets a filled red pill, not just a crossed-out eye.
                  The two icons differ by a thin diagonal stroke at 14px, so at
                  a glance a switched-off filter looked identical to a live one
                  — and this control's whole purpose is that the filter stays
                  on screen while doing nothing. The `destructive` tint is the
                  same one the X beside it hovers to, so the pair reads as one
                  "this filter is not contributing" group. Contrast only, no
                  `opacity`: same reason the card is dimmed by colour (above).
                */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={!disabled}
                  onClick={() => update(filter.id, { disabled: !disabled })}
                  title={
                    disabled
                      ? "Enable this filter"
                      : "Disable this filter — keeps it here but leaves it out of the query"
                  }
                  aria-label={disabled ? "Enable filter" : "Disable filter"}
                  className={`shrink-0 cursor-pointer rounded-md p-1 transition-colors ${
                    disabled
                      ? "bg-destructive/10 text-destructive ring-destructive/30 hover:bg-destructive/20 ring-1"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {disabled ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange(filters.filter((f) => f.id !== filter.id))
                  }
                  aria-label="Remove filter"
                  className="text-muted-foreground hover:text-destructive shrink-0 cursor-pointer p-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-1.5 flex items-center gap-1.5">
                <select
                  value={filter.operator}
                  onChange={(e) =>
                    update(filter.id, {
                      operator: e.target.value as FilterOperator,
                    })
                  }
                  aria-label="Operator"
                  className={`${SELECT} w-28 shrink-0`}
                >
                  {operators.map((op) => (
                    <option key={op} value={op}>
                      {OPERATOR_LABELS[op]}
                    </option>
                  ))}
                </select>

                {valueInputFor(filter)}
              </div>

              {/*
                An empty filter is dropped from the query, which used to look
                exactly like a filter that ran and matched everything. A
                disabled one is dropped just as silently, so it says so too.
              */}
              {disabled && (
                <p className="text-destructive/90 mt-1.5 text-[10px]">
                  Disabled — kept here, left out of the query.
                </p>
              )}
              {ignored && (
                <p className="text-muted-foreground mt-1.5 text-[10px]">
                  No value yet — this filter is ignored.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={filterable.length === 0}
        onClick={() => onChange([...filters, newFilter(filterable[0])])}
      >
        <Plus className="h-3.5 w-3.5" />
        Add filter
      </Button>

      <div className="border-border mt-4 flex flex-wrap items-end gap-3 border-t pt-3">
        {onOrderByChange && (
          <div className="min-w-[10rem] flex-1">
            <span className="text-muted-foreground mb-1 block text-[11px]">
              Sort by
            </span>
            <FieldCombobox
              fields={sortable ?? []}
              value={orderBy?.field ?? ""}
              ariaLabel="Sort by"
              allowEmpty
              onChange={(apiName) =>
                onOrderByChange(
                  apiName
                    ? { field: apiName, direction: orderBy?.direction ?? "ASC" }
                    : null,
                )
              }
            />
          </div>
        )}

        {onOrderByChange && orderBy && (
          <div>
            <label
              htmlFor="order-dir"
              className="text-muted-foreground mb-1 block text-[11px]"
            >
              Direction
            </label>
            <select
              id="order-dir"
              value={orderBy.direction}
              onChange={(e) =>
                onOrderByChange({
                  field: orderBy.field,
                  direction: e.target.value as "ASC" | "DESC",
                })
              }
              className={SELECT}
            >
              <option value="ASC">Ascending</option>
              <option value="DESC">Descending</option>
            </select>
          </div>
        )}

        <div>
          <label
            htmlFor="limit-input"
            className="text-muted-foreground mb-1 block text-[11px]"
          >
            {limitLabel} (max {maxLimit.toLocaleString()})
          </label>
          <input
            id="limit-input"
            type="number"
            min={1}
            max={maxLimit}
            // `max` alone only governs the spinner arrows, so the ceiling is
            // applied here too: a typed 5000 becomes 2000 as it is entered,
            // and the box can never hold a number the query won't honour.
            value={cleared ? "" : limit}
            onChange={(e) => {
              const raw = e.target.value;
              // An empty box is a real state while retyping. The committed
              // limit is left alone so the query always has a usable one.
              if (raw === "") {
                setCleared(true);
                return;
              }
              setCleared(false);
              onLimitChange(clampLimit(Number(raw)));
            }}
            onBlur={() => setCleared(false)}
            className={`${SELECT} w-28`}
          />
        </div>
      </div>
    </div>
  );
}
