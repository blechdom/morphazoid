import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CATALOGUE_ITEMS, INSTRUMENTS } from "../src/instrument-catalog.js";
import { TOOL_GROUPS } from "../src/site/instrument-registry.js";
import { canonicalInstrumentId } from "../src/site/instrument-identities.js";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const plan = JSON.parse(await readFile(new URL("../docs/catalogue-update-decisions.json", import.meta.url)));
const renamed = plan.rows.filter(row => row.id !== row.oldId);

test("the catalogue shows the approved names/categories, labs and newer main demos", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("index.html", { waitUntil: "load" });
  await settlePage(page);
  const rendered = await page.locator(".instrument-card").evaluateAll(cards => [...new Set(cards.map(card => card.dataset.instrumentId))]);
  expect(rendered.sort()).toEqual(CATALOGUE_ITEMS.map(item => item.id).sort());
  for (const item of CATALOGUE_ITEMS) {
    await expect(page.locator(`.instrument-card[data-instrument-id="${item.id}"] .instrument-card-title`).first()).toHaveText(item.label);
  }
  await expect(page.locator('.catalogue-group[data-category-id="wip"]')).toBeVisible();
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const row of renamed) {
  const tool = TOOL_GROUPS.flatMap(group => group.tools).find(tool => tool.id === row.id);
  for (const href of tool.legacyHrefs ?? []) {
    test(`${href} retains query/hash and reaches ${row.id}`, async ({ page }) => {
      await page.goto(`${href}?rename-check=1#kept-fragment`, { waitUntil: "load" });
      // Some instruments append their own mode defaults after redirecting.
      // Preserve the caller's values without forbidding existing URL behavior.
      await expect(page).toHaveURL(url => (
        url.pathname === `/${tool.href}`
        && url.searchParams.get("rename-check") === "1"
        && url.hash === "#kept-fragment"
      ));
      await settlePage(page);
      if (INSTRUMENTS.some(item => item.id === row.id)) {
        await expect(page.locator(".instrument-picker")).toHaveAttribute("data-active-tool-id", canonicalInstrumentId(row.oldId));
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      }
    });
  }
}
