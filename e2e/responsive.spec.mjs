import { expect, test } from "@playwright/test";

import { settlePage } from "./helpers/diagnostics.mjs";
import { allHtmlRoutes } from "./routes.mjs";

const layouts = Object.freeze([
  Object.freeze({ name: "desktop", width: 1440, height: 900 }),
  Object.freeze({ name: "phone portrait", width: 390, height: 844 }),
  Object.freeze({ name: "phone landscape", width: 844, height: 390 }),
]);

async function inspectLayout(page) {
  return page.evaluate(() => {
    const tolerance = 2;
    const interactiveSelector = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "select",
      "summary",
      "textarea",
      "[contenteditable='true']",
      "[role='button']",
      "[role='checkbox']",
      "[role='combobox']",
      "[role='link']",
      "[role='radio']",
      "[role='slider']",
      "[role='switch']",
      "[role='tab']",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    const isRendered = (element) => {
      if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
      for (const disclosure of element.closest("details") ? [...document.querySelectorAll("details")]
        .filter((details) => details.contains(element)) : []) {
        if (disclosure.open) continue;
        const summary = disclosure.querySelector(":scope > summary");
        if (!summary?.contains(element)) return false;
      }
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > tolerance && rect.height > tolerance;
    };

    const hasHorizontalScroller = (element) => {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (
          /^(auto|scroll)$/u.test(style.overflowX)
          && ancestor.scrollWidth > ancestor.clientWidth + tolerance
        ) return true;
      }
      return false;
    };

    const describe = (element) => {
      const identity = element.id
        ? `#${element.id}`
        : element.getAttribute("name")
          ? `[name="${element.getAttribute("name")}"]`
          : "";
      const name = element.getAttribute("aria-label")
        || element.textContent?.replace(/\s+/gu, " ").trim()
        || element.getAttribute("title")
        || "";
      return `${element.tagName.toLowerCase()}${identity}${name ? ` (${name.slice(0, 80)})` : ""}`;
    };

    const clippedControls = [...document.querySelectorAll(interactiveSelector)]
      .filter(isRendered)
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const horizontallyClipped = rect.left < -tolerance || rect.right > innerWidth + tolerance;
        if (!horizontallyClipped || hasHorizontalScroller(element)) return [];
        return [{
          control: describe(element),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
        }];
      });

    const root = document.documentElement;
    return {
      clippedControls,
      documentOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
      hasViewportMeta: Boolean(document.querySelector("meta[name='viewport']")),
    };
  });
}

for (const route of allHtmlRoutes) {
  test(`${route.href} keeps controls reachable across layouts`, async ({ page }) => {
    const response = await page.goto(route.testHref, { waitUntil: "domcontentloaded" });
    expect(response?.ok(), `${route.href} returned HTTP ${response?.status()}`).toBe(true);
    await settlePage(page);

    for (const layout of layouts) {
      await test.step(layout.name, async () => {
        await page.setViewportSize({ width: layout.width, height: layout.height });
        await page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));

        const report = await inspectLayout(page);
        expect(report.hasViewportMeta, `${route.href} is missing a viewport meta tag`).toBe(true);
        expect(
          report.documentOverflow,
          `${route.href} overflows ${layout.name} horizontally by ${report.documentOverflow}px`,
        ).toBeLessThanOrEqual(2);
        expect(
          report.clippedControls,
          `${route.href} has unreachable controls at ${layout.width}×${layout.height}`,
        ).toEqual([]);
      });
    }
  });
}
