/**
 * Prepares dist/ for e2e: an SPA fallback so `npx serve` routes unknown paths
 * to index.html, the way Salesforce does in production (`ui-bundle.json` sets
 * `"fallback": "index.html"`).
 *
 * ## This deliberately does NOT touch index.html
 *
 * It used to also rewrite asset paths from `./assets/…` to `/assets/…`, and
 * that was both unnecessary and actively dangerous.
 *
 * *Unnecessary*: every route in this app is one segment deep (`/users`,
 * `/data-export`, and the `*` catch-all), so a relative `./assets/…` already
 * resolves against `/`. Verified — the full Playwright suite passes with the
 * built file untouched.
 *
 * *Dangerous*: `vite.config.ts` sets `base: './'` because the bundle is served
 * from a path on the `*.my.salesforce.app` origin. Absolute `/assets/…` makes
 * the deployed app fetch its JS from the origin root, find nothing, and render
 * a blank page. Since `dist/` is committed and is the deployed payload, running
 * the e2e build used to leave a broken bundle staged for the next deploy unless
 * someone remembered to rebuild.
 *
 * If a nested route (`/a/b`) is ever added, revisit this — but fix it by
 * setting a proper `base` for the e2e build, not by rewriting built output.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

// SPA fallback so /non-existent-route etc. serve index.html rather than 404ing.
// `serve.json` is config for the e2e static server only; it is inert if it ever
// reaches the org, but a plain `npm run build` clears it out anyway.
writeFileSync(
  join(distDir, "serve.json"),
  JSON.stringify({
    rewrites: [{ source: "**", destination: "/index.html" }],
  }),
);
