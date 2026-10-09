import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";
import { enableFakeMidi, fakeMidiSnapshot, installFakeMidi, MIDI_BYTES, sendMidi } from "./helpers/fake-midi.mjs";

const capture = page => page.evaluate(async () => (
  await import("/src/site/header-presets.js")
).captureHeaderPresetState());
const contextCount = page => page.evaluate(() => window.__chaoticControlContexts.length);
const presetRow = page => page.locator(".header-preset-controls");

async function setControl(page, id, value, type = "input") {
  await page.locator(`#${id}`).evaluate((input, change) => {
    input.value = String(change.value);
    input.dispatchEvent(new Event(change.type, { bubbles: true }));
  }, { value, type });
}

async function setPosition(page, id, position) {
  await page.locator(`#${id}`).evaluate((input, fraction) => {
    input.value = String(Number(input.min) + fraction * (Number(input.max) - Number(input.min)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, position);
}

async function selectPreset(page, id) {
  const picker = page.locator(".header-preset-picker");
  if (!await picker.evaluate(node => node.open)) await picker.locator(":scope > summary").click();
  await picker.locator(`[data-full-preset][data-preset-id="${id}"]`).click();
  await expect(presetRow(page)).toHaveAttribute("data-preset-id", id);
}

async function openInstrument(page) {
  await page.goto("chaotic-am.html");
  await settlePage(page);
  await expect(presetRow(page)).toHaveAttribute("data-instrument-id", "chaotic-am");
  const ids = await page.locator(".header-preset-controls [data-full-preset]")
    .evaluateAll(buttons => buttons.map(button => button.dataset.presetId));
  expect(ids).toHaveLength(12);
  expect(new Set(ids).size).toBe(12);
  return ids;
}

async function armAudio(page) {
  if (await page.locator("#audioButton").getAttribute("aria-pressed") !== "true") {
    await page.locator("#audioButton").click();
  }
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBeGreaterThan(0);
  return {
    connections: (await readAudioStatus(page)).connectionCount,
    contexts: await contextCount(page),
  };
}

async function expectSameGraph(page, graph, level) {
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#output")).toHaveValue(String(level));
  expect((await readAudioStatus(page)).connectionCount).toBe(graph.connections);
  expect(await contextCount(page)).toBe(graph.contexts);
  expect(await page.evaluate(() => window.__chaoticControlContexts.every(context => context.state === "running")))
    .toBe(true);
}

async function measureAudible(page, label) {
  // Measure after the live parameter/depth ramps. A window maximum permits
  // intentional tremolo troughs; this catches sustained loss of the carrier.
  await page.waitForTimeout(250);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 550 });
  expect(envelope.summary.finite, label).toBe(true);
  expect(envelope.summary.maxRms, `${label}: audible output after settling`).toBeGreaterThan(0.002);
  expect(envelope.summary.clippedSamples, label).toBe(0);
  return { label, summary: envelope.summary, state: (await capture(page)).snapshot };
}

test.beforeEach(async ({ page }) => {
  // Exercise real worklet rendering and analyser measurements independently of
  // the machine's physical output device and its potentially stalled clock.
  await page.addInitScript(() => {
    window.__chaoticControlContexts = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options = {}) {
        super({ ...options, sinkId: { type: "none" } });
        window.__chaoticControlContexts.push(this);
      }
    };
  });
});

test("chaotic-am: depth and synthesis slider ranges retain the audible carrier", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  const ids = await openInstrument(page);
  // The shared picker starts at Select Preset even when the instrument has
  // a named startup scene. Read its state rather than the menu's placeholder.
  const defaultId = (await capture(page)).snapshot.activePresetId;
  expect(ids).toContain(defaultId);
  await setControl(page, "output", 0.31);
  const graph = await armAudio(page);
  const measurements = [await measureAudible(page, "default")];
  for (let depth = 0; depth <= 10; depth += 1) {
    await setControl(page, "depth", depth);
    measurements.push(await measureAudible(page, `depth ${depth}`));
    await expectSameGraph(page, graph, 0.31);
  }
  for (const id of ["carrier", "modFrequency", "frequencyDivisor", "amplitudeIndex", "indexDivisor", "amplitudeWarp"]) {
    for (const position of [0, 0.5, 1]) {
      await selectPreset(page, defaultId);
      // Exercise the divisors with actual recursive stages, where they matter.
      await setControl(page, "depth", 5);
      await expect(page.locator(`#${id}`)).toBeEnabled();
      await setPosition(page, id, position);
      measurements.push(await measureAudible(page, `${id} position ${position}`));
      await expectSameGraph(page, graph, 0.31);
    }
  }
  for (const mode of ["smooth", "saturated"]) {
    await setControl(page, "transferMode", mode, "change");
    measurements.push(await measureAudible(page, `${mode} transfer`));
    await expectSameGraph(page, graph, 0.31);
  }
  await selectPreset(page, defaultId);
  measurements.push(await measureAudible(page, "default recalled after sweep"));
  await expectSameGraph(page, graph, 0.31);
  await testInfo.attach("chaotic-am-control-output.json", {
    body: JSON.stringify(measurements), contentType: "application/json",
  });
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("chaotic-am: all twelve presets and Next remain audible on the same live graph", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(45_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  const ids = await openInstrument(page);
  await setControl(page, "output", 0.31);
  const graph = await armAudio(page);
  const measurements = [];
  await selectPreset(page, ids[0]);
  for (const id of ids) {
    await expect(presetRow(page)).toHaveAttribute("data-preset-id", id);
    measurements.push(await measureAudible(page, id));
    await expectSameGraph(page, graph, 0.31);
    await page.locator(".header-preset-next").click();
  }
  await expect(presetRow(page)).toHaveAttribute("data-preset-id", ids[0]);
  await expectSameGraph(page, graph, 0.31);
  await testInfo.attach("chaotic-am-preset-output.json", {
    body: JSON.stringify(measurements), contentType: "application/json",
  });
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("chaotic-am: presets and dice preserve Audio off and zero output, with full-state recovery", async ({ page, baseURL }) => {
  test.setTimeout(30_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  const ids = await openInstrument(page);
  await selectPreset(page, ids[0]);
  const original = (await capture(page)).snapshot;
  expect(original.version).toBe(1);
  expect(Object.keys(original).sort()).toEqual(["activePresetId", "performance", "settings", "version"]);
  expect(original.performance).not.toHaveProperty("playMode");
  await setControl(page, "ampAttackMs", 1);
  await setControl(page, "depth", 9);
  await expect(presetRow(page)).toHaveAttribute("data-preset-id", "custom");
  await selectPreset(page, ids[1]);
  await selectPreset(page, ids[0]);
  expect((await capture(page)).snapshot).toEqual(original);
  await page.locator(".header-preset-random").click();
  await expect(presetRow(page)).toHaveAttribute("data-preset-id", "custom");
  expect((await capture(page)).snapshot).not.toEqual(original);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(await contextCount(page)).toBe(0);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await setControl(page, "output", 0);
  const graph = await armAudio(page);
  for (const action of [() => selectPreset(page, ids.at(-1)),
    () => page.locator(".header-preset-next").click(),
    () => page.locator(".header-preset-random").click()]) {
    await action();
    await expectSameGraph(page, graph, 0);
    await page.waitForTimeout(300);
    const silent = await sampleAudioEnvelope(page, { durationMs: 250 });
    expect(silent.summary.finite).toBe(true);
    expect(silent.summary.maxPeak).toBeLessThan(0.0001);
  }
  await setControl(page, "output", 0.31);
  await selectPreset(page, ids[0]);
  await measureAudible(page, "recover from muted random scene");
  await expectSameGraph(page, graph, 0.31);
  expect((await capture(page)).snapshot).toEqual(original);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("chaotic-am: native MIDI held notes and controllers survive recall and dice", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await installFakeMidi(page);
  const ids = await openInstrument(page);
  await selectPreset(page, ids[0]);
  await enableFakeMidi(page);
  await expect(presetRow(page)).toHaveAttribute("data-preset-id", ids[0]);
  await page.locator(".header-settings-menu").evaluate(node => { node.open = false; });
  await setControl(page, "output", 0.31);
  const graph = await armAudio(page);
  await sendMidi(page, MIDI_BYTES.noteOn(60, 96));
  await sendMidi(page, MIDI_BYTES.noteOn(67, 81));
  await sendMidi(page, MIDI_BYTES.controlChange(11, 81));
  await sendMidi(page, MIDI_BYTES.controlChange(64, 127));
  await sendMidi(page, MIDI_BYTES.pitchBend(12288));
  await expect(page.locator("#currentNote")).toHaveText("G4 · 67");
  await sendMidi(page, MIDI_BYTES.controlChange(73, 127));
  // Check the UI before capture(), whose refresh could conceal a missed CC edit.
  await expect(presetRow(page)).toHaveAttribute("data-preset-id", "custom");
  expect((await capture(page)).snapshot.performance.ampAttackMs).toBe(5000);
  for (const action of [() => selectPreset(page, ids[1]), () => selectPreset(page, ids[0]),
    () => page.locator(".header-preset-random").click()]) {
    await action();
    await expect(page.locator("#currentNote")).toHaveText("G4 · 67");
    await expect(page.locator("#sustainState")).toHaveText("held");
    await expect(page.locator("#expressionValue")).toHaveText("64%");
    const range = (await capture(page)).snapshot.performance.pitchBendRangeSemitones;
    expect(Number.parseFloat(await page.locator("#bendState").textContent()))
      .toBeCloseTo((4096 / 8191) * range, 1);
    await expect(page.locator("#sharedMidiToggle")).toHaveAttribute("aria-pressed", "true");
    await expectSameGraph(page, graph, 0.31);
  }
  // The earlier held key must remain in the real note stack after the last key
  // releases. A retained label alone would not establish preserved ownership.
  await sendMidi(page, MIDI_BYTES.noteOff(67));
  await expect(page.locator("#currentNote")).toHaveText("C4 · 60");
  await sendMidi(page, MIDI_BYTES.noteOff(60));
  await expect(page.locator("#currentNote")).toHaveText("C4 · 60");
  await sendMidi(page, MIDI_BYTES.controlChange(64, 0));
  await expect(page.locator("#currentNote")).toHaveText("—");
  const midi = await fakeMidiSnapshot(page);
  expect(midi.requests).toHaveLength(1);
  expect(midi.inputs).toEqual([expect.objectContaining({ listenerCount: 1 })]);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});
