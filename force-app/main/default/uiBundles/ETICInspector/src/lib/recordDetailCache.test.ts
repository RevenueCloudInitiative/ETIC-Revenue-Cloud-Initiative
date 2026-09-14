import { beforeEach, describe, expect, it } from "vitest";
import type { RecordDetail } from "../api/recordDetail";
import { markDataMutated, resetDataFreshness } from "./dataFreshness";
import {
  cacheKey,
  forgetRecord,
  getCachedDetail,
  getLastRecordId,
  invalidateCachedDetail,
  RECORD_CACHE_TTL_MS,
  requestFreshDetail,
  resetRecordDetailCache,
  setCachedDetail,
} from "./recordDetailCache";

/** 15-character Id; `toRecordId18` appends the checksum suffix. */
const ACCOUNT_A = "001AAAAAAAAAAAA";
const ACCOUNT_B = "001BBBBBBBBBBBB";

function detail(recordId: string, recordName = "Acme"): RecordDetail {
  return {
    objectApiName: "Account",
    objectLabel: "Account",
    recordId,
    recordName,
  } as RecordDetail;
}

describe("recordDetailCache", () => {
  beforeEach(() => {
    resetRecordDetailCache();
    resetDataFreshness();
  });

  it("serves a record loaded moments ago", () => {
    setCachedDetail(ACCOUNT_A, detail(ACCOUNT_A), 1_000);
    expect(getCachedDetail(ACCOUNT_A, 1_500)?.recordName).toBe("Acme");
  });

  // The Ids are the same record; only their length differs. A miss here would
  // silently double the cost of every record reached by its 15-char form.
  it("treats the 15- and 18-character forms as one record", () => {
    setCachedDetail(ACCOUNT_A, detail(ACCOUNT_A), 1_000);
    const id18 = getLastRecordId()!;
    expect(id18).toHaveLength(18);
    expect(getCachedDetail(id18, 1_500)).toBeDefined();
  });

  it("evicts the least recently used entry beyond the bound", () => {
    for (let i = 0; i < 11; i++) {
      const id = `001${String(i).padStart(12, "0")}`;
      setCachedDetail(id, detail(id), 1_000);
    }
    expect(getCachedDetail("001000000000000", 1_000)).toBeUndefined();
    expect(getCachedDetail("001000000000010", 1_000)).toBeDefined();
  });

  /* --- Rule 1: age ----------------------------------------------------- */

  it("stops serving an entry once the TTL has elapsed", () => {
    setCachedDetail(ACCOUNT_A, detail(ACCOUNT_A), 1_000);
    expect(
      getCachedDetail(ACCOUNT_A, 1_000 + RECORD_CACHE_TTL_MS - 1),
    ).toBeDefined();
    expect(
      getCachedDetail(ACCOUNT_A, 1_000 + RECORD_CACHE_TTL_MS),
    ).toBeUndefined();
  });

  /* --- Rule 2: write generation ---------------------------------------- */

  // The entry predates the write, so anything the write touched — directly, or
  // through a trigger, roll-up or flow — could have changed it.
  it("drops an entry older than this session's last write", () => {
    setCachedDetail(ACCOUNT_A, detail(ACCOUNT_A), 1_000);
    markDataMutated(2_000);
    expect(getCachedDetail(ACCOUNT_A, 2_500)).toBeUndefined();
  });

  // The other half of the rule, and the reason it isn't a blunt bypass: after
  // an inline edit the page re-caches the saved record, and that copy is
  // correct. Dropping it would re-bill ~9 API calls for data already in hand.
  it("keeps an entry stored after the write that would have invalidated it", () => {
    markDataMutated(2_000);
    setCachedDetail(ACCOUNT_A, detail(ACCOUNT_A, "Acme (saved)"), 2_100);
    expect(getCachedDetail(ACCOUNT_A, 2_500)?.recordName).toBe("Acme (saved)");
  });

  it("leaves records cached when the session has written nothing", () => {
    setCachedDetail(ACCOUNT_A, detail(ACCOUNT_A), 1_000);
    expect(getCachedDetail(ACCOUNT_A, 1_100)).toBeDefined();
  });

  /* --- Rule 3: explicit request ---------------------------------------- */

  // The reported bug, in full: load A, load B, A changes in Salesforce, ask for
  // A again. Nothing the app can observe says A changed — the press is the only
  // signal there is, so the press has to be enough.
  it("does not serve a record the user has explicitly asked for again", () => {
    setCachedDetail(ACCOUNT_A, detail(ACCOUNT_A), 1_000);
    setCachedDetail(ACCOUNT_B, detail(ACCOUNT_B), 1_100);

    requestFreshDetail(ACCOUNT_A);

    expect(getCachedDetail(ACCOUNT_A, 1_200)).toBeUndefined();
    // Asking for A must not cost B its cached copy.
    expect(getCachedDetail(ACCOUNT_B, 1_200)).toBeDefined();
  });

  // Incidental reads are what the cache is for: a tab switch back to All Data
  // restores the last record and must stay free.
  it("still serves a record that was never explicitly re-requested", () => {
    setCachedDetail(ACCOUNT_A, detail(ACCOUNT_A), 1_000);
    requestFreshDetail(ACCOUNT_B);
    expect(getCachedDetail(ACCOUNT_A, 1_200)).toBeDefined();
  });

  it("drops a deleted record so it cannot open from cache afterwards", () => {
    setCachedDetail(ACCOUNT_A, detail(ACCOUNT_A), 1_000);
    invalidateCachedDetail(ACCOUNT_A);
    expect(getCachedDetail(ACCOUNT_A, 1_100)).toBeUndefined();
  });

  /* --- Deletion -------------------------------------------------------- */

  // The distinction that matters between the two: Show all data reloads
  // `getLastRecordId()` when it is opened without an Id, so leaving the pointer
  // behind would fetch the deleted record again and answer with NOT_FOUND.
  it("forgets a deleted record as the last-viewed one, not just its entry", () => {
    setCachedDetail(ACCOUNT_A, detail(ACCOUNT_A), 1_000);
    forgetRecord(ACCOUNT_A);
    expect(getCachedDetail(ACCOUNT_A, 1_100)).toBeUndefined();
    expect(getLastRecordId()).toBeNull();
  });

  it("leaves the last-viewed record alone when a different one is deleted", () => {
    setCachedDetail(ACCOUNT_B, detail(ACCOUNT_B), 1_000);
    setCachedDetail(ACCOUNT_A, detail(ACCOUNT_A), 1_000);
    forgetRecord(ACCOUNT_B);
    expect(getLastRecordId()).toBe(cacheKey(ACCOUNT_A));
    expect(getCachedDetail(ACCOUNT_A, 1_100)).toBeDefined();
  });
});
