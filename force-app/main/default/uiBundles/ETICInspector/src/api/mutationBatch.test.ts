import { describe, expect, it, vi } from "vitest";
import {
  attributeErrors,
  outcomeFor,
  runMutationBatches,
  type BatchError,
  type MutationChunk,
} from "./mutationBatch";

const aliases = { r0: 0, r1: 1, r2: 2 };

describe("attributeErrors", () => {
  // The regression this module exists for. Salesforce sends `paths`; the code
  // that read `path` matched nothing, so every failure fell through to the
  // document-level fallback and rows reported each other's reasons.
  it("reads Salesforce's `paths` spelling", () => {
    const errors: BatchError[] = [
      {
        message: "Required fields are missing: [Name]",
        paths: ["uiapi", "r1"],
      },
    ];
    const { byAlias, unattributed } = attributeErrors(errors, aliases);
    expect(byAlias.get("r1")).toBe("Required fields are missing: [Name]");
    expect(unattributed).toEqual([]);
  });

  it("still reads the spec-compliant `path` spelling", () => {
    const errors: BatchError[] = [{ message: "boom", path: ["uiapi", "r0"] }];
    expect(attributeErrors(errors, aliases).byAlias.get("r0")).toBe("boom");
  });

  it("gives two failing rows their own reasons, not a shared one", () => {
    const errors: BatchError[] = [
      {
        message: "Required fields are missing: [Name]",
        paths: ["uiapi", "r0"],
      },
      {
        message: "insufficient access rights on cross-reference id",
        paths: ["uiapi", "r2"],
      },
    ];
    const { byAlias } = attributeErrors(errors, aliases);
    expect(byAlias.get("r0")).toContain("Required fields");
    expect(byAlias.get("r2")).toContain("cross-reference");
  });

  // Every failed operation in an allOrNone:false batch also gets this, which is
  // true but useless as the stated reason a row failed.
  it("prefers the real reason over the rollback notice", () => {
    const errors: BatchError[] = [
      {
        message: "Required fields are missing: [Name]",
        paths: ["uiapi", "r1"],
      },
      {
        message:
          "The transaction was rolled back since another operation in the same transaction failed.",
        paths: ["uiapi", "r1"],
      },
    ];
    expect(attributeErrors(errors, aliases).byAlias.get("r1")).toContain(
      "Required fields",
    );
  });

  it("prefers the real reason even when the rollback notice arrives first", () => {
    const errors: BatchError[] = [
      {
        message: "The transaction was rolled back since it failed.",
        paths: ["uiapi", "r1"],
      },
      { message: "FIELD_CUSTOM_VALIDATION_EXCEPTION", paths: ["uiapi", "r1"] },
    ];
    expect(attributeErrors(errors, aliases).byAlias.get("r1")).toBe(
      "FIELD_CUSTOM_VALIDATION_EXCEPTION",
    );
  });

  it("collects errors that name no alias", () => {
    const errors: BatchError[] = [
      { message: "Limit of 75 reached for number of graphs in Graph Api" },
    ];
    const { byAlias, unattributed } = attributeErrors(errors, aliases);
    expect(byAlias.size).toBe(0);
    expect(unattributed).toEqual([
      "Limit of 75 reached for number of graphs in Graph Api",
    ]);
  });

  it("accepts a Set or a Map of aliases as well as an object", () => {
    const errors: BatchError[] = [{ message: "x", paths: ["uiapi", "r0"] }];
    expect(attributeErrors(errors, new Set(["r0"])).byAlias.get("r0")).toBe(
      "x",
    );
    expect(
      attributeErrors(errors, new Map([["r0", 1]])).byAlias.get("r0"),
    ).toBe("x");
  });

  it("handles no errors at all", () => {
    expect(attributeErrors(undefined, aliases).byAlias.size).toBe(0);
  });
});

describe("outcomeFor", () => {
  const payload = {
    r0: { Record: { Id: "001" } },
    r2: { Record: { Id: "003" } },
  };

  it("reports success when a value came back and nothing named it", () => {
    const result = outcomeFor("r0", payload, attributeErrors([], aliases));
    expect(result.ok).toBe(true);
  });

  it("reports the row's own error when one named it", () => {
    const attributed = attributeErrors(
      [
        {
          message: "Required fields are missing: [Name]",
          paths: ["uiapi", "r1"],
        },
      ],
      aliases,
    );
    const result = outcomeFor("r1", payload, attributed);
    expect(result).toEqual({
      ok: false,
      message: "Required fields are missing: [Name]",
    });
  });

  // A whole-document rejection names nothing, so every row in the chunk has to
  // inherit it rather than be silently reported as neither done nor failed.
  it("falls back to a document-level error", () => {
    const attributed = attributeErrors(
      [{ message: "Limit of 75 reached for number of graphs in Graph Api" }],
      aliases,
    );
    const result = outcomeFor("r1", {}, attributed);
    expect(result).toEqual({
      ok: false,
      message: "Limit of 75 reached for number of graphs in Graph Api",
    });
  });

  it("never claims success when Salesforce returned nothing and said nothing", () => {
    const result = outcomeFor("r1", {}, attributeErrors([], aliases));
    expect(result.ok).toBe(false);
  });
});

describe("runMutationBatches", () => {
  const chunk = (
    document: string,
    aliases: Record<string, number>,
  ): MutationChunk<number> => ({ document, aliases });

  /**
   * The case ARCHITECTURE-QA.md §16 insists on: **two different failures in one
   * batch**. With a single bad record the "couldn't attribute this" fallback
   * happens to be that record's own message, so a broken driver still looks
   * correct. Two failures is the smallest batch that can tell them apart.
   */
  it("attributes two different failures in one chunk to the right rows", async () => {
    const outcomes = new Map<number, string>();

    const { calls, aborted } = await runMutationBatches(
      [chunk("mutation {...}", { r0: 0, r1: 1, r2: 2 })],
      async () => ({
        data: { uiapi: { r1: { Record: { Id: "001" } } } },
        errors: [
          {
            message: "Required fields are missing: [Name]",
            paths: ["uiapi", "r0"],
          },
          {
            message: "insufficient access rights on cross-reference id",
            paths: ["uiapi", "r2"],
          },
        ] as BatchError[],
      }),
      (row, outcome) => {
        outcomes.set(row, outcome.ok ? "ok" : outcome.message);
      },
    );

    expect(calls).toBe(1);
    expect(aborted).toBe(false);
    expect(outcomes.get(0)).toContain("Required fields");
    expect(outcomes.get(1)).toBe("ok");
    expect(outcomes.get(2)).toContain("cross-reference");
  });

  it("runs chunks sequentially and counts one call each", async () => {
    const order: string[] = [];
    const execute = vi.fn(async (document: string) => {
      order.push(`start:${document}`);
      await Promise.resolve();
      order.push(`end:${document}`);
      return { data: { uiapi: { a: { Record: { Id: "001" } } } } };
    });

    const { calls } = await runMutationBatches(
      [chunk("one", { a: 0 }), chunk("two", { a: 1 })],
      execute,
      () => {},
    );

    expect(calls).toBe(2);
    // Interleaving would put "start:two" before "end:one".
    expect(order).toEqual(["start:one", "end:one", "start:two", "end:two"]);
  });

  it("reports progress per chunk", async () => {
    const seen: [number, number][] = [];
    await runMutationBatches(
      [chunk("a", { a: 0 }), chunk("b", { a: 1 }), chunk("c", { a: 2 })],
      async () => ({ data: { uiapi: { a: { Record: { Id: "001" } } } } }),
      () => {},
      { onChunkDone: (done, total) => seen.push([done, total]) },
    );
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("stops before the next chunk once aborted, and doesn't bill for it", async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => {
      controller.abort();
      return { data: { uiapi: { a: { Record: { Id: "001" } } } } };
    });
    const rows: number[] = [];

    const { calls, aborted } = await runMutationBatches(
      [chunk("one", { a: 0 }), chunk("two", { a: 1 })],
      execute,
      (row) => rows.push(row),
      { signal: controller.signal },
    );

    // One request went out, so one call is billed — but its outcomes are
    // dropped, because the abort landed while it was in flight and the caller
    // is no longer looking at them.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(calls).toBe(1);
    expect(aborted).toBe(true);
    expect(rows).toEqual([]);
  });

  it("bills nothing when the signal is already aborted", async () => {
    const execute = vi.fn();
    const { calls, aborted } = await runMutationBatches(
      [chunk("one", { a: 0 })],
      execute,
      () => {},
      { signal: AbortSignal.abort() },
    );
    expect(execute).not.toHaveBeenCalled();
    expect(calls).toBe(0);
    expect(aborted).toBe(true);
  });

  it("gives every row in a chunk the document-level error", async () => {
    const outcomes: string[] = [];
    await runMutationBatches(
      [chunk("one", { r0: 0, r1: 1 })],
      async () => ({
        data: { uiapi: {} },
        errors: [
          { message: "Limit of 75 reached for number of graphs in Graph Api" },
        ] as BatchError[],
      }),
      (_row, outcome) => {
        if (!outcome.ok) outcomes.push(outcome.message);
      },
    );
    expect(outcomes).toEqual([
      "Limit of 75 reached for number of graphs in Graph Api",
      "Limit of 75 reached for number of graphs in Graph Api",
    ]);
  });
});
