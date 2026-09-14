/**
 * Downloads the full GraphQL schema from a connected Salesforce org via introspection.
 *
 * Usage:
 *   npm run graphql:schema
 *   node scripts/get-graphql-schema.mjs [output-path]
 *
 * The schema is written to the project root. Nothing builds from it — the app has
 * no `.graphql` documents and no codegen step — but it is the authoritative answer
 * to "does `uiapi` actually support X", which the published docs get wrong in
 * places. Grep it rather than trusting a docs page (see ARCHITECTURE-QA.md §13).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getOrgInfo } from "@salesforce/ui-bundle/app";
import { buildClientSchema, getIntrospectionQuery, printSchema } from "graphql";
import { pruneSchema } from "@graphql-tools/utils";

const DEFAULT_SCHEMA_PATH = "../../../../../schema.graphql";
const TARGET_ORG = process.env.SF_TARGET_ORG || undefined;

async function executeSalesforceGraphQLQuery(query, variables, operationName) {
  const orgInfo = await getOrgInfo(TARGET_ORG);
  if (!orgInfo) {
    throw new Error(
      "Could not resolve a Salesforce org. Set SF_TARGET_ORG or a default org.",
    );
  }
  const { rawInstanceUrl: instanceUrl, apiVersion, accessToken } = orgInfo;

  const targetUrl = `${instanceUrl}/services/data/v${apiVersion}/graphql`;

  console.log(`Executing introspection query against ${targetUrl}`);
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Chatter-Entity-Encoding": "false",
    },
    body: JSON.stringify({ query, variables, operationName }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Salesforce GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  return response.json();
}

try {
  const outputPath = resolve(process.argv[2] || DEFAULT_SCHEMA_PATH);

  const introspectionResult = await executeSalesforceGraphQLQuery(
    getIntrospectionQuery(),
    {},
    "IntrospectionQuery",
  );

  const schema = buildClientSchema(introspectionResult.data);
  const prunedSchema = pruneSchema(schema);
  const sdl = printSchema(prunedSchema);

  writeFileSync(outputPath, sdl);

  console.log(`Schema saved to ${outputPath}`);
} catch (error) {
  console.error("Error:", error.message);
  process.exit(1);
}
