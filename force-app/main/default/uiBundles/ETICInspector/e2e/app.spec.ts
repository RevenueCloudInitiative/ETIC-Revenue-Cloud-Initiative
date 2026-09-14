import { test, expect } from "@playwright/test";

/**
 * Smoke coverage for the app shell.
 *
 * This runs against a built `dist/` served statically (see playwright.config.ts),
 * with **no Salesforce session** — the `/services/data/…` calls every page makes
 * cannot succeed here. So these tests only assert what renders before any data
 * is fetched: routing, the layout shell, and each page's static chrome. Don't
 * extend them to cover records, queries or saves; that needs the CLI dev proxy
 * against a real org, which is the manual pass in ARCHITECTURE-QA.md.
 *
 * Both assertions below previously checked template text — a heading "Home" and
 * "Welcome to your React application." — that the app stopped rendering long
 * before this was noticed, because there was no script wired up to run it.
 * `npm run test:e2e` exists now.
 */
test.describe("ETIC Inspector", () => {
  test("home page loads and prompts for a record", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Inspect a record" }),
    ).toBeVisible();
    await expect(
      page.getByText("Paste a Record Id to jump straight to its details."),
    ).toBeVisible();
  });

  test("navigation is present on the shell", async ({ page }) => {
    await page.goto("/");
    // The nav renders from static route metadata rather than from a lazy page
    // chunk, so it is on screen before anything is fetched — which is exactly
    // why it survives a page that fails to load.
    await expect(page.getByRole("link", { name: "Data Export" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Users" })).toBeVisible();
  });

  test("not found route shows 404", async ({ page }) => {
    await page.goto("/non-existent-route");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});
