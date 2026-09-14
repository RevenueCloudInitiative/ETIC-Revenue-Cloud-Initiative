import { describe, expect, it } from "vitest";
import type { FieldMetaMap } from "../../../lib/fieldMeta";
import { toImportMutation } from "./toMutation";
import type { ImportOperation, ImportSpec } from "./types";
import { validateImport } from "./validate";
import type { EditMap } from "./edits";
import {
  effectiveScope,
  planCellCount,
  planFields,
  planImport,
  type ImportScope,
} from "./scope";

/* ---- fixtures --------------------------------------------------------- */

function field(
  apiName: string,
  dataType: string,
  extra: Partial<FieldMetaMap[string]> = {},
): FieldMetaMap[string] {
  return {
    apiName,
    label: apiName,
    dataType,
    filterable: true,
    sortable: true,
    updateable: true,
    createable: true,
    required: false,
    length: null,
    compound: false,
    relationshipName: null,
    referenceTo: null,
    ...extra,
  };
}

const meta: FieldMetaMap = {
  Id: field("Id", "Id", { createable: false, updateable: false }),
  Name: field("Name", "String", { length: 255 }),
  NumberOfEmployees: field("NumberOfEmployees", "Int"),
  Founded__c: field("Founded__c", "Date"),
};

const ID_A = "001gK00000TvFw5QAF";
const ID_B = "001gK00000TvFw6QAF";
const ID_C = "001gK00000TvFw7QAF";

/** Id · Name · Employees · Founded, plus an unmapped "Notes" column. */
function spec(
  rows: string[][],
  operation: ImportOperation = "update",
): ImportSpec {
  return {
    objectApiName: "Account",
    operation,
    headers: ["Id", "Name", "Employees", "Founded", "Notes"],
    mapping: ["Id", "Name", "NumberOfEmployees", "Founded__c", null],
    rows,
  };
}

function edits(entries: Record<string, string>): EditMap {
  return new Map(Object.entries(entries));
}

function plan(s: ImportSpec, e: EditMap, scope: ImportScope) {
  return planImport(s, meta, validateImport(s, meta), e, scope);
}

const THREE_ROWS = [
  [ID_A, "Edge", "10008", "2026-01-02", "keep"],
  [ID_B, "Burlington", "9000", "2026-01-03", "keep"],
  [ID_C, "Pyramid", "24", "2026-01-04", "keep"],
];

/* ---- tests ------------------------------------------------------------- */

describe("effectiveScope", () => {
  /**
   * A create needs all its fields, so "only the edited ones" would mean
   * creating records with a single column filled in.
   */
  it("degrades cell scope to row scope on an insert", () => {
    expect(effectiveScope("editedCells", "insert")).toBe("editedRows");
    expect(effectiveScope("editedCells", "update")).toBe("editedCells");
    expect(effectiveScope("all", "insert")).toBe("all");
  });
});

describe("planImport", () => {
  it("sends every ready row, unnarrowed, by default", () => {
    const result = plan(spec(THREE_ROWS), new Map(), "all");
    expect(result.rowIndexes).toEqual([0, 1, 2]);
    expect(result.columnsByRow).toBeNull();
  });

  it("keeps only rows with an edit under row scope", () => {
    const result = plan(
      spec(THREE_ROWS),
      edits({ "1:2": "9000" }),
      "editedRows",
    );
    expect(result.rowIndexes).toEqual([1]);
    // Row scope writes the whole row, so nothing is restricted.
    expect(result.columnsByRow).toBeNull();
  });

  /**
   * The point of the narrowing. Correcting one cell of a 3-row export must not
   * rewrite the other two records, nor the other fields of this one.
   */
  it("keeps only the edited columns under cell scope", () => {
    const result = plan(
      spec(THREE_ROWS),
      edits({ "1:2": "9000" }),
      "editedCells",
    );
    expect(result.rowIndexes).toEqual([1]);
    expect([...(result.columnsByRow?.get(1) ?? [])]).toEqual([2]);
  });

  it("orders rows the way the file does", () => {
    const result = plan(
      spec(THREE_ROWS),
      edits({ "2:1": "x", "0:1": "y" }),
      "editedCells",
    );
    expect(result.rowIndexes).toEqual([0, 2]);
  });

  /**
   * An edit in a column that isn't being imported changes nothing about what
   * would be written, so pulling the row in would write cells the user never
   * touched — the exact thing narrowing exists to prevent.
   */
  it("does not count an edit in an unmapped column", () => {
    const result = plan(
      spec(THREE_ROWS),
      edits({ "1:4": "keep" }),
      "editedRows",
    );
    expect(result.rowIndexes).toEqual([]);
  });

  it("does not count an edit to the Id itself as something to write", () => {
    const result = plan(
      spec(THREE_ROWS),
      edits({ "1:0": ID_A }),
      "editedCells",
    );
    expect(result.rowIndexes).toEqual([]);
  });

  it("still drops a row the validator blocked, under row scope", () => {
    const rows = [
      [ID_A, "Edge", "not-a-number", "2026-01-02", ""],
      [ID_B, "Burlington", "9000", "2026-01-03", ""],
    ];
    const result = plan(
      spec(rows),
      edits({ "0:1": "Edge", "1:1": "Burlington" }),
      "editedRows",
    );
    expect(result.rowIndexes).toEqual([1]);
  });

  /**
   * The interaction that makes cell scope worth building: a row whose only
   * error sits in a column this run will not write is perfectly sendable, and
   * blocking it would leave the user unable to send the cell they just fixed.
   */
  it("sends a row whose error is in a column it isn't writing", () => {
    const rows = [[ID_A, "Edge", "not-a-number", "2026-01-02", ""]];
    const result = plan(
      spec(rows),
      edits({ "0:1": "Old name" }),
      "editedCells",
    );
    expect(result.rowIndexes).toEqual([0]);
    expect([...(result.columnsByRow?.get(0) ?? [])]).toEqual([1]);
  });

  it("still blocks a row whose error is in a column it *is* writing", () => {
    const rows = [[ID_A, "Edge", "not-a-number", "2026-01-02", ""]];
    const result = plan(spec(rows), edits({ "0:2": "9000" }), "editedCells");
    expect(result.rowIndexes).toEqual([]);
  });

  /** The key travels with every row, edited or not, so a bad one always blocks. */
  it("never sends a row with an unusable Id", () => {
    const rows = [["not-an-id", "Edge", "10008", "2026-01-02", ""]];
    const result = plan(
      spec(rows),
      edits({ "0:1": "Old name" }),
      "editedCells",
    );
    expect(result.rowIndexes).toEqual([]);
  });

  it("sends nothing at all while the mapping is broken", () => {
    const broken: ImportSpec = {
      ...spec(THREE_ROWS),
      mapping: ["Id", "Name", "Name", null, null],
    };
    for (const scope of ["all", "editedRows", "editedCells"] as const) {
      expect(plan(broken, edits({ "0:1": "x" }), scope).rowIndexes).toEqual([]);
    }
  });

  it("ignores edits pointing past the end of the table", () => {
    const result = plan(spec(THREE_ROWS), edits({ "9:1": "x" }), "editedRows");
    expect(result.rowIndexes).toEqual([]);
  });
});

describe("planFields", () => {
  it("lists every mapped field but Id when nothing is narrowed", () => {
    const s = spec(THREE_ROWS);
    expect(planFields(s, meta, plan(s, new Map(), "all"))).toEqual([
      "Name",
      "NumberOfEmployees",
      "Founded__c",
    ]);
  });

  /**
   * These are the columns of the before/after report an update produces, so a
   * narrowed run must not read back fields it never wrote.
   */
  it("lists only the narrowed fields, in mapped order", () => {
    const s = spec(THREE_ROWS);
    const narrowed = plan(
      s,
      edits({ "0:3": "2026-01-02", "2:1": "Pyramid" }),
      "editedCells",
    );
    expect(planFields(s, meta, narrowed)).toEqual(["Name", "Founded__c"]);
  });
});

describe("planCellCount", () => {
  it("counts rows times writable columns when unnarrowed", () => {
    const s = spec(THREE_ROWS);
    expect(planCellCount(s, meta, plan(s, new Map(), "all"))).toBe(9);
  });

  it("counts the edited cells when narrowed", () => {
    const s = spec(THREE_ROWS);
    const narrowed = plan(s, edits({ "0:1": "a", "0:2": "b" }), "editedCells");
    expect(planCellCount(s, meta, narrowed)).toBe(2);
  });
});

describe("toImportMutation with a narrowed plan", () => {
  it("writes only the columns the plan allows", () => {
    const s = spec(THREE_ROWS);
    const narrowed = plan(s, edits({ "1:2": "9000" }), "editedCells");
    const { document } = toImportMutation(
      s,
      meta,
      narrowed.rowIndexes,
      narrowed.columnsByRow,
    );
    expect(document).toContain(`Id: "${ID_B}"`);
    expect(document).toContain("NumberOfEmployees: 9000");
    expect(document).not.toContain("Name:");
    expect(document).not.toContain("Founded__c");
  });

  it("still clears a field the user deliberately emptied", () => {
    const rows = [[ID_A, "", "10008", "2026-01-02", ""]];
    const s = spec(rows);
    const narrowed = plan(s, edits({ "0:1": "Edge" }), "editedCells");
    const { document } = toImportMutation(
      s,
      meta,
      narrowed.rowIndexes,
      narrowed.columnsByRow,
    );
    expect(document).toContain("Name: null");
    expect(document).not.toContain("NumberOfEmployees");
  });

  it("writes every mapped column when the plan restricts nothing", () => {
    const s = spec(THREE_ROWS);
    const { document } = toImportMutation(s, meta, [0], null);
    expect(document).toContain("Name:");
    expect(document).toContain("NumberOfEmployees:");
    expect(document).toContain("Founded__c:");
  });
});
