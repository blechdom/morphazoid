import { expect, test } from "@playwright/test";

import {
  pageDiagnosticMessages,
  settlePage,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";

const testBaseUrl = process.env.MORPHAZOID_E2E_BASE_URL
  ?? "http://127.0.0.1:3435";
const chiptuneHref = new URL("webgpu-chiptune.html", testBaseUrl).href;

const layouts = Object.freeze([
  Object.freeze({ name: "desktop", width: 1440, height: 900, coarse: false }),
  Object.freeze({ name: "phone portrait", width: 390, height: 844, coarse: true }),
  Object.freeze({ name: "phone landscape", width: 844, height: 390, coarse: true }),
]);

test("WebGPU Chiptune keeps Play in the masthead and separate from Audio", async ({ page }) => {
  const response = await page.goto(chiptuneHref, { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await settlePage(page);

  const play = page.locator("#synthPlayButton");
  const audio = page.locator("#audioButton");
  const transport = page.locator("[data-chiptune-top-transport]");

  await expect(play).toHaveCount(1);
  await expect(page.locator("[data-primary-transport]")).toHaveCount(1);
  await expect(transport.locator("#synthPlayButton")).toHaveCount(1);
  expect(await play.evaluate((element) => Boolean(element.closest("details, aside")))).toBe(false);
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(audio).toHaveAttribute("aria-pressed", "false");

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#stageReadout")).toContainText("VISUAL TRANSPORT PLAYING");

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#stageReadout")).toContainText("STANDBY");
});

test("clicking a performer focuses only its sequence without changing XY effects", async ({ page }) => {
  const response = await page.goto(chiptuneHref, { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await settlePage(page);

  const canvas = page.locator("#characterStage");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const arpOutput = page.locator('[data-character-fx-output="arp"]');
  const arpBeforeClick = await arpOutput.textContent();

  await canvas.click({
    position: {
      x: box.width * 0.75,
      y: box.height * 0.38,
    },
  });

  await expect(page.locator('[data-character-voice="arp"]')).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.locator("#selectedPerformerName")).toHaveText("ARP");
  await expect(page.locator("#selectedPerformerHint")).toContainText(
    "resolved arpeggio pitch you hear",
  );
  await expect(page.locator("#sequenceVoiceTabs button:visible")).toHaveCount(1);
  await expect(page.locator('#sequenceLane-arp:not([hidden])')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await arpOutput.textContent()).toBe(arpBeforeClick);

  await canvas.click({
    position: {
      x: box.width * 0.915,
      y: box.height * 0.38,
    },
  });

  await expect(page.locator("#selectedPerformerName")).toHaveText("DRUMS");
  await expect(page.locator("#sequenceVoiceTabs button:visible")).toHaveCount(4);
  await page.locator("#sequenceLane-snare").click();
  await expect(page.locator("#sequenceLane-snare")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sequenceStateNote")).toHaveText("DRAW HIT ●");
  await expect(page.locator("#sequenceStateRest")).toHaveText("SILENCE ×");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
});

test("reloading a preset restores its sequence after customization", async ({ page }) => {
  const response = await page.goto(chiptuneHref, { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await settlePage(page);

  await expect(page.locator("#sequenceStatus")).toContainText("PRESET NOTE");
  await page.locator("#sequenceStateRest").click();
  await expect(page.locator("#sequenceStatus")).toContainText("SILENT");
  await expect(page.locator("#sequenceSourceCoverage")).toContainText("1 custom edit");

  const preset = page.locator('[data-preset-id="source-tracker"]');
  await expect(preset).toHaveAttribute("aria-pressed", "false");
  await preset.click();
  await expect(preset).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sequenceStatus")).toContainText("PRESET NOTE");
  await expect(page.locator("#sequenceSourceCoverage")).toContainText("0 custom edits");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
});

test("WebGPU Chiptune character bays perform XY effects, mute, and multi-solo without arming Audio", async ({ page }) => {
  const response = await page.goto(chiptuneHref, { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await settlePage(page);

  const audio = page.locator("#audioButton");
  const play = page.locator("#synthPlayButton");
  const canvas = page.locator("#characterStage");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-character-mute]")).toHaveCount(6);
  await expect(page.locator("[data-character-solo]")).toHaveCount(6);

  const upperMute = page.locator('[data-character-mute="upperOne"]');
  await upperMute.click();
  await expect(upperMute).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-character-voice="upperOne"]')).toHaveAttribute(
    "data-audible",
    "false",
  );

  const leadSolo = page.locator('[data-character-solo="lead"]');
  const arpSolo = page.locator('[data-character-solo="arp"]');
  await leadSolo.click();
  await expect(leadSolo).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-character-voice="lead"]')).toHaveAttribute(
    "data-audible",
    "true",
  );
  await expect(page.locator('[data-character-voice="bass"]')).toHaveAttribute(
    "data-audible",
    "false",
  );
  await arpSolo.click();
  await expect(page.locator('[data-character-voice="lead"]')).toHaveAttribute(
    "data-audible",
    "true",
  );
  await expect(page.locator('[data-character-voice="arp"]')).toHaveAttribute(
    "data-audible",
    "true",
  );

  const bassOutput = page.locator('[data-character-fx-output="bass"]');
  const beforeDrag = await bassOutput.textContent();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width * 0.39, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.22, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-character-voice="bass"]')).toHaveAttribute(
    "data-active",
    "true",
  );
  expect(await bassOutput.textContent()).not.toBe(beforeDrag);

  await canvas.focus();
  await page.keyboard.press("PageDown");
  await expect(canvas).toHaveAttribute("aria-label", /LEAD selected/);
  const leadOutput = page.locator('[data-character-fx-output="lead"]');
  const beforeKey = await leadOutput.textContent();
  await page.keyboard.press("ArrowRight");
  expect(await leadOutput.textContent()).not.toBe(beforeKey);
  await page.keyboard.press("Home");
  await page.keyboard.press("m");
  await expect(page.locator('[data-character-mute="lead"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const drumsOutput = page.locator('[data-character-fx-output="drums"]');
  const beforeDrumDrag = await drumsOutput.textContent();
  await page.mouse.move(box.x + box.width * 0.87, box.y + box.height * 0.56);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.96, box.y + box.height * 0.18, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-character-voice="drums"]')).toHaveAttribute(
    "data-active",
    "true",
  );
  expect(await drumsOutput.textContent()).not.toBe(beforeDrumDrag);
  const drumsSolo = page.locator('[data-character-solo="drums"]');
  await drumsSolo.click();
  await expect(drumsSolo).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-character-voice="drums"]')).toHaveAttribute(
    "data-audible",
    "true",
  );

  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#stageReadout")).toContainText("STANDBY");
});

test("WebGPU Chiptune top transport and character stage fit supported layouts", async ({ browser }) => {
  for (const layout of layouts) {
    await test.step(layout.name, async () => {
      const context = await browser.newContext({
        viewport: { width: layout.width, height: layout.height },
        colorScheme: "dark",
        reducedMotion: "no-preference",
        ...(layout.coarse ? { hasTouch: true, isMobile: true } : {}),
      });
      try {
        const page = await context.newPage();
        const diagnostics = watchPageDiagnostics(page, { baseURL: testBaseUrl });
        const response = await page.goto(chiptuneHref, { waitUntil: "domcontentloaded" });
        expect(response?.ok()).toBe(true);
        await settlePage(page);
        await expect(page.locator(".masthead.has-midi-toolbar")).toHaveCount(1);

        const report = await page.evaluate(() => {
          const rectangle = (target) => {
            const element = typeof target === "string" ? document.querySelector(target) : target;
            const rect = element?.getBoundingClientRect();
            if (!rect) return null;
            return {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            };
          };
          const rects = {
            play: rectangle("#synthPlayButton"),
            audio: rectangle("#audioButton"),
            output: rectangle(".header-level"),
            transport: rectangle("[data-chiptune-top-transport]"),
            canvas: rectangle("#characterStage"),
          };
          const characterButtons = [...document.querySelectorAll(
            "[data-character-mute], [data-character-solo]",
          )].map((button) => rectangle(button));
          return {
            rects,
            characterButtons,
            overflow: document.documentElement.scrollWidth
              - document.documentElement.clientWidth,
            canvasWidth: document.querySelector("#characterStage")?.width ?? 0,
            canvasHeight: document.querySelector("#characterStage")?.height ?? 0,
          };
        });

        expect(report.overflow).toBeLessThanOrEqual(1);
        for (const [name, rect] of Object.entries(report.rects)) {
          expect(rect, name + " must render").not.toBeNull();
          expect(rect.left, name + " left edge").toBeGreaterThanOrEqual(-1);
          expect(rect.top, name + " top edge").toBeGreaterThanOrEqual(-1);
          expect(rect.right, name + " right edge").toBeLessThanOrEqual(layout.width + 1);
          expect(rect.bottom, name + " bottom edge").toBeLessThanOrEqual(layout.height + 1);
        }

        const overlaps = (left, right) => (
          left.left < right.right
          && left.right > right.left
          && left.top < right.bottom
          && left.bottom > right.top
        );
        expect(overlaps(report.rects.play, report.rects.output)).toBe(false);
        expect(overlaps(report.rects.play, report.rects.audio)).toBe(false);
        expect(overlaps(report.rects.output, report.rects.audio)).toBe(false);
        expect(report.rects.output.width).toBeGreaterThanOrEqual(80);
        expect(report.rects.canvas.width).toBeGreaterThan(300);
        expect(report.rects.canvas.height).toBeGreaterThan(100);
        expect(report.canvasWidth).toBeGreaterThan(0);
        expect(report.canvasHeight).toBeGreaterThan(0);
        expect(report.characterButtons).toHaveLength(12);
        for (const rect of report.characterButtons) {
          expect(rect.width).toBeGreaterThanOrEqual(24);
          expect(rect.height).toBeGreaterThanOrEqual(24);
        }
        if (layout.coarse) {
          expect(report.rects.play.width).toBeGreaterThanOrEqual(48);
          expect(report.rects.play.height).toBeGreaterThanOrEqual(48);
          expect(report.rects.audio.width).toBeGreaterThanOrEqual(48);
          expect(report.rects.audio.height).toBeGreaterThanOrEqual(48);
        }
        expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
