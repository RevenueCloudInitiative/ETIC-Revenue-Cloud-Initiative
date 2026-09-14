import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getOrgId,
  USER_SEARCH_PAGE_SIZE,
  type UserSummary,
} from "../api/users";
import { UserCard } from "../features/inspector/components/UserCard";
import { UserSearchBar } from "../features/inspector/components/UserSearchBar";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useUserSearch } from "../hooks/useUserSearch";
import { Spinner } from "../components/ui/spinner";
import { Banner } from "../components/Banner";
import { PageHeader, PageShell } from "../components/PageShell";
import { sectionLabel, sectionLabelSpaced } from "../components/sectionLabel";

/** One row in the "more than one match" list. */
function ResultRow({
  user,
  onSelect,
}: {
  user: UserSummary;
  onSelect: (user: UserSummary) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(user)}
      className="hover:bg-muted focus:bg-muted flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left outline-none"
    >
      <span className="min-w-0">
        <span className="text-foreground block truncate text-sm font-medium">
          {user.name}
          {!user.isActive && (
            <span className="text-muted-foreground ml-2 text-[11px] font-normal">
              (inactive)
            </span>
          )}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {user.username ?? user.email ?? user.id}
        </span>
      </span>
      {user.profileName && (
        <span className="text-muted-foreground shrink-0 text-xs">
          {user.profileName}
        </span>
      )}
    </button>
  );
}

export default function UsersPage() {
  const { me, loading: meLoading } = useCurrentUser();
  const { status, results, selected, error, search, select, clear } =
    useUserSearch();

  // Needed only to build the Login As URL. Memoized in the api layer, so this
  // costs one call per session no matter how many users you look at.
  const [orgId, setOrgId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getOrgId()
      .then((id) => {
        if (!cancelled) setOrgId(id);
      })
      .catch(() => {
        // Login As degrades to hidden; the Setup links still work.
        if (!cancelled) setOrgId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showList = results.length > 1;
  const searching = status === "loading";
  // A full page means the org had more to give and stopped at the window, so
  // printing "200 matches" would claim a total we never asked it for.
  const capped = results.length >= USER_SEARCH_PAGE_SIZE;

  return (
    <PageShell>
      <PageHeader
        title="Users"
        description="Search by username, email, alias, or name. Press Enter to search."
      />

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        {/* Your own details — never displaced by a search. */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <h2 className={sectionLabelSpaced}>Signed in as</h2>
          {meLoading && (
            <div className="text-muted-foreground border-border bg-card flex items-center justify-center gap-2 rounded-lg border px-4 py-8 text-sm">
              <Spinner />
              Loading…
            </div>
          )}
          {!meLoading && me && (
            <UserCard user={me} orgId={orgId} isSelf compact />
          )}
          {!meLoading && !me && (
            <div className="text-muted-foreground bg-muted/50 border-border rounded-lg border px-4 py-3 text-sm">
              Couldn&apos;t load your user record.
            </div>
          )}
        </aside>

        {/* Search + whoever you looked up. */}
        <section className="min-w-0">
          <div className="mb-4">
            <UserSearchBar loading={searching} onSubmit={search} />
          </div>

          {searching && (
            <div className="text-muted-foreground border-border bg-card flex items-center justify-center gap-2 rounded-lg border px-4 py-12 text-sm">
              <Spinner />
              Searching…
            </div>
          )}

          {status === "error" && error && (
            <Banner tone="destructive">{error}</Banner>
          )}

          {status === "idle" && (
            <div className="text-muted-foreground bg-muted/50 border-border rounded-lg border px-4 py-8 text-center text-sm">
              Search for a user to see their details and log in as them.
            </div>
          )}

          {status === "success" && results.length === 0 && !selected && (
            <div className="text-muted-foreground bg-muted/50 border-border rounded-lg border px-4 py-3 text-sm">
              No users matched that search.
            </div>
          )}

          {status === "success" && showList && (
            <div className="border-border bg-card mb-4 overflow-hidden rounded-lg border">
              <p className="text-muted-foreground bg-muted/40 px-4 py-2 text-xs font-medium">
                {capped
                  ? `First ${results.length} matches, closest first — narrow the search to see the rest`
                  : `${results.length} matches, closest first — pick one`}
              </p>
              {/* Scrolled rather than paged: the ranking puts what you were
                  looking for at the top, so the tail is a fallback, not a
                  second page anyone should have to ask for. */}
              <div className="divide-border/60 max-h-[26rem] divide-y overflow-y-auto">
                {results.map((user) => (
                  <ResultRow key={user.id} user={user} onSelect={select} />
                ))}
              </div>
            </div>
          )}

          {status === "success" && selected && (
            <>
              <div className="mb-2 flex items-center justify-between">
                <h2 className={sectionLabel}>Result</h2>
                <button
                  type="button"
                  onClick={clear}
                  className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-xs"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              </div>
              <UserCard
                user={selected}
                orgId={orgId}
                isSelf={me?.id === selected.id}
              />
            </>
          )}
        </section>
      </div>
    </PageShell>
  );
}
