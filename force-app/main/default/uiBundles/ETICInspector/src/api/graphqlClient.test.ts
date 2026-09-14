import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, mutate } = vi.hoisted(() => ({
  query: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("@salesforce/platform-sdk", () => ({
  createDataSDK: () => Promise.resolve({ graphql: { query, mutate } }),
}));

import { executeGraphQL, executeGraphQLRaw } from "./graphqlClient";
import { resetDataFreshness } from "../lib/dataFreshness";

const QUERY = "query Q { uiapi { query { Account { totalCount } } } }";
const MUTATION =
  'mutation M { uiapi { AccountDelete(input: { Id: "1" }) { Id } } }';

/** What the SDK was handed for the most recent read. */
function lastQueryArgs(): Record<string, unknown> {
  return query.mock.calls[query.mock.calls.length - 1][0] as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  query.mockReset();
  mutate.mockReset();
  query.mockResolvedValue({ data: { ok: true }, errors: undefined });
  mutate.mockResolvedValue({ data: { ok: true }, errors: undefined });
  resetDataFreshness();
});

/*
 * The behaviour under test is which reads are allowed to come from the SDK's
 * ~300s cache. Getting it wrong in one direction serves data the org no longer
 * has; getting it wrong in the other silently re-bills the org's daily API
 * limit on every page remount. Neither is visible in the UI, which is why it is
 * pinned here rather than left to a manual check.
 */
describe("cache control", () => {
  it("lets an ordinary read be served from cache", async () => {
    await executeGraphQL(QUERY);
    expect(lastQueryArgs().cacheControl).toBeUndefined();
  });

  it("bypasses the cache when the caller asks for fresh data", async () => {
    await executeGraphQL(QUERY, undefined, { fresh: true });
    expect(lastQueryArgs().cacheControl).toBe("no-cache");
  });

  it("still bypasses after a write, even without `fresh`", async () => {
    // The two reasons are independent: this is the `markDataMutated` path that
    // predates `fresh`, and it must survive `fresh` being absent.
    await executeGraphQLRaw(MUTATION);
    await executeGraphQL(QUERY);
    expect(lastQueryArgs().cacheControl).toBe("no-cache");
  });

  it("treats `fresh: false` as 'cache is fine'", async () => {
    // An explicit false must not be mistaken for a request to bypass — the
    // Users path forwards `init.fresh`, which is undefined for the automatic
    // current-user load and would otherwise re-bill every mount.
    await executeGraphQL(QUERY, undefined, { fresh: false });
    expect(lastQueryArgs().cacheControl).toBeUndefined();
  });
});

describe("operation routing", () => {
  it("sends a mutation to mutate(), not query()", async () => {
    await executeGraphQLRaw(MUTATION);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });

  it("sends an anonymous shorthand operation to query()", async () => {
    await executeGraphQL("{ uiapi { query { Account { totalCount } } } }");
    expect(query).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });
});
