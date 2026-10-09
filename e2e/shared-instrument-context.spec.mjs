import { expect, test } from "@playwright/test";

async function outputContexts(page) {
  return page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const manager = getSharedAudioOutputManager();
    return { count: manager.contexts.size, outputs: manager.connectionCount(),
      states: [...manager.contexts.keys()].map(context => context.state) };
  });
}

test("FM and physical graph drums are both audible in one registered context", async ({ page }) => {
  await page.goto("/settings.html");
  await page.evaluate(async () => {
    const { GraphDrumAudio, graphDrumPercussionVoice } = await import("/src/families/graph/graph-drum-audio.js");
    const { DEFAULT_FM_DRUM_VOICES } = await import("/src/instruments/fm-drums/fm-drums.js");
    const audio = new GraphDrumAudio();
    window.routingAudio = audio;
    const button = document.createElement("button");
    button.id = "routingAudioStart"; button.textContent = "Start test drums";
    document.body.prepend(button);
    button.onclick = () => {
      window.routingStarted = audio.start().then(async () => {
        const startAt = audio.context.currentTime + 0.05;
        const voice = { ...DEFAULT_FM_DRUM_VOICES[4], decay: 1 };
        await audio.trigger(graphDrumPercussionVoice(voice, { style: "drum-bank" }), { startAt });
        await audio.trigger(graphDrumPercussionVoice(voice, { style: "rattlesnake-physical" }), { startAt });
      });
    };
  });
  await page.locator("#routingAudioStart").click();
  await page.evaluate(() => window.routingStarted);
  expect(await outputContexts(page)).toEqual({ count: 1, outputs: 2, states: ["running"] });
  await expect.poll(() => page.evaluate(() => {
    const peaks = [window.routingAudio.fmAudio, window.routingAudio.physicalAudio].map(engine => {
      const samples = new Float32Array(engine.analyser.fftSize);
      engine.analyser.getFloatTimeDomainData(samples);
      return Math.max(...samples.map(Math.abs));
    });
    return Math.min(...peaks);
  })).toBeGreaterThan(0.001);
  await page.evaluate(() => window.routingAudio.close());
  expect((await outputContexts(page)).count).toBe(0);
});

const modes = [
  { id: "shapes", steps: [
    ["click", "[data-playing-mode=triggers]", "", 2],
    ["select", "#triggerSoundBank", "fm-kit", 3],
    ["click", "[data-playing-mode=continuous]", "", 3],
  ] },
  { id: "tesselation", steps: [
    ["click", "#modeLatticeDrums", "", 2],
    ["click", "#modeSpiral", "", 2],
    ["click", "#modeSpiralDrums", "", 2],
  ] },
  { id: "l-systems", steps: [
    ["click", "#modeTriggers", "", 3],
    ["click", "#modeMic", "", 4],
    ["click", "#modeContinuous", "", 4],
  ] },
  { id: "lattice-drum-machine", steps: [
    ["click", "details:has(#drumEngine) > summary", "", 1],
    ["select", "#drumEngine", "samples", 2],
    ["select", "#drumEngine", "fm", 2],
    ["select", "#drumEngine", "samples", 2],
  ] },
];

for (const { id, steps } of modes) {
  test(`${id} preserves one live recording context through sound mode changes`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/${id}.html`, { waitUntil: "domcontentloaded" });
    expect((await outputContexts(page)).count).toBe(0);
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await outputContexts(page)).count).toBe(1);
    for (const [action, selector, value, outputs] of steps) {
      if (action === "select") await page.locator(selector).selectOption(value);
      else await page.locator(selector).click();
      await expect.poll(async () => (await outputContexts(page)).outputs).toBe(outputs);
      expect(await outputContexts(page)).toEqual({ count: 1, outputs, states: ["running"] });
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    }
    if (id === "tesselation" || id === "shapes") {
      const playing = await page.locator("#playButton").getAttribute("aria-pressed");
      await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      });
      await expect.poll(async () => (await outputContexts(page)).count).toBe(0);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", playing);
      await page.locator("#audioButton").click();
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      expect(await outputContexts(page)).toEqual({ count: 1, outputs: 1, states: ["running"] });
    }
    expect(errors).toEqual([]);
  });
}

test("Lattice cancels a pending audition before persisted-page teardown and rearms one context", async ({ page }) => {
  await page.goto("/lattice-drum-machine.html", { waitUntil: "domcontentloaded" });
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("details:has(#drumEngine) > summary").click();
  await page.evaluate(() => {
    // Hold the audition's inter-note wait so teardown always happens mid-pattern.
    const schedule = window.setTimeout;
    window.routingReleaseAudition = null;
    window.setTimeout = (callback, milliseconds, ...args) => {
      if (milliseconds === 115) {
        window.routingReleaseAudition = () => {
          window.setTimeout = schedule;
          callback(...args);
        };
        return 0;
      }
      return schedule(callback, milliseconds, ...args);
    };
  });
  await page.locator("#auditionEngine").click();
  await expect.poll(() => page.evaluate(() => Boolean(window.routingReleaseAudition))).toBe(true);
  await page.evaluate(async () => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    window.routingReleaseAudition();
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect((await outputContexts(page)).count).toBe(0);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  expect(await outputContexts(page)).toEqual({ count: 1, outputs: 1, states: ["running"] });
});
