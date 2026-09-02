import { expect, test } from "@playwright/test";

test("Enveloper hands silent playback to an audio-priority transport", async ({ page }) => {
  await page.goto("/enveloper.html", { waitUntil: "domcontentloaded" });

  const audio = page.locator("#audioButton");
  const play = page.locator("#playButton");
  const position = page.locator("#position");

  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#timingPriority")).toHaveAttribute("data-state", "off");
  await expect(page.locator("#stage")).toHaveAttribute("data-clock-source", "performance");

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(0.005);

  await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "true");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#timingPriority")).toHaveAttribute("data-state", "audio");
  await expect(page.locator("#timingClock")).toContainText("AudioContext clock");
  await expect(page.locator("#stage")).toHaveAttribute("data-clock-source", "audio-context");
  await expect(page.locator("#stage")).toHaveAttribute("data-scheduler-state", "running");
  await expect(page.locator("#stage")).toHaveAttribute("data-scheduler-interval-ms", "25");
  await expect(page.locator("#stage")).toHaveAttribute("data-lookahead-ms", "160");
  await expect(page.locator("#stage")).toHaveAttribute("data-transport-lead-ms", "60");
  await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-next-event-ordinal"))).toBeGreaterThan(0);

  const stage = page.locator("#stage");
  const revisionBeforeEdit = Number(await stage.getAttribute("data-transport-revision"));
  await page.locator("#fmAmount").evaluate((input) => {
    input.value = "1.2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(async () => Number(await stage.getAttribute("data-transport-revision"))).toBeGreaterThan(revisionBeforeEdit);
  await expect(stage).toHaveAttribute("data-transport-resync", "fm-amount");
  await expect(stage).toHaveAttribute("data-transport-lead-ms", "25");
  await expect(stage).toHaveAttribute("data-scheduler-state", "running");

  await page.locator("#cycleSeconds").evaluate((input) => {
    input.value = "4";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(stage).toHaveAttribute("data-transport-resync", "cycle-duration");
  await page.locator("#evenSplitsButton").evaluate((button) => button.click());
  await expect(stage).toHaveAttribute("data-transport-resync", "even-splits");
  await expect(stage).toHaveAttribute("data-scheduler-state", "running");

  await page.evaluate(() => {
    const until = performance.now() + 700;
    while (performance.now() < until) { /* Deliberately delay only the wake-up timer. */ }
  });
  await expect.poll(async () => Number(await stage.getAttribute("data-late-recovery"))).toBeGreaterThan(0);
  await expect(stage).toHaveAttribute("data-late-recovery-mode", "single-fragment");
  await expect(stage).toHaveAttribute("data-transport-lead-ms", "25");

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  });
  await expect(stage).toHaveAttribute("data-page-lifecycle", "cached");
  await expect(stage).toHaveAttribute("data-scheduler-state", "stopped");
  const frozenPosition = Number(await position.inputValue());
  await page.waitForTimeout(90);
  expect(Number(await position.inputValue())).toBeCloseTo(frozenPosition, 5);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(stage).toHaveAttribute("data-page-lifecycle", "restored");
  await expect(stage).toHaveAttribute("data-scheduler-state", "running");
  await expect.poll(async () => Number(await position.inputValue())).not.toBeCloseTo(frozenPosition, 3);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(stage).toHaveAttribute("data-page-lifecycle", "restored");
  await expect(stage).toHaveAttribute("data-scheduler-state", "stopped");
  await expect(page.locator("#timingPriority")).toHaveAttribute("data-state", "syncing");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(stage).toHaveAttribute("data-scheduler-state", "running");
  await expect(stage).toHaveAttribute("data-transport-resync", "visible");

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(stage).toHaveAttribute("data-scheduler-state", "stopped");
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(stage).toHaveAttribute("data-scheduler-state", "running");

  await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#timingPriority")).toHaveAttribute("data-state", "off");
  await expect(page.locator("#stage")).toHaveAttribute("data-clock-source", "performance");
  await expect(page.locator("#stage")).toHaveAttribute("data-scheduler-state", "stopped");

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
});

test("Enveloper resumes a suspended audio clock from Play", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!NativeAudioContext) return;
    class ObservableAudioContext extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        window.__enveloperAudioContext = this;
      }
    }
    if (window.AudioContext) window.AudioContext = ObservableAudioContext;
    else window.webkitAudioContext = ObservableAudioContext;
  });
  await page.goto("/enveloper.html", { waitUntil: "domcontentloaded" });

  const audio = page.locator("#audioButton");
  const play = page.locator("#playButton");
  const stage = page.locator("#stage");
  await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => window.__enveloperAudioContext.suspend());
  await expect(page.locator("#timingPriority")).toHaveAttribute("data-state", "syncing");

  await page.waitForTimeout(80);
  await page.locator("#restartButton").click();
  await expect.poll(async () => Number(await page.locator("#position").inputValue())).toBeLessThan(0.005);
  await expect(stage).toHaveAttribute("data-scheduler-state", "stopped");

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#timingPriority")).toHaveAttribute("data-state", "audio");
  await expect(stage).toHaveAttribute("data-scheduler-state", "running");
  await expect(stage).toHaveAttribute("data-transport-resync", /play-resume|context-resume/);
});

test("Enveloper exposes all nine leaf XY and dual-contour controls without requiring the canvas", async ({ page }) => {
  await page.goto("/enveloper.html", { waitUntil: "domcontentloaded" });
  const selection = page.locator("details.enveloper-selection");
  await selection.locator(":scope > summary").click();
  await selection.locator('[data-leaf="8"]').click();

  await expect(page.locator("#stage")).toHaveAttribute("data-leaf-count", "9");
  await expect(page.locator("#stage")).toHaveAttribute("data-contours-per-leaf", "2");
  await expect(page.locator("#stage")).toHaveAttribute("data-rendered-leaf-contours", "18");
  await expect(page.locator("#selectionSummary")).toContainText("leaf 09");
  await expect(page.locator("#leafInspector")).toBeVisible();
  await expect(page.locator('[data-envelope-kind="pitch"]')).toHaveCount(4);
  await expect(page.locator('[data-envelope-kind="index"]')).toHaveCount(4);
  await expect(page.locator("#ancestorBendOut")).toContainText(/Ancestor bend [+-]?\d+\.\d st/);
  await page.locator("#selectedTimbre").evaluate((input) => {
    input.value = "0.93";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#selectedTimbreOut")).toHaveText("93%");

  await page.locator("#pitchEnvelopeLevel1").evaluate((input) => {
    input.value = "0.17";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#pitchEnvelopeLevel1Out")).toHaveText("17%");
  await page.locator("#indexEnvelopeLevel2").evaluate((input) => {
    input.value = "0.84";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#indexEnvelopeLevel2Out")).toHaveText("84%");
  await expect(page.locator("#treeState")).toHaveText("custom");

  await selection.locator('[data-leaf="7"]').click();
  await selection.locator('[data-leaf="8"]').click();
  await expect(page.locator("#pitchEnvelopeLevel1")).toHaveValue("0.17");
  await expect(page.locator("#indexEnvelopeLevel2")).toHaveValue("0.84");

  await selection.locator('[data-leaf="0"]').click();
  const bendBefore = await page.locator("#ancestorBendOut").textContent();
  const canvas = page.locator("#stage");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const compact = bounds.height < 470 || bounds.width < 620;
  const left = compact ? 18 : Math.max(34, bounds.width * 0.045);
  const top = compact ? 50 : 62;
  const bottomInset = compact ? 28 : 42;
  const usableHeight = Math.max(92, bounds.height - top - bottomInset);
  const rootBottom = top + usableHeight * 0.22;
  const rootNodeY = rootBottom + (top - rootBottom) * 0.72;
  await canvas.click({ position: { x: left, y: rootNodeY } });
  await expect(page.locator("#selectionSummary")).toContainText("parent · node 1");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await selection.locator('[data-leaf="0"]').click();
  await expect.poll(() => page.locator("#ancestorBendOut").textContent()).not.toBe(bendBefore);
  await expect(page.locator("#stage")).toHaveAttribute("data-rendered-leaf-contours", "18");
});
