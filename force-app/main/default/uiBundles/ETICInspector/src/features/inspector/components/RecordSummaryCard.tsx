import { List, Plus } from "lucide-react";
import { useNavigate } from "react-router";
import type { InspectResult } from "../../../hooks/useRecordInspector";
import { requestFreshDetail } from "../../../lib/recordDetailCache";
import { formatSfDateTime, newRecordUrl } from "../../../lib/salesforce";
import { Button } from "../../../components/ui/button";
import { InlineSetupLinks } from "./SetupLinks";

interface RecordSummaryCardProps {
  result: InspectResult;
}

/** One "label : value" line in the metadata grid. */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border grid grid-cols-[7rem_1fr] items-start gap-3 border-t py-2.5 first:border-t-0">
      <dt className="text-muted-foreground text-sm font-semibold">{label}</dt>
      <dd className="text-foreground text-sm break-words">{children}</dd>
    </div>
  );
}

export function RecordSummaryCard({ result }: RecordSummaryCardProps) {
  const navigate = useNavigate();

  // Narrow on the discriminant so `record` is typed as RecordSummary | null.
  // (Copying result.data into a plain variable would widen it back to the
  // union and lose the record-only fields — that was the TS2339 cause.)
  const record = result.kind === "record" ? result.data : null;

  // Fields common to both RecordSummary and ObjectSummary.
  const { objectApiName, objectLabel, isCustom } = result.data;
  const docType = isCustom ? "Custom" : "Standard";

  return (
    <div className="border-border bg-card rounded-xl border shadow-sm">
      {/* Header */}
      <div className="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 className="text-foreground text-lg font-bold">{objectLabel}</h2>
        <span className="border-primary/20 bg-primary/5 text-primary rounded-md border px-2 py-0.5 text-xs font-medium">
          {docType}
        </span>
      </div>

      {/* Metadata grid */}
      <dl className="px-5 py-1">
        {record?.recordName && <Row label="Name">{record.recordName}</Row>}
        <Row label="Label">{objectLabel}</Row>
        {record && (
          <Row label="Id">
            <span className="font-mono text-[13px]">{record.recordId}</span>
          </Row>
        )}
        <Row label="Doc">{docType}</Row>
        {record && (
          <>
            <Row label="Created">
              {formatSfDateTime(record.createdDate)}
              {record.createdByName ? ` (${record.createdByName})` : ""}
            </Row>
            <Row label="Last Modified">
              {formatSfDateTime(record.lastModifiedDate)}
              {record.lastModifiedByName
                ? ` (${record.lastModifiedByName})`
                : ""}
            </Row>
          </>
        )}
        <Row label="Links">
          <InlineSetupLinks objectApiName={objectApiName} />
        </Row>
      </dl>

      {/* Actions */}
      <div className="flex flex-col gap-2 px-5 pb-5 pt-2">
        {record && (
          <Button
            variant="outline"
            className="w-full justify-center gap-2"
            // Pressing this is an explicit request for the record, so All
            // Data must load it rather than replay a copy cached earlier in
            // the session. See `requestFreshDetail`.
            onClick={() => {
              requestFreshDetail(record.recordId);
              navigate(
                `/show-all-data?id=${encodeURIComponent(record.recordId)}`,
              );
            }}
          >
            <List className="h-4 w-4" />
            Show all data
          </Button>
        )}
        <Button
          variant="outline"
          className="w-full justify-center gap-2"
          onClick={() =>
            window.open(newRecordUrl(objectApiName), "_blank", "noreferrer")
          }
        >
          <Plus className="h-4 w-4" />
          New {objectLabel}
        </Button>
      </div>
    </div>
  );
}
