/**
 * Thin GraphQL client: createDataSDK + sdk.graphql with centralized error
 * handling. Mutations are routed to sdk.graphql.mutate and everything else to
 * sdk.graphql.query (the SDK rejects an operation sent to the wrong method).
 * Use with gql-tagged queries and generated operation types for type-safe calls.
 */
import { createDataSDK } from "@salesforce/platform-sdk";
import { markDataMutated, shouldBypassCache } from "../lib/dataFreshness";

/**
 * True when the operation's first definition is a `mutation`. Strips GraphQL
 * comments first so a leading `# ...` line can't mask the keyword. Queries
 * (named or anonymous `{ ... }` shorthand) and subscriptions fall through to
 * query().
 */
function isMutation(operation: string): boolean {
  return /^\s*mutation\b/.test(operation.replace(/#[^\n\r]*/g, ""));
}

export interface GraphQLCallOptions {
  /**
   * The user just asked for this data — bypass the SDK's read cache.
   *
   * `markDataMutated()` covers writes *this app* makes, but nothing tells the
   * app when someone else changes the org. The reproduced case: run a query,
   * have a record created in Salesforce from anywhere else, press Run again on
   * the same query, and the new record is missing with no request issued and
   * nothing in the usage meter to hint at why.
   *
   * The signal we do have is the press itself. A cache hit is only ever
   * possible when the document and variables are byte-identical to an earlier
   * call, and the only reason to press Run or Search on an identical query is
   * to see current data — so the cache's benefit on *these* calls is zero by
   * construction, and its cost is a wrong answer. Automatic reads (a remount, a
   * current-user or org-Id lookup) pass nothing here and keep caching in full.
   */
  fresh?: boolean;
}

export async function executeGraphQL<TData, TVariables>(
  operation: string,
  variables?: TVariables,
  options: GraphQLCallOptions = {},
): Promise<TData> {
  const result = await executeGraphQLRaw<TData, TVariables>(
    operation,
    variables,
    options,
  );

  if (result.errors?.length) {
    const msg = result.errors.map((e) => e.message).join("; ");
    throw new Error(`GraphQL Error: ${msg}`);
  }

  if (result.data == null) {
    throw new Error("GraphQL response data is null");
  }

  return result.data;
}

export interface GraphQLRawResult<TData> {
  data: TData | null | undefined;
  errors?: { message: string }[];
}

/**
 * Same call, but returns `data` and `errors` together instead of throwing.
 *
 * Needed for partial-success operations. A batched delete runs under
 * `uiapi(input: { allOrNone: false })`, so Salesforce can legitimately return
 * *both* successfully deleted records and per-record errors in one response.
 * `executeGraphQL` throws whenever `errors` is non-empty, which would discard
 * the successes and leave the caller unable to report what actually happened.
 *
 * Prefer `executeGraphQL` everywhere else — it keeps the common path simple.
 */
export async function executeGraphQLRaw<TData, TVariables>(
  operation: string,
  variables?: TVariables,
  options: GraphQLCallOptions = {},
): Promise<GraphQLRawResult<TData>> {
  const data = await createDataSDK();

  if (isMutation(operation)) {
    const result = await data.graphql!.mutate<TData, TVariables>({
      mutation: operation,
      variables: variables,
    });
    // Every write invalidates cached reads, including reads of *other* queries
    // that happen to cover the same records. Marked after the call so a request
    // that never reached Salesforce doesn't cost the session its caching.
    markDataMutated();
    return { data: result.data, errors: result.errors };
  }

  // Two independent reasons to skip the cache: this app wrote something
  // recently (`shouldBypassCache`), or the user just pressed the button that
  // issued this read (`options.fresh`). The first covers writes we can see; the
  // second is the only cover there is for writes made anywhere else.
  const bypass = options.fresh === true || shouldBypassCache();

  const result = await data.graphql!.query<TData, TVariables>({
    query: operation,
    variables: variables,
    // Left undefined for automatic reads in a session that has written
    // nothing, so ordinary browsing keeps the SDK's 300s cache and the
    // documented call counts.
    // See `lib/dataFreshness.ts` for why this is blunt rather than targeted.
    ...(bypass ? { cacheControl: "no-cache" as const } : {}),
  });

  return { data: result.data, errors: result.errors };
}
