import { expect, test } from "@playwright/test";
import { generatePath } from "../src/instruments/paths/paths.js";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const layouts = [
  { name: "phone portrait", width: 390, height: 844, mobile: true },
  { name: "phone landscape", width: 844, height: 390, mobile: true },
  { name: "desktop", width: 1440, height: 900, mobile: false },
];

async function inspectPath(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      canvas: rect("#stage"),
      stage: rect(".paths-stage"),
      panel: rect(".paths-panel"),
      paint: { ...globalThis.__pathsPaint },
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panelOverflow: document.querySelector(".paths-panel").scrollWidth - document.querySelector(".paths-panel").clientWidth,
      settings: {
        family: document.querySelector("#pathFamily").value,
        detail: Number(document.querySelector("#detail").value),
        aspect: Number(document.querySelector("#aspect").value),
        seed: Number(document.querySelector("#seed").value),
      },
    };
  });
}

function expectFittedPath(report) {
  const points = generatePath(report.settings).points;
  const worldWidth = Math.max(...points.map(({ x }) => x)) - Math.min(...points.map(({ x }) => x));
  const worldHeight = Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y));
  const paintWidth = report.paint.maxX - report.paint.minX;
  const paintHeight = report.paint.maxY - report.paint.minY;
  expect(paintWidth).toBeGreaterThan(80);
  expect(paintHeight).toBeGreaterThan(80);
  expect(Math.abs((paintWidth / worldWidth) / (paintHeight / worldHeight) - 1), "generated path proportions must survive viewport fitting").toBeLessThan(0.001);
  expect(report.paint.minX).toBeGreaterThanOrEqual(2);
  expect(report.paint.minY).toBeGreaterThanOrEqual(2);
  expect(report.paint.maxX).toBeLessThanOrEqual(report.canvas.width - 2);
  expect(report.paint.maxY).toBeLessThanOrEqual(report.canvas.height - 2);
  expect(Math.min(report.canvas.width - paintWidth, report.canvas.height - paintHeight), "path should fill its limiting viewport dimension").toBeLessThanOrEqual(30);
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((control, next) => {
    control.value = String(next);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function scrub(page, context, canvas, mobile) {
  const from = { x: canvas.x + canvas.width * 0.2, y: canvas.y + canvas.height * 0.5 };
  const to = { x: canvas.x + canvas.width * 0.55, y: from.y };
  if (mobile) {
    const session = await context.newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
      await expect(page.locator("#stageWrap")).toHaveClass(/is-scrubbing/);
      for (let step = 1; step <= 4; step += 1) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: from.x + (to.x - from.x) * step / 4, y: from.y }],
        });
      }
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally {
      await session.detach();
    }
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
  }
  await expect(page.locator("#stageWrap")).not.toHaveClass(/is-scrubbing/);
}

for (const layout of layouts) {
  test(`Paths fits each family and keeps scrubbing aligned on ${layout.name}`, async ({ browser, baseURL }) => {
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
      // Capture actual stroked geometry; short playhead marks are excluded.
      await page.addInitScript(() => {
        const bounds = () => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 });
        const beginPath = CanvasRenderingContext2D.prototype.beginPath;
        CanvasRenderingContext2D.prototype.beginPath = function (...args) {
          if (this.canvas.id === "stage") this.__pathBounds = bounds();
          return beginPath.apply(this, args);
        };
        for (const method of ["moveTo", "lineTo"]) {
          const original = CanvasRenderingContext2D.prototype[method];
          CanvasRenderingContext2D.prototype[method] = function (x, y) {
            if (this.canvas.id === "stage" && this.__pathBounds) {
              const transform = this.getTransform();
              const ratio = Math.min(2, devicePixelRatio);
              const px = (transform.a * x + transform.c * y + transform.e) / ratio;
              const py = (transform.b * x + transform.d * y + transform.f) / ratio;
              const current = this.__pathBounds;
              current.minX = Math.min(current.minX, px);
              current.minY = Math.min(current.minY, py);
              current.maxX = Math.max(current.maxX, px);
              current.maxY = Math.max(current.maxY, py);
              current.count += 1;
            }
            return original.call(this, x, y);
          };
        }
        const stroke = CanvasRenderingContext2D.prototype.stroke;
        CanvasRenderingContext2D.prototype.stroke = function (...args) {
          if (this.canvas.id === "stage" && this.__pathBounds?.count > 20) {
            globalThis.__pathsPaint = {
              ...this.__pathBounds,
              serial: (globalThis.__pathsPaint?.serial ?? 0) + 1,
            };
          }
          return stroke.apply(this, args);
        };
      });
      const response = await page.goto("./paths.html", { waitUntil: "domcontentloaded" });
      expect(response?.ok()).toBe(true);
      await settlePage(page);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
      await page.locator('[data-path-mode="trace"]').click();
      await settlePage(page);
      const initial = await inspectPath(page);
      expect(Math.abs(initial.canvas.width - initial.stage.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(initial.canvas.height - initial.stage.height)).toBeLessThanOrEqual(1);
      expect(initial.overflow).toBeLessThanOrEqual(1);
      expect(initial.panelOverflow).toBeLessThanOrEqual(1);
      const play = await page.locator("#playButton").boundingBox();
      expect(play.y + play.height).toBeLessThanOrEqual(layout.height);
      if (layout.mobile) {
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
        for (const id of ["audioButton", "playButton", "directionButton"]) {
          const box = await page.locator(`#${id}`).boundingBox();
          expect(box.width).toBeGreaterThanOrEqual(48);
          expect(box.height).toBeGreaterThanOrEqual(48);
        }
      }
      if (layout.name === "phone landscape") {
        expect(initial.stage.height).toBeGreaterThan(300);
        expect(initial.panel.x).toBeGreaterThanOrEqual(initial.stage.x + initial.stage.width - 1);
      }

      for (const [family, aspect] of [
        ["gilbert", 0.55], ["gilbert", 1], ["gilbert", 2.4],
        ["hilbert", 1], ["gosper", 1.55], ["dragon", 0.7], ["walk", 2.4],
      ]) {
        await page.locator("#pathFamily").selectOption(family);
        const previousSerial = (await inspectPath(page)).paint.serial;
        await setRange(page, "#aspect", aspect);
        await expect.poll(async () => (await inspectPath(page)).paint.serial).toBeGreaterThan(previousSerial);
        expectFittedPath(await inspectPath(page));
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      }

      await page.locator("#playButton").click();
      await setRange(page, "#position", 0.25);
      const resized = layout.name === "phone portrait" ? { width: 844, height: 390 }
        : layout.name === "phone landscape" ? { width: 390, height: 844 }
          : { width: 1280, height: 800 };
      await page.setViewportSize(resized);
      await settlePage(page);
      await expect(page.locator("#position")).toHaveValue("0.25");
      const rotated = await inspectPath(page);
      expectFittedPath(rotated);
      await scrub(page, context, rotated.canvas, layout.mobile);
      await expect.poll(async () => Math.abs(Number(await page.locator("#position").inputValue()) - 0.6)).toBeLessThan(0.005);
      await page.locator("#stage").focus();
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => Math.abs(Number(await page.locator("#position").inputValue()) - 0.61)).toBeLessThan(0.005);
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");

      if (layout.name === "phone portrait") {
        await page.locator("#audioButton").click();
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
        await page.locator("#playButton").click();
        const before = Number(await page.locator("#position").inputValue());
        await page.locator("#pathFamily").selectOption("gilbert");
        await page.setViewportSize({ width: 390, height: 844 });
        await settlePage(page);
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => Number(await page.locator("#position").inputValue())).toBeGreaterThan(before);
        await page.locator("#audioButton").click();
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
      }
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
