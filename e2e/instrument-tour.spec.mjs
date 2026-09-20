import { expect, test } from "@playwright/test";
import { FAVE_TOOL_IDS } from "../src/site/instrument-registry.js";
import { readAudioStatus } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

test("homepage and Choose share Faves order, with Creaturazoid immediately after Hiccup Head", async ({ page }) => {
  await page.goto("index.html");
  await settlePage(page);
  const home = await page.locator('.catalogue-group[data-category-id="faves"] .instrument-card')
    .evaluateAll(cards => cards.map(card => card.dataset.instrumentId));
  const menu = await page.locator('.instrument-picker-group[data-group-id="faves"] .instrument-picker-link')
    .evaluateAll(links => links.map(link => link.dataset.toolId));
  expect(home).toEqual(FAVE_TOOL_IDS);
  expect(menu).toEqual(home);
  expect(home[home.indexOf("hiccup-head") + 1]).toBe("creaturazoid");
  expect(home).not.toContain("spiral");
  await expect(page.locator('.catalogue-group[data-category-id="tesselation"] .instrument-card[data-instrument-id="spiral"]')).toBeVisible();
  const next = page.getByRole("link", { name: "Next instrument: Shape", exact: true });
  await expect(next).toBeVisible();
  await next.click();
  await expect(page).toHaveURL(/\/shape-synth\.html$/);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

for (const layout of [
  { name: "desktop", width: 1440, height: 900, touch: false },
  { name: "phone portrait", width: 390, height: 844, touch: true },
  { name: "phone landscape", width: 844, height: 390, touch: true },
]) {
  test.describe(layout.name, () => {
    test.use({ viewport: { width: layout.width, height: layout.height }, hasTouch: layout.touch });
    test("next arrow is reachable, preserves Choose, and reaches a silent instrument", async ({ page, baseURL }) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await page.goto("hiccup-head.html?tour-source=1#source");
      await settlePage(page);
      const next = page.getByRole("link", { name: "Next instrument: Creaturazoid", exact: true });
      await expect(next).toBeVisible();
      const arrowBox = await next.boundingBox();
      const menuBox = await page.locator(".instrument-picker-trigger").boundingBox();
      expect(arrowBox.x).toBeGreaterThanOrEqual(menuBox.x + menuBox.width);
      expect(arrowBox.x + arrowBox.width).toBeLessThanOrEqual(layout.width);
      expect(Math.abs(arrowBox.y + arrowBox.height / 2 - menuBox.y - menuBox.height / 2)).toBeLessThan(2);
      if (layout.touch) {
        expect(arrowBox.width).toBeGreaterThanOrEqual(48);
        expect(arrowBox.height).toBeGreaterThanOrEqual(48);
      }
      await page.locator(".instrument-picker-trigger").click();
      await expect(page.getByRole("searchbox", { name: "Filter instruments" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".instrument-picker")).not.toHaveAttribute("open", "");
      await next.focus();
      // The focused navigation control does not double as an instrument shortcut.
      await page.keyboard.press("Space");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/creaturazoid\.html$/);
      await expect(page.locator(".instrument-picker")).toHaveAttribute("data-active-tool-id", "creaturazoid");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  });
}

test("legacy routes and WAX navigation keep the correct next instrument and site root", async ({ page }) => {
  await page.goto("shape.html?tour-source=1#source");
  await settlePage(page);
  await page.getByRole("link", { name: "Next instrument: Solid", exact: true }).click();
  await expect(page).toHaveURL(/\/solid-synth\.html$/);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.goto("dist-wax/hiccup-head.html");
  await settlePage(page);
  const next = page.getByRole("link", { name: "Next instrument: Creaturazoid", exact: true });
  await expect(next).toHaveAttribute("href", /\/dist-wax\/creaturazoid\.html$/);
  await next.click();
  await expect(page).toHaveURL(/\/dist-wax\/creaturazoid\.html$/);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});
