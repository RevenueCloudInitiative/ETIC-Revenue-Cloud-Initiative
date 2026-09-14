import { describe, expect, it, vi } from "vitest";
import { createMetadataCache, METADATA_CACHE_TTL_MS } from "./metadataCache";

/** A loader that counts its calls, so "did this hit the network?" is testable. */
function countingLoader<T>(value: T) {
  const calls = { n: 0 };
  return {
    calls,
    load: () => {
      calls.n += 1;
      return Promise.resolve(value);
    },
  };
}

describe("metadataCache", () => {
  it("serves a second read without calling the loader again", async () => {
    const cache = createMetadataCache<string>();
    const { calls, load } = countingLoader("Account");

    expect(await cache.load("Account", load, 1_000)).toBe("Account");
    expect(await cache.load("Account", load, 1_500)).toBe("Account");
    expect(calls.n).toBe(1);
  });

  // The complaint this whole module exists for: a field added in Setup was
  // invisible until the page was reloaded, because nothing ever expired.
  it("reloads once the TTL has elapsed", async () => {
    const cache = createMetadataCache<string>();
    const { calls, load } = countingLoader("Account");

    await cache.load("Account", load, 1_000);
    await cache.load("Account", load, 1_000 + METADATA_CACHE_TTL_MS - 1);
    expect(calls.n).toBe(1);

    await cache.load("Account", load, 1_000 + METADATA_CACHE_TTL_MS);
    expect(calls.n).toBe(2);
  });

  /**
   * The behaviour object metadata gained by moving here. `FieldPicker`'s
   * `toggleExpand` had to be hoisted out of a state updater because StrictMode
   * double-invoked it and a cache that stores only on success cannot stop two
   * concurrent misses from both reaching the network. Now it can.
   */
  it("collapses concurrent misses for the same key into one request", async () => {
    const cache = createMetadataCache<string>();
    let resolve!: (value: string) => void;
    const load = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );

    const first = cache.load("User", load, 1_000);
    const second = cache.load("User", load, 1_000);
    expect(load).toHaveBeenCalledTimes(1);

    resolve("User");
    expect(await first).toBe("User");
    expect(await second).toBe("User");
  });

  it("does not collapse misses for different keys", async () => {
    const cache = createMetadataCache<string>();
    const load = vi.fn((v: string) => Promise.resolve(v));

    await Promise.all([
      cache.load("Account", () => load("Account"), 1_000),
      cache.load("Contact", () => load("Contact"), 1_000),
    ]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  // A failed metadata read must not be remembered as an answer, or one blip
  // would leave the picker empty until the TTL rescued it.
  it("caches nothing when the loader rejects, and retries next time", async () => {
    const cache = createMetadataCache<string>();
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("Account");

    await expect(cache.load("Account", load, 1_000)).rejects.toThrow("boom");
    expect(await cache.load("Account", load, 1_000)).toBe("Account");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reloads a key the user explicitly asked for", async () => {
    const cache = createMetadataCache<string>();
    const { calls, load } = countingLoader("Account");

    await cache.load("Account", load, 1_000);
    cache.requestFresh("Account");
    await cache.load("Account", load, 1_010);
    expect(calls.n).toBe(2);
  });

  it("leaves other keys alone when one is explicitly re-requested", async () => {
    const cache = createMetadataCache<string>();
    const { calls, load } = countingLoader("x");

    await cache.load("Account", load, 1_000);
    await cache.load("Contact", load, 1_000);
    cache.requestFresh("Account");
    await cache.load("Contact", load, 1_010);
    expect(calls.n).toBe(2);
  });

  // Picklists key on `object:recordTypeId`, and asking for an object's current
  // picklists means every record type under it, not just the one on screen.
  it("drops every key beneath a prefix", async () => {
    const cache = createMetadataCache<string>();
    const { calls, load } = countingLoader("v");

    await cache.load("Account:012000000000000AAA", load, 1_000);
    await cache.load("Account:012000000000001AAA", load, 1_000);
    await cache.load("Contact:012000000000000AAA", load, 1_000);
    expect(calls.n).toBe(3);

    cache.invalidatePrefix("Account:");

    await cache.load("Account:012000000000000AAA", load, 1_010);
    await cache.load("Account:012000000000001AAA", load, 1_010);
    expect(calls.n).toBe(5);
    // Contact was never asked about and must still be cached.
    await cache.load("Contact:012000000000000AAA", load, 1_010);
    expect(calls.n).toBe(5);
  });

  it("peeks without fetching", async () => {
    const cache = createMetadataCache<string>();
    const { calls, load } = countingLoader("Account");

    expect(cache.peek("Account", 1_000)).toBeUndefined();
    await cache.load("Account", load, 1_000);
    expect(cache.peek("Account", 1_500)).toBe("Account");
    expect(
      cache.peek("Account", 1_000 + METADATA_CACHE_TTL_MS),
    ).toBeUndefined();
    expect(calls.n).toBe(1);
  });
});
