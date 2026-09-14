import { RecordSearchBar } from "../features/inspector/components/RecordSearchBar";
import { RecordSummaryCard } from "../features/inspector/components/RecordSummaryCard";
import { useRecordInspector } from "../hooks/useRecordInspector";
import { Spinner } from "../components/ui/spinner";
import { Banner } from "../components/Banner";
import { PageShell } from "../components/PageShell";

export default function HomePage() {
  const { status, result, error, inspect } = useRecordInspector();
  const loading = status === "loading";

  return (
    <PageShell width="narrow">
      {/*
        Home keeps its own larger heading rather than using `PageHeader`. It is
        the landing screen — one search box and a card — so it reads as a prompt
        rather than as a section header on a working page.
      */}
      <div className="mb-6">
        <h1 className="text-foreground text-2xl font-bold">Inspect a record</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Enter a record Id or object name to view its metadata and data.
        </p>
      </div>

      {/* Search */}
      <RecordSearchBar loading={loading} onSubmit={inspect} />

      {/* States */}
      <div className="mt-5">
        {status === "idle" && (
          <Banner tone="info">
            Paste a Record Id to jump straight to its details.
          </Banner>
        )}

        {status === "loading" && (
          <div className="text-muted-foreground border-border bg-card flex items-center justify-center gap-2 rounded-lg border px-4 py-10 text-sm">
            <Spinner />
            Resolving…
          </div>
        )}

        {status === "error" && error && (
          <Banner tone="destructive">{error}</Banner>
        )}

        {status === "success" && result && (
          <RecordSummaryCard result={result} />
        )}
      </div>
    </PageShell>
  );
}
