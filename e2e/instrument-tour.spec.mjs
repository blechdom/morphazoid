import { expect, test } from "@playwright/test";
import { FAVE_TOOL_IDS } from "../src/site/instrument-registry.js";
import { readAudioStatus } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

test("homepage and Choose share Faves order, with Synthesaurus immediately after Hiccup Head", async ({ page }) => {
  await page.goto("index.html");
  await settlePage(page);
  const home = await page.locator('.catalogue-group[data-category-id="faves"] .instrument-card')
    .evaluateAll(cards => cards.map(card => card.dataset.instrumentId));
  const menu = await page.locator('.instrument-picker-group[data-group-id="faves"] .instrument-picker-link')
    .evaluateAll(links => links.map(link => link.dataset.toolId));
  expect(home).toEqual(FAVE_TOOL_IDS);
  expect(home[0]).toBe("shapes");
  for (const id of ["shape-synth", "solid-synth", "hyper-synth"]) {
    expect(home).not.toContain(id);
    await expect(page.locator(`.catalogue-group[data-category-id="geometric"] .instrument-card[data-instrument-id="${id}"]`)).toBeVisible();
  }
  expect(menu).toEqual(home);
  expect(home.filter(id => id === "puggler")).toHaveLength(1);
  const pugglerIndex = home.indexOf("puggler");
  expect(home.slice(pugglerIndex - 1, pugglerIndex + 2)).toEqual(["hyper-rubix", "puggler", "micmic"]);
  await expect(page.locator('.catalogue-group[data-category-id="faves"] .instrument-card[data-instrument-id="puggler"] .instrument-card-link')).toHaveAttribute("href", "puggler.html");
  await expect(page.locator('.instrument-picker-group[data-group-id="faves"] .instrument-picker-link[data-tool-id="puggler"]')).toHaveAttribute("href", /\/puggler\.html$/);
  await expect(page.locator('.catalogue-group[data-category-id="graphic-ui"] .instrument-card[data-instrument-id="puggler"]')).toBeVisible();
  expect(home.filter(id => id === "gesticulating-hand")).toHaveLength(1);
  await expect(page.locator('.catalogue-group[data-category-id="faves"] .instrument-card[data-instrument-id="gesticulating-hand"] .instrument-card-link')).toHaveAttribute("href", "gesticules.html");
  await expect(page.locator('.instrument-picker-group[data-group-id="faves"] .instrument-picker-link[data-tool-id="gesticulating-hand"]')).toHaveAttribute("href", /\/gesticules\.html$/);
  await expect(page.locator('.catalogue-group[data-category-id="graphic-ui"] .instrument-card[data-instrument-id="gesticulating-hand"]')).toBeVisible();
  expect(home.filter(id => id === "simd-chiptune")).toHaveLength(1);
  await expect(page.locator('.catalogue-group[data-category-id="faves"] .instrument-card[data-instrument-id="simd-chiptune"] .instrument-card-link')).toHaveAttribute("href", "simd-chiptune.html");
  await expect(page.locator('.instrument-picker-group[data-group-id="faves"] .instrument-picker-link[data-tool-id="simd-chiptune"]')).toHaveAttribute("href", /\/simd-chiptune\.html$/);
  await expect(page.locator('.catalogue-group[data-category-id="simd-audio"] .instrument-card[data-instrument-id="simd-chiptune"]')).toBeVisible();
  expect(home.filter(id => id === "synthesis")).toHaveLength(1);
  expect(home.slice(home.indexOf("hiccup-head"), home.indexOf("hiccup-head") + 3))
    .toEqual(["hiccup-head", "synthesis", "creaturazoid"]);
  expect(home).not.toContain("spiral");
  await expect(page.locator('.catalogue-group[data-category-id="tesselation"] .instrument-card[data-instrument-id="spiral"]')).toBeVisible();
  const next = page.getByRole("link", { name: "Next instrument: Shapes", exact: true });
  await expect(next).toBeVisible();
  await next.click();
  await expect(page).toHaveURL(/\/shapes\.html(?:\?|$)/);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

for (const layout of [
  { name: "desktop", width: 1440, height: 900, touch: false },
  { name: "phone portrait", width: 390, height: 844, touch: true },
  { name: "phone landscape", width: 844, height: 390, touch: true },
]) {
  test.describe(layout.name, () => {
    test.use({ viewport: { width: layout.width, height: layout.height }, hasTouch: layout.touch });
    test("next arrow is reachable, preserves Choose, and reaches a silent instrument", async ({ page, baseURL }, testInfo) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await page.goto("index.html");
      await settlePage(page);
      const faves = page.locator('.catalogue-group[data-category-id="faves"]');
      const tile = faves.locator('.instrument-card[data-instrument-id="fractal-delay"]');
      await expect(tile).toHaveCount(1);
      await expect(tile.locator('.instrument-card-title')).toHaveText("Fractal Delay");
      await expect(tile.locator('.instrument-card-image')).toHaveAttribute("src", "assets/instrument-icons/fractal-delay.webp");
      const link = tile.locator('.instrument-card-link');
      await expect(link).toHaveAttribute("href", "fractal-delay.html");
      await expect(page.locator('.instrument-picker-group[data-group-id="faves"] .instrument-picker-link[data-tool-id="fractal-delay"]'))
        .toHaveAttribute("href", /\/fractal-delay\.html$/);
      await link.scrollIntoViewIfNeeded();
      const sameLayout = await tile.evaluate(node => {
        const other = node.parentElement.querySelector('[data-instrument-id="micmic-rust"]');
        const properties = ['display', 'padding', 'borderRadius', 'gridTemplateRows'];
        return node.className === other.className && properties.every(key => getComputedStyle(node)[key] === getComputedStyle(other)[key]);
      });
      expect(sameLayout).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      await link.click();
      await expect(page).toHaveURL(/\/fractal-delay\.html$/);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      const fractalPicker = page.locator('.tabs .instrument-picker');
      await expect(fractalPicker).toHaveAttribute('data-active-tool-id', 'fractal-delay');
      await expect(page.locator('.tabs > a[href$="l-mic-rust.html"]')).toHaveCount(0);
      const fractalChoose = fractalPicker.locator('.instrument-picker-trigger');
      await expect(fractalChoose).toHaveAttribute('aria-label', 'Choose instrument. Current: Fractal Delay');
      await fractalChoose.click();
      const search = page.getByRole('searchbox', { name: 'Filter instruments' });
      await search.fill('fractal delay');
      const current = fractalPicker.locator('.instrument-picker-link[data-tool-id="fractal-delay"]');
      await expect(current).toBeVisible();
      expect(await current.evaluate(link => {
        const rect = link.getBoundingClientRect();
        return link.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), 'the filtered Choose result receives pointer events').toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`fractal-choose-${layout.width}.png`), fullPage: true });
      await search.fill('');
      if (layout.width === 390) {
        const overlap = await fractalPicker.evaluate(menu => {
          const sticky = document.querySelector('.fractal-controls > .mz-input-preset-row, .fractal-controls > .instrument-preset-controls').getBoundingClientRect();
          const panel = menu.querySelector('.instrument-picker-panel').getBoundingClientRect();
          for (const link of menu.querySelectorAll('.instrument-picker-link')) {
            const row = link.getBoundingClientRect();
            const left = Math.max(row.left, sticky.left, panel.left), right = Math.min(row.right, sticky.right, panel.right);
            const top = Math.max(row.top, sticky.top, panel.top), bottom = Math.min(row.bottom, sticky.bottom, panel.bottom);
            if (right - left < 4 || bottom - top < 4) continue;
            return { found: true, hit: link.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2)) };
          }
          return { found: false };
        });
        expect(overlap, 'an unfiltered menu row above the mobile sticky toolbar receives the pointer').toEqual({ found: true, hit: true });
        await page.screenshot({ path: testInfo.outputPath('fractal-choose-mobile-overlap.png'), fullPage: true });
      }
      await page.keyboard.press('Escape');
      await expect(fractalPicker).not.toHaveAttribute('open', '');
      expect(await page.evaluate(async () => {
        const d = (await import('/src/instruments/fractal-delay/browser-engine.js')).getFractalDelayEngine().getDiagnostics();
        return { audio: d.audioDesired, context: d.contextState, sourceCount: d.sourceCount };
      })).toEqual({ audio: false, context: 'uninitialized', sourceCount: 0 });
      await page.goto("hiccup-head.html?tour-source=1#source");
      await settlePage(page);
      const next = page.getByRole("link", { name: "Next instrument: Synthesaurus", exact: true });
      await expect(next).toBeVisible();
      const arrowBox = await next.boundingBox();
      const menuBox = await page.locator(".tabs .instrument-picker-trigger").boundingBox();
      expect(arrowBox.x).toBeGreaterThanOrEqual(menuBox.x + menuBox.width);
      expect(arrowBox.x + arrowBox.width).toBeLessThanOrEqual(layout.width);
      expect(Math.abs(arrowBox.y + arrowBox.height / 2 - menuBox.y - menuBox.height / 2)).toBeLessThan(2);
      if (layout.touch) {
        expect(arrowBox.width).toBeGreaterThanOrEqual(48);
        expect(arrowBox.height).toBeGreaterThanOrEqual(48);
      }
      await page.locator(".tabs .instrument-picker-trigger").click();
      await expect(page.getByRole("searchbox", { name: "Filter instruments" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".tabs .instrument-picker")).not.toHaveAttribute("open", "");
      await next.focus();
      // The focused navigation control does not double as an instrument shortcut.
      await page.keyboard.press("Space");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/synthesis\.html$/);
      await expect(page.locator(".tabs .instrument-picker")).toHaveAttribute("data-active-tool-id", "synthesis");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  });
}

test("canonical routes and WAX navigation keep the correct next instrument and site root", async ({ page }) => {
  await page.goto("shape-synth.html?tour-source=1#source");
  await settlePage(page);
  await page.getByRole("link", { name: "Next instrument: Blobs", exact: true }).click();
  await expect(page).toHaveURL(/\/blobs\.html$/);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.goto("dist-wax/hiccup-head.html");
  await settlePage(page);
  const next = page.getByRole("link", { name: "Next instrument: Synthesaurus", exact: true });
  await expect(next).toHaveAttribute("href", /\/dist-wax\/synthesis\.html$/);
  await next.click();
  await expect(page).toHaveURL(/\/dist-wax\/synthesis\.html$/);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.goto('dist-wax/fractal-delay.html');
  await expect(page.locator('.tabs .instrument-picker')).toHaveAttribute('data-active-tool-id', 'fractal-delay');
  await expect(page.locator('.tabs .instrument-picker-next')).toHaveAttribute('href', /\/dist-wax\/l-system\.html$/);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});
