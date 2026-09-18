import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";

const ids = ["tempo-tantrum", "tape-worm", "loop-soup", "habit-habitat", "hollowphonic"];
const state = (page) => page.locator("#stage").evaluate((c) => JSON.parse(c.dataset.state));
async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, value) => {
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }, String(value));
}
async function ready(page, id) {
  await page.goto(`/${id}.html`);
  await expect(page.locator("#stage")).toHaveAttribute("data-state", /"params"/);
  await expect(page.locator(".instrument-picker")).toHaveAttribute("data-active-tool-id", id);
}
async function arm(page) {
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await state(page)).audio).toBe(true);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
}
async function worldPoint(page, x, y) {
  const box = await page.locator("#stage").boundingBox();
  const scale = Math.min(box.width / 900, box.height / 610);
  return { x: box.x + (box.width - 900 * scale) / 2 + x * scale,
    y: box.y + (box.height - 610 * scale) / 2 + y * scale };
}

for (const id of ids) {
  test(`${id}: explicit Audio, real sound, live presets, pause, mute, and disposal`, async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await ready(page, id);
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await page.locator("#playButton").click();
    await expect.poll(async () => (await state(page)).time).toBeGreaterThan(0.05);
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await expect(page.locator("#liveStatus")).toContainText("Audio is off");
    await arm(page);
    const signal = await sampleAudioEnvelope(page, { durationMs: 1500 });
    expect(signal.summary.finite).toBe(true);
    expect(signal.summary.maxRms).toBeGreaterThan(0.001);
    expect(signal.summary.maxPeak).toBeLessThan(0.9);
    const before = (await state(page)).time;
    await page.locator("#preset").selectOption({ index: 2 });
    await expect.poll(async () => (await state(page)).time).toBeGreaterThan(before);
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#resetButton").click();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await state(page)).audio).toBe(true);
    await page.locator("#playButton").click();
    await page.waitForTimeout(2500);
    expect((await sampleAudioEnvelope(page, { durationMs: 250 })).summary.maxRms).toBeLessThan(0.001);
    await page.locator("#playButton").click();
    await page.locator("#audioButton").click();
    await expect.poll(async () => (await state(page)).audio).toBe(false);
    const mutedAt = (await state(page)).time;
    await page.waitForTimeout(500);
    expect((await state(page)).time).toBeGreaterThan(mutedAt);
    expect((await sampleAudioEnvelope(page, { durationMs: 250 })).summary.maxRms).toBeLessThan(0.0001);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    expect(errors).toEqual([]);
  });
  for (const [name, width, height] of [["desktop", 1440, 900], ["portrait", 390, 844], ["landscape", 844, 390]]) {
    test(`${id}: ${name} reachable layout and accessible controls`, async ({ page }) => {
      await page.setViewportSize({ width, height }); await ready(page, id);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const canvas = await page.locator("#stage").boundingBox();
      expect(canvas.width).toBeGreaterThan(250); expect(canvas.height).toBeGreaterThan(140);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const play = await page.locator("#playButton").boundingBox();
      expect(play.height).toBeGreaterThanOrEqual(48);
      // Last action must be reachable, not trapped below a fixed-height panel.
      const last = page.locator("#instrumentTools button").last();
      await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport();
      await page.locator("#stage").focus();
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await state(page)).selected).toBe(1);
      await page.keyboard.press("Enter");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      const results = await new AxeBuilder({ page }).include(".starting-shell")
        .withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(results.violations.filter((v) => ["critical", "serious"].includes(v.impact))).toEqual([]);
    });
  }
  test(`${id}: guidance explains the sound, limits, and memory; presets have listening notes`, async ({ page }) => {
    await ready(page, id);
    await page.getByRole("link", { name: "How to play / keys", exact: true }).click();
    await expect(page.locator("#howItWorks")).toHaveAttribute("open");
    for (const name of ["Try this first", "What you hear", "The mechanism", "Pause, reset, and memory", "What this demo does not do"]) {
      await expect(page.locator("#howItWorks").getByRole("heading", { name, exact: true })).toBeVisible();
    }
    const firstHint = await page.locator("#presetHint").textContent();
    await page.locator("#preset").selectOption({ index: 2 });
    await expect(page.locator("#presetHint")).not.toHaveText(firstHint);
    const control = page.locator(".starting-controls input[type=range]").first();
    await control.evaluate((el) => {
      el.value = el.min; el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(page.locator("#preset")).toHaveValue("");
    await expect(page.locator("#presetHint")).toContainText("Custom settings");
  });
}

test("Tempo: worklet keeps moving through a stalled UI and recovers from a phase nudge", async ({ page }) => {
  await ready(page, "tempo-tantrum"); await arm(page); await page.locator("#playButton").click();
  await expect.poll(async () => (await state(page)).locked?.every(Boolean), { timeout: 10000 }).toBe(true);
  await page.getByRole("button", { name: "Nudge selected body", exact: true }).click();
  await expect.poll(async () => (await state(page)).locked?.[0]).toBe(false);
  await expect.poll(async () => (await state(page)).locked?.[0], { timeout: 7000 }).toBe(true);
  const before = (await state(page)).time;
  await page.evaluate(() => { const end = performance.now() + 500; while (performance.now() < end) { /* intentional UI stall */ } });
  await expect.poll(async () => (await state(page)).time).toBeGreaterThan(before + 0.45);
  await page.locator("#preset").selectOption("No manners");
  await expect.poll(async () => (await state(page)).locked?.every((x) => !x), { timeout: 6000 }).toBe(true);
});

test("Tape: file decoding installs a real clip, splices and reset preserve it", async ({ page }) => {
  await ready(page, "tape-worm"); await arm(page);
  const rate = 24000, count = rate / 2, bytes = Buffer.alloc(44 + count * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 223 / rate) * 8000), 44 + i * 2);
  page.on("dialog", (d) => d.accept());
  await page.locator("#tapeFile").setInputFiles({ name: "test-tone.wav", mimeType: "audio/wav", buffer: bytes });
  await expect(page.locator("#liveStatus")).toContainText("loaded");
  await page.locator("#playButton").click();
  await expect.poll(async () => (await state(page)).transitions).toBeGreaterThan(0);
  await page.locator("#resetButton").click();
  expect((await sampleAudioEnvelope(page, { durationMs: 600 })).summary.maxRms).toBeGreaterThan(0.005);
});

test("Habit: Teach and Recall produce different state ownership; saved memory round-trips", async ({ page }) => {
  await ready(page, "habit-habitat");
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Forget all routes", exact: true }).click();
  await page.getByRole("button", { name: "Switch to Teach", exact: true }).click();
  await expect.poll(async () => (await state(page)).mode).toBe("teach");
  await page.locator("#stage").focus();
  for (const key of ["1", "4", "2", "1", "4"]) await page.keyboard.press(key);
  const learned = (await state(page)).weights;
  expect(learned[0][3]).toBeGreaterThan(0.25);
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await page.getByRole("button", { name: "Switch to Recall", exact: true }).click();
  await arm(page); await page.locator("#playButton").click(); await page.waitForTimeout(1200);
  expect((await state(page)).weights).toEqual(learned);
  await page.getByRole("button", { name: "Forget all routes", exact: true }).click();
  await page.getByRole("button", { name: "Recall saved memory", exact: true }).click();
  await expect.poll(async () => (await state(page)).weights).toEqual(learned);
});

test("Soup: Hold freezes contents while overdub accepts input", async ({ page }) => {
  await ready(page, "loop-soup"); await arm(page); await page.locator("#playButton").click();
  await page.getByRole("button", { name: "Hold selected tape", exact: true }).click();
  await expect(page.locator("#modelStatus")).toContainText("hold");
  const before = (await state(page)).energy[0];
  await page.waitForTimeout(1100);
  expect((await state(page)).energy[0]).toBeCloseTo(before, 6);
  await page.getByRole("button", { name: "Resume overdub", exact: true }).click();
  await page.waitForTimeout(1100);
  expect((await state(page)).energy[0]).not.toBeCloseTo(before, 6);
});

test("microphone is explicit, cancellation stops late tracks, active Audio Off stops tracks", async ({ page }) => {
  await page.addInitScript(() => {
    window.__micTest = { calls: 0, resolve: null, stream: null };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: () => {
      window.__micTest.calls++;
      return new Promise((resolve) => { window.__micTest.resolve = resolve; });
    } });
  });
  await ready(page, "loop-soup"); await page.locator("#playButton").click();
  expect(await page.evaluate(() => window.__micTest.calls)).toBe(0);
  await arm(page);
  await page.getByRole("button", { name: "Enable microphone", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__micTest.calls)).toBe(1);
  await page.getByRole("button", { name: "Cancel microphone request", exact: true }).click();
  await page.evaluate(() => {
    const ctx = new AudioContext(); window.__micTest.context = ctx;
    const destination = ctx.createMediaStreamDestination(); window.__micTest.stream = destination.stream;
    window.__micTest.resolve(destination.stream);
  });
  await expect.poll(() => page.evaluate(() => window.__micTest.stream.getTracks()[0].readyState)).toBe("ended");
  await page.getByRole("button", { name: "Enable microphone", exact: true }).click();
  await page.evaluate(() => {
    const destination = window.__micTest.context.createMediaStreamDestination();
    window.__micTest.stream = destination.stream; window.__micTest.resolve(destination.stream);
  });
  await expect(page.getByRole("button", { name: "Disable microphone", exact: true })).toBeVisible();
  await page.locator("#audioButton").click();
  await expect.poll(() => page.evaluate(() => window.__micTest.stream.getTracks()[0].readyState)).toBe("ended");
  await page.evaluate(() => window.__micTest.context.close());
});

test("note input gestures work without advertising fabricated MIDI output", async ({ page }) => {
  await ready(page, "habit-habitat");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("morphazoid:midi-input", {
    cancelable: true, detail: { routeId: "habit-habitat", message: { type: "noteOn", note: 64, velocity: 100 } },
  })));
  await expect.poll(async () => (await state(page)).selected).toBe(4);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("recording uses the real worklet input, completes, and releases its microphone", async ({ page }) => {
  await page.addInitScript(() => {
    window.__capture = { calls: 0 };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      window.__capture.calls++;
      const context = new AudioContext(), destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = 233; gain.gain.value = 0.22;
      oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
      Object.assign(window.__capture, { context, oscillator, stream: destination.stream });
      return destination.stream;
    } });
  });
  await ready(page, "tape-worm"); await arm(page);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Record selected tape", exact: true }).click();
  await expect.poll(async () => (await state(page)).recording).toBe(true);
  await page.waitForTimeout(450);
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await expect.poll(async () => (await state(page)).recording).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__capture.stream.getTracks()[0].readyState)).toBe("ended");
  await page.getByRole("button", { name: "Splices on", exact: true }).click();
  await page.getByRole("button", { name: "Reader to start", exact: true }).click();
  await page.locator("#playButton").click();
  expect((await sampleAudioEnvelope(page, { durationMs: 600 })).summary.maxRms).toBeGreaterThan(0.005);
  await page.evaluate(() => { window.__capture.oscillator.stop(); return window.__capture.context.close(); });
});

test("direct stage drags change phase, splice positions, and cavity depth without arming Audio", async ({ page }) => {
  await ready(page, "tempo-tantrum");
  let p = await worldPoint(page, 505, 240);
  let q = await worldPoint(page, 567, 351);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 8 }); await page.mouse.up();
  expect((await state(page)).phases[0]).not.toBeCloseTo(0.11, 2);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);

  await ready(page, "tape-worm");
  const a = 0.72 * Math.PI * 2 - Math.PI / 2;
  p = await worldPoint(page, 250 + 132 * Math.cos(a), 310 + 132 * Math.sin(a));
  q = await worldPoint(page, 382, 310);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await state(page)).params.departure).toBeCloseTo(0.25, 2);

  await ready(page, "hollowphonic");
  const before = await page.locator("#modelStatus").textContent();
  p = await worldPoint(page, 220, 200); q = await worldPoint(page, 220, 320);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 8 }); await page.mouse.up();
  await expect(page.locator("#modelStatus")).not.toHaveText(before);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("rapid Audio cancellation cannot revive an older start or duplicate connections", async ({ page }) => {
  await ready(page, "tempo-tantrum");
  await page.route("**/starting-instruments/processor.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.locator("#audioButton").evaluate((b) => { b.click(); b.click(); b.click(); });
  await expect.poll(async () => (await state(page)).audio).toBe(true);
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
  await page.waitForTimeout(500);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioError")).toBeHidden();
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await state(page)).audio).toBe(false);
});

test("coarse-pointer drag capture is released on cancellation and the page still scrolls", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/tempo-tantrum.html`);
    await expect(page.locator("#stage")).toHaveAttribute("data-state", /"params"/);
    const before = (await state(page)).phases;
    const point = await worldPoint(page, 550, 315);
    await page.touchscreen.tap(point.x, point.y);
    await page.locator("#stage").dispatchEvent("pointercancel", { pointerId: 1, isPrimary: true, pointerType: "touch" });
    await page.getByRole("button", { name: "Nudge selected body", exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Nudge selected body", exact: true }).click();
    expect((await state(page)).phases).not.toEqual(before);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
  } finally { await context.close(); }
});

test("unavailable Web Audio shows a truthful error without claiming Audio is on", async ({ page }) => {
  await page.addInitScript(() => {
    window.AudioContext = undefined; window.webkitAudioContext = undefined;
  });
  await ready(page, "tempo-tantrum");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioError")).toContainText("does not support Web Audio");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await state(page)).audio).toBe(false);
});

test("Soup: pre-arm Hold and erase survive audio initialization; arrows do not erase unless enabled", async ({ page }) => {
  await ready(page, "loop-soup");
  await page.getByRole("button", { name: "Hold selected tape", exact: true }).click();
  await page.locator("#stage").focus();
  const before = (await state(page)).energy[0];
  await page.keyboard.press("ArrowUp");
  expect((await state(page)).energy[0]).toBe(before);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Empty selected bowl", exact: true }).click();
  await expect.poll(async () => (await state(page)).energy[0]).toBe(0);
  await arm(page);
  await expect.poll(async () => (await state(page)).modes[0]).toBe("hold");
  await expect.poll(async () => (await state(page)).energy[0]).toBe(0);
  await page.locator("#playButton").click(); await page.waitForTimeout(1000);
  expect((await state(page)).energy[0]).toBe(0);
  await page.locator("#resetButton").click();
  await expect.poll(async () => (await state(page)).modes[0]).toBe("hold");
});

test("Tape: dragging IN edits arrival, OUT edits departure, and selected recording target is explicit", async ({ page }) => {
  await ready(page, "tape-worm");
  const angle = 0.08 * Math.PI * 2 - Math.PI / 2;
  const p = await worldPoint(page, 250 + 132 * Math.cos(angle), 310 + 132 * Math.sin(angle));
  const q = await worldPoint(page, 382, 310);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await state(page)).params.landing).toBeCloseTo(0.25, 2);
  expect((await state(page)).params.departure).toBe(0.72);
  await page.getByRole("button", { name: "Tape B", exact: true }).click();
  await expect(page.locator("#modelStatus")).toContainText("replace target: Tape B");
  await expect(page.locator("#actionStatus")).toContainText("no graph detection");
  await expect(page.locator("#landingOut")).toHaveText("25%");
});

test("Hollowphonic: silence and disconnected-mic explanations match actual source state", async ({ page }) => {
  await ready(page, "hollowphonic");
  await page.getByRole("button", { name: "Wall bypass off", exact: true }).click();
  await arm(page);
  await expect.poll(async () => (await state(page)).bypass).toBe(true);
  await page.locator("#resetButton").click();
  await expect.poll(async () => (await state(page)).bypass).toBe(false);
  await page.locator("#preset").selectOption("Strike the wall");
  await expect(page.locator("#actionStatus")).toContainText("No continuous source");
  await page.locator("#source").selectOption("3");
  await expect(page.locator("#actionStatus")).toContainText("microphone is off");
  await expect(page.locator("#preset")).toHaveValue("");
});

test("Habit: keyboard-accessible route weakening and reset preserve learned memory", async ({ page }) => {
  await ready(page, "habit-habitat");
  const weight = (await state(page)).weights[0][2];
  await page.locator("#forgetFrom").selectOption("0"); await page.locator("#forgetTo").selectOption("2");
  await page.getByRole("button", { name: "Weaken route", exact: true }).click();
  await expect.poll(async () => (await state(page)).weights[0][2]).toBeLessThan(weight);
  await page.getByRole("button", { name: "Switch to Teach", exact: true }).click();
  const memory = (await state(page)).weights;
  await page.locator("#resetButton").click();
  await expect.poll(async () => (await state(page)).mode).toBe("recall");
  expect((await state(page)).weights).toEqual(memory);
});
