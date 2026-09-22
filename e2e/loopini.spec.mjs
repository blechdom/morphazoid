import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";

const state = (page) => page.locator("#loopini").evaluate((el) => JSON.parse(el.dataset.state));
async function ready(page) {
  await page.goto("/loopini.html");
  await expect(page.locator("#loopini")).toHaveAttribute("data-state", /"slots"/);
  await expect(page.locator(".instrument-picker")).toHaveAttribute("data-active-tool-id", "loopini");
}
async function arm(page) {
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
}
async function fakeMic(page, mode = "normal") {
  await page.addInitScript(({ mode }) => {
    window.__loopiniMic = { calls: 0, stopped: 0, pending: [], contexts: [] };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const data = window.__loopiniMic; data.calls++;
      if (mode === "denied") throw new DOMException("Test denial", "NotAllowedError");
      const context = new AudioContext(), output = context.createMediaStreamDestination(), osc = context.createOscillator(), gain = context.createGain();
      osc.frequency.value = data.frequency ?? 237; gain.gain.value = data.level ?? 0.18; osc.connect(gain).connect(output); osc.start(); await context.resume();
      data.contexts.push(context);
      for (const track of output.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { data.stopped++; stop(); void context.close(); };
      }
      data.stream = output.stream;
      if (mode === "delayed") return new Promise((resolve) => data.pending.push(() => resolve(output.stream)));
      return output.stream;
    } });
  }, { mode });
}
async function firstLoop(page, minimumSeconds = 0.65) {
  await page.locator("#loop0").click();
  await expect.poll(async () => (await state(page)).recording?.id).toBe(0);
  await expect.poll(async () => (await state(page)).recording?.seconds).toBeGreaterThan(minimumSeconds);
  await page.locator("#loop0").click();
  await expect.poll(async () => (await state(page)).slots[0].filled).toBe(true);
  await expect.poll(async () => (await state(page)).mic).toBe(false);
}
async function speed(page, value) {
  await page.locator("#speed").evaluate((field, value) => {
    field.value = String(value); field.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("in-loop red icon replaces a bad take without mixing it, then Undo restores it", async ({ page }) => {
  // Keep the temporary recording/stop state long enough to inspect under CI load.
  await fakeMic(page); await ready(page); await arm(page); await firstLoop(page, 1.5);
  const initial = await state(page);
  const replace = page.getByRole("button", { name: "Replace recording in loop 1", exact: true });
  await expect(replace.locator("svg circle")).toBeVisible();
  await page.evaluate(() => { window.__loopiniMic.frequency = 419; window.__loopiniMic.level = 0.07; });
  await replace.click();
  await expect.poll(async () => (await state(page)).recording?.mode).toBe("replace");
  await expect(page.locator("#again0")).toBeEnabled();
  await expect(page.locator("#add0")).toBeDisabled();
  await expect.poll(async () => (await state(page)).recording?.seconds, { intervals: [25, 50] }).toBeGreaterThan(0.1);
  await expect(page.locator("#again0")).toHaveAccessibleName("Finish replacement recording in loop 1");
  await expect(page.locator("#again0 .loopini-stop-glyph")).toBeVisible();
  expect((await state(page)).slots[0].audible).toBe(false);
  expect((await state(page)).slots[0].waveform).toEqual(initial.slots[0].waveform);
  await expect.poll(async () => (await state(page)).recording).toBeNull();
  await expect.poll(async () => (await state(page)).mic).toBe(false);
  const replacement = await state(page);
  expect(replacement.length).toBe(initial.length);
  expect(replacement.slots.filter((s) => s.filled)).toHaveLength(1);
  expect(replacement.slots[0].waveform).not.toEqual(initial.slots[0].waveform);
  expect(Math.max(...replacement.slots[0].waveform)).toBeLessThan(Math.max(...initial.slots[0].waveform) * 0.6);
  await expect(page.locator("#liveStatus")).toContainText("only your new take");
  await page.locator("#undoButton").click();
  await expect.poll(async () => (await state(page)).slots[0].waveform).toEqual(initial.slots[0].waveform);
  expect((await state(page)).playing).toBe(true);
});

test("same record icon cancels preparation and finishes a replacement early without deleting first", async ({ page }) => {
  await fakeMic(page); await ready(page); await arm(page);
  await page.locator("#demoButton").click();
  await expect.poll(async () => (await state(page)).slots[0].filled).toBe(true);
  const original = (await state(page)).slots[0].waveform;
  await page.locator("#again0").click();
  await expect(page.locator("#again0")).toHaveAccessibleName("Cancel replacement recording in loop 1");
  await page.locator("#again0").click();
  await expect.poll(async () => (await state(page)).recording).toBeNull();
  expect((await state(page)).slots[0].waveform).toEqual(original);
  await expect.poll(async () => (await state(page)).mic).toBe(false);
  await page.locator("#again0").focus(); await page.keyboard.press("Enter");
  await expect.poll(async () => (await state(page)).recording?.seconds, { timeout: 7000 }).toBeGreaterThan(0.65);
  await expect(page.locator("#again0")).toBeEnabled();
  await page.locator("#again0").click();
  await expect.poll(async () => (await state(page)).recording).toBeNull();
  expect((await state(page)).slots[0].waveform).not.toEqual(original);
  expect((await state(page)).slots[0].waveform.slice(-12).every((v) => v === 0)).toBe(true);
  expect((await state(page)).slots.filter((s) => s.filled)).toHaveLength(3);
  await page.locator("#undoButton").click();
  await expect.poll(async () => (await state(page)).slots[0].waveform).toEqual(original);
});

test("record at half speed, return to normal, then overdub the same circle and Undo", async ({ page }) => {
  await fakeMic(page); await ready(page); await arm(page); await firstLoop(page);
  const original = (await state(page)).slots[0].waveform, length = (await state(page)).length;
  await speed(page, 0.5);
  await expect.poll(async () => (await state(page)).speed).toBe(0.5);
  await page.locator("#loop1").click();
  await expect.poll(async () => (await state(page)).recording?.id).toBe(1);
  await expect(page.locator("#speed")).toBeDisabled();
  await expect(page.locator("#normalSpeed")).toBeDisabled();
  await expect.poll(async () => (await state(page)).recording?.seconds).toBeGreaterThan((length / (await state(page)).rate) * 1.15);
  await expect.poll(async () => (await state(page)).slots[1].filled, { timeout: 7000 }).toBe(true);
  expect((await state(page)).length).toBe(length);
  expect((await state(page)).slots[0].waveform).toEqual(original);
  await page.locator("#normalSpeed").click();
  await expect.poll(async () => (await state(page)).speed).toBe(1);
  expect((await state(page)).length).toBe(length);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  const initial = (await state(page)).slots[1].waveform;
  await speed(page, 0.5);
  await page.locator("#add1").click();
  await expect.poll(async () => (await state(page)).recording?.mode).toBe("add");
  await expect.poll(async () => (await state(page)).recording?.seconds).toBeGreaterThan(0.2);
  expect((await state(page)).slots[1].audible).toBe(true);
  expect((await state(page)).slots[1].waveform).toEqual(initial);
  await expect(page.locator("#loop1 .loopini-label")).toHaveText("Adding sound");
  const during = await sampleAudioEnvelope(page, { durationMs: 300 });
  expect(during.summary.maxRms).toBeGreaterThan(0.001);
  await expect.poll(async () => (await state(page)).recording, { timeout: 7000 }).toBeNull();
  await expect.poll(async () => (await state(page)).mic).toBe(false);
  expect((await state(page)).slots.filter((s) => s.filled).length).toBe(2);
  expect((await state(page)).slots[1].waveform).not.toEqual(initial);
  await page.locator("#normalSpeed").click();
  await page.locator("#undoButton").click();
  await expect.poll(async () => (await state(page)).slots[1].waveform).toEqual(initial);
  expect((await state(page)).speed).toBe(1);
  expect((await state(page)).slots[0].waveform).toEqual(original);
  expect(await page.evaluate(() => window.__loopiniMic.stopped)).toBe(3);
});

test("speed knob has real pointer/keyboard control, cancellation and no implicit audio", async ({ page }) => {
  await ready(page);
  await page.locator("#speed").focus(); await page.keyboard.press("Home");
  await expect(page.locator("#speed")).toHaveValue("0.5");
  await expect(page.locator("#speedOut")).toHaveText("0.50×");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.keyboard.press("End"); await expect(page.locator("#speed")).toHaveValue("2");
  await page.locator("#normalSpeed").click(); await expect(page.locator("#speed")).toHaveValue("1");
  const box = await page.locator("#speed").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y - 55, { steps: 8 });
  expect(Number(await page.locator("#speed").inputValue())).toBeGreaterThan(1.5);
  await page.locator("#speed").dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up(); await expect(page.locator("#speed")).toHaveValue("1");
  await speed(page, 0.5);
  await arm(page); await page.locator("#demoButton").click();
  await expect.poll(async () => (await state(page)).speed).toBe(0.5);
  await expect.poll(async () => (await state(page)).turnSeconds).toBe(6);
  await page.locator("#normalSpeed").click();
  await expect.poll(async () => (await state(page)).turnSeconds).toBe(3);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
});

test("cancel Add sound or deny its permission without changing existing loops", async ({ page }) => {
  await fakeMic(page, "delayed"); await ready(page); await arm(page);
  await page.locator("#demoButton").click();
  await expect.poll(async () => (await state(page)).slots[0].filled).toBe(true);
  const before = (await state(page)).slots[0].waveform;
  await page.locator("#add0").click();
  await expect.poll(async () => page.evaluate(() => window.__loopiniMic.calls)).toBe(1);
  await expect(page.locator("#speed")).toBeDisabled();
  await page.locator("#loop0").click();
  await page.evaluate(() => window.__loopiniMic.pending.shift()());
  await expect.poll(async () => page.evaluate(() => window.__loopiniMic.stopped)).toBe(1);
  expect((await state(page)).slots[0].waveform).toEqual(before);
  await expect(page.locator("#speed")).toBeEnabled();
  await page.evaluate(() => Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    configurable: true, value: async () => { throw new DOMException("Denied", "NotAllowedError"); },
  }));
  await page.locator("#add0").click();
  await expect(page.locator("#audioError")).toContainText("wasn't allowed");
  expect((await state(page)).slots[0].waveform).toEqual(before);
  expect((await state(page)).recording).toBeNull();
});

test("Play cancels an unfinished first take and releases the speed knob and microphone", async ({ page }) => {
  await fakeMic(page); await ready(page); await arm(page); await speed(page, 0.5);
  await page.locator("#loop0").click();
  await expect.poll(async () => (await state(page)).recording?.id).toBe(0);
  await page.locator("#playButton").click();
  await expect.poll(async () => (await state(page)).recording).toBeNull();
  await expect.poll(async () => (await state(page)).mic).toBe(false);
  await expect(page.locator("#speed")).toBeEnabled();
  expect((await state(page)).slots[0].filled).toBe(false);
  expect((await state(page)).speed).toBe(0.5);
});

test("simple first recording, automatic synchronized layer and one-tap live mixing without song controls", async ({ page }) => {
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await fakeMic(page); await ready(page);
  await expect(page.locator(".loopini-pad")).toHaveCount(6);
  await page.locator("#loop0").click();
  expect(await page.evaluate(() => window.__loopiniMic.calls)).toBe(0);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await expect(page.locator("#liveStatus")).toContainText("Audio is off");
  await arm(page); await firstLoop(page);
  const length = (await state(page)).length;
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  expect((await sampleAudioEnvelope(page, { durationMs: 500 })).summary.maxRms).toBeGreaterThan(0.005);
  await page.locator("#loop1").click();
  await expect.poll(async () => (await state(page)).recording?.id).toBe(1);
  await expect.poll(async () => (await state(page)).slots[1].filled, { timeout: 7000 }).toBe(true);
  expect((await state(page)).length).toBe(length);
  await expect.poll(async () => page.evaluate(() => window.__loopiniMic.stopped)).toBe(2);
  await page.locator("#loop0").click(); await page.locator("#loop1").click(); await page.waitForTimeout(200);
  expect((await sampleAudioEnvelope(page, { durationMs: 250 })).summary.maxRms).toBeLessThan(0.0001);
  await page.locator("#loop0").click(); await page.locator("#loop1").click();
  await expect(page.locator("#makeSong, #saveSong, #songProgress")).toHaveCount(0);
  expect("song" in await state(page)).toBe(false);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("permission denial leaves circles untouched and the demo works without a microphone", async ({ page }) => {
  await fakeMic(page, "denied"); await ready(page); await arm(page);
  await page.locator("#loop0").click();
  await expect(page.locator("#audioError")).toContainText("wasn't allowed");
  expect((await state(page)).slots.every((s) => !s.filled)).toBe(true);
  await page.locator("#demoButton").click();
  await expect.poll(async () => (await state(page)).slots.filter((s) => s.filled).length).toBe(3);
  expect((await sampleAudioEnvelope(page, { durationMs: 800 })).summary.maxRms).toBeGreaterThan(0.001);
  expect(await page.evaluate(() => window.__loopiniMic.calls)).toBe(1);
});

test("cancelled late permission and rapid audio-off requests stop tracks without installing recordings", async ({ page }) => {
  await fakeMic(page, "delayed"); await ready(page); await arm(page);
  await page.locator("#loop0").click();
  await expect.poll(async () => page.evaluate(() => window.__loopiniMic.calls)).toBe(1);
  await page.locator("#loop0").click();
  await page.evaluate(() => window.__loopiniMic.pending.shift()());
  await expect.poll(async () => page.evaluate(() => window.__loopiniMic.stopped)).toBe(1);
  expect((await state(page)).recording).toBeNull();
  await page.locator("#loop1").click();
  await expect.poll(async () => page.evaluate(() => window.__loopiniMic.calls)).toBe(2);
  await page.locator("#audioButton").click();
  await page.evaluate(() => window.__loopiniMic.pending.shift()());
  await expect.poll(async () => page.evaluate(() => window.__loopiniMic.stopped)).toBe(2);
  expect((await state(page)).slots.every((s) => !s.filled)).toBe(true);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("redo cancellation, removal, reset confirmation and Undo preserve the child's sounds", async ({ page }) => {
  await fakeMic(page); await ready(page); await arm(page); await firstLoop(page);
  const initial = (await state(page)).slots[0].waveform;
  await page.locator("#again0").click();
  await expect.poll(async () => (await state(page)).recording?.id).toBe(0);
  await page.locator("#playButton").click();
  await expect.poll(async () => (await state(page)).recording).toBeNull();
  expect((await state(page)).slots[0].waveform).toEqual(initial);
  await page.locator("#remove0").click(); await expect(page.locator("#loop0")).toHaveAttribute("aria-label", "Record loop 1");
  await page.locator("#undoButton").click();
  await expect.poll(async () => (await state(page)).slots[0].filled).toBe(true);
  await page.locator("#resetButton").click();
  await page.getByRole("button", { name: "Keep my sounds", exact: true }).click();
  expect((await state(page)).slots[0].filled).toBe(true);
  await page.locator("#resetButton").click();
  await page.locator("#resetDialog").getByRole("button", { name: "Start over", exact: true }).click();
  await expect.poll(async () => (await state(page)).slots[0].filled).toBe(false);
  await page.locator("#undoButton").click();
  await expect.poll(async () => (await state(page)).slots[0].filled).toBe(true);
  expect((await state(page)).slots[0].waveform).toEqual(initial);
  await page.locator("#resetButton").click(); await page.keyboard.press("Escape");
  expect((await state(page)).slots[0].filled).toBe(true);
});

test("Audio mute retains phase; hidden page cancels mic, pauses and retains recordings", async ({ page }) => {
  await fakeMic(page); await ready(page); await arm(page); await firstLoop(page);
  await page.locator("#audioButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(200);
  expect((await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxRms).toBeLessThan(0.0001);
  await arm(page);
  await page.locator("#loop1").click(); await expect.poll(async () => (await state(page)).recording?.id).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  await expect.poll(async () => page.evaluate(() => window.__loopiniMic.stopped)).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await arm(page);
  await expect.poll(async () => (await state(page)).playing).toBe(false);
  expect((await state(page)).slots[0].filled).toBe(true);
  expect((await state(page)).slots[1].filled).toBe(false);
  await page.locator("#playButton").click();
  expect((await sampleAudioEnvelope(page, { durationMs: 400 })).summary.maxRms).toBeGreaterThan(0.001);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
});

for (const [name, width, height] of [["desktop", 1440, 900], ["phone", 390, 844], ["landscape", 844, 390]]) {
  test(`${name}: large reachable controls, keyboard and uncluttered accessible layout`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const pad of await page.locator(".loopini-pad").all()) {
      const box = await pad.boundingBox(); expect(box.width).toBeGreaterThan(120); expect(box.height).toBeGreaterThan(120);
    }
    await arm(page); await page.locator("#demoButton").click();
    await expect.poll(async () => (await state(page)).slots[0].filled).toBe(true);
    await page.locator("h1").click(); await page.keyboard.press("1");
    await expect.poll(async () => (await state(page)).slots[0].on).toBe(false);
    for (const id of ["add0", "again0", "remove0", "speed", "normalSpeed"]) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await expect(page.locator(`#${id}`)).toBeInViewport();
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    const controls = await page.locator(".loopini-slot-tools:not([hidden]) button").evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect(), disc = button.closest(".loopini-disc").getBoundingClientRect();
      return { id: button.id, inside: box.x >= disc.x && box.y >= disc.y && box.right <= disc.right && box.bottom <= disc.bottom,
        nested: Boolean(button.parentElement.closest("button")), text: button.textContent.trim(),
        title: button.title, width: box.width, height: box.height };
    }));
    for (const button of controls) {
      expect(button.inside, button.id).toBe(true); expect(button.nested, button.id).toBe(false);
      expect(button.text, button.id).toBe(""); expect(button.title, button.id).toBeTruthy();
      expect(button.width, button.id).toBeGreaterThanOrEqual(36); expect(button.height, button.id).toBeGreaterThanOrEqual(36);
    }
    await expect(page.locator("#infoButton, #infoDialog, .loopini-private, #loopHint")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("of 6 sounds");
    await expect(page.locator("body")).not.toContainText("seconds a turn");
    await page.locator("#playButton").click();
    await expect(page.locator("#nextStep")).toHaveText("");
    await expect(page.locator("#nextStep")).toBeHidden();
    await expect(page.locator("#liveStatus")).toHaveText("");
    await expect(page.locator("body")).not.toContainText("Take a little break.");
    await expect(page.locator("body")).not.toContainText("Your sounds are still here. Tap Play loops to continue.");
    await expect(page.locator("body")).not.toContainText("Just play.");
    await page.locator("#playButton").click();
    await expect(page.locator("#nextStep")).toBeVisible();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#resetButton").scrollIntoViewIfNeeded(); await expect(page.locator("#resetButton")).toBeInViewport();
    const a11y = await new AxeBuilder({ page }).include(".loopini-shell").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(a11y.violations.filter((v) => ["serious", "critical"].includes(v.impact))).toEqual([]);
  });
}

test("coarse touch targets and MIDI do not request microphone or arm Audio", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/loopini.html`); await expect(page.locator("#loopini")).toHaveAttribute("data-state", /"slots"/);
    for (const id of ["audioButton", "playButton"]) {
      const box = await page.locator(`#${id}`).boundingBox(); expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
    }
    await page.locator("#loop0").tap(); expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await page.locator("#speed").scrollIntoViewIfNeeded();
    const knob = await page.locator("#speed").boundingBox(), cdp = await context.newCDPSession(page);
    const x = knob.x + knob.width / 2, y = knob.y + knob.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - 45 }] });
    expect(Number(await page.locator("#speed").inputValue())).toBeGreaterThan(1);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect(page.locator("#speed")).toHaveValue("1");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("morphazoid:midi-input", { cancelable: true, detail: { message: { type: "noteOn", note: 60, velocity: 100 } } })));
    expect((await state(page)).mic).toBe(false); expect((await state(page)).recording).toBeNull();
  } finally { await context.close(); }
});

test("touch replacement icon records a new take while the big circle still only toggles sound", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL });
  const page = await context.newPage();
  try {
    await fakeMic(page); await ready(page); await arm(page); await firstLoop(page);
    const original = (await state(page)).slots[0].waveform;
    await page.locator("#loop0").tap();
    await expect.poll(async () => (await state(page)).slots[0].on).toBe(false);
    expect(await page.evaluate(() => window.__loopiniMic.calls)).toBe(1);
    await page.evaluate(() => { window.__loopiniMic.frequency = 523; window.__loopiniMic.level = 0.06; });
    await page.locator("#again0").tap();
    await expect.poll(async () => (await state(page)).recording?.mode).toBe("replace");
    await expect.poll(async () => (await state(page)).recording).toBeNull();
    expect((await state(page)).slots[0].waveform).not.toEqual(original);
    expect((await state(page)).slots[0].on).toBe(true);
    await page.locator("#remove0").tap();
    await expect.poll(async () => (await state(page)).slots[0].filled).toBe(false);
    await expect(page.locator(".loopini-slot-tools").first()).toBeHidden();
    await page.locator("#undoButton").tap();
    await expect.poll(async () => (await state(page)).slots[0].filled).toBe(true);
  } finally { await context.close(); }
});
