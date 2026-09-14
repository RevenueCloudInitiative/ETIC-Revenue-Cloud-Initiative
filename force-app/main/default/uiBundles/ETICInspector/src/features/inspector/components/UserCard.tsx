import {
  Check,
  ExternalLink,
  Link as LinkIcon,
  LogIn,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import type { UserSummary } from "../../../api/users";
import { useCopyFeedback } from "../../../hooks/useCopyFeedback";
import { loginAsUrl, userSetupLinks } from "../../../lib/salesforce";
import { IdCopy } from "./IdCopy";

interface UserCardProps {
  user: UserSummary;
  /**
   * The org's Id. Login As cannot be built without it, so the button stays
   * hidden rather than rendering a link that would fail.
   */
  orgId: string | null;
  /** Logging in as yourself is meaningless, so the button is suppressed. */
  isSelf?: boolean;
  /** Denser padding and type for the sidebar. */
  compact?: boolean;
}

function Row({
  label,
  compact,
  children,
}: {
  label: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        compact
          ? "grid grid-cols-[5rem_1fr] gap-2 py-1"
          : "grid grid-cols-[7.5rem_1fr] gap-2 py-1.5"
      }
    >
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={`text-foreground min-w-0 break-words ${compact ? "text-xs" : "text-sm"}`}
      >
        {children}
      </dd>
    </div>
  );
}

const btn =
  "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium";

/**
 * Empty values render as an em dash rather than hiding the row, matching the
 * Show all data grid. A missing Role is information — a row that silently
 * disappears looks like the app failed to load it.
 */
function Value({ children }: { children: string | null }) {
  if (!children) return <span className="text-muted-foreground">—</span>;
  return <>{children}</>;
}

export function UserCard({ user, orgId, isSelf, compact }: UserCardProps) {
  const setup = userSetupLinks(user.id);
  const suUrl = orgId && !isSelf ? loginAsUrl(orgId, user.id) : null;

  const { copied, copy } = useCopyFeedback();

  const copyLoginAs = () => {
    if (suUrl) copy(suUrl);
  };

  return (
    <div
      className={`border-border bg-card rounded-lg border shadow-sm ${compact ? "p-4" : "p-5"}`}
    >
      <div className="mb-3 flex items-center gap-2">
        <h2
          className={`text-foreground font-bold ${compact ? "text-sm" : "text-lg"}`}
        >
          {user.name}
        </h2>
        {!user.isActive && (
          <span className="rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
            Inactive
          </span>
        )}
      </div>

      <dl className="divide-border/60 divide-y">
        <Row label="Username" compact={compact}>
          <Value>{user.username}</Value>
        </Row>
        <Row label="Id" compact={compact}>
          <span className="font-mono">{user.id}</span>
          <span className="ml-1.5 inline-flex align-middle">
            <IdCopy value={user.id} />
          </span>
        </Row>
        <Row label="E-mail" compact={compact}>
          <Value>{user.email}</Value>
        </Row>
        <Row label="Alias" compact={compact}>
          <Value>{user.alias}</Value>
        </Row>
        <Row label="Profile" compact={compact}>
          <Value>{user.profileName}</Value>
        </Row>
        <Row label="Role" compact={compact}>
          <Value>{user.roleName}</Value>
        </Row>
        <Row label="Language" compact={compact}>
          <span className="font-mono text-[11px]">
            <Value>
              {[user.language, user.locale].filter(Boolean).join(" · ") || null}
            </Value>
          </span>
        </Row>
      </dl>

      <div className="border-border mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
        {suUrl && (
          <>
            <a
              href={suUrl}
              target="_blank"
              rel="noreferrer"
              title="Log in as this user in a new tab"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium"
            >
              <LogIn className="h-3.5 w-3.5" />
              Login As
            </a>
            <button
              type="button"
              onClick={copyLoginAs}
              title="Copy the Login As URL. It only works in a window that is already signed in as you."
              className={btn}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <LinkIcon className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy link"}
            </button>
          </>
        )}

        <a
          href={setup.details}
          target="_blank"
          rel="noreferrer"
          className={btn}
        >
          <UserCog className="h-3.5 w-3.5" />
          Details
          <ExternalLink className="h-3 w-3" />
        </a>
        <a
          href={setup.permSets}
          target="_blank"
          rel="noreferrer"
          title="Permission set assignments for this user"
          className={btn}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Permissions
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
