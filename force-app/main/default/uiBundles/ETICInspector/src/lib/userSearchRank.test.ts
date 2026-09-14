import { describe, expect, it } from "vitest";
import type { UserSummary } from "../api/users";
import { rankUserResults } from "./userSearchRank";

function user(partial: Partial<UserSummary> & { name: string }): UserSummary {
  return {
    id: partial.name.replace(/\W/g, "").toLowerCase().padEnd(18, "0"),
    username: null,
    alias: null,
    email: null,
    profileName: null,
    roleName: null,
    language: null,
    locale: null,
    isActive: true,
    ...partial,
  };
}

const names = (users: UserSummary[]) => users.map((u) => u.name);

describe("rankUserResults", () => {
  // The case that prompted this: searching "ma" for Malak, in an org where the
  // org's own alphabetical ordering puts three other people first.
  it("puts word-start matches above mid-word ones, each alphabetical", () => {
    const results = rankUserResults(
      [
        user({ name: "Ahmad Osman" }),
        user({ name: "Malak Ibrahim" }),
        user({ name: "Osama Khalil" }),
        user({ name: "Ahmed Malak" }),
        user({ name: "Amal Mahmoud" }),
      ],
      "ma",
    );

    expect(names(results)).toEqual([
      // "Ma" starts a word in each of these...
      "Ahmed Malak",
      "Amal Mahmoud",
      "Malak Ibrahim",
      // ...and only sits mid-word in these.
      "Ahmad Osman",
      "Osama Khalil",
    ]);
  });

  // Alphabetical order is per group, not across the whole list, or the tiers
  // would collapse back into the ordering the org already gave us.
  it("does not let alphabetical order override the tiers", () => {
    const results = rankUserResults(
      [user({ name: "Amal Osman" }), user({ name: "Zeinab Malak" })],
      "ma",
    );

    expect(names(results)).toEqual(["Zeinab Malak", "Amal Osman"]);
  });

  it("matches a word after a hyphen, apostrophe, or underscore", () => {
    const results = rankUserResults(
      [
        user({ name: "Rana Osman" }),
        user({ name: "Abd El-Malak" }),
        user({ name: "Sara O'Malley" }),
      ],
      "mal",
    );

    expect(names(results)).toEqual([
      "Abd El-Malak",
      "Sara O'Malley",
      "Rana Osman",
    ]);
  });

  // The noise this ranking exists to push down: "ma" matches every gmail and
  // hotmail address in the org, and none of those matches is about the person.
  it("ranks an email-domain-only match last", () => {
    const results = rankUserResults(
      [
        user({ name: "Rana Osman", email: "rana@gmail.com" }),
        user({ name: "Tarek Adel", email: "tarek@hotmail.com" }),
        user({ name: "Osama Khalil", email: "osama@corp.io" }),
      ],
      "ma",
    );

    expect(names(results)).toEqual([
      "Osama Khalil", // mid-word in the name — a real, if weak, match
      "Rana Osman",
      "Tarek Adel",
    ]);
  });

  // A name match is about the person; a login is a weaker signal, so it sits
  // between the two name tiers' worth of confidence and a mid-word hit.
  it("ranks a name word-start above a username or email word-start", () => {
    const results = rankUserResults(
      [
        user({ name: "Aya Fouad", email: "malak.f@corp.io" }),
        user({ name: "Zeinab Malak" }),
        user({ name: "Bassem Nour", username: "ma.nour@corp.io" }),
      ],
      "ma",
    );

    expect(names(results)).toEqual([
      "Zeinab Malak",
      "Aya Fouad",
      "Bassem Nour",
    ]);
  });

  it("is case insensitive in both directions", () => {
    const results = rankUserResults(
      [user({ name: "osama khalil" }), user({ name: "MALAK IBRAHIM" })],
      "Ma",
    );

    expect(names(results)).toEqual(["MALAK IBRAHIM", "osama khalil"]);
  });

  // The page prints "N matches", so losing or duplicating a row would make the
  // count a lie. Rows the org matched on something we cannot see from here —
  // an alias we did not read, say — must still come out.
  it("returns every input row exactly once, even unattributable ones", () => {
    const input = [
      user({ name: "Malak Ibrahim" }),
      user({ name: "Nobody Here" }),
      user({ name: "Osama Khalil" }),
    ];

    const results = rankUserResults(input, "ma");

    expect(results).toHaveLength(3);
    expect(new Set(results.map((u) => u.id)).size).toBe(3);
    expect(names(results)[results.length - 1]).toBe("Nobody Here");
  });

  // Two people sharing a display name must not swap places between searches.
  it("breaks a display-name tie on Id so the order is stable", () => {
    const first = user({ name: "Malak Ibrahim", id: "005AAAAAAAAAAAAAAA" });
    const second = user({ name: "Malak Ibrahim", id: "005BBBBBBBBBBBBBBB" });

    expect(rankUserResults([second, first], "ma").map((u) => u.id)).toEqual([
      "005AAAAAAAAAAAAAAA",
      "005BBBBBBBBBBBBBBB",
    ]);
  });

  it("leaves the list alone when there is no term to rank against", () => {
    const input = [user({ name: "Zeinab Malak" }), user({ name: "Aya Fouad" })];
    expect(rankUserResults(input, "  ")).toBe(input);
  });
});
