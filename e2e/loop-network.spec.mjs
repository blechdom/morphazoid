import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
const state = (p) => p.locator("#stage").evaluate((e) => JSON.parse(e.dataset.state));
const node = (p, label) => p.locator(".network-loop").filter({ has: p.getByRole("button", { name: `Move or select loop ${label}`, exact: true }) });
async function ready(p, id) {
  await p.goto(`/${id}.html`);
  await expect(p.locator("#stage")).toHaveAttribute("data-state", /"networkVersion":1/);
  await expect(p.locator(".instrument-picker")).toHaveAttribute("data-active-tool-id", id);
}
async function arm(p) {
  await p.locator("#audioButton").click();
  await expect(p.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(p)).connectionCount).toBe(1);
}
async function range(p, id, v) {
  await p.locator(`#${id}`).evaluate((e, v) => { e.value = String(v); e.dispatchEvent(new Event("input", { bubbles: true })); }, v);
}
async function attach(p, from, to) {
  await p.locator("#routeFrom").selectOption(from); await p.locator("#routeTo").selectOption(to); await p.locator("#attachRoute").click();
}
const sampleWav = () => {
  const rate = 24000, count = 12000, bytes = Buffer.alloc(44 + count * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 233 / rate) * 7000), 44 + i * 2);
  return { name: "loop.wav", mimeType: "audio/wav", buffer: bytes };
};
async function fakeMic(p, delayed = false) {
  await p.addInitScript(({ delayed }) => {
    window.__networkMic = { calls: 0, stopped: 0, pending: [], contexts: [] };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const data = window.__networkMic; data.calls++;
      const context = new AudioContext(), output = context.createMediaStreamDestination(), osc = context.createOscillator(), gain = context.createGain();
      osc.frequency.value = 233; gain.gain.value = 0.2; osc.connect(gain).connect(output); osc.start(); await context.resume();
      data.contexts.push(context);
      for (const track of output.stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { data.stopped++; stop(); }; }
      data.stream = output.stream;
      if (delayed) return new Promise((resolve) => data.pending.push(() => resolve(output.stream)));
      return output.stream;
    } });
  }, { delayed });
}

for (const id of ["tape-worm", "loop-soup"]) {
  const initial = id === "tape-worm" ? 2 : 3;
  test(`${id}: loop center controls, audio separation, real playback, pause/mute and cleanup`, async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await ready(page, id); await expect(page.locator(".network-loop")).toHaveCount(initial);
    for (const action of ["Record", "Play", "Mute", "Solo"]) await expect(node(page, "A").getByRole("button", { name: `${action} loop A`, exact: true })).toBeVisible();
    await page.locator("#playButton").click(); await page.waitForTimeout(100);
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await expect(page.locator("#liveStatus")).toContainText("Audio is off");
    await arm(page);
    expect((await sampleAudioEnvelope(page, { durationMs: 1100 })).summary.maxRms).toBeGreaterThan(0.001);
    const before = (await state(page)).time;
    await page.locator("#preset").selectOption({ index: 2 });
    await expect.poll(async () => (await state(page)).time).toBeGreaterThan(before);
    await node(page, "A").getByRole("button", { name: "Mute loop A", exact: true }).click();
    await expect.poll(async () => (await state(page)).loops[0].muted).toBe(true);
    await node(page, "A").getByRole("button", { name: "Solo loop A", exact: true }).click();
    await expect.poll(async () => (await state(page)).loops[0].solo).toBe(true);
    await page.locator("#resetButton").click();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#audioButton").click();
    await page.waitForTimeout(250);
    expect((await sampleAudioEnvelope(page, { durationMs: 200 })).summary.maxRms).toBeLessThan(1e-5);
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    expect(errors).toEqual([]);
  });
  test(`${id}: opaque center and compact familiar transport glyphs retain real controls`, async ({ page }) => {
    await ready(page, id);
    const a = node(page, "A");
    await expect(a.locator(".loop-rim")).toHaveCSS("fill", "rgb(11, 14, 17)");
    await expect(a.locator(".loop-rim")).toHaveCSS("opacity", "1");
    await expect(a.locator(".loop-center")).toHaveCSS("background-color", "rgb(11, 14, 17)");
    await expect(a.locator(".loop-transport > button")).toHaveCount(4);
    await expect(a.locator(".loop-transport")).toHaveCSS("border-top-width", "0px");
    await expect(a.locator(".loop-transport")).toHaveCSS("padding-top", "0px");
    for (const b of await a.locator(".loop-icon-button").all()) {
      const box = await b.boundingBox();
      expect(box.width).toBe(28); expect(box.height).toBe(28);
      expect(await b.getAttribute("title")).toBeTruthy();
      expect(await b.getAttribute("aria-label")).toBeTruthy();
      await expect(b.locator(".loop-button-face")).toHaveAttribute("aria-hidden", "true");
    }
    await expect(a.locator(".loop-mute .loop-button-face")).toHaveText("M");
    await expect(a.locator(".loop-solo .loop-button-face")).toHaveText("S");
    await expect(a.locator(".loop-record")).toHaveAttribute("data-glyph", "record");
    await expect(a.locator(".loop-record .loop-button-face svg circle")).toHaveCSS("fill", "rgb(255, 99, 121)");
    await expect(a.locator(".loop-play")).toHaveAttribute("data-glyph", "play");
    // The initial triangle starts transport, but cannot arm Audio.
    await a.getByRole("button", { name: "Play loop A", exact: true }).click();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await expect(a.locator(".loop-play")).toHaveAttribute("data-glyph", "pause");
    await expect(a.locator(".loop-play")).toHaveAttribute("title", "Pause loop A");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await a.getByRole("button", { name: "Pause loop A", exact: true }).click();
    await expect.poll(async () => (await state(page)).loops[0].paused).toBe(true);
    await expect(a.locator(".loop-play")).toHaveAttribute("data-glyph", "play");
    await a.getByRole("button", { name: "Resume loop A", exact: true }).click();
    await expect.poll(async () => (await state(page)).loops[0].paused).toBe(false);
    // Muting may dim the waveform, but must never expose the grid/routes through the disc.
    await a.getByRole("button", { name: "Mute loop A", exact: true }).click();
    await expect(a.locator(".loop-wave")).toHaveCSS("opacity", "1");
    await expect(a.locator(".loop-rim")).toHaveCSS("opacity", "1");
    await expect(a.locator(".loop-rim")).toHaveCSS("fill", "rgb(11, 14, 17)");
    await expect(a.locator(".loop-mute")).toHaveAttribute("title", "Unmute loop A");
  });
  test(`${id}: add/remove during playback, stable letters, center dragging and live attachment`, async ({ page }) => {
    await ready(page, id); await arm(page); await page.locator("#playButton").click();
    const original = await state(page);
    await page.locator("#addLoop").click();
    await expect(page.locator(".network-loop")).toHaveCount(initial + 1);
    const added = (await state(page)).loops.at(-1);
    expect(added.name).toBe("Empty tape");
    await expect.poll(async () => (await state(page)).selectedLoopId).toBe(added.id);
    // Move a loop through its actual native drag handle; audio remains live.
    const move = node(page, added.label).getByRole("button", { name: `Move or select loop ${added.label}`, exact: true });
    await move.scrollIntoViewIfNeeded(); const box = await move.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 90, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await state(page)).loops.at(-1).y).toBeGreaterThan(added.y + 60);
    await attach(page, original.loops[0].id, added.id);
    await expect.poll(async () => (await state(page)).routes.some((r) => r.from === original.loops[0].id && r.to === added.id)).toBe(true);
    const addedRouteId = (await state(page)).routes.find((r) => r.from === original.loops[0].id && r.to === added.id).id;
    await page.locator("#routeEnable").click();
    await expect.poll(async () => (await state(page)).routes.find((r) => r.id === addedRouteId)?.enabled).toBe(false);
    await page.locator("#detachRoute").click();
    await expect.poll(async () => (await state(page)).routes.some((r) => r.from === original.loops[0].id && r.to === added.id)).toBe(false);
    page.on("dialog", (d) => d.accept()); await page.locator("#removeLoop").click();
    await expect(page.locator(".network-loop")).toHaveCount(initial);
    const after = await state(page);
    expect(after.loops.map((l) => l.id)).toEqual(original.loops.map((l) => l.id));
    expect(after.playing).toBe(true); expect(after.audio).toBe(true);
    expect((await readAudioStatus(page)).clipped).toBe(false);
  });
  test(`${id}: center microphone replacement, capture pause, stable target and short file load`, async ({ page }) => {
    await fakeMic(page); await ready(page, id); await arm(page);
    expect(await page.evaluate(() => window.__networkMic.calls)).toBe(0);
    page.on("dialog", (d) => d.accept());
    await node(page, "A").getByRole("button", { name: "Record loop A", exact: true }).click();
    await expect.poll(async () => (await state(page)).recording).toBe(true);
    await expect(node(page, "A").locator(".loop-record")).toHaveAttribute("data-glyph", "stop");
    await page.waitForTimeout(250);
    await node(page, "A").getByRole("button", { name: "Pause loop A", exact: true }).click();
    await expect.poll(async () => (await state(page)).recordingInfo.paused).toBe(true);
    const seconds = (await state(page)).recordingInfo.seconds;
    await page.waitForTimeout(200); expect((await state(page)).recordingInfo.seconds).toBe(seconds);
    await node(page, "A").getByRole("button", { name: "Resume loop A", exact: true }).click();
    await page.waitForTimeout(200);
    await page.locator("#addLoop").click(); // capture still targets A, not the newly selected loop
    await node(page, "A").getByRole("button", { name: "Stop recording loop A", exact: true }).click();
    await expect.poll(async () => (await state(page)).recording).toBe(false);
    await expect.poll(async () => (await state(page)).loops[0].name).toBe("Microphone recording");
    expect((await state(page)).loops[0].duration).toBeGreaterThan(0.3);
    await expect.poll(() => page.evaluate(() => window.__networkMic.stream.getTracks()[0].readyState)).toBe("ended");
    // A real file loads into the selected stable-ID target.
    await page.locator("#tapeFile").setInputFiles(sampleWav());
    await expect.poll(async () => (await state(page)).loops.at(-1).name).toBe("loop.wav");
    expect((await state(page)).loops[0].name).toBe("Microphone recording");
    await page.evaluate(async () => { for (const c of window.__networkMic.contexts) await c.close(); });
  });
  test(`${id}: late microphone grants cannot survive cancellation or removal`, async ({ page }) => {
    await fakeMic(page, true); await ready(page, id); await arm(page);
    page.on("dialog", (d) => d.accept());
    await node(page, "A").getByRole("button", { name: "Record loop A", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__networkMic.pending.length)).toBe(1);
    await expect(node(page, "A").locator(".loop-record")).toHaveAttribute("data-glyph", "cancel");
    await node(page, "A").getByRole("button", { name: "Cancel recording loop A", exact: true }).click();
    await page.evaluate(() => window.__networkMic.pending.shift()());
    await expect.poll(() => page.evaluate(() => window.__networkMic.stopped)).toBe(1);
    expect((await state(page)).recording).toBe(false);
    await node(page, "A").getByRole("button", { name: "Record loop A", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__networkMic.pending.length)).toBe(1);
    await page.locator("#selectors button").first().click(); await page.locator("#removeLoop").click();
    await page.evaluate(() => window.__networkMic.pending.shift()());
    await expect.poll(() => page.evaluate(() => window.__networkMic.stopped)).toBe(2);
    expect((await state(page)).recording).toBe(false);
    expect((await state(page)).loops[0].label).toBe("B");
    await page.evaluate(async () => { for (const c of window.__networkMic.contexts) await c.close(); });
  });
  for (const [name, width, height] of [["desktop", 1440, 900], ["phone", 390, 844], ["landscape", 844, 390]]) {
    test(`${id}: ${name} accessible center controls and scrollable network`, async ({ page }) => {
      await page.setViewportSize({ width, height }); await ready(page, id);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const a = node(page, "A");
      const controls = a.locator("button");
      for (const b of await controls.all()) { await b.scrollIntoViewIfNeeded(); await expect(b).toBeInViewport(); }
      const move = a.getByRole("button", { name: "Move or select loop A", exact: true });
      await move.focus(); const x = (await state(page)).loops[0].x;
      await page.keyboard.press("ArrowRight"); await expect.poll(async () => (await state(page)).loops[0].x).toBe(x + 10);
      const last = page.locator("#selectors button").last(); await last.click();
      await expect(page.locator(".network-loop").last()).toBeInViewport();
      await page.getByRole("link", { name: "How to play / keys", exact: true }).click();
      await expect(page.locator("#howItWorks")).toHaveAttribute("open");
      const results = await new AxeBuilder({ page }).include(".starting-shell").withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(results.violations.filter((v) => ["critical", "serious"].includes(v.impact))).toEqual([]);
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
    });
  }
}
test("Tape routes: independent exit/entry/crossfade controls and movable gates", async ({ page }) => {
  await ready(page, "tape-worm");
  await range(page, "routeDeparture", 0.3); await range(page, "routeLanding", 0.25); await range(page, "routeFade", 0.09);
  let s = await state(page);
  expect(s.routes[0].departure).toBe(0.3); expect(s.routes[0].landing).toBe(0.25); expect(s.routes[0].fade).toBe(0.09);
  expect(s.routes[1].departure).toBe(0.72);
  const gate = page.getByRole("button", { name: "Route A to B exit", exact: true });
  await gate.scrollIntoViewIfNeeded(); const box = await gate.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 45, box.y + box.height / 2 + 50, { steps: 7 }); await page.mouse.up();
  expect((await state(page)).routes[0].departure).not.toBeCloseTo(0.3, 2);
  await arm(page);
  s = await state(page); expect(s.routes[0].fade).toBe(0.09);
  await page.locator("#playButton").click();
  await expect.poll(async () => (await state(page)).transitions, { timeout: 5000 }).toBeGreaterThan(0);
  await page.locator("#bypassRoutes").click(); const n = (await state(page)).transitions;
  await page.waitForTimeout(1800); expect((await state(page)).transitions).toBe(n);
});
test("Soup: letter labels, live gain/tone route edits, Hold and connection by center buttons", async ({ page }) => {
  await ready(page, "loop-soup");
  expect(await page.locator("#preset option:not([disabled])").allTextContents()).toEqual(["A", "B", "C", "D"]);
  await page.locator("#addLoop").click(); await expect(page.locator(".network-loop")).toHaveCount(4);
  await node(page, "A").getByRole("button", { name: "Connect from loop A", exact: true }).click();
  await node(page, "D").getByRole("button", { name: "Move or select loop D", exact: true }).click();
  await expect.poll(async () => (await state(page)).routes.length).toBe(4);
  await range(page, "routeGain", 0.4); await range(page, "routeTone", 0.2);
  await arm(page); await page.locator("#playButton").click();
  await expect.poll(async () => (await state(page)).routes.at(-1).gain).toBe(0.4);
  expect((await state(page)).routes.at(-1).tone).toBe(0.2);
  await node(page, "A").getByRole("button", { name: "Hold loop A", exact: true }).click();
  await expect.poll(async () => (await state(page)).modes[0]).toBe("hold");
  await page.waitForTimeout(200); const energy = (await state(page)).energy[0];
  await page.waitForTimeout(1000); expect((await state(page)).energy[0]).toBeCloseTo(energy, 8);
  await page.locator("#resetButton").click(); expect((await state(page)).modes[0]).toBe("hold");
});
test("phone touch: controls remain 48px and loop drag/cancel does not lock scrolling", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/loop-soup.html`); await expect(page.locator("#stage")).toHaveAttribute("data-state", /networkVersion/);
    for (const b of await node(page, "A").locator("button").all()) {
      const box = await b.boundingBox(); expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
    }
    for (const face of await node(page, "A").locator(".loop-button-face").all()) {
      const box = await face.boundingBox();
      expect(box.width).toBeLessThanOrEqual(28); expect(box.height).toBeLessThanOrEqual(28);
    }
    const move = node(page, "A").getByRole("button", { name: "Move or select loop A", exact: true });
    await move.scrollIntoViewIfNeeded(); const p = await move.boundingBox();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x + 80, y: p.y + 20 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x + 120, y: p.y + 90 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect.poll(async () => (await state(page)).loops[0].y).toBeGreaterThan(230);
    await page.locator("#attachRoute").scrollIntoViewIfNeeded(); await expect(page.locator("#attachRoute")).toBeInViewport();
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
  } finally { await context.close(); }
});

test("already enabled mic records without a second permission request and Audio Off finalizes the take", async ({ page }) => {
  await fakeMic(page); await ready(page, "loop-soup"); await arm(page);
  await page.locator("#microphoneButton").click();
  await expect(page.locator("#microphoneButton")).toHaveText("Disable microphone");
  page.on("dialog", (d) => d.accept());
  await node(page, "A").getByRole("button", { name: "Record loop A", exact: true }).click();
  await expect.poll(async () => (await state(page)).recording).toBe(true);
  expect(await page.evaluate(() => window.__networkMic.calls)).toBe(1);
  await page.waitForTimeout(250);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await state(page)).recording).toBe(false);
  await expect.poll(async () => (await state(page)).lastRecording?.accepted).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__networkMic.stream.getTracks()[0].readyState)).toBe("ended");
  await page.evaluate(async () => { for (const c of window.__networkMic.contexts) await c.close(); });
});

test("removing the pending connection source clears connection mode", async ({ page }) => {
  await ready(page, "loop-soup"); page.on("dialog", (d) => d.accept());
  await node(page, "A").getByRole("button", { name: "Connect from loop A", exact: true }).click();
  await page.locator("#removeLoop").click();
  await expect(page.locator("#connectLoop")).toHaveText("Connect selected");
  await node(page, "B").getByRole("button", { name: "Move or select loop B", exact: true }).click();
  await expect.poll(async () => (await state(page)).selectedLoopId).toBe("loop-1");
});
