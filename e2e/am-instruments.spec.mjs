import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages, settlePage } from "./helpers/diagnostics.mjs";
import { installFakeMidi, enableFakeMidi, sendMidi, MIDI_BYTES } from "./helpers/fake-midi.mjs";

test.beforeEach(async ({ page }) => {
  // Keep the real audio thread and clock running independently of a physical
  // output device. The analyser still measures the instrument's actual output.
  await page.addInitScript(() => {
    const AudioContextConstructor = window.AudioContext;
    window.AudioContext = class extends AudioContextConstructor {
      constructor(options = {}) { super({ ...options, sinkId: { type: "none" } }); }
    };
  });
});

async function choosePreset(page, id, index) {
  if (id === "cascading-am") await page.locator(".header-preset-next").click();
  else await page.locator("#presetButtons [data-preset]").nth(index).click();
}

for (const id of ["cascading-am", "recursive-am", "chaotic-am"]) {
  test(`${id}: presets preserve live audio, master level and cleanup`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(60000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${id}.html`);
    await settlePage(page);
    if (id === "cascading-am") {
      await expect(page.locator("#cascadeRatioOut")).toHaveText("×150");
    }
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    // Preset recall while disarmed must never create an audible graph.
    await choosePreset(page, id, 0);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    const levelSelector = id === "chaotic-am" ? "#output" : "#level";
    await page.locator(levelSelector).evaluate(input => {
      input.value = "0.23";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const level = await page.locator(levelSelector).inputValue();
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBeGreaterThan(0);
    const connections = (await readAudioStatus(page)).connectionCount;
    const samples = [];
    for (let index = 0; index < (id === "cascading-am" ? 12 : 3); index += 1) {
      const envelope = await sampleAudioEnvelope(page, { durationMs: 1100 });
      expect(envelope.summary.finite).toBe(true);
      expect(envelope.summary.maxPeak).toBeGreaterThan(0.0001);
      expect(envelope.summary.clippedSamples).toBe(0);
      samples.push(envelope);
      await choosePreset(page, id, index + 1);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      expect((await readAudioStatus(page)).connectionCount).toBe(connections);
      await expect(page.locator(levelSelector)).toHaveValue(level);
    }
    await testInfo.attach("am-live-output.json", { body: JSON.stringify(samples), contentType: "application/json" });
    await page.locator("#audioButton").click();
    await waitForStableAudioState(page, false);
    await page.evaluate(() => dispatchEvent(new Event("pagehide")));
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}

for (const id of ["recursive-am", "chaotic-am"]) {
  test(`${id}: native MIDI and computer keys retain note, release and CC control`, async ({ page }) => {
    await installFakeMidi(page);
    await page.goto(`${id}.html`);
    const snapshot = await enableFakeMidi(page);
    expect(snapshot.inputs).toEqual([expect.objectContaining({ listenerCount: 1 })]);
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await sendMidi(page, MIDI_BYTES.noteOn(60, 96));
    await expect(page.locator("#midiActivity")).toContainText("C4 · velocity 96");
    await sendMidi(page, MIDI_BYTES.noteOff(60));
    await expect(page.locator("#midiActivity")).toContainText("C4 released");
    const release = await page.locator("#ampReleaseMs").inputValue();
    await sendMidi(page, MIDI_BYTES.controlChange(72, 127));
    await expect(page.locator("#ampReleaseMs")).not.toHaveValue(release);
    await page.locator("#stage").focus();
    await page.keyboard.down("q");
    await expect(page.locator("#midiActivity")).toContainText("C4 · velocity");
    await page.keyboard.up("q");
    await expect(page.locator("#midiActivity")).toContainText("C4 released");
  });
}

for (const id of ["cascading-am", "recursive-am", "chaotic-am"]) {
  test(`${id}: generated WAX page stays disarmed in an ordinary browser`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`dist-wax/${id}.html`);
    await settlePage(page);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#sharedMidiToggle")).toHaveAttribute("aria-pressed", "false");
    const moduleUrl = new URL("dist-wax/src/audio-output-manager.js", baseURL).href;
    expect((await readAudioStatus(page, { moduleUrl })).connectionCount).toBe(0);
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    const output = await sampleAudioEnvelope(page, { moduleUrl, durationMs: 700 });
    expect(output.summary.maxPeak).toBeGreaterThan(0.0001);
    expect(output.summary.clippedSamples).toBe(0);
    await page.evaluate(() => dispatchEvent(new Event("pagehide")));
    await expect.poll(async () => (await readAudioStatus(page, { moduleUrl })).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}
