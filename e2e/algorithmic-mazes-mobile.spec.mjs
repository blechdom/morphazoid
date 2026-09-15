import { expect, test } from "@playwright/test";
import { generateMaze } from "../src/algorithmic-mazes.js";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const layouts = [
  { name: "phone portrait", width: 390, height: 844, mobile: true },
  { name: "phone landscape", width: 844, height: 390, mobile: true },
  { name: "desktop", width: 1440, height: 900, mobile: false },
];

async function inspectMaze(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      canvas: rect("#stage"),
      stage: rect(".maze-stage"),
      panel: rect(".maze-panel"),
      paint: { ...globalThis.__mazePaint },
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panelOverflow: document.querySelector(".maze-panel").scrollWidth - document.querySelector(".maze-panel").clientWidth,
      size: Number(document.querySelector("#size").value),
      seed: Number(document.querySelector("#seed").value),
      algorithm: document.querySelector("#algorithm").value,
    };
  });
}

function expectFittedMaze(report, maze) {
  const vertices = maze.cells.flatMap((cell) => cell.polygon);
  const world = {
    minX: Math.min(...vertices.map((vertex) => vertex.x)),
    minY: Math.min(...vertices.map((vertex) => vertex.y)),
    maxX: Math.max(...vertices.map((vertex) => vertex.x)),
    maxY: Math.max(...vertices.map((vertex) => vertex.y)),
  };
  const paintWidth = report.paint.maxX - report.paint.minX;
  const paintHeight = report.paint.maxY - report.paint.minY;
  const scaleX = paintWidth / (world.maxX - world.minX);
  const scaleY = paintHeight / (world.maxY - world.minY);
  expect(paintWidth).toBeGreaterThan(100);
  expect(paintHeight).toBeGreaterThan(100);
  expect(Math.abs(scaleX / scaleY - 1), "topology must retain its proportions").toBeLessThan(0.01);
  expect(report.paint.minX).toBeGreaterThanOrEqual(2);
  expect(report.paint.minY).toBeGreaterThanOrEqual(2);
  expect(report.paint.maxX).toBeLessThanOrEqual(report.canvas.width - 2);
  expect(report.paint.maxY).toBeLessThanOrEqual(report.canvas.height - 2);
  expect(Math.min(report.canvas.width - paintWidth, report.canvas.height - paintHeight), "maze should fill its limiting viewport dimension").toBeLessThanOrEqual(30);
  return { world, scaleX, scaleY };
}

for (const layout of layouts) {
  test(`Mazes fills the stage without distorting cells on ${layout.name}`, async ({ browser, baseURL }) => {
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
      // Measure the actual painted paths, including current Canvas transforms.
      await page.addInitScript(() => {
        const clearRect = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
          if (this.canvas.id === "stage") {
            globalThis.__mazePaint = {
              minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
              frame: (globalThis.__mazePaint?.frame ?? 0) + 1,
            };
          }
          return clearRect.apply(this, args);
        };
        for (const method of ["moveTo", "lineTo"]) {
          const original = CanvasRenderingContext2D.prototype[method];
          CanvasRenderingContext2D.prototype[method] = function (x, y) {
            if (this.canvas.id === "stage" && globalThis.__mazePaint) {
              const transform = this.getTransform();
              const ratio = Math.min(2, devicePixelRatio);
              const px = (transform.a * x + transform.c * y + transform.e) / ratio;
              const py = (transform.b * x + transform.d * y + transform.f) / ratio;
              const bounds = globalThis.__mazePaint;
              bounds.minX = Math.min(bounds.minX, px);
              bounds.minY = Math.min(bounds.minY, py);
              bounds.maxX = Math.max(bounds.maxX, px);
              bounds.maxY = Math.max(bounds.maxY, py);
            }
            return original.call(this, x, y);
          };
        }
      });
      const response = await page.goto("./algorithmic-mazes.html", { waitUntil: "domcontentloaded" });
      expect(response?.ok()).toBe(true);
      await settlePage(page);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");

      const initial = await inspectMaze(page);
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

      for (const topology of ["orthogonal", "radial", "hexagonal"]) {
        const beforeFrame = (await inspectMaze(page)).paint.frame;
        await page.locator(`[data-maze-topology="${topology}"]`).click();
        await expect.poll(async () => (await inspectMaze(page)).paint.frame).toBeGreaterThan(beforeFrame);
        const report = await inspectMaze(page);
        expectFittedMaze(report, generateMaze({ ...report, topology }));
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      }

      // Resizing must preserve transport, and a tap must still pick the visible boundary cell.
      await page.locator("#playButton").click();
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
      const heldPosition = await page.locator("#position").inputValue();
      const resized = layout.name === "phone portrait" ? { width: 844, height: 390 }
        : layout.name === "phone landscape" ? { width: 390, height: 844 }
          : { width: 1280, height: 800 };
      await page.setViewportSize(resized);
      await settlePage(page);
      await expect(page.locator("#position")).toHaveValue(heldPosition);
      const report = await inspectMaze(page);
      const maze = generateMaze({ ...report, topology: "hexagonal" });
      const fit = expectFittedMaze(report, maze);
      const boundaryCell = maze.cells.reduce((rightmost, cell) => cell.center.x > rightmost.center.x ? cell : rightmost);
      const x = report.canvas.x + report.paint.minX + (boundaryCell.center.x - fit.world.minX) * fit.scaleX;
      const y = report.canvas.y + report.paint.maxY - (boundaryCell.center.y - fit.world.minY) * fit.scaleY;
      if (layout.mobile) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await expect(page.locator("#liveStatus")).toHaveText(`Solver target moved to cell ${boundaryCell.id + 1}.`);
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");

      if (layout.name === "phone portrait") {
        await page.locator("#audioButton").click();
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
        await page.locator("#playButton").click();
        const before = Number(await page.locator("#position").inputValue());
        await page.locator("#algorithm").selectOption("prim");
        await page.setViewportSize({ width: 390, height: 844 });
        await settlePage(page);
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => Number(await page.locator("#position").inputValue())).toBeGreaterThan(before);
        await page.locator("#audioButton").click();
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      }
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
