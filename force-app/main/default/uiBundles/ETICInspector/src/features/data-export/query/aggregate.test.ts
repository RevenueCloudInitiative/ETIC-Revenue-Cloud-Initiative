import { describe, expect, it } from "vitest";
import {
  AGGREGATE_DEFAULT_LIMIT,
  AGGREGATE_MAX_LIMIT,
  clampGroupLimit,
  emptyAggregateSpec,
  functionsForType,
  isGroupableType,
  isMeasurableType,
  measureColumnKey,
  groupColumnKey,
  type AggregateSpec,
} from "./aggregate";
import { toAggregateGraphQL } from "./toAggregateGraphQL";
import { toAggregateSoqlOneLine, toAggregateSoqlText } from "./toSoqlText";
import type { FieldMetaMap } from "../../../lib/fieldMeta";

function meta(): FieldMetaMap {
  const base: FieldMetaMap = {};
  const defs: Array<[string, string, string]> = [
    ["Id", "Id", "Record ID"],
    ["Name", "String", "Name"],
    ["Amount", "Currency", "Amount"],
    ["Probability", "Percent", "Probability"],
    ["FiscalYear", "Int", "Fiscal Year"],
    ["IsClosed", "Boolean", "Closed"],
    ["CloseDate", "Date", "Close Date"],
    ["CreatedDate", "DateTime", "Created Date"],
    ["StageName", "Picklist", "Stage"],
    ["AccountId", "Reference", "Account ID"],
    ["Description", "TextArea", "Description"],
  ];
  for (const [apiName, dataType, label] of defs) {
    base[apiName] = {
      apiName,
      label,
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
    };
  }
  return base;
}

function spec(partial: Partial<AggregateSpec> = {}): AggregateSpec {
  return {
    ...emptyAggregateSpec("Opportunity"),
    measures: [{ id: "m1", field: "Id", fn: "count" }],
    ...partial,
  };
}

/*
 * The capability tables are the part of this feature most likely to drift: they
 * were read off `schema.graphql` and confirmed live, and a wrong entry doesn't
 * break one column — it fails the whole document. These lock in the results
 * that are counterintuitive enough that someone would "fix" them by hand.
 */
describe("capability matrix", () => {
  it("gives sum and avg only to the arithmetic types", () => {
    for (const t of ["Currency", "Int", "Double", "Percent", "Long"]) {
      expect(functionsForType(t)).toContain("sum");
      expect(functionsForType(t)).toContain("avg");
    }
    for (const t of ["String", "Picklist", "Date", "DateTime", "Reference"]) {
      expect(functionsForType(t)).not.toContain("sum");
      expect(functionsForType(t)).not.toContain("avg");
      expect(functionsForType(t)).toContain("count");
    }
  });

  it("gives Boolean no functions at all — BooleanAggregate has none", () => {
    expect(functionsForType("Boolean")).toEqual([]);
    expect(isMeasurableType("Boolean")).toBe(false);
    // But it is still a perfectly good dimension.
    expect(isGroupableType("Boolean")).toBe(true);
  });

  it("refuses to group by Currency, Double, Percent or TextArea", () => {
    for (const t of ["Currency", "Double", "Percent", "TextArea"]) {
      expect(isGroupableType(t)).toBe(false);
      // Each of them is still measurable — the two axes are independent.
      expect(isMeasurableType(t)).toBe(true);
    }
  });

  it("treats DateTime as the exact inverse of Boolean", () => {
    // DateTime needs `{ function: CALENDAR_YEAR }`, which this version doesn't
    // emit, so it can be measured but not grouped.
    expect(isGroupableType("DateTime")).toBe(false);
    expect(isMeasurableType("DateTime")).toBe(true);
    // A plain Date field groups normally.
    expect(isGroupableType("Date")).toBe(true);
  });

  it("reports an unknown type as neither, rather than guessing", () => {
    expect(functionsForType("SomeFutureType")).toEqual([]);
    expect(isGroupableType("SomeFutureType")).toBe(false);
  });
});

describe("toAggregateGraphQL — structure", () => {
  it("nests values under node.aggregate, not node", () => {
    const { document } = toAggregateGraphQL(spec(), meta());
    expect(document).toContain("uiapi");
    expect(document).toContain("aggregate");
    expect(document).toMatch(/node\s*\{\s*aggregate\s*\{/);
  });

  it("puts @optional on every field so FLS can't fail the whole document", () => {
    const { document } = toAggregateGraphQL(
      spec({
        groupBy: [{ id: "g1", field: "StageName" }],
        measures: [
          { id: "m1", field: "Id", fn: "count" },
          { id: "m2", field: "Amount", fn: "sum" },
        ],
      }),
      meta(),
    );
    for (const field of ["StageName", "Id", "Amount"]) {
      expect(document).toContain(`${field} @optional {`);
    }
  });

  it("always emits first, and clamps it to the ceiling", () => {
    expect(toAggregateGraphQL(spec(), meta()).document).toContain(
      `first: ${AGGREGATE_DEFAULT_LIMIT}`,
    );
    expect(
      toAggregateGraphQL(spec({ limit: 99999 }), meta()).document,
    ).toContain(`first: ${AGGREGATE_MAX_LIMIT}`);
  });

  it("omits groupBy entirely when there are no dimensions", () => {
    const { document } = toAggregateGraphQL(spec(), meta());
    expect(document).not.toContain("groupBy");
  });

  it("emits every dimension in one groupBy argument", () => {
    const { document } = toAggregateGraphQL(
      spec({
        groupBy: [
          { id: "g1", field: "StageName" },
          { id: "g2", field: "IsClosed" },
        ],
      }),
      meta(),
    );
    expect(document).toContain(
      "groupBy: { StageName: { group: true }, IsClosed: { group: true } }",
    );
  });

  it("never emits orderBy — the schema's OrderByClause has no function", () => {
    const { document } = toAggregateGraphQL(
      spec({ groupBy: [{ id: "g1", field: "StageName" }] }),
      meta(),
    );
    expect(document).not.toContain("orderBy");
  });
});

describe("toAggregateGraphQL — merged selections", () => {
  it("merges a field that is both a dimension and a measure into one selection", () => {
    const { document, columns } = toAggregateGraphQL(
      spec({
        groupBy: [{ id: "g1", field: "StageName" }],
        measures: [{ id: "m1", field: "StageName", fn: "count" }],
      }),
      meta(),
    );
    // Exactly one StageName selection carrying both the value and the function.
    expect(document.match(/StageName @optional/g)).toHaveLength(1);
    expect(document).toContain(
      "StageName @optional { value displayValue count { value displayValue } }",
    );
    // …but two distinct columns, so the table shows both.
    expect(columns.map((c) => c.key)).toEqual([
      groupColumnKey("StageName"),
      measureColumnKey("StageName", "count"),
    ]);
  });

  it("merges several functions on one field", () => {
    const { document } = toAggregateGraphQL(
      spec({
        measures: [
          { id: "m1", field: "Amount", fn: "sum" },
          { id: "m2", field: "Amount", fn: "avg" },
        ],
      }),
      meta(),
    );
    expect(document.match(/Amount @optional/g)).toHaveLength(1);
    expect(document).toContain(
      "Amount @optional { sum { value displayValue } avg { value displayValue } }",
    );
  });

  it("drops a duplicated dimension and a duplicated measure", () => {
    const { columns } = toAggregateGraphQL(
      spec({
        groupBy: [
          { id: "g1", field: "StageName" },
          { id: "g2", field: "StageName" },
        ],
        measures: [
          { id: "m1", field: "Amount", fn: "sum" },
          { id: "m2", field: "Amount", fn: "sum" },
        ],
      }),
      meta(),
    );
    expect(columns).toHaveLength(2);
  });
});

describe("toAggregateGraphQL — columns", () => {
  it("orders dimensions before measures", () => {
    const { columns } = toAggregateGraphQL(
      spec({
        groupBy: [{ id: "g1", field: "StageName" }],
        measures: [{ id: "m1", field: "Amount", fn: "sum" }],
      }),
      meta(),
    );
    expect(columns.map((c) => c.fn)).toEqual([null, "sum"]);
  });

  it("names COUNT(Id) 'Records' rather than 'Count of Record ID'", () => {
    const { columns } = toAggregateGraphQL(spec(), meta());
    expect(columns[0].label).toBe("Records");
  });

  it("labels other measures by function and field label", () => {
    const { columns } = toAggregateGraphQL(
      spec({ measures: [{ id: "m1", field: "Amount", fn: "sum" }] }),
      meta(),
    );
    expect(columns[0].label).toBe("Sum of Amount");
  });
});

describe("toAggregateGraphQL — rejected specs", () => {
  it("refuses an ungroupable dimension before spending a call", () => {
    expect(() =>
      toAggregateGraphQL(
        spec({ groupBy: [{ id: "g1", field: "Amount" }] }),
        meta(),
      ),
    ).toThrow(/can't be grouped by/);
  });

  it("refuses a function the field's type doesn't have", () => {
    expect(() =>
      toAggregateGraphQL(
        spec({ measures: [{ id: "m1", field: "IsClosed", fn: "count" }] }),
        meta(),
      ),
    ).toThrow(/isn't available/);
  });

  it("refuses an empty spec and a missing object", () => {
    expect(() =>
      toAggregateGraphQL(spec({ measures: [], groupBy: [] }), meta()),
    ).toThrow(/at least one measure or grouping/);
    expect(() =>
      toAggregateGraphQL({ ...spec(), objectApiName: "" }, meta()),
    ).toThrow(/Choose an object/);
  });

  it("passes an unknown field through rather than vetoing it locally", () => {
    // Metadata absent — the server is the authority, not the local table.
    expect(() =>
      toAggregateGraphQL(
        spec({ groupBy: [{ id: "g1", field: "Custom__c" }] }),
        {},
      ),
    ).not.toThrow();
  });
});

describe("toAggregateGraphQL — filters", () => {
  it("reuses the row compiler's where clause verbatim", () => {
    const { document } = toAggregateGraphQL(
      spec({
        filters: [
          { id: "f1", field: "IsClosed", operator: "eq", value: "false" },
          { id: "f2", field: "Amount", operator: "gt", value: "1000" },
        ],
      }),
      meta(),
    );
    expect(document).toContain(
      "where: { and: [{ IsClosed: { eq: false } }, { Amount: { gt: 1000 } }] }",
    );
  });

  it("drops a filter with no value, same as the row builder", () => {
    const { document } = toAggregateGraphQL(
      spec({
        filters: [{ id: "f1", field: "StageName", operator: "eq", value: "" }],
      }),
      meta(),
    );
    expect(document).not.toContain("where:");
  });
});

describe("toAggregateSoqlText", () => {
  it("renders a GROUP BY query", () => {
    const text = toAggregateSoqlText(
      spec({
        groupBy: [{ id: "g1", field: "StageName" }],
        measures: [
          { id: "m1", field: "Id", fn: "count" },
          { id: "m2", field: "Amount", fn: "sum" },
        ],
        limit: 150,
      }),
      meta(),
    );
    expect(text).toBe(
      [
        "SELECT StageName, COUNT(Id), SUM(Amount)",
        "FROM Opportunity",
        "GROUP BY StageName",
        "LIMIT 150",
      ].join("\n"),
    );
  });

  it("includes the WHERE clause", () => {
    const text = toAggregateSoqlText(
      spec({
        filters: [
          { id: "f1", field: "StageName", operator: "eq", value: "Closed Won" },
        ],
      }),
      meta(),
    );
    expect(text).toContain("WHERE StageName = 'Closed Won'");
  });

  it("omits GROUP BY when there are no dimensions", () => {
    expect(toAggregateSoqlText(spec(), meta())).not.toContain("GROUP BY");
  });

  it("returns empty text with no object, so the preview stays blank", () => {
    expect(toAggregateSoqlText({ ...spec(), objectApiName: "" }, meta())).toBe(
      "",
    );
  });

  it("collapses to one line for the history list", () => {
    expect(toAggregateSoqlOneLine(spec(), meta())).not.toContain("\n");
  });
});

describe("clampGroupLimit", () => {
  it("bounds the limit and survives an emptied number input", () => {
    expect(clampGroupLimit(50)).toBe(50);
    expect(clampGroupLimit(0)).toBe(1);
    expect(clampGroupLimit(99999)).toBe(AGGREGATE_MAX_LIMIT);
    expect(clampGroupLimit(NaN)).toBe(AGGREGATE_DEFAULT_LIMIT);
  });
});
