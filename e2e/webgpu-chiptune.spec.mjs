import { expect, test } from "@playwright/test";

import {
  pageDiagnosticMessages,
  settlePage,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";

const testBaseUrl = process.env.MORPHAZOID_E2E_BASE_URL
  ?? "http://127.0.0.1:3435";
const chiptuneHref = new URL("webgpu-chiptune.html", testBaseUrl).href;

const layouts = Object.freeze([
  Object.freeze({ name: "desktop", width: 1440, height: 900, coarse: false }),
  Object.freeze({ name: "phone portrait", width: 390, height: 844, coarse: true }),
  Object.freeze({ name: "phone landscape", width: 844, height: 390, coarse: true }),
]);

test("WebGPU Chiptune keeps Play in the masthead and separate from Audio", async ({ page }) => {
  const response = await page.goto(chiptuneHref, { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await settlePage(page);

  const play = page.locator("#synthPlayButton");
  const audio = page.locator("#audioButton");
  const transport = page.locator("[data-chiptune-top-transport]");

  await expect(play).toHaveCount(1);
  await expect(page.locator("[data-primary-transport]")).toHaveCount(1);
  await expect(transport.locator("#synthPlayButton")).toHaveCount(1);
  expect(await play.evaluate((element) => Boolean(element.closest("details, aside")))).toBe(false);
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(audio).toHaveAttribute("aria-pressed", "false");

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#stageReadout")).toContainText("VISUAL TRANSPORT PLAYING");

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#stageReadout")).toContainText("STANDBY");
});

test("clicking a performer focuses only its sequence without changing XY effects", async ({ page }) => {
  const response = await page.goto(chiptuneHref, { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await settlePage(page);

  const canvas = page.locator("#characterStage");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const arpOutput = page.locator('[data-character-fx-output="arp"]');
  const arpBeforeClick = await arpOutput.textContent();

  await canvas.click({
    position: {
      x: box.width * 0.75,
      y: box.height * 0.38,
    },
  });

  await expect(page.locator('[data-character-voice="arp"]')).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.locator("#selectedPerformerName")).toHaveText("ARP");
  await expect(page.locator("#selectedPerformerHint")).toContainText(
    "PITCH CONTOUR",
  );
  await expect(page.locator("#sequenceVoiceTabs button[data-lane]:visible")).toHaveCount(1);
  await expect(page.locator('#sequenceLane-arp:not([hidden])')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await arpOutput.textContent()).toBe(arpBeforeClick);

  await canvas.click({
    position: {
      x: box.width * 0.915,
      y: box.height * 0.38,
    },
  });

  await expect(page.locator("#selectedPerformerName")).toHaveText("DRUMS");
  await expect(page.locator("#sequenceVoiceTabs button[data-lane]:visible")).toHaveCount(4);
  await page.locator("#sequenceLane-snare").click();
  await expect(page.locator("#sequenceLane-snare")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sequenceStateNote")).toHaveText("HIT ON ●");
  await expect(page.locator("#sequenceStateRest")).toHaveText("HIT OFF ×");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
});

test("reloading a preset restores its sequence after customization", async ({ page }) => {
  const response = await page.goto(chiptuneHref, { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await settlePage(page);

  await expect(page.locator("#sequenceStatus")).toContainText("PRESET NOTE");
  await page.locator("#sequenceStateRest").click();
  await expect(page.locator("#sequenceStatus")).toContainText("SILENT");
  await expect(page.locator("#sequenceSourceCoverage")).toContainText("1 custom edit");

  const preset = page.locator('[data-preset-id="source-tracker"]');
  await expect(preset).toHaveAttribute("aria-pressed", "false");
  await preset.click();
  await expect(preset).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sequenceStatus")).toContainText("PRESET NOTE");
  await expect(page.locator("#sequenceSourceCoverage")).toContainText("0 custom edits");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
});

test("WebGPU Chiptune character bays perform XY effects, mute, and multi-solo without arming Audio", async ({ page }) => {
  const response = await page.goto(chiptuneHref, { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await settlePage(page);

  const audio = page.locator("#audioButton");
  const play = page.locator("#synthPlayButton");
  const canvas = page.locator("#characterStage");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-character-mute]")).toHaveCount(6);
  await expect(page.locator("[data-character-solo]")).toHaveCount(6);

  const upperMute = page.locator('[data-character-mute="upperOne"]');
  await upperMute.click();
  await expect(upperMute).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-character-voice="upperOne"]')).toHaveAttribute(
    "data-audible",
    "false",
  );

  const leadSolo = page.locator('[data-character-solo="lead"]');
  const arpSolo = page.locator('[data-character-solo="arp"]');
  await leadSolo.click();
  await expect(leadSolo).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-character-voice="lead"]')).toHaveAttribute(
    "data-audible",
    "true",
  );
  await expect(page.locator('[data-character-voice="bass"]')).toHaveAttribute(
    "data-audible",
    "false",
  );
  await arpSolo.click();
  await expect(page.locator('[data-character-voice="lead"]')).toHaveAttribute(
    "data-audible",
    "true",
  );
  await expect(page.locator('[data-character-voice="arp"]')).toHaveAttribute(
    "data-audible",
    "true",
  );

  const bassOutput = page.locator('[data-character-fx-output="bass"]');
  const beforeDrag = await bassOutput.textContent();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width * 0.39, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.22, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-character-voice="bass"]')).toHaveAttribute(
    "data-active",
    "true",
  );
  expect(await bassOutput.textContent()).not.toBe(beforeDrag);

  await canvas.focus();
  await page.keyboard.press("PageDown");
  await expect(canvas).toHaveAttribute("aria-label", /LEAD selected/);
  const leadOutput = page.locator('[data-character-fx-output="lead"]');
  const beforeKey = await leadOutput.textContent();
  await page.keyboard.press("ArrowRight");
  expect(await leadOutput.textContent()).not.toBe(beforeKey);
  await page.keyboard.press("Home");
  await page.keyboard.press("m");
  await expect(page.locator('[data-character-mute="lead"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const drumsOutput = page.locator('[data-character-fx-output="drums"]');
  const beforeDrumDrag = await drumsOutput.textContent();
  await page.mouse.move(box.x + box.width * 0.87, box.y + box.height * 0.56);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.96, box.y + box.height * 0.18, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-character-voice="drums"]')).toHaveAttribute(
    "data-active",
    "true",
  );
  expect(await drumsOutput.textContent()).not.toBe(beforeDrumDrag);
  const drumsSolo = page.locator('[data-character-solo="drums"]');
  await drumsSolo.click();
  await expect(drumsSolo).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-character-voice="drums"]')).toHaveAttribute(
    "data-audible",
    "true",
  );

  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#stageReadout")).toContainText("STANDBY");
});

test("WebGPU Chiptune top transport and character stage fit supported layouts", async ({ browser }) => {
  for (const layout of layouts) {
    await test.step(layout.name, async () => {
      const context = await browser.newContext({
        viewport: { width: layout.width, height: layout.height },
        colorScheme: "dark",
        reducedMotion: "no-preference",
        ...(layout.coarse ? { hasTouch: true, isMobile: true } : {}),
      });
      try {
        const page = await context.newPage();
        const diagnostics = watchPageDiagnostics(page, { baseURL: testBaseUrl });
        const response = await page.goto(chiptuneHref, { waitUntil: "domcontentloaded" });
        expect(response?.ok()).toBe(true);
        await settlePage(page);
        await expect(page.locator(".masthead.has-midi-toolbar")).toHaveCount(1);

        const report = await page.evaluate(() => {
          const rectangle = (target) => {
            const element = typeof target === "string" ? document.querySelector(target) : target;
            const rect = element?.getBoundingClientRect();
            if (!rect) return null;
            return {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            };
          };
          const rects = {
            play: rectangle("#synthPlayButton"),
            audio: rectangle("#audioButton"),
            output: rectangle(".header-level"),
            transport: rectangle("[data-chiptune-top-transport]"),
            canvas: rectangle("#characterStage"),
          };
          const characterButtons = [...document.querySelectorAll(
            "[data-character-mute], [data-character-solo]",
          )].map((button) => rectangle(button));
          return {
            rects,
            characterButtons,
            overflow: document.documentElement.scrollWidth
              - document.documentElement.clientWidth,
            canvasWidth: document.querySelector("#characterStage")?.width ?? 0,
            canvasHeight: document.querySelector("#characterStage")?.height ?? 0,
          };
        });

        expect(report.overflow).toBeLessThanOrEqual(1);
        for (const [name, rect] of Object.entries(report.rects)) {
          expect(rect, name + " must render").not.toBeNull();
          expect(rect.left, name + " left edge").toBeGreaterThanOrEqual(-1);
          expect(rect.top, name + " top edge").toBeGreaterThanOrEqual(-1);
          expect(rect.right, name + " right edge").toBeLessThanOrEqual(layout.width + 1);
          expect(rect.bottom, name + " bottom edge").toBeLessThanOrEqual(layout.height + 1);
        }

        const overlaps = (left, right) => (
          left.left < right.right
          && left.right > right.left
          && left.top < right.bottom
          && left.bottom > right.top
        );
        expect(overlaps(report.rects.play, report.rects.output)).toBe(false);
        expect(overlaps(report.rects.play, report.rects.audio)).toBe(false);
        expect(overlaps(report.rects.output, report.rects.audio)).toBe(false);
        expect(report.rects.output.width).toBeGreaterThanOrEqual(80);
        expect(report.rects.canvas.width).toBeGreaterThan(300);
        expect(report.rects.canvas.height).toBeGreaterThan(100);
        expect(report.canvasWidth).toBeGreaterThan(0);
        expect(report.canvasHeight).toBeGreaterThan(0);
        expect(report.characterButtons).toHaveLength(12);
        for (const rect of report.characterButtons) {
          expect(rect.width).toBeGreaterThanOrEqual(24);
          expect(rect.height).toBeGreaterThanOrEqual(24);
        }
        if (layout.coarse) {
          expect(report.rects.play.width).toBeGreaterThanOrEqual(48);
          expect(report.rects.play.height).toBeGreaterThanOrEqual(48);
          expect(report.rects.audio.width).toBeGreaterThanOrEqual(48);
          expect(report.rects.audio.height).toBeGreaterThanOrEqual(48);
        }
        expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});

test("drum steps toggle, drag strength, and edit from the up-front slider", async ({ page }) => {
  await page.goto(chiptuneHref);
  await settlePage(page);
  const character = page.locator("#characterStage");
  const bay = await character.boundingBox();
  await character.click({ position: { x: bay.width * .915, y: bay.height * .38 } });
  await page.locator("#sequenceLane-kick").click();
  await expect(page.locator("#sequenceValueRange")).toBeVisible();
  await expect(page.locator("#sequenceValueLabel")).toHaveText("Hit strength 0–100%");
  await expect(page.locator("#selectedPerformerHint")).toContainText("Double-click");
  await page.locator("#sequenceStateRest").click();
  await expect(page.locator("#sequenceValue")).toHaveValue("0");
  const canvas = page.locator("#stage");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  // The editable lane begins at x=48 and below its title/step-number band.
  const x = box.x + 66 + (box.width - 76) / 64;
  const y = box.y + 85;
  await page.mouse.click(x, y);
  await expect(page.locator("#sequenceValue")).toHaveValue("0");
  await page.mouse.dblclick(x, y);
  await expect(page.locator("#sequenceValue")).toHaveValue("100");
  await page.mouse.dblclick(x, y);
  await expect(page.locator("#sequenceValue")).toHaveValue("0");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height * .42, { steps: 6 });
  await page.mouse.up();
  const strength = Number(await page.locator("#sequenceValue").inputValue());
  expect(strength).toBeGreaterThan(0);
  expect(strength).toBeLessThan(100);
  await page.locator("#sequenceValue").fill("25");
  await page.locator("#sequenceValue").press("Tab");
  await expect(page.locator("#sequenceValueOut")).toHaveText("25%");
  await page.locator("#sequenceValueRange").focus();
  await page.keyboard.press("Home");
  await expect(page.locator("#sequenceValueOut")).toHaveText("0%");
  await page.locator("#sequenceStateNote").click();
  await expect(page.locator("#sequenceValueOut")).toHaveText("100%");
  await canvas.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#sequenceValueOut")).toHaveText("95%");
  await page.keyboard.press("Space");
  await expect(page.locator("#sequenceValueOut")).toHaveText("0%");
  await page.keyboard.press("Space");
  await expect(page.locator("#sequenceValueOut")).toHaveText("100%");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
});

test("GPU-rendered drum dynamics and voice tone controls are finite and consequential", async ({ page }) => {
  test.skip(process.env.MORPHAZOID_WEBGPU_QA !== "1", "Enable the actual GPU audio diagnostic pass.");
  await page.goto(chiptuneHref);
  const result = await page.evaluate(async () => {
    const m = await import("./src/webgpu-chiptune.js");
    const audio = new m.WebGpuChiptuneAudio();
    const context = new AudioContext();
    const destination = context.createGain(); // Disconnected: measure without speaker output.
    const rms = (samples) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    try {
      await audio.start(m.WEBGPU_CHIPTUNE_DEFAULTS, { context, destination, autoStart: false });
      const levels = [];
      const base = m.sanitizeWebGpuChiptuneParams({ ...m.WEBGPU_CHIPTUNE_DEFAULTS,
        synthMix: 0, snareLevel: 0, hatLevel: 0, shakerLevel: 0, echoWet: 0,
        echoTaps: 1, fadeIn: 0, ghostDrums: 0, gain: .15 });
      for (const velocity of [0, .25, .5, 1]) {
        const sequence = m.paintWebGpuChiptuneSequenceSegment(
          m.WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE, "kick", 0, 31, velocity, velocity);
        levels.push(rms(await audio.renderChunk(0, base, sequence)));
      }
      const tones = [];
      for (const [lane, key, level] of [
        ["upperOne", "upperOneTone", "upperOneLevel"],
        ["upperTwo", "upperTwoTone", "upperTwoLevel"],
        ["lead", "leadTone", "leadLevel"], ["arp", "arpTone", "arpLevel"],
      ]) {
        const params = { ...m.WEBGPU_CHIPTUNE_DEFAULTS, upperOneLevel: 0, upperTwoLevel: 0,
          bassPulseLevel: 0, bassSineLevel: 0, leadLevel: 0, arpLevel: 0, noiseLevel: 0,
          drumMix: 0, echoWet: 0, echoTaps: 1, fadeIn: 0,
          leadSectionShare: lane === "lead" ? 1 : 0, leadPhraseUnits: 1,
          leadPhrasePhase: .5, [level]: 1 };
        const samples = [];
        for (const tone of [-1, 0, 1]) {
          samples.push(await audio.renderChunk(3.123, m.sanitizeWebGpuChiptuneParams({ ...params, [key]: tone })));
        }
        const difference = (a, b) => rms(a.map((value, i) => value - b[i]));
        tones.push({ lane, rms: samples.map(rms),
          finite: samples.every((pcm) => pcm.every(Number.isFinite)),
          peak: Math.max(...samples.map((pcm) => pcm.reduce((peak, v) => Math.max(peak, Math.abs(v)), 0))),
          differences: [difference(samples[0], samples[1]), difference(samples[1], samples[2])] });
      }
      return { levels, tones };
    } finally {
      await audio.stop();
      await context.close();
    }
  });
  expect(result.levels[0]).toBe(0);
  expect(result.levels[3]).toBeGreaterThan(.001);
  expect(result.levels[1] / result.levels[3]).toBeCloseTo(.25, 5);
  expect(result.levels[2] / result.levels[3]).toBeCloseTo(.5, 5);
  for (const tone of result.tones) {
    expect(tone.finite, tone.lane).toBe(true);
    expect(tone.peak, tone.lane).toBeLessThanOrEqual(.88);
    for (const level of tone.rms) expect(level, tone.lane).toBeGreaterThan(.0001);
    for (const difference of tone.differences) expect(difference, tone.lane).toBeGreaterThan(.00001);
  }
});

test("live note edits and character drags do not audition or restart playback", async ({ page }) => {
  test.skip(process.env.MORPHAZOID_WEBGPU_QA !== "1", "Enable the actual GPU audio diagnostic pass.");
  await page.goto(chiptuneHref);
  await settlePage(page);
  await page.evaluate(async () => {
    const { WebGpuChiptuneAudio } = await import("./src/webgpu-chiptune.js");
    window.chiptuneEditProbe = { auditions: 0, restarts: 0, times: [] };
    for (const [method, counter] of [["auditionSequenceCell", "auditions"], ["restartTimeline", "restarts"]]) {
      const original = WebGpuChiptuneAudio.prototype[method];
      WebGpuChiptuneAudio.prototype[method] = function (...args) {
        window.chiptuneEditProbe[counter]++;
        return original.apply(this, args);
      };
    }
    const update = WebGpuChiptuneAudio.prototype.updateParams;
    WebGpuChiptuneAudio.prototype.updateParams = function (...args) {
      if (this.running) window.chiptuneEditProbe.times.push(this.currentPlaybackTime());
      return update.apply(this, args);
    };
  });
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#synthPlayButton").click();
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    window.chiptuneEditProbe.auditions = 0;
    window.chiptuneEditProbe.restarts = 0;
  });
  await page.locator("#sequenceValue").fill("12");
  await page.locator("#sequenceValue").press("Tab");
  const canvas = page.locator("#characterStage");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .08, box.y + box.height * .6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .12, box.y + box.height * .3, { steps: 8 });
  await page.mouse.up();
  const probe = await page.evaluate(() => window.chiptuneEditProbe);
  expect(probe.auditions).toBe(0);
  expect(probe.restarts).toBe(0);
  expect(probe.times.length).toBeGreaterThan(1);
  expect(probe.times.every((time, i) => i === 0 || time >= probe.times[i - 1])).toBe(true);
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioError")).toBeHidden();
  await page.locator("#audioButton").click();
});

test("Pattern loops expose independent length, fractions, pitch, volume and retained Song edits", async ({ page }) => {
  const diagnostics = watchPageDiagnostics(page);
  await page.goto(chiptuneHref);
  await settlePage(page);
  await expect(page.locator("#compositionMode")).toHaveValue("pattern");
  await expect(page.locator("#sequenceZoom")).toHaveValue("32");
  await expect(page.locator("#sequencePageControls")).toBeHidden();
  await expect(page.locator("#sequenceLength")).toHaveValue("16");
  await page.locator("#sequenceLength").fill("7");
  await page.locator("#sequenceLength").press("Tab");
  await page.locator("#sequenceStepFraction").selectOption(String(3 / 8));
  await expect(page.locator("#sequenceLoopSummary")).toContainText("21/8");
  await page.locator("#sequenceZoom").selectOption("8");
  await expect(page.locator("#sequencePageFour")).toBeVisible();
  await page.locator("#sequencePageFour").click();
  await expect(page.locator("#stageWrap")).toHaveAttribute("data-sequence-page", "3");
  await page.locator("#sequenceZoom").selectOption("32");
  await expect(page.locator("#stageWrap")).toHaveAttribute("data-sequence-page", "0");
  const character = page.locator("#characterStage");
  await character.focus();
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await expect(page.locator("#selectedPerformerName")).toHaveText("LEAD");
  await expect(page.locator("#sequenceLength")).toHaveValue("16");
  await expect(page.locator("#focused-leadTone")).toBeAttached();
  await expect(page.locator("#focused-upperOneTone")).toHaveCount(0);
  await page.locator("#sequenceValue").fill("12");
  await page.locator("#sequenceValue").press("Tab");
  await page.locator("#sequenceVelocity").fill("25");
  await expect(page.locator("#sequenceVelocityOut")).toHaveText("25%");
  await page.locator("#synthPlayButton").click();
  await page.locator("#compositionMode").selectOption("song");
  await expect(page.locator("#patternTimingControls")).toBeHidden();
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sequenceLength")).toHaveValue("32");
  await page.locator("#sequenceValue").fill("9");
  await page.locator("#sequenceValue").press("Tab");
  await page.locator("#compositionMode").selectOption("pattern");
  await expect(page.locator("#sequenceValue")).toHaveValue("12");
  await expect(page.locator("#sequenceVelocity")).toHaveValue("25");
  await page.locator("#compositionMode").selectOption("song");
  await expect(page.locator("#sequenceValue")).toHaveValue("9");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("each drum part has independent mute and multi-solo without changing its pattern", async ({ page }) => {
  await page.goto(chiptuneHref);
  const canvas = page.locator("#characterStage"), box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * .915, y: box.height * .38 } });
  await expect(page.locator("[data-drum-mute]:visible")).toHaveCount(4);
  await expect(page.locator("[data-drum-solo]:visible")).toHaveCount(4);
  const before = await page.locator("#sequenceValue").inputValue();
  await page.locator('[data-drum-solo="kick"]').click();
  await page.locator('[data-drum-solo="hats"]').click();
  await page.locator('[data-drum-mute="hats"]').click();
  for (const selector of ['[data-drum-solo="kick"]', '[data-drum-solo="hats"]', '[data-drum-mute="hats"]']) {
    await expect(page.locator(selector)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.locator("#sequenceValue")).toHaveValue(before);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("GPU Pattern pitch and volume work independently; drum edits keep the current hit unchanged", async ({ page }) => {
  test.skip(process.env.MORPHAZOID_WEBGPU_QA !== "1", "Enable GPU audio measurements.");
  await page.goto(chiptuneHref);
  const result = await page.evaluate(async () => {
    const m = await import("./src/webgpu-chiptune.js");
    const audio = new m.WebGpuChiptuneAudio(), context = new AudioContext();
    const rms = (pcm) => Math.sqrt(pcm.reduce((sum, v) => sum + v * v, 0) / pcm.length);
    const diff = (a, b) => rms(a.map((v, i) => v - b[i]));
    try {
      await audio.start(m.WEBGPU_CHIPTUNE_DEFAULTS, { context, destination: context.createGain(), autoStart: false });
      const params = m.sanitizeWebGpuChiptuneParams({ ...m.WEBGPU_CHIPTUNE_DEFAULTS,
        tempo: 1, synthMix: 0, ghostDrums: 0, echoTaps: 1, echoWet: 0, fadeIn: 0,
        snareLevel: 0, hatLevel: 0, shakerLevel: 0, gain: .1 });
      const base = m.createWebGpuChiptunePattern(params);
      const before = m.sanitizeWebGpuChiptuneSequence({ ...base, lanes: { ...base.lanes,
        kick: { ...base.lanes.kick, activeLength: 4, stepBeats: .25,
          cells: [{ state: "note", value: 1 }] },
      } });
      const after = m.paintWebGpuChiptuneSequenceSegment(before, "kick", 0, 0, .25, .25);
      const earlyOld = await audio.renderChunk(.04, params, before);
      const lateNew = await audio.renderChunk(1.04, params, after);
      audio.sequenceTransitions = m.latchWebGpuChiptuneDrumEdits(before, after, params, .03);
      const earlyHeld = await audio.renderChunk(.04, params, after);
      const lateApplied = await audio.renderChunk(1.04, params, after);
      audio.sequenceTransitions = new Map();
      const tones = [];
      for (const voice of ["upperOne", "upperTwo", "bass", "lead", "arp"]) {
        const only = m.sanitizeWebGpuChiptuneParams({ ...params, synthMix: 1, drumMix: 0,
          upperOneLevel: 0, upperTwoLevel: 0, bassPulseLevel: 0, bassSineLevel: 0,
          leadLevel: 0, arpLevel: 0, scaleMask: 4095,
          [voice === "bass" ? "bassPulseLevel" : voice + "Level"]: 1 });
        const withCell = (value, velocity) => m.sanitizeWebGpuChiptuneSequence({ ...base,
          lanes: { ...base.lanes, [voice]: { ...base.lanes[voice],
            activeLength: 1, stepBeats: .5, cells: [{ state: "note", value, velocity }] } } });
        const a = await audio.renderChunk(.03, only, withCell(0, 1));
        const b = await audio.renderChunk(.03, only, withCell(voice === "arp" ? .5 : 12, 1));
        const quiet = await audio.renderChunk(.03, only, withCell(0, .25));
        const silent = await audio.renderChunk(.03, only, withCell(0, 0));
        tones.push({ voice, pitchDifference: diff(a, b), levelRatio: rms(quiet) / rms(a),
          silence: rms(silent), peak: Math.max(...a.map(Math.abs)), finite: a.every(Number.isFinite) });
      }
      return { earlyDifference: diff(earlyOld, earlyHeld), lateDifference: diff(lateNew, lateApplied),
        oldLevel: rms(earlyOld), newLevel: rms(lateNew), tones };
    } finally { await audio.stop(); await context.close(); }
  });
  expect(result.oldLevel).toBeGreaterThan(.0001);
  expect(result.newLevel).toBeGreaterThan(.00001);
  expect(result.earlyDifference).toBe(0);
  expect(result.lateDifference).toBe(0);
  for (const voice of result.tones) {
    expect(voice.finite, voice.voice).toBe(true);
    expect(voice.peak, voice.voice).toBeLessThanOrEqual(.88);
    expect(voice.pitchDifference, voice.voice).toBeGreaterThan(.0001);
    expect(voice.levelRatio, voice.voice).toBeCloseTo(.25, 5);
    expect(voice.silence, voice.voice).toBe(0);
  }
});
