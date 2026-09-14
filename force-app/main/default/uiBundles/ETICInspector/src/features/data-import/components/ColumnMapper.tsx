import { ArrowRight, Ban, Lock } from "lucide-react";
import { useMemo } from "react";
import { Banner } from "../../../components/Banner";
import { FieldCombobox } from "../../data-export/components/FieldCombobox";
import type { FieldMeta, FieldMetaMap } from "../../../lib/fieldMeta";
import {
  matchHeader,
  unavailableFields,
  writableFields,
  type ImportOperation,
} from "../import/types";
import { sectionLabel } from "../../../components/sectionLabel";
import { TextButton } from "../../../components/TextButton";

interface ColumnMapperProps {
  headers: string[];
  mapping: (string | null)[];
  fields: FieldMetaMap;
  operation: ImportOperation;
  objectLabel: string;
  /** First data row, shown as a sample so a mis-mapping is obvious. */
  sampleRow: string[] | undefined;
  /** True when the data carries record Ids but the operation is insert. */
  looksLikeUpdate: boolean;
  onChange: (column: number, field: string | null) => void;
  onSwitchToUpdate: () => void;
}

/**
 * One row per column in the file: header on the left, Salesforce field on the
 * right, a sample value underneath.
 *
 * The sample is what makes a wrong mapping visible. "Owner" auto-mapping to
 * `OwnerId` looks fine in the abstract, and looks obviously wrong the moment
 * the sample under it reads "Jane Smith" rather than an Id.
 *
 * Unmapped columns are normal, not errors — spreadsheets carry notes, formulas
 * and working columns — so "Don't import" is a first-class choice rather than a
 * failure state.
 */
export function ColumnMapper({
  headers,
  mapping,
  fields,
  operation,
  objectLabel,
  sampleRow,
  looksLikeUpdate,
  onChange,
  onSwitchToUpdate,
}: ColumnMapperProps) {
  const candidates: FieldMeta[] = writableFields(fields, operation);
  const mappedCount = mapping.filter(Boolean).length;

  /**
   * The unwritable fields, plus which column header (if any) names one.
   *
   * This is the answer to the report that prompted the feature: a column called
   * "Age" auto-maps to nothing, and the page said nothing, because the field is
   * real but read-only and read-only fields are simply absent from the list.
   * Absent from the list and absent from the object look identical, and are
   * fixed in completely different ways.
   */
  const { unavailable, blockedByColumn } = useMemo(() => {
    const list = unavailableFields(fields, operation);
    const blockedFields = list.map((entry) => entry.field);
    const byApiName = new Map(
      list.map((entry) => [entry.field.apiName, entry]),
    );
    return {
      unavailable: list,
      blockedByColumn: headers.map((header) => {
        const match = matchHeader(header, blockedFields);
        return match ? (byApiName.get(match.apiName) ?? null) : null;
      }),
    };
  }, [headers, fields, operation]);

  if (headers.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <h2 className={sectionLabel}>Columns</h2>
        <span className="text-muted-foreground text-xs">
          {mappedCount} of {headers.length} mapped
        </span>
      </div>

      {/*
        Pasting a sheet of record Ids while the page is set to "Create new" is an
        easy mistake to make, and a baffling one to debug: Id is deliberately not
        offered on insert (Salesforce assigns it), so the field simply isn't in
        the list and the page looks broken rather than opinionated. Naming the
        cause and offering the fix costs one line and saves the guess.
      */}
      {looksLikeUpdate && (
        <Banner tone="warning" size="sm" className="mb-2">
          <span className="flex flex-wrap items-center gap-2">
            <span>
              This data contains record Ids. Id can&apos;t be set when creating
              records — Salesforce assigns it.
            </span>
            <TextButton tone="inherit" onClick={onSwitchToUpdate}>
              Switch to Update existing
            </TextButton>
          </span>
        </Banner>
      )}

      {/*
        No `overflow-hidden` here, deliberately. The field combobox hangs its
        list off an absolutely-positioned element, and clipping the container
        cut the list off after two options — which read as "the field list is
        broken" rather than "the container is too short".
      */}
      <div className="border-border bg-card divide-border/60 divide-y rounded-lg border">
        {headers.map((header, column) => {
          const field = mapping[column];
          const sample = sampleRow?.[column] ?? "";
          // Only worth saying while the column is unmapped: once the user has
          // pointed it somewhere, why the header's namesake was unavailable is
          // no longer the question they're asking.
          const blocked = field ? null : blockedByColumn[column];
          return (
            <div
              key={`${header}-${column}`}
              className="relative grid items-center gap-3 px-3 py-2 sm:grid-cols-[1fr_auto_1fr]"
            >
              <div className="min-w-0">
                <span className="text-foreground block truncate text-sm font-medium">
                  {header || (
                    <span className="text-muted-foreground italic">
                      (no header)
                    </span>
                  )}
                </span>
                {sample !== "" && (
                  <span className="text-muted-foreground block truncate font-mono text-[11px]">
                    {sample}
                  </span>
                )}
              </div>

              <ArrowRight
                className={`hidden h-3.5 w-3.5 shrink-0 sm:block ${
                  field ? "text-muted-foreground" : "text-muted-foreground/30"
                }`}
              />

              <div>
                <div className="flex items-center gap-2">
                  <FieldCombobox
                    fields={candidates}
                    value={field ?? ""}
                    onChange={(apiName) => onChange(column, apiName || null)}
                    allowEmpty
                    emptyLabel="Don't import"
                    ariaLabel={`Salesforce field for column ${header || column + 1}`}
                    className="min-w-0 flex-1"
                    unavailable={unavailable}
                    allowCustomValue
                  />
                  {!field && (
                    <Ban
                      className="text-muted-foreground/40 h-3.5 w-3.5 shrink-0"
                      aria-label="This column will be ignored"
                    />
                  )}
                </div>

                {blocked && (
                  <p className="text-muted-foreground mt-1 flex items-start gap-1 text-[11px]">
                    <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      <span className="font-medium">
                        {blocked.field.apiName}
                      </span>{" "}
                      exists on {objectLabel} but is {blocked.reason}.
                    </span>
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/*
        Zero matches out of several columns almost always means the wrong object
        is selected, not that every header needs mapping by hand — Opportunity
        data pasted against Account being the usual case.
      */}
      {mappedCount === 0 && headers.length > 0 && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          None of these columns match a writable field on{" "}
          <span className="font-medium">{objectLabel}</span>. Check the object
          is right, or map each column by hand.
        </p>
      )}
    </div>
  );
}
