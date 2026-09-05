import { expect, test } from "@playwright/test";

import {
  pageDiagnosticMessages,
  settlePage,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";

const layouts = Object.freeze([
  Object.freeze({ name: "desktop", width: 1440, height: 900 }),
  Object.freeze({ name: "phone portrait", width: 390, height: 844 }),
  Object.freeze({ name: "phone landscape", width: 844, height: 390 }),
]);

async function generation(page) {
  const text = await page.locator("#stageReadout").textContent();
  const match = text?.match(/\bROW\s+(\d+)\b/iu);
  if (!match) throw new Error("Missing row number in stage readout: " + text);
  return Number(match[1]);
}

async function compactText(locator) {
  return (await locator.textContent())?.replace(/\s+/gu, "") ?? "";
}

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
      for (const disclosure of element.closest("details")
        ? [...document.querySelectorAll("details")].filter((details) => details.contains(element))
        : []) {
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
        ? "#" + element.id
        : element.getAttribute("name")
          ? "[name=\"" + element.getAttribute("name") + "\"]"
          : "";
      const name = element.getAttribute("aria-label")
        || element.textContent?.replace(/\s+/gu, " ").trim()
        || element.getAttribute("title")
        || "";
      return element.tagName.toLowerCase() + identity + (name ? " (" + name.slice(0, 80) + ")" : "");
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
    const panel = document.querySelector(".experiment-panel");
    return {
      clippedControls,
      documentOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
      hasViewportMeta: Boolean(document.querySelector("meta[name='viewport']")),
      panelOverflow: panel ? Math.max(0, panel.scrollWidth - panel.clientWidth) : 0,
    };
  });
}

test("Automatapoeia switches to totalistic codes without restarting its history", async ({ page }) => {
  const diagnostics = watchPageDiagnostics(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const response = await page.goto("/automatapoeia.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok(), "Automatapoeia returned HTTP " + response?.status()).toBe(true);
  await settlePage(page);

  const audioButton = page.locator("#audioButton");
  const initialAudioState = await audioButton.getAttribute("aria-pressed");
  expect(initialAudioState).toBe("false");

  const atlasTiles = page.locator("#caRuleAtlasGrid [data-ca-atlas-rule]");
  const ruleSlider = page.locator("#caRule");
  await expect(atlasTiles).toHaveCount(256);
  await expect(ruleSlider).toHaveAttribute("max", "255");
  await expect(page.locator("#caRulePickerLabel")).toHaveText("Elementary R1 · Rule 30");

  await expect.poll(() => generation(page)).toBeGreaterThanOrEqual(3);
  const generationBeforeSwitch = await generation(page);

  await page.locator("#caFamily").selectOption("totalistic-r2");

  await expect(atlasTiles).toHaveCount(64);
  await expect(page.locator("#caRuleAtlasStatus")).toHaveText("64 radius-2 totalistic codes");
  await expect(ruleSlider).toHaveAttribute("max", "63");
  await expect(ruleSlider).toHaveValue("20");
  await expect(page.locator("#caRuleNumberLabel")).toHaveText("Totalistic code");
  await expect(page.locator("#caRulePickerLabel")).toHaveText("Totalistic R2 · Code 20");
  await expect(page.locator("#caRuleAtlasGrid")).toHaveAttribute(
    "aria-label",
    "Binary radius-2 totalistic cellular automaton codes",
  );
  await expect(page.locator("[data-ca-atlas-family=\"totalistic-r2\"][data-ca-atlas-rule=\"20\"]"))
    .toHaveAttribute("aria-pressed", "true");
  expect(await compactText(page.locator("#caRuleNeighborhoods"))).toBe("543210");
  expect(await compactText(page.locator("#caRuleBits"))).toBe("010100");

  expect(await generation(page)).toBeGreaterThanOrEqual(generationBeforeSwitch);
  await expect.poll(() => generation(page)).toBeGreaterThan(generationBeforeSwitch);
  await expect(audioButton).toHaveAttribute("aria-pressed", initialAudioState);
  await expect(page.locator("#caEvolutionSummary")).toContainText("Elementary R1 · Rule 30");
  await expect(page.locator("#caEvolutionSummary")).toContainText("Totalistic R2 · Code 20");

  await ruleSlider.evaluate((control) => {
    control.value = "63";
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(ruleSlider).toHaveValue("63");
  await expect(page.locator("#caRulePickerLabel")).toHaveText("Totalistic R2 · Code 63");

  await ruleSlider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(ruleSlider).toHaveValue("0");
  await expect(page.locator("#caRulePickerLabel")).toHaveText("Totalistic R2 · Code 0");
  await expect(audioButton).toHaveAttribute("aria-pressed", initialAudioState);

  await page.locator("#caRulePicker").evaluate((picker) => {
    picker.open = true;
  });

  for (const layout of layouts) {
    await test.step(layout.name, async () => {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await page.evaluate(() => {
        scrollTo(0, 0);
        return new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });

      const report = await inspectLayout(page);
      expect(report.hasViewportMeta, "Automatapoeia is missing a viewport meta tag").toBe(true);
      expect(
        report.documentOverflow,
        "Automatapoeia overflows " + layout.name + " horizontally by " + report.documentOverflow + "px",
      ).toBeLessThanOrEqual(2);
      expect(
        report.panelOverflow,
        "Automatapoeia control panel overflows " + layout.name + " by " + report.panelOverflow + "px",
      ).toBeLessThanOrEqual(2);
      expect(
        report.clippedControls,
        "Automatapoeia has unreachable controls at " + layout.width + "×" + layout.height,
      ).toEqual([]);
    });
  }

  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});
