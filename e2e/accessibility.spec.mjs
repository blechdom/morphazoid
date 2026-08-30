import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { primaryInstrumentRoutes } from "./routes.mjs";

test.describe.configure({ mode: "parallel" });

for (const route of primaryInstrumentRoutes) {
  test(`${route.label} exposes an automated accessibility report`, async ({ page }, testInfo) => {
    await page.goto(route.testHref, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts?.ready);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const report = {
      route,
      project: testInfo.project.name,
      violations: results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        targets: violation.nodes.map((node) => node.target),
      })),
      incomplete: results.incomplete.map((item) => ({
        id: item.id,
        impact: item.impact,
        targets: item.nodes.map((node) => node.target),
      })),
    };
    await testInfo.attach(`${route.id}-accessibility.json`, {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });

    expect(Array.isArray(results.violations)).toBe(true);
    if (process.env.E2E_STRICT_A11Y === "1") {
      const blocking = results.violations.filter(({ impact }) => (
        impact === "critical" || impact === "serious"
      ));
      expect(blocking, "critical and serious accessibility violations").toEqual([]);
    }
  });
}
