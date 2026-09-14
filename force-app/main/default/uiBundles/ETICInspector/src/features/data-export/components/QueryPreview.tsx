import { Fragment } from "react";
import { Check, Copy, Play } from "lucide-react";
import { useCopyFeedback } from "../../../hooks/useCopyFeedback";
import { Spinner } from "../../../components/ui/spinner";
import { Button } from "../../../components/ui/button";
import { sectionLabel } from "../../../components/sectionLabel";

interface QueryPreviewProps {
  soql: string;
  loading: boolean;
  canRun: boolean;
  onRun: () => void;
}

// Longer phrases first so "ORDER BY" / "GROUP BY" / "NOT IN" match whole,
// not just their trailing single-word alternative.
const SOQL_KEYWORDS =
  /\b(ORDER BY|GROUP BY|NOT IN|SELECT|FROM|WHERE|LIMIT|LIKE|NULL|TRUE|FALSE|ASC|DESC|AND|OR|IN)\b/g;

/** Colors SOQL keywords; everything else (field/object names, literals) stays plain. */
function highlightSoql(soql: string) {
  const parts = soql.split(SOQL_KEYWORDS);
  return parts.map((part, i) =>
    // Odd indices are the captured keyword group from String.split.
    i % 2 === 1 ? (
      <span key={i} className="text-blue-600 dark:text-blue-400 font-semibold">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/**
 * Read-only preview of the query.
 *
 * The SOQL shown is generated from the builder for readability — it is not what
 * executes (the app compiles the same structured query to GraphQL, because the
 * SOQL endpoint is not a permitted API here). It is accurate as a description
 * of what was asked for, and useful to paste into other tools.
 */
export function QueryPreview({
  soql,
  loading,
  canRun,
  onRun,
}: QueryPreviewProps) {
  const { copied, copy } = useCopyFeedback();

  return (
    <div className="border-border bg-muted/30 rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={sectionLabel}>Query</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => copy(soql)}
            disabled={!soql}
            title="Copy the generated SOQL"
            className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? (
              <Check className="h-3 w-3 text-success" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <Button
            type="button"
            size="sm"
            onClick={onRun}
            disabled={!canRun || loading}
          >
            {loading ? <Spinner size="sm" /> : <Play className="h-3.5 w-3.5" />}
            Run
          </Button>
        </div>
      </div>

      <pre className="text-foreground overflow-x-auto whitespace-pre-wrap break-words font-mono text-[15px] leading-relaxed">
        {soql
          ? highlightSoql(soql)
          : "Choose an object and at least one field."}
      </pre>
    </div>
  );
}
