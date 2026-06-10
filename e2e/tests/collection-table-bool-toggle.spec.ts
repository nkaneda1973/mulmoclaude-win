// E2E coverage for toggling a boolean cell inside a `table` sub-row
// directly from the read-only detail panel (no edit-mode round-trip).
// Pins: the checkbox fires a PUT with the toggled value, a failed PUT
// rolls back, and checkboxes are disabled while a save is in flight.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const TASKS = {
  collection: {
    slug: "tasks",
    title: "Tasks",
    icon: "task_alt",
    source: "user",
    schema: {
      title: "Tasks",
      icon: "task_alt",
      dataPath: "data/tasks/items",
      primaryKey: "name",
      fields: {
        name: { type: "string", label: "Task", primary: true, required: true },
        checklist: {
          type: "table",
          label: "Checklist",
          of: {
            item: { type: "string", label: "Item" },
            done: { type: "boolean", label: "Done" },
          },
        },
      },
    },
  },
  items: [
    {
      name: "prep",
      checklist: [
        { item: "Step A", done: true },
        { item: "Step B", done: false },
      ],
    },
  ],
};

async function setupRoutes(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections/tasks",
    (route) => route.fulfill({ json: TASKS }),
  );
}

async function mockItemPut(page: Page, ok: boolean): Promise<{ body: Promise<Record<string, unknown>> }> {
  let resolveBody: (body: Record<string, unknown>) => void;
  const body = new Promise<Record<string, unknown>>((resolve) => {
    resolveBody = resolve;
  });
  await page.route(
    (url) => url.pathname.startsWith("/api/collections/tasks/items/"),
    (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      const parsed = JSON.parse(route.request().postData() ?? "{}");
      resolveBody(parsed);
      const itemId = decodeURIComponent(route.request().url().split("/items/").pop() ?? "");
      if (!ok) return route.fulfill({ status: 500, json: { error: "boom" } });
      return route.fulfill({ json: { itemId, item: parsed } });
    },
  );
  return { body };
}

async function openDetail(page: Page): Promise<void> {
  await page.goto("/collections/tasks");
  await page.getByTestId("collections-row-prep").click();
  await expect(page.getByTestId("collections-detail")).toBeVisible();
}

test.describe("table boolean toggle in detail panel", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await setupRoutes(page);
  });

  test("toggling a sub-row boolean checkbox PUTs the updated record", async ({ page }) => {
    const { body } = await mockItemPut(page, true);
    await openDetail(page);
    const checkbox = page.getByTestId("collections-detail-table-bool-checklist-1-done");
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    const put = await body;
    expect(put.name).toBe("prep");
    const checklist = put.checklist as { item: string; done: boolean }[];
    expect(checklist[0].done).toBe(true);
    expect(checklist[1].done).toBe(true);
  });

  test("a failed PUT rolls the checkbox back", async ({ page }) => {
    await mockItemPut(page, false);
    await openDetail(page);
    const checkbox = page.getByTestId("collections-detail-table-bool-checklist-1-done");
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
  });

  test("checkboxes are disabled while save is in flight", async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => url.pathname.startsWith("/api/collections/tasks/items/"),
      async (route) => {
        if (route.request().method() !== "PUT") return route.fallback();
        await gate;
        const itemId = decodeURIComponent(route.request().url().split("/items/").pop() ?? "");
        return route.fulfill({ json: { itemId, item: JSON.parse(route.request().postData() ?? "{}") } });
      },
    );
    await openDetail(page);
    const checkbox0 = page.getByTestId("collections-detail-table-bool-checklist-0-done");
    const checkbox1 = page.getByTestId("collections-detail-table-bool-checklist-1-done");
    await checkbox1.click();
    await expect(checkbox0).toBeDisabled();
    await expect(checkbox1).toBeDisabled();
    release();
    await expect(checkbox0).toBeEnabled();
    await expect(checkbox1).toBeEnabled();
  });
});
