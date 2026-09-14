import { useEffect, useState } from "react";

/**
 * True once something has been loading long enough that the user deserves an
 * explanation rather than just a spinner.
 *
 * The object directory (`api/objectList.ts`) takes **10–20 seconds** on a large
 * org, all of it server-side. A bare spinner is right for the first moment and
 * reads as broken by the tenth second, so the copy beside it earns its place
 * only once the wait stops looking normal — saying "this can take a while"
 * immediately would slander every fast org.
 *
 * Once a wait has run long, the flag stays raised for the rest of the mount and
 * a later wait gets the hint straight away. That is deliberate rather than a
 * missing reset: by then the app has *observed* this org to be slow, so the
 * second wait is a prediction it can make honestly. It also keeps the only
 * `setState` in the timer callback, where `react-hooks/set-state-in-effect`
 * wants it — a synchronous reset in the effect body is what the rule is for.
 */
export function useSlowHint(active: boolean, afterMs = 3_000): boolean {
  const [seenSlow, setSeenSlow] = useState(false);

  useEffect(() => {
    if (!active || seenSlow) return;
    const timer = window.setTimeout(() => setSeenSlow(true), afterMs);
    return () => window.clearTimeout(timer);
  }, [active, seenSlow, afterMs]);

  return active && seenSlow;
}
