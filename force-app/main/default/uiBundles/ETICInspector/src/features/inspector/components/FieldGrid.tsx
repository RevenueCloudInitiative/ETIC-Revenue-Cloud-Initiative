import {
  Check,
  Cog,
  Columns2,
  Copy,
  CornerDownRight,
  EyeOff,
  Layers,
  Pencil,
  Save,
  Search,
  X,
} from "lucide-react";
import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import { stickyHeaderCellBelowNav } from "../../../components/TableScroller";
import { toast } from "../../../components/ui/sonner";
import { Spinner } from "../../../components/ui/spinner";
import { Button } from "../../../components/ui/button";
import type {
  FieldRow,
  RecordDetail,
  UiFieldValue,
} from "../../../api/recordDetail";
import {
  RecordUpdateError,
  updateRecordFields,
  type UpdateFieldValue,
} from "../../../api/recordUpdate";
import { PicklistSelect } from "../../../components/PicklistSelect";
import {
  isPicklistType,
  optionsFor,
  type PicklistMap,
  type PicklistValue,
} from "../../../api/picklists";
import { useCopyFeedback } from "../../../hooks/useCopyFeedback";
import { usePicklistValues } from "../../../hooks/usePicklistValues";
import { inputClass, searchInputClass } from "../../../components/inputStyles";

interface FieldGridProps {
  detail: RecordDetail;
  /** Receives the values Salesforce echoed back, so the page can update in place. */
  onSaved?: (
    fields: Record<string, UiFieldValue>,
    lastModifiedDate: string | null,
  ) => void;
}

const EDITABLE_TYPES = new Set([
  "String",
  "TextArea",
  "Email",
  "Phone",
  "Url",
  "Boolean",
  "Int",
  "Double",
  "Currency",
  "Percent",
  "Date",
  "DateTime",
  "Time",
  "Picklist",
  "MultiPicklist",
]);

function canInlineEdit(row: FieldRow): boolean {
  return (
    row.updateable &&
    row.status !== "compound" &&
    // Its value failed to load, so the editor would prefill empty and a save
    // would clear whatever the record actually holds. Refresh, then edit.
    row.status !== "unknown" &&
    !row.isCompoundParent &&
    EDITABLE_TYPES.has(row.dataType)
  );
}

function inputValue(row: FieldRow): string | boolean {
  if (row.dataType === "Boolean") return row.rawValue === true;
  if (row.rawValue == null) return "";
  if (row.dataType === "DateTime") {
    const date = new Date(String(row.rawValue));
    if (!Number.isNaN(date.getTime())) {
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 16);
    }
  }
  return String(row.rawValue);
}

function serializeDraft(
  row: FieldRow,
  draft: string | boolean,
): UpdateFieldValue {
  if (row.dataType === "Boolean") return Boolean(draft);
  const text = String(draft).trim();
  if (text === "") return null;
  if (["Int", "Double", "Currency", "Percent"].includes(row.dataType)) {
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error("Enter a valid number.");
    return value;
  }
  if (row.dataType === "DateTime") {
    const value = new Date(text);
    if (Number.isNaN(value.getTime()))
      throw new Error("Enter a valid date and time.");
    return value.toISOString();
  }
  return text;
}

function InlineEditor({
  row,
  value,
  error,
  options,
  optionsLoading = false,
  onChange,
  autoFocus = false,
}: {
  row: FieldRow;
  value: string | boolean;
  error?: string;
  /** Null while unavailable — the editor then degrades to a text input. */
  options?: PicklistValue[] | null;
  optionsLoading?: boolean;
  onChange: (value: string | boolean) => void;
  autoFocus?: boolean;
}) {
  if (isPicklistType(row.dataType) && (options || optionsLoading)) {
    return (
      <div>
        <PicklistSelect
          value={String(value)}
          multi={row.dataType === "MultiPicklist"}
          options={options ?? []}
          loading={optionsLoading && !options}
          onChange={onChange}
        />
        {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
      </div>
    );
  }

  if (row.dataType === "Boolean") {
    return (
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 cursor-pointer"
        />
        {value ? "True" : "False"}
      </label>
    );
  }

  const common = `${inputClass("md")} w-full`;
  if (row.dataType === "TextArea") {
    return (
      <div>
        <textarea
          autoFocus={autoFocus}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className={common}
        />
        {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
      </div>
    );
  }

  const type =
    row.dataType === "Email"
      ? "email"
      : row.dataType === "Phone"
        ? "tel"
        : row.dataType === "Url"
          ? "url"
          : ["Int", "Double", "Currency", "Percent"].includes(row.dataType)
            ? "number"
            : row.dataType === "Date"
              ? "date"
              : row.dataType === "DateTime"
                ? "datetime-local"
                : row.dataType === "Time"
                  ? "time"
                  : "text";

  return (
    <div>
      <input
        autoFocus={autoFocus}
        type={type}
        step={type === "number" ? "any" : undefined}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        className={common}
      />
      {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
    </div>
  );
}

/** Canonical order for address/geolocation components. */
const COMPONENT_ORDER = [
  "Street",
  "City",
  "State",
  "StateCode",
  "PostalCode",
  "Country",
  "CountryCode",
  "Latitude",
  "Longitude",
  "GeocodeAccuracy",
];
function componentRank(name: string | null): number {
  if (!name) return 99;
  const i = COMPONENT_ORDER.indexOf(name);
  return i === -1 ? 90 : i;
}

/** A pill-style toggle button that clearly shows on/off state. */
function TogglePill({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:bg-muted",
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const { copied, copy } = useCopyFeedback();
  return (
    <button
      type="button"
      aria-label="Copy value"
      onClick={() => copy(text)}
      className="text-muted-foreground hover:text-foreground opacity-0 transition group-hover:opacity-100"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function ValueCell({ row }: { row: FieldRow }) {
  switch (row.status) {
    case "value":
      if (row.userName) {
        return (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-foreground break-words text-sm font-medium">
              {row.userName}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground break-all font-mono text-[12px]">
                {row.display}
              </span>
              <CopyButton text={row.display!} />
            </div>
          </div>
        );
      }
      return (
        <div className="flex items-start gap-2">
          <span className="text-foreground break-words font-mono text-[13px]">
            {row.display}
          </span>
          <CopyButton text={row.display!} />
        </div>
      );
    case "empty":
      return (
        <span className="text-muted-foreground/50" title="Field is empty">
          —
        </span>
      );
    // Fallback only: the request for this field failed, so its value is
    // genuinely unknown and must not be drawn as an empty dash. Deliberately
    // quiet and deliberately absent from the legend — on a healthy load no
    // row is ever in this state.
    case "unknown":
      return (
        <span
          className="text-muted-foreground/70 text-xs italic"
          title="Couldn't retrieve this field — the request for it failed. It may still have a value; use Refresh to try again."
        >
          Not retrieved
        </span>
      );
    case "compound":
      return (
        <span
          className="text-muted-foreground inline-flex items-center gap-1.5 text-xs italic"
          title="Compound field — value is composed from the component fields below"
        >
          <Layers className="h-3.5 w-3.5" />
          Composed of the fields below
        </span>
      );
  }
}

interface FieldRowItemProps {
  row: FieldRow;
  isChild: boolean;
  isEditing: boolean;
  draft: string | boolean | undefined;
  error: string | undefined;
  autoFocus: boolean;
  /**
   * Whole map rather than this row's options: its identity comes straight from
   * the api-layer cache and so is stable, whereas a per-row array would be a
   * new object on every render and defeat the memo below.
   */
  picklists: PicklistMap | null;
  picklistsLoading: boolean;
  /** Current value of `row.controllerField`, for dependent picklists. */
  controllingValue: string | null;
  onEdit: (row: FieldRow) => void;
  onCancelEdit: (apiName: string) => void;
  onDraftChange: (row: FieldRow, value: string | boolean) => void;
}

/**
 * One field row.
 *
 * Memoized and fed only primitives (plus a stable `row` identity and stable
 * callbacks) so that filtering or editing one field doesn't re-render the
 * other several hundred. Passing the `editing` Set / `drafts` Map down here
 * would defeat this — every edit allocates a new collection identity.
 */
const FieldRowItem = memo(function FieldRowItem({
  row,
  isChild,
  isEditing,
  draft,
  error,
  autoFocus,
  picklists,
  picklistsLoading,
  controllingValue,
  onEdit,
  onCancelEdit,
  onDraftChange,
}: FieldRowItemProps) {
  const editable = canInlineEdit(row);

  const picklist =
    picklists && isPicklistType(row.dataType)
      ? picklists[row.apiName]
      : undefined;
  const options = useMemo(
    () =>
      picklist
        ? optionsFor(picklist, row.controllerField ? controllingValue : null)
        : null,
    [picklist, row.controllerField, controllingValue],
  );

  return (
    <tr
      className={[
        "group",
        isChild ? "bg-primary/[0.03]" : "hover:bg-muted/30",
      ].join(" ")}
    >
      <td
        className={[
          "border-border border-t py-2 align-top",
          isChild ? "border-l-primary/40 border-l-2 pl-6 pr-3" : "px-3",
        ].join(" ")}
      >
        <div className="flex items-center gap-2">
          {isChild && (
            <CornerDownRight className="text-primary/50 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="text-foreground font-medium">{row.label}</span>
          {row.isCompoundParent && (
            <span
              title="Compound field — made up of the indented component fields"
              className="border-primary/30 bg-primary/10 text-primary inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            >
              <Layers className="h-3 w-3" />
              Compound
            </span>
          )}
          {row.isSystem && (
            <span
              title="System field — read-only, maintained by Salesforce"
              className="border-border bg-muted text-muted-foreground inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            >
              <Cog className="h-3 w-3" />
              System
            </span>
          )}
        </div>
        <div className="text-muted-foreground font-mono text-xs">
          {row.apiName}
        </div>
      </td>
      <td className="border-border border-t px-3 py-2 align-top">
        <span className="border-border bg-muted/50 text-muted-foreground rounded border px-1.5 py-0.5 text-xs">
          {row.userName ? "User" : row.dataType}
        </span>
      </td>
      <td className="border-border border-t px-3 py-2 align-top">
        {isEditing ? (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <InlineEditor
                row={row}
                value={draft ?? inputValue(row)}
                error={error}
                options={options}
                optionsLoading={picklistsLoading}
                onChange={(value) => onDraftChange(row, value)}
                autoFocus={autoFocus}
              />
            </div>
            <button
              type="button"
              title="Cancel changes to this field"
              aria-label={`Cancel changes to ${row.label}`}
              onClick={() => onCancelEdit(row.apiName)}
              className="border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground mt-0.5 inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
        ) : (
          <div
            className={[
              "flex items-start gap-2",
              editable ? "cursor-text" : "",
            ].join(" ")}
            onDoubleClick={() => editable && onEdit(row)}
            title={editable ? "Double-click to edit" : undefined}
          >
            <div className="min-w-0 flex-1">
              <ValueCell row={row} />
            </div>
            {editable && (
              <button
                type="button"
                title="Edit field"
                aria-label={`Edit ${row.label}`}
                onClick={() => onEdit(row)}
                className="text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer rounded p-1 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
});

function GridTable({
  rows,
  childOf,
  editing,
  drafts,
  fieldErrors,
  picklists,
  picklistsLoading,
  valuesByField,
  onEdit,
  onCancelEdit,
  onDraftChange,
}: {
  rows: FieldRow[];
  childOf: Set<string>;
  editing: Set<string>;
  drafts: Map<string, string | boolean>;
  fieldErrors: Record<string, string>;
  picklists: PicklistMap | null;
  picklistsLoading: boolean;
  /** Current raw value per field, so a row can read its controlling field. */
  valuesByField: Map<string, string>;
  onEdit: (row: FieldRow) => void;
  onCancelEdit: (apiName: string) => void;
  onDraftChange: (row: FieldRow, value: string | boolean) => void;
}) {
  const soleEdit = editing.size === 1;

  return (
    // `overflow-clip` rather than `overflow-hidden`: both round off the
    // corners, but `hidden` makes this a scroll container, which would anchor
    // the sticky header to a box that itself scrolls away with the page.
    // `clip` clips without creating one, so the header sticks to the viewport
    // instead — which is what the two-column layout needs, since two
    // independently scrolling half-tables would be worse than one page.
    <div className="border-border overflow-clip rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-muted-foreground text-left text-xs uppercase tracking-wide">
            <th
              className={`${stickyHeaderCellBelowNav} px-3 py-2 font-semibold`}
            >
              Field
            </th>
            <th
              className={`${stickyHeaderCellBelowNav} px-3 py-2 font-semibold`}
            >
              Type
            </th>
            <th
              className={`${stickyHeaderCellBelowNav} px-3 py-2 font-semibold`}
            >
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <FieldRowItem
              key={r.apiName}
              row={r}
              isChild={childOf.has(r.apiName)}
              isEditing={editing.has(r.apiName)}
              draft={drafts.get(r.apiName)}
              error={fieldErrors[r.apiName]}
              autoFocus={soleEdit}
              picklists={picklists}
              picklistsLoading={picklistsLoading}
              controllingValue={
                r.controllerField
                  ? (valuesByField.get(r.controllerField) ?? null)
                  : null
              }
              onEdit={onEdit}
              onCancelEdit={onCancelEdit}
              onDraftChange={onDraftChange}
            />
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={3}
                className="text-muted-foreground px-3 py-8 text-center text-sm"
              >
                No fields to show.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function FieldGrid({ detail, onSaved }: FieldGridProps) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Set<string>>(new Set());
  // Only fields whose value differs from the loaded value live in drafts.
  const [drafts, setDrafts] = useState<Map<string, string | boolean>>(
    new Map(),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [hideSystem, setHideSystem] = useState(false);
  const [twoColumns, setTwoColumns] = useState(false);

  // Keeps the input responsive on wide objects: typing updates the box
  // immediately and React re-filters the (expensive) table at lower priority.
  const deferredQuery = useDeferredValue(query);

  const rowsByName = useMemo(
    () => new Map(detail.rows.map((row) => [row.apiName, row])),
    [detail.rows],
  );

  const systemCount = useMemo(
    () => detail.rows.filter((r) => r.isSystem).length,
    [detail.rows],
  );

  /** Raw values keyed by field, so a dependent picklist can read its controller. */
  const valuesByField = useMemo(
    () =>
      new Map(
        detail.rows.map((row) => [
          row.apiName,
          row.rawValue == null ? "" : String(row.rawValue),
        ]),
      ),
    [detail.rows],
  );

  /**
   * Fields whose component fields are indented beneath them.
   *
   * Derived from the children's own `compoundFieldName` rather than from the
   * parent's `isCompoundParent` flag. The two used to be the same thing; now
   * that a field like Account.Name is correctly *not* a compound parent, its
   * FirstName/LastName parts would otherwise fall out of the grouping pass and
   * get appended at the bottom of the table, away from the field they belong to.
   */
  const parentsWithChildren = useMemo(() => {
    const s = new Set<string>();
    for (const r of detail.rows) if (r.compoundParent) s.add(r.compoundParent);
    return s;
  }, [detail.rows]);

  // Group parents that are themselves system fields. When "Hide system" is on
  // we must also hide their component children (which usually aren't flagged
  // system individually) so the whole group disappears together.
  const systemCompoundParents = useMemo(() => {
    const s = new Set<string>();
    for (const r of detail.rows) {
      if (r.isSystem && parentsWithChildren.has(r.apiName)) s.add(r.apiName);
    }
    return s;
  }, [detail.rows, parentsWithChildren]);

  /**
   * Picklist options cost one API call, so nothing is fetched until an editor
   * that actually needs them is open — reading a record never pays for them.
   */
  const needsPicklists = useMemo(
    () =>
      [...editing].some((apiName) =>
        isPicklistType(rowsByName.get(apiName)?.dataType ?? ""),
      ),
    [editing, rowsByName],
  );

  const { picklists, loading: picklistsLoading } = usePicklistValues(
    detail.objectApiName,
    detail.recordTypeId,
    needsPicklists,
  );

  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return detail.rows.filter((r: FieldRow) => {
      if (hideSystem) {
        if (r.isSystem) return false;
        // Hide children of a hidden system compound parent.
        if (r.compoundParent && systemCompoundParents.has(r.compoundParent))
          return false;
      }
      if (hideEmpty && (r.status === "empty" || r.status === "compound"))
        return false;
      if (!q) return true;
      return (
        r.apiName.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        (r.display?.toLowerCase().includes(q) ?? false) ||
        (r.userName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [
    detail.rows,
    deferredQuery,
    hideEmpty,
    hideSystem,
    systemCompoundParents,
  ]);

  const { ordered, childOf } = useMemo(() => {
    const byName = new Map(visible.map((r) => [r.apiName, r]));
    const childOf = new Set<string>();
    const emitted = new Set<string>();
    const out: FieldRow[] = [];

    const emitChildren = (parentApi: string) => {
      visible
        .filter((c) => c.compoundParent === parentApi)
        .sort(
          (a, b) =>
            componentRank(a.componentName) - componentRank(b.componentName),
        )
        .forEach((c) => {
          if (!emitted.has(c.apiName)) {
            out.push(c);
            emitted.add(c.apiName);
            childOf.add(c.apiName);
          }
        });
    };

    for (const r of visible) {
      if (emitted.has(r.apiName)) continue;
      if (r.compoundParent && byName.has(r.compoundParent)) continue;
      out.push(r);
      emitted.add(r.apiName);
      if (parentsWithChildren.has(r.apiName)) emitChildren(r.apiName);
    }
    for (const r of visible) {
      if (!emitted.has(r.apiName)) {
        out.push(r);
        emitted.add(r.apiName);
      }
    }
    return { ordered: out, childOf };
  }, [visible, parentsWithChildren]);

  const [left, right] = useMemo(() => {
    if (!twoColumns) return [ordered, [] as FieldRow[]];
    let idx = Math.ceil(ordered.length / 2);
    while (idx < ordered.length && childOf.has(ordered[idx].apiName)) idx++;
    return [ordered.slice(0, idx), ordered.slice(idx)];
  }, [ordered, childOf, twoColumns]);

  // Stable identities — without these, memoizing the rows buys nothing.
  const beginEdit = useCallback((row: FieldRow) => {
    if (!canInlineEdit(row)) return;
    setEditing((current) => new Set(current).add(row.apiName));
  }, []);

  /**
   * Open editors for the fields currently on screen rather than every editable
   * field on the object. On a wide object the latter mounted several hundred
   * controlled inputs in a single commit.
   */
  const editAll = useCallback(() => {
    setEditing(
      new Set(ordered.filter(canInlineEdit).map((row) => row.apiName)),
    );
  }, [ordered]);

  const changeDraft = useCallback((row: FieldRow, value: string | boolean) => {
    const original = inputValue(row);
    setDrafts((current) => {
      const next = new Map(current);
      if (value === original) next.delete(row.apiName);
      else next.set(row.apiName, value);
      return next;
    });
    setFieldErrors((current) => {
      if (!current[row.apiName]) return current;
      const next = { ...current };
      delete next[row.apiName];
      return next;
    });
  }, []);

  const cancelFieldEdit = useCallback((apiName: string) => {
    setEditing((current) => {
      const next = new Set(current);
      next.delete(apiName);
      return next;
    });
    setDrafts((current) => {
      const next = new Map(current);
      next.delete(apiName);
      return next;
    });
    setFieldErrors((current) => {
      if (!current[apiName]) return current;
      const next = { ...current };
      delete next[apiName];
      return next;
    });
  }, []);

  const cancelEdits = useCallback(() => {
    setEditing(new Set());
    setDrafts(new Map());
    setFieldErrors({});
  }, []);

  const saveEdits = async () => {
    const fields: Record<string, UpdateFieldValue> = {};
    const localErrors: Record<string, string> = {};
    for (const [apiName, draft] of drafts) {
      const row = rowsByName.get(apiName);
      if (!row) continue;
      try {
        fields[apiName] = serializeDraft(row, draft);
      } catch (error) {
        localErrors[apiName] =
          error instanceof Error ? error.message : "Invalid value.";
      }
    }
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    setSaving(true);
    setFieldErrors({});
    try {
      const result = await updateRecordFields({
        recordId: detail.recordId,
        fields,
      });
      const count = Object.keys(fields).length;
      setEditing(new Set());
      setDrafts(new Map());
      // The edit bar disappears on success, taking any message with it, so the
      // confirmation has to outlive it — hence a toast rather than a banner.
      toast.success(
        `Saved ${count} field${count === 1 ? "" : "s"} on ${detail.recordId}.`,
      );
      // Hand the echoed values up so the page refreshes in place — no reload,
      // no second read of the record.
      onSaved?.(result.fields, result.lastModifiedDate);
    } catch (error) {
      // Per-field errors stay inline next to the field they belong to; only the
      // overall "it didn't save" goes to the toast.
      const message =
        error instanceof Error ? error.message : "Could not save the record.";
      if (error instanceof RecordUpdateError) setFieldErrors(error.fieldErrors);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {editing.size > 0 && (
        <div className="border-primary/20 bg-background/95 sticky top-14 z-20 mb-3 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 shadow-md backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <span className="text-foreground text-sm font-medium">
            {drafts.size > 0
              ? `${drafts.size} field${drafts.size === 1 ? "" : "s"} modified`
              : `${editing.size} editable field${editing.size === 1 ? "" : "s"} open`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={cancelEdits}
              disabled={saving}
            >
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={saveEdits}
              disabled={saving || drafts.size === 0}
            >
              {saving ? <Spinner /> : <Save className="h-4 w-4" />}
              Save changes
            </Button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            placeholder="Filter fields…"
            className={`${searchInputClass("md")} w-full`}
          />
        </div>

        <TogglePill
          active={editing.size > 0}
          onClick={editing.size > 0 ? cancelEdits : editAll}
          icon={Pencil}
        >
          Edit
        </TogglePill>

        <TogglePill
          active={hideEmpty}
          onClick={() => setHideEmpty((v) => !v)}
          icon={EyeOff}
        >
          Hide empty
        </TogglePill>
        {systemCount > 0 && (
          <TogglePill
            active={hideSystem}
            onClick={() => setHideSystem((v) => !v)}
            icon={Cog}
          >
            Hide system
          </TogglePill>
        )}
        <TogglePill
          active={twoColumns}
          onClick={() => setTwoColumns((v) => !v)}
          icon={Columns2}
        >
          Split view
        </TogglePill>

        <span className="text-muted-foreground ml-auto text-sm tabular-nums">
          {visible.length} of {detail.rows.length}
        </span>
      </div>

      {/* Legend (top) */}
      <div className="text-muted-foreground mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground/50">—</span> Empty
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" /> Compound (indented components)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Cog className="h-3.5 w-3.5" /> System (read-only, maintained by
          Salesforce)
        </span>
      </div>

      {/* Table(s) */}
      {twoColumns ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GridTable
            rows={left}
            childOf={childOf}
            editing={editing}
            drafts={drafts}
            fieldErrors={fieldErrors}
            picklists={picklists}
            picklistsLoading={picklistsLoading}
            valuesByField={valuesByField}
            onEdit={beginEdit}
            onCancelEdit={cancelFieldEdit}
            onDraftChange={changeDraft}
          />
          <GridTable
            rows={right}
            childOf={childOf}
            editing={editing}
            drafts={drafts}
            fieldErrors={fieldErrors}
            picklists={picklists}
            picklistsLoading={picklistsLoading}
            valuesByField={valuesByField}
            onEdit={beginEdit}
            onCancelEdit={cancelFieldEdit}
            onDraftChange={changeDraft}
          />
        </div>
      ) : (
        <GridTable
          rows={ordered}
          childOf={childOf}
          editing={editing}
          drafts={drafts}
          fieldErrors={fieldErrors}
          picklists={picklists}
          picklistsLoading={picklistsLoading}
          valuesByField={valuesByField}
          onEdit={beginEdit}
          onCancelEdit={cancelFieldEdit}
          onDraftChange={changeDraft}
        />
      )}
    </div>
  );
}
