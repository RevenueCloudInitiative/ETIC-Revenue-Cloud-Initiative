import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";
import salesforce from "@salesforce/vite-plugin-ui-bundle";

/**
 * Dev-only workaround for a bug in `@salesforce/ui-bundle`'s proxy.
 *
 * `getFilteredHeaders()` (proxy/handler.js) strips hop-by-hop headers but keeps
 * `content-length`, then forwards it verbatim alongside a body it re-read and
 * re-serialized itself. When the value arrives duplicated Node collapses it to
 * `"123, 123"`, which undici rejects outright — its validator accepts digits
 * only — so every request carrying a body dies with
 * `InvalidArgumentError: invalid content-length header` and surfaces as a 502
 * that never reaches Salesforce.
 *
 * Deleting the header lets undici compute the correct length from the body it
 * is actually sending. Without this, every POST/PATCH fails locally, which
 * means GraphQL (always a POST) and record saves cannot be tested at all.
 *
 * `apply: 'serve'` keeps this out of builds. It needs `enforce: 'pre'` *and*
 * first position in the plugin array: `@salesforce/vite-plugin-ui-bundle` is
 * itself `enforce: 'pre'`, so a plain plugin registers its middleware after the
 * proxy no matter where it sits in the list.
 */
function stripProxyContentLength(): import("vite").Plugin {
  return {
    name: "strip-proxy-content-length",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          delete req.headers["content-length"];
        }
        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    base: "./",
    plugins: [
      stripProxyContentLength(),
      tailwindcss(),
      react(),
      salesforce(),
    ] as import("vite").PluginOption[],

    // Build configuration for MPA
    build: {
      outDir: resolve(__dirname, "dist"),
      assetsDir: "assets",
      sourcemap: false,
    },

    // Resolve aliases
    //
    // There is deliberately no `test` block here. Vitest is configured by
    // `vitest.config.ts`, which is what `npm test` loads; the block that used
    // to sit below pointed `setupFiles` at `src/test/setup.ts` and excluded
    // `src/main.tsx` from coverage, neither of which has ever existed. Two
    // configs for one runner is how it drifted — add test settings to
    // `vitest.config.ts` only.
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@api": path.resolve(__dirname, "./src/api"),
        "@components": path.resolve(__dirname, "./src/components"),
        "@styles": path.resolve(__dirname, "./src/styles"),
      },
    },
  };
});
