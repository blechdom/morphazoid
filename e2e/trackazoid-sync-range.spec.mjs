import { test, expect } from "@playwright/test";
import { readAudioStatus } from "./helpers/audio-probe.mjs";

const snapshot = (page) => page.evaluate(() => window.__trackazoid.snapshot());
const otherDeck = (id) => id === "a" ? "b" : "a";
const sourceBpm = { a: 110, b: 174 };

function diagnostics(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

async function ready(page) {
  await page.goto("/trackazoid.html");
  await expect(page.locator("#trackazoid")).toHaveAttribute("data-ready", "true");
}

async function demoPair(page) {
  await ready(page);
  await page.locator("#aDemo").selectOption("broken-orbit");
  await page.locator("#bDemo").selectOption("cobalt-rush");
  await expect(page.locator("#aState")).toHaveText("READY");
  await expect(page.locator("#bState")).toHaveText("READY");
  const state = await snapshot(page);
  expect(state.decks.a.metadata.bpm).toBe(110);
  expect(state.decks.b.metadata.bpm).toBe(174);
}

async function audioOff(page) {
  const state = await snapshot(page);
  expect(state.armed).toBe(false);
  expect(state.contextState).toBe("none");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
}

async function matched(page, follower, bpm, playing = true) {
  const reference = otherDeck(follower);
  await expect.poll(async () => {
    const { decks } = await snapshot(page);
    return decks[follower].sync && !decks[follower].pending && !decks[follower].syncError
      && decks.a.playing === playing && decks.b.playing === playing
      && Math.abs(decks.a.effectiveBpm - bpm) < 0.05 && Math.abs(decks.b.effectiveBpm - bpm) < 0.05
      && (!playing || Math.abs(decks[follower].phaseError) < 0.04);
  }).toBe(true);
  await expect(page.locator(`#${follower}Sync`)).toHaveAttribute("aria-pressed", "true");
  const state = await snapshot(page);
  expect(state.decks[reference].sync).toBe(false);
  for (const id of ["a", "b"]) {
    await expect(page.locator(`#${id}Effective`)).toHaveText(bpm.toFixed(1));
    const tempo = await page.locator(`#${id}Tempo`).inputValue();
    expect(Number(tempo)).toBeCloseTo((state.decks[id].rate - 1) * 100, 1);
    await expect(page.locator(`#${id}TempoOut`)).toHaveText(`${state.decks[id].rate >= 1 ? "+" : ""}${((state.decks[id].rate - 1) * 100).toFixed(1)}%`);
  }
}

async function slider(page, selector, value) {
  await page.locator(selector).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function keyLock(page, id, enabled) {
  const button = page.locator(`#${id}KeyLock`);
  if (await button.getAttribute("aria-pressed") !== String(enabled)) await button.click();
  await expect(button).toHaveAttribute("aria-pressed", String(enabled));
  await expect(button).toBeEnabled();
}

// Deterministic stereo impulses make A and B separately measurable at the
// public recording tap. A quiet carrier also permits rate-extreme audibility
// checks between sparse beats. No engine or transport state is injected.
function pulseWave(bpm, channel) {
  const sampleRate = 16000, frames = 32 * sampleRate, bytes = Buffer.alloc(44 + frames * 4);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const time = i / sampleRate, phase = time % (60 / bpm);
    const value = 0.45 * Math.sin(2 * Math.PI * 60 * phase) * Math.exp(-phase / 0.04) + 0.015 * Math.sin(2 * Math.PI * 220 * time);
    bytes.writeInt16LE(Math.round(value * 32767), 44 + i * 4 + channel * 2);
  }
  return bytes;
}

async function pulsePair(page) {
  await ready(page);
  const files = ["a", "b"].map((id, channel) => ({name: `Pulse ${id.toUpperCase()}.wav`, mimeType: "audio/wav", buffer: pulseWave(sourceBpm[id], channel)}));
  await page.locator("#filePicker").setInputFiles(files);
  for (const id of ["a", "b"]) {
    await page.getByRole("button", {name: `Load Pulse ${id.toUpperCase()}.wav into deck ${id.toUpperCase()}`, exact: true}).click();
    await expect.poll(async () => {
      const deck = (await snapshot(page)).decks[id];
      return !deck.loading && !deck.analyzing && Boolean(deck.metadata.analysis);
    }, {timeout: 20_000}).toBe(true);
    await page.locator(`#${id}Adjust summary`).click();
    await page.locator(`#${id}Bpm`).fill(String(sourceBpm[id]));
    await page.locator(`#${id}Waveform`).focus(); await page.keyboard.press("Home");
    await page.locator(`#${id}Grid`).click();
    await page.locator(`#${id}Adjust summary`).click();
  }
}

async function installBeatProbe(page) {
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
  await page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const manager = getSharedAudioOutputManager(globalThis), context = manager.recordingContext();
    if (!context) throw new Error("Arm Audio before installing its beat probe");
    const source = `class BeatProbe extends AudioWorkletProcessor {
      constructor() { super(); this.capture = null; this.port.onmessage = ({data}) => { this.capture = {frames: data.frames, at: 0, blocks: []}; }; }
      process(inputs, outputs) {
        for (const channel of outputs[0] || []) channel.fill(0);
        const capture = this.capture, input = inputs[0];
        if (!capture || !input?.[0] || !input?.[1]) return true;
        let left = 0, right = 0, peak = 0, invalid = 0;
        for (let i = 0; i < input[0].length; i++) {
          const l = input[0][i], r = input[1][i];
          if (!Number.isFinite(l) || !Number.isFinite(r)) invalid++;
          left += l*l; right += r*r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
        }
        capture.blocks.push({time: capture.at / sampleRate, left: left / input[0].length, right: right / input[0].length, peak, invalid});
        capture.at += input[0].length;
        if (capture.at >= capture.frames) { this.port.postMessage(capture.blocks); this.capture = null; }
        return true;
      }
    }; registerProcessor("trackazoid-beat-probe", BeatProbe);`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const node = new AudioWorkletNode(context, "trackazoid-beat-probe", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit",
    });
    const release = manager.tapInto(context, node); node.connect(context.destination);
    window.__beatProbe = {
      capture: (seconds) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Beat probe did not finish")), seconds * 1000 + 5000);
        node.port.onmessage = ({data}) => { clearTimeout(timeout); resolve(data); };
        node.port.postMessage({frames: Math.ceil(seconds * context.sampleRate)});
      }),
      dispose: () => { release(); node.disconnect(); node.port.close(); },
    };
  });
}


function inspectOutput(blocks) {
  expect(blocks.every(block => !block.invalid && Number.isFinite(block.left) && Number.isFinite(block.right))).toBe(true);
  const peak = Math.max(...blocks.map(block => block.peak));
  expect(peak).toBeLessThan(1);
  const rms = Object.fromEntries(["left", "right"].map(channel => [channel, Math.sqrt(blocks.reduce((sum, block) => sum + block[channel], 0) / blocks.length)]));
  expect(rms.left).toBeGreaterThan(0.0001); expect(rms.right).toBeGreaterThan(0.0001);
  return {peak, rms};
}

async function alignedOutput(page, bpm, info, name) {
  const seconds = 4, blocks = await page.evaluate(seconds => window.__beatProbe.capture(seconds), seconds);
  const metrics = inspectOutput(blocks), period = 60 / bpm;
  const attacks = channel => {
    const threshold = Math.max(...blocks.map(block => block[channel])) * 0.22, found = [];
    for (let index = 1; index < blocks.length; index++) {
      const block = blocks[index];
      if (block.time < 0.3 || block.time > seconds - 0.3 || block[channel] < threshold || blocks[index - 1][channel] >= threshold) continue;
      if (!found.length || block.time - found.at(-1) > period * 0.5) found.push(block.time);
    }
    return found;
  };
  const left = attacks("left"), right = attacks("right");
  const gaps = left.map(time => Math.min(...right.map(other => Math.abs(time - other)))).sort((a,b) => a-b);
  await info.attach(name, {body: JSON.stringify({...metrics, bpm, left, right, gaps}), contentType: "application/json"});
  expect(left.length).toBeGreaterThanOrEqual(5); expect(right.length).toBeGreaterThanOrEqual(5);
  // One boundary onset may have its partner just outside the capture window.
  expect(gaps.at(-2), `Audible onset gaps: ${gaps.join(", ")}`).toBeLessThan(0.045);
  return metrics;
}

for (const follower of ["a", "b"]) for (const first of ["a", "b"]) {
  test(`110/174 demos: paused Sync ${follower.toUpperCase()} matches immediately, then ${first.toUpperCase()} can launch first`, async ({page}) => {
    const errors = diagnostics(page); await demoPair(page);
    const targetBpm = sourceBpm[otherDeck(follower)];
    await page.locator(`#${follower}Sync`).click();
    await matched(page, follower, targetBpm, false);
    await audioOff(page);
    await page.locator(`#${first}Play`).click();
    await page.waitForTimeout(230);
    await page.locator(`#${otherDeck(first)}Play`).click();
    await matched(page, follower, targetBpm);
    await audioOff(page); expect(errors).toEqual([]);
  });
}

for (const follower of ["a", "b"]) {
  test(`110/174 demos: Sync ${follower.toUpperCase()} follows the other playing deck even when clicked on the current master`, async ({page}) => {
    const errors = diagnostics(page); await demoPair(page);
    await page.locator(`#${follower}Play`).click();
    await page.locator(`#${otherDeck(follower)}Play`).click();
    expect((await snapshot(page)).master).toBe(follower);
    await page.locator(`#${follower}Sync`).click();
    await matched(page, follower, sourceBpm[otherDeck(follower)]);
    expect((await snapshot(page)).master).toBe(otherDeck(follower));
    await page.locator(`#${follower}Sync`).click();
    expect((await snapshot(page)).decks[follower].sync).toBe(false);
    await audioOff(page); expect(errors).toEqual([]);
  });
}

for (const follower of ["a", "b"]) for (const lock of [false, true]) {
  test(`110/174 actual output aligns at ${sourceBpm[otherDeck(follower)]} BPM with ${lock ? "key lock" : "pitch following tempo"}`, async ({page}, info) => {
    test.setTimeout(60_000);
    const errors = diagnostics(page); await pulsePair(page);
    for (const id of ["a", "b"]) await keyLock(page, id, lock);
    await page.locator(`#${follower}Sync`).click();
    await page.locator("#aPlay").click(); await page.locator("#bPlay").click();
    await page.locator("#audioButton").click();
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
    const bpm = sourceBpm[otherDeck(follower)]; await matched(page, follower, bpm);
    await installBeatProbe(page);
    try {
      await alignedOutput(page, bpm, info, "initial-output");
      // One deck may preserve pitch while the other follows tempo. Switching
      // during performance must retain both transport and the follower's Sync.
      await keyLock(page, follower, !lock);
      await matched(page, follower, bpm);
      await alignedOutput(page, bpm, info, "mixed-pitch-output");
      expect((await snapshot(page)).decks[otherDeck(follower)].keyLock).toBe(lock);
      expect(errors).toEqual([]);
    } finally { await page.evaluate(() => window.__beatProbe.dispose()); }
  });
}

for (const lock of [false, true]) {
  test(`wide rate endpoints remain finite and audible with ${lock ? "key lock" : "pitch following tempo"}`, async ({page}, info) => {
    test.setTimeout(60_000);
    const errors = diagnostics(page); await pulsePair(page);
    for (const id of ["a", "b"]) {
      await keyLock(page, id, lock);
      await expect(page.locator(`#${id}Tempo`)).toHaveAttribute("min", "-87.5");
      await expect(page.locator(`#${id}Tempo`)).toHaveAttribute("max", "700");
      await page.locator(`#${id}Loop`).click();
    }
    await page.locator("#audioButton").click();
    await page.locator("#aPlay").click(); await page.locator("#bPlay").click();
    await installBeatProbe(page);
    try {
      for (const percent of [-87.5, 700]) {
        for (const id of ["a", "b"]) await slider(page, `#${id}Tempo`, percent);
        await expect.poll(async () => {
          const {decks} = await snapshot(page);
          return !decks.a.pending && !decks.b.pending && decks.a.rate === 1 + percent / 100 && decks.b.rate === 1 + percent / 100;
        }).toBe(true);
        const blocks = await page.evaluate(() => window.__beatProbe.capture(3));
        const metrics = inspectOutput(blocks);
        await info.attach(`rate-${1 + percent / 100}`, {body: JSON.stringify(metrics), contentType: "application/json"});
        const state = await snapshot(page);
        for (const id of ["a", "b"]) {
          expect(state.decks[id].playing).toBe(true); expect(state.decks[id].loop).not.toBeNull();
          expect(state.decks[id].keyLock).toBe(lock);
          await expect(page.locator(`#${id}TempoOut`)).toHaveText(`${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`);
          await expect(page.locator(`#${id}Effective`)).toHaveText((sourceBpm[id] * (1 + percent / 100)).toFixed(1));
        }
      }
      expect(errors).toEqual([]);
    } finally { await page.evaluate(() => window.__beatProbe.dispose()); }
  });
}

test("apply-both pitch menu preserves paused preparation and audible synchronized playback", async ({page}, info) => {
  test.setTimeout(60_000);
  const errors = diagnostics(page); await pulsePair(page);
  const menu = page.locator("#pitchBoth");
  await menu.selectOption("follow");
  await expect(menu).toHaveValue(""); await expect(menu).toBeEnabled();
  for (const id of ["a", "b"]) {
    await expect(page.locator(`#${id}KeyLock`)).toHaveAttribute("aria-pressed", "false");
    expect((await snapshot(page)).decks[id].playing).toBe(false);
  }
  await audioOff(page);
  await keyLock(page, "a", true);
  expect((await snapshot(page)).decks.b.keyLock).toBe(false);
  await menu.selectOption("keep");
  await expect(menu).toBeEnabled(); await expect(menu).toHaveValue("");
  await page.locator("#bSync").click();
  for (const id of ["a", "b"]) await page.locator(`#${id}Loop`).click();
  await page.locator("#aPlay").click(); await page.locator("#bPlay").click();
  await page.locator("#audioButton").click();
  await installBeatProbe(page);
  try {
    for (const mode of ["follow", "keep"]) {
      await menu.selectOption(mode); await expect(menu).toBeEnabled(); await expect(menu).toHaveValue("");
      for (const id of ["a", "b"]) {
        await expect(page.locator(`#${id}KeyLock`)).toHaveAttribute("aria-pressed", String(mode === "keep"));
        expect((await snapshot(page)).decks[id].loop).not.toBeNull();
      }
      await matched(page, "b", 110);
      await alignedOutput(page, 110, info, `both-${mode}-output`);
    }
    expect(errors).toEqual([]);
  } finally { await page.evaluate(() => window.__beatProbe.dispose()); }
});
