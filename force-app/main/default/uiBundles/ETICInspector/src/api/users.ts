/**
 * User lookup for the Users tab.
 *
 * These go through GraphQL rather than UI API REST, which is the opposite of
 * the rest of the Inspector. The reason is that there is no permitted REST
 * route that can do any of it:
 *   - `/ui-api/lookups/...` rejects GET (405)
 *   - `/services/data/{v}/connect/organization` is 404 in this org
 *   - the Enterprise `/query` SOQL endpoint is forbidden by AGENT.md — and
 *     unreachable anyway: the proxy allowlists `ui-api`, `graphql`, a few
 *     `connect`/`chatter` paths and `/services/apexrest`, nothing else
 * GraphQL `uiapi` is the only sanctioned way to filter users server-side or to
 * read the org Id, both of which were verified against a live org.
 */
import { executeGraphQL } from "./graphqlClient";
import { InspectorError } from "../lib/errors";
import { rankUserResults } from "../lib/userSearchRank";

/**
 * Per-request options.
 *
 * `fresh` rides here rather than being hardcoded per function because the same
 * two functions serve both kinds of caller: a search or a pasted Id is the user
 * asking for current data, while `getCurrentUser` calling `getUserById` on
 * mount is an automatic read that should still be served from cache. See
 * `GraphQLCallOptions.fresh` in `api/graphqlClient.ts`.
 */
export interface UserRequestInit {
  signal?: AbortSignal;
  fresh?: boolean;
}

/** A user as shown on the Users tab. */
export interface UserSummary {
  id: string;
  name: string;
  username: string | null;
  alias: string | null;
  email: string | null;
  profileName: string | null;
  roleName: string | null;
  language: string | null;
  locale: string | null;
  isActive: boolean;
}

/** Shape of a `{ value }` scalar wrapper in the uiapi GraphQL schema. */
interface Scalar<T> {
  value: T | null;
}

interface UserNode {
  Id: string;
  Name?: Scalar<string> | null;
  Username?: Scalar<string> | null;
  Alias?: Scalar<string> | null;
  Email?: Scalar<string> | null;
  IsActive?: Scalar<boolean> | null;
  Profile?: { Name?: Scalar<string> | null } | null;
  UserRole?: { Name?: Scalar<string> | null } | null;
  LanguageLocaleKey?: Scalar<string> | null;
  LocaleSidKey?: Scalar<string> | null;
}

interface UserQueryResult {
  uiapi?: {
    query?: {
      User?: { edges?: ({ node?: UserNode | null } | null)[] | null } | null;
    } | null;
  } | null;
}

interface CurrentUserResult {
  uiapi?: { currentUser?: { Id?: string | null } | null } | null;
}

interface OrgResult {
  uiapi?: {
    query?: {
      Organization?: {
        edges?: ({ node?: { Id?: string | null } | null } | null)[] | null;
      } | null;
    } | null;
  } | null;
}

/** The field selection shared by every User query, so results are uniform. */
const USER_FIELDS = `
    Id
    Name { value }
    Username { value }
    Alias { value }
    Email { value }
    IsActive { value }
    Profile { Name { value } }
    UserRole { Name { value } }
    LanguageLocaleKey { value }
    LocaleSidKey { value }`;

/**
 * How many matches one search asks the org for.
 *
 * This is a window into an alphabetical list, not a relevance ranking — the
 * org has no idea which match you meant, so it returns the first N by name and
 * `rankUserResults` sorts them afterwards. That makes the window load-bearing:
 * at the old value of 25, a short term like "ma" filled it with `@gmail.com`
 * and `@hotmail.com` addresses before ever reaching Malak, and no amount of
 * client-side sorting can rank a record the org never sent.
 *
 * Widening it costs nothing on the meter — it is one subquery either way, so
 * one API call — only payload. Salesforce caps a subquery at 2,000 records
 * (https://developer.salesforce.com/docs/platform/graphql/guide/query-limits.html);
 * 200 is well under that and is about 80 KB on an explicit, one-per-submit
 * action.
 */
export const USER_SEARCH_PAGE_SIZE = 200;

/**
 * `Email` is its own scalar type in the uiapi schema, so a single `String`
 * variable cannot be reused for the Email predicate — hence two variables
 * carrying the same term.
 */
const SEARCH_USERS = `query SearchUsers($q: String, $qe: Email) {
  uiapi {
    query {
      User(
        where: { or: [
          { Name: { like: $q } },
          { Username: { like: $q } },
          { Alias: { like: $q } },
          { Email: { like: $qe } }
        ] }
        first: ${USER_SEARCH_PAGE_SIZE}
        orderBy: { Name: { order: ASC } }
      ) {
        edges {
          node {${USER_FIELDS}
          }
        }
      }
    }
  }
}`;

const USER_BY_ID = `query UserById($id: ID) {
  uiapi {
    query {
      User(where: { Id: { eq: $id } }, first: 1) {
        edges {
          node {${USER_FIELDS}
          }
        }
      }
    }
  }
}`;

const CURRENT_USER = `query CurrentUser {
  uiapi {
    currentUser {
      Id
    }
  }
}`;

const ORG_ID = `query OrgId {
  uiapi {
    query {
      Organization(first: 1) {
        edges {
          node {
            Id
          }
        }
      }
    }
  }
}`;

function toSummary(node: UserNode): UserSummary {
  return {
    id: node.Id,
    name: node.Name?.value ?? "(unnamed)",
    username: node.Username?.value ?? null,
    alias: node.Alias?.value ?? null,
    email: node.Email?.value ?? null,
    profileName: node.Profile?.Name?.value ?? null,
    roleName: node.UserRole?.Name?.value ?? null,
    language: node.LanguageLocaleKey?.value ?? null,
    locale: node.LocaleSidKey?.value ?? null,
    isActive: node.IsActive?.value ?? false,
  };
}

function edgesToSummaries(result: UserQueryResult): UserSummary[] {
  const edges = result?.uiapi?.query?.User?.edges ?? [];
  return edges
    .map((edge) => edge?.node)
    .filter((node): node is UserNode => Boolean(node?.Id))
    .map(toSummary);
}

/**
 * Escape the LIKE wildcards a user might type so they are matched literally
 * rather than silently widening the search.
 */
function toLikeTerm(term: string): string {
  const escaped = term.trim().replace(/([\\%_])/g, "\\$1");
  return `%${escaped}%`;
}

/**
 * Find users by name, username, alias, or email. One call.
 *
 * Deliberately invoked only on explicit submit (see `useUserSearch`) — a
 * per-keystroke typeahead would bill the org's daily API limit for every
 * mistyped character.
 */
export async function searchUsers(
  term: string,
  init: UserRequestInit = {},
): Promise<UserSummary[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];

  const like = toLikeTerm(trimmed);
  const result = await executeGraphQL<UserQueryResult, Record<string, string>>(
    SEARCH_USERS,
    { q: like, qe: like },
    { fresh: init.fresh },
  );
  if (init.signal?.aborted) return [];
  // Ranked here rather than in the hook so every caller of `searchUsers` gets
  // the same order, and so the term that produced the rows is still in scope.
  return rankUserResults(edgesToSummaries(result), trimmed);
}

/** Load one user by Id. Used when a 005 Id is entered directly. */
export async function getUserById(
  userId: string,
  init: UserRequestInit = {},
): Promise<UserSummary | null> {
  const result = await executeGraphQL<UserQueryResult, Record<string, string>>(
    USER_BY_ID,
    { id: userId },
    { fresh: init.fresh },
  );
  if (init.signal?.aborted) return null;
  return edgesToSummaries(result)[0] ?? null;
}

/**
 * The running user, matching the extension's behaviour of showing you yourself
 * by default. Costs two calls (identity, then detail) because `currentUser`
 * exposes only Id and Name.
 */
export async function getCurrentUser(
  init: UserRequestInit = {},
): Promise<UserSummary | null> {
  const identity = await executeGraphQL<CurrentUserResult, undefined>(
    CURRENT_USER,
  );
  const id = identity?.uiapi?.currentUser?.Id;
  if (!id) return null;
  if (init.signal?.aborted) return null;
  return getUserById(id, init);
}

let _orgIdPromise: Promise<string> | null = null;

/**
 * The org's 18-char Id, needed to build the Login As URL.
 *
 * Memoized for the session: it cannot change while the app is loaded, and the
 * nav bar shows the user their own API consumption, so re-fetching a constant
 * would be a visible waste. A failure clears the memo so a later attempt can
 * retry rather than caching the error forever.
 */
export function getOrgId(): Promise<string> {
  if (!_orgIdPromise) {
    _orgIdPromise = executeGraphQL<OrgResult, undefined>(ORG_ID)
      .then((result) => {
        const id = result?.uiapi?.query?.Organization?.edges?.[0]?.node?.Id;
        if (!id) {
          throw new InspectorError(
            "NOT_FOUND",
            "Could not read the organization Id.",
          );
        }
        return id;
      })
      .catch((error: unknown) => {
        _orgIdPromise = null;
        throw error;
      });
  }
  return _orgIdPromise;
}
