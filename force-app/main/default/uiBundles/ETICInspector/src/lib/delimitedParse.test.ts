import { describe, expect, it } from "vitest";
import { toCsv, toTsv, type ExportTable } from "./exportFormats";
import {
  detectDelimiter,
  parseDelimited,
  stripFormulaGuard,
} from "./delimitedParse";

describe("detectDelimiter", () => {
  it("picks tab for an Excel paste", () => {
    expect(detectDelimiter("Id\tName\tIndustry\n1\tAcme\tEnergy")).toBe("\t");
  });

  it("picks comma for a CSV", () => {
    expect(detectDelimiter("Id,Name,Industry\n1,Acme,Energy")).toBe(",");
  });

  it("picks semicolon for a European CSV", () => {
    expect(detectDelimiter("Id;Name;Industry\n1;Acme;Energy")).toBe(";");
  });

  // The header line is judged alone precisely so a comma-heavy free-text
  // column can't outvote the real delimiter.
  it("is not fooled by commas in the data rows", () => {
    const text = "Id\tName\n1\tAcme, Inc, formerly Acme, Ltd, of Acme, CA";
    expect(detectDelimiter(text)).toBe("\t");
  });

  it("ignores delimiters inside a quoted header", () => {
    expect(detectDelimiter('"Last, First"\tEmail\nx\ty')).toBe("\t");
  });

  it("defaults to comma for a single column with no delimiter at all", () => {
    expect(detectDelimiter("Name\nAcme")).toBe(",");
  });
});

describe("parseDelimited — basics", () => {
  it("splits headers from rows", () => {
    const table = parseDelimited("Id,Name\n1,Acme\n2,Globex");
    expect(table.headers).toEqual(["Id", "Name"]);
    expect(table.rows).toEqual([
      ["1", "Acme"],
      ["2", "Globex"],
    ]);
  });

  it("returns an empty table for empty input rather than throwing", () => {
    expect(parseDelimited("").rows).toEqual([]);
    expect(parseDelimited("   \n  ").headers).toEqual([]);
  });

  it("does not invent a phantom row from a trailing newline", () => {
    expect(parseDelimited("Id,Name\r\n1,Acme\r\n").rows).toHaveLength(1);
  });

  it("skips blank lines in the middle of a paste", () => {
    expect(parseDelimited("Id,Name\n1,Acme\n\n2,Globex\n").rows).toHaveLength(
      2,
    );
  });

  it("trims whitespace from headers but never from values", () => {
    const table = parseDelimited(" Id , Name \n1, Acme ");
    expect(table.headers).toEqual(["Id", "Name"]);
    expect(table.rows[0]).toEqual(["1", " Acme "]);
  });

  it("strips a UTF-8 BOM so the first header still matches", () => {
    const table = parseDelimited("﻿Id,Name\n1,Acme");
    expect(table.headers[0]).toBe("Id");
  });
});

describe("parseDelimited — line endings", () => {
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("handles %s", (_label, eol) => {
    const table = parseDelimited(`Id,Name${eol}1,Acme${eol}2,Globex`);
    expect(table.rows).toEqual([
      ["1", "Acme"],
      ["2", "Globex"],
    ]);
  });
});

describe("parseDelimited — RFC 4180 quoting", () => {
  it("keeps a delimiter inside quotes", () => {
    const table = parseDelimited('Id,Name\n1,"Acme, Inc"');
    expect(table.rows[0]).toEqual(["1", "Acme, Inc"]);
  });

  it("keeps a newline inside quotes as part of the value", () => {
    const table = parseDelimited('Id,Notes\n1,"line one\nline two"');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][1]).toBe("line one\nline two");
  });

  it("unescapes a doubled quote", () => {
    const table = parseDelimited('Id,Name\n1,"He said ""hi"""');
    expect(table.rows[0][1]).toBe('He said "hi"');
  });

  it("treats a quote in the middle of an unquoted value as literal", () => {
    // Excel emits this for values it didn't consider worth quoting.
    const table = parseDelimited('Id,Name\n1,5" pipe');
    expect(table.rows[0][1]).toBe('5" pipe');
  });

  it("preserves an empty quoted cell as empty rather than dropping it", () => {
    const table = parseDelimited('Id,Name,Note\n1,"",x');
    expect(table.rows[0]).toEqual(["1", "", "x"]);
  });
});

describe("parseDelimited — ragged rows", () => {
  it("pads a short row and counts it", () => {
    const table = parseDelimited("Id,Name,Industry\n1,Acme");
    expect(table.rows[0]).toEqual(["1", "Acme", ""]);
    expect(table.raggedRows).toBe(1);
  });

  it("truncates a long row and counts it", () => {
    const table = parseDelimited("Id,Name\n1,Acme,extra");
    expect(table.rows[0]).toEqual(["1", "Acme"]);
    expect(table.raggedRows).toBe(1);
  });

  it("reports zero for a well-formed file", () => {
    expect(parseDelimited("Id,Name\n1,Acme").raggedRows).toBe(0);
  });
});

describe("stripFormulaGuard", () => {
  // exportFormats.escapeDelimited prefixes an apostrophe to anything starting
  // with =, +, -, @, tab or CR so Excel can't execute it.
  it.each(["=1+1", "+1", "-1200", "@SUM(A1)"])("unguards %s", (payload) => {
    expect(stripFormulaGuard(`'${payload}`)).toBe(payload);
  });

  it("leaves an apostrophe that guards nothing alone", () => {
    expect(stripFormulaGuard("'tis the season")).toBe("'tis the season");
    expect(stripFormulaGuard("O'Brien")).toBe("O'Brien");
  });

  it("removes only one apostrophe", () => {
    expect(stripFormulaGuard("''-1")).toBe("''-1");
  });
});

describe("round trip through exportFormats", () => {
  const roundTrip = (table: ExportTable, write: (t: ExportTable) => string) =>
    parseDelimited(write(table));

  const nasty: ExportTable = {
    columns: ["Id", "Name", "Amount", "Notes"],
    rows: [
      {
        Id: "001",
        Name: 'Acme, "The" Inc',
        Amount: "-1200.50",
        Notes: "line one\nline two",
      },
      { Id: "002", Name: "Globex", Amount: "0", Notes: "" },
    ],
  };

  it.each([
    ["CSV", toCsv],
    ["TSV", toTsv],
  ])("survives %s unchanged", (_label, write) => {
    const parsed = roundTrip(nasty, write);
    expect(parsed.headers).toEqual(nasty.columns);
    expect(parsed.rows).toEqual([
      ["001", 'Acme, "The" Inc', "-1200.50", "line one\nline two"],
      ["002", "Globex", "0", ""],
    ]);
  });

  // The specific regression this pair exists to prevent: without
  // stripFormulaGuard a negative currency comes back as the literal "'-1200.50"
  // and every such row fails to import as a number.
  it("brings a negative number back as a number, not as guarded text", () => {
    const csv = toCsv({ columns: ["Amount"], rows: [{ Amount: "-1200.50" }] });
    expect(csv).toContain("'-1200.50");
    expect(parseDelimited(csv).rows[0][0]).toBe("-1200.50");
  });
});
