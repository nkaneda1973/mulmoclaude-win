// Hard-constraint regression for the accounting plugin: in the
// default (General) Role environment, the plugin must be invisible.
// No launcher button, no /accounting route. Reaching the plugin
// requires actively switching into the built-in Accounting role
// (or a custom role) whose `availablePlugins` include
// `manageAccounting`.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

test.describe("accounting plugin — isolation regression", () => {
  test("PluginLauncher does not render an accounting button", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    // The launcher buttons use plugin-launcher-{key} testids; the
    // accounting plugin is NOT supposed to register one.
    await expect(page.getByTestId("plugin-launcher-accounting")).toHaveCount(0);
  });

  test("/accounting URL does not match a route — falls through to /chat", async ({ page }) => {
    await page.goto("/accounting");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    const { pathname } = new URL(page.url());
    // Bounded segment, no nested-quantifier overlap — same rationale as router-guards.spec.ts.
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded `[\w-]+`, single optional group
    expect(pathname).toMatch(/^\/chat(?:\/[\w-]+)?$/);
  });

  test("/roles General role row never lists manageAccounting", async ({ page }) => {
    // Defense against a regression that mixes the Accounting plugin
    // into the General role's baseline. /roles now renders built-in
    // role rows (each with the merged plugin list as text), so the
    // assertion is scoped to the General row only — the Accounting
    // row legitimately surfaces `manageAccounting` and must not be
    // flagged here.
    //
    // The strict "the General role's availablePlugins must not
    // include manageAccounting" invariant lives in
    // test/roles/test_role_schema.ts (`describe("General role
    // isolation")`); this e2e mirrors it at the UI layer.
    await page.goto("/roles");
    await page.waitForLoadState("networkidle");
    const generalRow = page.getByRole("listitem").filter({ hasText: /^General/ });
    await expect(generalRow.getByText("manageAccounting")).toHaveCount(0);
  });
});
