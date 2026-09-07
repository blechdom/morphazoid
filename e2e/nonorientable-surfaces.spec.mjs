import { expect, test } from "@playwright/test";

import {
  readAudioStatus,
  sampleAudioEnvelope,
  waitForAudioState,
  waitForStableAudioState,
} from "./helpers/audio-probe.mjs";

const surfaces = [
  { id: "moebius", href: "moebius.html" },
  { id: "klein-bottle", href: "klein-bottle.html" },
];

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

for (const surface of surfaces) {
  test(`${surface.id} keeps its 2D playhead, transport, view, and audio causally separate`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(surface.href, { waitUntil: "load" });
    const canvas = page.locator("#stage");
    const play = page.locator("#playButton");
    const audio = page.locator("#audioButton");
    await expect(canvas).toBeVisible();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).active).toBe(false);

    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#liveStatus")).toHaveText(
      "Audio is off — turn it on to hear playback",
    );

    await canvas.focus();
    const positionBefore = Number(await page.locator("#position").inputValue());
    await page.keyboard.press("ArrowRight");
    expect(Number(await page.locator("#position").inputValue())).toBeGreaterThan(positionBefore);
    const yawBefore = Number(await page.locator("#planeYaw").inputValue());
    await page.keyboard.press("Shift+BracketLeft");
    expect(Number(await page.locator("#planeYaw").inputValue())).toBe(yawBefore - 12);
    await page.keyboard.press("Home");
    expect(Number(await page.locator("#position").inputValue())).toBeCloseTo(0.5, 1);

    const autoRotate = page.locator("#autoRotateButton");
    await page.locator('[data-section="rotation"]').evaluate((details) => { details.open = true; });
    await autoRotate.click();
    await expect(autoRotate).toHaveAttribute("aria-pressed", "true");
    await setRange(page, "#rotationSpeed", 0.08);
    await expect(autoRotate).toHaveAttribute("aria-pressed", "true");
    await setRange(page, "#rotationX", 16);
    await expect(autoRotate).toHaveAttribute("aria-pressed", "false");

    await page.locator("[data-preset]").last().click();
    await expect(play).toHaveAttribute("aria-pressed", "true");

    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "true");
    await waitForAudioState(page, true);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 50 });
    await testInfo.attach(`${surface.id}-audio-envelope.json`, {
      body: JSON.stringify(envelope, null, 2),
      contentType: "application/json",
    });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.activeSamples).toBeGreaterThan(0);
    expect(envelope.summary.maxPeak).toBeGreaterThan(0.001);
    expect(envelope.summary.clippedSamples).toBe(0);

    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await waitForStableAudioState(page, false);
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
  });
}

test("Mobius counterpoint weave hockets across the orientation reversal", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("moebius.html", { waitUntil: "load" });
  const canvas = page.locator("#stage");
  const play = page.locator("#playButton");
  const audio = page.locator("#audioButton");
  const planeMode = page.locator("#selectPlaneMode");
  const sequenceMode = page.locator("#selectSequenceMode");
  const sequenceState = page.locator("#sequenceState");

  await expect(planeMode).toHaveAttribute("aria-pressed", "true");
  await expect(sequenceMode).toHaveAttribute("aria-pressed", "false");
  await expect(sequenceState).toBeHidden();
  await page.locator("#directionButton").click();
  await expect(page.locator("#directionButton")).toContainText("reverse");

  await sequenceMode.click();
  await expect(sequenceMode).toHaveAttribute("aria-pressed", "true");
  await expect(planeMode).toHaveAttribute("aria-pressed", "false");
  await expect(sequenceState).toBeVisible();
  await expect(page.locator("#stageWrap")).toHaveAttribute("data-play-mode", "sequence");
  await expect(page.locator("#directionButton")).toBeDisabled();
  await expect(page.locator("#directionButton")).toContainText("forward (fixed)");
  await expect(page.locator("#planeYaw")).toBeDisabled();
  await expect(page.locator("#planePitch")).toBeDisabled();
  await expect(page.locator("#soundMode")).toBeDisabled();
  await expect(canvas).toHaveAttribute("aria-label", /sixteen Mobius stations/);
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(sequenceState).not.toHaveAttribute("aria-live", "polite");
  await expect(page.locator('[data-section="form"] .control-note')).toContainText(
    "visible strip only",
  );
  await expect(canvas).toHaveAttribute("data-sequence-role", "subject");
  await setRange(page, "#position", 0.532);
  await expect(canvas).toHaveAttribute("data-sequence-role", "answer");
  await expect(sequenceState).toContainText("NOW ANSWER");
  await setRange(page, "#position", 0.5);
  await expect(sequenceState).toContainText("NOW SUBJECT");

  await setRange(page, "#position", 0.99);
  await setRange(page, "#speed", 1.2);
  await play.click();
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(canvas).toHaveAttribute("data-sequence-pass", "2", { timeout: 2_000 });
  await expect(sequenceState).toContainText("PASS 2 / ORIENTATION B / SHADOW");
  await play.click();

  await setRange(page, "#position", 0.25);
  await expect(canvas).toHaveAttribute("data-sequence-pass", "2");
  await canvas.focus();
  await page.keyboard.press("Home");
  expect(Number(await page.locator("#position").inputValue())).toBeCloseTo(0, 4);
  await expect(canvas).toHaveAttribute("data-sequence-pass", "2");
  await setRange(page, "#position", 1);
  await expect(canvas).toHaveAttribute("data-sequence-pass", "1");
  expect(Number(await page.locator("#position").inputValue())).toBeCloseTo(0, 4);

  await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "true");
  await waitForAudioState(page, true);
  await play.click();
  await setRange(page, "#surfaceRadius", 0.8);
  await expect(play).toHaveAttribute("aria-pressed", "true");
  const envelope = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 40 });
  await testInfo.attach("moebius-counterpoint-envelope.json", {
    body: JSON.stringify(envelope, null, 2),
    contentType: "application/json",
  });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.activeSamples).toBeGreaterThan(0);
  expect(envelope.summary.maxPeak).toBeGreaterThan(0.001);
  expect(envelope.summary.clippedSamples).toBe(0);
  await play.click();
  await audio.click();
  await waitForStableAudioState(page, false);

  await planeMode.click();
  await expect(sequenceState).toBeHidden();
  await expect(page.locator("#directionButton")).toBeEnabled();
  await expect(page.locator("#directionButton")).toContainText("reverse");
  await expect(page.locator("#soundMode")).toBeEnabled();
  await expect(page.locator("#selectPlayhead")).toBeEnabled();

  await sequenceMode.click();
  await page.locator("#resetAll").click();
  await expect(planeMode).toHaveAttribute("aria-pressed", "true");
  await expect(sequenceState).toBeHidden();
  expect(errors).toEqual([]);
});

test.describe("touch-sized responsive topology controls", () => {
  test.use({ hasTouch: true });

  for (const surface of surfaces) {
    test(`${surface.id} stays reachable at required viewports`, async ({ page }) => {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(surface.href, { waitUntil: "load" });

        const layout = await page.evaluate(() => {
          const rect = (selector) => {
            const box = document.querySelector(selector)?.getBoundingClientRect();
            return box ? {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
              width: box.width,
              height: box.height,
            } : null;
          };
          const identity = rect(".topology-identity");
          const target = rect(".topology-target-switch");
          const overlaps = identity && target
            ? !(identity.right <= target.left || target.right <= identity.left
              || identity.bottom <= target.top || target.bottom <= identity.top)
            : true;
          return {
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            panelOverflow: document.querySelector(".topology-panel").scrollWidth
              - document.querySelector(".topology-panel").clientWidth,
            canvas: rect("#stage"),
            overlaps,
          };
        });

        expect(layout.documentOverflow).toBeLessThanOrEqual(1);
        expect(layout.panelOverflow).toBeLessThanOrEqual(1);
        expect(layout.canvas.width).toBeGreaterThan(100);
        expect(layout.canvas.height).toBeGreaterThan(100);
        if (viewport.height <= 430) expect(layout.overlaps).toBe(false);

        for (const selector of [
          "#audioButton",
          "#playButton",
          "#directionButton",
          "#resetAll",
        ]) {
          if (surface.id === "moebius") {
            await expect(page.locator("#selectSequenceMode")).toBeVisible();
          }
          const box = await page.locator(selector).boundingBox();
          expect(box.width, `${selector} width at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(48);
          expect(box.height, `${selector} height at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(48);
        }

        if (surface.id === "moebius") {
          for (const selector of ["#selectPlaneMode", "#selectSequenceMode"]) {
            const box = await page.locator(selector).boundingBox();
            expect(
              box.width,
              `${selector} width at ${viewport.width}x${viewport.height}`,
            ).toBeGreaterThanOrEqual(48);
            expect(box.height).toBeGreaterThanOrEqual(48);
          }
        }

        const stage = page.locator("#stage");
        await page.locator("#selectPlayhead").click();
        const box = await stage.boundingBox();
        await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
        await page.mouse.down();
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        await page.mouse.up();
        await expect(page.locator("#stageWrap")).not.toHaveClass(/is-dragging/);
      }
    });
  }
});
