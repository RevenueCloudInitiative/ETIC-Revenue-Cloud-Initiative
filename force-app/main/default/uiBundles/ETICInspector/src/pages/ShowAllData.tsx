import { ArrowLeft, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { deleteRecords } from "../api/dataExport";
import { FieldGrid } from "../features/inspector/components/FieldGrid";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { toast } from "../components/ui/sonner";
import { Banner } from "../components/Banner";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageShell } from "../components/PageShell";
import { IdCopy } from "../features/inspector/components/IdCopy";
import { RecordSearchBar } from "../features/inspector/components/RecordSearchBar";
import { SetupLinks } from "../features/inspector/components/SetupLinks";
import { getLastRecordId, useRecordDetail } from "../hooks/useRecordDetail";
import { toFriendlyMessage } from "../lib/errors";
import { cacheKey, requestFreshDetail } from "../lib/recordDetailCache";
import { getLightningBaseUrl } from "../lib/salesforce";

export default function ShowAllDataPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const idParam = params.get("id");

  // If we arrived without an id (e.g. via the nav link), restore the last
  // record that was viewed so the page doesn't clear on tab switches.
  const recordId = idParam ?? getLastRecordId();

  useEffect(() => {
    if (!idParam && recordId) {
      navigate(`/show-all-data?id=${encodeURIComponent(recordId)}`, {
        replace: true,
      });
    }
  }, [idParam, recordId, navigate]);

  const { status, data, error, applyFieldUpdates, refresh } =
    useRecordDetail(recordId);

  const recordUrl =
    data &&
    `${getLightningBaseUrl()}/lightning/r/${data.objectApiName}/${data.recordId}/view`;

  /**
   * Prefer the values Salesforce echoed back on save (free, already correct).
   * If it echoed nothing, fall back to a reload so the grid can never sit
   * there showing pre-save values.
   */
  const handleSaved = (
    fields: Parameters<typeof applyFieldUpdates>[0],
    lastModifiedDate: string | null,
  ) => {
    if (Object.keys(fields).length === 0) refresh();
    else applyFieldUpdates(fields, lastModifiedDate);
  };

  /**
   * Submitting an Id is an explicit request for that record's *current* state,
   * so it must never be answered from the cache — see `requestFreshDetail`.
   *
   * The same-record branch is not an optimisation, it is the only thing that
   * makes re-submitting work at all: the Id lives in the query string, so
   * navigating to the record already on screen produces an identical URL,
   * `recordId` never changes, and the load effect never re-runs. Without this,
   * the most natural "reload this" gesture in the page was silently a no-op.
   */
  const handleSearch = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (recordId && cacheKey(v) === cacheKey(recordId)) {
      refresh();
      return;
    }
    requestFreshDetail(v);
    navigate(`/show-all-data?id=${encodeURIComponent(v)}`);
  };

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /**
   * Delete the record on screen, through the same `deleteRecords` path Data
   * Export's bulk delete uses — one aliased `{Object}Delete` mutation, and the
   * app's third and last write path rather than a fourth.
   *
   * On success the page cannot stay where it is: the fields below describe
   * something that no longer exists. Dropping the Id from the URL lands on the
   * page's own empty state, and because `deleteRecords` calls `forgetRecord`
   * the page won't restore the deleted record from `getLastRecordId()` on the
   * way back in.
   *
   * A failure keeps the record on screen, which is the whole reason the failed
   * row is read rather than trusting the absence of a throw: `allOrNone: false`
   * means a rejected delete resolves normally, carrying its reason.
   */
  const confirmDelete = useCallback(async () => {
    if (!data) return;
    const { objectApiName, recordId: id, recordName } = data;

    setDeleting(true);
    try {
      const outcome = await deleteRecords(objectApiName, [id]);
      const failure = outcome.failed[0];
      if (failure) {
        toast.error(`Couldn't delete ${recordName} — ${failure.message}`, {
          duration: 10_000,
        });
        return;
      }
      toast.success(
        `Deleted ${recordName} · ${outcome.calls} API ${outcome.calls === 1 ? "call" : "calls"}`,
      );
      navigate("/show-all-data", { replace: true });
    } catch (err) {
      toast.error(toFriendlyMessage(err, { query: id, target: "record" }));
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }, [data, navigate]);

  return (
    <PageShell>
      <Link
        to="/"
        className="text-primary mb-4 inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      {/* Quick-inspect search bar (always available) */}
      <div className="mb-6">
        <RecordSearchBar
          loading={status === "loading"}
          onSubmit={handleSearch}
          initialValue={recordId ?? ""}
          placeholder="Enter a record Id to view all data…"
        />
      </div>

      {/* Header */}
      {status === "success" && data && (
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            {/* Record name links straight to the record in Salesforce */}
            {recordUrl ? (
              <a
                href={recordUrl}
                target="_blank"
                rel="noreferrer"
                className="text-foreground hover:text-primary group inline-flex items-center gap-1.5 text-xl font-bold transition-colors"
                title="Open this record in Salesforce"
              >
                {data.recordName}
                <ExternalLink className="text-muted-foreground group-hover:text-primary h-4 w-4" />
              </a>
            ) : (
              <h1 className="text-foreground text-xl font-bold">
                {data.recordName}
              </h1>
            )}
            <p className="text-muted-foreground mt-0.5 text-sm">
              {data.objectLabel}{" "}
              <span className="text-muted-foreground/60">·</span>{" "}
              <span className="font-mono">{data.recordId}</span>{" "}
              <span className="ml-1 inline-flex align-middle">
                <IdCopy value={data.recordId} />
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/*
              Same `Button variant="outline"` and the same geometry as the
              "Open in Setup" trigger it sits beside. Hand-rolled, it drew a
              smaller icon, a tighter box and no shadow, so two adjacent
              controls of equal weight looked like a primary and an
              afterthought.
            */}
            <Button
              type="button"
              variant="outline"
              onClick={refresh}
              title="Reload this record from Salesforce"
              aria-label="Reload this record from Salesforce"
              className="gap-2 px-3 py-2 shadow-sm"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <SetupLinks objectApiName={data.objectApiName} />
            {/*
              Last in the row, and the only control here tinted destructive:
              it sits beside two that merely re-read or navigate, so it needs
              to be the one that doesn't get clicked by muscle memory.

              **No `className`, deliberately** — same as Data Export's delete
              button, which is the other one of these in the app and passes
              none either. This first shipped with the neighbours'
              `gap-2 px-3 py-2 shadow-sm` copied onto it, on the theory that a
              row of buttons should share geometry, and it came out looking
              washed out beside the Data Export one: the wider box spreads the
              same 10%-opacity tint over more area, the loose gap pushes the
              icon off the label, and a shadow on a tinted fill reads as muddy
              rather than raised. The variant's own geometry (`h-8 gap-1.5
              px-2.5`) already matches the row's height, so the override was
              buying nothing and costing the look. Compared side by side
              against the real stylesheet before changing it; `size="sm"`,
              which is what Data Export passes, was the other candidate and
              sits visibly short next to a default-size Refresh.
            */}
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              title={`Delete this ${data.objectLabel} record`}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      )}

      {/* States */}
      {status === "idle" && !recordId && (
        <div className="text-muted-foreground bg-muted/50 border-border rounded-lg border px-4 py-3 text-sm">
          Enter a record Id above to view all of its fields.
        </div>
      )}

      {status === "loading" && (
        <div className="text-muted-foreground border-border bg-card flex items-center justify-center gap-2 rounded-lg border px-4 py-12 text-sm">
          <Spinner />
          Loading fields…
        </div>
      )}

      {status === "error" && error && (
        <Banner tone="destructive">{error}</Banner>
      )}

      {status === "success" && data && (
        <FieldGrid detail={data} onSaved={handleSaved} />
      )}

      {/*
        `ConfirmDialog` directly rather than Data Export's `DeleteConfirmDialog`
        wrapper: that one's whole job is wording a *count* ("Delete 1 Account
        record?"), and here the record has a name, which is the one thing worth
        reading before pressing Delete. Same modal, same tone, different words —
        which is all a wrapper ever supplies.
      */}
      {data && (
        <ConfirmDialog
          open={confirmOpen}
          tone="destructive"
          title={<>Delete {data.recordName}?</>}
          description="This sends the record to the org's Recycle Bin and cannot be undone from this app."
          notes={[
            `${data.objectLabel} · ${data.recordId}`,
            "Costs 1 API call against the org's daily limit.",
          ]}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={deleting}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={confirmDelete}
        />
      )}
    </PageShell>
  );
}
