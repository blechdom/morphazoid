import { expect, test } from "@playwright/test";

import {
  readAudioStatus, sampleAudioEnvelope, waitForAudioState, waitForStableAudioState,
} from "./helpers/audio-probe.mjs";

async function capturePreset(page) {
  return page.evaluate(async () => {
    const { captureHeaderPresetState } = await import("/src/site/header-presets.js");
    return captureHeaderPresetState();
  });
}

async function selectFullPreset(page, id) {
  await page.locator(".header-preset-picker > summary").click();
  await page.locator(`[data-full-preset][data-preset-id="${id}"]`).click();
  await expect.poll(async () => (await capturePreset(page))?.selectedId).toBe(id);
}

async function readStage(page) {
  return page.locator("#stage").evaluate((canvas) => ({
    phase: Number(canvas.dataset.phase), melodyPhase: Number(canvas.dataset.melodyPhase),
    pitchHz: Number(canvas.dataset.pitchHz), breathGain: Number(canvas.dataset.breathGain),
    breathState: canvas.dataset.breathState, voiceGain: Number(canvas.dataset.voiceGain),
  }));
}

async function assertUnarmed(page) {
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).active).toBe(false);
}

async function readPhases(page, count = 16, intervalMs = 90) {
  return page.evaluate(async ({ count, intervalMs }) => {
    const values = [];
    for (let index = 0; index < count; index++) {
      const canvas = document.querySelector("#stage");
      values.push({ phase: Number(canvas.dataset.phase), melodyPhase: Number(canvas.dataset.melodyPhase) });
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return values;
  }, { count, intervalMs });
}

const hasWrap = (values, key) => values.some((value, index) => index > 0 && value[key] < values[index - 1][key] - 0.25);

test("Throat Singer has independent circular voice, ornament, and melody controls with Audio off", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("throat-singing.html", { waitUntil: "load" });
  await expect(page).toHaveTitle("Throat Singer · Morphazoid");
  await expect(page.locator("#styleSelect option")).toHaveCount(8);
  expect(await page.locator("#ornamentSelect option").count()).toBeGreaterThanOrEqual(16);
  expect(await page.locator("#melodySelect option").count()).toBeGreaterThanOrEqual(10);

  for (const id of ["singButton", "gestureButton", "melodyButton"]) {
    const button = page.locator(`#${id}`);
    await expect(button).toHaveAttribute("aria-pressed", "false");
    const geometry = await button.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height, radius: getComputedStyle(node).borderRadius };
    });
    expect(Math.abs(geometry.width - geometry.height)).toBeLessThanOrEqual(1);
    expect(geometry.radius).toBe("50%");
  }
  for (const [selectId, nextId] of [["ornamentSelect", "ornamentNext"], ["melodySelect", "melodyNext"]]) {
    const select = page.locator(`#${selectId}`);
    const choices = await select.locator("option").evaluateAll((options) => options.map(({ value }) => value));
    await select.selectOption(choices[0]);
    await page.locator(`#${nextId}`).click();
    await expect(select).toHaveValue(choices[1]);
  }
  for (const track of ["ornament", "melody"]) {
    for (const mode of ["Direction", "PingPong", "Repeat"]) {
      const button = page.locator(`#${track}${mode}`);
      const previous = await button.getAttribute("aria-pressed");
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", String(previous !== "true"));
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", previous);
    }
  }
  for (const id of ["ornamentRate", "ornamentDepth", "melodyRate", "melodyDepth", "breathRate", "portamento"]) {
    expect(await page.locator(`#${id}`).evaluate((input) => Boolean(input.closest(".mz-range-knob")))).toBe(!["ornamentRate", "melodyRate", "portamento"].includes(id));
  }
  await page.locator("#ornamentSelect").selectOption("roll");
  await page.locator("#ornamentRate").fill("0.6");
  await page.locator("#melodySelect").selectOption("pendulum");
  await page.locator("#melodyRate").fill("0.35");
  await page.locator("#melodyDepth").fill("8");
  await page.locator(".throat-motion-section > summary").click();
  await page.locator("#vibratoDepth").fill("0");
  await expect(page.locator("#gestureButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#melodyButton")).toHaveAttribute("aria-pressed", "false");

  await page.locator("#gestureButton").click();
  const ornamentStart = await readStage(page);
  await expect.poll(async () => Math.abs((await readStage(page)).phase - ornamentStart.phase)).toBeGreaterThan(0.05);
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#melodyButton")).toHaveAttribute("aria-pressed", "false");
  await assertUnarmed(page);

  await page.locator("#melodyButton").click();
  const melodyStart = await readStage(page);
  await expect.poll(async () => Math.abs((await readStage(page)).melodyPhase - melodyStart.melodyPhase)).toBeGreaterThan(0.05);
  await expect.poll(async () => Math.abs((await readStage(page)).pitchHz - melodyStart.pitchHz)).toBeGreaterThan(1);
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#gestureButton").click();
  await page.waitForTimeout(200);
  const pausedOrnament = await readStage(page);
  await expect.poll(async () => Math.abs((await readStage(page)).melodyPhase - pausedOrnament.melodyPhase)).toBeGreaterThan(0.05);
  expect((await readStage(page)).phase).toBe(pausedOrnament.phase);

  await page.locator("#melodyButton").click();
  await page.locator("#singButton").click();
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#gestureButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#melodyButton")).toHaveAttribute("aria-pressed", "false");
  await assertUnarmed(page);
  await page.locator("#singButton").click();
  await expect.poll(async () => (await readStage(page)).voiceGain).toBe(0);
  const stopped = await readStage(page);
  await page.waitForTimeout(300);
  expect(await readStage(page)).toEqual(stopped);
  expect(errors).toEqual([]);
});

test("Throat Singer one-shot tracks complete and restart while repeating tracks wrap", async ({ page }) => {
  await page.goto("throat-singing.html", { waitUntil: "load" });
  await page.locator("#ornamentSelect").selectOption("swell");
  await page.locator("#melodySelect").selectOption("arch");
  await page.locator("#ornamentRate").fill("2");
  await page.locator("#ornamentDepth").fill("1.5");
  await page.locator("#melodyRate").fill("2");
  await page.locator("#ornamentRepeat").click();
  await page.locator("#melodyRepeat").click();
  await page.locator("#singButton").click();
  for (const buttonId of ["gestureButton", "melodyButton"]) {
    await page.locator(`#${buttonId}`).click();
    await expect(page.locator(`#${buttonId}`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`#${buttonId}`)).toHaveAttribute("aria-pressed", "false");
  }
  await expect(page.locator("#stage")).toHaveAttribute("data-phase", "0.000");
  await expect(page.locator("#stage")).toHaveAttribute("data-melody-phase", "0.000");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");
  await assertUnarmed(page);

  await page.locator("#ornamentRepeat").click();
  await page.locator("#melodyRepeat").click();
  await expect(page.locator("#gestureButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#melodyButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#gestureButton").click();
  await page.locator("#melodyButton").click();
  const phases = await readPhases(page);
  expect(hasWrap(phases, "phase")).toBe(true);
  expect(hasWrap(phases, "melodyPhase")).toBe(true);
  for (const buttonId of ["gestureButton", "melodyButton", "singButton"]) {
    await expect(page.locator(`#${buttonId}`)).toHaveAttribute("aria-pressed", "true");
  }
});

test("Throat Singer breaths, two-row physical keys, and glide follow the voice without arming Audio", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("throat-singing.html", { waitUntil: "load" });
  await expect(page.locator("#breathRate")).toHaveAttribute("min", "0");
  await expect(page.locator("#breathRate")).toHaveAttribute("max", "30");
  await expect(page.locator("#breathRateOut")).toHaveText("Never");
  await page.locator(".throat-motion-section > summary").click();
  await page.locator("#vibratoDepth").fill("0");
  await page.locator("#portamento").fill("0");
  const rows = await page.locator("#noteButtons .throat-keyboard-row").evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll("kbd")].map((key) => key.textContent)));
  expect(rows).toEqual([
    ["Q", "2", "W", "3", "E", "R", "5", "T", "6", "Y", "7", "U"],
    ["Z", "S", "X", "D", "C", "V", "G", "B", "H", "N", "J", "M"],
  ]);
  const keys = await page.locator("#noteButtons button").evaluateAll((buttons) => buttons.map((button) => ({ key: button.dataset.noteKey, frequency: Number(button.dataset.noteFrequency) })));
  await page.locator("#stage").focus();
  for (const note of keys) {
    await page.keyboard.press(note.key);
    await expect(page.locator("#trueFoldHzOut")).toHaveText(`${Math.round(note.frequency)} Hz`);
  }
  const lastPitch = await page.locator("#trueFoldHz").inputValue();
  await page.locator("#melodyRate").focus();
  await page.keyboard.press("q");
  await expect(page.locator("#trueFoldHz")).toHaveValue(lastPitch);
  await page.locator("#singButton").click();
  await page.locator("#breathButton").click();
  await expect(page.locator("#stage")).toHaveAttribute("data-breath-state", "inhaling");
  await expect.poll(async () => (await readStage(page)).breathGain).toBeLessThan(0.5);
  await expect(page.locator("#stage")).toHaveAttribute("data-breath-state", "singing");
  await expect.poll(async () => (await readStage(page)).breathGain).toBeGreaterThan(0.95);
  await page.locator("#breathRate").fill("30");
  await expect(page.locator("#breathRateOut")).toHaveText("30/min");
  await expect(page.locator("#stage")).toHaveAttribute("data-breath-state", "inhaling");
  await page.locator("#breathRate").fill("0");
  await expect(page.locator("#breathRateOut")).toHaveText("Never");
  await expect.poll(async () => (await readStage(page)).breathGain).toBeGreaterThan(0.95);

  await page.locator('[data-note-key="z"]').click();
  await expect.poll(async () => (await readStage(page)).pitchHz).toBeCloseTo(65.406, 1);
  await page.locator("#portamento").fill("1");
  await page.locator('[data-note-key="q"]').click();
  await expect.poll(async () => (await readStage(page)).pitchHz).toBeGreaterThan(72);
  expect((await readStage(page)).pitchHz).toBeLessThan(125);
  await expect.poll(async () => (await readStage(page)).pitchHz).toBeCloseTo(130.813, 1);
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");
  await assertUnarmed(page);
  expect(errors).toEqual([]);
});

test("Throat Singer complete presets and polyphonic effects preserve level, voice transport, and bounded output", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("throat-singing.html", { waitUntil: "load" });
  expect((await capturePreset(page)).presetCount).toBeGreaterThanOrEqual(24);
  await page.locator("#level").fill("0.17");
  await selectFullPreset(page, "bright-thread");
  const expectedSnapshot = await page.evaluate(async () => {
    const { THROAT_SINGER_PRESETS } = await import("/src/instruments/throat-singing/performance-patterns.js");
    return THROAT_SINGER_PRESETS.find(({ id }) => id === "bright-thread").snapshot;
  });
  expect((await capturePreset(page)).snapshot).toEqual(expectedSnapshot);
  await expect(page.locator("#level")).toHaveValue("0.17");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "false");
  await assertUnarmed(page);
  await page.locator("#audioButton").click();
  await page.locator("#singButton").click();
  await waitForAudioState(page, true);
  await page.locator("#ornamentSelect").selectOption("spiral");
  await page.locator("#melodySelect").selectOption("arch");
  await page.locator("#melodyRate").fill("0.4");
  await page.locator("#melodyDepth").fill("5");
  await expect.poll(async () => (await capturePreset(page)).selectedId).toBe(null);
  await selectFullPreset(page, "bright-thread");
  expect((await capturePreset(page)).snapshot).toEqual(expectedSnapshot);
  await page.locator(".header-preset-next").click();
  await expect.poll(async () => (await capturePreset(page)).selectedId).toBe("rounded-glass");
  const nextSnapshot = (await capturePreset(page)).snapshot;
  await page.locator(".header-preset-random").click();
  await expect.poll(async () => (await capturePreset(page)).selectedId).toBe(null);
  expect((await capturePreset(page)).snapshot).not.toEqual(nextSnapshot);
  await expect(page.locator("#level")).toHaveValue("0.17");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");

  await selectFullPreset(page, "open-drone");
  for (const [id, value] of [["pitchVoices", "4"], ["pitchSpreadSemitones", "12"], ["overtoneVoices", "4"], ["overtoneSpread", "3"], ["reverbMix", "0.4"], ["delayMix", "0.35"], ["delayTimeSeconds", "0.3"], ["delayFeedback", "0.3"]]) {
    await page.locator(`#${id}`).fill(value);
    expect((await capturePreset(page)).snapshot.extras[id]).toBe(Number(value));
  }
  await expect(page.locator("#stage")).toHaveAttribute("data-pitch-voices", "4");
  await expect(page.locator("#stage")).toHaveAttribute("data-overtone-voices", "4");
  const audio = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 50 });
  expect(audio.summary.finite).toBe(true);
  expect(audio.summary.activeSamples).toBeGreaterThan(0);
  expect(audio.summary.maxPeak).toBeGreaterThan(0.001);
  expect(audio.summary.clippedSamples).toBe(0);
  await page.locator("#singButton").click();
  await waitForStableAudioState(page, false, { timeout: 10000 });
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await waitForStableAudioState(page, false);
  expect(errors).toEqual([]);
});

test("Throat Singer keeps uniform anatomy scaling and reachable controls in three layouts", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await test.step(`${viewport.width} × ${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.goto("throat-singing.html", { waitUntil: "load" });
      const geometry = await page.locator("#stage").evaluate((canvas) => {
        const box = canvas.getBoundingClientRect();
        const matrix = canvas.getContext("2d").getTransform();
        return {
          modelWidth: Number(canvas.dataset.modelWidth), modelHeight: Number(canvas.dataset.modelHeight),
          scaleX: Number(canvas.dataset.viewScaleX), scaleY: Number(canvas.dataset.viewScaleY),
          width: box.width, height: box.height, matrixScaleX: matrix.a, matrixScaleY: matrix.d,
        };
      });
      expect(geometry.modelWidth).toBe(900);
      expect(geometry.modelHeight).toBe(720);
      expect(geometry.scaleX).toBeGreaterThan(0);
      expect(geometry.scaleX).toBe(geometry.scaleY);
      expect(geometry.matrixScaleX).toBe(geometry.matrixScaleY);
      expect(geometry.modelWidth * geometry.scaleX).toBeLessThanOrEqual(geometry.width + 1);
      expect(geometry.modelHeight * geometry.scaleY).toBeLessThanOrEqual(geometry.height + 1);
      const alignment = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const preset = rect(".header-preset-next");
        const rows = [["#singButton", "#styleSelect", "#breathButton"],
          ["#gestureButton", "#ornamentSelect", "#ornamentNext", "#ornamentDirection", "#ornamentPingPong", "#ornamentRepeat"],
          ["#melodyButton", "#melodySelect", "#melodyNext", "#melodyDirection", "#melodyPingPong", "#melodyRepeat"]];
        return {
          presetHeight: preset.height,
          rows: rows.map((ids) => ids.map((id) => { const box = rect(id); return { height: box.height, center: box.y + box.height / 2 }; })),
          selectedBorders: [...document.querySelectorAll('.throat-mode-buttons button[aria-pressed="true"]')].map((button) => getComputedStyle(button).borderLeftWidth),
          keyboardGap: rect("#noteButtons").top - rect(".throat-note-heading").bottom,
          resetEdges: { left: rect("#resetButton").left, right: rect("#resetButton").right },
          presetEdges: { left: rect(".instrument-preset-controls").left + 12, right: rect(".instrument-preset-controls").right - 12 },
        };
      });
      for (const row of alignment.rows) {
        for (const control of row) {
          expect(control.height).toBe(alignment.presetHeight);
          expect(Math.abs(control.center - row[0].center)).toBeLessThanOrEqual(0.5);
        }
      }
      expect(alignment.selectedBorders.every((width) => width === "1px")).toBe(true);
      expect(alignment.keyboardGap).toBeLessThanOrEqual(6);
      expect(alignment.resetEdges).toEqual(alignment.presetEdges);
      for (const selector of [
        ".header-preset-picker > summary", ".header-preset-next", ".header-preset-random",
        "#singButton", "#styleSelect", "#breathButton", "#breathRate", "#gestureButton", "#ornamentSelect", "#ornamentNext",
        "#ornamentDirection", "#ornamentPingPong", "#ornamentRepeat", "#ornamentRate", "#ornamentDepth",
        "#melodyButton", "#melodySelect", "#melodyNext", "#melodyDirection", "#melodyPingPong", "#melodyRepeat",
        "#melodyRate", "#melodyDepth", "#portamento", "#pitchVoices", "#overtoneVoices", "#reverbMix", "#delayMix", "#resetButton",
      ]) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport({ ratio: 0.95 });
        await expect(control).toBeEnabled();
      }
      await page.locator(".header-preset-picker > summary").click();
      await expect(page.locator("[data-full-preset]").first()).toBeInViewport({ ratio: 0.95 });
      await page.keyboard.press("Escape");
      const overflow = await page.evaluate(() => {
        const panel = document.querySelector(".throat-panel");
        return { document: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: panel.scrollWidth - panel.clientWidth };
      });
      expect(overflow.document).toBeLessThanOrEqual(1);
      expect(overflow.panel).toBeLessThanOrEqual(1);
    });
  }
  expect(errors).toEqual([]);
});

test("Throat Singer mouth and lips can be shaped directly in the drawing at every aspect ratio", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto("throat-singing.html", { waitUntil: "load" });
    const point = async (x, y) => page.locator("#stage").evaluate((canvas, { x, y }) => {
      const rect = canvas.getBoundingClientRect();
      const scale = Number(canvas.dataset.viewScale);
      return { x: rect.left + (rect.width - 900 * scale) / 2 + x * 900 * scale,
        y: rect.top + (rect.height - 720 * scale) / 2 + y * 720 * scale };
    }, { x, y });
    const drag = async (x, y, dx, dy) => {
      const start = await point(x, y); const end = await point(x + dx, y + dy);
      const before = (await capturePreset(page)).snapshot.state;
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      expect((await capturePreset(page)).snapshot.state).toEqual(before);
      await page.mouse.move(end.x, end.y, { steps: 6 }); await page.mouse.up();
    };
    await page.locator("#oralConstriction").fill("0.3");
    await drag(0.70, 0.70 - 0.06 * 0.3, 0, -0.18 * 0.3);
    expect(Number(await page.locator("#oralConstriction").inputValue())).toBeCloseTo(0.6, 2);
    await page.locator("#oralConstriction").fill("0.2");
    await drag(0.70, 0.70 - 0.06 * 0.2, 0, -0.18 * 0.2);
    expect(Number(await page.locator("#oralConstriction").inputValue())).toBeCloseTo(0.4, 2);
    await page.locator("#lipRounding").fill("0.12");
    const opening = (await capturePreset(page)).snapshot.state.mouthOpening;
    await drag(0.885 + 0.065 * 0.12, 0.54, 0.1 * 0.4, -0.18 * 0.15);
    expect(Number(await page.locator("#lipRounding").inputValue())).toBeCloseTo(0.52, 2);
    expect((await capturePreset(page)).snapshot.state.mouthOpening).toBeCloseTo(opening + 0.15, 2);
    const mouth = await page.locator("#oralConstriction").inputValue();
    const harmonic = Number(await page.locator("#harmonicNumber").inputValue());
    const focus = Number(await page.locator("#focusAmount").inputValue());
    await drag(0.48 + (harmonic - 4) / 20 * 0.34, 0.56 - 0.26 * focus, 0.34 * 3 / 20, 0);
    expect(Number(await page.locator("#harmonicNumber").inputValue())).toBe(harmonic + 3);
    await expect(page.locator("#oralConstriction")).toHaveValue(mouth);
    await assertUnarmed(page);
  }
  expect(errors).toEqual([]);
});

test("Throat Singer live speed edits preserve phrase position and keep the voice sounding", async ({ page }) => {
  await page.addInitScript(() => {
    window.throatOscillatorStarts = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.throatOscillatorStarts++;
      return start.apply(this, args);
    };
  });
  await page.goto("throat-singing.html", { waitUntil: "load" });
  await page.locator(".throat-motion-section > summary").click();
  await page.locator("#vibratoDepth").fill("0");
  await page.locator("#ornamentSelect").selectOption("swell");
  await page.locator("#ornamentRate").fill("0.5");
  await page.locator("#melodySelect").selectOption("arch");
  await page.locator("#melodyRate").fill("0.4");
  await page.locator("#portamento").fill("0.8");
  await page.locator("#audioButton").click();
  await page.locator("#singButton").click();
  await page.locator("#gestureButton").click();
  await page.locator("#melodyButton").click();
  await waitForAudioState(page, true);
  await expect.poll(async () => (await readStage(page)).phase).toBeGreaterThan(0.3);
  const starts = await page.evaluate(() => window.throatOscillatorStarts);
  for (const [id, value, phaseKey] of [
    ["ornamentRate", "2", "phase"], ["ornamentRate", "0.25", "phase"],
    ["ornamentRate", "0", "phase"], ["ornamentRate", "0.5", "phase"],
    ["melodyRate", "1.5", "melodyPhase"], ["melodyRate", "0.2", "melodyPhase"],
    ["melodyRate", "0", "melodyPhase"], ["melodyRate", "0.4", "melodyPhase"],
  ]) {
    const edit = await page.evaluate(({ id, value, phaseKey }) => {
      const input = document.getElementById(id);
      const canvas = document.getElementById("stage");
      // Refresh the old position in this same event task before the edit.
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const before = { phase: Number(canvas.dataset[phaseKey]), pitch: Number(canvas.dataset.pitchHz) };
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return { before, after: { phase: Number(canvas.dataset[phaseKey]), pitch: Number(canvas.dataset.pitchHz) } };
    }, { id, value, phaseKey });
    expect(Math.abs(edit.after.phase - edit.before.phase)).toBeLessThan(0.025);
    if (id === "melodyRate") {
      // The live clock advances during input handlers. For the six-note arch,
      // the largest jump is half an octave; the smooth glide's max slope is 1.5.
      // At 0.8 seconds and the lowest tested nonzero rate (0.2 Hz), its width
      // is 0.96 notes. Allow the rounded phase readout error as well.
      const phaseAdvance = Math.abs(edit.after.phase - edit.before.phase);
      const octaveChange = Math.abs(Math.log2(edit.after.pitch / edit.before.pitch));
      const maxOctavesPerPhase = 0.5 * 6 * 1.5 / 0.96;
      expect(octaveChange).toBeLessThanOrEqual(maxOctavesPerPhase * phaseAdvance + 0.006);
    }
  }
  const paused = await readStage(page);
  await page.locator("#ornamentRate").fill("0");
  await page.locator("#melodyRate").fill("0");
  const held = await readStage(page);
  await page.waitForTimeout(150);
  const afterHold = await readStage(page);
  expect(afterHold.phase).toBe(held.phase);
  expect(afterHold.melodyPhase).toBe(held.melodyPhase);
  expect(afterHold.pitchHz).toBe(held.pitchHz);
  expect(paused.voiceGain).toBe(1);
  await page.locator("#ornamentRate").fill("0.5");
  await page.locator("#melodyRate").fill("0.4");
  const audio = await sampleAudioEnvelope(page, { durationMs: 500, intervalMs: 40 });
  expect(audio.summary.finite).toBe(true);
  expect(audio.summary.activeSamples).toBeGreaterThan(0);
  expect(audio.summary.maxPeak).toBeGreaterThan(0.001);
  expect(audio.summary.clippedSamples).toBe(0);
  expect(await page.evaluate(() => window.throatOscillatorStarts)).toBe(starts);
  for (const id of ["audioButton", "singButton", "gestureButton", "melodyButton"]) {
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-pressed", "true");
  }
  expect((await readStage(page)).voiceGain).toBe(1);
});

test("Throat Singer keeps melody and glide inside source pitch limits", async ({ page }) => {
  await page.goto("throat-singing.html", { waitUntil: "load" });
  await page.locator("#portamento").fill("0");
  await page.locator("#trueFoldHz").fill("50");
  await page.locator("#portamento").fill("2");
  await page.locator("#melodySelect").selectOption("valley");
  await page.locator("#melodyRate").fill("1");
  await page.locator("#melodyDepth").fill("24");
  await page.locator("#melodyButton").click();
  await page.locator("#trueFoldHz").fill("360");
  const sample = () => page.evaluate(async () => {
    const pitches = [];
    for (let index = 0; index < 24; index += 1) {
      pitches.push(Number(document.getElementById("stage").dataset.pitchHz));
      await new Promise(resolve => setTimeout(resolve, 90));
    }
    return pitches;
  });
  const falling = await sample();
  await page.locator("#melodySelect").selectOption("arch");
  await page.locator("#trueFoldHz").fill("50");
  const rising = await sample();
  expect([...falling, ...rising].every(pitch => Number.isFinite(pitch) && pitch >= 50 && pitch <= 360)).toBe(true);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});
