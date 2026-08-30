import { expect, test } from "@playwright/test";

import { primaryInstrumentRoutes } from "./routes.mjs";
import {
  collectControlInventory,
  exerciseRangeMathematics,
} from "./helpers/control-inventory.mjs";

test.describe.configure({ mode: "parallel" });

for (const route of primaryInstrumentRoutes) {
  test(`${route.label} exposes a valid control inventory`, async ({ page }, testInfo) => {
    await page.goto(route.testHref, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts?.ready);

    const inventory = await collectControlInventory(page);
    await testInfo.attach(`${route.id}-controls.json`, {
      body: JSON.stringify(inventory, null, 2),
      contentType: "application/json",
    });

    const rangeResults = await exerciseRangeMathematics(page);
    await testInfo.attach(`${route.id}-range-math.json`, {
      body: JSON.stringify(rangeResults, null, 2),
      contentType: "application/json",
    });

    const invalidNumeric = inventory.controls.filter(({ numericValid }) => !numericValid);
    const emptySelects = inventory.controls.filter(({ options }) => options && options.length === 0);
    const rangeFailures = rangeResults.filter(({ skipped, finite, bounded, restored }) => (
      !skipped && (!finite || !bounded || !restored)
    ));
    expect(inventory.duplicateIds, "duplicate DOM ids make controls ambiguous").toEqual([]);
    expect(
      invalidNumeric,
      `range controls must have valid finite bounds:\n${JSON.stringify(invalidNumeric, null, 2)}`,
    ).toEqual([]);
    expect(emptySelects, "select controls need at least one option").toEqual([]);
    expect(
      rangeFailures,
      `range min/mid/max exercise failed:\n${JSON.stringify(rangeFailures, null, 2)}`,
    ).toEqual([]);

    if (process.env.E2E_STRICT_CONTROLS === "1") {
      expect(inventory.summary.unlabeledVisible, "visible controls require accessible names").toBe(0);
    }
  });
}
