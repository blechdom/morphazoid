import { test, expect } from "@playwright/test";
import { choose, exact } from "./helpers/synthesis-controls.mjs";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { METHODS } from "../src/instruments/synthesis/catalog.js";

import { SECTION_METHODS, SECTION_PRESETS, methodSection } from "../src/instruments/synthesis/presets.js";

async function selectMethod(page, methodId) {
  await page.locator(methodSection(methodId) === 'processing' ? '#sectionProcessing' : '#sectionSynthesis').click();
  await choose(page, "methodSelect", methodId);
}

async function selectSoundPreset(page, methodId, presetId) {
  await page.locator(methodSection(methodId) === 'processing' ? '#sectionProcessing' : '#sectionSynthesis').click();
  await page.locator(".header-preset-picker summary").click();
  await page.locator(`[data-full-preset][data-preset-id="${methodId}:${presetId}"]`).click();
}

test("Audio arming, live method changes, preset recall, output and release", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/synthesis.html?method=additive");
  await expect(page.locator("#methodSelect option")).toHaveCount(SECTION_METHODS.synthesis.length);
  await page.locator("#playButton").click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator("#signalStatus").textContent()).toBe("Sounding");
  for (const method of METHODS) {
    await selectMethod(page, method.id);
    await expect(page.locator("[data-full-preset]")).toHaveCount(SECTION_PRESETS[methodSection(method.id)].length);
    await expect(page.locator("#methodControls .synthesis-parameter")).toHaveCount(method.controls.length);
    await page.locator("#nextPreset").click();
    expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().playing)).toBe(true);
  }
  await selectMethod(page, "additive");
  await expect.poll(() => page.locator("#signalStatus").textContent()).toBe("Sounding");
  await page.locator("#audioButton").click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().playing)).toBe(true);
  await expect(page.locator("#signalStatus")).toHaveText("Audio off");
  await expect(page.locator("#audioError")).toBeHidden();
  expect(errors).toEqual([]);
});

test("all physical key bindings release independently and editable controls keep typing", async ({ page }) => {
  await page.goto("/synthesis.html?method=fm");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("h1").click();
  await page.keyboard.down("z"); await page.keyboard.down("q");
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(2);
  await page.keyboard.up("z");
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(1);
  await page.keyboard.up("q");
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(0);
  await exact(page, "#frequencyHz", 317);
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getState().frequencyHz)).toBe(317);
  await page.locator("#keyboardDetails summary").click();
  await expect(page.locator("#keyboard button")).toHaveCount(24);
  await page.keyboard.down("x");
  await page.evaluate(() => dispatchEvent(new Event("blur")));
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(0);
  await page.keyboard.up("x");
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`controls and signal displays remain reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/synthesis.html?method=graphic");
    await expect(page.locator("#methodControls .synthesis-parameter")).toHaveCount(METHODS.find(method => method.id === "graphic").controls.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const id of ['playButton', 'triggerButton', 'randomMethod']) {
      expect(await page.locator('#' + id).evaluate(button => button.scrollWidth <= button.clientWidth)).toBe(true);
    }
    for (const selector of ["#playButton", "#randomMethod", "#presetHost summary", '[data-select-id="voiceMode"] summary', "#methodControls input[type=range]", ".synth-envelope__graph", ".synth-envelope .synthesis-knob-value", "#scope", "#spectrum", ".synthesis-notes summary"]) {
      const locator = page.locator(selector).last();
      await locator.scrollIntoViewIfNeeded();
      await expect(locator).toBeInViewport();
    }
    await choose(page, "spectrumMode", "spectrum");
    await expect(page.locator("#spectrum")).toHaveAttribute("aria-label", /frequency spectrum/);
    await page.locator('#sectionProcessing').click();
    await expect(page.locator('#noteTiming')).toBeHidden();
    await expect(page.locator('#envelopeDetails')).toBeHidden();
    await expect(page.locator('#presetSectionLabel')).toHaveText('Processing presets');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const selector of ['#sectionSynthesis', '#sectionProcessing', '#presetHost summary', '#randomPreset', '#randomMethod', '[data-select-id=processingSource] summary', '#dryWet', '#processingBypass', '#methodControls input[type=range]']) {
      await page.locator(selector).last().scrollIntoViewIfNeeded();
      await expect(page.locator(selector).last()).toBeInViewport();
    }
    await choose(page, "processingSource", "file");
    await expect(page.locator('#frequencyRow')).toBeHidden();
    await choose(page, 'processingSource', 'microphone');
    await page.locator('#startMicrophone').scrollIntoViewIfNeeded();
    await expect(page.locator('#startMicrophone')).toBeInViewport();
    expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
  });
}

test("MIDI notes use independent identity, preserve pitch controls and release on panic", async ({ page }) => {
  await page.goto("/synthesis.html?method=additive");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  const originalFrequency = await page.evaluate(() => window.MorphazoidSynthesis.getState().frequencyHz);
  const send = message => page.evaluate(message => {
    const event = new CustomEvent("morphazoid:midi-input", { cancelable: true, detail: { routeId: "synthesis", message } });
    dispatchEvent(event);
    return event.defaultPrevented;
  }, message);
  expect(await send({ type: "noteOn", channel: 0, note: 69, velocity: 96 })).toBe(true);
  expect(await send({ type: "noteOn", channel: 1, note: 69, velocity: 80 })).toBe(true);
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(2);
  await expect.poll(() => page.locator("#signalStatus").textContent()).toBe("Sounding");
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getState().frequencyHz)).toBe(originalFrequency);
  await send({ type: "noteOff", channel: 0, note: 69, velocity: 0 });
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(1);
  await send({ type: "controlChange", channel: 1, controller: 123, value: 0 });
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(0);
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().playing)).toBe(false);
});


for (const section of ['synthesis','processing']) test("Next tours all " + section + " presets and wraps within the section", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/synthesis.html?method=" + SECTION_METHODS[section][0].id);
  const methodIds = await page.locator("#methodSelect option").evaluateAll(options => options.map(option => option.value));
  const expected = methodIds.flatMap(id => METHODS.find(method => method.id === id).presets.map(preset => `${id}:${preset.id}`));
  const visited = [];
  for (let i = 0; i < expected.length; i++) {
    visited.push(await page.evaluate(() => {
      const state = window.MorphazoidSynthesis.getState();
      return `${state.methodId}:${state.presetId}`;
    }));
    await page.locator("#nextPreset").click();
    // Keep a human-plausible rate below the browser's history-update throttle.
    await page.waitForTimeout(25);
  }
  expect(visited).toEqual(expected);
  expect(new Set(visited).size).toBe(SECTION_PRESETS[section].length);
  expect(await page.evaluate(() => {
    const state = window.MorphazoidSynthesis.getState();
    return `${state.methodId}:${state.presetId}`;
  })).toBe(expected[0]);
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
});

test("preset selections and current-method Random audition without starting Play or changing output", async ({ page }) => {
  await page.goto("/synthesis.html?method=additive");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#outputLevel").evaluate(input => { input.value = "0.21"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await selectSoundPreset(page, "additive", METHODS.find(method => method.id === "additive").presets[1].id);
  await expect.poll(() => page.locator("#signalStatus").textContent()).toBe("Sounding");
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().playing)).toBe(false);
  await expect.poll(() => page.locator("#signalStatus").textContent(), { timeout: 12_000 }).toBe("Ready");
  const before = await page.evaluate(() => window.MorphazoidSynthesis.getState());
  await page.locator("#randomMethod").click();
  const after = await page.evaluate(() => window.MorphazoidSynthesis.getState());
  expect(after.methodId).toBe(before.methodId);
  expect(after.presetId).toBe("custom");
  expect(after.params).not.toEqual(before.params);
  expect(after.outputLevel).toBe(0.21);
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().playing)).toBe(false);
  await expect.poll(() => page.locator("#signalStatus").textContent()).toBe("Sounding");
  await expect(page.locator("#resetPreset")).toHaveCount(0);
  await page.locator("#nextPreset").click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getState().presetId)).toBe(METHODS.find(method => method.id === "additive").presets[2].id);
  await page.locator("#audioButton").click();
  await page.locator("#nextPreset").click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
  await expect(page.locator("#signalStatus")).toHaveText("Audio off");
});


test("ADSR graph and exact fields edit the actual envelope without triggering extra notes", async ({ page }) => {
  await page.goto("/synthesis.html?method=additive");
  const graph = page.locator(".synth-envelope__drawing");
  const handles = page.locator(".synth-envelope__handle");
  await expect(handles).toHaveCount(4);
  await expect(page.locator("#envelopeControls input[type=range]")).toHaveCount(4);
  const before = await page.evaluate(() => window.MorphazoidSynthesis.getState().envelope);
  const attack = page.locator('.synth-envelope__handle[data-stage="attack"]');
  await attack.focus(); await attack.press("ArrowRight");
  const keyboard = await page.evaluate(() => window.MorphazoidSynthesis.getState().envelope);
  expect(keyboard.attack).toBeCloseTo(before.attack + .001, 5);
  expect(keyboard.decay).toBe(before.decay);
  const sustainInput = page.locator('.synth-envelope__number[data-stage="sustain"]');
  await exact(page, sustainInput, "35");
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getState().envelope.sustain)).toBe(.35);
  await expect(graph).toHaveAttribute("aria-label", /sustain 35 percent/);
  const release = page.locator('.synth-envelope__handle[data-stage="release"]');
  const box = await release.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getState().envelope.release)).toBeGreaterThan(before.release);
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getState().presetId)).toBe("custom");
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
  await choose(page, "playbackMode", "hold");
  await page.locator("#audioButton").click();
  await page.locator("#playButton").click();
  await expect.poll(() => page.locator("#signalStatus").textContent()).toBe("Sounding");
  await exact(page, sustainInput, "0");
  await expect.poll(() => page.locator("#signalStatus").textContent()).toBe("Ready");
  await exact(page, sustainInput, "60");
  await expect.poll(() => page.locator("#signalStatus").textContent()).toBe("Sounding");
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().playing)).toBe(true);
});


test("Auto repeats zero-sustain presets, tempo and note length persist through edits and preset touring", async ({ page }) => {
  await page.goto("/synthesis.html?method=additive");
  await selectSoundPreset(page, "additive", METHODS.find(method => method.id === "additive").presets.find(preset => preset.envelope.sustain === 0).id);
  await expect(page.locator("#tempo")).toBeEnabled();
  await exact(page, "#tempo-value", 240);
  await exact(page, "#noteGate-value", 30);
  await page.locator("#playButton").click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
  await page.locator("#audioButton").click();
  await expect.poll(() => page.locator("#signalStatus").textContent()).toBe("Sounding");
  const status = await page.evaluate(() => window.MorphazoidSynthesis.getStatus());
  expect(status).toMatchObject({ playing: true, playStyle: "strike", tempo: 240, noteGate: .3 });
  await page.locator("#nextPreset").click();
  await expect(page.locator("#tempo")).toHaveValue("240");
  await expect(page.locator("#noteGate")).toHaveValue("30");
  await choose(page, "playbackMode", "repeat");
  await selectMethod(page, "fm");
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus())).toMatchObject({ playing: true, playStyle: "strike", tempo: 240 });
  await page.locator("#playButton").click();
  await expect.poll(() => page.locator("#signalStatus").textContent(), { timeout: 15000 }).toBe("Ready");
});

test("method controls expose exact physical values, discrete choices and full supported envelope ranges", async ({ page }) => {
  await page.goto("/synthesis.html?method=subtractive");
  const cutoff = page.locator("#synth-param-0-value");
  await exact(page, cutoff, String(METHODS.find(method => method.id === "subtractive").controls[0].max));
  expect((await page.evaluate(() => window.MorphazoidSynthesis.getState())).params[0]).toBe(1);
  await exact(page, cutoff, String(METHODS.find(method => method.id === "subtractive").controls[0].min));
  expect((await page.evaluate(() => window.MorphazoidSynthesis.getState())).params[0]).toBe(0);
  await selectMethod(page, "antialias-oscillator");
  await choose(page, "synth-param-0", "3");
  expect((await page.evaluate(() => window.MorphazoidSynthesis.getState())).params[0]).toBe(1);
  const attack = page.locator('.synth-envelope__number[data-stage="attack"]');
  await exact(page, attack, "12");
  const release = page.locator('.synth-envelope__number[data-stage="release"]');
  await exact(page, release, "16");
  expect((await page.evaluate(() => window.MorphazoidSynthesis.getState())).envelope).toMatchObject({ attack: 12, release: 16 });
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
});


test("calibrated output reaches the browser destination with usable level and independent master gain", async ({ page }, testInfo) => {
  await page.goto("/synthesis.html?method=additive");
  await expect(page.locator("#outputLevel")).toHaveValue("0.7");
  await expect(page.locator("#outputLevel")).toHaveAttribute("max", "1");
  expect((await readAudioStatus(page)).active).toBe(false);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#playButton").click();
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.02);
  const normal = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(normal.summary.maxPeak).toBeLessThan(.67);
  expect(normal.summary.clippedSamples).toBe(0);
  const setLevel = value => page.locator("#outputLevel").evaluate((input, level) => {
    input.value = String(level); input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await setLevel(.35);
  await page.waitForTimeout(200);
  const half = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(normal.summary.meanRms / half.summary.meanRms).toBeGreaterThan(1.8);
  expect(normal.summary.meanRms / half.summary.meanRms).toBeLessThan(2.2);
  await setLevel(0);
  await waitForStableAudioState(page, false);
  await page.locator("#nextPreset").click();
  expect((await page.evaluate(() => window.MorphazoidSynthesis.getState())).outputLevel).toBe(0);
  await waitForStableAudioState(page, false);
  await testInfo.attach("synthesis-master-levels.json", { body: JSON.stringify({ normal, half }, null, 2), contentType: "application/json" });
});

test('processor controls use real sources and finite auditions without a note envelope', async ({ page }) => {
  await page.goto('/synthesis.html?method=fx-biquad');
  await expect(page.locator('#processingControls')).toBeVisible();
  await expect(page.locator('#envelopeDetails')).toBeHidden();
  await expect(page.locator('#keyboardDetails')).toBeHidden();
  await page.locator('#triggerButton').click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
  await page.locator('#audioButton').click();
  await page.locator('#nextPreset').click();
  await expect.poll(() => page.locator('#signalStatus').textContent()).toBe('Sounding');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().playing)).toBe(false);
  await expect.poll(() => page.locator('#signalStatus').textContent(), { timeout: 6500 }).toBe('Ready');
  await choose(page, "processingSource", "file");
  await page.locator('#playButton').click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().input.kind)).toBe('none');
  await expect(page.locator('#signalStatus')).toHaveText('Ready');
});

test('touchstones load controlled settings and comparison buttons reach actual parameters', async ({ page }) => {
  await page.goto('/synthesis.html?method=fx-ladder');
  await expect(page.locator('#synth-param-3')).toHaveValue('1');
  await choose(page, "touchstoneSelect", 'ladder-study-1');
  await page.locator('#loadTouchstone').click();
  await page.getByRole('button', { name: 'Poles: 2-pole', exact: true }).click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getState().params[3])).toBe(0);
  await expect(page.locator('#synth-param-3')).toHaveValue('0');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
  await selectMethod(page, 'sampling');
  await page.locator('#loadTouchstone').click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getState().frequencyHz)).toBe(220);
  await expect(page.locator('#touchstoneListen')).toContainText('octave');
});

test('microphone permission is explicit and late grants close after cancellation', async ({ page }) => {
  await page.addInitScript(() => {
    window.inputRequests = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => {
      window.inputRequests++;
      return new Promise(resolve => { window.resolveInput = resolve; });
    } });
  });
  await page.goto('/synthesis.html?method=fx-biquad');
  await page.locator('#audioButton').click();
  await page.locator('#nextPreset').click();
  expect(await page.evaluate(() => window.inputRequests)).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await choose(page, 'processingSource', 'microphone');
  expect(await page.evaluate(() => window.inputRequests)).toBe(1);
  await expect(page.locator('#stopInput')).toBeEnabled();
  await page.locator('#stopInput').click();
  await page.evaluate(() => {
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    window.testInputTrack = destination.stream.getAudioTracks()[0];
    window.resolveInput(destination.stream);
    context.close();
  });
  await expect.poll(() => page.evaluate(() => window.testInputTrack.readyState)).toBe('ended');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().input.kind)).toBe('none');
});


test('entering a processor clears held synth keys so release cannot restart an audition', async ({ page }) => {
  await page.goto('/synthesis.html?method=additive');
  await page.locator('h1').click();
  await page.keyboard.down('z'); await page.keyboard.down('q');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(2);
  await selectMethod(page, 'fx-biquad');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(0);
  await page.keyboard.up('q'); await page.keyboard.up('z');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().playing)).toBe(false);
});

test('Mono is default; Poly survives the preset tour, Random, processor visits and held-note mode changes', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html?method=additive');
  await expect(page.locator('#voiceMode')).toHaveValue('mono');
  await choose(page, "voiceMode", 'poly');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
  await page.locator('#nextPreset').click();
  await expect(page.locator('#voiceMode')).toHaveValue('poly');
  await page.locator('#randomPreset').click();
  await expect(page.locator('#voiceMode')).toHaveValue('poly');
  await selectMethod(page, 'fx-delay');
  await expect(page.locator('#voiceModeControl')).toBeHidden();
  await selectMethod(page, 'additive');
  await expect(page.locator('#voiceMode')).toHaveValue('poly');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await page.locator('h1').click();
  await page.keyboard.down('z'); await page.keyboard.down('c'); await page.keyboard.down('b');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(3);
  await expect.poll(() => page.locator('#signalStatus').textContent()).toBe('Sounding');
  await choose(page, "voiceMode", 'mono');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(3);
  await choose(page, "voiceMode", 'poly');
  for (const key of ['z','c','b']) await page.keyboard.up(key);
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(0);
  await page.waitForTimeout(800);
  await expect(page.locator('#signalStatus')).toHaveText('Ready');
  await expect(page.locator('#audioError')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Poly MIDI same-pitch notes from different inputs and channels have independent ownership', async ({ page }) => {
  await page.goto('/synthesis.html?method=additive');
  await choose(page, "voiceMode", 'poly');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  const send = message => page.evaluate(message => dispatchEvent(new CustomEvent('morphazoid:midi-input', {
    cancelable:true, detail:{ routeId:'synthesis',message }
  })),message);
  const notes = [{sourceId:'keyboard-a',channel:0},{sourceId:'keyboard-b',channel:0},{sourceId:'keyboard-a',channel:1}];
  for (const scope of notes) await send({...scope,type:'noteOn',note:69,velocity:100});
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(3);
  for (let i=0;i<notes.length;i++) {
    await send({...notes[i],type:'noteOff',note:69,velocity:0});
    expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(2-i);
  }
  await send({type:'panic'});
  await expect(page.locator('#audioError')).toBeHidden();
});

test('Audio rearming restores physically held notes in either voice mode', async ({ page }) => {
  await page.goto('/synthesis.html?method=additive');
  for (const mode of ['mono','poly']) {
    await choose(page, "voiceMode", mode);
    if (!await page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)) await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
    await page.locator('h1').click();
    for (const key of ['z','c','b']) await page.keyboard.down(key);
    await expect.poll(() => page.locator('#signalStatus').textContent()).toBe('Sounding');
    await page.locator('#audioButton').click();
    expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().heldNotes)).toBe(3);
    await page.locator('#audioButton').click();
    await expect.poll(() => page.locator('#signalStatus').textContent()).toBe('Sounding');
    for (const key of ['z','c','b']) await page.keyboard.up(key);
    await expect.poll(() => page.locator('#signalStatus').textContent()).toBe('Ready');
    await expect(page.locator('#audioError')).toBeHidden();
  }
});


test('shared preset dice randomizes across methods while local Random keeps the current method', async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => .5; });
  await page.goto('/synthesis.html?method=additive');
  await expect(page.locator('#presetHost .header-preset-controls')).toHaveCount(1);
  await expect(page.locator('#presetHost .header-preset-random svg')).toHaveCount(1);
  await expect(page.locator('[data-full-preset]')).toHaveCount(SECTION_PRESETS.synthesis.length);
  await choose(page, "voiceMode", 'poly');
  await page.locator('#outputLevel').evaluate(input => { input.value = '.31'; input.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.locator('#playButton').click();
  const before = await page.evaluate(() => window.MorphazoidSynthesis.getState());
  await page.locator('#randomPreset').click();
  const global = await page.evaluate(() => window.MorphazoidSynthesis.getState());
  expect(global.methodId).not.toBe(before.methodId);
  expect(global.presetId).toBe('custom');
  expect(global.outputLevel).toBe(.31);
  expect(global.voiceMode).toBe('poly');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus())).toMatchObject({armed:false,playing:true,tempo:120});
  await expect(page.locator('#presetHost .instrument-picker-current')).toHaveText('Preset · Custom');
  await selectMethod(page, 'fm');
  const factory = await page.evaluate(() => window.MorphazoidSynthesis.getState());
  await page.locator('#randomMethod').click();
  const local = await page.evaluate(() => window.MorphazoidSynthesis.getState());
  expect(local.methodId).toBe('fm');
  expect(local.params).not.toEqual(factory.params);
  expect(local.envelope).not.toEqual(factory.envelope);
  expect(local.presetId).toBe('custom');
  expect(local.outputLevel).toBe(.31);
  expect(local.voiceMode).toBe('poly');
  await page.locator('#nextPreset').click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getState().presetId)).toBe(METHODS.find(m=>m.id==='fm').presets[1].id);
  await page.locator('#randomPreset').click();
  await page.locator('#nextPreset').click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getState())).toMatchObject({methodId:'fm',presetId:METHODS.find(m=>m.id==='fm').presets[2].id});
});

test('full preset menu filters across methods and recalls one complete sound while preserving performance choices',async({page})=>{
  await page.goto('/synthesis.html?method=additive');
  await choose(page, "voiceMode", 'poly');
  await page.locator('.header-preset-picker summary').click();
  await page.locator('#header-preset-panel input').fill('Karplus');
  const rows=page.locator('[data-full-preset]:visible');
  expect(await rows.count()).toBeGreaterThanOrEqual(8);
  const chosen=await rows.first().getAttribute('data-preset-id');
  await rows.first().click();
  const state=await page.evaluate(()=>window.MorphazoidSynthesis.getState());
  expect(`${state.methodId}:${state.presetId}`).toBe(chosen);
  expect(state.voiceMode).toBe('poly');
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
  await expect(page.locator('.header-preset-picker')).not.toHaveAttribute('open','');
});


test('sections remember independent edits and preset cursors while preserving performance choices', async ({page})=>{
  await page.addInitScript(()=>{
    Math.random=()=>.7;
    window.inputRequests=0;
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>{window.inputRequests++;return Promise.reject(new Error('Unexpected input request'));}});
  });
  await page.goto('/synthesis.html?method=additive');
  await expect(page.locator('#presetHost .instrument-picker-current')).toHaveText('Select Preset');
  await choose(page, "voiceMode", 'poly');
  await choose(page, "playbackMode", 'repeat');
  await exact(page, "#tempo-value", 193);
  await exact(page, "#noteGate-value", 42);
  await page.locator('#playButton').click();
  const synth=METHODS.find(m=>m.id==='additive');
  await selectSoundPreset(page,synth.id,synth.presets[2].id);
  await page.locator('#randomPreset').click();
  const synthState=await page.evaluate(()=>window.MorphazoidSynthesis.getState());
  expect(methodSection(synthState.methodId)).toBe('synthesis');
  await page.locator('#sectionProcessing').click();
  await expect(page.locator('#presetHost .instrument-picker-current')).toHaveText('Select Preset');
  const effect=METHODS.find(m=>m.id==='fx-delay');
  await selectSoundPreset(page,effect.id,effect.presets[3].id);
  await choose(page, 'processingSource', 'microphone');
  await page.locator('#randomPreset').click();
  const effectState=await page.evaluate(()=>window.MorphazoidSynthesis.getState());
  expect(methodSection(effectState.methodId)).toBe('processing');
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getStatus().input)).toMatchObject({selection:'microphone', source:0, kind:'none'});
  await page.locator('#outputLevel').evaluate(input=>{input.value='.42';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#sectionSynthesis').click();
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getState())).toEqual({...synthState,outputLevel:.42});
  await expect(page.locator('#presetHost .instrument-picker-current')).toHaveText('Preset · Custom');
  await page.locator('#nextPreset').click();
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getState())).toMatchObject({methodId:synth.id,presetId:synth.presets[3].id});
  await page.locator('#sectionProcessing').click();
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getState())).toEqual({...effectState,outputLevel:.42});
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getStatus().input)).toMatchObject({selection:'microphone', source:0, kind:'none'});
  await page.locator('#nextPreset').click();
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getState())).toMatchObject({methodId:effect.id,presetId:effect.presets[4].id});
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getStatus())).toMatchObject({armed:false,playing:true,tempo:193,noteGate:.42,playbackMode:'repeat',voiceMode:'poly'});
  expect(await page.evaluate(()=>window.inputRequests)).toBe(0);
});

test('deep links and host recalls select the matching section with one scoped toolbar',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const effect=METHODS.find(m=>m.id==='fx-biquad');
  await page.goto('/synthesis.html?method='+effect.id+'&preset='+effect.presets[2].id);
  await expect(page.locator('#sectionProcessing')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#methodSelect option')).toHaveCount(SECTION_METHODS.processing.length);
  await expect(page.locator('[data-full-preset]')).toHaveCount(SECTION_PRESETS.processing.length);
  await expect(page.locator('#nextPreset')).toHaveAccessibleName('Next processing preset');
  await page.locator('#nextPreset').click();
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getState().presetId)).toBe(effect.presets[3].id);
  await page.evaluate(()=>window.MorphazoidSynthesis.applyState({methodId:'fm'}));
  await expect(page.locator('#sectionSynthesis')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#methodSelect')).toHaveValue('fm');
  await expect(page.locator('[data-full-preset]')).toHaveCount(SECTION_PRESETS.synthesis.length);
  for(let i=0;i<4;i++){
    await page.locator('#presetHost summary').click();
    await page.locator('#sectionProcessing').click();
    await page.locator('#sectionSynthesis').click();
  }
  await expect(page.locator('.header-preset-controls')).toHaveCount(1);
  await expect(page.locator('#header-preset-panel')).toHaveCount(1);
  await expect(page.locator('#presetHost summary')).toHaveAccessibleName('Synthesis presets');
  await expect(page.locator('#randomPreset')).toHaveAccessibleName('Randomize synthesis method and its settings');
  expect(errors).toEqual([]);
});

test('processing dice stays within processors and local Random keeps its method',async({page})=>{
  await page.addInitScript(()=>{Math.random=()=>.5;});
  await page.goto('/synthesis.html?method=fx-biquad');
  await page.locator('#randomPreset').click();
  const random=await page.evaluate(()=>window.MorphazoidSynthesis.getState());
  expect(random.methodId).not.toBe('fx-biquad');
  expect(methodSection(random.methodId)).toBe('processing');
  await expect(page.locator('#sectionProcessing')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#presetScope')).toContainText('Dice explores processors');
  await selectMethod(page,'fx-delay');
  const before=await page.evaluate(()=>window.MorphazoidSynthesis.getState());
  await page.locator('#randomMethod').click();
  const after=await page.evaluate(()=>window.MorphazoidSynthesis.getState());
  expect(after.methodId).toBe('fx-delay'); expect(after.params).not.toEqual(before.params);
  await expect(page.locator('#randomMethod')).toHaveText('Random effect');
  await expect(page.locator('#randomMethod')).toHaveAttribute('title', /only$/);
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
});

test('section switching cancels pending input and returning does not reopen a microphone',async({page})=>{
  await page.addInitScript(()=>{
    window.inputRequests=0;
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>{
      window.inputRequests++;return new Promise(resolve=>{window.resolveInput=resolve;});
    }});
  });
  await page.goto('/synthesis.html?method=fx-biquad');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await choose(page, 'processingSource', 'microphone');
  expect(await page.evaluate(()=>window.inputRequests)).toBe(1);
  await page.locator('#sectionSynthesis').click();
  await page.evaluate(()=>{
    const context=new AudioContext();const destination=context.createMediaStreamDestination();
    window.testInputTrack=destination.stream.getAudioTracks()[0];
    window.resolveInput(destination.stream);context.close();
  });
  await expect.poll(()=>page.evaluate(()=>window.testInputTrack.readyState)).toBe('ended');
  await page.locator('#sectionProcessing').click();
  await expect(page.locator('#processingSource')).toHaveValue('microphone');
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getStatus().input.kind)).toBe('none');
  expect(await page.evaluate(()=>window.inputRequests)).toBe(1);
});


test('synthesis sample and processing file labels follow their independent sources',async({page})=>{
  const wave=Buffer.alloc(44+4800*2);
  wave.write('RIFF',0);wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);
  wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);
  wave.writeUInt32LE(48000,24);wave.writeUInt32LE(96000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);
  wave.write('data',36);wave.writeUInt32LE(wave.length-44,40);
  for(let i=0;i<4800;i++)wave.writeInt16LE(Math.round(6000*Math.sin(2*Math.PI*220*i/48000)),44+i*2);
  await page.goto('/synthesis.html?method=sampling');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await page.locator('#sourceFile').setInputFiles({name:'synthesis-sample.wav',mimeType:'audio/wav',buffer:wave});
  await expect(page.locator('#sourceName')).toContainText('synthesis-sample.wav');
  await page.locator('#sectionProcessing').click();
  await choose(page, 'processingSource', 'file');
  await expect(page.locator('#sourceFileLabel')).toBeVisible();
  await page.locator('#sourceFile').setInputFiles({name:'processing-input.wav',mimeType:'audio/wav',buffer:wave});
  await expect(page.locator('#inputStatus')).toContainText('processing-input.wav');
  await expect(page.locator('#sourceName')).toBeHidden();
  await page.locator('#sectionSynthesis').click();
  await expect(page.locator('#sourceName')).toBeVisible();
  await expect(page.locator('#sourceName')).toContainText('synthesis-sample.wav');
  await page.locator('#sectionProcessing').click();
  await expect(page.locator('#processingSource')).toHaveValue('file');
  await expect(page.locator('#resumeFile')).toBeVisible();
  await page.locator('#resumeFile').click();
  await expect(page.locator('#inputStatus')).toContainText('processing-input.wav');
  await expect(page.locator('#audioError')).toBeHidden();
});
