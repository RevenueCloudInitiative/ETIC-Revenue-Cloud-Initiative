/**
 * Result ordering for the Users tab.
 *
 * The search the org runs is one `LIKE '%term%'` across Name, Username, Alias
 * and Email, so it hands back every row the term appears *anywhere* in, sorted
 * by name. On a short term that is mostly noise — "ma" matches every user with
 * a `@gmail.com` or `@hotmail.com` address — and plain alphabetical order then
 * buries the person you were looking for behind all of them.
 *
 * So the list is re-ordered here, on records already fetched, at no extra API
 * cost. Rows where the term *starts a word* come first, rows where it sits in
 * the middle of one come after, and each group stays alphabetical. That is what
 * makes a search for "ma" put Malak and Ahmed Malak above Osama.
 */
import type { UserSummary } from "../api/users";

/** The term starts a word in the name — "Malak Ibrahim", "Ahmed Malak". */
const NAME_WORD_START = 0;
/** The term starts a word in the username, alias, or email local part. */
const HANDLE_WORD_START = 1;
/** The term is buried inside a word — "Osama", "ahmad.osman@…". */
const MID_WORD = 2;
/**
 * The term matched only the email's domain, which says nothing about the
 * person: every `@gmail.com` address answers a search for "ma". Ranked last
 * rather than dropped — the org counted these as matches, and hiding a row the
 * result count promised is worse than putting it at the bottom.
 */
const DOMAIN_ONLY = 3;

/**
 * Split on anything that is neither a letter nor a digit, so "Abd El-Rahman",
 * "O'Brien", "mary_ann" and "ahmed.malak@org.com" all break into the words a
 * person would say they are made of.
 */
function words(value: string): string[] {
  return value.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The half of an email before the `@` — the only half that names a person. */
function localPart(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

/** True when any word of `value` begins with the (already lowercased) term. */
function startsAWord(value: string | null, term: string): boolean {
  if (!value) return false;
  return words(value.toLowerCase()).some((word) => word.startsWith(term));
}

function contains(value: string | null, term: string): boolean {
  return value !== null && value.toLowerCase().includes(term);
}

function rankOf(user: UserSummary, term: string): number {
  if (startsAWord(user.name, term)) return NAME_WORD_START;

  const local = localPart(user.email);
  if (
    startsAWord(user.username, term) ||
    startsAWord(user.alias, term) ||
    startsAWord(local, term)
  ) {
    return HANDLE_WORD_START;
  }

  if (
    contains(user.name, term) ||
    contains(user.username, term) ||
    contains(user.alias, term) ||
    contains(local, term)
  ) {
    return MID_WORD;
  }

  // Either the domain matched, or the org matched on something we cannot see
  // from here. Both belong at the bottom, and neither may go missing.
  return DOMAIN_ONLY;
}

/**
 * Order search results best-match-first.
 *
 * Total by construction: every row in goes out exactly once, so the "N matches"
 * the page prints stays true. The Id tie-break is not decoration — two people
 * really can share a display name, and without it their relative order would
 * depend on the order the org happened to return them in.
 */
export function rankUserResults(
  users: UserSummary[],
  term: string,
): UserSummary[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return users;

  return users
    .map((user) => ({ user, rank: rankOf(user, needle) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.user.name.localeCompare(b.user.name) ||
        a.user.id.localeCompare(b.user.id),
    )
    .map((entry) => entry.user);
}
