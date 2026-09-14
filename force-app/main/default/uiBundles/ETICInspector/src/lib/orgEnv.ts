/**
 * Derive the org "environment" from the current hostname so the nav can show a
 * DEV / SANDBOX / PRODUCTION badge. Pure client-side, no API calls.
 *
 * App-domain patterns (Salesforce Multi-Framework):
 *   Prod:    <domain>--c.my.salesforce.app
 *   Sandbox: <domain>--<sbx>--c.sandbox.my.salesforce.app
 *   Scratch: <domain>--c.scratch.my.salesforce.app
 */

export type OrgTone = "dev" | "scratch" | "sandbox" | "production" | "unknown";

export interface OrgEnv {
  label: string;
  tone: OrgTone;
}

export function getOrgEnv(): OrgEnv {
  const host =
    typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";

  if (!host || host === "localhost" || host === "127.0.0.1") {
    return { label: "DEV", tone: "dev" };
  }
  if (host.includes(".scratch.my.salesforce")) {
    return { label: "SCRATCH", tone: "scratch" };
  }
  if (host.includes(".sandbox.my.salesforce")) {
    return { label: "SANDBOX", tone: "sandbox" };
  }
  if (host.includes(".my.salesforce.") || host.includes("force.com")) {
    return { label: "PRODUCTION", tone: "production" };
  }
  return { label: "ORG", tone: "unknown" };
}

/** Tailwind classes for the badge dot + pill, keyed by tone. */
export function orgToneClasses(tone: OrgTone): { dot: string; pill: string } {
  switch (tone) {
    case "production":
      return {
        dot: "bg-red-500",
        pill: "border-red-200 bg-red-50 text-red-700",
      };
    case "sandbox":
      return {
        dot: "bg-amber-500",
        pill: "border-amber-200 bg-amber-50 text-amber-700",
      };
    case "dev":
    case "scratch":
      return {
        dot: "bg-emerald-500",
        pill: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    default:
      return {
        dot: "bg-muted-foreground",
        pill: "border-border bg-muted text-muted-foreground",
      };
  }
}
