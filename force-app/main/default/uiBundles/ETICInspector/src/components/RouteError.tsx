import { AlertTriangle, RefreshCw } from "lucide-react";
import { useRouteError } from "react-router";

/**
 * Rendered in place of a page when it throws.
 *
 * Before this existed, any render error unmounted the whole tree and left a
 * blank white page — no message, no navigation, nothing to act on. It is
 * registered as `errorElement` on the *child* routes rather than the layout
 * route, so the nav bar survives and the failure is contained to the page area:
 * a broken Data Export shouldn't cost you the ability to reach Show All Data.
 */

/**
 * A chunk that 404s is the one error here with a specific, reliable fix.
 *
 * Pages are code-split, so their filenames carry a content hash. Deploying a
 * new build while someone has the app open invalidates the hashes their tab is
 * holding, and the next navigation requests a file the server no longer has.
 * Reloading picks up the new build; nothing else the user could do would help,
 * so it is worth detecting rather than showing a generic message.
 */
function isStaleChunkError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(
    message,
  );
}

function messageFor(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "An unexpected error occurred.";
}

export function RouteError() {
  const error = useRouteError();
  const stale = isStaleChunkError(error);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <div className="border-destructive/20 bg-destructive/5 rounded-lg border p-6">
        <div className="mb-3 flex items-start gap-3">
          <AlertTriangle className="text-destructive mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h1 className="text-foreground text-lg font-semibold">
              {stale ? "This app was updated" : "Something went wrong"}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {stale
                ? "A newer version was deployed while this tab was open, so part of the app could no longer be loaded. Reloading will pick it up."
                : "This screen failed to load. Your Salesforce data is unaffected — nothing was changed or saved."}
            </p>
          </div>
        </div>

        {/*
          The raw message is shown rather than hidden: the audience is
          administrators and engineers, and "something went wrong" with no
          detail is exactly what makes an issue unreportable.
        */}
        {!stale && (
          <pre className="text-muted-foreground border-border bg-background mb-4 max-h-40 overflow-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed">
            {messageFor(error)}
          </pre>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reload
          </button>
          {/*
            A full navigation, not a client-side Link: if the failure was a
            missing chunk, routing within the stale app would just fail again.
          */}
          <a
            href="/"
            className="border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium"
          >
            Go to Home
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * Last-resort boundary for the layout route itself.
 *
 * If `AppLayout` or the nav is what threw, the child boundary above never
 * mounts, so this one renders standalone — no `Link`, no router-dependent
 * chrome, nothing that could throw a second time while reporting the first.
 */
export function RootError() {
  const error = useRouteError();
  return (
    <div className="bg-background text-foreground min-h-screen px-4 py-16">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-lg font-semibold">ETIC Inspector</h1>
        <p className="text-muted-foreground mb-4 text-sm">
          The application failed to start. Reloading usually resolves it.
        </p>
        <pre className="text-muted-foreground border-border mb-4 max-h-40 overflow-auto rounded-md border p-3 font-mono text-[11px]">
          {messageFor(error)}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
