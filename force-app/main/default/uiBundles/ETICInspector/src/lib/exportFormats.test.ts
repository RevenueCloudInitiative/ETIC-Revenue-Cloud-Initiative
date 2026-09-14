import { describe, expect, it } from "vitest";
import {
  serialize,
  toCsv,
  toJson,
  toTsv,
  type ExportTable,
} from "./exportFormats";

const table = (
  rows: Record<string, string>[],
  columns = ["Id", "Name"],
): ExportTable => ({
  columns,
  rows,
});

describe("toCsv", () => {
  it("writes a header row followed by data", () => {
    const csv = toCsv(table([{ Id: "1", Name: "Acme" }]));
    expect(csv).toBe("Id,Name\r\n1,Acme");
  });

  it("quotes values containing the delimiter", () => {
    const csv = toCsv(table([{ Id: "1", Name: "Acme, Inc" }]));
    expect(csv).toContain('"Acme, Inc"');
  });

  it("doubles embedded quotes per RFC 4180", () => {
    const csv = toCsv(table([{ Id: "1", Name: 'He said "hi"' }]));
    expect(csv).toContain('"He said ""hi"""');
  });

  it("quotes values containing newlines rather than breaking the row", () => {
    const csv = toCsv(table([{ Id: "1", Name: "line1\nline2" }]));
    expect(csv).toContain('"line1\nline2"');
    expect(csv.split("\r\n")).toHaveLength(2);
  });

  it("fills missing values with empty strings", () => {
    const csv = toCsv(table([{ Id: "1" }]));
    expect(csv).toBe("Id,Name\r\n1,");
  });
});

describe("toCsv — spreadsheet formula injection", () => {
  // A value starting with =, +, - or @ is executed as a formula when the file
  // is opened in Excel or Sheets. Exported data must never become executable.
  it.each(["=1+1", "+1", "-1", "@SUM(A1)"])("neutralises %s", (payload) => {
    const csv = toCsv(table([{ Id: "1", Name: payload }]));
    expect(csv).toContain(`'${payload}`);
  });

  it("neutralises the classic command-execution payload", () => {
    const payload = "=cmd|' /C calc'!A0";
    const csv = toCsv(table([{ Id: "1", Name: payload }]));
    // Prefixed so it is inert, and quoted because it contains a quote char.
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/,=cmd/);
  });

  it("leaves ordinary values untouched", () => {
    const csv = toCsv(table([{ Id: "1", Name: "Acme" }]));
    expect(csv).not.toContain("'Acme");
  });
});

describe("toTsv", () => {
  it("separates with tabs", () => {
    expect(toTsv(table([{ Id: "1", Name: "Acme" }]))).toBe(
      "Id\tName\r\n1\tAcme",
    );
  });

  it("quotes values containing a tab", () => {
    const tsv = toTsv(table([{ Id: "1", Name: "a\tb" }]));
    expect(tsv).toContain('"a\tb"');
  });
});

describe("toJson", () => {
  it("emits an array of objects keyed by column", () => {
    const parsed = JSON.parse(toJson(table([{ Id: "1", Name: "Acme" }])));
    expect(parsed).toEqual([{ Id: "1", Name: "Acme" }]);
  });

  it("includes columns missing from a row as empty strings", () => {
    const parsed = JSON.parse(toJson(table([{ Id: "1" }])));
    expect(parsed).toEqual([{ Id: "1", Name: "" }]);
  });

  it("does not apply the formula guard, which is a spreadsheet concern only", () => {
    const parsed = JSON.parse(toJson(table([{ Id: "1", Name: "=1+1" }])));
    expect(parsed[0].Name).toBe("=1+1");
  });
});

describe("serialize", () => {
  it("dispatches on format", () => {
    const t = table([{ Id: "1", Name: "Acme" }]);
    expect(serialize(t, "csv")).toBe(toCsv(t));
    expect(serialize(t, "tsv")).toBe(toTsv(t));
    expect(serialize(t, "json")).toBe(toJson(t));
  });
});
