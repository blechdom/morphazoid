import { expect, test } from "@playwright/test";
import { TAP_TEMPO_TARGETS } from "../src/site/tap-tempo-targets.js";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const tapButton = (scope, selector) => scope.locator(`.mz-tap-tempo[data-tap-control=${JSON.stringify(selector)}]`);
const pugglerState = page => page.evaluate(() => window.__puggler.snapshot());
const rubixoidsState = page => page.evaluate(() => window.__rubixoidsSnapshot());
const capturePreset = page => page.evaluate(async () => (
  await import("/src/site/header-presets.js")
).captureHeaderPresetState());

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function tapAtInterval(button, interval = 500) {
  await expect(button).toBeEnabled();
  await button.evaluate((node, interval) => {
    node.reset();
    const start = performance.now();
    node.tap(start);
    node.tap(start + interval);
    node.tap(start + interval * 2);
  }, interval);
}

async function assertInlineTarget(button, viewport, { coarse = false } = {}) {
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
  const geometry = await button.evaluate(node => {
    const row = node.closest(".mz-tap-tempo-field");
    const field = row?.firstElementChild;
    const tap = node.getBoundingClientRect(), owner = field?.getBoundingClientRect();
    return {
      tap: { x: tap.x, y: tap.y, right: tap.right, bottom: tap.bottom, width: tap.width, height: tap.height },
      owner: owner && { x: owner.x, y: owner.y, right: owner.right, bottom: owner.bottom },
      insideLabel: Boolean(node.closest("label")),
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.owner, "Tap shares a row with the existing control").toBeTruthy();
  expect(geometry.insideLabel, "a label must retain only its original labelable control").toBe(false);
  expect(geometry.tap.x).toBeGreaterThanOrEqual(geometry.owner.right - 1);
  expect(Math.min(geometry.tap.bottom, geometry.owner.bottom) - Math.max(geometry.tap.y, geometry.owner.y)).toBeGreaterThan(0);
  expect(geometry.tap.x).toBeGreaterThanOrEqual(0);
  expect(geometry.tap.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width);
  if (coarse) {
    expect(geometry.tap.width).toBeGreaterThanOrEqual(48);
    expect(geometry.tap.height).toBeGreaterThanOrEqual(48);
  }
}

test("Puggler physical taps change the running music clock and preserve Audio, Play and Output", async ({ page, baseURL }, info) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("puggler.html");
  await page.waitForFunction(() => window.__puggler);
  await page.locator(".header-preset-next").click();
  await setRange(page, "tempo", 360);
  await setRange(page, "rideSpeed", 0);
  await setRange(page, "chaos", 0);
  await setRange(page, "level", .13);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await pugglerState(page)).rhythmicNotes).toBeGreaterThan(0);
  const button = tapButton(page, "#tempo");
  await button.scrollIntoViewIfNeeded();
  await button.evaluate(node => {
    node.__testTapTimes = [];
    node.addEventListener("pointerdown", event => node.__testTapTimes.push(event.timeStamp));
  });
  const before = await pugglerState(page);
  await button.click();
  expect((await pugglerState(page)).tempo, "the first contact only establishes the beat").toBe(before.tempo);
  for (let index = 0; index < 3; index++) {
    await page.waitForTimeout(500);
    await button.click();
  }
  const after = await pugglerState(page);
  const contacts = await button.evaluate(node => node.__testTapTimes);
  expect(contacts).toHaveLength(4);
  const expectedTempo = 60000 * 3 / (contacts[3] - contacts[0]);
  expect(Math.abs(after.tempo - expectedTempo)).toBeLessThan(.011);
  expect(Number(await page.locator("#tempo").inputValue())).toBe(after.tempo);
  expect(after).toMatchObject({ running: true, audioOn: true, level: .13, rideSpeed: 0 });
  expect(after.beat).toBeGreaterThan(before.beat);
  await expect.poll(async () => (await pugglerState(page)).rhythmicNotes).toBeGreaterThan(after.rhythmicNotes);
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
  const envelope = await sampleAudioEnvelope(page, { durationMs: 650 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxRms).toBeGreaterThan(.000001);
  expect(envelope.summary.clippedSamples).toBe(0);
  await info.attach("tap-tempo-running-state.json", { body: JSON.stringify({ before, after, audio: envelope.summary }), contentType: "application/json" });
  await page.locator("#audioButton").click();
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("native Enter and Space tap once without toggling the instrument transport or arming audio", async ({ page }) => {
  await page.goto("puggler.html");
  await page.waitForFunction(() => window.__puggler);
  const button = tapButton(page, "#tempo");
  const before = await pugglerState(page);
  await setRange(page, "tempo", 360);
  await button.evaluate(node => {
    node.__testTapTimes = [];
    node.addEventListener("click", event => node.__testTapTimes.push(event.timeStamp));
  });
  await button.focus();
  await button.press("Enter");
  await expect(page.locator("#tempo")).toHaveValue("360");
  await page.waitForTimeout(500);
  await button.press("Space");
  const after = await pugglerState(page);
  const contacts = await button.evaluate(node => node.__testTapTimes);
  expect(contacts).toHaveLength(2);
  expect(Math.abs(after.tempo - 60000 / (contacts[1] - contacts[0]))).toBeLessThan(.011);
  expect(after).toMatchObject({ running: before.running, audioOn: false, level: before.level });
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await button.evaluate(node => node.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", repeat: true, bubbles: true, cancelable: true,
  })));
  expect((await pugglerState(page)).tempo).toBe(after.tempo);
});

async function installSimdProbe(page) {
  await page.evaluate(async () => {
    const { SimdChiptuneAudio } = await import("/src/instruments/simd-chiptune/audio.js");
    const probe = globalThis.__tapTempoSimdProbe = { engines: [], starts: 0, restarts: 0, stops: 0 };
    for (const [method, count] of [["start", "starts"], ["restart", "restarts"], ["stop", "stops"]]) {
      const original = SimdChiptuneAudio.prototype[method];
      SimdChiptuneAudio.prototype[method] = function (...args) {
        probe[count]++;
        if (!probe.engines.includes(this)) probe.engines.push(this);
        return original.apply(this, args);
      };
    }
  });
}

const simdState = page => page.evaluate(() => {
  const probe = globalThis.__tapTempoSimdProbe, engine = probe.engines.at(-1);
  return {
    starts: probe.starts, restarts: probe.restarts, stops: probe.stops, engineCount: probe.engines.length,
    active: engine && { tempo: engine.params.tempo, beat: engine.currentPlaybackBeat(), running: engine.running,
      contextState: engine.context?.state, audioSeconds: engine.currentAudioSeconds() },
  };
});

test("SIMD custom tempo knob routes Tap to its live audio engine without restarting the beat", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("simd-chiptune.html");
  await settlePage(page);
  await installSimdProbe(page);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#synthPlayButton").click();
  await expect.poll(async () => (await simdState(page)).active?.running).toBe(true);
  await expect.poll(async () => (await simdState(page)).active?.beat).toBeGreaterThan(.2);
  const before = await simdState(page);
  const button = page.locator("#simdTempoControls .mz-tap-tempo");
  await tapAtInterval(button, 500);
  const after = await simdState(page);
  expect(after.active.tempo).toBeCloseTo(2, 8);
  expect(after.active).toMatchObject({ running: true, contextState: "running" });
  expect(after.active.beat).toBeGreaterThanOrEqual(before.active.beat);
  expect(after.active.audioSeconds).toBeGreaterThanOrEqual(before.active.audioSeconds);
  expect(after.starts).toBe(before.starts);
  expect(after.restarts).toBe(before.restarts);
  expect(after.stops).toBe(before.stops);
  expect(after.engineCount).toBe(before.engineCount);
  await expect(page.locator('#simdTempoControls [data-param-key="tempo"]')).toHaveAttribute("aria-valuenow", /^2(?:\.0+)?$/);
  await expect.poll(async () => (await simdState(page)).active.beat).toBeGreaterThan(after.active.beat + .2);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxPeak).toBeGreaterThan(.00001);
  await page.locator("#audioButton").click();
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Shape normalized playhead control remains inline and updates physical speed at ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }, info) => {
    const coarse = viewport.width < 1000;
    const context = await browser.newContext({ baseURL, viewport, hasTouch: coarse, isMobile: coarse });
    try {
      const page = await context.newPage();
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await page.goto("shape-synth.html");
      const button = tapButton(page, "#speed");
      await expect(button).toBeEnabled();
      const before = await capturePreset(page);
      await tapAtInterval(button, 500);
      await expect.poll(async () => (await capturePreset(page)).snapshot.parameters.speed).toBeGreaterThan(1.98);
      const after = await capturePreset(page);
      expect(after.snapshot.parameters.speed).toBeLessThan(2.02);
      expect(after.snapshot.parameters.playing).toBe(before.snapshot.parameters.playing);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      expect(Number(await page.locator("#speed").inputValue())).toBeLessThan(1);
      await assertInlineTarget(button, viewport, { coarse });
      await page.screenshot({ path: info.outputPath("tap-inline-controls.png") });
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await context.close(); }
  });
}

test("Rubixoids Tap follows each owned shadow view and keeps the shared clock through switches", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("rubixoids.html");
  await expect(page.locator('body > .masthead #audioButton')).toBeEnabled();
  const outerTap = page.locator(".rubixoids-clock .mz-tap-tempo");
  await tapAtInterval(outerTap, 400);
  expect((await rubixoidsState(page)).clock.tempo).toBe(150);
  for (const [dimension, speedId] of [["2d", "autoSlideSpeed"], ["4d", null], ["3d", "randomTwistSpeed"], ["2d", "autoSlideSpeed"]]) {
    await page.locator(`.rubixoids-dimensions [data-dimension="${dimension}"]`).click();
    await expect.poll(async () => (await rubixoidsState(page)).dimension).toBe(dimension);
    const pane = page.locator(`.rubixoids-pane[data-dimension="${dimension}"]`);
    const tempoTap = tapButton(pane, "#tempo");
    await expect(tempoTap).toHaveCount(1);
    await tapAtInterval(tempoTap, 500);
    await expect.poll(async () => (await rubixoidsState(page)).clock.tempo).toBe(120);
    const state = await rubixoidsState(page);
    expect(state.dimensions[dimension].settings.tempo).toBe(120);
    await expect(page.locator(".rubixoids-clock #tempo")).toHaveValue("120");
    if (speedId) {
      const speedTap = tapButton(pane, `#${speedId}`);
      await expect(speedTap).toHaveCount(1);
      await tapAtInterval(speedTap, 500);
      const position = Number(await pane.locator(`#${speedId}`).inputValue());
      const { rubixTwistIntervalMs } = await import("../src/instruments/rubixoids/rubix/rubix.js");
      expect(rubixTwistIntervalMs(position)).toBeGreaterThan(480);
      expect(rubixTwistIntervalMs(position)).toBeLessThan(520);
      expect((await rubixoidsState(page)).clock.tempo).toBe(120);
    }
  }
  await expect(page.locator('body > .masthead #audioButton')).toHaveAttribute("aria-pressed", "false");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Shapes rebuilds Tap for all dimensional rotation controls and preserves reverse direction", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("shapes.html");
  const rotationTargets = TAP_TEMPO_TARGETS.filter(target => target.route === "shapes.html" && target.selector.includes("data-rotation-target"));
  const seen = new Set();
  for (const dimension of ["2d", "3d", "4d", "2d"]) {
    await page.locator("#dimensionSelect").selectOption(dimension);
    await page.locator("#rotationBankTab").click();
    await expect(page.locator("#rotationControls input[type=range]").first()).toBeVisible();
    for (const target of rotationTargets) {
      const control = page.locator(target.selector);
      if (!await control.count()) continue;
      const button = tapButton(page, target.selector);
      await expect(button).toHaveCount(1);
      await control.evaluate(node => {
        node.value = "-.15";
        node.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await tapAtInterval(button, 2500);
      await expect(control).toHaveValue("-0.4");
      const path = await control.getAttribute("data-rotation-target");
      const snapshot = (await capturePreset(page)).snapshot.parameters;
      expect(path.split(".").reduce((value, key) => value[key], snapshot.dimension[dimension])).toBeCloseTo(-.4, 8);
      seen.add(target.selector);
      await button.evaluate(node => { globalThis.__retiredRotationTap = node; });
    }
    const dimensions = { "2d": "3d", "3d": "4d", "4d": "2d" };
    await page.locator("#dimensionSelect").selectOption(dimensions[dimension]);
    await expect.poll(() => page.evaluate(() => globalThis.__retiredRotationTap.isConnected)).toBe(false);
    expect(await page.evaluate(() => __retiredRotationTap.tap(performance.now()))).toBeNull();
  }
  expect([...seen].sort()).toEqual(rotationTargets.map(target => target.selector).sort());
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const route of ["fractal-synthesis.html", "creaturazoid.html"]) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`${route} Tap keeps space for help and its responsive control row at ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000 });
      try {
        const page = await context.newPage();
        await page.goto(route);
        await expect.poll(() => page.locator(".mz-tap-tempo").count()).toBeGreaterThan(0);
        for (const button of await page.locator(".mz-tap-tempo").all()) {
          if (!await button.isVisible()) continue;
          await button.scrollIntoViewIfNeeded();
          const geometry = await button.evaluate(node => {
            const row = node.closest(".mz-tap-tempo-field");
            const bounds = node.getBoundingClientRect();
            const help = row.parentElement.querySelector(":scope > .info-button");
            const other = help?.getBoundingClientRect();
            const overlap = other ? Math.max(0, Math.min(bounds.right, other.right) - Math.max(bounds.left, other.left)) *
              Math.max(0, Math.min(bounds.bottom, other.bottom) - Math.max(bounds.top, other.top)) : 0;
            return { width: row.clientWidth, contentWidth: row.scrollWidth, overlap, right: bounds.right, left: bounds.left };
          });
          expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.width + 2);
          expect(geometry.overlap).toBe(0);
          expect(geometry.left).toBeGreaterThanOrEqual(0);
          expect(geometry.right).toBeLessThanOrEqual(viewport.width + 1);
        }
      } finally { await context.close(); }
    });
  }
}

const routeTargets = new Map();
for (const target of TAP_TEMPO_TARGETS) {
  const targets = routeTargets.get(target.route) ?? [];
  targets.push(target);
  routeTargets.set(target.route, targets);
}
for (const [route, targets] of routeTargets) {
  test(`Tap integration is present on every declared ${route} control`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    const path = route.endsWith(".html") ? route : `${route}.html`;
    expect((await page.goto(path))?.ok()).toBe(true);
    await settlePage(page);
    await expect.poll(() => page.locator(".mz-tap-tempo").count(), { message: `${route} has a mounted tempo or speed control` }).toBeGreaterThan(0);
    for (const target of targets) {
      const controls = page.locator(target.selector);
      const count = await controls.count();
      if (!count) continue; // Dimension and mode-specific controls mount on demand.
      const buttons = tapButton(page, target.selector);
      await expect(buttons, `${route}: every mounted ${target.selector} has one Tap`).toHaveCount(count);
      for (const button of await buttons.all()) {
        expect(await button.getAttribute("type")).toBe("button");
        const controlId = await button.getAttribute("aria-controls");
        expect(controlId).toBeTruthy();
        const control = await button.evaluate((node, id) => {
          const root = node.getRootNode();
          const target = root.getElementById?.(id) ?? root.querySelector(`[id=${JSON.stringify(id)}]`);
          return { exists: Boolean(target), insideLabel: Boolean(node.closest("label")) };
        }, controlId);
        expect(control.exists).toBe(true);
        expect(control.insideLabel).toBe(false);
        await button.evaluate(node => {
          if (node.disabled) return;
          const root = node.getRootNode();
          const control = root.getElementById(node.getAttribute("aria-controls"));
          let inputs = 0, changes = 0;
          const onInput = () => inputs++, onChange = () => changes++;
          control.addEventListener("input", onInput);
          control.addEventListener("change", onChange);
          node.reset();
          const start = performance.now();
          node.tap(start); node.tap(start + 500);
          if (control.matches("input") && (inputs !== 1 || changes !== 1)) throw new Error("Tap must use the owner's native input/change path");
          control.removeEventListener("input", onInput);
          control.removeEventListener("change", onChange);
          const value = Number(control.value ?? control.getAttribute("aria-valuenow"));
          if (!Number.isFinite(value)) throw new Error("Tap must leave a finite owner value");
        });
      }
    }
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}
