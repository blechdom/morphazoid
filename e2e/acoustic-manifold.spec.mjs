import fs from "node:fs/promises";

import { expect, test } from "@playwright/test";

function collectDiagnostics(page) {
  const diagnostics = [];
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`page: ${error.message}`));
  return diagnostics;
}

function ultrasonicPcmWave() {
  const sampleRate = 256_000;
  const frameCount = Math.round(sampleRate * 0.5);
  const output = Buffer.alloc(44 + frameCount * 2);
  output.write("RIFF", 0, 4, "ascii");
  output.writeUInt32LE(36 + frameCount * 2, 4);
  output.write("WAVE", 8, 4, "ascii");
  output.write("fmt ", 12, 4, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, 4, "ascii");
  output.writeUInt32LE(frameCount * 2, 40);
  for (let index = 0; index < frameCount; index += 1) {
    const time = index / sampleRate;
    const active = (time >= 0.05 && time < 0.065) || (time >= 0.12 && time < 0.14);
    const sample = active ? Math.sin(2 * Math.PI * 60_000 * time) * 0.7 : 0;
    output.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2);
  }
  return output;
}

test("procedural songbird and cricket sources share one playable graph", async ({ page }) => {
  const diagnostics = collectDiagnostics(page);
  const response = await page.goto("/acoustic-manifold.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);

  await expect(page.locator("html")).toHaveAttribute(
    "data-acoustic-manifold-ready",
    "true",
    { timeout: 20_000 },
  );
  await expect(page.locator("#analysis-profile")).toHaveValue("songbird");
  await expect(page.locator("#strophe-stat")).toHaveText("18");
  await expect(page.locator("#tone-stat")).not.toHaveText("0");
  await expect(page.locator("#manifold-canvas")).toHaveAttribute("data-acoustic-events", "18");
  await expect(page.locator("#manifold-canvas")).toHaveAttribute(
    "data-nightingale-node-encoding",
    "core-duration-shell-gap-relative-rms",
  );
  await expect(page.locator("#manifold-canvas")).toHaveAttribute(
    "data-nightingale-tone-frames",
    /[1-9]\d*/,
  );
  await expect(page.locator("#manifold-canvas")).toHaveAttribute(
    "data-nightingale-tone-candidates",
    /[1-9]\d*/,
  );
  await expect(page.locator("#recording-order button")).toHaveCount(18);
  await expect(page.locator("#recording-order button").first()).toContainText("S001");
  await expect(page.locator("#walk-rule")).toHaveValue("chronology");
  await expect(page.locator("#route-ribbon .route-empty")).toHaveText("Build a route from the graph");
  await expect(page.locator("#route-apply-state")).toHaveText("Build route");
  await expect(page.locator("#play-route")).toBeDisabled();
  await page.locator("#build-route").click();
  await expect(page.locator("#route-ribbon button")).toHaveCount(8);
  expect(await page.locator("#route-ribbon button").allTextContents()).toEqual([
    "S001", "S002", "S003", "S004", "S005", "S006", "S007", "S008",
  ]);
  await expect(page.locator("#selected-signal")).toBeVisible();
  await expect(page.locator("#selected-frame-beads circle")).not.toHaveCount(0);

  await page.locator("#built-in-source").selectOption("field-cricket-synthetic");
  await expect(page.locator("#analysis-profile")).toHaveValue("insect");
  await expect(page.locator("#status")).toContainText("not species recognition");
  await page.locator("#load-built-in").click();
  await expect(page.locator("#source-label")).toContainText("six-chirp", { timeout: 20_000 });
  await expect(page.locator("#strophe-stat")).toHaveText("6");
  await expect(page.locator("#manifold-canvas")).toHaveAttribute("data-acoustic-events", "6");
  await expect(page.locator("#recording-order button")).toHaveCount(6);
  await expect(page.locator("#status")).toContainText("not a classification");
  await expect(page.locator("#recording-order-note")).toContainText("C001 → C002");
  await expect(page.locator("#recorded-order-example")).toHaveText("C001 → C002");
  await page.locator("#build-route").click();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const download = await downloadPromise;
  const exported = JSON.parse(await fs.readFile(await download.path(), "utf8"));
  expect(exported.format).toBe("morphazoid-acoustic-manifold");
  expect(exported.profile.id).toBe("insect");
  expect(exported.classification.performed).toBe(false);
  expect(exported.multiscale.isMultifractalAnalysis).toBe(false);
  expect(exported.modelBoundary.sourceSamplesIncluded).toBe(false);
  expect(exported.modelBoundary.modelSegments).toHaveLength(exported.route.indices.length);
  expect(exported.route.seed).toBe(0x41434f55 + 350);
  expect(exported.route.surprise).toBe(0.35);
  expect(exported.route.gapSeconds).toBe(0.09);
  expect(exported.route.timeline).toHaveLength(exported.route.indices.length);
  expect(exported.route.eventIds.every((id) => /^C\d{3}$/.test(id))).toBe(true);
  expect(exported.route.stropheIds.every((id) => /^S\d{3}$/.test(id))).toBe(true);
  expect(exported.route.timeline.map((step) => step.eventId)).toEqual(exported.route.eventIds);
  expect(exported.edges.observedSuccession).toHaveLength(5);
  expect(diagnostics).toEqual([]);
});

test("the grouped libraries expose 68 profiles, twelve recordings, and searchable governed archive leads", async ({ page }) => {
  const diagnostics = collectDiagnostics(page);
  await page.goto("/acoustic-manifold.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-acoustic-manifold-ready",
    "true",
    { timeout: 20_000 },
  );

  await expect(page.locator("#analysis-profile option")).toHaveCount(68);
  await expect(page.locator("#analysis-profile optgroup")).toHaveCount(10);
  await expect(page.locator("#built-in-source option")).toHaveCount(14);
  await expect(page.locator("#built-in-source")).toContainText("coyote group yip-howls");
  await expect(page.locator("#built-in-source")).toContainText("dolphin vocalizations");
  await page.locator(".archive-library-method summary").click();
  await expect(page.locator("#archive-library article")).toHaveCount(27);
  await expect(page.locator('#archive-library article[data-archive-kind="community"]')).toHaveCount(5);
  await page.locator("#archive-search").fill("coyote");
  await expect(page.locator("#archive-results")).toHaveText(/3 of 27 collections shown/);
  await expect(page.locator('#archive-library article:not([hidden])')).toHaveCount(3);
  await page.locator("#archive-search").fill("dolphin");
  await expect(page.locator("#archive-results")).toHaveText(/6 of 27 collections shown/);
  await page.locator("#archive-group").selectOption("Downloadable research datasets");
  await expect(page.locator('#archive-library article:not([hidden])')).toHaveCount(3);
  await page.locator("#archive-search").fill("");
  await page.locator("#archive-group").selectOption("");
  await page.locator("#analysis-profile").selectOption("mouse-usv");
  await expect(page.locator("#profile-research-title")).toHaveText("Mouse ultrasonic syllables");
  await expect(page.locator("#profile-evidence a")).toHaveCount(2);
  await expect(page.locator("#source-compatibility")).toHaveAttribute("data-coverage", "limited");

  await page.locator("#audio-file").setInputFiles({
    name: "mouse-usv-256k.wav",
    mimeType: "audio/wav",
    buffer: ultrasonicPcmWave(),
  });
  await expect(page.locator("html")).toHaveAttribute(
    "data-acoustic-manifold-ready",
    "true",
    { timeout: 20_000 },
  );
  await expect(page.locator("#analysis-profile")).toHaveValue("mouse-usv");
  await expect(page.locator("#strophe-stat")).toHaveText("2");
  await expect(page.locator("#source-compatibility")).toHaveAttribute("data-coverage", "full");
  await expect(page.locator("#source-compatibility")).toContainText("256 kHz source-rate PCM WAV");
  await expect(page.locator("#status")).toContainText("not a classification");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#analysis-tuning > summary").click();
  await page.locator(".analysis-tuning-advanced > summary").click();
  await page.locator(".resynthesis-advanced summary").click();
  await page.locator(".profile-library-method summary").click();
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(diagnostics).toEqual([]);
});

test("the bundled coyote and dolphin recordings decode into playable event maps", async ({ page }) => {
  test.setTimeout(120_000);
  const diagnostics = collectDiagnostics(page);
  await page.goto("/acoustic-manifold.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-acoustic-manifold-ready",
    "true",
    { timeout: 20_000 },
  );

  for (const source of [
    {
      id: "coyote-chorus",
      profile: "coyote-group-yip-howl",
      label: "Coyote group",
    },
    {
      id: "dolphin-vocalizations",
      profile: "dolphin-whistle",
      label: "Dolphins",
    },
  ]) {
    await page.locator("#built-in-source").selectOption(source.id);
    await expect(page.locator("#analysis-profile")).toHaveValue(source.profile);
    await page.locator("#load-built-in").click();
    await expect(page.locator("#source-label")).toContainText(source.label, { timeout: 45_000 });
    await expect(page.locator("html")).toHaveAttribute(
      "data-acoustic-manifold-ready",
      "true",
      { timeout: 45_000 },
    );
    const eventCount = Number(await page.locator("#manifold-canvas").getAttribute("data-acoustic-events"));
    expect(eventCount).toBeGreaterThan(0);
    await expect(page.locator("#status")).toContainText("not a classification");
  }

  expect(diagnostics).toEqual([]);
});

test("3D route orders and beyond-source resynthesis export the played parameters", async ({ page }) => {
  const diagnostics = collectDiagnostics(page);
  await page.goto("/acoustic-manifold.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-acoustic-manifold-ready",
    "true",
    { timeout: 20_000 },
  );

  await page.locator("#walk-rule").selectOption("spatial-farthest");
  await page.locator("#build-route").click();
  await expect(page.locator("#status")).toContainText("spatial-farthest route");
  const outward = await page.locator("#route-ribbon button").allTextContents();
  expect(outward).toHaveLength(8);

  await page.locator("#reverse-route").click();
  const reversed = await page.locator("#route-ribbon button").allTextContents();
  expect(reversed).toEqual([...outward].reverse());

  await page.locator("#resynthesis-preset").selectOption("hyper-articulation");
  await expect(page.locator("#gesture-speed-out")).toHaveText("5.000×");
  await expect(page.locator("#pitch-shift-out")).toHaveText("+7 st");
  await expect(page.locator("#manifold-exaggeration-out")).toHaveText("3.00×");
  await expect(page.locator("#resynthesis-summary")).toHaveAttribute("data-mode", "extrapolated");
  await expect(page.locator("#resynthesis-summary strong")).toHaveText("EXTRAPOLATED MODEL");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const download = await downloadPromise;
  const exported = JSON.parse(await fs.readFile(await download.path(), "utf8"));
  expect(exported.route.rule).toBe("reverse-current:spatial-farthest");
  expect(exported.route.gapSeconds).toBe(0.015);
  expect(exported.resynthesis.speedRatio).toBe(5);
  expect(exported.resynthesis.pitchShiftSemitones).toBe(7);
  expect(exported.resynthesis.manifoldExaggeration).toBe(3);
  expect(exported.resynthesis.biologicalLimitClaimed).toBe(false);
  expect(exported.modelBoundary.modelSegments).toHaveLength(8);
  expect(exported.modelBoundary.modelSegments.every((segment) => (
    segment.resynthesis?.mapOffsets
    && segment.resynthesis.biologicalLimitClaimed === false
  ))).toBe(true);
  expect(diagnostics).toEqual([]);
});

test("analysis profiles can be tuned, reapplied, exported, and reset", async ({ page }) => {
  test.setTimeout(45_000);
  const diagnostics = collectDiagnostics(page);
  await page.goto("/acoustic-manifold.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-acoustic-manifold-ready",
    "true",
    { timeout: 20_000 },
  );

  await page.locator("#analysis-tuning > summary").click();
  await page.locator(".analysis-tuning-advanced > summary").click();
  await expect(page.locator("#analysis-tuning-state")).toContainText("PROFILE DEFAULTS");
  await expect(page.locator("#analysis-minimum-spectral-hz")).toHaveValue("250");
  await expect(page.locator("#analysis-gap-seconds")).toHaveValue("0.8");

  await page.locator("#analysis-minimum-spectral-hz").fill("500");
  await page.locator("#analysis-minimum-spectral-hz").press("Tab");
  await page.locator("#analysis-sequence-gap-seconds").fill("0");
  await page.locator("#analysis-sequence-gap-seconds").press("Tab");
  await expect(page.locator("#analysis-tuning-state")).toHaveText("CUSTOM · REANALYZE");
  await expect(page.locator("#strophe-stat")).toHaveText("—");
  await expect(page.locator("#play-route")).toBeDisabled();
  await expect(page.locator("#reanalyze")).toBeEnabled();

  await page.locator("#reanalyze").click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-acoustic-manifold-ready",
    "true",
    { timeout: 20_000 },
  );
  await expect(page.locator("#analysis-tuning-state")).toHaveText("CUSTOM · APPLIED");
  await expect(page.locator("#status")).toContainText("listener-tuned prior");
  await expect(page.locator("#manifold-canvas")).toHaveAttribute("data-acoustic-sequence-edges", "0");
  await page.locator("#build-route").click();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const download = await downloadPromise;
  const exported = JSON.parse(await fs.readFile(await download.path(), "utf8"));
  expect(exported.profile.parameterMode).toBe("listener-tuned");
  expect(exported.profile.tunedFields).toContain("minimumSpectralHz");
  expect(exported.profile.defaults.minimumSpectralHz).toBe(250);
  expect(exported.profile.requested.minimumSpectralHz).toBe(500);
  expect(exported.profile.effective.minimumSpectralHz).toBe(500);
  expect(exported.profile.sequenceGapSeconds).toBe(0);
  expect(exported.edges.observedSuccession.every((edge) => (
    edge.withinConfiguredSequence === false
  ))).toBe(true);

  await page.locator("#reset-analysis-parameters").click();
  await expect(page.locator("#analysis-tuning-state")).toHaveText("PROFILE DEFAULTS");
  await expect(page.locator("#analysis-minimum-spectral-hz")).toHaveValue("250");
  await expect(page.locator("#strophe-stat")).toHaveText("—");

  await page.locator("#analysis-profile").selectOption("passerine-window");
  await expect(page.locator("#analysis-pause-control")).toBeHidden();
  await expect(page.locator("#analysis-window-controls")).toBeVisible();
  await expect(page.locator("#analysis-fixed-window-seconds")).toHaveValue("3");
  await expect(page.locator("#analysis-minimum-event-label")).toHaveText("Keep partial tail ≥");

  await page.locator("#analysis-frame-size").selectOption("128");
  await page.locator("#analysis-hop-ratio").selectOption("0.0625");
  await expect(page.locator("#analysis-tuning-state")).toHaveText("ADJUST SETTINGS");
  await expect(page.locator("#analysis-parameter-summary")).toContainText("frame browser budget");
  await expect(page.locator("#reanalyze")).toBeDisabled();

  await page.locator("#reset-analysis-parameters").click();
  await page.locator("#analysis-fixed-window-seconds").fill("2");
  await page.locator("#analysis-fixed-window-seconds").press("Tab");
  await expect(page.locator("#analysis-minimum-event-seconds")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#analysis-parameter-summary")).toContainText("half the fixed-window length");
  await page.locator("#analysis-minimum-event-seconds").fill("0.5");
  await page.locator("#analysis-minimum-event-seconds").press("Tab");
  await page.locator("#analysis-fixed-window-overlap").fill("25");
  await page.locator("#analysis-fixed-window-overlap").press("Tab");
  await page.locator("#analysis-minimum-active-ratio").fill("5");
  await page.locator("#analysis-minimum-active-ratio").press("Tab");
  await expect(page.locator("#analysis-tuning-state")).toHaveText("CUSTOM · REANALYZE");
  await page.locator("#reanalyze").click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-acoustic-manifold-ready",
    "true",
    { timeout: 20_000 },
  );
  await expect(page.locator("#analysis-tuning-state")).toHaveText("CUSTOM · APPLIED");
  await page.locator("#build-route").click();

  const fixedDownloadPromise = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const fixedDownload = await fixedDownloadPromise;
  const fixedExport = JSON.parse(await fs.readFile(await fixedDownload.path(), "utf8"));
  expect(fixedExport.profile.segmentationMode).toBe("fixed-window");
  expect(fixedExport.profile.requested.fixedWindowSeconds).toBe(2);
  expect(fixedExport.profile.effective.fixedWindowSeconds).toBe(2);
  expect(fixedExport.profile.effective.fixedWindowOverlap).toBe(0.25);
  expect(fixedExport.profile.effective.minimumWindowActiveRatio).toBe(0.05);
  expect(diagnostics).toEqual([]);
});

test("microphone access starts only on click and a bounded fake capture is mapped after stop", async ({ page }) => {
  await page.addInitScript(() => {
    window.__acousticMicRequests = 0;
    const tracks = [{
      addEventListener() {},
      removeEventListener() {},
      stop() {},
    }];
    const stream = { getTracks: () => tracks };
    const mediaDevices = {
      addEventListener() {},
      removeEventListener() {},
      async enumerateDevices() {
        return [{ kind: "audioinput", deviceId: "fake-input", label: "Test microphone" }];
      },
      async getUserMedia(constraints) {
        window.__acousticMicRequests += 1;
        window.__acousticMicConstraints = constraints;
        return stream;
      },
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices,
    });

    class FakeAudioContext {
      constructor() {
        this.sampleRate = 48_000;
        this.state = "running";
        this.destination = {};
      }

      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }

      createScriptProcessor() {
        const node = {
          onaudioprocess: null,
          disconnect() {},
          connect() {
            let block = 0;
            const emit = () => {
              if (!node.onaudioprocess || block >= 34) return;
              const samples = new Float32Array(2_048);
              const active = block < 11 || block >= 24;
              if (active) {
                for (let index = 0; index < samples.length; index += 1) {
                  samples[index] = Math.sin((block * samples.length + index) * 0.17) * 0.32;
                }
              }
              node.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });
              block += 1;
              setTimeout(emit, 35);
            };
            setTimeout(emit, 35);
          },
        };
        return node;
      }

      createGain() {
        return { gain: { value: 1 }, connect() {}, disconnect() {} };
      }

      async close() {
        this.state = "closed";
      }
    }

    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: FakeAudioContext });
  });

  const diagnostics = collectDiagnostics(page);
  await page.goto("/acoustic-manifold.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-acoustic-manifold-ready", "true", { timeout: 20_000 });
  expect(await page.evaluate(() => window.__acousticMicRequests)).toBe(0);

  await page.locator("#analysis-profile").selectOption("general");
  await page.locator("#live-window-seconds").selectOption("10");
  await page.locator("#start-live-input").click();
  await expect(page.locator("#live-input-state")).toContainText("Recording", { timeout: 5_000 });
  await expect(page.locator("#live-input-device option")).toContainText(["System default", "Test microphone"]);
  expect(await page.evaluate(() => window.__acousticMicRequests)).toBe(1);
  expect(await page.evaluate(() => window.__acousticMicConstraints.audio.echoCancellation)).toBe(false);

  await expect.poll(
    () => page.locator("#live-input-state").textContent(),
    { timeout: 5_000 },
  ).toMatch(/Recording (?:0\.[6-9]|1\.)/);
  await page.locator("#capture-live-input").click();
  await expect(page.locator("#source-label")).toContainText("Live microphone capture", { timeout: 20_000 });
  await expect(page.locator("#live-input-state")).toContainText("Mapped", { timeout: 20_000 });
  await expect(page.locator("#analysis-profile")).toHaveValue("general");
  await expect(page.locator("#status")).toContainText("not a classification");
  expect(Number(await page.locator("#strophe-stat").textContent())).toBeGreaterThan(0);
  expect(diagnostics).toEqual([]);
});

test("a pending microphone permission request can be cancelled", async ({ page }) => {
  await page.addInitScript(() => {
    window.__acousticMicRequests = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        addEventListener() {},
        removeEventListener() {},
        enumerateDevices: async () => [],
        getUserMedia() {
          window.__acousticMicRequests += 1;
          return new Promise(() => {});
        },
      },
    });
  });

  await page.goto("/acoustic-manifold.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-acoustic-manifold-ready", "true", { timeout: 20_000 });
  await page.locator("#start-live-input").click();
  await expect(page.locator("#capture-live-input")).toBeEnabled();
  await expect(page.locator("#capture-live-input")).toHaveText("Cancel request");
  await page.locator("#capture-live-input").click();
  await expect(page.locator("#live-input-state")).toHaveText("Microphone request cancelled");
  await expect(page.locator("#start-live-input")).toBeEnabled();
  expect(await page.evaluate(() => window.__acousticMicRequests)).toBe(1);
});
