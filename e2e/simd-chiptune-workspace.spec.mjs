import { expect, test } from "@playwright/test";
import { revealLocalPoints } from "./helpers/simd-sequence-viewport.mjs";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const performers = ["drums", "bass", "arp", "lead", "upperOne", "upperTwo", "noise"];
const drumLanes = ["kick", "snare", "hats", "shaker"];
const layouts = [
  { name: "desktop", width: 1440, height: 900, coarse: false },
  { name: "phone portrait", width: 390, height: 844, coarse: true },
  { name: "phone landscape", width: 844, height: 390, coarse: true },
];

async function capture(page) {
  return page.evaluate(async () => (await import("./src/families/chiptune/chiptune-app.js")).captureChiptuneState());
}

async function openWorkspace(page, baseURL) {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.addInitScript(() => {
    // Inspect the labels the real renderer paints, without changing its pixels.
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
      if (this.canvas.id === "characterStage" && x === 0 && y === 0
        && width >= this.canvas.width && height >= this.canvas.height) this.canvas.__paintedLabels = [];
      if (this.canvas.id === "stage") {
        if (x === 0 && y === 0 && width >= this.canvas.width && height >= this.canvas.height) this.canvas.__paintedRects = [];
        this.canvas.__paintedRects ??= [];
        this.canvas.__paintedRects.push({ x, y, width, height, color: this.fillStyle });
      }
      return fillRect.call(this, x, y, width, height);
    };
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      if (this.canvas.id === "characterStage") {
        this.canvas.__paintedLabels ??= [];
        this.canvas.__paintedLabels.push({ text: String(args[0]), x: args[1], y: args[2] });
      }
      return fillText.apply(this, args);
    };
  });
  expect((await page.goto("simd-chiptune.html", { waitUntil: "domcontentloaded" }))?.ok()).toBe(true);
  await settlePage(page);
  await expect(page.locator("#simdPresetPicker > summary")).toBeVisible();
  await expect(page.locator("[data-character-voice]")).toHaveCount(7);
  return diagnostics;
}

async function selectPerformer(page, performer) {
  const canvas = page.locator("#characterStage");
  await canvas.scrollIntoViewIfNeeded();
  await page.evaluate((index) => {
    const canvas = document.querySelector("#characterStage");
    const screen = canvas.closest(".chiptune-character-panel");
    screen.scrollLeft = canvas.getBoundingClientRect().width * (index + 0.5) / 7 - screen.clientWidth / 2;
  }, performers.indexOf(performer));
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * (performers.indexOf(performer) + 0.5) / 7, box.y + box.height * 0.38);
  await expect(page.locator(`[data-character-voice="${performer}"]`)).toHaveAttribute("data-active", "true");
}

async function startAudio(page) {
  await page.evaluate(async () => {
    const { SimdChiptuneAudio } = await import("./src/instruments/simd-chiptune/audio.js");
    const start = SimdChiptuneAudio.prototype.start;
    globalThis.__simdWorkspaceStarts = 0;
    SimdChiptuneAudio.prototype.start = function (...args) {
      globalThis.__simdWorkspaceEngine = this;
      globalThis.__simdWorkspaceStarts += 1;
      return start.apply(this, args);
    };
  });
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await page.locator("#synthPlayButton").click();
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "true");
  await waitForStableAudioState(page, true);
}

async function clockSnapshot(page) {
  return page.evaluate(() => {
    const engine = globalThis.__simdWorkspaceEngine;
    return { starts: globalThis.__simdWorkspaceStarts, anchor: engine.timelineStart,
      time: engine.currentPlaybackBeat(), contextState: engine.context.state, running: engine.running };
  });
}

function expectContinuousClock(before, after) {
  expect(after.starts).toBe(before.starts);
  expect(after.anchor).toBe(before.anchor);
  expect(after.contextState).toBe("running");
  expect(after.running).toBe(true);
  expect(after.time).toBeGreaterThan(before.time);
}

for (const layout of layouts) {
  test(`SIMD workspace keeps transport, presets and both canvases reachable at ${layout.name}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: layout.width, height: layout.height },
      isMobile: layout.coarse, hasTouch: layout.coarse, reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      const diagnostics = await openWorkspace(page, baseURL);
      for (const selector of ["#simdPresetPicker > summary", "#nextPreset", "#randomizePatch", "#synthPlayButton", "#audioButton"]) {
        await expect(page.locator(selector)).toBeVisible();
        await expect(page.locator(selector)).toBeInViewport();
        const box = await page.locator(selector).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(layout.width + 1);
        if (layout.coarse && ["#synthPlayButton", "#audioButton"].includes(selector)) {
          expect(box.width).toBeGreaterThanOrEqual(48);
          expect(box.height).toBeGreaterThanOrEqual(48);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      for (const performer of performers) await selectPerformer(page, performer);
      await selectPerformer(page, "lead");
      await page.locator("#stage").scrollIntoViewIfNeeded();
      await expect(page.locator("#stage")).toBeInViewport();
      const stage = await page.locator("#stage").boundingBox();
      expect(stage.width).toBeGreaterThan(200);
      expect(stage.height).toBeGreaterThan(150);
      expect(await page.locator("#stage").evaluate((canvas) => {
        const r = canvas.getBoundingClientRect();
        const x = Math.max(1, Math.min(innerWidth - 1, r.x + r.width / 2));
        const y = Math.max(1, Math.min(innerHeight - 1, r.y + r.height / 2));
        return document.elementFromPoint(x, y) === canvas;
      })).toBe(true);
      // Play advances visuals while Audio remains explicitly off.
      await page.locator("#synthPlayButton").click();
      await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "true");
      // Touch can leave hover engaged; Pause must stay visible on the active fill.
      await page.locator("#synthPlayButton").hover();
      await expect.poll(() => page.locator("#synthPlayButton").evaluate(button => {
        const luminance = color => {
          const linear = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
            const channel = value / 255;
            return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
          });
          return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
        };
        const ink = luminance(getComputedStyle(button.querySelector(".transport-pause")).stroke);
        const fill = luminance(getComputedStyle(button).backgroundColor);
        return (Math.max(ink, fill) + .05) / (Math.min(ink, fill) + .05);
      })).toBeGreaterThanOrEqual(3);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await context.close(); }
  });
}

test("seven ordered performers paint MUTED and SOLO status without the old effect captions", async ({ page, baseURL }) => {
  const diagnostics = await openWorkspace(page, baseURL);
  expect(await page.locator("[data-character-voice]").evaluateAll((elements) => elements.map((element) => element.dataset.characterVoice))).toEqual(performers);
  await expect(page.locator(".chiptune-character-name")).toHaveText(["Drums", "Bass", "Arp", "Lead", "Upper A", "Upper B", "Noise"]);
  await expect(page.locator("[data-character-fx-output]:visible")).toHaveCount(0);
  await page.locator('[data-character-mute="drums"]').click();
  await page.locator('[data-character-solo="bass"]').click();
  await expect.poll(() => page.locator("#characterStage").evaluate((canvas) => canvas.__paintedLabels?.filter(({ text }) => text === "MUTED" || text === "SOLO").map(({ text }) => text))).toEqual(["MUTED", "SOLO"]);
  const state = await capture(page);
  expect(state.voicePerformance.drums.muted).toBe(true);
  expect(state.voicePerformance.bass.solo).toBe(true);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Song playback falls silent with all seven muted and Noise can play alone", async ({ page, baseURL }) => {
  const diagnostics = await openWorkspace(page, baseURL);
  await page.locator("#compositionMode").selectOption("song");
  await startAudio(page);
  for (const performer of performers) await page.locator(`[data-character-mute="${performer}"]`).click();
  await waitForStableAudioState(page, false, { stableMs: 350 });
  const silent = await sampleAudioEnvelope(page, { durationMs: 350 });
  expect(silent.summary.finite).toBe(true);
  expect(silent.summary.maxRms).toBeLessThan(0.000001);
  await page.locator('[data-character-mute="noise"]').click();
  await page.locator('[data-character-solo="noise"]').click();
  const noise = await sampleAudioEnvelope(page, { durationMs: 1000 });
  expect(noise.summary.maxRms).toBeGreaterThan(0.00001);
  expect(noise.summary.finite).toBe(true);
  expect(noise.summary.clippedSamples).toBe(0);
  expect((await capture(page)).voicePerformance.noise).toMatchObject({ muted: false, solo: true });
  await page.locator("#synthPlayButton").click();
  await waitForStableAudioState(page, false);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("original characters, three pixel skins and Choose/Next presets preserve the running audio clock", async ({ page, baseURL }) => {
  const diagnostics = await openWorkspace(page, baseURL);
  await startAudio(page);
  const initial = await capture(page);
  for (const skin of ["original", "cubist", "anime", "swirl"]) {
    const before = await clockSnapshot(page);
    await page.locator("#characterSkin").selectOption(skin);
    await settlePage(page);
    const changed = await capture(page);
    expect(changed.characterSkin).toBe(skin);
    expect(changed.parameters).toEqual(initial.parameters);
    expect(changed.sequence).toEqual(initial.sequence);
    expect(changed.voicePerformance).toEqual(initial.voicePerformance);
    expectContinuousClock(before, await clockSnapshot(page));
  }
  const beforePreset = await clockSnapshot(page);
  await page.locator("#simdPresetPicker > summary").click();
  const option = page.locator('#simdPresetPicker [data-preset-id]').nth(2);
  const chosenId = await option.getAttribute("data-preset-id");
  await option.click();
  expect((await capture(page)).activePresetId).toBe(chosenId);
  expectContinuousClock(beforePreset, await clockSnapshot(page));
  const beforeNext = await clockSnapshot(page);
  await page.locator("#nextPreset").click();
  expect((await capture(page)).activePresetId).not.toBe(chosenId);
  expectContinuousClock(beforeNext, await clockSnapshot(page));
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "true");
  const audio = await sampleAudioEnvelope(page, { durationMs: 450 });
  expect(audio.summary.maxRms).toBeGreaterThan(0.00001);
  expect(audio.summary.clippedSamples).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Next loop reaches later song material and returning restores edits to each section", async ({ page, baseURL }) => {
  const diagnostics = await openWorkspace(page, baseURL);
  await page.locator("#compositionMode").selectOption("pattern");
  await selectPerformer(page, "lead");
  await page.locator("#stage").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");
  const editedIntro = await capture(page);
  expect(editedIntro.sequence).not.toEqual(editedIntro.patternBaseline);
  await page.locator("#patternNextSection").click();
  const next = await capture(page);
  expect(next.patternSection).toBe(1);
  expect(next.sequence.lanes.upperOne.cells).not.toEqual(editedIntro.patternBaseline.lanes.upperOne.cells);
  await page.locator("#stage").focus();
  await page.keyboard.press("ArrowUp");
  const editedNext = await capture(page);
  expect(editedNext.sequence).not.toEqual(next.sequence);
  await page.locator("#patternSection").selectOption({ value: "0" });
  expect((await capture(page)).sequence).toEqual(editedIntro.sequence);
  await page.locator("#patternNextSection").click();
  expect((await capture(page)).sequence).toEqual(editedNext.sequence);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

// Pointer coordinates follow the visible four-row grid, including its bar padding.
// Reading musical state never invokes the controller's private editing functions.
async function drumGrid(page, steps = 32, mode = "pattern") {
  await page.locator("#compositionMode").selectOption(mode);
  await selectPerformer(page, "drums");
  await page.locator('[data-editor-knob="zoom"] [role="slider"]').press(steps === 8 ? "Home" : "End");
  await expect(page.locator("#sequenceZoom")).toHaveValue(String(steps));
  const canvas = page.locator("#stage");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const narrow = box.width <= 620, top = narrow ? 38 : 42;
  const left = 86, right = narrow ? 5 : 10;
  const rowHeight = (box.height - 17 - top) / 4;
  const padding = Math.min(18, rowHeight * .1);
  const point = (lane, step, strength = .5) => ({
    x: left + (step + .5) * (box.width - left - right) / steps,
    y: top + drumLanes.indexOf(lane) * rowHeight + padding + (1 - strength) * (rowHeight - 2 * padding),
  });
  return { canvas, box, rowHeight, point };
}

function expectOtherLanesUnchanged(before, after, editedLane) {
  for (const [lane, sequence] of Object.entries(before.sequence.lanes)) {
    if (lane !== editedLane) expect(after.sequence.lanes[lane], `${lane} must not be edited`).toEqual(sequence);
  }
  expect(after.parameters).toEqual(before.parameters);
  expect(after.voicePerformance).toEqual(before.voicePerformance);
  expect(after.drumMix).toEqual(before.drumMix);
}

async function mouseStroke(page, from, to, { finish = true } = {}) {
  [from, to] = await revealLocalPoints(page.locator("#stage"), [from, to]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // One move deliberately skips intermediate cells; the instrument must fill them.
  await page.mouse.move(to.x, to.y);
  if (finish) await page.mouse.up();
}

async function touchStroke(page, from, to, { cancel = false } = {}) {
  [from, to] = await revealLocalPoints(page.locator("#stage"), [from, to]);
  const session = await page.context().newCDPSession(page);
  try {
    const touch = ({ x, y }) => [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(from) });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(to) });
    await session.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
  } finally { await session.detach(); }
}

for (const layout of layouts) {
  test(`combined drum rows allow direct toggles and strength painting at ${layout.name}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: layout.width, height: layout.height },
      hasTouch: layout.coarse, isMobile: layout.coarse, reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      const diagnostics = await openWorkspace(page, baseURL);
      const grid = await drumGrid(page, layout.coarse ? 8 : 32);
      await expect(grid.canvas).toHaveAccessibleName(/four.row drum sequencer/i);
      const tap = point => layout.coarse ? page.touchscreen.tap(point.x, point.y) : page.mouse.click(point.x, point.y);
      // Start on a nonselected row and visit all four without selecting a part first.
      for (const lane of ["snare", "shaker", "kick", "hats"]) {
        const before = await capture(page), step = 2;
        const wasOn = before.sequence.lanes[lane].cells[step].state === "note"
          && before.sequence.lanes[lane].cells[step].value > 0;
        const [point] = await revealLocalPoints(grid.canvas, [grid.point(lane, step)]);
        expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point)).toBe("stage");
        await tap(point);
        const first = await capture(page);
        expect(first.sequence.lanes[lane].cells[step]).toMatchObject({ state: wasOn ? "rest" : "note", value: wasOn ? 0 : 1 });
        expectOtherLanesUnchanged(before, first, lane);
        await expect(page.locator(`#sequenceLane-${lane}`)).toHaveAttribute("aria-pressed", "true");
        await tap(point);
        const second = await capture(page);
        expect(second.sequence.lanes[lane].cells[step]).toMatchObject({ state: wasOn ? "note" : "rest", value: wasOn ? 1 : 0 });
        expectOtherLanesUnchanged(first, second, lane);
      }
      const beforePaint = await capture(page);
      const from = grid.point("snare", 1, .2), to = grid.point("snare", 6, .8);
      if (layout.coarse) await touchStroke(page, from, to);
      else await mouseStroke(page, from, to);
      const painted = await capture(page);
      expectOtherLanesUnchanged(beforePaint, painted, "snare");
      for (let step = 1; step <= 6; step++) {
        const cell = painted.sequence.lanes.snare.cells[step];
        expect(cell.state).toBe("note");
        expect(cell.value).toBeCloseTo(.2 + (step - 1) * .12, 1);
      }
      if (layout.coarse) {
        await touchStroke(page, grid.point("kick", 0, .9), grid.point("kick", 5, .3), { cancel: true });
        expect((await capture(page)).sequence).toEqual(painted.sequence);
      }
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await context.close(); }
  });
}

test("drum strength bars interpolate, stay in the starting row, and undo as one gesture", async ({ page, baseURL }) => {
  const diagnostics = await openWorkspace(page, baseURL);
  const grid = await drumGrid(page);
  const before = await capture(page);
  await mouseStroke(page, grid.point("snare", 2, .2), grid.point("snare", 8, .8));
  const painted = await capture(page);
  expectOtherLanesUnchanged(before, painted, "snare");
  for (let step = 0; step < 32; step++) {
    const cell = painted.sequence.lanes.snare.cells[step];
    if (step >= 2 && step <= 8) {
      expect(cell.state).toBe("note");
      expect(cell.value).toBeCloseTo(.2 + (step - 2) * .1, 1);
    } else expect(cell).toEqual(before.sequence.lanes.snare.cells[step]);
  }
  // Inspect real rendered bars: quieter hits must be shorter in the same row.
  await settlePage(page);
  const heights = await grid.canvas.evaluate((canvas, points) => points.map(({ x, y }) => {
    const localX = x, localY = y;
    return Math.max(0, ...(canvas.__paintedRects ?? []).filter(bar => bar.color === "#ff9bce"
      && localX >= bar.x && localX <= bar.x + bar.width && bar.height > 2
      && localY >= bar.y - 1 && localY <= bar.y + bar.height + 1).map(bar => bar.height));
  }), [grid.point("snare", 2, .1), grid.point("snare", 8, .1)]);
  expect(heights[0]).toBeGreaterThan(2);
  expect(heights[1] / heights[0]).toBeGreaterThan(3);
  for (const [undo, redo] of [["Control+z", "Control+Shift+z"], ["Control+z", "Control+y"], ["Meta+z", "Meta+Shift+z"]]) {
    await page.keyboard.press(undo);
    expect((await capture(page)).sequence).toEqual(before.sequence);
    expect((await capture(page)).activePresetId).toBe(before.activePresetId);
    await page.keyboard.press(redo);
    expect((await capture(page)).sequence).toEqual(painted.sequence);
  }
  // Crossing into the next row zeros the starting row without editing its neighbour.
  await mouseStroke(page, grid.point("snare", 10, .8), grid.point("hats", 13, .5));
  const crossed = await capture(page);
  expectOtherLanesUnchanged(painted, crossed, "snare");
  expect(crossed.sequence.lanes.snare.cells[13]).toMatchObject({ state: "rest", value: 0 });
  await page.keyboard.press("Control+z");
  expect((await capture(page)).sequence).toEqual(painted.sequence);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const ending of ["pointercancel", "lostpointercapture"]) {
  test(`drum ${ending} restores the stroke and leaves earlier undo history intact`, async ({ page, baseURL }) => {
    const diagnostics = await openWorkspace(page, baseURL);
    const grid = await drumGrid(page);
    const initial = await capture(page);
    await mouseStroke(page, grid.point("kick", 1, .3), grid.point("kick", 5, .6));
    const committed = await capture(page);
    await mouseStroke(page, grid.point("shaker", 2, .9), grid.point("shaker", 7, .2), { finish: false });
    expect((await capture(page)).sequence).not.toEqual(committed.sequence);
    if (ending === "pointercancel") await grid.canvas.dispatchEvent("pointercancel", { pointerId: 1 });
    else await grid.canvas.evaluate(canvas => {
      if (!canvas.hasPointerCapture(1)) throw new Error("The drum gesture did not capture its pointer");
      canvas.releasePointerCapture(1);
    });
    await page.mouse.up();
    await expect.poll(async () => (await capture(page)).sequence).toEqual(committed.sequence);
    expect((await capture(page)).activePresetId).toBe(committed.activePresetId);
    const [next] = await revealLocalPoints(grid.canvas, [grid.point("hats", 9)]);
    await page.mouse.move(next.x, next.y);
    expect((await capture(page)).sequence).toEqual(committed.sequence);
    await page.keyboard.press("Control+z");
    expect((await capture(page)).sequence).toEqual(initial.sequence);
    await page.keyboard.press("Control+y");
    expect((await capture(page)).sequence).toEqual(committed.sequence);
    await page.mouse.click(next.x, next.y);
    expect((await capture(page)).sequence).not.toEqual(committed.sequence);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}

test("drum row labels select keyboard focus without changing notes", async ({ page, baseURL }) => {
  const diagnostics = await openWorkspace(page, baseURL);
  const grid = await drumGrid(page);
  const before = await capture(page);
  for (const lane of drumLanes) {
    await page.locator("#sequenceLane-" + lane).click();
    await expect(page.locator(`#sequenceLane-${lane}`)).toHaveAttribute("aria-pressed", "true");
    expect((await capture(page)).sequence).toEqual(before.sequence);
  }
  await page.locator("#sequenceLane-shaker").press("ArrowUp");
  await expect(page.locator("#sequenceLane-hats")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#sequenceLane-shaker")).toBeFocused();
  await grid.canvas.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("n");
  const enabled = await capture(page);
  await page.keyboard.press("ArrowDown");
  const quieter = await capture(page);
  expect(quieter.sequence.lanes.shaker.cells[0].value).toBeCloseTo(enabled.sequence.lanes.shaker.cells[0].value - .05, 2);
  expectOtherLanesUnchanged(before, quieter, "shaker");
  await page.keyboard.press("Enter");
  expect((await capture(page)).sequence.lanes.shaker.cells[0]).toMatchObject({ state: "rest", value: 0 });
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("direct drum edits and undo preserve running Song audio and transport", async ({ page, baseURL }) => {
  const diagnostics = await openWorkspace(page, baseURL);
  await startAudio(page);
  const grid = await drumGrid(page, 32, "song");
  const before = await clockSnapshot(page), initial = await capture(page);
  expect(initial.sequence.mode).toBe("song");
  await mouseStroke(page, grid.point("kick", 0, .3), grid.point("kick", 7, .7));
  const painted = await capture(page);
  expect(painted.sequence).not.toEqual(initial.sequence);
  await page.keyboard.press("Control+z");
  expect((await capture(page)).sequence).toEqual(initial.sequence);
  await page.keyboard.press("Control+y");
  expect((await capture(page)).sequence).toEqual(painted.sequence);
  const [snare] = await revealLocalPoints(grid.canvas, [grid.point("snare", 3)]);
  await page.mouse.click(snare.x, snare.y);
  expectContinuousClock(before, await clockSnapshot(page));
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "true");
  const audio = await sampleAudioEnvelope(page, { durationMs: 400 });
  expect(audio.summary.finite).toBe(true);
  expect(audio.summary.maxRms).toBeGreaterThan(.00001);
  expect(audio.summary.clippedSamples).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("grouped FX knobs change the patch and leave transport reachable", async ({ page, baseURL }) => {
  const diagnostics = await openWorkspace(page, baseURL);
  await expect(page.locator("aside:visible")).toHaveCount(0);
  const before = await capture(page);
  await page.locator('#tab-echo').click();
  const echo = page.locator('#knobControls [data-param-key="echoWet"]');
  await echo.press("ArrowDown");
  expect((await capture(page)).parameters.echoWet).not.toBe(before.parameters.echoWet);
  await page.locator('[data-voice-view="drums"]').click();
  const ghosts = page.locator('.simd-voice-controls [data-param-key="ghostDrums"]');
  await ghosts.press("ArrowDown");
  expect((await capture(page)).parameters.ghostDrums).not.toBe(before.parameters.ghostDrums);
  await expect(page.locator('#simdTempoControls [data-param-key="tempo"]')).toBeVisible();
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Noise selection replaces the Song pattern pad and its sequence accessibility instructions", async ({ page, baseURL }) => {
  const diagnostics = await openWorkspace(page, baseURL);
  await page.locator("#compositionMode").selectOption("song");
  await page.locator('label:has(#trackerViewMorph)').click();
  await expect(page.locator("#morphWorkspace")).toBeVisible();
  await expect(page.locator("#stage")).toHaveAccessibleName(/Pattern Morph Pad/i);
  await selectPerformer(page, "noise");
  await expect(page.locator("#morphWorkspace")).toBeHidden();
  await expect(page.locator("#sequenceWorkspace")).toBeHidden();
  await expect(page.locator("#stage")).toHaveAccessibleName(/noise/i);
  await expect(page.locator("#stage")).not.toHaveAccessibleName(/step|sequence|pattern morph/i);
  await expect(page.locator("#stage")).not.toHaveAttribute("aria-describedby", /sequenceInstructions|trackerInstructions/);
  await expect(page.locator("#stage")).toHaveAttribute("aria-keyshortcuts", /(?:^| )M(?: |$)/);
  await expect(page.locator("#stage")).toHaveAttribute("aria-keyshortcuts", /(?:^| )S(?: |$)/);
  await page.locator("#stage").focus();
  await page.keyboard.press("m");
  await expect(page.locator('[data-character-mute="noise"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("s");
  await expect(page.locator('[data-character-solo="noise"]')).toHaveAttribute("aria-pressed", "true");
  await selectPerformer(page, "bass");
  await expect(page.locator("#sequenceWorkspace")).toBeVisible();
  await expect(page.locator("#morphWorkspace")).toBeHidden();
  await expect(page.locator("#stage")).toHaveAccessibleName(/bass.*step/i);
  await expect(page.locator("#stage")).toHaveAttribute("aria-describedby", /sequenceInstructions/);
  await page.locator('label:has(#trackerViewMorph)').click();
  await expect(page.locator("#morphWorkspace")).toBeVisible();
  await expect(page.locator("#stage")).toHaveAccessibleName(/Pattern Morph Pad/i);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("WAX state restores two edited loop sections, character skin and Noise mute/solo", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    globalThis.MorphazoidWAX = { register(adapter) { globalThis.__simdWorkspaceWax = adapter; } };
  });
  const diagnostics = await openWorkspace(page, baseURL);
  await page.waitForFunction(() => Boolean(globalThis.__simdWorkspaceWax));
  const saved = () => page.evaluate(() => globalThis.__simdWorkspaceWax.getState());
  const initial = await saved();
  await selectPerformer(page, "upperOne");
  await page.locator("#stage").focus();
  await page.keyboard.press("ArrowUp");
  const editedFirst = await saved();
  expect(editedFirst.sequence).not.toEqual(initial.sequence);
  await page.locator("#patternSection").selectOption({ value: "3" });
  const fourth = await saved();
  await page.locator("#stage").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  const editedFourth = await saved();
  expect(editedFourth.sequence).not.toEqual(fourth.sequence);
  await page.locator("#characterSkin").selectOption("swirl");
  await page.locator('[data-character-mute="noise"]').click();
  await page.locator('[data-character-solo="noise"]').click();
  await page.locator('[data-performer-volume="bass"] [role="slider"]').press('PageDown');
  await page.locator('[data-drum-volume="snare"] [role="slider"]').press('Home');
  const snapshot = await saved();
  expect(snapshot.voicePerformance.bass.volume).toBe(.9);
  expect(snapshot.parameters.snareLevel).toBe(0);
  expect(snapshot.drumMix.snare.volume).toBe(1);
  expect(snapshot.voicePerformance.noise).toMatchObject({ muted: true, solo: true });
  expect(Object.keys(snapshot.patternSections).sort()).toEqual(["0", "3"]);
  await page.locator("#characterSkin").selectOption("cubist");
  await page.locator('[data-character-mute="noise"]').click();
  await page.locator('[data-character-solo="noise"]').click();
  await page.locator("#patternSection").selectOption({ value: "8" });
  await page.locator("#compositionMode").selectOption("song");
  expect(await saved()).not.toEqual(snapshot);
  await page.evaluate((snapshot) => globalThis.__simdWorkspaceWax.applyState(snapshot), snapshot);
  expect(await saved()).toEqual(snapshot);
  await expect(page.locator("#characterSkin")).toHaveValue("swirl");
  await expect(page.locator("#patternSection")).toHaveValue("3");
  await expect(page.locator('[data-character-mute="noise"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-character-solo="noise"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#patternSection").selectOption({ value: "0" });
  expect((await saved()).sequence).toEqual(editedFirst.sequence);
  await page.locator("#patternSection").selectOption({ value: "3" });
  expect((await saved()).sequence).toEqual(editedFourth.sequence);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});


test("character volume trims silence their stem without changing the patch or restarting audio", async ({ page, baseURL }) => {
  const diagnostics = await openWorkspace(page, baseURL);
  await page.locator('#compositionMode').selectOption('song');
  await page.locator('[data-character-solo="bass"]').click();
  await startAudio(page);
  const before = await capture(page), clock = await clockSnapshot(page);
  const volume = page.locator('[data-performer-volume="bass"] [role="slider"]');
  await volume.press('Home');
  await waitForStableAudioState(page, false);
  expect((await capture(page)).voicePerformance.bass.volume).toBe(0);
  expect((await capture(page)).parameters).toEqual(before.parameters);
  await volume.press('End');
  await waitForStableAudioState(page, true);
  expectContinuousClock(clock, await clockSnapshot(page));
  await volume.press('PageDown');
  const box = await volume.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 36);
  expect((await capture(page)).voicePerformance.bass.volume).toBeCloseTo(.6);
  await volume.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
  expect((await capture(page)).voicePerformance.bass.volume).toBeCloseTo(.9);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const layout of layouts) {
  test(`character mixer and final patch knob stay unobstructed at ${layout.name}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: layout.width, height: layout.height },
      hasTouch: layout.coarse, isMobile: layout.coarse, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      const diagnostics = await openWorkspace(page, baseURL);
      await expect(page.locator('#characterSkin')).toHaveValue('original');
      await expect(page.locator('[data-performer-volume] [role="slider"]')).toHaveCount(7);
      await expect(page.locator('[data-drum-volume] [role="slider"]')).toHaveCount(4);
      for (const kind of ['performer', 'drum']) {
        const nodes = page.locator(`[data-${kind}-volume] [role="slider"]`);
        for (let index = 0; index < await nodes.count(); index++) {
          const node = nodes.nth(index); await node.scrollIntoViewIfNeeded();
          expect(await node.evaluate(el => {
            const r = el.getBoundingClientRect();
            return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
          })).toBe(true);
        }
      }
      const last = page.locator('#knobControls [role="slider"]:visible').last();
      await last.scrollIntoViewIfNeeded();
      expect(await last.evaluate(el => {
        const r = el.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
      })).toBe(true);
      expect(await page.locator('.chiptune-character-name').first().evaluate(el => getComputedStyle(el).fontFamily)).toContain('ui-monospace');
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await context.close(); }
  });
}

for (const layout of layouts) {
  test("drum row mute and solo stay aligned and editable at " + layout.name, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: layout.width, height: layout.height },
      hasTouch: layout.coarse, isMobile: layout.coarse, reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      const diagnostics = await openWorkspace(page, baseURL);
      const grid = await drumGrid(page, 8);
      await expect(page.locator("#sequenceVoiceTabs")).toHaveCount(1);
      await expect(page.locator("#drumSequenceMix [data-drum-mute]")).toHaveCount(4);
      await expect(page.locator("#drumSequenceMix [data-drum-solo]")).toHaveCount(4);
      const before = await capture(page);
      const selectedLane = await page.locator("#sequenceVoiceTabs [data-lane][aria-pressed=true]").getAttribute("data-lane");
      for (const [index, lane] of drumLanes.entries()) {
        const row = page.locator('#drumSequenceMix [data-drum-row="' + lane + '"]');
        const rowBox = await row.boundingBox(), stageBox = await grid.canvas.boundingBox();
        expect(Math.abs(rowBox.y - stageBox.y - (stageBox.width <= 620 ? 38 : 42) - index * grid.rowHeight)).toBeLessThan(1);
        expect(Math.abs(rowBox.height - grid.rowHeight)).toBeLessThan(1);
        expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(stageBox.x + 86);
        for (const action of ["mute", "solo"]) {
          const button = row.locator("[data-drum-" + action + "]");
          const box = await button.boundingBox();
          expect(box.width).toBeGreaterThanOrEqual(36);
          expect(box.height).toBeGreaterThanOrEqual(28);
          await expect(button).toHaveAccessibleName(new RegExp(action, "i"));
          const [point] = await revealLocalPoints(button, [{ x: box.width / 2, y: box.height / 2 }]);
          if (layout.coarse) await page.touchscreen.tap(point.x, point.y);
          else await page.mouse.click(point.x, point.y);
          await expect(button).toHaveAttribute("aria-pressed", "true");
          expect((await capture(page)).drumMix[lane][action === "mute" ? "muted" : "solo"]).toBe(true);
        }
      }
      const muted = await capture(page);
      expect(muted.sequence).toEqual(before.sequence);
      expect(muted.parameters).toEqual(before.parameters);
      expect(muted.voicePerformance).toEqual(before.voicePerformance);
      expect(muted.activePresetId).toBe(before.activePresetId);
      expect(await page.locator("#sequenceVoiceTabs [data-lane][aria-pressed=true]").getAttribute("data-lane")).toBe(selectedLane);
      // Muted steps still accept direct edits, and undo leaves the live mixer alone.
      const [hit] = await revealLocalPoints(grid.canvas, [grid.point("snare", 2)]);
      if (layout.coarse) await page.touchscreen.tap(hit.x, hit.y);
      else await page.mouse.click(hit.x, hit.y);
      expect((await capture(page)).sequence).not.toEqual(before.sequence);
      await page.keyboard.press("Control+z");
      const undone = await capture(page);
      expect(undone.sequence).toEqual(before.sequence);
      expect(undone.drumMix).toEqual(muted.drumMix);
      await selectPerformer(page, "lead");
      await expect(page.locator("#drumSequenceMix")).toBeHidden();
      await selectPerformer(page, "drums");
      await expect(page.locator("#drumSequenceMix [data-drum-mute][aria-pressed=true]")).toHaveCount(4);
      const solo = page.locator('[data-drum-solo="kick"]');
      await solo.focus();
      await page.keyboard.press("Space");
      await expect(solo).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await context.close(); }
  });
}

test("sequencer drum solos isolate parts and mute silences them without restarting audio", async ({ page, baseURL }) => {
  const diagnostics = await openWorkspace(page, baseURL);
  await drumGrid(page, 8);
  await startAudio(page);
  const before = await capture(page), clock = await clockSnapshot(page);
  const params = () => page.evaluate(() => globalThis.__simdWorkspaceEngine.params);
  const original = await params();
  await page.locator('[data-drum-solo="kick"]').click();
  await page.locator('[data-drum-solo="hats"]').click();
  let mix = await params();
  expect(mix.kickLevel).toBe(original.kickLevel);
  expect(mix.hatLevel).toBe(original.hatLevel);
  expect(mix.snareLevel).toBe(0);
  expect(mix.shakerLevel).toBe(0);
  expect(mix.leadLevel).toBe(original.leadLevel);
  await page.locator('[data-drum-mute="hats"]').click();
  expect((await params()).hatLevel).toBe(0);
  // The whole-kit performer mute still wins over a drum-part solo.
  await page.locator('[data-character-mute="drums"]').click();
  expect((await params()).drumMix).toBe(0);
  await page.locator('[data-character-mute="drums"]').click();
  await page.locator('[data-character-solo="drums"]').click();
  const audible = await sampleAudioEnvelope(page, { durationMs: 650 });
  expect(audible.summary.finite).toBe(true);
  expect(audible.summary.maxRms).toBeGreaterThan(.00001);
  await page.locator('[data-drum-mute="kick"]').click();
  await settlePage(page);
  const silent = await sampleAudioEnvelope(page, { durationMs: 450 });
  expect(silent.summary.maxRms).toBeLessThan(.00001);
  await page.locator('[data-drum-mute="kick"]').click();
  const resumed = await sampleAudioEnvelope(page, { durationMs: 650 });
  expect(resumed.summary.maxRms).toBeGreaterThan(.00001);
  expect(resumed.summary.clippedSamples).toBe(0);
  expectContinuousClock(clock, await clockSnapshot(page));
  expect((await capture(page)).sequence).toEqual(before.sequence);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "true");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});
