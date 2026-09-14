import { beforeEach, describe, expect, it } from "vitest";
import {
  markDataMutated,
  resetDataFreshness,
  SDK_CACHE_TTL_MS,
  shouldBypassCache,
} from "./dataFreshness";

describe("dataFreshness", () => {
  beforeEach(() => resetDataFreshness());

  // A browse-only session must keep the SDK cache, or every documented call
  // count in ARCHITECTURE-QA gets worse for no reason.
  it("does not bypass the cache before anything is written", () => {
    expect(shouldBypassCache()).toBe(false);
  });

  // The reproduced bug: export 2,000 rows, delete them, re-run the same query,
  // and the cache serves the deleted records back.
  it("bypasses the cache immediately after a write", () => {
    markDataMutated(1_000);
    expect(shouldBypassCache(1_000)).toBe(true);
    expect(shouldBypassCache(1_000 + SDK_CACHE_TTL_MS - 1)).toBe(true);
  });

  // Once the entries the write invalidated have expired on their own, normal
  // caching resumes — no bookkeeping, no permanent cost.
  it("stops bypassing once the SDK's own TTL has elapsed", () => {
    markDataMutated(1_000);
    expect(shouldBypassCache(1_000 + SDK_CACHE_TTL_MS)).toBe(false);
    expect(shouldBypassCache(1_000 + SDK_CACHE_TTL_MS + 60_000)).toBe(false);
  });

  it("restarts the window on each subsequent write", () => {
    markDataMutated(1_000);
    markDataMutated(1_000 + SDK_CACHE_TTL_MS + 5_000);
    expect(shouldBypassCache(1_000 + SDK_CACHE_TTL_MS + 5_000)).toBe(true);
  });
});
