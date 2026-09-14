/**
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * For full license text, see the LICENSE.txt file
 */

interface SfdcEnv {
  /** Salesforce org force.com URL (e.g., "https://myorg.lightning.force.com"). */
  orgUrl?: string;
}

// `var` is required here, not a style choice: `declare let`/`const` in an ambient
// context does not create a property on `globalThis`, so `SFDC_ENV` would not be
// reachable as a global at runtime. The `no-var` rule does not fire on ambient
// declarations, so no disable directive is needed.
declare var SFDC_ENV: SfdcEnv | undefined;
