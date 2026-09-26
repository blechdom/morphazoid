import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const performers = ["drums", "bass", "arp", "lead", "upperOne", "upperTwo", "noise"];
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
  const images = [];
  for (const skin of ["original", "animals", "blobs", "arcade"]) {
    const before = await clockSnapshot(page);
    await page.locator("#characterSkin").selectOption(skin);
    await settlePage(page);
    const changed = await capture(page);
    expect(changed.characterSkin).toBe(skin);
    expect(changed.parameters).toEqual(initial.parameters);
    expect(changed.sequence).toEqual(initial.sequence);
    expect(changed.voicePerformance).toEqual(initial.voicePerformance);
    expectContinuousClock(before, await clockSnapshot(page));
    images.push(await page.locator("#characterStage").screenshot());
  }
  expect(images[0].equals(images[1])).toBe(false);
  expect(images[1].equals(images[2])).toBe(false);
  expect(images[2].equals(images[3])).toBe(false);
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

test("drum notes occupy the upper grid and lower dragging edits volume", async ({ page, baseURL }) => {
  const diagnostics = await openWorkspace(page, baseURL);
  await selectPerformer(page, "drums");
  await page.locator('[data-editor-knob="zoom"] [role="slider"]').press("End");
  const canvas = page.locator("#stage");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const narrow = box.width <= 620, top = narrow ? 38 : 42;
  const upperHeight = Math.max(100, box.height - 170), upperRowHeight = (upperHeight - 13) / 4;
  const upperLeft = narrow ? 45 : 66, right = narrow ? 5 : 10;
  const step = 2;
  const upperX = box.x + upperLeft + (step + 0.5) * (box.width - upperLeft - right) / 32;
  const upperY = box.y + top + 13 + upperRowHeight * 1.5; // Snare row.
  const initial = await capture(page);
  await page.mouse.click(upperX, upperY);
  await expect(page.locator("#sequenceLane-snare")).toHaveAttribute("aria-pressed", "true");
  expect((await capture(page)).sequence).toEqual(initial.sequence);
  await page.mouse.dblclick(upperX, upperY);
  const toggled = await capture(page);
  expect(toggled.sequence.lanes.snare.cells[step].state).not.toBe(initial.sequence.lanes.snare.cells[step].state);
  for (const lane of ["kick", "hats", "shaker"]) expect(toggled.sequence.lanes[lane]).toEqual(initial.sequence.lanes[lane]);
  const lowerTop = top + upperHeight + 24, lowerHeight = box.height - 17 - lowerTop;
  expect(lowerTop).toBeGreaterThan(top + upperHeight);
  const left = narrow ? 45 : 66;
  const lowerX = box.x + left + (step + 0.5) * (box.width - left - right) / 32;
  await page.mouse.move(lowerX, box.y + lowerTop + lowerHeight * 0.8);
  await page.mouse.down();
  await page.mouse.move(lowerX, box.y + lowerTop + lowerHeight * 0.35, { steps: 5 });
  await page.mouse.up();
  const louder = await capture(page);
  expect(louder.sequence.lanes.snare.cells[step].state).toBe("note");
  expect(louder.sequence.lanes.snare.cells[step].value).toBeGreaterThan(0.5);
  expect(louder.sequence.lanes.snare.cells[step].value).toBeLessThan(1);
  expect(louder.sequence.lanes.snare.cells[step].value).not.toBe(toggled.sequence.lanes.snare.cells[step].value);
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
  await page.locator("#characterSkin").selectOption("blobs");
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
  await page.locator("#characterSkin").selectOption("arcade");
  await page.locator('[data-character-mute="noise"]').click();
  await page.locator('[data-character-solo="noise"]').click();
  await page.locator("#patternSection").selectOption({ value: "8" });
  await page.locator("#compositionMode").selectOption("song");
  expect(await saved()).not.toEqual(snapshot);
  await page.evaluate((snapshot) => globalThis.__simdWorkspaceWax.applyState(snapshot), snapshot);
  expect(await saved()).toEqual(snapshot);
  await expect(page.locator("#characterSkin")).toHaveValue("blobs");
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
