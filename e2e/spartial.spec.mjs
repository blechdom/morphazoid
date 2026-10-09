import { expect, test } from "@playwright/test";

import {
  readAudioStatus,
  sampleAudioEnvelope,
  waitForAudioState,
  waitForStableAudioState,
} from "./helpers/audio-probe.mjs";
import {
  pageDiagnosticMessages,
  settlePage,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";
import {
  MIDI_BYTES,
  enableFakeMidi,
  installFakeMidi,
  sendMidi,
} from "./helpers/fake-midi.mjs";

const diagnosticsByPage = new WeakMap();

test.beforeEach(async ({ page, baseURL }) => {
  diagnosticsByPage.set(page, watchPageDiagnostics(page, { baseURL }));
  if (process.env.E2E_AUDIO_SILENT_SINK === "1") {
    // Keep real-time DSP and analyser measurements while bypassing a broken
    // host output device. Normal runs retain the production AudioContext.
    await page.addInitScript(() => {
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        constructor(options = {}) { super({ ...options, sinkId: { type: "none" } }); }
      };
    });
  }
});

test.afterEach(async ({ page }, testInfo) => {
  const messages = pageDiagnosticMessages(diagnosticsByPage.get(page));
  await testInfo.attach("spartial-browser-diagnostics.json", {
    body: JSON.stringify(messages, null, 2),
    contentType: "application/json",
  });
  expect(messages, "SPARTIAL must not emit browser or first-party request errors").toEqual([]);
});

async function openSpartial(page) {
  const response = await page.goto("spartial.html", { waitUntil: "load" });
  expect(response?.ok()).toBe(true);
  await settlePage(page);
  await expect(page.locator("#notePads button").first()).toBeVisible();
}

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function typeNumber(page, id, value) {
  const control = page.locator(`#${id}`);
  await control.click();
  await control.press("ControlOrMeta+A");
  await control.pressSequentially(String(value));
  await expect(control, "typing must not clamp an unfinished number").toHaveValue(String(value));
  await control.press("Tab");
}

async function expectCascadeControlsReachable(page) {
  for (const id of ["cascade", "cascadeMs", "cascadeStart", "cascadeStartMs", "cascadeCurve", "cascadeVariation", "restartCascade"]) {
    const control = page.locator(`#${id}`);
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
    const reachable = await control.evaluate(element => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return box.left >= -2 && box.right <= innerWidth + 2 && (hit === element || element.contains(hit));
    });
    expect(reachable, `${id} must be visible and reachable`).toBe(true);
  }
}

async function shortEnvelope(page) {
  // Avoid waiting through long cascades while testing ownership and release.
  await setRange(page, "cascade", 0);
  await setRange(page, "cascadeStart", 0);
  await setRange(page, "attack", 0.01);
  await setRange(page, "release", 0.06);
}

async function armAudio(page) {
  const audio = page.locator("#audioButton");
  if (await audio.getAttribute("aria-pressed") !== "true") await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "true");
}

async function expectKeyboardBeforeRotation(page) {
  const keyboard = await page.locator("#notePads").boundingBox();
  const rotation = await page.locator("#playButton").boundingBox();
  expect(keyboard.y + keyboard.height, "the keyboard appears above rotation playback").toBeLessThanOrEqual(rotation.y);
}

async function expectSustainedAudio(page, testInfo, name) {
  await waitForStableAudioState(page, true, { stableMs: 200 });
  const envelope = await sampleAudioEnvelope(page, { durationMs: 650, intervalMs: 50 });
  await testInfo.attach(`${name}-audio.json`, {
    body: JSON.stringify(envelope, null, 2),
    contentType: "application/json",
  });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxPeak).toBeGreaterThan(0.005);
  expect(envelope.summary.maxPeak).toBeLessThan(1);
  expect(envelope.summary.clippedSamples).toBe(0);
  expect(envelope.summary.activeSamples).toBeGreaterThanOrEqual(envelope.summary.sampleCount * 0.8);
  return envelope;
}

async function capture(page, testInfo, name) {
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

async function nativeTouchDrag(page, session, from, to) {
  const point = (x, y) => ({ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 });
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(from.x, from.y)] });
  try {
    for (let step = 1; step <= 8; step += 1) {
      await page.waitForTimeout(16);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point(from.x + (to.x - from.x) * step / 8, from.y + (to.y - from.y) * step / 8)],
      });
    }
    // Briefly hold before lifting so inertia cannot skip a control under test.
    await page.waitForTimeout(80);
  } finally {
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await page.waitForTimeout(50);
}

async function hitVisibleControl(page, selector) {
  return page.locator(selector).evaluate(control => {
    const box = control.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && (hit === control || control.contains(hit));
  });
}

test("SPARTIAL opens stationary with a chromatic keyboard and current performance header", async ({ page }, testInfo) => {
  await openSpartial(page);
  await expect(page.locator("#motion")).toHaveValue("off");
  await expect(page.locator("#tempo")).toHaveValue("90");
  await expect(page.locator("#cycles")).toHaveValue("1");
  await expect(page.locator("#partials")).toHaveValue("16");
  await expect(page.locator("#stretch")).toHaveValue("1");
  await expect(page.locator("#inharmonicity")).toHaveValue("0");
  await expect(page.locator("#mode")).toHaveValue("single");
  await expect(page.locator("#chord")).toBeDisabled();
  await expect(page.locator("#notePads button")).toHaveCount(13);
  await expect(page.locator("#notePads button.black-key")).toHaveCount(5);
  const notes = await page.locator("#root option").evaluateAll(options => options.map(option => Number(option.value)));
  expect(notes).toContain(48);
  expect(notes).toContain(60);
  expect(notes.every((note, index) => index === 0 || note === notes[index - 1] + 1)).toBe(true);
  await expect(page.locator(".panel #playButton")).toBeVisible();
  await expect(page.locator(".panel #tempo")).toBeVisible();
  await expect(page.locator(".panel #notePads")).toBeVisible();
  await expectKeyboardBeforeRotation(page);
  await expect(page.locator(".tempo-field.mz-range-knob #tempo")).toHaveAttribute("type", "range");
  await expect(page.locator("#tempoOut")).toHaveText("90 BPM");
  await expect(page.locator("#playButton")).toHaveAccessibleName("Play rotation");
  await expect(page.locator("#holdButton")).toHaveText("Hold note");
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".instrument-picker-next")).toBeVisible();
  await expect(page.locator(".header-level.mz-range-knob #level")).toHaveCount(1);
  await expect(page.locator(".header-settings-menu #sharedMidiToggle")).toHaveCount(1);
  await expect(page.locator("#sharedMidiToggle")).not.toBeVisible();
  await expect(page.getByText("One sound. Many places.", { exact: true })).toHaveCount(0);
  await expect(page.locator("#voiceReadout, #motionReadout, #gatherButton, #freezeButton")).toHaveCount(0);
  expect(await page.locator("#stageWrap").evaluate(node => getComputedStyle(node).borderWidth)).toBe("0px");

  // The volume knob remains the original keyboard-accessible native range.
  await page.locator("#level").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#level")).toHaveValue("0.66");
  await expect(page.locator("#levelOut")).toHaveText("66%");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await capture(page, testInfo, "spartial-static-default");
});

test("SPARTIAL tempo knob responds live to drag and keyboard without starting rotation or sound", async ({ page }) => {
  await openSpartial(page);
  const tempo = page.locator("#tempo");
  await tempo.scrollIntoViewIfNeeded();
  const box = await tempo.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await expect(tempo, "taking hold of the knob must not jump its value").toHaveValue("90");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 24, { steps: 6 });
    const dragged = Number(await tempo.inputValue());
    expect(dragged).toBeGreaterThan(90);
    await expect(page.locator("#tempoOut"), "BPM follows the drag before pointer release").toHaveText(`${dragged} BPM`);
  } finally {
    await page.mouse.up();
  }
  await tempo.press("Home");
  await expect(tempo).toHaveValue("30");
  await tempo.press("ArrowUp");
  await expect(tempo).toHaveValue("31");
  await expect(page.locator("#tempoOut")).toHaveText("31 BPM");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("SPARTIAL Play rotation starts clockwise from Off and Pause retains the angle", async ({ page }) => {
  await openSpartial(page);
  const distinctCanvasFrames = () => page.locator("#stage").evaluate(async canvas => {
    const frames = new Set();
    await new Promise(resolve => requestAnimationFrame(resolve));
    for (let index = 0; index < 12; index += 1) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      frames.add(canvas.toDataURL());
    }
    return frames.size;
  });
  expect(await distinctCanvasFrames(), "default routing is stationary").toBe(1);
  await setRange(page, "tempo", 120);
  await expect(page.locator("#tempoOut")).toHaveText("120 BPM");
  await page.locator("#playButton").click();
  await expect(page.locator("#motion")).toHaveValue("cw");
  await expect(page.locator("#playButton")).toHaveAccessibleName("Pause rotation");
  expect(await distinctCanvasFrames(), "Play advances the partial destinations").toBeGreaterThan(1);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#playButton").click();
  await expect(page.locator("#playButton")).toHaveAccessibleName("Play rotation");
  expect(await distinctCanvasFrames(), "Pause retains the stopped position").toBe(1);
  await page.locator("#motion").selectOption("ccw");
  expect(await distinctCanvasFrames(), "selecting a pattern while paused does not start rotation").toBe(1);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#motion").selectOption("off");
  await page.locator("#playButton").click();
  await expect(page.locator("#motion")).toHaveValue("cw");
  expect(await distinctCanvasFrames(), "Play restarts a usable clockwise rotation from Off").toBeGreaterThan(1);
  await page.locator("#routingMode").selectOption("focus");
  await expect(page.locator("#playButton")).toBeDisabled();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#playButton")).toHaveAccessibleName("Play rotation");
  expect(await distinctCanvasFrames(), "one-speaker routing has no rotation").toBe(1);
});

test("SPARTIAL cascade controls preserve individual milliseconds and deterministic timing readouts", async ({ page }) => {
  await openSpartial(page);
  await expect(page.locator("#cascade")).toHaveAttribute("step", "1");
  await expect(page.locator("#cascade")).toHaveAttribute("max", "500");
  await expect(page.locator("#cascade")).toHaveValue("45");
  await expect(page.locator("#cascadeMs")).toHaveValue("45");
  await expect(page.locator("#cascadeStart")).toHaveAttribute("step", "1");
  await expect(page.locator("#cascadeStart")).toHaveAttribute("max", "2000");
  await expect(page.locator("#cascadeCurve")).toHaveValue("0");
  await expect(page.locator("#cascadeVariation")).toHaveValue("0");

  for (const milliseconds of [1, 2, 137]) {
    await typeNumber(page, "cascadeMs", milliseconds);
    await expect(page.locator("#cascade")).toHaveValue(String(milliseconds));
    await expect(page.locator("#cascadeOut")).toHaveText(`${milliseconds} ms`);
    await expect(page.locator("#cascadeDurationOut")).toHaveText(`${15 * milliseconds} ms`);
  }
  await setRange(page, "cascade", 1);
  await expect(page.locator("#cascadeMs")).toHaveValue("1");
  await typeNumber(page, "cascadeStartMs", 137);
  await expect(page.locator("#cascadeStart")).toHaveValue("137");
  await expect(page.locator("#cascadeStartOut")).toHaveText("137 ms");
  await setRange(page, "cascadeStart", 2);
  await expect(page.locator("#cascadeStartMs")).toHaveValue("2");
  await expect(page.locator("#cascadeStartOut")).toHaveText("2 ms");
  await expect(page.locator("#cascadeDurationOut")).toHaveText("17 ms");

  await setRange(page, "cascade", 31);
  await setRange(page, "cascadeCurve", 0.5);
  await setRange(page, "cascadeVariation", 0.6);
  const readTimes = () => page.locator("#cascadeTimeline span").evaluateAll(marks => (
    marks.map(mark => Number(mark.title.match(/:\s*([\d.]+)\s*ms$/)?.[1]))
  ));
  const firstTimes = await readTimes();
  expect(firstTimes).toHaveLength(16);
  expect(firstTimes[0]).toBe(2);
  expect(firstTimes.at(-1)).toBe(467);
  expect(firstTimes.every((time, index) => Number.isFinite(time) && (index === 0 || time > firstTimes[index - 1]))).toBe(true);
  await expect(page.locator("#cascadeDurationOut")).toHaveText("467 ms");
  await setRange(page, "cascadeCurve", -0.4);
  await setRange(page, "cascadeVariation", 0.2);
  expect(await readTimes()).not.toEqual(firstTimes);
  await expect(page.locator("#cascadeDurationOut")).toHaveText("467 ms");
  await setRange(page, "cascadeCurve", 0.5);
  await setRange(page, "cascadeVariation", 0.6);
  expect(await readTimes()).toEqual(firstTimes);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await expectCascadeControlsReachable(page);
});

test("SPARTIAL Restart belongs to Hold and preserves independent rotation and Audio", async ({ page }, testInfo) => {
  await openSpartial(page);
  const restart = page.locator("#restartCascade");
  await expect(restart).toBeDisabled();
  await page.locator("#motion").selectOption("cw");
  await page.locator("#playButton").click();
  await expect(restart, "rotation alone does not create a note to restart").toBeDisabled();
  await page.locator("#playButton").click();
  await page.locator("#holdButton").click();
  await expect(restart).toBeEnabled();
  await restart.click();
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#holdButton")).toHaveText("Release note");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#motion")).toHaveValue("cw");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#holdButton").click();
  await expect(restart).toBeDisabled();

  await shortEnvelope(page);
  await setRange(page, "partials", 4);
  await setRange(page, "release", 2);
  await page.locator("#mode").selectOption("chord");
  await page.locator("#chord").selectOption("major");
  await expect(page.locator("#holdButton")).toHaveText("Hold chord");
  // Make only the last partial audible: a milliseconds/seconds wiring error
  // then postpones the entire new sound instead of hiding behind its root.
  await page.locator("#partialSliders input").evaluateAll(inputs => {
    for (const input of inputs.slice(0, -1)) {
      input.value = "0";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await armAudio(page);
  await page.locator("#holdButton").click();
  await expect(page.locator("#holdButton")).toHaveText("Release chord");
  await page.locator("#playButton").click();
  await expectSustainedAudio(page, testInfo, "cascade-before-edit");

  await typeNumber(page, "cascadeStartMs", 600);
  await typeNumber(page, "cascadeMs", 2);
  await expectSustainedAudio(page, testInfo, "cascade-edit-keeps-held-chord");
  await restart.click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#motion")).toHaveValue("cw");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  // Restart must clear the old chord promptly even with a long normal release,
  // so its tail cannot mask the newly scheduled silent lead-in.
  await waitForStableAudioState(page, false, { stableMs: 100, timeout: 700 });
  await expectSustainedAudio(page, testInfo, "cascade-delayed-restart");

  await typeNumber(page, "cascadeStartMs", 20);
  await restart.click();
  await expectSustainedAudio(page, testInfo, "cascade-short-restart");
  await page.locator("#panicButton").click();
  await expect(restart).toBeDisabled();
  await expect(page.locator("#holdButton")).toHaveText("Hold chord");
  await expect(page.locator("#playButton"), "Silence releases voices without pausing rotation").toHaveAttribute("aria-pressed", "true");
  await waitForStableAudioState(page, false);
});

test("SPARTIAL preset and fingerprint controls reshape a held sound without stopping it", async ({ page }, testInfo) => {
  await openSpartial(page);
  await shortEnvelope(page);
  await armAudio(page);
  await page.locator("#holdButton").click();
  await waitForAudioState(page, true);

  const firstPreset = await page.locator("#preset").inputValue();
  await page.locator("#nextPreset").click();
  await expect(page.locator("#preset")).not.toHaveValue(firstPreset);
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await waitForStableAudioState(page, true, { stableMs: 150 });
  await page.locator("#randomPreset").click();
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await waitForStableAudioState(page, true, { stableMs: 150 });

  const partialValues = () => page.locator("#partialSliders input").evaluateAll(inputs => inputs.map(input => Number(input.value)));
  const firstSpectrum = await page.locator("#spectrumPreset").inputValue();
  const firstValues = await partialValues();
  await page.locator("#nextSpectrum").click();
  await expect(page.locator("#spectrumPreset")).not.toHaveValue(firstSpectrum);
  expect(await partialValues()).not.toEqual(firstValues);
  const nextValues = await partialValues();
  await page.locator("#randomSpectrum").click();
  const randomValues = await partialValues();
  expect(randomValues).not.toEqual(nextValues);
  expect(randomValues.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expectSustainedAudio(page, testInfo, "mutated-fingerprint");
  await page.locator("#panicButton").click();
  await waitForStableAudioState(page, false);
});

test("SPARTIAL supports 32 inharmonic partials and compressed or repeated spatial cycles while sounding", async ({ page }, testInfo) => {
  await openSpartial(page);
  await shortEnvelope(page);
  await armAudio(page);
  await page.locator("#holdButton").click();
  await waitForAudioState(page, true);
  await setRange(page, "partials", 32);
  await expect(page.locator("#partialSliders input")).toHaveCount(32);
  await setRange(page, "stretch", 1.35);
  await setRange(page, "inharmonicity", 0.6);
  for (const cycles of [0, 0.25, 1, 4]) {
    await setRange(page, "cycles", cycles);
    await expect(page.locator("#cycles")).toHaveValue(String(cycles));
    await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
    await waitForStableAudioState(page, true, { stableMs: 150 });
  }
  await expectSustainedAudio(page, testInfo, "inharmonic-four-turns");
  await page.locator("#routingMode").selectOption("focus");
  await expect(page.locator("#target")).toBeVisible();
  await expect(page.locator("#cycles")).not.toBeVisible();
  await page.locator("#target").selectOption({ index: 2 });
  const stage = page.locator("#stage");
  const box = await stage.boundingBox();
  const radius = Math.min(box.width * 0.37, box.height * 0.34);
  await stage.click({ position: { x: box.width / 2 - radius, y: box.height / 2 } });
  await expect(page.locator("#target")).toHaveValue("6");
  await stage.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.locator("#target")).toHaveValue("6");
  await stage.press("ArrowRight");
  await expect(page.locator("#target")).toHaveValue("7");
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await expectSustainedAudio(page, testInfo, "inharmonic-focused");
  await capture(page, testInfo, "spartial-single-speaker");
  await page.locator("#routingMode").selectOption("spread");
  await expect(page.locator("#cycles")).toHaveValue("4");
  await expect(page.locator("#stretch")).toHaveValue("1.35");
  await expect(page.locator("#inharmonicity")).toHaveValue("0.6");
  await page.locator("#panicButton").click();
  await waitForStableAudioState(page, false);
});

test("SPARTIAL rotation, Hold, and Audio remain independent through pause and re-arm", async ({ page }, testInfo) => {
  await openSpartial(page);
  await shortEnvelope(page);
  const audio = page.locator("#audioButton");
  const play = page.locator("#playButton");
  const hold = page.locator("#holdButton");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#transportAudioAttention")).toHaveCount(0);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect((await readAudioStatus(page)).active).toBe(false);

  await armAudio(page);
  await waitForStableAudioState(page, false);
  const rotationOnly = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 50 });
  expect(rotationOnly.summary.finite).toBe(true);
  expect(rotationOnly.summary.maxPeak, "rotation must not start a synthesizer voice").toBeLessThan(0.001);
  await expect(hold).toHaveAttribute("aria-pressed", "false");

  await audio.click();
  await hold.click();
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await waitForStableAudioState(page, false);
  await armAudio(page);
  await expectSustainedAudio(page, testInfo, "armed-note");
  await capture(page, testInfo, "spartial-desktop-playing");

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  await expectSustainedAudio(page, testInfo, "rotation-paused-note-remains");

  await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  await waitForStableAudioState(page, false);

  await armAudio(page);
  await expectSustainedAudio(page, testInfo, "rearmed-note");
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await hold.click();
  await expect(hold).toHaveAttribute("aria-pressed", "false");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(audio).toHaveAttribute("aria-pressed", "true");
  await waitForStableAudioState(page, false);
});

test("SPARTIAL master level reaches silence and Silence releases the held sound", async ({ page }, testInfo) => {
  await openSpartial(page);
  await shortEnvelope(page);
  await armAudio(page);
  await page.locator("#holdButton").click();
  const sounding = await expectSustainedAudio(page, testInfo, "level-normal");

  await setRange(page, "level", 0);
  await expect(page.locator("#levelOut")).toHaveText("0%");
  await waitForStableAudioState(page, false);
  const muted = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 50 });
  expect(muted.summary.maxPeak).toBeLessThan(0.001);
  expect(muted.summary.maxRms).toBeLessThan(sounding.summary.maxRms * 0.01);
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");

  await setRange(page, "level", 0.65);
  await waitForAudioState(page, true);
  await page.locator("#panicButton").click();
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await waitForStableAudioState(page, false);
});

test("SPARTIAL keeps held notes sounding across voice, preset, and speaker-array changes", async ({ page }, testInfo) => {
  await openSpartial(page);
  await shortEnvelope(page);
  await armAudio(page);
  await page.locator("#holdButton").click();
  await waitForAudioState(page, true);

  await page.locator('[data-section="sound"] > summary').click();
  for (const [id, value] of [
    ["mode", "single"],
    ["mode", "chord"],
    ["chord", "major"],
    ["preset", "rise"],
    ["layout", "4-ring"],
    ["layout", "7-4-1"],
    ["layout", "8-cube"],
    ["layout", "16-ring"],
    ["preset", "organ"],
  ]) {
    await test.step(`${id}: ${value}`, async () => {
      await page.locator(`#${id}`).selectOption(value);
      await expect(page.locator(`#${id}`)).toHaveValue(value);
      await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      await waitForStableAudioState(page, true, { stableMs: 150, timeout: 6000 });
    });
  }

  await page.locator("#forcePreview").check();
  await expect(page.locator("#routeBadge")).toContainText(/stereo|preview/i);
  await expectSustainedAudio(page, testInfo, "changed-layout");
  await page.locator("#routingMode").selectOption("focus");
  await expect(page.locator("#routingMode")).toHaveValue("focus");
  await expect(page.locator("#target")).toBeVisible();
  await page.locator("#target").selectOption({ index: 2 });
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await expectSustainedAudio(page, testInfo, "single-speaker");
  await page.locator("#panicButton").click();
  await waitForStableAudioState(page, false);
});

test("SPARTIAL note pads release when the pointer leaves the pad and is lifted", async ({ page }, testInfo) => {
  await openSpartial(page);
  await shortEnvelope(page);
  await armAudio(page);
  const pad = page.locator("#notePads button").first();
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await expectSustainedAudio(page, testInfo, "held-pointer-note");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
    await page.mouse.move(3, 3);
  } finally {
    await page.mouse.up();
  }
  await waitForStableAudioState(page, false);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
});

test("SPARTIAL cancels an interrupted pad gesture without leaving a held note", async ({ page }) => {
  await openSpartial(page);
  await shortEnvelope(page);
  await armAudio(page);
  const pad = page.locator("#notePads button").first();
  await pad.hover();
  await page.mouse.down();
  try {
    await waitForAudioState(page, true);
    // Pointer ID 1 is the active primary mouse pointer in Chromium.
    await pad.dispatchEvent("pointercancel", {
      pointerId: 1, pointerType: "mouse", isPrimary: true,
    });
    await waitForStableAudioState(page, false);
  } finally {
    await page.mouse.up();
  }
});

test("SPARTIAL MIDI note-on and note-off own independent sustained voices", async ({ page }, testInfo) => {
  await installFakeMidi(page);
  await openSpartial(page);
  await shortEnvelope(page);
  await armAudio(page);
  await page.locator(".header-settings-menu > summary").click();
  await enableFakeMidi(page);
  await page.locator(".header-settings-menu > summary").click();
  await waitForStableAudioState(page, false);

  await sendMidi(page, MIDI_BYTES.noteOn(60, 100));
  await sendMidi(page, MIDI_BYTES.noteOn(67, 90));
  await expectSustainedAudio(page, testInfo, "midi-two-notes");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#playButton").click();
  await expectSustainedAudio(page, testInfo, "midi-notes-during-rotation");
  await page.locator("#playButton").click();
  await expectSustainedAudio(page, testInfo, "midi-notes-after-rotation-pause");
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "false");

  await sendMidi(page, MIDI_BYTES.noteOff(60));
  await expectSustainedAudio(page, testInfo, "midi-one-note-remains");
  await sendMidi(page, MIDI_BYTES.noteOff(67));
  await waitForStableAudioState(page, false);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");

  await sendMidi(page, MIDI_BYTES.noteOn(64, 100));
  await waitForAudioState(page, true);
  await page.locator(".header-settings-menu > summary").click();
  await page.locator("#sharedMidiToggle").click();
  await waitForStableAudioState(page, false);
});

for (const [key, padIndex] of [["a", 0], ["w", 1]]) {
  test(`SPARTIAL ${key.toUpperCase()} key holds and releases a chromatic note in the default mode`, async ({ page }, testInfo) => {
    await openSpartial(page);
    await shortEnvelope(page);
    const pad = page.locator("#notePads button").nth(padIndex);

    // Page performance keys remain separate from the Audio arm.
    await page.locator("#stage").focus();
    await page.keyboard.down(key);
    await expect(pad).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await page.keyboard.up(key);
    await expect(pad).toHaveAttribute("aria-pressed", "false");

    await armAudio(page);
    await page.locator("#stage").focus();
    await page.keyboard.down(key);
    try {
      await expect(pad).toHaveAttribute("aria-pressed", "true");
      await expectSustainedAudio(page, testInfo, `held-${key}-key`);
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
    } finally {
      await page.keyboard.up(key);
    }
    await expect(pad).toHaveAttribute("aria-pressed", "false");
    await waitForStableAudioState(page, false);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  });
}

test("SPARTIAL assistive click-only pad activation toggles a sustained note and releases it", async ({ page }, testInfo) => {
  await openSpartial(page);
  await shortEnvelope(page);
  await armAudio(page);
  const pad = page.locator("#notePads button").first();
  await pad.focus();

  // Assistive activation may emit click(detail=0) with no pointer or key event.
  await pad.dispatchEvent("click", { detail: 0 });
  await expect(pad).toHaveAttribute("aria-pressed", "true");
  await expectSustainedAudio(page, testInfo, "assistive-click-note");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");

  await pad.dispatchEvent("click", { detail: 0 });
  await expect(pad).toHaveAttribute("aria-pressed", "false");
  await waitForStableAudioState(page, false);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");

  // Another activation remains usable after the first note has fully released.
  await pad.dispatchEvent("click", { detail: 0 });
  await waitForAudioState(page, true);
  await pad.dispatchEvent("click", { detail: 0 });
  await waitForStableAudioState(page, false);
});

test("SPARTIAL can re-arm and play after navigating away and returning with Back", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.__spartialQaPageShows = [];
    window.addEventListener("pageshow", (event) => {
      window.__spartialQaPageShows.push({ persisted: event.persisted });
    });
  });
  await openSpartial(page);
  await shortEnvelope(page);
  await armAudio(page);
  await page.locator("#holdButton").click();
  await expectSustainedAudio(page, testInfo, "before-navigation");

  await page.goto("index.html", { waitUntil: "load" });
  await settlePage(page);
  await waitForStableAudioState(page, false);
  await page.goBack({ waitUntil: "load" });
  await settlePage(page);
  await expect(page).toHaveURL(/\/spartial\.html$/);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await waitForStableAudioState(page, false);

  await testInfo.attach("spartial-back-lifecycle.json", {
    body: JSON.stringify(await page.evaluate(() => ({
      pageshow: window.__spartialQaPageShows,
      navigationType: performance.getEntriesByType("navigation").at(-1)?.type,
    })), null, 2),
    contentType: "application/json",
  });

  // A cached document can retain Hold; a reload starts with Hold off.
  // Both must recover through the same explicit Audio action.
  await shortEnvelope(page);
  await armAudio(page);
  if (await page.locator("#holdButton").getAttribute("aria-pressed") !== "true") {
    await page.locator("#holdButton").click();
  }
  await expectSustainedAudio(page, testInfo, "after-back");
  await page.locator("#holdButton").click();
  await waitForStableAudioState(page, false);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
});

test.describe("SPARTIAL phone layout", () => {
  test.use({ isMobile: true, hasTouch: true });

  for (const layout of [
    { name: "portrait", width: 390, height: 844 },
    { name: "landscape", width: 844, height: 390 },
  ]) {
    test(`SPARTIAL ${layout.name} pins the graphic during wheel and native touch scrolling`, async ({ page }, testInfo) => {
      test.setTimeout(45_000);
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await openSpartial(page);
      const session = await page.context().newCDPSession(page);
      const scroller = page.locator("#spartialControls");
      const graphic = page.locator("#stageWrap");
      let graphicBox = await graphic.boundingBox();
      const assertGraphicPinned = async () => {
        const current = await graphic.boundingBox();
        for (const property of ["x", "y", "width", "height"]) {
          expect(Math.abs(current[property] - graphicBox[property]), `graphic ${property} stays fixed`).toBeLessThan(1);
        }
        expect(await page.evaluate(() => scrollY)).toBe(0);
      };
      const scrollPosition = () => scroller.evaluate(element => element.scrollTop);
      const swipeControls = async direction => {
        const box = await scroller.boundingBox();
        const x = box.x + 10;
        const distance = Math.min(160, box.height * 0.45);
        const startY = direction === "forward" ? box.y + box.height - 18 : box.y + 18;
        await nativeTouchDrag(page, session, { x, y: startY }, { x, y: startY + (direction === "forward" ? -distance : distance) });
        await assertGraphicPinned();
      };

      expect(await scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      expect(await hitVisibleControl(page, "#spectrumPreset")).toBe(true);
      const pane = await scroller.boundingBox();
      await page.mouse.move(pane.x + 10, pane.y + pane.height / 2);
      await page.mouse.wheel(0, 120);
      await expect.poll(scrollPosition).toBeGreaterThan(20);
      await assertGraphicPinned();

      // Follow the same continuous control pane using native touch input only.
      // No scrollIntoView/scrollTop writes participate in this navigation.
      for (const selector of ["#notePads button:first-child", "#playButton", "#cascadeMs", "#resetAll"]) {
        for (let step = 0; step < 55 && !await hitVisibleControl(page, selector); step += 1) {
          const previous = await scrollPosition();
          await swipeControls("forward");
          expect(await scrollPosition(), `touch swipe progresses toward ${selector}`).toBeGreaterThan(previous);
        }
        expect(await hitVisibleControl(page, selector), `${selector} reached through real swipes`).toBe(true);
      }
      const bottomPosition = await scrollPosition();
      await swipeControls("backward");
      expect(await scrollPosition(), "native downward swipe scrolls toward the top").toBeLessThan(bottomPosition);
      // Use the wheel for the remaining return: vertical fingerprint bars own
      // touch drags, so repeatedly starting a swipe on a bar would edit it.
      for (let step = 0; step < 40 && await scrollPosition() > 1; step += 1) {
        const previous = await scrollPosition();
        const box = await scroller.boundingBox();
        await page.mouse.move(box.x + 10, box.y + box.height / 2);
        await page.mouse.wheel(0, -Math.max(100, box.height * 0.6));
        await expect.poll(scrollPosition).toBeLessThan(previous);
        await assertGraphicPinned();
      }
      expect(await scrollPosition()).toBeLessThanOrEqual(1);
      expect(await hitVisibleControl(page, "#spectrumPreset")).toBe(true);

      const partial = page.locator("#partialSliders input").first();
      const before = Number(await partial.inputValue());
      const bar = await partial.boundingBox();
      await nativeTouchDrag(page, session,
        { x: bar.x + bar.width / 2, y: bar.y + 8 + (bar.height - 16) * (1 - before) },
        { x: bar.x + bar.width / 2, y: before < 0.5 ? bar.y + 8 : bar.y + bar.height - 8 });
      expect(Math.abs(Number(await partial.inputValue()) - before), "fingerprint slider still responds after scrolling").toBeGreaterThan(0.1);
      expect(await scrollPosition(), "editing the vertical bar does not scroll the pane").toBeLessThanOrEqual(1);
      await assertGraphicPinned();
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);

      const editedValue = await partial.inputValue();
      await page.setViewportSize({ width: layout.height, height: layout.width });
      graphicBox = await graphic.boundingBox();
      await expect(partial).toHaveValue(editedValue);
      const rotatedPane = await scroller.boundingBox();
      expect(rotatedPane.height).toBeGreaterThan(100);
      await page.mouse.move(rotatedPane.x + 10, rotatedPane.y + rotatedPane.height / 2);
      await page.mouse.wheel(0, 120);
      await expect.poll(scrollPosition).toBeGreaterThan(20);
      await assertGraphicPinned();
      await session.detach();
    });

    test(`SPARTIAL ${layout.name} keeps controls reachable and primary targets large enough`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await openSpartial(page);
      await expectKeyboardBeforeRotation(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      await testInfo.attach(`spartial-phone-${layout.name}.png`, {
        body: await page.screenshot({ fullPage: false }), contentType: "image/png",
      });

      for (const id of ["audioButton", "playButton", "holdButton", "tempo"]) {
        const control = page.locator(`#${id}`);
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box.width, `${id} touch width`).toBeGreaterThanOrEqual(48);
        expect(box.height, `${id} touch height`).toBeGreaterThanOrEqual(48);
      }
      await expectCascadeControlsReachable(page);

      // Scrolling each control into view also exercises nested panel scrolling;
      // document width alone cannot reveal a clipped interior control.
      const unreachable = await page.evaluate(async () => {
        const failures = [];
        const controls = [...document.querySelectorAll("main button, main input, main select, main summary, #stage")];
        for (const control of controls) {
          if (!control.checkVisibility({ visibilityProperty: true }) || control.closest("[hidden]")) continue;
          control.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const rect = control.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(x, y);
          if (rect.left < -2 || rect.right > innerWidth + 2 || y < 0 || y > innerHeight || !(hit === control || control.contains(hit))) {
            failures.push({ id: control.id || control.textContent.trim().slice(0, 50), x, y });
          }
        }
        return failures;
      });
      expect(unreachable, "all visible controls can be scrolled to and hit").toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);

      const tempo = page.locator("#tempo");
      await tempo.scrollIntoViewIfNeeded();
      const scroller = page.locator("#spartialControls");
      const scrollBefore = await scroller.evaluate(node => node.scrollTop);
      const graphicBefore = await page.locator("#stageWrap").boundingBox();
      const tempoBefore = Number(await tempo.inputValue());
      const knob = await tempo.boundingBox();
      const session = await page.context().newCDPSession(page);
      await nativeTouchDrag(page, session,
        { x: knob.x + knob.width / 2, y: knob.y + knob.height / 2 },
        { x: knob.x + knob.width / 2, y: knob.y + knob.height / 2 - 20 });
      await session.detach();
      const tempoAfter = Number(await tempo.inputValue());
      expect(tempoAfter, "a native touch drag turns the tempo knob").toBeGreaterThan(tempoBefore);
      await expect(page.locator("#tempoOut")).toHaveText(`${tempoAfter} BPM`);
      expect(Math.abs(await scroller.evaluate(node => node.scrollTop) - scrollBefore), "turning the knob must not scroll the pane").toBeLessThan(1);
      expect(await page.locator("#stageWrap").boundingBox()).toEqual(graphicBefore);
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "false");

      await page.locator("#playButton").tap();
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      await page.locator("#playButton").tap();
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
    });
  }
});
