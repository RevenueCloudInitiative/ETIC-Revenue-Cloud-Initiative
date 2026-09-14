import { describe, expect, it } from "vitest";
import {
  chunkIds,
  DELETE_CHUNK_SIZE,
  toDeleteMutation,
  toGraphQL,
} from "./toGraphQL";
import { toSoqlOneLine, toSoqlText } from "./toSoqlText";
import {
  DEFAULT_LIMIT,
  emptySpec,
  MAX_LIMIT,
  operatorsForType,
  resolveFieldPath,
  type QuerySpec,
} from "./types";
import type { FieldMetaMap } from "../../../lib/fieldMeta";

function meta(
  overrides: Record<string, Partial<FieldMetaMap[string]>> = {},
): FieldMetaMap {
  const base: FieldMetaMap = {};
  const defs: Array<[string, string]> = [
    ["Name", "String"],
    ["Description", "TextArea"],
    ["Amount", "Currency"],
    ["Probability", "Percent"],
    ["IsClosed", "Boolean"],
    ["CloseDate", "Date"],
    ["CreatedDate", "DateTime"],
    ["StageName", "Picklist"],
    ["OwnerId", "Reference"],
    ["BillingAddress", "Address"],
  ];
  for (const [apiName, dataType] of defs) {
    base[apiName] = {
      apiName,
      label: apiName,
      dataType,
      filterable: true,
      sortable: true,
      updateable: true,
      createable: true,
      required: false,
      length: null,
      compound: dataType === "Address",
      relationshipName: null,
      referenceTo: null,
      ...overrides[apiName],
    };
  }
  return base;
}

/**
 * The compilers take the whole `metaByObject` map and read the queried object
 * out of it, so a single-object fixture is wrapped rather than passed bare.
 */
function metaMap(
  overrides: Record<string, Partial<FieldMetaMap[string]>> = {},
): Record<string, FieldMetaMap> {
  return { Opportunity: meta(overrides) };
}

/**
 * Opportunity with two traversable references and one polymorphic one, plus
 * the metadata for the objects they point at — the shape `metaByObject` has on
 * the page once the user has expanded a relationship.
 */
function relatedMeta(): Record<string, FieldMetaMap> {
  const field = (
    apiName: string,
    dataType: string,
    extra: Partial<FieldMetaMap[string]> = {},
  ): FieldMetaMap[string] => ({
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
  });

  return {
    Opportunity: {
      ...meta(),
      AccountId: field("AccountId", "Reference", {
        label: "Account ID",
        relationshipName: "Account",
        referenceTo: "Account",
      }),
      OwnerId: field("OwnerId", "Reference", {
        relationshipName: "Owner",
        referenceTo: "User",
      }),
      // Polymorphic — object-info reports two referenceToInfos, so the data
      // layer leaves it non-traversable.
      WhoId: field("WhoId", "Reference"),
    },
    Account: {
      Name: field("Name", "String"),
      Industry: field("Industry", "Picklist"),
      AnnualRevenue: field("AnnualRevenue", "Currency"),
      OwnerId: field("OwnerId", "Reference", {
        relationshipName: "Owner",
        referenceTo: "User",
      }),
    },
    User: { Name: field("Name", "String") },
  };
}

function spec(partial: Partial<QuerySpec> = {}): QuerySpec {
  return { ...emptySpec("Opportunity"), fields: ["Name"], ...partial };
}

/*
 * Parent traversal. The whole point is that an export shows "Dickenson plc"
 * rather than "001gK00000TvFw8QAF" — a reference field's own value is the Id,
 * and the name lives on the object it points at.
 */
describe("parent field traversal", () => {
  it("groups sibling parent fields into a single relationship block", () => {
    const { document } = toGraphQL(
      spec({ fields: ["Name", "Account.Name", "Account.Industry"] }),
      relatedMeta(),
    );
    // One Account block, not two.
    expect(document.match(/Account @optional \{/g)).toHaveLength(1);
    expect(document).toMatch(
      /Account @optional \{\s*\n\s*Name @optional \{ value displayValue \}\s*\n\s*Industry @optional \{ value displayValue \}\s*\n\s*\}/,
    );
  });

  it("nests to a second level", () => {
    const { document } = toGraphQL(
      spec({ fields: ["Account.Owner.Name"] }),
      relatedMeta(),
    );
    expect(document).toMatch(
      /Account @optional \{\s*\n\s*Owner @optional \{\s*\n\s*Name @optional \{ value displayValue \}/,
    );
  });

  it("puts @optional on the relationship node, not just its fields", () => {
    // A parent the user can't read must drop that column, not fail the row.
    const { document } = toGraphQL(
      spec({ fields: ["Account.Name"] }),
      relatedMeta(),
    );
    expect(document).toContain("Account @optional {");
  });

  it("keeps Id a bare scalar inside a parent block", () => {
    const { document } = toGraphQL(
      spec({ fields: ["Account.Id"] }),
      relatedMeta(),
    );
    expect(document).toMatch(/Account @optional \{\s*\n\s*Id\s*\n/);
    expect(document).not.toMatch(/Id @optional/);
  });

  it("keeps parent paths as columns", () => {
    const { columns } = toGraphQL(
      spec({ fields: ["Name", "Account.Name"] }),
      relatedMeta(),
    );
    expect(columns).toEqual(["Name", "Account.Name"]);
  });

  it("nests a filter on a parent field", () => {
    const { document } = toGraphQL(
      spec({
        fields: ["Name"],
        filters: [
          { id: "f1", field: "Account.Name", operator: "like", value: "Acme" },
        ],
      }),
      relatedMeta(),
    );
    expect(document).toContain(
      'where: { Account: { Name: { like: "%Acme%" } } }',
    );
  });

  it("types a parent filter literal from the parent object's metadata", () => {
    // AnnualRevenue is Currency on Account — a bare number, not a quoted string.
    const { document } = toGraphQL(
      spec({
        fields: ["Name"],
        filters: [
          {
            id: "f1",
            field: "Account.AnnualRevenue",
            operator: "gt",
            value: "1000",
          },
        ],
      }),
      relatedMeta(),
    );
    expect(document).toContain(
      "where: { Account: { AnnualRevenue: { gt: 1000 } } }",
    );
  });

  it("nests orderBy on a parent field", () => {
    const { document } = toGraphQL(
      spec({
        fields: ["Name"],
        orderBy: { field: "Account.Name", direction: "DESC" },
      }),
      relatedMeta(),
    );
    expect(document).toContain(
      "orderBy: { Account: { Name: { order: DESC } } }",
    );
  });

  it("leaves a plain field unnested", () => {
    const { document } = toGraphQL(
      spec({
        fields: ["Name"],
        orderBy: { field: "Name", direction: "ASC" },
        filters: [{ id: "f1", field: "Name", operator: "eq", value: "x" }],
      }),
      relatedMeta(),
    );
    expect(document).toContain('where: { Name: { eq: "x" } }');
    expect(document).toContain("orderBy: { Name: { order: ASC } }");
  });

  it("renders parent paths verbatim in the SOQL preview", () => {
    // Dotted paths are already valid SOQL, so this needs no translation.
    const text = toSoqlText(
      spec({ fields: ["Name", "Account.Name"] }),
      metaMap(),
    );
    expect(text).toContain("SELECT Name, Account.Name");
  });
});

describe("the SOQL preview must describe the query that runs", () => {
  it("types a parent filter literal the same way in both compilers", () => {
    // Account.AnnualRevenue is Currency: a bare number, not a quoted string.
    // A flat `meta[path]` lookup misses parent paths, falls back to String, and
    // the preview then advertises a *different* filter from the one that runs —
    // the same class of drift that shipped `LIKE 'Acme'` and `LIMIT 5000`.
    const s = spec({
      fields: ["Name"],
      filters: [
        {
          id: "f1",
          field: "Account.AnnualRevenue",
          operator: "gt",
          value: "1000",
        },
      ],
    });
    expect(toGraphQL(s, relatedMeta()).document).toContain(
      "{ AnnualRevenue: { gt: 1000 } }",
    );
    expect(toSoqlText(s, relatedMeta())).toContain(
      "WHERE Account.AnnualRevenue > 1000",
    );
  });

  it("drops a disabled filter from both compilers, not just one", () => {
    // The failure this guards against isn't "the filter still applied" — it's
    // the preview and the query disagreeing about whether it did, which is the
    // whole reason both read `isFilterActive` instead of testing the flag
    // themselves.
    const s = spec({
      fields: ["Name"],
      filters: [
        {
          id: "f1",
          field: "Name",
          operator: "eq",
          value: "Acme",
          disabled: true,
        },
      ],
    });
    expect(toGraphQL(s, metaMap()).document).not.toContain("where:");
    expect(toSoqlText(s, metaMap())).not.toContain("WHERE");
  });
});

describe("disabled filters", () => {
  const enabled = {
    id: "f1",
    field: "StageName",
    operator: "eq" as const,
    value: "Closed Won",
  };
  const off = {
    id: "f2",
    field: "Name",
    operator: "eq" as const,
    value: "Acme",
    disabled: true,
  };

  it("keeps the enabled filters and skips the disabled one", () => {
    const { document } = toGraphQL(
      spec({ fields: ["Name"], filters: [enabled, off] }),
      metaMap(),
    );
    // One usable clause, so no `and:` wrapper — the disabled one is gone
    // entirely rather than compiled to something that matches everything.
    expect(document).toContain('where: { StageName: { eq: "Closed Won" } }');
    expect(document).not.toContain("Acme");
  });

  it("reads an absent flag as enabled", () => {
    // Every spec persisted to session state before this field existed comes
    // back without it, and `undefined` must not read as "off".
    const { document } = toGraphQL(
      spec({ fields: ["Name"], filters: [enabled] }),
      metaMap(),
    );
    expect(document).toContain('where: { StageName: { eq: "Closed Won" } }');
  });

  it("emits no WHERE at all when every filter is disabled", () => {
    const s = spec({
      fields: ["Name"],
      filters: [{ ...enabled, disabled: true }, off],
    });
    expect(toGraphQL(s, metaMap()).document).not.toContain("where:");
    expect(toSoqlText(s, metaMap())).not.toContain("WHERE");
  });

  it("keeps the disabled filter's value intact for re-enabling", () => {
    // The point of the toggle over the X button: flipping the flag back must
    // produce exactly the query it produced before, with nothing retyped.
    const before = toGraphQL(
      spec({ fields: ["Name"], filters: [{ ...off, disabled: false }] }),
      metaMap(),
    ).document;
    const after = toGraphQL(
      spec({ fields: ["Name"], filters: [{ ...off, disabled: true }] }),
      metaMap(),
    ).document;
    expect(before).toContain('where: { Name: { eq: "Acme" } }');
    expect(after).not.toContain("where:");
  });
});

describe("resolveFieldPath", () => {
  it("walks relationship names, not Id field names", () => {
    const resolved = resolveFieldPath(
      "Account.Name",
      "Opportunity",
      relatedMeta(),
    );
    expect(resolved?.objectApiName).toBe("Account");
    expect(resolved?.meta.dataType).toBe("String");
    // "Account ID" would read wrong as a step in the trail.
    expect(resolved?.trail).toEqual(["Account", "Name"]);
  });

  it("resolves two levels through different objects", () => {
    const resolved = resolveFieldPath(
      "Account.Owner.Name",
      "Opportunity",
      relatedMeta(),
    );
    expect(resolved?.objectApiName).toBe("User");
  });

  it("returns null for a polymorphic reference rather than guessing a target", () => {
    expect(
      resolveFieldPath("Who.Name", "Opportunity", relatedMeta()),
    ).toBeNull();
  });

  it("returns null when the parent object's metadata isn't loaded yet", () => {
    expect(
      resolveFieldPath("Account.Name", "Opportunity", {
        Opportunity: relatedMeta().Opportunity,
      }),
    ).toBeNull();
  });

  it("does not veto an unresolvable path at compile time", () => {
    // The server is the authority; an unknown path is still sent.
    expect(() =>
      toGraphQL(spec({ fields: ["Custom__r.Field__c"] }), {}),
    ).not.toThrow();
  });
});

describe("toGraphQL — field selection", () => {
  it("always includes Id as a bare scalar with no subselection", () => {
    const { document } = toGraphQL(spec({ fields: ["Name"] }), metaMap());
    expect(document).toMatch(/^\s*Id$/m);
    expect(document).not.toMatch(/Id\s*@optional/);
  });

  it("puts @optional on every non-Id field so FLS can't fail the query", () => {
    const { document } = toGraphQL(
      spec({ fields: ["Name", "Amount", "StageName"] }),
      metaMap(),
    );
    for (const field of ["Name", "Amount", "StageName"]) {
      expect(document).toContain(`${field} @optional { value displayValue }`);
    }
  });

  it("drops compound fields, which cannot be selected directly", () => {
    const { document, columns } = toGraphQL(
      spec({ fields: ["Name", "BillingAddress"] }),
      metaMap(),
    );
    expect(document).not.toContain("BillingAddress");
    expect(columns).toEqual(["Name"]);
  });

  it("does not duplicate Id when the caller already selected it", () => {
    const { document, columns } = toGraphQL(
      spec({ fields: ["Id", "Name"] }),
      metaMap(),
    );
    expect(columns).toEqual(["Id", "Name"]);
    expect(document.match(/^\s*Id$/gm)).toHaveLength(1);
  });

  it("keeps requesting Id when the user unticks it, but stops showing it", () => {
    // Id is the row key selection, delete and save all depend on, so the
    // document must carry it even when the column is hidden.
    const { document, columns } = toGraphQL(
      spec({ fields: ["Name"] }),
      metaMap(),
    );
    expect(columns).toEqual(["Name"]);
    expect(document).toMatch(/^\s*Id$/m);
  });

  it("shows columns in the order the user picked them", () => {
    const { columns } = toGraphQL(
      spec({ fields: ["Amount", "Id", "Name"] }),
      metaMap(),
    );
    expect(columns).toEqual(["Amount", "Id", "Name"]);
  });
});

describe("toGraphQL — limit", () => {
  it("always emits an explicit first:, since omitting it silently returns 10", () => {
    const { document } = toGraphQL(spec({ limit: 25 }), metaMap());
    expect(document).toContain("first: 25");
  });

  it("clamps to the platform maximum of 2000", () => {
    const { document } = toGraphQL(spec({ limit: 99999 }), metaMap());
    expect(document).toContain(`first: ${MAX_LIMIT}`);
  });

  it("never emits a limit below 1", () => {
    const { document } = toGraphQL(spec({ limit: 0 }), metaMap());
    expect(document).toContain("first: 1");
  });
});

describe("limit clamping", () => {
  it("reduces an over-cap limit to 2000 rather than sending it", () => {
    const { document } = toGraphQL(spec({ limit: 5000 }), metaMap());
    expect(document).toContain(`first: ${MAX_LIMIT}`);
    expect(document).not.toContain("first: 5000");
  });

  it("shows the clamped limit in the preview, not the number typed", () => {
    // The preview previously read LIMIT 5000 for a query running first: 2000.
    expect(toSoqlText(spec({ limit: 5000 }), metaMap())).toContain(
      `LIMIT ${MAX_LIMIT}`,
    );
  });

  it("agrees between the query and the preview at every boundary", () => {
    for (const limit of [0, 1, 200, 2000, 2001, -5, Number.NaN]) {
      const { document } = toGraphQL(spec({ limit }), metaMap());
      const sent = document.match(/first: (\d+)/)?.[1];
      const shown = toSoqlText(spec({ limit }), metaMap()).match(
        /LIMIT (\d+)/,
      )?.[1];
      expect(sent).toBe(shown);
    }
  });

  it("falls back to the default rather than emitting first: NaN", () => {
    // An emptied number input reads as NaN here; `first: NaN` is a document
    // Salesforce cannot parse at all.
    const { document } = toGraphQL(spec({ limit: Number.NaN }), metaMap());
    expect(document).toContain(`first: ${DEFAULT_LIMIT}`);
  });
});

describe("toGraphQL — filter value typing", () => {
  const filter = (field: string, operator: string, value: string) =>
    spec({ filters: [{ id: "1", field, operator: operator as never, value }] });

  it("quotes strings and picklists", () => {
    const { document } = toGraphQL(
      filter("StageName", "eq", "Closed Won"),
      metaMap(),
    );
    expect(document).toContain('{ StageName: { eq: "Closed Won" } }');
  });

  it("emits bare numbers for currency", () => {
    const { document } = toGraphQL(filter("Amount", "gte", "50000"), metaMap());
    expect(document).toContain("{ Amount: { gte: 50000 } }");
  });

  it("emits bare booleans", () => {
    const { document } = toGraphQL(
      filter("IsClosed", "eq", "false"),
      metaMap(),
    );
    expect(document).toContain("{ IsClosed: { eq: false } }");
  });

  it("wraps Date in an input object — a bare string is rejected by the API", () => {
    const { document } = toGraphQL(
      filter("CloseDate", "gte", "2020-01-01"),
      metaMap(),
    );
    expect(document).toContain(
      '{ CloseDate: { gte: { value: "2020-01-01" } } }',
    );
  });

  it("wraps DateTime the same way", () => {
    const { document } = toGraphQL(
      filter("CreatedDate", "lt", "2022-06-12T03:29:56.901Z"),
      metaMap(),
    );
    expect(document).toContain('value: "2022-06-12T03:29:56.901Z"');
  });

  it("treats the literal 'null' as GraphQL null, enabling ne:null for not-null", () => {
    const { document } = toGraphQL(
      filter("Description", "ne", "null"),
      metaMap(),
    );
    expect(document).toContain("{ Description: { ne: null } }");
  });

  it("splits comma-separated values into an array for in/nin", () => {
    const { document } = toGraphQL(
      filter("StageName", "in", "Closed Won, Qualification"),
      metaMap(),
    );
    expect(document).toContain(
      '{ StageName: { in: ["Closed Won", "Qualification"] } }',
    );
  });

  it("falls back to a quoted string when a numeric field gets non-numeric input", () => {
    const { document } = toGraphQL(filter("Amount", "gte", "abc"), metaMap());
    // Emitting a bare `abc` would produce a document that cannot parse at all.
    expect(document).toContain('{ Amount: { gte: "abc" } }');
  });
});

describe("toGraphQL — like is a pattern, not an equality test", () => {
  const filter = (value: string) =>
    spec({ filters: [{ id: "1", field: "Name", operator: "like", value }] });

  it("wraps a plain term in wildcards so 'contains' actually contains", () => {
    // Without this, `like: "Acme"` matches the whole value and behaves like eq.
    const { document } = toGraphQL(filter("Acme"), metaMap());
    expect(document).toContain('{ Name: { like: "%Acme%" } }');
  });

  it("leaves a value that already has a wildcard alone", () => {
    const { document } = toGraphQL(filter("Burlington%"), metaMap());
    expect(document).toContain('{ Name: { like: "Burlington%" } }');
  });

  it("still wraps values containing an underscore", () => {
    // `_` is LIKE's single-character wildcard, but it is also an ordinary
    // character in Salesforce names — treating it as intent would silently
    // reinstate the equality behaviour for exactly those values.
    const { document } = toGraphQL(filter("My_Account"), metaMap());
    expect(document).toContain('{ Name: { like: "%My_Account%" } }');
  });

  it("treats 'null' as a search term rather than a null comparison", () => {
    // LIKE NULL is meaningless in SOQL, so the null-literal shortcut the
    // comparison operators use must not apply here.
    const { document } = toGraphQL(filter("null"), metaMap());
    expect(document).toContain('{ Name: { like: "%null%" } }');
  });

  it("escapes before wrapping, so a quote can't break out of the literal", () => {
    const { document } = toGraphQL(filter('a" b'), metaMap());
    expect(document).toContain(`like: ${JSON.stringify('%a" b%')}`);
  });
});

describe("toGraphQL — escaping", () => {
  it("escapes embedded double quotes rather than breaking out of the literal", () => {
    const { document } = toGraphQL(
      spec({
        filters: [
          { id: "1", field: "Name", operator: "eq", value: 'He said "hi"' },
        ],
      }),
      metaMap(),
    );
    expect(document).toContain('"He said \\"hi\\""');
  });

  it("escapes backslashes", () => {
    const { document } = toGraphQL(
      spec({
        filters: [{ id: "1", field: "Name", operator: "eq", value: "a\\b" }],
      }),
      metaMap(),
    );
    expect(document).toContain('"a\\\\b"');
  });

  it("neutralises an attempt to inject extra GraphQL arguments", () => {
    const injection = '" } } first: 1 malicious: { "';
    const { document } = toGraphQL(
      spec({
        filters: [{ id: "1", field: "Name", operator: "eq", value: injection }],
      }),
      metaMap(),
    );
    // Asserting the payload is merely "absent" would be wrong — it IS present,
    // safely escaped inside the literal. The property that matters is that it
    // stays entirely within one quoted value in the expected position, so it
    // can never be read as syntax.
    expect(document).toContain(
      `{ Name: { eq: ${JSON.stringify(injection)} } }`,
    );
  });

  it("escapes newlines instead of emitting a raw line break", () => {
    const { document } = toGraphQL(
      spec({
        filters: [{ id: "1", field: "Name", operator: "eq", value: "a\nb" }],
      }),
      metaMap(),
    );
    expect(document).toContain('"a\\nb"');
  });
});

describe("toGraphQL — where composition", () => {
  it("omits where entirely when no filter has a value", () => {
    const { document } = toGraphQL(
      spec({
        filters: [{ id: "1", field: "Name", operator: "eq", value: "  " }],
      }),
      metaMap(),
    );
    expect(document).not.toContain("where:");
  });

  it("combines multiple filters under and: so same-field filters don't collide", () => {
    const { document } = toGraphQL(
      spec({
        filters: [
          { id: "1", field: "Amount", operator: "gte", value: "100" },
          { id: "2", field: "Amount", operator: "lte", value: "500" },
        ],
      }),
      metaMap(),
    );
    expect(document).toContain("and: [");
    expect(document).toContain("{ Amount: { gte: 100 } }");
    expect(document).toContain("{ Amount: { lte: 500 } }");
  });
});

describe("toGraphQL — ordering and shape", () => {
  it("emits orderBy in the schema's nested form", () => {
    const { document } = toGraphQL(
      spec({ orderBy: { field: "Name", direction: "DESC" } }),
      metaMap(),
    );
    expect(document).toContain("orderBy: { Name: { order: DESC } }");
  });

  it("requests totalCount so the UI can report N of M honestly", () => {
    const { document } = toGraphQL(spec(), metaMap());
    expect(document).toContain("totalCount");
  });

  it("throws a usable message when no object is chosen", () => {
    expect(() => toGraphQL(spec({ objectApiName: "" }), metaMap())).toThrow(
      /Choose an object/i,
    );
  });
});

describe("toDeleteMutation", () => {
  it("aliases each delete and maps aliases back to Ids", () => {
    const { document, aliases } = toDeleteMutation("Opportunity", [
      "006aaa",
      "006bbb",
    ]);
    expect(document).toContain(
      'd0: OpportunityDelete(input: { Id: "006aaa" }) { Id }',
    );
    expect(document).toContain(
      'd1: OpportunityDelete(input: { Id: "006bbb" }) { Id }',
    );
    expect(aliases).toEqual({ d0: "006aaa", d1: "006bbb" });
  });

  it("sets allOrNone:false so one bad Id can't roll back the batch", () => {
    const { document } = toDeleteMutation("Account", ["001aaa"]);
    expect(document).toContain("uiapi(input: { allOrNone: false })");
  });

  it("escapes Ids rather than interpolating them raw", () => {
    const badId = 'bad" }) { Id } x: y(';
    const { document } = toDeleteMutation("Account", [badId]);
    // Same reasoning as the injection test above: the payload is present but
    // fully contained in one escaped literal, which is the safety property.
    expect(document).toContain(
      `d0: AccountDelete(input: { Id: ${JSON.stringify(badId)} }) { Id }`,
    );
  });
});

describe("chunkIds", () => {
  it("chunks below Salesforce's undocumented 75-operation mutation ceiling", () => {
    expect(DELETE_CHUNK_SIZE).toBeLessThan(75);
  });

  it("splits into chunks of the configured size", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `id${i}`);
    const chunks = chunkIds(ids, 50);
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20]);
  });

  it("returns nothing for an empty list", () => {
    expect(chunkIds([])).toEqual([]);
  });
});

describe("toSoqlText", () => {
  it("renders a readable query", () => {
    const text = toSoqlText(
      spec({
        fields: ["Id", "Name", "Amount"],
        filters: [
          { id: "1", field: "StageName", operator: "eq", value: "Closed Won" },
        ],
        orderBy: { field: "Name", direction: "ASC" },
        limit: 200,
      }),
      metaMap(),
    );
    expect(text).toContain("SELECT Id, Name, Amount");
    expect(text).toContain("FROM Opportunity");
    expect(text).toContain("WHERE StageName = 'Closed Won'");
    expect(text).toContain("ORDER BY Name ASC");
    expect(text).toContain("LIMIT 200");
  });

  it("renders IN lists with parentheses", () => {
    const text = toSoqlText(
      spec({
        filters: [
          { id: "1", field: "StageName", operator: "in", value: "A, B" },
        ],
      }),
      metaMap(),
    );
    expect(text).toContain("StageName IN ('A', 'B')");
  });

  it("renders null and booleans unquoted", () => {
    const text = toSoqlText(
      spec({
        filters: [
          { id: "1", field: "Description", operator: "ne", value: "null" },
          { id: "2", field: "IsClosed", operator: "eq", value: "true" },
        ],
      }),
      metaMap(),
    );
    expect(text).toContain("Description != NULL");
    expect(text).toContain("IsClosed = TRUE");
  });

  it("escapes single quotes so the preview stays valid SOQL", () => {
    const text = toSoqlText(
      spec({
        filters: [{ id: "1", field: "Name", operator: "eq", value: "O'Brien" }],
      }),
      metaMap(),
    );
    expect(text).toContain("O\\'Brien");
  });

  it("shows the wildcards the query actually runs with", () => {
    // A preview reading `LIKE 'Acme'` would describe a stricter query than the
    // one that executes.
    const text = toSoqlText(
      spec({
        filters: [{ id: "1", field: "Name", operator: "like", value: "Acme" }],
      }),
      metaMap(),
    );
    expect(text).toContain("Name LIKE '%Acme%'");
  });

  it("returns empty string with no object, so the preview stays blank", () => {
    expect(toSoqlText(spec({ objectApiName: "" }), metaMap())).toBe("");
  });

  it("collapses to one line for the history list", () => {
    const line = toSoqlOneLine(spec({ fields: ["Id"] }), metaMap());
    expect(line).not.toContain("\n");
    expect(line).toContain("SELECT Id FROM Opportunity");
  });
});

describe("operatorsForType", () => {
  it("offers only equality operators for booleans", () => {
    expect(operatorsForType("Boolean")).toEqual(["eq", "ne"]);
  });

  it("offers comparisons but not like for numbers and dates", () => {
    expect(operatorsForType("Currency")).toContain("gte");
    expect(operatorsForType("Currency")).not.toContain("like");
    expect(operatorsForType("Date")).toContain("lt");
  });

  it("offers like and list membership for text", () => {
    expect(operatorsForType("String")).toContain("like");
    expect(operatorsForType("String")).toContain("in");
  });
});
