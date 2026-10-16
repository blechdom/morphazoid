import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { installFakeMidi, enableFakeMidi, sendMidi, MIDI_BYTES } from "./helpers/fake-midi.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

// Authored test tone: no external samples or hardware are needed for these checks.
function toneWav(name = "esi-test-tone.wav", frequency = 2000) {
  const sampleRate = 48000, frames = sampleRate;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    buffer.writeInt16LE(Math.round(14000 * Math.sin(2 * Math.PI * frequency * frame / sampleRate)), 44 + frame * 2);
  }
  return { name, mimeType: "audio/wav", buffer };
}

async function openSampler(page) {
  await page.goto("esi-32.html");
  await expect(page.locator("#sampleSlots button")).toHaveCount(8);
  await expect(page.locator("#keyboard .esi-key")).toHaveCount(24);
  await page.waitForFunction(() => Boolean(window.__esi32?.audio));
}

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function arm(page) {
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sampleFile")).toBeEnabled();
}

const heldNotes = page => page.evaluate(() => window.__esi32.getState().held.map(([, note]) => note).sort((a, b) => a - b));

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width < 900 });
    test("ESI-32 controls, full keyboard and presets remain reachable", async ({ page, baseURL }) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await openSampler(page);
      await expect(page.locator("h1")).toHaveText("ESI-32");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      expect(await page.locator(".esi-panel").evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      expect(await page.locator("[data-instrument-preset-host]").evaluate(node => {
        const first = node.firstElementChild;
        return first.matches('.instrument-preset-controls') ||
          (first.matches('.mz-input-preset-row') && Boolean(first.querySelector('.instrument-preset-controls')) && Boolean(first.querySelector('.mz-audio-input-strip')));
      })).toBe(true);
      for (const selector of ["#audioButton", "#audition", "#panic", "#sampleSlots button:last-child", "#keyboard .esi-key-row:last-child .esi-key:last-child", "#resetPatch", ".header-preset-picker > summary"]) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        await control.click({ trial: true });
        const box = await control.boundingBox();
        expect(box.x, selector).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width, selector).toBeLessThanOrEqual(viewport.width + 1);
      }
      if (viewport.width < 900) for (const selector of ["#audioButton", "#audition"]) {
        const box = await page.locator(selector).boundingBox();
        expect(box.width, selector).toBeGreaterThanOrEqual(48);
        expect(box.height, selector).toBeGreaterThanOrEqual(48);
      }
      await page.locator(".header-preset-picker > summary").click();
      const popup = await page.locator("#header-preset-panel").boundingBox();
      expect(popup.x).toBeGreaterThanOrEqual(-1);
      expect(popup.x + popup.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(popup.y + popup.height).toBeLessThanOrEqual(viewport.height + 1);
      await page.keyboard.press("Escape");
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  });
}

test("ESI-32 audition and physical keys cannot implicitly arm Audio", async ({ page }) => {
  await openSampler(page);
  await expect(page.locator("#sampleFile")).toBeDisabled();
  await expect(page.locator("#bankFile")).toBeDisabled();
  await page.locator("#audition").click();
  await page.locator("h1").click();
  await page.keyboard.press("KeyZ");
  await page.locator('#keyboard .esi-key[data-note="60"]').click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect((await readAudioStatus(page)).active).toBe(false);
  expect(await page.evaluate(() => window.__esi32.audio.context)).toBeNull();
});

test("ESI-32 physical labels map both octaves and release independently, on blur and panic", async ({ page }) => {
  await openSampler(page); await arm(page);
  await page.locator("h1").click();
  const keys = ["KeyZ", "KeyS", "KeyX", "KeyD", "KeyC", "KeyV", "KeyG", "KeyB", "KeyH", "KeyN", "KeyJ", "KeyM", "KeyQ", "Digit2", "KeyW", "Digit3", "KeyE", "KeyR", "Digit5", "KeyT", "Digit6", "KeyY", "Digit7", "KeyU"];
  for (const [index, code] of keys.entries()) {
    const key = page.locator(`#keyboard .esi-key[data-note="${48 + index}"]`);
    await expect(key).toContainText(code.replace(/^(Key|Digit)/, ""));
    await page.keyboard.down(code);
    await expect.poll(() => heldNotes(page)).toEqual([48 + index]);
    await expect(key).toHaveClass(/is-held/);
    await page.keyboard.up(code);
    await expect.poll(() => heldNotes(page)).toEqual([]);
  }
  await page.keyboard.down("KeyZ"); await page.keyboard.down("KeyQ");
  await expect.poll(() => heldNotes(page)).toEqual([48, 60]);
  await page.keyboard.up("KeyZ");
  await expect.poll(() => heldNotes(page)).toEqual([60]);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect.poll(() => heldNotes(page)).toEqual([]);
  await page.keyboard.up("KeyQ");
  await page.keyboard.down("KeyX");
  await page.locator("#panic").click();
  await expect.poll(() => heldNotes(page)).toEqual([]);
  await page.keyboard.up("KeyX");
  await expect(page.locator("#keyboard .is-held")).toHaveCount(0);
  await waitForStableAudioState(page, false);
  // Focused native fields keep their typing/navigation semantics.
  await page.locator("#cutoff").focus();
  await page.keyboard.press("KeyZ");
  await expect.poll(() => heldNotes(page)).toEqual([]);
});

test("ESI-32 imported audio is bounded, responds to the filter and releases to silence", async ({ page }, testInfo) => {
  await openSampler(page); await arm(page);
  await page.locator("#sampleFile").setInputFiles(toneWav());
  await expect(page.locator("#lcdSample")).toContainText("esi-test-tone");
  await page.locator("#loopEnabled").check();
  await setRange(page, "attack", 0.005); await setRange(page, "sustain", 1);
  await setRange(page, "release", 0.04); await setRange(page, "resonance", 0);
  await setRange(page, "cutoff", 16000);
  await page.locator("#audition").click();
  await expect(page.locator("#audition")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.005);
  const bright = await sampleAudioEnvelope(page, { durationMs: 500 });
  await setRange(page, "cutoff", 100);
  // Allow smoothing and meter history to settle before comparing sustained output.
  await page.waitForTimeout(350);
  const dark = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(bright.summary.finite && dark.summary.finite).toBe(true);
  expect(bright.summary.clippedSamples + dark.summary.clippedSamples).toBe(0);
  expect(bright.summary.meanRms).toBeGreaterThan(0.002);
  expect(dark.summary.meanRms).toBeLessThan(bright.summary.meanRms * 0.3);
  await testInfo.attach("esi-32-filter-envelope.json", { body: JSON.stringify({ bright, dark }), contentType: "application/json" });
  await page.locator("#audition").click();
  await waitForStableAudioState(page, false);
  await expect.poll(() => page.evaluate(() => window.__esi32.audio.voices.size)).toBe(0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => window.__esi32.audio.context?.state)).toBe("suspended");
  await waitForStableAudioState(page, false);
});

test("ESI-32 imports and recalls user samples while malformed files preserve the bank", async ({ page }) => {
  await openSampler(page); await arm(page);
  await page.locator("#sampleFile").setInputFiles(toneWav("retained-sample.wav", 440));
  await expect(page.locator("#lcdSample")).toContainText("retained-sample");
  await page.locator("#reverse").check();
  const original = await page.evaluate(() => window.__esi32.getState());
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveBank").click();
  const saved = await downloadPromise;
  const bankPath = await saved.path();
  expect(bankPath).toBeTruthy();
  await page.locator("#sampleFile").setInputFiles(toneWav("replacement.wav", 880));
  await expect(page.locator("#lcdSample")).toContainText("replacement");
  await page.locator("#bankFile").setInputFiles(bankPath);
  await expect(page.locator("#lcdSample")).toContainText("retained-sample");
  expect(await page.evaluate(() => window.__esi32.getState().names)).toEqual(original.names);
  expect(await page.evaluate(() => window.__esi32.getState().patches)).toEqual(original.patches);
  await page.locator("#sampleFile").setInputFiles({ name: "broken.wav", mimeType: "audio/wav", buffer: Buffer.from("not a wave file") });
  await expect(page.locator("#audioError")).toBeVisible();
  await expect(page.locator("#lcdSample")).toContainText("retained-sample");
  await page.locator("#bankFile").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from('{"format":"unknown","samples":[]}') });
  await expect(page.locator("#audioError")).toBeVisible();
  expect(await page.evaluate(() => window.__esi32.getState().names)).toEqual(original.names);
  expect(await page.evaluate(() => window.__esi32.getState().patches)).toEqual(original.patches);
});

test("ESI-32 presets and dice preserve master level and the running audition", async ({ page }) => {
  await openSampler(page); await arm(page);
  await setRange(page, "output", 0.37);
  await page.locator("#loopEnabled").check();
  await page.locator("#audition").click();
  await page.locator(".header-preset-next").click();
  await expect(page.locator("#audition")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#output")).toHaveValue("0.37");
  await page.locator(".header-preset-random").click();
  await expect(page.locator("#audition")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#output")).toHaveValue("0.37");
  await page.locator("#panic").click();
  await waitForStableAudioState(page, false);
});

test("ESI-32 MIDI notes retain source and channel ownership and MIDI Off releases them", async ({ page }) => {
  await installFakeMidi(page, { inputs: [{ id: "keys-a", name: "Keys A" }, { id: "keys-b", name: "Keys B" }] });
  await openSampler(page);
  await enableFakeMidi(page);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await sendMidi(page, MIDI_BYTES.noteOn(60, 100, 0), { inputId: "keys-a" });
  await sendMidi(page, MIDI_BYTES.noteOn(60, 80, 1), { inputId: "keys-a" });
  await sendMidi(page, MIDI_BYTES.noteOn(60, 90, 0), { inputId: "keys-b" });
  await expect.poll(() => heldNotes(page)).toEqual([60, 60, 60]);
  await sendMidi(page, MIDI_BYTES.noteOff(60, 0, 0), { inputId: "keys-a" });
  await expect.poll(() => heldNotes(page)).toEqual([60, 60]);
  await sendMidi(page, MIDI_BYTES.noteOff(60, 0, 1), { inputId: "keys-a" });
  await expect.poll(() => heldNotes(page)).toEqual([60]);
  await sendMidi(page, MIDI_BYTES.controlChange(7, 64), { inputId: "keys-b" });
  await expect.poll(async () => Number(await page.locator("#output").inputValue())).toBeCloseTo(64 / 127, 2);
  await page.locator("#sharedMidiToggle").click();
  await expect.poll(() => heldNotes(page)).toEqual([]);
  await waitForStableAudioState(page, false);
});

test("ESI-32 waveform edits and keyboard rebuilds keep gesture ownership bounded", async ({ page }) => {
  await openSampler(page); await arm(page);
  const key = page.locator('#keyboard .esi-key[data-note="48"]');
  await key.hover(); await page.mouse.down();
  await expect.poll(() => heldNotes(page)).toEqual([48]);
  // A second touch can change the octave while the first pointer still holds a key.
  await page.locator('#octaveUp').evaluate(button => button.click());
  await expect.poll(() => heldNotes(page)).toEqual([]);
  await page.mouse.up();
  const wave = page.locator('#waveform');
  await wave.scrollIntoViewIfNeeded();
  const box = await wave.boundingBox();
  await page.mouse.move(box.x + 2, box.y + 12); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .2, box.y + 12); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__esi32.getState().patches[0].start)).toBeCloseTo(.2, 2);
  await wave.focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__esi32.getState().patches[0].start)).toBeCloseTo(.205, 2);
  await page.locator('#loopEnabled').check();
  await page.locator('#audition').click();
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(.001);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audition')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(.001);
  await page.locator('#panic').click(); await waitForStableAudioState(page, false);
});

test("ESI-32 native MIDI macros update their assigned sound parameters", async ({ page }) => {
  await installFakeMidi(page); await openSampler(page); await enableFakeMidi(page);
  await sendMidi(page, MIDI_BYTES.controlChange(14, 127));
  await expect(page.locator('#cutoff')).toHaveValue('20000');
  await sendMidi(page, MIDI_BYTES.controlChange(15, 64));
  await expect.poll(async () => Number(await page.locator('#resonance').inputValue())).toBeCloseTo(64/127, 2);
  await sendMidi(page, MIDI_BYTES.controlChange(16, 0));
  await expect(page.locator('#tune')).toHaveValue('-36');
  await sendMidi(page, MIDI_BYTES.controlChange(21, 32));
  await expect.poll(async () => Number(await page.locator('#level').inputValue())).toBeCloseTo(32/127, 2);
});

test("ESI-32 one-shot audition returns to ready after the sample finishes", async ({ page }) => {
  await openSampler(page); await arm(page); await setRange(page, 'tune', 36);
  await page.locator('#audition').click();
  await expect(page.locator('#audition')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#audition')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => heldNotes(page)).toEqual([]);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
});
