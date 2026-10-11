import { expect, test } from "@playwright/test";
import { sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { enableFakeMidi, installFakeMidi, sendMidi } from "./helpers/fake-midi.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const diagnostics = new WeakMap();
test.beforeEach(async ({ page, baseURL }) => {
  diagnostics.set(page, watchPageDiagnostics(page, { baseURL }));
  await page.addInitScript(({ silent }) => {
    if (silent) {
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        constructor(options = {}) { super({ ...options, sinkId: { type: "none" } }); }
      };
    }
    // Observe the real UI -> worklet boundary; keep production DSP running.
    window.spartialNoteMessages = [];
    const NativeNode = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeNode {
      constructor(context, name, options) {
        super(context, name, options);
        if (name !== "spartial-synth") return;
        const send = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, ...rest) => {
          if (["noteOn", "noteOff", "panic"].includes(message.type)) window.spartialNoteMessages.push(structuredClone(message));
          return send(message, ...rest);
        };
      }
    };
  }, { silent: process.env.E2E_AUDIO_SILENT_SINK === "1" });
});
test.afterEach(async ({ page }) => {
  expect(pageDiagnosticMessages(diagnostics.get(page))).toEqual([]);
});
async function open(page) {
  expect((await page.goto("spartial.html"))?.ok()).toBe(true);
  await settlePage(page);
  await expect(page.locator("#chord option").first()).toBeAttached();
}
async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
function noteNames(notes) { return notes.map(note => `${names[note % 12]}${Math.floor(note / 12) - 1}`).join(" · "); }
async function clearMessages(page) { await page.evaluate(() => { window.spartialNoteMessages = []; }); }
async function played(page, prefix = "latch:") {
  return page.evaluate(prefix => window.spartialNoteMessages.filter(item => item.type === "noteOn" && item.id.startsWith(prefix)).map(item => item.note), prefix);
}

test("chord menu, Next and dice work with Audio off and retain generated shapes", async ({ page }) => {
  await open(page);
  for (const id of ["chord", "nextChord", "randomChord"]) await expect(page.locator(`#${id}`)).toBeDisabled();
  await page.locator("#mode").selectOption("chord");
  for (const [id, notes] of Object.entries({ augmented: [48, 52, 56], diminished7: [48, 51, 54, 57], halfDiminished: [48, 51, 54, 58], wholeTone: [48, 50, 52, 54, 56, 58], chromatic4: [48, 49, 50, 51] })) {
    await page.locator("#chord").selectOption(id);
    await expect(page.locator("#chordNotes")).toHaveText(noteNames(notes));
  }
  for (const size of [3, 4]) {
    await page.locator("#chord").selectOption(`random${size}`);
    for (let roll = 0; roll < 6; roll += 1) {
      const before = await page.locator("#chordNotes").textContent();
      await page.locator("#randomChord").click();
      const after = await page.locator("#chordNotes").textContent();
      expect(after).not.toBe(before);
      const notes = after.split(" · ");
      expect(notes).toHaveLength(size);
      expect(new Set(notes).size).toBe(size);
      expect(notes[0]).toBe("C3");
      expect(notes.every(note => note.endsWith("3"))).toBe(true);
      await setRange(page, "grainSize", 71 + roll);
      await expect(page.locator("#chordNotes")).toHaveText(after);
      await expect(page.locator("#chord")).toHaveValue(`random${size}`);
    }
  }
  const shape = await page.locator("#chordNotes").textContent();
  await page.locator("#root").selectOption("60");
  await expect(page.locator("#chordNotes")).toHaveText(shape.replaceAll("3", "4"));
  await page.locator("#nextChord").click();
  await expect(page.locator("#chord")).toHaveValue("minor");
  await page.locator("#randomChord").click();
  expect(["random3", "random4"]).toContain(await page.locator("#chord").inputValue());
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
});

test("held chord changes reach the real worklet, preserve controls and release cleanly", async ({ page }, testInfo) => {
  await open(page);
  await page.locator("#mode").selectOption("chord");
  for (const [id, value] of Object.entries({ level: .37, cascade: 0, attack: .01, release: .05 })) await setRange(page, id, value);
  await page.locator("#audioButton").click();
  await page.locator("#playButton").click();
  await page.locator("#holdButton").click();
  for (const [id, intervals] of Object.entries({ wholeTone: [0, 2, 4, 6, 8, 10], augmented: [0, 4, 8], halfDiminished: [0, 3, 6, 10], chromatic4: [0, 1, 2, 3] })) {
    await clearMessages(page);
    await page.locator("#chord").selectOption(id);
    expect(await played(page)).toEqual(intervals.map(note => 48 + note));
    await waitForStableAudioState(page, true, { stableMs: 150 });
  }
  await page.locator("#chord").selectOption("random4");
  await clearMessages(page);
  await page.locator("#randomChord").click();
  const notes = await played(page);
  expect(notes).toHaveLength(4);
  await expect(page.locator("#chordNotes")).toHaveText(noteNames(notes));
  await expect(page.locator("#level")).toHaveValue("0.37");
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  const envelope = await sampleAudioEnvelope(page, { durationMs: 500, intervalMs: 40 });
  await testInfo.attach("chord-output.json", { body: JSON.stringify(envelope), contentType: "application/json" });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxRms).toBeGreaterThan(.001);
  expect(envelope.summary.clippedSamples).toBe(0);
  await page.locator("#holdButton").click();
  await waitForStableAudioState(page, false);
  await clearMessages(page);
  await page.locator("#holdButton").click();
  expect(await played(page)).toEqual(notes);
  await page.locator("#panicButton").click();
  await waitForStableAudioState(page, false);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
});

test("changing chords preserves held keyboard and exact MIDI notes until their own release", async ({ page }) => {
  await installFakeMidi(page);
  await open(page);
  await enableFakeMidi(page);
  await page.locator("#mode").selectOption("chord");
  for (const [id, value] of Object.entries({ cascade: 0, release: .05 })) await setRange(page, id, value);
  if (await page.locator("#audioButton").getAttribute("aria-pressed") !== "true") await page.locator("#audioButton").click();
  await page.locator("#stage").focus();
  await page.keyboard.down("a");
  expect(await played(page, "key:")).toEqual([48, 51, 55]);
  await sendMidi(page, [0x90, 67, 100]);
  expect(await played(page, "midi:")).toEqual([67]);
  await clearMessages(page);
  await page.locator("#chord").selectOption("wholeTone");
  await page.locator("#nextChord").click();
  await page.locator("#randomChord").click();
  expect(await page.evaluate(() => window.spartialNoteMessages)).toEqual([]);
  await waitForStableAudioState(page, true);
  await page.keyboard.up("a");
  expect(await page.evaluate(() => window.spartialNoteMessages.filter(item => item.type === "noteOff" && item.id.startsWith("key:")).map(item => item.id))).toEqual(["key:0:0", "key:0:1", "key:0:2"]);
  await waitForStableAudioState(page, true);
  await sendMidi(page, [0x80, 67, 0]);
  await waitForStableAudioState(page, false);
});
