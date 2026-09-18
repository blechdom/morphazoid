import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";

// Tape Worm / Loop Soup now have dedicated network coverage in loop-network.spec.mjs.
const ids = ["tempo-tantrum", "habit-habitat", "hollowphonic"];
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

test("note input gestures work without advertising fabricated MIDI output", async ({ page }) => {
  await ready(page, "habit-habitat");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("morphazoid:midi-input", {
    cancelable: true, detail: { routeId: "habit-habitat", message: { type: "noteOn", note: 64, velocity: 100 } },
  })));
  await expect.poll(async () => (await state(page)).selected).toBe(4);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("direct stage drags change phase and cavity depth without arming Audio", async ({ page }) => {
  await ready(page, "tempo-tantrum");
  let p = await worldPoint(page, 505, 240);
  let q = await worldPoint(page, 567, 351);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 8 }); await page.mouse.up();
  expect((await state(page)).phases[0]).not.toBeCloseTo(0.11, 2);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);

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
