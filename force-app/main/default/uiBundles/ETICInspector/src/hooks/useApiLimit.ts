import { useEffect, useState } from "react";
import {
  getLastApiLimit,
  subscribeApiLimit,
  type ApiLimit,
} from "../lib/apiLimit";

/**
 * Live daily API-usage state, sourced from the Sforce-Limit-Info header that
 * rides on every Salesforce response.
 *
 * Deliberately passive: it never issues a request of its own. Priming used to
 * cost a real API call per session purely to populate this widget — in a
 * session where the user inspected nothing, that was the only call the app
 * made. The meter now fills in as soon as the user does something real, and
 * stays hidden until then (or forever, if the surface doesn't expose the
 * header).
 */
export function useApiLimit(): ApiLimit | null {
  const [limit, setLimit] = useState<ApiLimit | null>(() => getLastApiLimit());

  useEffect(() => subscribeApiLimit(setLimit), []);

  return limit;
}
