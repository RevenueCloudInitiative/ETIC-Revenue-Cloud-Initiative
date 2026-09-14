import { describe, expect, it } from "vitest";
import { changedFields, diffSnapshots, type ValueSnapshot } from "./changes";

function snapshot(
  entries: Record<string, Record<string, string>>,
): ValueSnapshot {
  return new Map(Object.entries(entries));
}

const rows = [
  { rowIndex: 0, id: "006000000000001AAA" },
  { rowIndex: 1, id: "006000000000002AAA" },
];

describe("diffSnapshots", () => {
  it("reports the fields that moved, and only those", () => {
    const report = diffSnapshots(
      rows,
      snapshot({
        "006000000000001AAA": { Amount: "$125.00", StageName: "Prospecting" },
        "006000000000002AAA": { Amount: "$500.00", StageName: "Prospecting" },
      }),
      snapshot({
        "006000000000001AAA": {
          Amount: "$125,000.00",
          StageName: "Prospecting",
        },
        "006000000000002AAA": { Amount: "$500.00", StageName: "Closed Won" },
      }),
      ["Amount", "StageName"],
    );

    expect(report.changed).toEqual([
      {
        rowIndex: 0,
        id: "006000000000001AAA",
        changes: [{ field: "Amount", before: "$125.00", after: "$125,000.00" }],
      },
      {
        rowIndex: 1,
        id: "006000000000002AAA",
        changes: [
          { field: "StageName", before: "Prospecting", after: "Closed Won" },
        ],
      },
    ]);
    expect(report.unchanged).toBe(0);
  });

  // The usual result of re-running an import, and worth stating rather than
  // presenting as if the run did something.
  it("counts records that came back identical", () => {
    const same = snapshot({
      "006000000000001AAA": { Amount: "$125.00" },
      "006000000000002AAA": { Amount: "$500.00" },
    });
    const report = diffSnapshots(rows, same, same, ["Amount"]);
    expect(report.changed).toEqual([]);
    expect(report.unchanged).toBe(2);
  });

  /*
   * "Nothing changed" and "we couldn't look" are different claims, and only one
   * of them is safe to make. A record missing from either read must never be
   * counted as unchanged.
   */
  it("separates records it couldn't compare from unchanged ones", () => {
    const report = diffSnapshots(
      rows,
      snapshot({ "006000000000001AAA": { Amount: "$125.00" } }),
      snapshot({
        "006000000000001AAA": { Amount: "$125.00" },
        "006000000000002AAA": { Amount: "$500.00" },
      }),
      ["Amount"],
    );
    expect(report.unchanged).toBe(1);
    expect(report.unread).toBe(1);
    expect(report.changed).toEqual([]);
  });

  it("reads a field absent from a snapshot as empty rather than skipping it", () => {
    const report = diffSnapshots(
      [rows[0]],
      snapshot({ "006000000000001AAA": {} }),
      snapshot({ "006000000000001AAA": { Description: "hello" } }),
      ["Description"],
    );
    expect(report.changed[0].changes).toEqual([
      { field: "Description", before: "", after: "hello" },
    ]);
  });

  // A clear on update sends explicit null; the report has to show it as a real
  // change rather than as an absence.
  it("reports a cleared field", () => {
    const report = diffSnapshots(
      [rows[0]],
      snapshot({ "006000000000001AAA": { Description: "hello" } }),
      snapshot({ "006000000000001AAA": { Description: "" } }),
      ["Description"],
    );
    expect(report.changed[0].changes).toEqual([
      { field: "Description", before: "hello", after: "" },
    ]);
  });

  /*
   * Only the fields the import wrote. On an active org other fields move on
   * their own — a formula recalculates, a workflow fires — and attributing
   * those to this import would be a lie.
   */
  it("ignores fields the import didn't write", () => {
    const report = diffSnapshots(
      [rows[0]],
      snapshot({
        "006000000000001AAA": {
          Amount: "$1.00",
          LastModifiedDate: "yesterday",
        },
      }),
      snapshot({
        "006000000000001AAA": { Amount: "$1.00", LastModifiedDate: "today" },
      }),
      ["Amount"],
    );
    expect(report.changed).toEqual([]);
    expect(report.unchanged).toBe(1);
  });
});

describe("changedFields", () => {
  it("lists the fields that moved somewhere, in mapped order", () => {
    const report = diffSnapshots(
      rows,
      snapshot({
        "006000000000001AAA": { Amount: "1", Name: "a", StageName: "x" },
        "006000000000002AAA": { Amount: "2", Name: "b", StageName: "y" },
      }),
      snapshot({
        "006000000000001AAA": { Amount: "9", Name: "a", StageName: "x" },
        "006000000000002AAA": { Amount: "2", Name: "b", StageName: "z" },
      }),
      ["Name", "Amount", "StageName"],
    );
    expect(changedFields(report, ["Name", "Amount", "StageName"])).toEqual([
      "Amount",
      "StageName",
    ]);
  });
});
