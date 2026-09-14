/**
 * Reading the result of an aliased batch mutation.
 *
 * Both bulk write paths — Data Export's delete and Data Import's create/update
 * — send one `uiapi(input: { allOrNone: false })` document carrying up to 75
 * aliased operations, and both have to answer the same question afterwards:
 * *which* of those operations succeeded, and for the ones that didn't, why.
 *
 * This lived inline in `deleteRecords`. It is shared now because the importer
 * needs identical semantics, and because the repo has already been bitten by
 * two near-identical private copies of a request helper drifting apart.
 *
 * ## Salesforce returns `paths`, not `path`
 *
 * The GraphQL specification names the field `path`. Salesforce's `uiapi`
 * endpoint sends **`paths`**, and the Data SDK passes the error array through
 * verbatim — its error mapper returns `response.data.errors` untouched. Reading
 * `path` therefore never matches, and every failed operation silently falls
 * through to the "couldn't attribute this" branch.
 *
 * That is exactly what the previous implementation did. It went unnoticed
 * because it was verified with a single bad record in the batch: with one
 * failure the fallback message *is* that record's message, so the output looked
 * right. With two different failures both rows report the first row's reason.
 *
 * Confirmed live — the error objects carry `paths: ["uiapi", "r1"]` and no
 * `path` key at all. Both spellings are read here so a future server-side fix
 * to match the spec doesn't break attribution again.
 */

/** One entry of a GraphQL `errors` array, as Salesforce actually sends it. */
export interface BatchError {
  message: string;
  /** Standard GraphQL spelling. Not currently sent by `uiapi`. */
  path?: (string | number)[];
  /** What `uiapi` actually sends. */
  paths?: (string | number)[];
}

/**
 * Follow-on noise, not a reason.
 *
 * Every failed operation in an `allOrNone: false` batch comes back with its
 * real error *and* this one. Surfacing it as the cause of a row's failure tells
 * the user nothing, so it is only used when there is nothing better.
 */
const ROLLBACK_NOISE = /transaction was rolled back/i;

export interface AttributedErrors {
  /** Alias -> the best available message for that operation. */
  byAlias: Map<string, string>;
  /** Messages that named no alias — usually a whole-document rejection. */
  unattributed: string[];
}

export function attributeErrors(
  errors: BatchError[] | undefined,
  aliases: Set<string> | Map<string, unknown> | Record<string, unknown>,
): AttributedErrors {
  const known =
    aliases instanceof Set
      ? aliases
      : aliases instanceof Map
        ? new Set(aliases.keys())
        : new Set(Object.keys(aliases));

  const byAlias = new Map<string, string>();
  const unattributed: string[] = [];

  for (const error of errors ?? []) {
    const segments = error.paths ?? error.path ?? [];
    const alias = segments.find(
      (segment): segment is string =>
        typeof segment === "string" && known.has(segment),
    );

    if (!alias) {
      unattributed.push(error.message);
      continue;
    }

    const existing = byAlias.get(alias);
    // Keep the first informative message. A later rollback notice must never
    // overwrite the real reason, and a real reason arriving after a rollback
    // notice should replace it.
    if (existing == null) {
      byAlias.set(alias, error.message);
    } else if (
      ROLLBACK_NOISE.test(existing) &&
      !ROLLBACK_NOISE.test(error.message)
    ) {
      byAlias.set(alias, error.message);
    }
  }

  return { byAlias, unattributed };
}

/**
 * Decide the outcome of one aliased operation.
 *
 * `payload` is the `uiapi` object from the response. An operation succeeded
 * when no error named it and Salesforce returned a value under its alias. With
 * `allOrNone: false` those successes genuinely commit even while siblings fail
 * — verified live rather than assumed, since the failed operations come back
 * carrying a "transaction was rolled back" message that suggests otherwise.
 *
 * A whole-document rejection — the 76-operation `LIMIT_EXCEEDED`, an expired
 * session — produces errors with no alias at all, so every operation in the
 * chunk has to inherit the document-level message rather than be reported as a
 * silent no-op.
 */
export function outcomeFor(
  alias: string,
  payload: Record<string, unknown>,
  attributed: AttributedErrors,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const aliasError = attributed.byAlias.get(alias);
  if (aliasError) return { ok: false, message: aliasError };

  const value = payload[alias];
  if (value) return { ok: true, value };

  const documentError = attributed.unattributed.find(
    (m) => !ROLLBACK_NOISE.test(m),
  );
  return {
    ok: false,
    message:
      documentError ??
      attributed.unattributed[0] ??
      "Salesforce did not confirm this operation.",
  };
}

/** One compiled chunk: the document to send, and what each alias stands for. */
export interface MutationChunk<T> {
  document: string;
  /** Alias -> the caller's own key for that operation (a row index, a record Id). */
  aliases: Record<string, T>;
}

export interface MutationBatchResult {
  /** API calls actually spent, so the UI can report the real cost. */
  calls: number;
  /** True when the caller's signal fired part-way through. */
  aborted: boolean;
}

/**
 * Run a sequence of aliased mutation chunks and report each operation's outcome.
 *
 * `deleteRecords` and `importRecords` were the same twenty lines twice over:
 * loop the chunks, compile, count the call, `executeGraphQLRaw`, attribute the
 * errors, then walk the aliases calling `outcomeFor`. Only the per-operation
 * bookkeeping differed, and that is what `onOutcome` is for.
 *
 * Three details here are behaviour, not plumbing, and all three were already
 * present in both copies:
 *
 * - **Chunks run sequentially, never in parallel.** A run the user abandons
 *   should stop where they stopped rather than leave an unknown number of writes
 *   in flight, and firing twenty concurrent mutations at one org is a good way
 *   to meet a concurrency limit that is much harder to explain than a slow
 *   progress bar.
 * - **The signal is checked before *and* after each await.** Checking only
 *   before means an import abandoned mid-request still records outcomes for a
 *   chunk nobody is looking at any more.
 * - **`calls` counts requests issued, not chunks planned.** It is what the UI
 *   shows the user as the cost of the operation, so it must not include a chunk
 *   that abort skipped.
 */
export async function runMutationBatches<T>(
  chunks: MutationChunk<T>[],
  execute: (document: string) => Promise<{
    data?: { uiapi?: unknown } | null;
    errors?: BatchError[];
  }>,
  onOutcome: (
    key: T,
    outcome: { ok: true; value: unknown } | { ok: false; message: string },
  ) => void,
  init: {
    signal?: AbortSignal;
    /** Called after each chunk lands, for a progress bar. */
    onChunkDone?: (done: number, total: number) => void;
  } = {},
): Promise<MutationBatchResult> {
  let calls = 0;

  for (const chunk of chunks) {
    if (init.signal?.aborted) return { calls, aborted: true };

    calls++;
    const result = await execute(chunk.document);

    if (init.signal?.aborted) return { calls, aborted: true };

    const payload = (result.data?.uiapi ?? {}) as Record<string, unknown>;
    const attributed = attributeErrors(result.errors, chunk.aliases);

    for (const [alias, key] of Object.entries(chunk.aliases)) {
      onOutcome(key, outcomeFor(alias, payload, attributed));
    }

    init.onChunkDone?.(calls, chunks.length);
  }

  return { calls, aborted: false };
}
