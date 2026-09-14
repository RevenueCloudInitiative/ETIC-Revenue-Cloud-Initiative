import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "../lib/exportFormats";

/**
 * How long the tick stays up after a successful copy.
 *
 * One value, because five hand-rolled copies of this had drifted to three
 * (1200 ms in `IdCopy` and the field grid, 1400 ms in the SOQL preview and the
 * export bar, 1600 ms on the Login As link) with nothing behind the difference.
 */
const RESET_MS = 1400;

/**
 * Copy text, then show "copied" briefly.
 *
 * There were five of these before this hook existed, and they disagreed in ways
 * that were not stylistic:
 *
 * - **Three leaked their timeout.** `QueryPreview`, `ExportBar` and `FieldGrid`
 *   called `setTimeout` with no cleanup, so copying and then navigating away set
 *   state on an unmounted component. `IdCopy` and `UserCard` cleared theirs. The
 *   cleanup lives here now, so a call site cannot get it wrong.
 * - **Three bypassed the shared helper.** `IdCopy`, `UserCard` and `FieldGrid`
 *   called `navigator.clipboard?.writeText(...).then(...)` directly, which means
 *   a rejected write (no permission, insecure context, clipboard blocked by the
 *   OS) threw an unhandled rejection and left the button silently doing nothing.
 *   `copyToClipboard` in `lib/exportFormats.ts` already resolves `false` instead;
 *   everything routes through it now.
 *
 * `token` is what makes this work for the export bar, which has three copy
 * buttons sharing one row and needs to know *which* one was pressed rather than
 * just that something was. Call sites with a single button pass nothing and read
 * `copied` as a boolean via `copied !== null`.
 */
export function useCopyFeedback<T = true>() {
  const [copied, setCopied] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string, token?: T) => {
    // A failed write must not show a tick — the whole point of the confirmation
    // is that the user can stop watching and go paste.
    if (!(await copyToClipboard(text))) return false;

    setCopied((token ?? (true as unknown as T)) as T);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), RESET_MS);
    return true;
  }, []);

  return { copied, copy };
}
