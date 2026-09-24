import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

import { observeAutomataState } from "./helpers/automatapoeia-probe.mjs";

// Observe real Web Audio nodes without replacing their rendering/scheduling.
async function observeSources(page) {
  await observeAutomataState(page);
  await page.addInitScript(() => {
    globalThis.__caSources = [];
    globalThis.__caContexts = [];
    const Original = globalThis.AudioContext;
    globalThis.AudioContext = new Proxy(Original, {
      construct(target, args) {
        const context = Reflect.construct(target, args);
        __caContexts.push(context);
        return context;
      },
    });
    for (const method of ["createOscillator", "createBufferSource"]) {
      const create = Original.prototype[method];
      Original.prototype[method] = function (...args) {
        const node = create.apply(this, args);
        const record = { id: __caSources.length, kind: method, startsAt: null, stops: [], ended: false };
        const start = node.start.bind(node);
        node.start = (when, ...rest) => { record.startsAt = when ?? this.currentTime; return start(when, ...rest); };
        __caSources.push(record);
        const stop = node.stop.bind(node);
        node.stop = when => {
          record.stops.push(when ?? this.currentTime);
          return stop(when);
        };
        node.addEventListener("ended", () => { record.ended = true; });
        return node;
      };
    }
  });
}

async function recall(page, id) {
  const picker = page.locator(".header-preset-picker");
  if (!await picker.evaluate(node => node.open)) await picker.locator("summary").click();
  await picker.locator(`button[data-preset-id="${id}"]`).click();
}

async function liveSources(page, kind = "createOscillator") {
  await expect.poll(() => page.evaluate(type => __caSources.filter(source => !source.ended && source.kind === type).length, kind)).toBeGreaterThan(0);
}

async function replaceScore(page, selector) {
  // Snapshot and button action in one task, so no simulation tick can create an
  // unobserved old voice in between. Use the real registered UI handler.
  const transition = await page.locator(selector).evaluate(button => {
    const old = __caSources.filter(source => !source.ended).map(source => source.id);
    const time = __caContexts[0].currentTime;
    // A prior tempo edit or Restart can leave a deadline farther away than
    // one interval at the new knob value. Assert against the actual next row.
    const maximumBoundary = __caSnapshot().nextDeadline;
    button.click();
    return { old, time, maximumBoundary };
  });
  expect(transition.old.length).toBeGreaterThan(0);
  const retired = await page.evaluate(({ old, time, maximumBoundary }) => old.every(id => {
    const source = __caSources[id];
    const lastStop = source.stops.at(-1);
    const mustCancel = source.kind === "createOscillator" || source.startsAt >= time;
    return Number.isFinite(lastStop) && (!mustCancel || lastStop <= maximumBoundary + 0.013);
  }), transition);
  expect(retired, "old columns and future buffers retire at the next boundary; existing finite row tails finish naturally").toBe(true);
  await expect.poll(() => page.evaluate(ids => ids.every(id => __caSources[id].ended), transition.old)).toBe(true);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => __caContexts.length)).toBe(1);
  expect(await page.evaluate(() => __caContexts[0].state)).toBe("running");
}

for (const prefix of ["", "/dist-wax"]) {
  const artifact = prefix ? "generated WAX in browser" : "source";
  const moduleUrl = `${prefix}/src/audio-output-manager.js`;

  test(`${artifact}: column-to-row preset recall releases old notes, including on an empty automaton`, async ({ page, baseURL }, testInfo) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await observeSources(page);
    await page.goto(`${prefix}/automatapoeia.html`);
    await recall(page, "columns-110");
    await page.locator("#playButton").click();
    await page.locator("#audioButton").click();
    await liveSources(page);
    await page.waitForTimeout(400);
    await expect.poll(async () => (await readAudioStatus(page, { moduleUrl })).rms).toBeGreaterThan(0.001);
    await replaceScore(page, '[data-preset-id="original-thirty"]');
    await liveSources(page, "createBufferSource");
    await expect(page.locator("#caVoice")).toBeEnabled();
    const emptyFromRow = await page.locator("#caRule").evaluate(input => {
      input.value = "0";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return Number(document.querySelector("#stageReadout").textContent.match(/\bROW\s+(\d+)/u)[1]);
    });
    // A momentary gap between row events is not proof of a finished release.
    // Let the empty rule advance, then await all already-scheduled finite tails.
    await expect.poll(() => page.locator("#stageReadout").evaluate(node => Number(node.textContent.match(/\bROW\s+(\d+)/u)[1])))
      .toBeGreaterThan(emptyFromRow + 2);
    await expect.poll(() => page.evaluate(() => __caSources.every(source => source.ended)), { timeout: 6000 }).toBe(true);
    await expect.poll(async () => (await readAudioStatus(page, { moduleUrl })).rms, { timeout: 6000 }).toBeLessThan(0.0001);
    const silent = await sampleAudioEnvelope(page, { moduleUrl, durationMs: 700 });
    const environment = await page.evaluate(() => ({
      route: location.pathname, browser: navigator.userAgent, sampleRate: __caContexts[0].sampleRate,
    }));
    await testInfo.attach("empty-rule-output.json", {
      body: JSON.stringify({ environment, ...silent }, null, 2), contentType: "application/json",
    });
    expect(silent.summary.maxRms).toBeLessThan(0.0001);
    const generation = await page.locator("#stageReadout").textContent();
    await expect(page.locator("#stageReadout")).not.toHaveText(generation);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    // Audio off/on must not resurrect any old column voices.
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await page.locator("#audioButton").click();
    const resumed = await sampleAudioEnvelope(page, { moduleUrl, durationMs: 700 });
    expect(resumed.summary.maxRms).toBeLessThan(0.0001);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  test(`${artifact}: same-mode presets and dice replace voice ownership while playback continues`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await observeSources(page);
    await page.goto(`${prefix}/automatapoeia.html`);
    await recall(page, "columns-110");
    await page.locator("#playButton").click();
    await page.locator("#audioButton").click();
    await liveSources(page);
    await replaceScore(page, '[data-preset-id="radius-choir"]');
    await expect(page.locator("#caVoice")).toBeDisabled();
    await liveSources(page);
    await replaceScore(page, ".header-preset-random");
    await expect(page.locator(".header-preset-picker > summary")).toContainText("Custom");
    // Return to a known row score, then prove queued finite buffers are also
    // cleared when entering columns (not only oscillators when leaving them).
    await recall(page, "original-thirty");
    // Random rules can extinguish the current row. Only an explicit Restart
    // should revive it now; preset recall intentionally preserves that seed.
    await page.locator("#seedAutomata").click();
    await liveSources(page, "createBufferSource");
    await replaceScore(page, '[data-preset-id="columns-110"]');
    await liveSources(page);
    const envelope = await sampleAudioEnvelope(page, { moduleUrl, durationMs: 600 });
    expect(envelope.summary.activeSamples).toBeGreaterThan(0);
    expect(envelope.summary.clippedSamples).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  test(`${artifact}: recall and dice with Audio off do not allocate a context`, async ({ page }) => {
    await observeSources(page);
    await page.goto(`${prefix}/automatapoeia.html`);
    for (const id of ["columns-110", "original-thirty", "radius-choir"]) await recall(page, id);
    await page.locator(".header-preset-random").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => __caContexts.length)).toBe(0);
    expect((await readAudioStatus(page, { moduleUrl })).connectionCount).toBe(0);
  });
}
