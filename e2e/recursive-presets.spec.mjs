import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { collectControlInventory } from "./helpers/control-inventory.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";
import { enableFakeMidi, fakeMidiSnapshot, installFakeMidi, MIDI_BYTES, sendMidi } from "./helpers/fake-midi.mjs";

const instruments = ["recursive-am", "recursive-fm", "recursive-pm"];
const performanceKeys = ["ampAttackMs", "ampDecayMs", "ampSustainLevel", "ampReleaseMs",
  "glideMode", "glideTimeMs", "rootMidiNote", "pitchBendRangeSemitones"].sort();
const layouts = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone portrait", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 },
];

const capture = page => page.evaluate(async () => (
  await import("/src/site/header-presets.js")
).captureHeaderPresetState());
const contextCount = page => page.evaluate(() => window.__recursivePresetContexts.length);
const bankIds = page => page.locator(".header-preset-controls [data-full-preset]")
  .evaluateAll(buttons => buttons.map(button => button.dataset.presetId));

async function setControl(page, id, value, type = "input") {
  await page.locator(`#${id}`).evaluate((control, change) => {
    control.value = String(change.value);
    control.dispatchEvent(new Event(change.type, { bubbles: true }));
  }, { value, type });
}

async function selectPreset(page, id) {
  const picker = page.locator(".header-preset-picker");
  if (!await picker.evaluate(node => node.open)) await picker.locator(":scope > summary").click();
  await picker.locator(`[data-full-preset][data-preset-id="${id}"]`).click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", id);
}

async function openInstrument(page, id) {
  await page.goto(`${id}.html`);
  await settlePage(page);
  await expect(page.locator(".header-preset-controls")).toHaveCount(1);
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-instrument-id", id);
  await expect(page.locator(".header-preset-controls [data-full-preset]")).toHaveCount(12);
}

function expectCompleteSnapshot(snapshot, id) {
  expect(Object.keys(snapshot).sort()).toEqual(["activePresetId", "performance", "settings", "version"]);
  expect(snapshot.version).toBe(1);
  expect(Object.keys(snapshot.performance).sort()).toEqual(performanceKeys);
  const settingsKeys = id === "recursive-fm"
    ? ["depth", "carrierHz", "offsetHz", "modulationHz", "divisor"]
    : ["depth", "carrierHz", "startModFrequencyHz", "frequencyDivisor",
      id === "recursive-am" ? "startAmplitudeIndex" : "startPhaseIndex", "indexDivisor"];
  expect(Object.keys(snapshot.settings).sort()).toEqual(settingsKeys.sort());
}

test.beforeEach(async ({ page }) => {
  // A silent sink runs real Web Audio without depending on an attached output
  // device. Preserve the actual render thread, analyser and lifecycle paths.
  await page.addInitScript(() => {
    window.__recursivePresetContexts = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options = {}) {
        super({ ...options, sinkId: { type: "none" } });
        window.__recursivePresetContexts.push(this);
      }
    };
  });
});

for (const id of instruments) {
  test(`${id}: full recall, Next and dice restore musical state without arming Audio`, async ({ page, baseURL }) => {
    test.setTimeout(60000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await openInstrument(page, id);
    const ids = await bankIds(page);
    expect(new Set(ids).size).toBe(12);
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "unselected");
    expect(await contextCount(page)).toBe(0);
    await setControl(page, "level", 0.23);
    await selectPreset(page, ids[0]);
    const original = (await capture(page)).snapshot;
    expectCompleteSnapshot(original, id);
    await expect(page.locator("#level")).toHaveValue("0.23");

    // Mutate both synthesis and articulation before recalling another full
    // scene and then the original. A synthesis-only adapter cannot pass this.
    await setControl(page, "depth", original.settings.depth === 7 ? 6 : 7);
    await setControl(page, "ampAttackMs", original.performance.ampAttackMs === 317 ? 318 : 317);
    await setControl(page, "ampDecayMs", 641);
    await setControl(page, "ampSustainLevel", 0.43);
    await setControl(page, "ampReleaseMs", 953);
    await setControl(page, "glideTimeMs", 271);
    await setControl(page, "glideMode", "always", "change");
    await setControl(page, "rootMidiNote", 57);
    await setControl(page, "pitchBendRangeSemitones", 7);
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
    expect((await capture(page)).snapshot).not.toEqual(original);
    await page.locator(".header-preset-next").click();
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", ids[1]);
    await setControl(page, "level", 0);
    await selectPreset(page, ids[0]);
    expect((await capture(page)).snapshot).toEqual(original);
    await expect(page.locator("#level")).toHaveValue("0");

    // Tour every bank entry and wrap while muted. Zero must survive recall,
    // including adapters that might otherwise treat it as a missing value.
    for (let index = 1; index <= ids.length; index += 1) {
      await page.locator(".header-preset-next").click();
      const expected = ids[index % ids.length];
      await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", expected);
      const state = await capture(page);
      expect(state.selectedId).toBe(expected);
      expectCompleteSnapshot(state.snapshot, id);
      await expect(page.locator("#level")).toHaveValue("0");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    }
    const randomized = new Set();
    for (let index = 0; index < 3; index += 1) {
      await page.locator(".header-preset-random").click();
      await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
      const state = await capture(page);
      expect(state.selectedId).toBeNull();
      expectCompleteSnapshot(state.snapshot, id);
      randomized.add(JSON.stringify(state.snapshot));
      await expect(page.locator("#level")).toHaveValue("0");
    }
    expect(randomized.size).toBe(3);
    expect(await contextCount(page)).toBe(0);
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  test(`${id}: live recall and randomization preserve Audio, output and graph ownership`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await openInstrument(page, id);
    const ids = await bankIds(page);
    await setControl(page, "level", 0.23);
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBeGreaterThan(0);
    const connections = (await readAudioStatus(page)).connectionCount;
    const contexts = await contextCount(page);
    const assertContinuous = async level => {
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#level")).toHaveValue(level);
      expect((await readAudioStatus(page)).connectionCount).toBe(connections);
      expect(await contextCount(page)).toBe(contexts);
    };
    await selectPreset(page, ids[1]);
    await assertContinuous("0.23");
    const signal = await sampleAudioEnvelope(page, { durationMs: 450 });
    expect(signal.summary.finite).toBe(true);
    expect(signal.summary.maxPeak).toBeGreaterThan(0.0001);
    expect(signal.summary.clippedSamples).toBe(0);
    await setControl(page, "level", 0);
    await selectPreset(page, ids.at(-1));
    await assertContinuous("0");
    await page.locator(".header-preset-next").click();
    await assertContinuous("0");
    await page.locator(".header-preset-random").click();
    await assertContinuous("0");
    await setControl(page, "level", 0.23);
    await selectPreset(page, ids[1]);
    await assertContinuous("0.23");
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  test(`${id}: native CC edits show Custom while recalls preserve held MIDI ownership`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await installFakeMidi(page);
    await openInstrument(page, id);
    const ids = await bankIds(page);
    await selectPreset(page, ids[0]);
    await enableFakeMidi(page);
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", ids[0]);
    await page.locator(".header-settings-menu").evaluate(node => { node.open = false; });
    if (await page.locator("#audioButton").getAttribute("aria-pressed") !== "true") {
      await page.locator("#audioButton").click();
    }
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBeGreaterThan(0);
    await selectPreset(page, ids[0]);
    await setControl(page, "level", 0.23);
    const connections = (await readAudioStatus(page)).connectionCount;
    const contexts = await contextCount(page);
    await sendMidi(page, MIDI_BYTES.noteOn(60, 96));
    await sendMidi(page, MIDI_BYTES.noteOn(67, 81));
    await sendMidi(page, MIDI_BYTES.controlChange(11, 81));
    await sendMidi(page, MIDI_BYTES.controlChange(64, 127));
    await sendMidi(page, MIDI_BYTES.pitchBend(12288));
    await expect(page.locator("#currentNote")).toHaveText("G4 · 67");
    await expect(page.locator("#sustainState")).toHaveText("held");
    await expect(page.locator("#expressionValue")).toHaveText("64%");
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", ids[0]);
    await sendMidi(page, MIDI_BYTES.controlChange(73, 127));
    const attackMaximum = await page.locator("#ampAttackMs").getAttribute("max");
    await expect(page.locator("#ampAttackMs")).toHaveValue(attackMaximum);
    // Read the UI before the diagnostic capture helper, which itself refreshes
    // selection and could otherwise conceal a missing native-MIDI refresh.
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
    expect((await capture(page)).snapshot.performance.ampAttackMs).toBe(5000);
    for (const action of [() => selectPreset(page, ids[1]), () => selectPreset(page, ids[0]),
      () => page.locator(".header-preset-random").click()]) {
      await action();
      await expect(page.locator("#currentNote")).toHaveText("G4 · 67");
      await expect(page.locator("#sustainState")).toHaveText("held");
      await expect(page.locator("#expressionValue")).toHaveText("64%");
      const bendRange = (await capture(page)).snapshot.performance.pitchBendRangeSemitones;
      expect(Number.parseFloat(await page.locator("#bendState").textContent()))
        .toBeCloseTo((4096 / 8191) * bendRange, 1);
      await expect(page.locator("#sharedMidiToggle")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#level")).toHaveValue("0.23");
      expect((await readAudioStatus(page)).connectionCount).toBe(connections);
      expect(await contextCount(page)).toBe(contexts);
    }
    // Releasing the last key must reveal the original held key. This checks
    // actual note-stack ownership beyond a stale selected-note readout.
    await sendMidi(page, MIDI_BYTES.noteOff(67));
    await expect(page.locator("#currentNote")).toHaveText("C4 · 60");
    await sendMidi(page, MIDI_BYTES.noteOff(60));
    await expect(page.locator("#currentNote")).toHaveText("C4 · 60");
    await sendMidi(page, MIDI_BYTES.controlChange(64, 0));
    await expect(page.locator("#currentNote")).toHaveText("—");
    const midi = await fakeMidiSnapshot(page);
    expect(midi.requests).toHaveLength(1);
    expect(midi.inputs).toEqual([expect.objectContaining({ listenerCount: 1 })]);
    await selectPreset(page, ids[0]);
    await page.locator(".header-settings-menu > summary").click();
    await page.locator("#sharedMidiToggle").click();
    await expect(page.locator("#sharedMidiToggle")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", ids[0]);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  for (const layout of layouts) {
    test(`${id}: preset menu, Next and dice are reachable on ${layout.name}`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await openInstrument(page, id);
      await expect(page.locator("aside.panel > .header-preset-controls")).toHaveCount(1);
      await expect(page.locator("#presetButtons [data-preset]")).toHaveCount(0);
      const row = page.locator(".header-preset-controls");
      await row.scrollIntoViewIfNeeded();
      const controls = [row.locator(".header-preset-picker > summary"),
        row.locator(".header-preset-next"), row.locator(".header-preset-random")];
      const bounds = [];
      for (const control of controls) {
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(-2);
        expect(box.x + box.width).toBeLessThanOrEqual(layout.width + 2);
        bounds.push(box);
      }
      expect(bounds[1].x).toBeGreaterThanOrEqual(bounds[0].x + bounds[0].width - 2);
      expect(bounds[2].x).toBeGreaterThanOrEqual(bounds[1].x + bounds[1].width - 2);
      expect(Math.abs(bounds[1].y - bounds[2].y)).toBeLessThanOrEqual(2);
      const ids = await bankIds(page);
      await selectPreset(page, ids.at(-1));
      await page.locator(".header-preset-next").click();
      await expect(row).toHaveAttribute("data-preset-id", ids[0]);
      await page.locator(".header-preset-random").click();
      await expect(row).toHaveAttribute("data-preset-id", "custom");
      const inventory = await collectControlInventory(page);
      expect(inventory.duplicateIds).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth
        - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      expect(await contextCount(page)).toBe(0);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  }
}
