import { describe, expect, it } from "vitest";
import {
  NO_EDITS,
  cellKey,
  editedColumnsByRow,
  originalsByRow,
  parseOriginals,
  recordEdit,
  recordRewrite,
  revertRow,
  shiftEditsForDeletedRow,
  type EditMap,
} from "./edits";

/** `Map` literal in the shape the module produces, for readable expectations. */
function edits(entries: Record<string, string>): EditMap {
  return new Map(Object.entries(entries));
}

describe("recordEdit", () => {
  it("remembers what the cell held before the first change", () => {
    const after = recordEdit(NO_EDITS, 1, 2, "9000", "9500");
    expect(after.get(cellKey(1, 2))).toBe("9000");
  });

  it("keeps the *first* original through later changes", () => {
    let map = recordEdit(NO_EDITS, 0, 0, "a", "b");
    map = recordEdit(map, 0, 0, "b", "c");
    expect(map.get("0:0")).toBe("a");
  });

  /** The reason originals are stored rather than a set of coordinates. */
  it("un-marks a cell typed back to what it was", () => {
    let map = recordEdit(NO_EDITS, 0, 0, "a", "b");
    map = recordEdit(map, 0, 0, "b", "a");
    expect(map.size).toBe(0);
  });

  it("tracks a cell emptied on purpose, and one filled from empty", () => {
    expect(recordEdit(NO_EDITS, 0, 0, "x", "").get("0:0")).toBe("x");
    expect(recordEdit(NO_EDITS, 0, 0, "", "x").get("0:0")).toBe("");
  });

  /**
   * Identity is load-bearing: a new `Map` on every keystroke re-renders every
   * memoized row in the grid.
   */
  it("returns the same map when nothing about the tracking changed", () => {
    const first = recordEdit(NO_EDITS, 0, 0, "a", "b");
    expect(recordEdit(first, 0, 0, "b", "c")).toBe(first);
    expect(recordEdit(NO_EDITS, 0, 0, "a", "a")).toBe(NO_EDITS);
  });
});

describe("recordRewrite", () => {
  const before = [
    ["$1,200.50", "2026-01-02"],
    ["300", "2026-01-03"],
  ];

  it("records every cell a bulk fix moved", () => {
    const after = [["1200.50", "2026-01-02"], before[1]];
    const map = recordRewrite(NO_EDITS, before, after);
    expect([...map]).toEqual([["0:0", "$1,200.50"]]);
  });

  it("leaves the map alone when the pass changed nothing", () => {
    expect(recordRewrite(NO_EDITS, before, before)).toBe(NO_EDITS);
  });

  it("un-marks a cell a fix put back to its original value", () => {
    const map = edits({ "0:0": "1200.5" });
    const after = [["1200.5", "2026-01-02"], before[1]];
    expect(recordRewrite(map, before, after).size).toBe(0);
  });

  it("keeps the original from the hand edit that came first", () => {
    const map = edits({ "0:0": "1,200.5" });
    const after = [["1200.50", "2026-01-02"], before[1]];
    expect(recordRewrite(map, before, after).get("0:0")).toBe("1,200.5");
  });
});

describe("shiftEditsForDeletedRow", () => {
  /**
   * Without this, deleting row 1 hands row 2's edits to row 3 and a narrowed
   * run writes the wrong cells to the wrong records.
   */
  it("renumbers the rows below the one removed", () => {
    const map = edits({ "0:0": "a", "1:0": "b", "2:1": "c", "3:0": "d" });
    expect([...shiftEditsForDeletedRow(map, 1)].sort()).toEqual([
      ["0:0", "a"],
      ["1:1", "c"],
      ["2:0", "d"],
    ]);
  });

  it("drops the deleted row's own edits", () => {
    expect(shiftEditsForDeletedRow(edits({ "2:0": "x" }), 2).size).toBe(0);
  });

  it("leaves an untouched table untouched", () => {
    expect(shiftEditsForDeletedRow(NO_EDITS, 3)).toBe(NO_EDITS);
  });
});

describe("editedColumnsByRow", () => {
  it("groups by row", () => {
    const map = editedColumnsByRow(
      edits({ "0:1": "a", "0:3": "b", "2:0": "c" }),
    );
    expect([...(map.get(0) ?? [])].sort()).toEqual([1, 3]);
    expect([...(map.get(2) ?? [])]).toEqual([0]);
    expect(map.has(1)).toBe(false);
  });
});

describe("originalsByRow", () => {
  it("round-trips through the primitive the memoized row takes", () => {
    const grouped = originalsByRow(edits({ "1:0": "9000", "1:2": "Edge" }));
    expect(parseOriginals(grouped.get(1) ?? "")).toEqual({
      0: "9000",
      2: "Edge",
    });
  });

  it("leaves rows with no edits out entirely", () => {
    const grouped = originalsByRow(edits({ "1:0": "x" }));
    expect(grouped.has(0)).toBe(false);
    expect(parseOriginals(grouped.get(0) ?? "")).toEqual({});
  });
});

describe("revertRow", () => {
  it("puts every changed cell in the row back", () => {
    const row = ["001", "Edge Ltd", "9500"];
    const result = revertRow(edits({ "0:1": "Edge", "0:2": "9000" }), row, 0);
    expect(result?.row).toEqual(["001", "Edge", "9000"]);
    expect(result?.edits.size).toBe(0);
  });

  it("leaves other rows' edits alone", () => {
    const result = revertRow(edits({ "0:1": "a", "1:1": "b" }), ["x", "y"], 0);
    expect([...(result?.edits ?? [])]).toEqual([["1:1", "b"]]);
  });

  it("restores a cell the user emptied", () => {
    const result = revertRow(edits({ "0:0": "Edge" }), [""], 0);
    expect(result?.row).toEqual(["Edge"]);
  });

  /** Nothing to do — the caller uses null to skip both state updates. */
  it("returns null for a row with no edits", () => {
    expect(revertRow(edits({ "1:0": "x" }), ["a"], 0)).toBeNull();
    expect(revertRow(NO_EDITS, ["a"], 0)).toBeNull();
  });

  it("still clears tracking for a column past the end of a short row", () => {
    const result = revertRow(edits({ "0:5": "x" }), ["a"], 0);
    expect(result?.row).toEqual(["a"]);
    expect(result?.edits.size).toBe(0);
  });
});
