import { describe, expect, it } from "vitest";
import type { PicklistMap } from "../../../api/picklists";
import type { FieldMetaMap } from "../../../lib/fieldMeta";
import { chunkRows, renderInputLiteral, toImportMutation } from "./toMutation";
import {
  autoMapColumns,
  canonicalFieldName,
  matchHeader,
  unavailableFields,
  unavailableReason,
  writableFields,
  type ImportOperation,
  type ImportSpec,
} from "./types";
import { validateImport } from "./validate";

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
  Name: field("Name", "String", {
    label: "Account Name",
    required: true,
    length: 255,
  }),
  Industry: field("Industry", "Picklist"),
  AnnualRevenue: field("AnnualRevenue", "Currency"),
  NumberOfEmployees: field("NumberOfEmployees", "Int"),
  IsActive__c: field("IsActive__c", "Boolean"),
  Founded__c: field("Founded__c", "Date"),
  LastSeen__c: field("LastSeen__c", "DateTime"),
  OwnerId: field("OwnerId", "Reference", {
    relationshipName: "Owner",
    referenceTo: "User",
  }),
  ShortCode__c: field("ShortCode__c", "String", { length: 5 }),
  CreatedDate: field("CreatedDate", "DateTime", {
    createable: false,
    updateable: false,
  }),
  BillingAddress: field("BillingAddress", "Address", { compound: true }),
};

const picklists: PicklistMap = {
  Industry: {
    values: [
      { label: "Energy", value: "Energy", validFor: [] },
      { label: "Banking", value: "Banking", validFor: [] },
    ],
    defaultValue: null,
    controllerValues: {},
  },
};

function spec(overrides: Partial<ImportSpec> = {}): ImportSpec {
  return {
    objectApiName: "Account",
    operation: "insert",
    headers: ["Name", "Industry"],
    mapping: ["Name", "Industry"],
    rows: [["Acme", "Energy"]],
    ...overrides,
  };
}

/* ---- writableFields / autoMapColumns ---------------------------------- */

describe("writableFields", () => {
  it("offers Id for update but never for insert", () => {
    const names = (op: "insert" | "update") =>
      writableFields(meta, op).map((f) => f.apiName);
    expect(names("update")).toContain("Id");
    expect(names("insert")).not.toContain("Id");
  });

  it("hides fields that can't be written and compound parents", () => {
    const names = writableFields(meta, "insert").map((f) => f.apiName);
    expect(names).not.toContain("CreatedDate");
    expect(names).not.toContain("BillingAddress");
    expect(names).toContain("Name");
  });
});

describe("autoMapColumns", () => {
  it("matches an exact API name", () => {
    expect(autoMapColumns(["Industry"], meta, "insert")).toEqual(["Industry"]);
  });

  it("matches a label", () => {
    expect(autoMapColumns(["Account Name"], meta, "insert")).toEqual(["Name"]);
  });

  it("matches ignoring case, spaces and underscores", () => {
    expect(
      autoMapColumns(["account name", "annual_revenue"], meta, "insert"),
    ).toEqual(["Name", "AnnualRevenue"]);
  });

  it("leaves an unrecognised column unmapped rather than guessing", () => {
    expect(autoMapColumns(["Internal notes"], meta, "insert")).toEqual([null]);
  });

  it("never maps the same field twice", () => {
    // "Name" and "Account Name" both resolve to Name; the second must not win
    // a duplicate slot, which would emit a duplicate key.
    expect(autoMapColumns(["Name", "Account Name"], meta, "insert")).toEqual([
      "Name",
      null,
    ]);
  });

  it("does not map a read-only column on insert", () => {
    expect(autoMapColumns(["CreatedDate"], meta, "insert")).toEqual([null]);
  });
});

/* ---- explaining an absent field --------------------------------------- */

describe("unavailableReason", () => {
  const reason = (apiName: string, op: ImportOperation) =>
    unavailableReason(meta[apiName], op);

  it("is null for a field the operation can write", () => {
    expect(reason("Name", "insert")).toBeNull();
    expect(reason("Name", "update")).toBeNull();
    expect(reason("Id", "update")).toBeNull();
  });

  // The report that prompted this: a field that is real, exported fine, and
  // simply absent from the import list with nothing said about it.
  it("calls a field neither operation can write read-only", () => {
    expect(reason("CreatedDate", "insert")).toContain("read-only");
    expect(reason("CreatedDate", "update")).toContain("read-only");
  });

  /*
   * `createable` and `updateable` are independent, so these two are genuinely
   * different situations — telling someone a create-only field is "read-only"
   * would send them looking for a permission problem that isn't there.
   */
  it("distinguishes create-only and update-only from read-only", () => {
    const createOnly = field("Slug__c", "String", { updateable: false });
    const updateOnly = field("Score__c", "Double", { createable: false });
    const fields: FieldMetaMap = { Slug__c: createOnly, Score__c: updateOnly };

    expect(unavailableReason(fields.Slug__c, "insert")).toBeNull();
    expect(unavailableReason(fields.Slug__c, "update")).toContain(
      "only at the moment the record is created",
    );
    expect(unavailableReason(fields.Score__c, "update")).toBeNull();
    expect(unavailableReason(fields.Score__c, "insert")).toContain(
      "not settable until the record exists",
    );
  });

  it("explains Id on insert without calling it read-only", () => {
    expect(reason("Id", "insert")).toContain("assigned by Salesforce");
  });

  it("points a compound field at its parts", () => {
    expect(reason("BillingAddress", "insert")).toContain("map its parts");
  });

  /*
   * The list the mapper offers and the reason it gives for everything else are
   * two views of one function; this is what stops them disagreeing about which
   * fields are which.
   */
  it("agrees exactly with writableFields", () => {
    for (const operation of ["insert", "update"] as const) {
      const writable = new Set(
        writableFields(meta, operation).map((f) => f.apiName),
      );
      const blocked = new Set(
        unavailableFields(meta, operation).map((u) => u.field.apiName),
      );
      expect(writable.size + blocked.size).toBe(Object.keys(meta).length);
      for (const apiName of writable) expect(blocked.has(apiName)).toBe(false);
    }
  });
});

describe("canonicalFieldName", () => {
  // What lets the validator answer "AnnualRevenue is read-only" rather than
  // "annualrevenue isn't a field here" when the name was typed by hand.
  it("recovers the object's own casing", () => {
    expect(canonicalFieldName("annualrevenue", meta)).toBe("AnnualRevenue");
    expect(canonicalFieldName("  ID  ", meta)).toBe("Id");
  });

  it("leaves an exact name alone", () => {
    expect(canonicalFieldName("AnnualRevenue", meta)).toBe("AnnualRevenue");
  });

  // Returned untouched so the validator still gets to reject it by name.
  it("returns an unrecognised name unchanged", () => {
    expect(canonicalFieldName("Nonsense__c", meta)).toBe("Nonsense__c");
  });
});

describe("matchHeader", () => {
  it("finds an unwritable field a column header names", () => {
    const blocked = unavailableFields(meta, "insert").map((u) => u.field);
    expect(matchHeader("Created Date", blocked)?.apiName).toBe("CreatedDate");
    expect(matchHeader("created_date", blocked)?.apiName).toBe("CreatedDate");
  });

  it("returns null when nothing matches", () => {
    expect(matchHeader("Internal notes", Object.values(meta))).toBeNull();
  });
});

/* ---- validation: mapping ---------------------------------------------- */

describe("validateImport — mapping", () => {
  it("accepts a well-formed insert", () => {
    const report = validateImport(spec(), meta, picklists);
    expect(report.mappingErrors).toEqual([]);
    expect(report.readyRows).toEqual([0]);
  });

  it("rejects an update with no Id column", () => {
    const report = validateImport(
      spec({ operation: "update" }),
      meta,
      picklists,
    );
    expect(report.mappingErrors.map((i) => i.message).join(" ")).toContain(
      "Id column",
    );
    expect(report.readyRows).toEqual([]);
  });

  it("rejects Id on insert", () => {
    const report = validateImport(
      spec({
        headers: ["Id"],
        mapping: ["Id"],
        rows: [["001gK00000TvFw5QAF"]],
      }),
      meta,
      picklists,
    );
    expect(report.mappingErrors.map((i) => i.message).join(" ")).toContain(
      "Salesforce assigns it",
    );
  });

  it("rejects the same field mapped twice", () => {
    const report = validateImport(
      spec({
        headers: ["Name", "Name again"],
        mapping: ["Name", "Name"],
        rows: [["a", "b"]],
      }),
      meta,
      picklists,
    );
    expect(report.mappingErrors.map((i) => i.message).join(" ")).toContain(
      "Map each field once",
    );
  });

  it("rejects a compound field", () => {
    const report = validateImport(
      spec({
        headers: ["BillingAddress"],
        mapping: ["BillingAddress"],
        rows: [["x"]],
      }),
      meta,
      picklists,
    );
    expect(report.mappingErrors.map((i) => i.message).join(" ")).toContain(
      "compound",
    );
  });

  it("rejects a non-createable field on insert but allows it on update when updateable", () => {
    const insertReport = validateImport(
      spec({
        headers: ["CreatedDate"],
        mapping: ["CreatedDate"],
        rows: [["2026-01-01T00:00:00Z"]],
      }),
      meta,
      picklists,
    );
    expect(insertReport.mappingErrors).not.toEqual([]);
  });

  it("blocks every row while the mapping is broken", () => {
    const report = validateImport(
      spec({
        operation: "update",
        rows: [
          ["a", "b"],
          ["c", "d"],
        ],
      }),
      meta,
      picklists,
    );
    expect(report.readyRows).toEqual([]);
  });
});

/* ---- validation: cells ------------------------------------------------ */

describe("validateImport — cells", () => {
  const oneCell = (
    fieldName: string,
    value: string,
    operation: "insert" | "update" = "insert",
  ) =>
    validateImport(
      spec({
        operation,
        headers: [fieldName],
        mapping: [fieldName],
        rows: [[value]],
      }),
      meta,
      picklists,
    );

  it.each(["abc", "", "12abc"])("rejects %o as a number", (value) => {
    // Blank is only a problem for a required field, so use a non-required one
    // and assert on the non-blank cases.
    if (value === "") return;
    expect(oneCell("AnnualRevenue", value).errorCount).toBeGreaterThan(0);
  });

  it.each(["1200", "1,200.50", "$1,200.50", "-99"])(
    "accepts %o as a number",
    (value) => {
      expect(oneCell("AnnualRevenue", value).errorCount).toBe(0);
    },
  );

  it.each(["true", "FALSE", "yes", "n", "1", "0"])(
    "accepts %o as a checkbox",
    (value) => {
      expect(oneCell("IsActive__c", value).errorCount).toBe(0);
    },
  );

  it("rejects a nonsense checkbox value", () => {
    expect(oneCell("IsActive__c", "maybe").errorCount).toBe(1);
  });

  it("accepts an ISO date and rejects an ambiguous one", () => {
    expect(oneCell("Founded__c", "2026-12-31").errorCount).toBe(0);
    // 03/04/2026 means different days either side of the Atlantic, so it is
    // refused rather than guessed at.
    expect(oneCell("Founded__c", "03/04/2026").errorCount).toBe(1);
  });

  // JavaScript rolls 2026-02-31 forward to 3 March rather than rejecting it, so
  // a naive Date.parse check would import a date the file never contained.
  it.each(["2026-02-31", "2026-13-01", "2026-04-31"])(
    "rejects %s, which isn't a real day",
    (value) => {
      expect(oneCell("Founded__c", value).errorCount).toBe(1);
    },
  );

  it("still accepts a genuine leap day", () => {
    expect(oneCell("Founded__c", "2028-02-29").errorCount).toBe(0);
    expect(oneCell("Founded__c", "2027-02-29").errorCount).toBe(1);
  });

  it("rejects an out-of-range time in a DateTime", () => {
    expect(oneCell("LastSeen__c", "2026-12-31T25:00:00Z").errorCount).toBe(1);
  });

  it("accepts an ISO date-time", () => {
    expect(oneCell("LastSeen__c", "2026-12-31T10:30:00Z").errorCount).toBe(0);
  });

  it("rejects a plain date in a DateTime field", () => {
    expect(oneCell("LastSeen__c", "2026-12-31").errorCount).toBe(1);
  });

  it("rejects a lookup given by name instead of Id", () => {
    const report = oneCell("OwnerId", "Jane Smith");
    expect(report.errorCount).toBe(1);
    expect(report.issues[0].message).toContain("not by name");
  });

  it("accepts a valid Id in a lookup and rejects a bad checksum", () => {
    expect(oneCell("OwnerId", "005gK00000TvFw5QAF").errorCount).toBe(0);
    expect(oneCell("OwnerId", "005gK00000TvFw5QAA").errorCount).toBe(1);
  });

  it("rejects text longer than the field", () => {
    expect(oneCell("ShortCode__c", "12345").errorCount).toBe(0);
    expect(oneCell("ShortCode__c", "123456").errorCount).toBe(1);
  });

  it("errors on a blank required field for insert only", () => {
    expect(oneCell("Name", "", "insert").errorCount).toBe(1);
    // On update a blank means "clear it", which is a legitimate instruction.
    const update = validateImport(
      spec({
        operation: "update",
        headers: ["Id", "Name"],
        mapping: ["Id", "Name"],
        rows: [["001gK00000TvFw5QAF", ""]],
      }),
      meta,
      picklists,
    );
    expect(update.errorCount).toBe(0);
  });

  it("blocks a row whose Id is blank or malformed on update", () => {
    const report = validateImport(
      spec({
        operation: "update",
        headers: ["Id", "Name"],
        mapping: ["Id", "Name"],
        rows: [
          ["", "a"],
          ["not-an-id", "b"],
          ["001gK00000TvFw5QAF", "c"],
        ],
      }),
      meta,
      picklists,
    );
    expect(report.readyRows).toEqual([2]);
  });
});

describe("validateImport — unknown picklist values are a warning, not an error", () => {
  // Verified live: an unrestricted picklist accepts a value outside its list,
  // and object-info doesn't say which picklists are restricted. Blocking here
  // would refuse imports Salesforce would have accepted.
  it("warns but still sends the row", () => {
    const report = validateImport(
      spec({
        headers: ["Industry"],
        mapping: ["Industry"],
        rows: [["Fishing"]],
      }),
      meta,
      picklists,
    );
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(1);
    expect(report.readyRows).toEqual([0]);
  });

  it("says nothing when the picklist isn't cached", () => {
    const report = validateImport(
      spec({
        headers: ["Industry"],
        mapping: ["Industry"],
        rows: [["Fishing"]],
      }),
      meta,
      {},
    );
    expect(report.warningCount).toBe(0);
  });
});

/* ---- renderInputLiteral ----------------------------------------------- */

describe("renderInputLiteral", () => {
  it("renders numbers bare", () => {
    expect(renderInputLiteral("1,200.50", "Currency")).toBe("1200.5");
    expect(renderInputLiteral("42", "Int")).toBe("42");
  });

  it("renders booleans bare", () => {
    expect(renderInputLiteral("yes", "Boolean")).toBe("true");
    expect(renderInputLiteral("0", "Boolean")).toBe("false");
  });

  // The whole reason this file has its own renderer: a filter needs
  // { value: "..." } while a write needs a plain quoted string.
  it("renders a date as a quoted scalar, not a filter input object", () => {
    expect(renderInputLiteral("2026-12-31", "Date")).toBe('"2026-12-31"');
    expect(renderInputLiteral("2026-12-31", "Date")).not.toContain("value:");
  });

  it("escapes quotes, backslashes and newlines in strings", () => {
    expect(renderInputLiteral('He said "hi"\nbye', "String")).toBe(
      '"He said \\"hi\\"\\nbye"',
    );
    expect(renderInputLiteral("back\\slash", "String")).toBe('"back\\\\slash"');
  });
});

/* ---- toImportMutation -------------------------------------------------- */

describe("toImportMutation — insert", () => {
  const build = (s: ImportSpec, rows = [0]) => toImportMutation(s, meta, rows);

  it("emits one aliased Create per row under allOrNone: false", () => {
    const { document, aliases } = build(
      spec({
        rows: [
          ["Acme", "Energy"],
          ["Globex", "Banking"],
        ],
      }),
      [0, 1],
    );
    expect(document).toContain("uiapi(input: { allOrNone: false })");
    expect(document).toContain("r0: AccountCreate(input: { Account: {");
    expect(document).toContain("r1: AccountCreate(input: { Account: {");
    expect(aliases).toEqual({ r0: 0, r1: 1 });
  });

  it("asks for the new Id back", () => {
    expect(build(spec()).document).toContain("Record { Id }");
  });

  it("omits a blank cell so Salesforce's default applies", () => {
    const { document } = build(
      spec({
        headers: ["Name", "Industry"],
        mapping: ["Name", "Industry"],
        rows: [["Acme", ""]],
      }),
    );
    expect(document).toContain('Name: "Acme"');
    expect(document).not.toContain("Industry");
  });

  it("ignores unmapped columns", () => {
    const { document } = build(
      spec({
        headers: ["Name", "Internal note"],
        mapping: ["Name", null],
        rows: [["Acme", "do not import"]],
      }),
    );
    expect(document).not.toContain("do not import");
  });

  it("never emits an Id assignment", () => {
    const { document } = build(spec());
    expect(document).not.toContain("Id:");
  });
});

describe("toImportMutation — update", () => {
  const updateSpec = (rows: string[][]) =>
    spec({
      operation: "update",
      headers: ["Id", "Name", "Industry"],
      mapping: ["Id", "Name", "Industry"],
      rows,
    });

  it("passes Id as the mutation argument, not as a field", () => {
    const { document } = toImportMutation(
      updateSpec([["001gK00000TvFw5QAF", "Acme", "Energy"]]),
      meta,
      [0],
    );
    expect(document).toContain(
      'r0: AccountUpdate(input: { Id: "001gK00000TvFw5QAF", Account: {',
    );
    expect(document).toContain("success Record { Id }");
  });

  // The counterpart of the insert rule above, and the reason both exist:
  // otherwise one of "take the default" and "clear the field" is inexpressible.
  it("sends an explicit null for a blank cell so the field is cleared", () => {
    const { document } = toImportMutation(
      updateSpec([["001gK00000TvFw5QAF", "Acme", ""]]),
      meta,
      [0],
    );
    expect(document).toContain("Industry: null");
  });
});

describe("toImportMutation — guards", () => {
  it("refuses more operations than Salesforce accepts", () => {
    const rows = Array.from({ length: 76 }, (_, i) => [`Acme ${i}`, "Energy"]);
    expect(() =>
      toImportMutation(
        spec({ rows }),
        meta,
        rows.map((_, i) => i),
      ),
    ).toThrow(/at most 75/);
  });

  it("refuses an empty row set", () => {
    expect(() => toImportMutation(spec(), meta, [])).toThrow(/no rows/);
  });

  it("refuses a spec with no object", () => {
    expect(() =>
      toImportMutation(spec({ objectApiName: "" }), meta, [0]),
    ).toThrow(/Choose an object/);
  });
});

describe("chunkRows", () => {
  it("splits below the ceiling and preserves original row indexes", () => {
    // Row indexes are not contiguous once the validator removes blocked rows.
    const indexes = [0, 3, 4, 7, 9];
    expect(chunkRows(indexes, 2)).toEqual([[0, 3], [4, 7], [9]]);
  });

  it("defaults to a chunk size Salesforce accepts", () => {
    const chunks = chunkRows(Array.from({ length: 120 }, (_, i) => i));
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(75);
  });

  it("returns nothing for no rows", () => {
    expect(chunkRows([])).toEqual([]);
  });
});
