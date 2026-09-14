import { useApiLimit } from "../../../hooks/useApiLimit";

/**
 * Compact API-usage meter for the top nav. Shows a percentage; on hover a
 * small styled tooltip reveals the actual request counts. Reuses the live
 * useApiLimit hook and self-hides when usage data isn't available.
 */
export function NavApiUsage() {
  const data = useApiLimit();
  if (!data) return null;

  const pct = data.usedPercent;
  const bar =
    pct >= 85 ? "bg-destructive" : pct >= 60 ? "bg-warning" : "bg-success";

  return (
    <div className="group relative hidden items-center gap-2 md:flex">
      <span className="text-muted-foreground text-xs font-medium tabular-nums">
        API {pct}%
      </span>
      <div className="bg-muted h-1.5 w-20 overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full ${bar}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      {/* Hover tooltip with actual numbers */}
      <div className="pointer-events-none absolute right-0 top-full z-40 mt-2 w-52 origin-top-right scale-95 rounded-lg border border-border bg-card p-3 opacity-0 shadow-lg transition-all duration-150 group-hover:scale-100 group-hover:opacity-100">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-foreground text-xs font-semibold">
            Daily API usage
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {pct}%
          </span>
        </div>
        <div className="bg-muted mb-2 h-1.5 w-full overflow-hidden rounded-full">
          <div
            className={`h-full rounded-full ${bar}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <dl className="space-y-1 text-xs">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Used</dt>
            <dd className="text-foreground font-medium tabular-nums">
              {data.used.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Remaining</dt>
            <dd className="text-foreground font-medium tabular-nums">
              {data.remaining.toLocaleString()}
            </dd>
          </div>
          <div className="border-border flex justify-between border-t pt-1">
            <dt className="text-muted-foreground">Daily limit</dt>
            <dd className="text-foreground font-medium tabular-nums">
              {data.max.toLocaleString()}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
