import { expect, test } from "@playwright/test";

import {
  MIDI_BYTES,
  enableFakeMidi,
  installFakeMidi,
  sendMidi,
} from "./helpers/fake-midi.mjs";

test("Jaw Harp exposes every body reference and steps vowels only on sounding plucks", async ({ page }) => {
  await page.goto("jaw-harp.html", { waitUntil: "load" });

  await expect(page.locator("#harpSelect option")).toHaveCount(5);
  await expect(page.locator("#styleSelect option")).toHaveCount(17);
  await expect(page.locator("#styleSelect optgroup")).toHaveCount(5);

  const physicalBody = await page.locator("#harpSelect").inputValue();
  await page.getByRole("button", { name: "With plucks" }).click();
  await expect(page.locator("#mouthSummary")).toContainText("/ɑ/ · step 1/4 · pluck");

  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#pluckButton").click();
  await expect(page.locator("#mouthSummary")).toContainText("/ɑ/ · step 1/4 · pluck");
  await page.locator("#pluckButton").click();
  await expect(page.locator("#mouthSummary")).toContainText("/i/ · step 2/4 · pluck");
  await page.locator("#pluckButton").click();
  await expect(page.locator("#mouthSummary")).toContainText("/o/ · step 3/4 · pluck");
  await expect(page.locator("#harpSelect")).toHaveValue(physicalBody);

  await page.getByRole("button", { name: "Off", exact: true }).click();
  await expect(page.locator("#mouthSummary")).not.toContainText("step");
  await expect(page.locator("#harpSelect")).toHaveValue(physicalBody);
});

test("Jaw Harp MIDI notes use the native pitched strike path", async ({ page }) => {
  await installFakeMidi(page);
  await page.goto("jaw-harp.html", { waitUntil: "load" });
  await enableFakeMidi(page);

  await sendMidi(page, MIDI_BYTES.noteOn(45, 96));
  await expect(page.locator("#reedFrequencyHzOut")).toHaveText("110 Hz");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#motionReadout")).not.toHaveText("resting");

  await sendMidi(page, MIDI_BYTES.noteOff(45));
  await expect(page.locator("#reedFrequencyHzOut")).toHaveText("110 Hz");
  await sendMidi(page, MIDI_BYTES.noteOn(0, 64));
  await expect(page.locator("#reedFrequencyHzOut")).toHaveText("38 Hz");
});

test("Jaw Harp breath vowels follow real manual direction turns", async ({ page }) => {
  await page.goto("jaw-harp.html", { waitUntil: "load" });
  await page.locator("#breathCycleButton").click();
  await expect(page.locator("#breathCycleButton")).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "With breath" }).click();
  await expect(page.locator("#mouthSummary")).toContainText("/ɑ/ · step 1/4 · breath");

  await page.locator("#inhaleButton").click();
  await expect(page.locator("#mouthSummary")).toContainText("/ɑ/ · step 1/4 · breath");
  await page.locator("#exhaleButton").click();
  await expect(page.locator("#mouthSummary")).toContainText("/i/ · step 2/4 · breath");
  await page.locator("#inhaleButton").click();
  await expect(page.locator("#mouthSummary")).toContainText("/o/ · step 3/4 · breath");
});

test("Jaw Harp Randomize includes mouth geometry and an audible vowel phrase", async ({ page }) => {
  await page.goto("jaw-harp.html", { waitUntil: "load" });
  await page.evaluate(() => { Math.random = () => 0.5; });

  await page.locator("#randomizeButton").click();
  await expect(page.locator("#vowelSequenceSelect")).toHaveValue("a-o-e-a");
  await expect(page.getByRole("button", { name: "With plucks" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#tongueHeight")).toHaveValue("0.5");
  await expect(page.locator("#mouthSummary")).toContainText("/ɑ/ · step 1/4 · pluck");
});

test("Jaw Harp respects WAX MIDI-only routing", async ({ page }) => {
  await page.goto("jaw-harp.html", { waitUntil: "load" });
  const dispatchedWithoutClaim = await page.evaluate(() => {
    document.documentElement.dataset.morphazoidWaxOutputMode = "midi";
    return globalThis.dispatchEvent(new CustomEvent("morphazoid:midi-input", {
      cancelable: true,
      detail: {
        source: "wax",
        message: { type: "noteOn", note: 45, velocity: 96 },
      },
    }));
  });
  expect(dispatchedWithoutClaim).toBe(true);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#reedFrequencyHzOut")).toHaveText("76 Hz");
});

test("Jaw Harp panel XY pads stay clear of the mobile head and control both axes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("jaw-harp.html", { waitUntil: "load" });

  const stageBox = await page.locator("#stageWrap").boundingBox();
  const breathPad = page.locator("#breathXYPad");
  const breathBox = await breathPad.boundingBox();
  expect(stageBox).not.toBeNull();
  expect(breathBox).not.toBeNull();
  expect(stageBox.height).toBeGreaterThanOrEqual(285);
  expect(breathBox.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height - 1);

  await breathPad.scrollIntoViewIfNeeded();
  const visibleBreathBox = await breathPad.boundingBox();
  await page.mouse.move(
    visibleBreathBox.x + visibleBreathBox.width * 0.82,
    visibleBreathBox.y + visibleBreathBox.height * 0.18,
  );
  await page.mouse.down();
  await page.mouse.up();
  expect(Number(await page.locator("#breathRateBpm").inputValue())).toBeGreaterThan(250);
  expect(Number(await page.locator("#breathDepth").inputValue())).toBeGreaterThan(2.2);
  await expect(page.locator("#breathXYReadout")).toContainText("pressure");

  const rhythmPad = page.locator("#rhythmXYPad");
  await rhythmPad.scrollIntoViewIfNeeded();
  const tempoBefore = Number(await page.locator("#repeatRateBpm").inputValue());
  const swingBefore = Number(await page.locator("#repeatSwing").inputValue());
  await rhythmPad.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  expect(Number(await page.locator("#repeatRateBpm").inputValue())).toBeGreaterThan(tempoBefore);
  expect(Number(await page.locator("#repeatSwing").inputValue())).toBeGreaterThan(swingBefore);

  await page.locator("#breathNoiseAmount").fill("0");
  await expect(page.locator("#breathNoiseAmountOut")).toHaveText("0%");

  const breathFilter = page.locator("#breathFilter");
  await expect(breathFilter).toHaveValue("0.36");
  await breathFilter.fill("0");
  await expect(page.locator("#breathFilterOut")).toHaveText("0% open");
  await breathFilter.fill("1");
  await expect(page.locator("#breathFilterOut")).toHaveText("100% open");
});

test("Jaw Harp Choose menus preserve native choices and follow preset/reset state", async ({ page }) => {
  await page.goto("jaw-harp.html", { waitUntil: "load" });
  await expect(page.locator(".jaw-select-picker")).toHaveCount(5);
  const ids = ["harpSelect", "styleSelect", "vowelSequenceSelect", "rhythmSelect", "breathsPerLoop"];
  const pickerFor = id => page.locator(`[data-select-id="${id}"]`);
  const expectSynchronized = async () => {
    for (const id of ids) {
      const label = await page.locator(`#${id}`).evaluate(select => select.selectedOptions[0].label);
      await expect(pickerFor(id).locator(".instrument-picker-current")).toHaveText(label);
    }
  };

  for (const id of ids) {
    const picker = pickerFor(id);
    await page.locator(`label[for="${id}"]`).click();
    await expect(picker).toHaveAttribute("open", "");
    const option = await page.locator(`#${id} option`).nth(1).getAttribute("value");
    await picker.locator('[data-option-index="1"]').click();
    await expect(page.locator(`#${id}`)).toHaveValue(option);
    await expect(picker).not.toHaveAttribute("open", "");
  }
  await expectSynchronized();

  await page.getByRole("button", { name: "With plucks", exact: true }).click();
  const phrase = pickerFor("vowelSequenceSelect");
  await phrase.locator("summary").click();
  await phrase.locator('input[type="search"]').press("a");
  await expect(page.getByRole("button", { name: "With plucks", exact: true })).toHaveAttribute("aria-pressed", "true");
  await phrase.locator('input[type="search"]').fill("no matching phrase");
  await expect(phrase.locator(".instrument-picker-empty")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(phrase.locator("summary")).toBeFocused();
  await expect(phrase).not.toHaveAttribute("open", "");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");

  await page.locator(".instrument-preset-controls .header-preset-next").click();
  await expectSynchronized();
  await page.locator("#resetAll").click();
  await expectSynchronized();
  await expect(page.locator(".jaw-data #reedReadout")).toHaveText("76 Hz");
});

const JAW_PRESET_A = 'southern-jawharp-blues';
const JAW_PRESET_B = 'ncas-night-dialogue';
const jawFullPicker = page => page.locator('.instrument-preset-controls .header-preset-picker');

async function installJawPresetProbe(page, { delayStartup = false } = {}) {
  await page.addInitScript(({ delayStartup }) => {
    const probe = globalThis.__jawPresetProbe = { events: [], actions: [], nodes: 0, waiting: false };
    if (delayStartup) {
      const addModule = AudioWorklet.prototype.addModule;
      AudioWorklet.prototype.addModule = async function (url, ...rest) {
        if (String(url).includes('/jaw-harp-processor.js')) {
          probe.waiting = true;
          await new Promise(resolve => { probe.releaseStartup = resolve; });
          probe.waiting = false;
        }
        return addModule.call(this, url, ...rest);
      };
    }
    const NativeWorklet = globalThis.AudioWorkletNode;
    globalThis.AudioWorkletNode = class extends NativeWorklet {
      constructor(context, name, ...options) {
        super(context, name, ...options);
        if (name !== 'jaw-harp-physical-model') return;
        probe.nodes += 1;
        let configuration = null;
        const postMessage = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, ...transfer) => {
          if (message.type === 'configure') configuration = structuredClone(message.configuration);
          if (message.type === 'configure' || message.type === 'strike-tine') {
            probe.events.push({
              type: message.type, at: performance.now(), audioTime: context.currentTime,
              message: structuredClone(message), configuration,
            });
          }
          return postMessage(message, ...transfer);
        };
      }
    };
    document.addEventListener('click', event => {
      const button = event.target.closest?.('[data-full-preset], .header-preset-next, .header-preset-random');
      if (button) probe.actions.push({ at: performance.now(), presetId: button.dataset.presetId ?? null });
    }, { capture: true });
  }, { delayStartup });
}

async function chooseJawFullPreset(page, id) {
  const picker = jawFullPicker(page);
  if (!(await picker.evaluate(element => element.open))) await picker.locator('summary').click();
  await picker.locator(`button[data-preset-id="${id}"]`).click();
}

const jawStrikes = page => page.evaluate(() => __jawPresetProbe.events.filter(event => event.type === 'strike-tine'));
const clearJawProbe = page => page.evaluate(() => {
  __jawPresetProbe.events.length = 0;
  __jawPresetProbe.actions.length = 0;
});

test('Jaw Harp full presets and dice audition exactly once only while Audio is on', async ({ page }) => {
  await installJawPresetProbe(page);
  await page.goto('jaw-harp.html', { waitUntil: 'load' });
  const actions = [
    () => chooseJawFullPreset(page, JAW_PRESET_A),
    () => chooseJawFullPreset(page, JAW_PRESET_A), // Re-selecting the current row is an audition too.
    () => page.locator('.instrument-preset-controls .header-preset-next').click(),
    () => page.locator('.instrument-preset-controls .header-preset-random').click(),
  ];
  // Check both a fresh page and a previously initialized, suspended graph.
  for (const [phase, audioOn] of [false, true, false].entries()) {
    if (phase > 0) await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', String(audioOn));
    for (const action of actions) {
      await clearJawProbe(page);
      await action();
      if (audioOn) await expect.poll(async () => (await jawStrikes(page)).length).toBe(1);
      // Observe a short negative window to catch queued duplicate or Audio-off strikes.
      await page.waitForTimeout(120);
      const strikes = await jawStrikes(page);
      expect(strikes).toHaveLength(audioOn ? 1 : 0);
      await expect(page.locator('#repeatButton')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', String(audioOn));
      if (audioOn) {
        const clickedAt = await page.evaluate(() => __jawPresetProbe.actions.at(-1).at);
        expect(strikes[0].at - clickedAt).toBeGreaterThanOrEqual(0);
        expect(strikes[0].at - clickedAt).toBeLessThan(200);
      }
    }
    if (phase === 0) expect(await page.evaluate(() => __jawPresetProbe.nodes)).toBe(0);
  }
});

test('Jaw Harp repeating presets restart from their immediate preview without a doubled first strike', async ({ page }) => {
  await installJawPresetProbe(page);
  await page.goto('jaw-harp.html', { waitUntil: 'load' });
  await chooseJawFullPreset(page, JAW_PRESET_A);
  const interval = await page.evaluate(async id => {
    const { JAW_HARP_FULL_PRESETS } = await import('/src/instruments/jaw-harp/full-presets.js');
    const { jawHarpRhythmHit, repeatIntervalMs } = await import('/src/instruments/jaw-harp/jaw-harp.js');
    const state = JAW_HARP_FULL_PRESETS.find(preset => preset.id === id).snapshot.parameters;
    if (![0, 1].every(step => jawHarpRhythmHit(state, step).active)) throw new Error('Use a preset with two initial sounding steps');
    return repeatIntervalMs(state.repeatRateBpm, 0, state.repeatSwing) * 0.5;
  }, JAW_PRESET_A);
  expect(interval).toBeGreaterThan(350);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#repeatButton').click();
  await expect.poll(async () => (await jawStrikes(page)).length, { intervals: [10, 20, 50] }).toBeGreaterThanOrEqual(1);
  // Change partway through the old beat, so retaining its deadline would be detectable.
  await page.waitForTimeout(interval * 0.35);
  await chooseJawFullPreset(page, JAW_PRESET_A);
  const clickedAt = await page.evaluate(() => __jawPresetProbe.actions.at(-1).at);
  const afterRecall = async () => (await jawStrikes(page)).filter(event => event.at >= clickedAt);
  await expect.poll(async () => (await afterRecall()).length, { intervals: [10, 20, 50] }).toBeGreaterThanOrEqual(2);
  const [preview, next] = await afterRecall();
  expect(preview.at - clickedAt).toBeLessThan(200);
  expect(next.at - preview.at).toBeGreaterThanOrEqual(interval - 35);
  expect(next.at - preview.at).toBeLessThan(interval + 150);
  expect(next.message.direction).toBe(-preview.message.direction);
  await expect(page.locator('#repeatButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#audioButton').click();
});

test('Jaw Harp delayed startup previews only the latest preset and Escape cancels a pending preview', async ({ page }) => {
  await installJawPresetProbe(page, { delayStartup: true });
  const startGatedAudio = async () => {
    await page.locator('#audioButton').click();
    await page.waitForFunction(() => __jawPresetProbe.waiting && typeof __jawPresetProbe.releaseStartup === 'function');
  };
  await page.goto('jaw-harp.html', { waitUntil: 'load' });
  await startGatedAudio();
  await chooseJawFullPreset(page, JAW_PRESET_A);
  await chooseJawFullPreset(page, JAW_PRESET_B);
  expect(await jawStrikes(page)).toHaveLength(0);
  await page.evaluate(() => __jawPresetProbe.releaseStartup());
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await jawStrikes(page)).length).toBe(1);
  await page.waitForTimeout(120);
  const strikes = await jawStrikes(page);
  expect(strikes).toHaveLength(1);
  expect(strikes[0].configuration.presetId).toBe('dan-moi');
  expect(strikes[0].configuration.reedFrequencyHz).toBe(126);
  expect(await page.evaluate(() => __jawPresetProbe.nodes)).toBe(1);

  await page.reload({ waitUntil: 'load' });
  await startGatedAudio();
  await chooseJawFullPreset(page, JAW_PRESET_A);
  // Escape inside the preset menu only dismisses it; target the instrument's panic handler.
  await page.locator('#stage').focus();
  await page.keyboard.press('Escape');
  await page.evaluate(() => __jawPresetProbe.releaseStartup());
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(120);
  expect(await jawStrikes(page)).toHaveLength(0);
  await expect(page.locator('#repeatButton')).toHaveAttribute('aria-pressed', 'false');
});
