import { useCallback } from "react";
import { getUserById, searchUsers, type UserSummary } from "../api/users";
import { toFriendlyMessage } from "../lib/errors";
import { isSalesforceId, isValidIdChecksum } from "../lib/salesforce";
import { useSessionState } from "../lib/sessionState";
import { isAbortError } from "../lib/sfFetch";
import { useInFlight } from "./useInFlight";

interface UserSearchState {
  status: "idle" | "loading" | "success" | "error";
  /** Matches from the last search. Empty for a direct Id or current-user load. */
  results: UserSummary[];
  /** The user currently shown on the card. */
  selected: UserSummary | null;
  error: string | null;
}

export interface UseUserSearch extends UserSearchState {
  search: (term: string) => void;
  select: (user: UserSummary) => void;
  clear: () => void;
}

/**
 * Drives the search half of the Users tab. The signed-in user is deliberately
 * *not* this hook's concern — `useCurrentUser` owns that, so searching for
 * someone else can never displace your own details from the screen.
 *
 * Searching runs only when the user submits — there is no debounced typeahead
 * on purpose. Every request bills the org's daily API limit (which this app
 * shows in the nav bar), and a per-keystroke search charges for each mistyped
 * character and backspace. On submit it costs exactly one call.
 *
 * A new search aborts the previous one, so a fast re-submit doesn't pay twice
 * and an abandoned lookup can never overwrite newer state.
 */
export function useUserSearch(): UseUserSearch {
  // Survives navigation, so coming back to this tab still shows whoever you
  // looked up rather than charging another call to find them again. "loading"
  // is never stored — a search abandoned by leaving the tab is aborted, and
  // restoring it would be a spinner with nothing left to resolve it.
  const [state, setState] = useSessionState<UserSearchState>(
    "users.search",
    { status: "idle", results: [], selected: null, error: null },
    (s) => s.status !== "loading",
  );
  const { begin, finish, abort } = useInFlight();

  const search = useCallback(
    (rawTerm: string) => {
      const term = rawTerm.trim();
      if (!term) return;

      const controller = begin();
      setState((prev) => ({ ...prev, status: "loading", error: null }));

      // A pasted user Id is an exact lookup, not a text search.
      const byId =
        isSalesforceId(term) &&
        isValidIdChecksum(term) &&
        term.startsWith("005");

      // `fresh` because this only ever runs on submit. Re-searching a term you
      // already searched used to cost 0 calls and return whatever the org
      // looked like up to 300s ago — including before a user was created or
      // deactivated by someone else. It now costs 1 and is true.
      const request = byId
        ? getUserById(term, { signal: controller.signal, fresh: true }).then(
            (user) => (user ? [user] : []),
          )
        : searchUsers(term, { signal: controller.signal, fresh: true });

      request
        .then((users) => {
          if (controller.signal.aborted) return;
          setState({
            status: "success",
            results: users,
            // One match is unambiguous — show it rather than making the user
            // click a single-item list.
            selected: users.length === 1 ? users[0] : null,
            error: null,
          });
        })
        .catch((err: unknown) => {
          if (isAbortError(err) || controller.signal.aborted) return;
          setState({
            status: "error",
            results: [],
            selected: null,
            error: toFriendlyMessage(err, { query: term, target: "record" }),
          });
        })
        .finally(() => finish(controller));
    },
    [begin, finish, setState],
  );

  const select = useCallback(
    (user: UserSummary) => {
      setState((prev) => ({ ...prev, selected: user }));
    },
    [setState],
  );

  const clear = useCallback(() => {
    abort();
    setState({ status: "idle", results: [], selected: null, error: null });
  }, [abort, setState]);

  return { ...state, search, select, clear };
}
