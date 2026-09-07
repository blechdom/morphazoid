import { expect, test } from "@playwright/test";

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function installAudioContextProbe(page) {
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!NativeAudioContext) return;
    class ObservableAudioContext extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        window.__yoyodyneAudioContext = this;
      }
    }
    if (window.AudioContext) window.AudioContext = ObservableAudioContext;
    else window.webkitAudioContext = ObservableAudioContext;
  });
}

test("Yoyodyne keeps Audio explicit while edits remain live and reversible", async ({ page }) => {
  await installAudioContextProbe(page);
  await page.goto("/yoyodyne.html", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.__yoyodyneMidiNotes = [];
    window.addEventListener("morphazoid:midi-output-preview", (event) => {
      if (event.detail?.kind === "note") window.__yoyodyneMidiNotes.push(event.detail);
    });
  });

  const stage = page.locator("#noteStage");
  const audio = page.locator("#audioButton");
  const play = page.locator("#playButton");
  await expect(stage).toHaveAttribute("data-model-ready", "true");
  await expect(stage).toHaveAttribute("data-note-count", "16");
  await expect(stage).toHaveAttribute("data-max-polyphony", "3");
  await expect(stage).toHaveAttribute("data-selected-role", "throat");
  await expect(audio).toHaveAttribute("aria-pressed", "false");

  await play.click();
  await expect(stage).toHaveAttribute("data-transport", "playing");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(stage).toHaveAttribute("data-active-ids", "sig-01 sig-02 sig-03");
  await expect(stage).toHaveAttribute("data-active-roles", "throat mouth halo");
  await expect.poll(async () => Number(await stage.getAttribute("data-position-beat"))).toBeGreaterThan(0.1);
  await expect(page.locator("#transportNotice")).toHaveText("Audio is off — turn it on to hear playback");
  await expect(page.locator("#liveStatus")).toContainText("Audio is off");
  await expect.poll(() => page.evaluate(() => window.__yoyodyneMidiNotes.length)).toBeGreaterThan(0);
  const firstPreview = await page.evaluate(() => window.__yoyodyneMidiNotes[0]);
  expect(firstPreview).toMatchObject({
    routeId: "yoyodyne",
    sourceId: "yoyodyne-sequence",
    note: 48,
    action: "on",
    mapped: false,
    sent: false,
  });
  expect(firstPreview.durationMs).toBeGreaterThan(0);
  await page.locator("#stopButton").click();

  await expect(page.locator("#selectedPitch")).toHaveAttribute("step", "1");
  await expect(page.locator("#selectedStart")).toHaveAttribute("step", "0.5");
  await expect(page.locator("#selectedDuration")).toHaveAttribute("step", "0.5");
  await page.locator("#selectedPitch").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#selectedPitchOut")).toHaveText("C♯3");
  await page.locator("#undoButton").click();
  await expect(page.locator("#selectedPitchOut")).toHaveText("C3");
  await page.locator("#noteStage").focus();
  await page.keyboard.press("PageUp");
  await expect(stage).toHaveAttribute("data-selected-id", "sig-16");
  await page.locator("#resetAllTop").click();

  await setRange(page, "#character", 0);
  await expect(stage).toHaveAttribute("data-character-visual", "0.00");
  const clearRelayField = await stage.evaluate((canvas) => canvas.toDataURL());
  await setRange(page, "#character", 1);
  await expect(stage).toHaveAttribute("data-character-visual", "1.00");
  const chargedRelayField = await stage.evaluate((canvas) => canvas.toDataURL());
  expect(chargedRelayField).not.toBe(clearRelayField);
  await setRange(page, "#character", 0.42);

  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  const compact = bounds.width < 620;
  const left = compact ? 43 : 62;
  const right = compact ? 10 : 18;
  const top = compact ? 25 : 29;
  const bottom = compact ? 24 : 28;
  const firstCell = {
    x: bounds.x + left + (3.5 / 16 * (bounds.width - left - right)) / 2,
    y: bounds.y + top + (84 - 48 + 0.5) * ((bounds.height - top - bottom) / 37),
  };
  await page.mouse.move(firstCell.x, firstCell.y);
  await page.mouse.down();
  await page.mouse.move(firstCell.x, firstCell.y - 52, { steps: 4 });
  await expect(page.locator("#selectedPitchOut")).not.toHaveText("C3");
  await stage.evaluate((canvas, point) => {
    canvas.dispatchEvent(new PointerEvent("pointercancel", {
      bubbles: true,
      pointerId: 1,
      clientX: point.x,
      clientY: point.y - 52,
    }));
  }, firstCell);
  await page.mouse.up();
  await expect(page.locator("#selectedPitchOut")).toHaveText("C3");

  await setRange(page, "#selectedStart", 1);
  await setRange(page, "#selectedDuration", 1);
  await play.click();
  await expect.poll(async () => Number(await stage.getAttribute("data-position-beat"))).toBeGreaterThan(1.1);
  await expect(stage).toHaveAttribute("data-active-ids", /(?=.*sig-01)(?=.*sig-02)/);
  await page.locator("#stopButton").click();
  await page.locator("#resetAllTop").click();

  await page.locator("#auditionButton").click();
  await expect(page.locator("#transportNotice")).toContainText("Audio is off");
  await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#transportNotice")).toBeEmpty();
  await play.click();
  await expect(stage).toHaveAttribute("data-clock-source", "audio-context");
  await expect(stage).toHaveAttribute("data-scheduler-state", "running");

  const samples = [];
  for (let index = 0; index < 14; index += 1) {
    samples.push(Number(await stage.getAttribute("data-position-beat")));
    await page.waitForTimeout(20);
  }
  expect(samples.every((value, index) => index === 0 || value + 0.0001 >= samples[index - 1])).toBe(true);

  const beforeEdit = samples.at(-1);
  await page.locator("#selectedPitch").focus();
  await page.keyboard.press("ArrowUp");
  await expect(stage).toHaveAttribute("data-transport", "playing");
  await expect.poll(async () => Number(await stage.getAttribute("data-position-beat"))).toBeGreaterThan(beforeEdit);
  await setRange(page, "#tempo", 132);
  await expect(stage).toHaveAttribute("data-transport", "playing");
  await expect(page.locator("#audioError")).toBeHidden();

  await page.locator("#stopButton").click();
  await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "false");
});

test("Yoyodyne keeps a fully stacked editable phrase below full scale", async ({ page }) => {
  await page.goto("/yoyodyne.html", { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const [graphModule, audioModule, modelModule] = await Promise.all([
      import("/src/graph-synth-audio.js"),
      import("/src/yoyodyne-audio.js"),
      import("/src/yoyodyne.js"),
    ]);
    const sampleRate = 48_000;
    const renderSeconds = 3.2;
    const phrase = modelModule.createYoyodynePhrase();
    const notes = Array.from({ length: modelModule.YOYODYNE_LIMITS.maximumNotes }, (_, index) => ({
      ...phrase[index % phrase.length],
      id: `stack-${String(index + 1).padStart(2, "0")}`,
      startBeat: 0,
      durationBeats: 4,
      pitch: 84,
    }));
    const gainScale = audioModule.yoyodyneScoreGainScale(notes);

    const render = async (character) => {
      class ProbeContext extends OfflineAudioContext {
        constructor() {
          super(2, Math.ceil(renderSeconds * sampleRate), sampleRate);
        }

        resume() {
          return Promise.resolve();
        }
      }

      const engine = new graphModule.GraphSynthAudio({ AudioContext: ProbeContext });
      engine.setOutput(0.8);
      const audioContext = await engine.start();
      const scheduled = await Promise.all(notes.map((note) => {
        const trigger = audioModule.deriveYoyodyneTrigger(note, {
          tempo: 96,
          character,
          gainScale,
        });
        return engine.trigger(trigger.voice, {
          ...trigger.envelope,
          startAt: 0.05,
        });
      }));
      const activeVoicesAtSchedule = engine.activeVoices.size;
      const buffer = await audioContext.startRendering();
      let finite = true;
      let peak = 0;
      let squareSum = 0;
      let sampleCount = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        for (const sample of buffer.getChannelData(channel)) {
          finite &&= Number.isFinite(sample);
          peak = Math.max(peak, Math.abs(sample));
          squareSum += sample * sample;
          sampleCount += 1;
        }
      }
      const activeVoicesAfterRender = engine.activeVoices.size;
      await engine.close();
      return {
        character,
        scheduled: scheduled.filter((voice) => voice.scheduled).length,
        finite,
        peak,
        rms: Math.sqrt(squareSum / sampleCount),
        activeVoicesAtSchedule,
        activeVoicesAfterRender,
        contextReleased: engine.context === null,
      };
    };

    return {
      gainScale,
      scenes: await Promise.all([0, 0.42, 1].map(render)),
    };
  });

  expect(result.gainScale).toBeGreaterThan(0);
  expect(result.gainScale).toBeLessThan(1);
  for (const scene of result.scenes) {
    expect(scene.scheduled).toBe(24);
    expect(scene.activeVoicesAtSchedule).toBe(24);
    expect(scene.finite).toBe(true);
    expect(scene.rms).toBeGreaterThan(0.001);
    expect(scene.peak).toBeLessThan(0.95);
    expect(scene.activeVoicesAfterRender).toBe(0);
    expect(scene.contextReleased).toBe(true);
  }
});

test("Yoyodyne relay roles and Character produce distinct rendered spectra", async ({ page }) => {
  await page.goto("/yoyodyne.html", { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const [graphModule, audioModule, modelModule] = await Promise.all([
      import("/src/graph-synth-audio.js"),
      import("/src/yoyodyne-audio.js"),
      import("/src/yoyodyne.js"),
    ]);
    const sampleRate = 48_000;
    const renderSeconds = 0.85;
    const analysisFrames = 8_192;
    const analysisStart = Math.floor(sampleRate * 0.16);
    const probeFrequencies = [392.4, 523.2, 654.1, 915.7, 1_046.5, 1_308.1, 2_093];
    const baseNote = {
      ...modelModule.createYoyodynePhrase()[0],
      pitch: 48,
      durationBeats: 1,
      bendCents: [0, 0, 0],
      energy: 0.72,
    };

    const render = async (voiceRole, character) => {
      class ProbeContext extends OfflineAudioContext {
        constructor() {
          super(2, Math.ceil(renderSeconds * sampleRate), sampleRate);
        }

        resume() {
          return Promise.resolve();
        }
      }

      const engine = new graphModule.GraphSynthAudio({ AudioContext: ProbeContext });
      engine.setOutput(0.5);
      const audioContext = await engine.start();
      const trigger = audioModule.deriveYoyodyneTrigger(
        { ...baseNote, voiceRole },
        { tempo: 96, character },
      );
      await engine.trigger(trigger.voice, { ...trigger.envelope, startAt: 0.05 });
      const buffer = await audioContext.startRendering();
      const samples = buffer.getChannelData(0).subarray(
        analysisStart,
        analysisStart + analysisFrames,
      );
      let squareSum = 0;
      let finite = true;
      for (const sample of samples) {
        finite &&= Number.isFinite(sample);
        squareSum += sample * sample;
      }
      const magnitudes = probeFrequencies.map((frequency) => {
        let real = 0;
        let imaginary = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (samples.length - 1));
          const phase = 2 * Math.PI * frequency * index / sampleRate;
          real += samples[index] * window * Math.cos(phase);
          imaginary -= samples[index] * window * Math.sin(phase);
        }
        return Math.hypot(real, imaginary);
      });
      const magnitudeSum = magnitudes.reduce((sum, value) => sum + value, 0);
      await engine.close();
      return {
        voiceRole,
        character,
        finite,
        rms: Math.sqrt(squareSum / samples.length),
        profile: magnitudes.map((value) => value / magnitudeSum),
      };
    };

    return Promise.all([
      render("throat", 0.42),
      render("mouth", 0.42),
      render("halo", 0.42),
      render("mouth", 0),
      render("mouth", 1),
    ]);
  });

  const distance = (left, right) => left.reduce((sum, value, index) => (
    sum + Math.abs(value - right[index])
  ), 0);
  for (const scene of result) {
    expect(scene.finite).toBe(true);
    expect(scene.rms).toBeGreaterThan(0.001);
    expect(scene.profile.every(Number.isFinite)).toBe(true);
    expect(scene.profile.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 8);
  }
  expect(distance(result[0].profile, result[1].profile)).toBeGreaterThan(0.08);
  expect(distance(result[1].profile, result[2].profile)).toBeGreaterThan(0.08);
  expect(distance(result[0].profile, result[2].profile)).toBeGreaterThan(0.08);
  expect(distance(result[3].profile, result[4].profile)).toBeGreaterThan(0.08);
});

test("Yoyodyne releases a sustained cell without a stop discontinuity", async ({ page }) => {
  await page.goto("/yoyodyne.html", { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const [graphModule, audioModule, modelModule] = await Promise.all([
      import("/src/graph-synth-audio.js"),
      import("/src/yoyodyne-audio.js"),
      import("/src/yoyodyne.js"),
    ]);
    const sampleRate = 48_000;
    const renderSeconds = 0.7;
    const note = {
      ...modelModule.createYoyodynePhrase()[0],
      pitch: 60,
      durationBeats: 4,
    };

    const render = async ({ stop }) => {
      class ProbeContext extends OfflineAudioContext {
        constructor() {
          super(2, Math.ceil(renderSeconds * sampleRate), sampleRate);
        }

        resume() {
          return Promise.resolve();
        }
      }

      const engine = new graphModule.GraphSynthAudio({ AudioContext: ProbeContext });
      engine.setOutput(0.34);
      const audioContext = await engine.start();
      const trigger = audioModule.deriveYoyodyneTrigger(note, {
        tempo: 96,
        character: 0.42,
      });
      await engine.trigger(trigger.voice, {
        ...trigger.envelope,
        startAt: 0.05,
      });

      let silenceAt = null;
      let suspended = Promise.resolve();
      if (stop) {
        suspended = audioContext.suspend(0.3).then(() => {
          silenceAt = audioContext.currentTime;
          engine.silence();
          return OfflineAudioContext.prototype.resume.call(audioContext);
        });
      }
      const renderPromise = audioContext.startRendering();
      await suspended;
      const buffer = await renderPromise;

      const maximumDelta = (start, end) => {
        let maximum = 0;
        const first = Math.max(1, Math.floor(start * sampleRate));
        const last = Math.min(buffer.length, Math.ceil(end * sampleRate));
        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
          const samples = buffer.getChannelData(channel);
          for (let index = first; index < last; index += 1) {
            maximum = Math.max(maximum, Math.abs(samples[index] - samples[index - 1]));
          }
        }
        return maximum;
      };
      let finite = true;
      let lastAudible = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const samples = buffer.getChannelData(channel);
        for (let index = 0; index < samples.length; index += 1) {
          finite &&= Number.isFinite(samples[index]);
          if (Math.abs(samples[index]) > 1e-5) lastAudible = Math.max(lastAudible, index / sampleRate);
        }
      }
      const activeVoicesAfterRender = engine.activeVoices.size;
      await engine.close();
      return {
        finite,
        silenceAt,
        attackDelta: maximumDelta(0.05, 0.12),
        transitionDelta: maximumDelta(0.28, 0.36),
        lastAudible,
        activeVoicesAfterRender,
        contextReleased: engine.context === null,
      };
    };

    return {
      control: await render({ stop: false }),
      stopped: await render({ stop: true }),
    };
  });

  expect(result.control.finite).toBe(true);
  expect(result.stopped.finite).toBe(true);
  expect(result.stopped.transitionDelta).toBeLessThanOrEqual(
    2 * Math.max(result.control.transitionDelta, result.control.attackDelta) + 0.002,
  );
  expect(result.stopped.lastAudible).toBeLessThanOrEqual(result.stopped.silenceAt + 0.05);
  expect(result.stopped.activeVoicesAfterRender).toBe(0);
  expect(result.stopped.contextReleased).toBe(true);
});

test("Yoyodyne freezes, restores, recovers interruption, and closes its audio graph", async ({ page }) => {
  await installAudioContextProbe(page);
  await page.goto("/yoyodyne.html", { waitUntil: "networkidle" });
  const stage = page.locator("#noteStage");
  const audio = page.locator("#audioButton");
  await audio.click();
  await page.locator("#playButton").click();
  await expect(stage).toHaveAttribute("data-scheduler-state", "running");

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect(stage).toHaveAttribute("data-page-lifecycle", "cached");
  await expect(stage).toHaveAttribute("data-scheduler-state", "stopped");
  const frozenBeat = Number(await stage.getAttribute("data-position-beat"));
  await page.waitForTimeout(90);
  expect(Number(await stage.getAttribute("data-position-beat"))).toBeCloseTo(frozenBeat, 3);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(stage).toHaveAttribute("data-page-lifecycle", "restored");
  await expect(stage).toHaveAttribute("data-scheduler-state", "running");
  await expect.poll(async () => Number(await stage.getAttribute("data-position-beat"))).toBeGreaterThan(frozenBeat);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(stage).toHaveAttribute("data-page-lifecycle", "restored");
  await expect(stage).toHaveAttribute("data-scheduler-state", "stopped");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(stage).toHaveAttribute("data-scheduler-state", "running");

  await page.evaluate(() => window.__yoyodyneAudioContext.suspend());
  await expect.poll(() => page.evaluate(() => window.__yoyodyneAudioContext.state)).toBe("running");
  await expect(stage).toHaveAttribute("data-scheduler-state", "running");

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => window.__yoyodyneAudioContext.state)).toBe("closed");
});

test("Yoyodyne keeps stage and scrollable controls reachable on phones", async ({ browser }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto("/yoyodyne.html", { waitUntil: "networkidle" });
    await expect(page.locator("#noteStage")).toHaveAttribute("data-model-ready", "true");

    const metrics = await page.evaluate(() => {
      const panel = document.querySelector(".yoyodyne-panel");
      const stage = document.querySelector("#stageWrap");
      const audio = document.querySelector("#audioButton").getBoundingClientRect();
      const play = document.querySelector("#playButton").getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        panelClientHeight: panel.clientHeight,
        panelScrollHeight: panel.scrollHeight,
        panelOverflow: getComputedStyle(panel).overflowY,
        audioSize: [audio.width, audio.height],
        playSize: [play.width, play.height],
        stageHeight: stageRect.height,
        stageHit: document.elementFromPoint(
          stageRect.left + stageRect.width / 2,
          stageRect.top + stageRect.height / 2,
        )?.id,
      };
    });
    expect(metrics.documentWidth).toBe(metrics.viewportWidth);
    expect(metrics.panelOverflow).toBe("auto");
    expect(metrics.panelScrollHeight).toBeGreaterThan(metrics.panelClientHeight);
    expect(Math.min(...metrics.audioSize)).toBeGreaterThanOrEqual(48);
    expect(Math.min(...metrics.playSize)).toBeGreaterThanOrEqual(48);
    expect(metrics.stageHeight).toBeGreaterThanOrEqual(120);
    expect(metrics.stageHit).toBe("noteStage");

    await page.locator("#playButton").click();
    await expect(page.locator("#noteStage")).toHaveAttribute("data-transport", "playing");
    await page.setViewportSize(viewport.width < viewport.height
      ? { width: 844, height: 390 }
      : { width: 390, height: 844 });
    await expect(page.locator("#noteStage")).toHaveAttribute("data-transport", "playing");
    const rotatedMetrics = await page.evaluate(() => ({
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      stageHeight: document.querySelector("#stageWrap").getBoundingClientRect().height,
    }));
    expect(rotatedMetrics.documentWidth).toBe(rotatedMetrics.viewportWidth);
    expect(rotatedMetrics.stageHeight).toBeGreaterThanOrEqual(120);
    await page.locator("#stopButton").click();

    await page.locator("#resetAll").scrollIntoViewIfNeeded();
    const reachable = await page.locator("#resetAll").evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const panel = button.closest(".yoyodyne-panel").getBoundingClientRect();
      return rect.top >= panel.top - 1 && rect.bottom <= panel.bottom + 1;
    });
    expect(reachable).toBe(true);
    await context.close();
  }
});
