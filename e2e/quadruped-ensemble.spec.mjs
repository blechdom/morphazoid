import { test, expect } from "@playwright/test";
import { QUADRUPED_ANIMALS } from "../src/quadruped.js";
import { quadrupedCalls } from "../src/quadruped-voices.js";

test("Quadruped frog has editable calls and an audio-clock-driven vocal gesture", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/quadruped.html");
  for (const animal of QUADRUPED_ANIMALS) {
    await page.locator(`[data-animal-id="${animal.id}"]`).click();
    for (const call of quadrupedCalls(animal.id)) await expect(page.getByRole("rowheader", { name: call.label, exact: true })).toBeVisible();
  }
  await page.locator('[data-behavior-id="jump"]').click();
  await page.locator("#callPhraseButton").click();
  await expect(page.locator('[data-call-row="0"][data-step="0"]')).toHaveAttribute("aria-pressed", "mixed");
  await page.locator('[data-call-row="1"][data-step="6"]').click();
  await expect(page.locator('[data-call-row="1"][data-step="6"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-call-row="1"][data-step="6"]').press("Delete");
  await expect(page.locator('[data-call-row="1"][data-step="6"]')).toHaveAttribute("aria-pressed", "false");
  // Every first pointer click after focus must edit, not merely select a card.
  for (const step of [1, 2, 3, 4, 5, 7]) {
    const cell = page.locator(`[data-call-row="1"][data-step="${step}"]`);
    await cell.click();
    await expect(cell).toHaveAttribute("aria-pressed", "mixed");
  }
  await page.locator("#playButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-call-strength"))).toBeGreaterThan(0.1);
  await page.locator("#audioButton").click();
  await expect.poll(async () => page.evaluate(async () => (await import("./src/audio-output-manager.js")).getSharedAudioOutputManager().getStatus().rms)).toBeGreaterThan(0.0002);
  await page.locator("#clearCallsButton").click();
  await expect(page.locator(".quadruped-call-row [aria-pressed='false']")).toHaveCount(48);
  await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-call-strength"))).toBe(0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("Quadruped trio shares immediate BPM while each animal owns its own score", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/quadruped.html");
  await page.locator('[data-group-mode="trio"]').click();
  await page.locator("#playButton").click();
  await expect(page.locator("#stage")).toHaveAttribute("data-actor-count", "3");
  const positions = () => page.locator("#stage").evaluate(el => JSON.parse(el.dataset.actorPositions));
  const before = await positions();
  await expect.poll(async () => (await positions()).every((p, index) => p > before[index] + 2)).toBe(true);
  await page.locator("#callPhraseButton").click();
  await page.locator('[data-actor-index="1"]').click();
  await expect(page.locator(".quadruped-call-row [aria-pressed='false']")).toHaveCount(48);
  await page.locator('[data-animal-id="frog"]').click();
  await page.locator('[data-behavior-id="walk-leap"]').click();
  await page.locator("#suspensionBeats").fill("4");
  await page.locator("#tempo").fill("180");
  await expect(page.locator("#stage")).toHaveAttribute("data-actor-tempos", "[180,180,180]");
  await page.locator('[data-actor-index="0"]').click();
  await expect(page.locator(".quadruped-call-row [aria-pressed='mixed']")).toHaveCount(3);
  await expect(page.locator("#behaviorReadout")).toHaveText("Walk");
  await page.locator("#scatterButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#audioButton").click();
  await page.locator("#terrain").selectOption("wood");
  await page.locator("#groundProfile").selectOption("stairs-down");
  await page.locator("#grain").fill("1");
  await page.locator("#newGrainButton").click();
  await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-stair-level"))).toBeLessThan(0);
  await page.locator('[data-group-mode="solo"]').click();
  await expect(page.locator("#stage")).toHaveAttribute("data-actor-count", "1");
  await page.locator("#audioButton").click();
  expect(errors).toEqual([]);
});

test("Quadruped renders every bonus voice in isolation with finite output and release", async ({ page }) => {
  await page.goto("/quadruped.html");
  const report = await page.evaluate(async () => {
    const source = await (await fetch("./quadruped-app.js")).text();
    const { QUADRUPED_CALLS } = await import("./src/quadruped-voices.js");
    const names = ["createPanner", "midiToFrequency", "scheduleTone", "schedulePitchContour", "scheduleCall"];
    const functions = names.map(name => {
      const match = source.match(new RegExp("function " + name + "\\([^]*?\\n\\}(?=\\r?\\n)"));
      if (!match) throw new Error("Missing synth primitive " + name);
      return match[0];
    }).join("\n");
    const render = new Function("graph", "call", `
      const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, Number(x) || 0));
      const selectedActor = 0, groupMode = "solo";
      const registerAudioSource = () => {};
      ${functions}
      scheduleCall(call, 0.02, 0);
    `);
    const report = [];
    for (const [animal, calls] of Object.entries(QUADRUPED_CALLS)) for (const voice of calls) {
      const context = new OfflineAudioContext(2, 96000, 48000);
      const mixBus = context.createGain(); mixBus.connect(context.destination);
      render({ context, mixBus }, { ...voice, duration: voice.beats * 60 / 96, intensity: 1 });
      const buffer = await context.startRendering();
      const data = buffer.getChannelData(0);
      let peak = 0, energy = 0, tail = 0, crossings = 0;
      for (let i = 0; i < data.length; i += 1) {
        if (!Number.isFinite(data[i])) throw new Error("Non-finite " + animal + voice.label);
        peak = Math.max(peak, Math.abs(data[i])); energy += data[i] ** 2;
        if (i > data.length - 2400) tail = Math.max(tail, Math.abs(data[i]));
        if (i && data[i - 1] < 0 && data[i] >= 0) crossings += 1;
      }
      report.push({ animal, voice: voice.label, peak, rms: Math.sqrt(energy / data.length), tail, crossings });
    }
    return report;
  });
  expect(report).toHaveLength(45);
  for (const voice of report) {
    expect(voice.rms, voice.animal + " " + voice.voice).toBeGreaterThan(0.0001);
    expect(voice.peak).toBeLessThan(1);
    expect(voice.tail).toBeLessThan(0.00001);
  }
  for (const animal of QUADRUPED_ANIMALS) expect(new Set(report.filter(row => row.animal === animal.id).map(row => row.rms.toFixed(5) + ":" + row.crossings)).size).toBe(3);
  await test.info().attach("call-render-metrics", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
});

test("Quadruped dense trio remains bounded and releases its audio graph", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/quadruped.html");
  await page.locator('[data-group-mode="trio"]').click();
  for (let actor = 0; actor < 3; actor += 1) {
    await page.locator(`[data-actor-index="${actor}"]`).click();
    await page.locator("#callPhraseButton").click();
    await page.locator('[data-behavior-id="drunk"]').click();
  }
  await page.locator("#tempo").fill("196");
  await page.locator('[data-pace-ratio="3"]').click();
  await page.locator("#level").fill("0.72");
  await page.locator("#audioButton").click();
  await page.locator("#playButton").click();
  const levels = await page.evaluate(async () => {
    const manager = (await import("./src/audio-output-manager.js")).getSharedAudioOutputManager();
    const result = [];
    for (let i = 0; i < 20; i += 1) { await new Promise(resolve => setTimeout(resolve, 100)); result.push(manager.getStatus()); }
    return result;
  });
  expect(levels.some(level => level.rms > 0.0002)).toBe(true);
  expect(levels.every(level => Number.isFinite(level.rms) && Number.isFinite(level.peak) && !level.clipped && level.connectionCount === 1)).toBe(true);
  await page.locator("#audioButton").click();
  await expect.poll(async () => page.evaluate(async () => (await import("./src/audio-output-manager.js")).getSharedAudioOutputManager().getStatus().connectionCount)).toBe(0);
  expect(errors).toEqual([]);
});
