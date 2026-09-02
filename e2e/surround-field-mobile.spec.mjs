import { expect, test } from "@playwright/test";

import { settlePage } from "./helpers/diagnostics.mjs";

test.use({
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

const layouts = [
  { name: "phone portrait", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 },
];

async function swipeStageUp(page, context, viewport) {
  const client = await context.newCDPSession(page);
  const startY = Math.round(viewport.height * 0.62);
  const endY = Math.max(70, startY - 220);
  const point = (y) => ({ x: 8, y, radiusX: 1, radiusY: 1, force: 1, id: 1 });

  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(startY)],
  });
  for (let y = startY - 30; y > endY; y -= 30) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(y)],
    });
    await page.waitForTimeout(24);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("Surround Field keeps Play tappable and the room touch-scrollable on phones", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "touch regression uses Chromium CDP");

  for (const layout of layouts) {
    await test.step(layout.name, async () => {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await page.goto("surround-field.html", { waitUntil: "load" });
      await settlePage(page);

      const play = page.locator("#sequenceButton");
      await expect(play).toHaveCount(1);
      const geometry = await play.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
          viewport: { width: innerWidth, height: innerHeight },
          hit: hit === button || button.contains(hit),
          pointerEvents: getComputedStyle(button).pointerEvents,
          transportPosition: getComputedStyle(button.closest("#panelTransport")).position,
        };
      });

      expect(geometry.transportPosition).toBe("fixed");
      expect(geometry.rect.width).toBeGreaterThanOrEqual(44);
      expect(geometry.rect.height).toBeGreaterThanOrEqual(44);
      expect(geometry.rect.left).toBeGreaterThanOrEqual(0);
      expect(geometry.rect.top).toBeGreaterThanOrEqual(0);
      expect(geometry.rect.right).toBeLessThanOrEqual(geometry.viewport.width);
      expect(geometry.rect.bottom).toBeLessThanOrEqual(geometry.viewport.height);
      expect(geometry.pointerEvents).not.toBe("none");
      expect(geometry.hit).toBe(true);

      await page.touchscreen.tap(
        geometry.rect.left + geometry.rect.width / 2,
        geometry.rect.top + geometry.rect.height / 2,
      );
      await expect(play).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#panelTransport")).toHaveAttribute("data-state", "playing");

      await page.touchscreen.tap(
        geometry.rect.left + geometry.rect.width / 2,
        geometry.rect.top + geometry.rect.height / 2,
      );
      await expect(play).toHaveAttribute("aria-pressed", "false");

      const touchActions = await page.evaluate(() => ({
        stage: getComputedStyle(document.querySelector(".surround-stage-wrap")).touchAction,
        emitter: getComputedStyle(document.querySelector(".sound-emitter")).touchAction,
      }));
      expect(touchActions.stage).toContain("pan-y");
      expect(touchActions.emitter).toBe("none");

      await page.evaluate(() => window.scrollTo(0, 0));
      await swipeStageUp(page, context, layout);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    });
  }
});
