import { expect, test } from "@playwright/test";

import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const layouts = [
  { name: "phone portrait", width: 390, height: 844, mobile: true },
  { name: "phone landscape", width: 844, height: 390, mobile: true },
  { name: "desktop", width: 1440, height: 900, mobile: false },
];

async function generation(page) {
  return Number((await page.locator("#stageReadout").textContent()).match(/\bROW\s+(\d+)/u)?.[1]);
}

async function raster(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#stage").getBoundingClientRect();
    return { ...globalThis.__automataRaster, canvasWidth: canvas.width, canvasHeight: canvas.height };
  });
}

function expectFullWidthSquareCells(draw) {
  expect(draw.columns).toBeGreaterThan(0);
  expect(draw.rows).toBeGreaterThan(0);
  expect(Math.abs(draw.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(draw.width - draw.canvasWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(draw.width / draw.columns - draw.height / draw.rows)).toBeLessThanOrEqual(0.01);
}

async function inVisiblePanel(control) {
  return control.evaluate((element) => {
    const panel = element.closest(".experiment-panel").getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && rect.left >= panel.left - 1 && rect.right <= panel.right + 1
      && rect.top >= Math.max(0, panel.top) - 1
      && rect.bottom <= Math.min(innerHeight, panel.bottom) + 1;
  });
}

for (const layout of layouts) {
  test(`Automatapoeia fills its stage and keeps live controls reachable on ${layout.name}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: layout.width, height: layout.height },
      isMobile: layout.mobile,
      hasTouch: layout.mobile,
      deviceScaleFactor: layout.mobile ? 2 : 1,
    });
    const page = await context.newPage();
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    try {
      // Observe actual canvas paint, rather than duplicating the layout formula.
      await page.addInitScript(() => {
        const drawImage = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (...args) {
          if (this.canvas.id === "stage" && args.length === 9) {
            const [, , , columns, rows, x, y, width, height] = args;
            globalThis.__automataRaster = { columns, rows, x, y, width, height };
          }
          return drawImage.apply(this, args);
        };
      });
      const response = await page.goto("./automatapoeia.html", { waitUntil: "domcontentloaded" });
      expect(response?.ok()).toBe(true);
      await settlePage(page);
      await expect.poll(() => generation(page)).toBeGreaterThanOrEqual(3);
      expectFullWidthSquareCells(await raster(page));
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");

      for (const id of ["seedAutomata", "randomizeAutomata", "caRate", "caDensity", "caVoice"]) {
        expect(await inVisiblePanel(page.locator(`#${id}`)), `${id} should be available without scrolling`).toBe(true);
      }
      if (layout.mobile) {
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
        for (const id of ["audioButton", "seedAutomata", "randomizeAutomata"]) {
          const box = await page.locator(`#${id}`).boundingBox();
          expect(box.width, `${id} touch width`).toBeGreaterThanOrEqual(48);
          expect(box.height, `${id} touch height`).toBeGreaterThanOrEqual(48);
        }
      }
      if (layout.name === "phone landscape") {
        const stage = await page.locator(".stage").boundingBox();
        const panel = await page.locator(".experiment-panel").boundingBox();
        expect(stage.height).toBeGreaterThan(300);
        expect(panel.x).toBeGreaterThanOrEqual(stage.x + stage.width - 1);
      }

      // Let history fill the viewport quickly; live rate changes must retain its rows.
      const beforeRate = await generation(page);
      await page.locator("#caRate").evaluate((control) => {
        control.value = "24";
        control.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(await generation(page)).toBeGreaterThanOrEqual(beforeRate);
      await expect.poll(async () => {
        const draw = await raster(page);
        return draw.canvasHeight - draw.height <= draw.width / draw.columns + 2;
      }, { timeout: 15_000 }).toBe(true);
      const filled = await raster(page);
      expectFullWidthSquareCells(filled);
      expect(filled.y).toBeGreaterThanOrEqual(-filled.width / filled.columns - 1);
      expect(filled.y).toBeLessThanOrEqual(1);
      expect(filled.y + filled.height).toBeLessThanOrEqual(filled.canvasHeight + 1);

      // Every retained sound/rule parameter remains reachable through native disclosure and panel scrolling.
      await page.locator("#caSoundDetails > summary").click();
      const controlIds = await page.locator(".experiment-panel input[id], .experiment-panel select[id]")
        .evaluateAll((controls) => controls.filter((control) => !control.closest("#caRulePicker")).map((control) => control.id));
      for (const id of controlIds) {
        const control = page.locator(`#${id}`);
        await control.scrollIntoViewIfNeeded();
        expect(await inVisiblePanel(control), `${id} should be reachable by panel scrolling`).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      expect(await page.locator(".experiment-panel").evaluate((panel) => panel.scrollWidth - panel.clientWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");

      if (layout.name === "phone portrait") {
        const beforeSound = await generation(page);
        await page.locator("#caVoice").selectOption("glass-lattice");
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
        expect(await generation(page)).toBeGreaterThanOrEqual(beforeSound);
        await page.locator("#audioButton").click();
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
        await page.locator("#caVoice").selectOption("modal-fm");
        const beforeRotate = await generation(page);
        await page.setViewportSize({ width: 844, height: 390 });
        await settlePage(page);
        await expect(page.locator("#caVoice")).toHaveValue("modal-fm");
        await expect(page.locator("#caRate")).toHaveValue("24");
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
        await expect.poll(() => generation(page)).toBeGreaterThan(beforeRotate);
        expectFullWidthSquareCells(await raster(page));
        await page.locator("#audioButton").click();
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      }
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
