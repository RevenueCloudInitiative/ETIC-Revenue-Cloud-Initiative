import { useEffect, useState } from "react";
import { getCurrentUser, type UserSummary } from "../api/users";

interface CurrentUserState {
  me: UserSummary | null;
  loading: boolean;
  error: boolean;
}

/**
 * Memoized for the session. The running user cannot change while the app is
 * loaded, so remounting the page (a tab switch, or StrictMode's double-invoke)
 * must not re-bill the org's daily API limit. A failure clears the memo so a
 * later mount can retry instead of caching the failure forever.
 */
let _mePromise: Promise<UserSummary | null> | null = null;

function loadMe(): Promise<UserSummary | null> {
  if (!_mePromise) {
    _mePromise = getCurrentUser().catch((error: unknown) => {
      _mePromise = null;
      throw error;
    });
  }
  return _mePromise;
}

/** The signed-in user, kept on screen independently of whatever is searched. */
export function useCurrentUser(): CurrentUserState {
  const [state, setState] = useState<CurrentUserState>({
    me: null,
    loading: true,
    error: false,
  });

  useEffect(() => {
    let cancelled = false;
    loadMe()
      .then((me) => {
        if (!cancelled) setState({ me, loading: false, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ me: null, loading: false, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
