import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

const capture = (page, prefix) => page.evaluate(async prefix =>
  (await import(`${prefix}/src/site/header-presets.js`)).captureHeaderPresetState(), prefix);

async function chooseFirst(page) {
  await page.locator(".header-preset-picker > summary").click();
  await page.locator('[data-full-preset][data-preset-id="first-croak"]').click();
}

async function assertUncovered(locator) {
  expect(await locator.evaluate(node => {
    const r = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })).toBe(true);
}

async function swipePanel(page) {
  const box = await page.locator(".panel").boundingBox();
  const session = await page.context().newCDPSession(page);
  // Start beside the preset row, not on a timeline value drag target. Chromium
  // touch hit-testing can snap even a gutter-edge touch onto an editable lane.
  const x = box.x + 5, startY = box.y + 48;
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
  for (let step = 1; step <= 6; step++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: startY - step * (box.height - 48) / 6 }] });
    await page.waitForTimeout(25);
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

for (const prefix of ["", "/dist-wax"]) {
  for (const [name, width, height] of [["portrait", 390, 844], ["landscape", 844, 390], ["small phone", 320, 568]]) {
    test.describe(`${prefix || "source"} ${name}`, () => {
      test.use({ viewport: { width, height }, hasTouch: true });
      test("compact graphic and Play/Loop stay put while presets and controls scroll", async ({ page, baseURL }, testInfo) => {
        const diagnostics = watchPageDiagnostics(page, { baseURL });
        const audio = { moduleUrl: new URL(`${prefix}/src/audio-output-manager.js`, baseURL).href };
        await page.goto(`${prefix}/hybrinx.html`);
        await expect(page.locator("body")).toHaveClass(/hybrinx-mobile-layout/);
        await expect(page.locator("#hybrinxSplitter")).toBeHidden();
        await expect(page.locator(".header-preset-controls")).toBeInViewport();
        await chooseFirst(page);
        const graphic = await page.locator("#stageWrap").boundingBox();
        const performance = await page.locator("#hybrinxMobilePerformance").boundingBox();
        const panel = await page.locator(".panel").boundingBox();
        expect(graphic.height).toBeLessThanOrEqual(height / 2);
        expect(performance.height).toBeLessThanOrEqual(height / 2);
        expect(panel.y).toBeCloseTo(performance.y + performance.height, 0);
        for (const id of ["playButton", "loopButton", "audioButton"]) {
          const control = page.locator(`#${id}`), box = await control.boundingBox();
          expect(box.height).toBeGreaterThanOrEqual(48);
          expect(box.width).toBeGreaterThanOrEqual(48);
          await expect(control).toBeInViewport();
          await assertUncovered(control);
        }
        expect(await page.locator(".header-preset-controls").evaluate(e => getComputedStyle(e).position)).toBe("static");
        expect(await page.locator("#hybrinxTimelineScroll").evaluate(e => e.scrollHeight <= e.clientHeight + 1)).toBe(true);
        const timeline = await page.locator("#hybrinxTimelineSection").boundingBox();
        const lanes = await page.locator("#hybrinxTimelineScroll").boundingBox();
        const callControls = await page.locator(".syrinx-panel-presets").boundingBox();
        expect(timeline.y + timeline.height).toBeGreaterThanOrEqual(lanes.y + lanes.height - 1);
        expect(callControls.y).toBeGreaterThanOrEqual(lanes.y + lanes.height - 1);

        // The smaller graphic must not crop its existing tongue-pattern menu.
        await page.locator("#viewportTonguePresetTrigger").click();
        const tongueMenu = page.locator(".viewport-tongue-preset-popover");
        await expect(tongueMenu).toBeVisible();
        const tongueBox = await tongueMenu.boundingBox();
        expect(tongueBox.y).toBeGreaterThanOrEqual(graphic.y);
        await assertUncovered(tongueMenu.locator('[data-tongue-motion="p"]'));
        const clearTongue = tongueMenu.locator('[data-tongue-motion=""]');
        await clearTongue.scrollIntoViewIfNeeded();
        await assertUncovered(clearTongue);
        await clearTongue.click();
        await page.locator("#loopButton").focus();

        // A menu that used to open upward above the desktop timeline must now
        // open into the scrolling controls rather than behind the pinned pane.
        await page.locator("#hybrinxTimelineAddParameter").click();
        const sourceScale = page.locator('[data-hybrinx-add-parameter="sourceScale"]');
        await sourceScale.scrollIntoViewIfNeeded();
        await assertUncovered(sourceScale);
        await sourceScale.click();
        await expect(page.locator('.hybrinx-timeline-lane[data-parameter="sourceScale"]')).toBeAttached();
        await page.locator(".panel").evaluate(e => { e.scrollTop = 0; });
        await page.locator("#loopButton").click();
        await page.locator("#playButton").click();
        expect((await readAudioStatus(page, audio)).connectionCount).toBe(0);
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
        await page.locator("#audioButton").click();
        await expect.poll(async () => (await readAudioStatus(page, audio)).connectionCount).toBe(1);

        const presetY = (await page.locator(".header-preset-controls").boundingBox()).y;
        // Timeline lanes and controls share one vertical scroller; the timeline
        // keeps horizontal scrolling without consuming vertical phone swipes.
        await swipePanel(page);
        await expect.poll(() => page.locator(".panel").evaluate(e => e.scrollTop)).toBeGreaterThan(25);
        expect((await page.locator(".header-preset-controls").boundingBox()).y).toBeLessThan(presetY - 25);
        expect((await page.locator("#stageWrap").boundingBox()).y).toBeCloseTo(graphic.y, 1);
        for (const id of ["playButton", "loopButton"]) await assertUncovered(page.locator(`#${id}`));
        // Shared help can appear after Reset, so reaching the panel's absolute
        // bottom does not imply Reset is visible on a short phone viewport.
        await page.locator("[data-reset-all]").scrollIntoViewIfNeeded();
        await expect(page.locator("[data-reset-all]")).toBeInViewport();
        await assertUncovered(page.locator("[data-reset-all]"));
        expect((await page.locator("#stageWrap").boundingBox()).y).toBeCloseTo(graphic.y, 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
          && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
        const signal = await sampleAudioEnvelope(page, { ...audio, durationMs: 1900 });
        expect(signal.summary.maxPeak).toBeGreaterThan(.001);
        expect(signal.summary.clippedSamples).toBe(0);
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#loopButton")).toHaveAttribute("aria-pressed", "true");
        await testInfo.attach("scrolled-controls.png", { body: await page.screenshot(), contentType: "image/png" });
        await page.locator(".panel").evaluate(e => { e.scrollTop = 0; });
        await testInfo.attach("compact-performance.png", { body: await page.screenshot(), contentType: "image/png" });
        await page.locator("#playButton").click();
        await page.waitForTimeout(450);
        expect((await readAudioStatus(page, audio)).rms).toBeLessThan(.001);
        expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
      });
    });
  }

  test(`${prefix || "source"} desktop splitter and edited timeline survive mobile round trips without duplicate controls`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${prefix}/hybrinx.html`);
    await expect(page.locator(".header-preset-controls")).toBeVisible();
    await chooseFirst(page);
    const before = await page.locator("#stageWrap").boundingBox();
    await page.locator("#hybrinxSplitter").focus();
    await page.keyboard.press("ArrowUp");
    const resized = await page.locator("#stageWrap").boundingBox();
    expect(resized.height).toBeLessThan(before.height - 5);
    const key = page.locator('.hybrinx-timeline-keyframe[data-parameter="pressure"][data-index="1"]');
    const unedited = await capture(page, prefix);
    await key.focus(); await page.keyboard.press("ArrowUp");
    const edited = await capture(page, prefix);
    expect(edited).not.toEqual(unedited);
    await page.locator("#loopButton").click();
    await page.locator("#playButton").click();
    await page.evaluate(() => { globalThis.__hybrinxNodes = ["stage", "playButton", "loopButton", "hybrinxTimelineSvg"].map(id => document.getElementById(id)); });
    for (const [width, height] of [[390, 844], [844, 390], [320, 568], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await expect(page.locator("#hybrinxSplitter"))[width <= 980 ? "toBeHidden" : "toBeVisible"]();
      expect(await capture(page, prefix)).toEqual(edited);
      expect(await page.evaluate(() => __hybrinxNodes.every(node => node === document.getElementById(node.id)
        && document.querySelectorAll(`#${node.id}`).length === 1))).toBe(true);
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#loopButton")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    }
    await expect.poll(async () => (await page.locator("#stageWrap").boundingBox()).height).toBeCloseTo(resized.height, 0);
    await expect(page.locator(".panel > .syrinx-panel-transport")).toBeVisible();
    await expect(page.locator(".syrinx-stage > #hybrinxTimelineSection")).toBeVisible();
    await page.locator("#playButton").click();
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}
