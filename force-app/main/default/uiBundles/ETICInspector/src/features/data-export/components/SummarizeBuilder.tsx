import { Plus, X } from "lucide-react";
import {
  functionsForType,
  FUNCTION_LABELS,
  RECORD_COUNT_MEASURE,
  type AggregateFunction,
  type GroupByField,
  type Measure,
} from "../query/aggregate";
import type { FieldMeta } from "../../../lib/fieldMeta";
import { FieldCombobox } from "./FieldCombobox";
import { Button } from "../../../components/ui/button";
import { selectClass } from "../../../components/inputStyles";
import { sectionLabelSpaced } from "../../../components/sectionLabel";

interface SummarizeBuilderProps {
  groupBy: GroupByField[];
  measures: Measure[];
  /** Fields Salesforce will let us group by — see query/aggregate.ts. */
  groupable: FieldMeta[];
  /** Fields that have at least one aggregate function. */
  measurable: FieldMeta[];
  onGroupByChange: (groupBy: GroupByField[]) => void;
  onMeasuresChange: (measures: Measure[]) => void;
}

const SELECT = selectClass("sm");

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Group-by dimensions and measures.
 *
 * Both pickers are restricted by the capability tables in `query/aggregate.ts`
 * rather than offering every field: a `count` on a Boolean, or a `group` on a
 * Currency, doesn't fail that one column — it fails the entire document, taking
 * every other measure with it. Narrowing the choice is what stops a summary
 * from being unbuildable for reasons the UI never explained.
 */
export function SummarizeBuilder({
  groupBy,
  measures,
  groupable,
  measurable,
  onGroupByChange,
  onMeasuresChange,
}: SummarizeBuilderProps) {
  const chosenDimensions = new Set(groupBy.map((g) => g.field));

  const updateMeasure = (id: string, patch: Partial<Measure>) => {
    onMeasuresChange(
      measures.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Group by ---- */}
      <div>
        <span className={sectionLabelSpaced}>Group by</span>

        {groupBy.length === 0 && (
          <p className="text-muted-foreground mb-2 text-xs">
            No grouping — the measures are calculated once across every matching
            record, giving a single total row.
          </p>
        )}

        <div className="mb-2 flex flex-col gap-2">
          {groupBy.map((group) => (
            <div key={group.id} className="flex items-center gap-1.5">
              <FieldCombobox
                fields={groupable}
                value={group.field}
                ariaLabel="Group by field"
                className="min-w-0 flex-1"
                onChange={(apiName) =>
                  onGroupByChange(
                    groupBy.map((g) =>
                      g.id === group.id ? { ...g, field: apiName } : g,
                    ),
                  )
                }
              />
              <button
                type="button"
                onClick={() =>
                  onGroupByChange(groupBy.filter((g) => g.id !== group.id))
                }
                aria-label="Remove grouping"
                className="text-muted-foreground hover:text-destructive shrink-0 cursor-pointer p-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={groupable.length === 0}
          onClick={() => {
            // Start on a field that isn't already a dimension — grouping by the
            // same field twice is a no-op that just looks broken.
            const next =
              groupable.find((f) => !chosenDimensions.has(f.apiName)) ??
              groupable[0];
            onGroupByChange([...groupBy, { id: newId(), field: next.apiName }]);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add grouping
        </Button>
      </div>

      {/* ---- Measures ---- */}
      <div>
        <span className={sectionLabelSpaced}>Measures</span>

        {measures.length === 0 && (
          <p className="text-muted-foreground mb-2 text-xs">
            No measures — add at least one, or the summary has nothing to show
            but the group values.
          </p>
        )}

        <div className="mb-2 flex flex-col gap-2">
          {measures.map((measure) => {
            const dataType =
              measurable.find((f) => f.apiName === measure.field)?.dataType ??
              "";
            // An unknown field (a restored history entry against another
            // object) keeps its own function rather than showing an empty
            // dropdown that would silently rewrite what the user asked for.
            const available = dataType
              ? functionsForType(dataType)
              : [measure.fn];

            return (
              <div
                key={measure.id}
                className="border-border bg-muted/30 rounded-md border p-2"
              >
                <div className="flex items-center gap-1.5">
                  <FieldCombobox
                    fields={measurable}
                    value={measure.field}
                    ariaLabel="Measure field"
                    className="min-w-0 flex-1"
                    onChange={(apiName) => {
                      const nextType =
                        measurable.find((f) => f.apiName === apiName)
                          ?.dataType ?? "";
                      const allowed = functionsForType(nextType);
                      updateMeasure(measure.id, {
                        field: apiName,
                        // Sum survives a move between two currency fields;
                        // moving to a text field falls back rather than
                        // emitting a function that type doesn't have.
                        fn: allowed.includes(measure.fn)
                          ? measure.fn
                          : (allowed[0] ?? "count"),
                      });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onMeasuresChange(
                        measures.filter((m) => m.id !== measure.id),
                      )
                    }
                    aria-label="Remove measure"
                    className="text-muted-foreground hover:text-destructive shrink-0 cursor-pointer p-1"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <select
                  value={measure.fn}
                  onChange={(e) =>
                    updateMeasure(measure.id, {
                      fn: e.target.value as AggregateFunction,
                    })
                  }
                  aria-label="Aggregate function"
                  className={`${SELECT} mt-1.5 w-full`}
                >
                  {available.map((fn) => (
                    <option key={fn} value={fn}>
                      {FUNCTION_LABELS[fn]}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={measurable.length === 0}
            onClick={() => {
              const first = measurable[0];
              onMeasuresChange([
                ...measures,
                {
                  id: newId(),
                  field: first.apiName,
                  fn: functionsForType(first.dataType)[0] ?? "count",
                },
              ]);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add measure
          </Button>

          {/*
            COUNT(Id) is the one measure valid on every object regardless of
            field-level security, and the one most summaries start from, so it
            gets a shortcut rather than making the user find "Record ID".
          */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onMeasuresChange([
                ...measures,
                { id: newId(), ...RECORD_COUNT_MEASURE },
              ])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Count records
          </Button>
        </div>
      </div>
    </div>
  );
}
