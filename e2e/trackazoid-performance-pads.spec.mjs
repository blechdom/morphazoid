import { test, expect } from "@playwright/test";
import { readAudioStatus } from "./helpers/audio-probe.mjs";

const state = (page) => page.evaluate(() => window.__trackazoid.snapshot());
const deck = async (page, id) => (await state(page)).decks[id];
const demoIds = ["mint-transmission", "amber-circuit", "broken-orbit", "velvet-current", "chrome-parade", "cobalt-rush"];
const demoBpms = [120, 126, 110, 90, 116, 174];

function diagnostics(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url()).origin) errors.push(`${response.status()} ${response.url()}`); });
  page.on("dialog", dialog => { errors.push(`Unexpected dialog: ${dialog.message()}`); void dialog.dismiss(); });
  return errors;
}

async function ready(page, pair = true) {
  await page.goto("/trackazoid.html");
  await expect(page.locator("#trackazoid")).toHaveAttribute("data-ready", "true");
  if (pair) {
    await page.locator("#demoPair").click();
    await expect(page.locator("#demoPair")).toBeEnabled();
    await expect(page.locator("#aState")).toHaveText("READY");
    await expect(page.locator("#bState")).toHaveText("READY");
  }
}

async function audioOff(page, errors) {
  expect((await state(page)).contextState).toBe("none");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
}

async function seekBeat(page, id, beats) {
  await page.locator(`#${id}Waveform`).focus(); await page.keyboard.press("Home");
  for (let i = 0; i < beats; i++) await page.keyboard.press("ArrowRight");
}

async function selectBeats(page, id, start, end) {
  await seekBeat(page, id, start); await page.keyboard.press("i");
  for (let i = start; i < end; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("o"); return (await deck(page, id)).selection;
}

async function editor(page, id, slot) {
  const details = page.locator(`#deck${id.toUpperCase()} .tz-pad-editor`);
  if (!(await details.evaluate(node => node.open))) await details.locator("summary").click();
  await page.locator(`#${id}PadSlot`).selectOption(String(slot));
}

async function stored(page, name) {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const opening = indexedDB.open("morphazoid-trackazoid-library", 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, request = db.transaction("entries", "readonly").objectStore("entries").getAll();
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => { db.close(); resolve(request.result.find(entry => entry.name.startsWith(name))); };
    };
  }), name);
}

async function synced(page) {
  await expect.poll(async () => {
    const { decks } = await state(page);
    return decks.a.playing && decks.b.playing && decks.b.sync && !decks.b.pending && Math.abs(decks.b.phaseError) < 0.03;
  }).toBe(true);
}

function pulseWave(channel) {
  const sampleRate = 16000, frames = 24 * sampleRate, bytes = Buffer.alloc(44 + frames * 4);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const time = i / sampleRate, phase = time % 0.5;
    const value = 0.45 * Math.sin(2 * Math.PI * 60 * phase) * Math.exp(-phase / 0.04) + 0.004 * Math.sin(2 * Math.PI * 220 * time);
    bytes.writeInt16LE(Math.round(value * 32767), 44 + i * 4 + channel * 2);
  }
  return bytes;
}

async function startRhythmCapture(page) {
  await page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const manager = getSharedAudioOutputManager(globalThis), context = manager.recordingContext();
    const source = `class PadProbe extends AudioWorkletProcessor {
      constructor() { super(); this.frames = 0; this.blocks = []; this.done = false; }
      process(inputs, outputs) {
        for (const channel of outputs[0] || []) channel.fill(0);
        if (this.done) return true;
        const input = inputs[0], frames = input?.[0]?.length || 128;
        let left = 0, right = 0, peak = 0, invalid = 0;
        for (let i = 0; i < frames; i++) {
          const l = input?.[0]?.[i] ?? 0, r = input?.[1]?.[i] ?? 0;
          invalid += Number(!Number.isFinite(l) || !Number.isFinite(r));
          left += l*l; right += r*r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
        }
        this.blocks.push({time: this.frames / sampleRate, left: left / frames, right: right / frames, peak, invalid});
        this.frames += frames;
        if (this.frames >= sampleRate * 8) { this.done = true; this.port.postMessage(this.blocks); }
        return true;
      }
    } registerProcessor("trackazoid-pad-probe", PadProbe);`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const node = new AudioWorkletNode(context, "trackazoid-pad-probe", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
    const release = manager.tapInto(context, node);
    window.__padCapture = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { release(); node.disconnect(); node.port.close(); reject(new Error("Pad PCM capture timed out")); }, 12_000);
      node.port.onmessage = ({ data }) => { clearTimeout(timeout); release(); node.disconnect(); node.port.close(); resolve(data); };
    });
    const started = context.currentTime;
    window.__padCaptureTime = () => context.currentTime - started;
    node.connect(context.destination);
  });
}

test("six per-deck demos load independently and stage changes to a playing deck", async ({ page }) => {
  test.setTimeout(45_000);
  const errors = diagnostics(page); await ready(page, false);
  for (const id of ["a", "b"]) expect(await page.locator(`#${id}Demo option`).evaluateAll(options => options.map(option => option.value).filter(Boolean))).toEqual(demoIds);
  await Promise.all([page.locator("#aDemo").selectOption(demoIds[0]), page.locator("#bDemo").selectOption(demoIds[1])]);
  await expect(page.locator("#aState")).toHaveText("READY"); await expect(page.locator("#bState")).toHaveText("READY");
  const b = await deck(page, "b");
  for (let i = 2; i < demoIds.length; i++) {
    await page.locator("#aDemo").selectOption(demoIds[i]);
    await expect(page.locator("#aDemo")).toBeEnabled();
    const a = await deck(page, "a");
    expect(a.metadata.bpm).toBe(demoBpms[i]); expect(a.metadata.gridSource).toBe("auto");
    expect(a.duration).toBeGreaterThan(15); expect(a.playing).toBe(false);
    expect((await deck(page, "b")).entry).toBe(b.entry);
  }
  expect((await state(page)).library).toHaveLength(6);
  await page.locator("#aLoop").click(); await page.locator("#aPlay").click();
  const playing = await deck(page, "a");
  await page.locator("#aDemo").selectOption(demoIds[0]); await expect(page.locator("#aPending")).toBeVisible();
  expect((await deck(page, "a")).entry).toBe(playing.entry); expect((await deck(page, "a")).playing).toBe(true);
  await page.locator("#aCancel").click(); expect((await deck(page, "a")).replacement).toBeNull();
  await page.locator("#aDemo").selectOption(demoIds[2]); await expect(page.locator("#aPending")).toBeVisible();
  await page.locator("#aReplace").click(); await expect(page.locator("#aState")).toHaveText("READY");
  expect((await deck(page, "a")).metadata.bpm).toBe(110); expect((await deck(page, "a")).playing).toBe(false);
  expect((await deck(page, "b")).entry).toBe(b.entry);
  await audioOff(page, errors);
});

test("all eight typed pads persist names and moved saved loops without changing their length", async ({ page }) => {
  const errors = diagnostics(page); await ready(page);
  for (let slot = 0; slot < 7; slot++) {
    await seekBeat(page, "a", slot); await page.locator(`#aHotCue${slot + 1}`).click();
  }
  const selection = await selectBeats(page, "a", 8, 12);
  await page.locator("#aHotCue8").click();
  let a = await deck(page, "a");
  expect(a.metadata.version).toBe(3); expect(a.metadata.pads).toHaveLength(8); expect(a.metadata.cues).toHaveLength(8);
  expect(a.metadata.pads.slice(0, 7).map(pad => pad.type)).toEqual(Array(7).fill("cue"));
  expect(a.metadata.pads[7]).toEqual({ type: "loop", ...selection, name: "" });
  await expect(page.locator("#aMark")).toBeDisabled();
  expect(a.loop).toBeNull(); expect(a.playing).toBe(false);
  const name = '<img src=x onerror=alert(1)> & "chorus"';
  await editor(page, "a", 7); await page.locator("#aPadName").fill(name);
  await page.waitForTimeout(150); await expect(page.locator("#aPadName")).toHaveValue(name);
  await page.locator("#aPadRename").click(); await expect(page.locator("#aHotCue8")).toContainText(name);
  await expect(page.locator("#aHotCue8")).toHaveAccessibleName(/^Deck A pad 8: recall saved loop/);
  expect(await page.locator("#aHotCue8").getAttribute("aria-label")).toContain(name);
  await expect(page.locator("#aHotCue8 img")).toHaveCount(0);
  await page.locator("#aFit").click();
  const canvas = page.locator("#aWaveform"); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  a = await deck(page, "a");
  await page.mouse.move(box.x + selection.start / a.viewport.span * box.width + 3, box.y + box.height - 12);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.58, box.y + box.height - 12, { steps: 8 }); await page.mouse.up();
  const moved = (await deck(page, "a")).metadata.pads[7];
  expect(moved.start).toBeGreaterThan(selection.start + 1); expect(moved.end - moved.start).toBeCloseTo(selection.end - selection.start, 6);
  expect(moved.name).toBe(name); expect(moved.type).toBe("loop");
  await expect.poll(async () => (await stored(page, "Mint transmission"))?.metadata.pads[7]).toEqual(moved);
  await ready(page); a = await deck(page, "a"); expect(a.metadata.pads[7]).toEqual(moved); expect(a.loop).toBeNull();
  await page.locator("#aHotCue8").click(); expect((await deck(page, "a")).loop).toEqual({ start: moved.start, end: moved.end });
  expect((await deck(page, "a")).playing).toBe(false);
  await page.locator("#aWaveform").focus(); await page.keyboard.press("Shift+Digit8");
  expect((await deck(page, "a")).metadata.pads[7]).toBeNull();
  await expect(page.locator("#aMark")).toBeEnabled();
  // Clearing a stored pad leaves the already playing/selected loop independent.
  expect((await deck(page, "a")).loop).toEqual({ start: moved.start, end: moved.end });
  await audioOff(page, errors);
});

test("legacy four-cue metadata migrates to eight pads and cleared pads never revive", async ({ page }) => {
  const errors = diagnostics(page); await ready(page);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open("morphazoid-trackazoid-library", 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, transaction = db.transaction("entries", "readwrite"), store = transaction.objectStore("entries"), request = store.getAll();
      request.onsuccess = () => {
        const entry = request.result.find(entry => entry.name.startsWith("Mint transmission"));
        entry.metadata = { version: 1, bpm: 132, beatOffset: 0.25, duration: 16, cues: [1, 2, null, 4] }; store.put(entry);
      };
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
  await ready(page);
  let metadata = (await deck(page, "a")).metadata;
  expect(metadata.version).toBe(3); expect(metadata.gridSource).toBe("manual"); expect(metadata.bpm).toBe(132);
  expect(metadata.cues).toEqual([1, 2, null, 4, null, null, null, null]);
  expect(metadata.pads[0]).toEqual({ type: "cue", position: 1, name: "" });
  await page.locator("#aHotCue1").click({ modifiers: ["Shift"] });
  await editor(page, "a", 7); await page.locator("#aPadStoreCue").click();
  await expect.poll(async () => {
    const metadata = (await stored(page, "Mint transmission"))?.metadata;
    return { version: metadata?.version, first: metadata?.pads[0], lastType: metadata?.pads[7]?.type };
  }).toEqual({ version: 3, first: null, lastType: "cue" });
  await ready(page); metadata = (await deck(page, "a")).metadata;
  expect(metadata.pads[0]).toBeNull(); expect(metadata.cues[0]).toBeNull(); expect(metadata.pads[7].type).toBe("cue");
  expect(metadata.cues[1]).toBe(2); expect(metadata.cues[3]).toBe(4);
  await audioOff(page, errors);
});

test("beat jumps, loop movement and half/double controls use their displayed beat units and preserve native typing", async ({ page }) => {
  const errors = diagnostics(page); await ready(page, false);
  await page.locator("#aDemo").selectOption("broken-orbit"); await expect(page.locator("#aState")).toHaveText("READY");
  const period = 60 / 110;
  for (const beats of [1, 4, 8, 16, 32]) {
    await page.locator("#aMoveBeats").selectOption(String(beats)); await page.locator("#aBeatJumpForward").click();
    expect((await deck(page, "a")).position).toBeCloseTo(beats * period, 6);
    await page.locator("#aBeatJumpBack").click(); expect((await deck(page, "a")).position).toBeCloseTo(0, 6);
  }
  await page.locator("#aMoveBeats").selectOption("4"); await page.locator("#aWaveform").focus(); await page.keyboard.press("BracketRight");
  expect((await deck(page, "a")).position).toBeCloseTo(4 * period, 6);
  await page.locator("#aLoop").click(); const original = (await deck(page, "a")).loop;
  await page.locator("#aLoopHalf").click(); let loop = (await deck(page, "a")).loop;
  await expect(page.locator("#aLoopBeats")).toHaveValue("2");
  expect(loop.start).toBeCloseTo(original.start, 6); expect(loop.end - loop.start).toBeCloseTo(2 * period, 6);
  await page.locator("#aLoopDouble").click(); expect((await deck(page, "a")).loop).toEqual(original);
  await expect(page.locator("#aLoopBeats")).toHaveValue("4");
  await page.locator("#aLoopMoveForward").click(); loop = (await deck(page, "a")).loop;
  expect(loop.start).toBeCloseTo(original.start + 4 * period, 6); expect(loop.end - loop.start).toBeCloseTo(4 * period, 6);
  await page.locator("#aWaveform").focus(); await page.keyboard.press("Shift+BracketLeft");
  expect((await deck(page, "a")).loop).toEqual(original);
  await page.locator("#aFit").click(); const canvas = page.locator("#aWaveform"); await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4, { steps: 8 }); await page.mouse.up();
  const independentSelection = (await deck(page, "a")).selection;
  expect(independentSelection.start).toBeGreaterThan(original.end);
  await page.locator("#aLoopDouble").click(); expect((await deck(page, "a")).selection).toEqual(independentSelection);
  await page.locator("#aWaveform").focus();
  await page.keyboard.press("q"); expect((await deck(page, "a")).quantize).toBe(false);
  await page.keyboard.press("q"); expect((await deck(page, "a")).quantize).toBe(true);
  const before = await deck(page, "a"); await page.locator("#librarySearch").fill("q"); await page.keyboard.type("[]q");
  await expect(page.locator("#librarySearch")).toHaveValue("q[]q");
  const after = await deck(page, "a"); expect(after.position).toBe(before.position); expect(after.loop).toEqual(before.loop); expect(after.quantize).toBe(true);
  await audioOff(page, errors);
});

test("Quantize preserves playing follower phase on cue and loop recall; manual recalls release Sync", async ({ page }) => {
  const errors = diagnostics(page); await ready(page);
  await seekBeat(page, "b", 8); await page.locator("#bHotCue1").click();
  const range = await selectBeats(page, "b", 12, 16); await page.locator("#bHotCue2").click();
  await page.locator("#bSelectionClear").click(); await seekBeat(page, "b", 0);
  await page.locator("#aLoopBeats").selectOption("16"); await page.locator("#aLoop").click();
  await page.locator("#aPlay").click(); await page.locator("#bSync").click(); await page.locator("#bPlay").click(); await synced(page);
  expect((await deck(page, "b")).quantize).toBe(true);
  await page.locator("#bHotCue1").click(); await synced(page);
  await page.locator("#bHotCue2").click(); await synced(page); expect((await deck(page, "b")).loop).toEqual(range);
  await page.locator("#bLoopHalf").click(); await synced(page);
  await page.locator("#bLoopDouble").click(); await synced(page);
  await page.locator("#bLoopMoveForward").click(); await synced(page);
  const moved = await deck(page, "b"); expect(moved.selection).toEqual(moved.loop);
  await page.locator("#bLoop").click(); expect((await deck(page, "b")).loop).toBeNull();
  await page.locator("#bHotCue2").click(); await synced(page);
  await page.locator("#bQuantize").click(); await page.locator("#bHotCue1").click();
  expect((await deck(page, "b")).sync).toBe(false); expect((await deck(page, "b")).playing).toBe(true);
  await page.locator("#bSync").click(); await synced(page);
  await page.locator("#bBeatJumpForward").click(); await synced(page); // Integer beat jumps keep phase even with Q off.
  await page.locator("#bHotCue2").click(); expect((await deck(page, "b")).sync).toBe(false);
  await page.locator("#bSync").click(); await synced(page);
  await page.locator("#bWaveform").focus(); await page.keyboard.press("ArrowRight");
  expect((await deck(page, "b")).sync).toBe(false);
  await audioOff(page, errors);
});

test("actual stereo pulses stay aligned and audible through quantized cue, jump and saved-loop performance", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  const errors = diagnostics(page); await ready(page, false);
  await page.locator("#filePicker").setInputFiles([
    { name: "Left pulses.wav", mimeType: "audio/wav", buffer: pulseWave(0) },
    { name: "Right pulses.wav", mimeType: "audio/wav", buffer: pulseWave(1) },
  ]);
  for (const [id, name] of [["a", "Left pulses.wav"], ["b", "Right pulses.wav"]]) {
    await page.getByRole("button", { name: `Load ${name} into deck ${id.toUpperCase()}`, exact: true }).click();
    await expect(page.locator(`#${id}State`)).toHaveText("READY");
    await page.locator(`#${id}Adjust > summary`).click(); await page.locator(`#${id}Bpm`).fill("120");
    await seekBeat(page, id, 0); await page.locator(`#${id}Grid`).click();
  }
  await seekBeat(page, "b", 4); await page.locator("#bHotCue1").click();
  await selectBeats(page, "b", 12, 16); await page.locator("#bHotCue2").click();
  await page.locator("#bSelectionClear").click(); await seekBeat(page, "b", 0);
  await page.locator("#aPlay").click(); await page.locator("#bSync").click(); await page.locator("#bPlay").click();
  await page.locator("#audioButton").click(); await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await synced(page); await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(0.005);
  await startRhythmCapture(page); await page.waitForTimeout(650);
  for (const suffix of ["HotCue1", "BeatJumpForward", "HotCue2", "LoopMoveForward", "LoopHalf", "LoopDouble"]) {
    await page.locator(`#b${suffix}`).click(); await synced(page); await page.waitForTimeout(170);
  }
  // A second action in the same task replaces the scheduled manual seek. Its
  // phase must come from what is still audible, not the discarded Home target.
  await page.locator("#bWaveform").focus();
  await page.waitForFunction(() => {
    const a = window.__trackazoid.snapshot().decks.a, fraction = (a.position * 2) % 1;
    return fraction > 0.35 && fraction < 0.65;
  });
  const rapidRecallTime = await page.evaluate(() => {
    document.getElementById("bWaveform").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", code: "Home", bubbles: true, cancelable: true }));
    document.getElementById("bHotCue1").click();
    return window.__padCaptureTime();
  });
  expect(rapidRecallTime + 1.1, "the unsynced regression must fit inside the PCM capture").toBeLessThan(8);
  expect((await deck(page, "b")).sync).toBe(false);
  await page.waitForTimeout(1100); // Hear two beats before Sync can repair any phase error.
  await page.locator("#bSync").click(); await synced(page);
  const blocks = await page.evaluate(() => window.__padCapture);
  expect(blocks.every(block => block.invalid === 0 && Number.isFinite(block.left) && Number.isFinite(block.right))).toBe(true);
  expect(Math.max(...blocks.map(block => block.peak))).toBeLessThan(1);
  const attacks = {};
  for (const channel of ["left", "right"]) {
    for (let second = 0; second < 8; second++) {
      const window = blocks.filter(block => block.time >= second && block.time < second + 1);
      expect(Math.sqrt(window.reduce((sum, block) => sum + block[channel], 0) / window.length), `${channel} RMS at ${second}s`).toBeGreaterThan(0.005);
    }
    const threshold = Math.max(...blocks.map(block => block[channel])) * 0.18, found = [];
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.time < 0.25 || block.time > 7.75 || block[channel] < threshold || blocks[i - 1][channel] >= threshold) continue;
      if (!found.length || block.time - found.at(-1) > 0.3) found.push(block.time);
    }
    expect(found.length, `${channel} beat attacks`).toBeGreaterThanOrEqual(13); attacks[channel] = found;
  }
  const gaps = attacks.right.map(time => Math.min(...attacks.left.map(other => Math.abs(time - other))));
  await testInfo.attach("pad-pcm-rhythm.json", { body: JSON.stringify({ rapidRecallTime, attacks, onsetGaps: gaps }, null, 2), contentType: "application/json" });
  expect(Math.max(...gaps), `Rendered follower/master onset differences: ${gaps.join(", ")}`).toBeLessThan(0.045);
  await synced(page); expect((await readAudioStatus(page)).connectionCount).toBe(1);
  await page.evaluate(() => window.__trackazoid.dispose()); await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`performance pads and movement controls remain reachable below the menubar at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    const errors = diagnostics(page); await page.setViewportSize(viewport); await ready(page);
    for (const id of ["a", "b"]) {
      await editor(page, id, 7);
      for (const suffix of ["Demo", "Quantize", "HotCue1", "HotCue8", "MoveBeats", "BeatJumpForward", "LoopMoveForward", "LoopHalf", "LoopDouble", "PadName", "PadStoreLoop", "PadClear"]) {
        const control = page.locator(`#${id}${suffix}`); await control.scrollIntoViewIfNeeded(); await expect(control).toBeInViewport();
        const box = await control.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const header = page.locator(".masthead"), hit = await header.evaluate(node => {
      const box = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.x + box.width / 2, Math.max(0, box.y) + 2));
    });
    expect(hit).toBe(true);
    await page.locator(".header-settings-trigger").click(); await expect(page.locator(".header-settings-panel")).toBeVisible();
    await page.keyboard.press("Escape"); await expect(page.locator(".header-settings-panel")).toBeHidden();
    await audioOff(page, errors);
  });
}
