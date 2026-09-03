import { expect, test } from "@playwright/test";

async function graphTopology(canvas) {
  return canvas.evaluate((host) => ({
    graphPath: host.querySelector("[data-graph-path]")?.getAttribute("data-graph-path") ?? null,
    nodes: [...host.querySelectorAll("[data-device-node-id]")]
      .map((node) => `${node.getAttribute("data-device-node-id")}:${node.getAttribute("data-node-kind")}`)
      .sort(),
    edges: [...host.querySelectorAll("[data-edge-id][data-signal-type]")]
      .map((edge) => `${edge.getAttribute("data-edge-id")}:${edge.getAttribute("data-signal-type")}`)
      .sort(),
  }));
}

test("Morphazoid Composer views expose the same recursive typed patch", async ({ page }) => {
  const diagnostics = [];
  page.on("pageerror", (error) => diagnostics.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(message.text());
  });
  await page.goto("constellation.html", { waitUntil: "domcontentloaded" });

  const constellation = page.locator("#constellationCanvas");
  await expect(constellation).toBeVisible();
  await expect(constellation.locator("[data-graph-path]")).toBeVisible();
  const rootTopology = await graphTopology(constellation);
  expect(rootTopology.graphPath).toBeTruthy();
  expect(rootTopology.nodes.length).toBeGreaterThan(4);
  expect([...new Set(rootTopology.edges.map((edge) => edge.split(":").at(-1)))].sort()).toEqual([
    "audio",
    "control",
    "midi",
    "trigger",
  ]);
  await expect(constellation.locator('[data-node-kind="subgraph"]')).not.toHaveCount(0);
  await expect(constellation.locator('[data-signal-type="trigger"]')).not.toHaveCount(0);
  await expect(constellation.locator('[data-signal-type="audio"]')).not.toHaveCount(0);
  await expect(constellation.locator('[data-signal-type="control"]')).not.toHaveCount(0);
  await expect(constellation.locator('[data-signal-type="midi"]')).not.toHaveCount(0);
  await expect(constellation.locator(".constellation-signal-legend .is-midi")).toContainText("midi");

  await page.getByRole("tab", { name: /Live Flow/i }).click();
  const liveFlow = page.locator("#flowCanvas");
  await expect(liveFlow).toBeVisible();
  await expect(liveFlow.locator(".constellation-flow-ledger")).toBeVisible();
  expect(await graphTopology(liveFlow)).toEqual(rootTopology);

  await page.getByRole("tab", { name: /^Constellation/i }).click();
  const nestedGraph = constellation.locator('[data-device-node-id="synth"][data-node-kind="subgraph"]');
  await expect(nestedGraph).toContainText("Graph Synth");
  await nestedGraph.locator(".constellation-node-action").press("Enter");
  await expect(page.locator("#sectionTitle")).toHaveText("Graph Synth");
  await expect(page.locator("#graphBreadcrumb .graph-breadcrumb-item")).toHaveCount(2);
  await expect(page.locator("#graphBreadcrumb .graph-breadcrumb-item").last()).toBeDisabled();
  const childTopology = await graphTopology(constellation);
  expect(childTopology.graphPath).not.toBe(rootTopology.graphPath);
  expect(childTopology.nodes.some((node) => node.endsWith(":primitive"))).toBe(true);
  expect(childTopology.nodes.some((node) => node.endsWith(":port"))).toBe(true);

  await page.locator("#graphBreadcrumb").getByRole("button", { name: "Patch", exact: true }).click();
  await expect(constellation.locator("[data-graph-path]")).toHaveAttribute("data-graph-path", rootTopology.graphPath ?? "");

  await page.getByRole("tab", { name: /Projected Timeline/i }).click();
  const timeline = page.locator("#timelineCanvas");
  await expect(timeline).toBeVisible();
  await expect(timeline.locator("[data-projected-event-id]").first()).toBeVisible();
  const projectedSignals = await timeline.locator("[data-projected-event-id][data-signal-type]").evaluateAll((events) => (
    [...new Set(events.map((event) => event.getAttribute("data-signal-type")))].sort()
  ));
  expect(projectedSignals).toEqual(["control", "midi", "trigger"]);

  await page.getByRole("tab", { name: /^Constellation/i }).click();
  const beforeInsert = (await graphTopology(constellation)).nodes.length;
  const palette = page.locator("#instrumentBrowser");
  await palette.getByRole("button", { name: "effect", exact: true }).click();
  const filterCard = palette.locator('[data-device-id="filter"]');
  await expect(filterCard).toContainText("Filter Graph");
  await filterCard.getByRole("button", { name: "Insert graph", exact: true }).click();
  await expect(constellation.locator("[data-device-node-id]")).toHaveCount(beforeInsert + 1);
  await expect(constellation.locator('[data-device-node-id="filter"][data-node-kind="subgraph"]')).toBeVisible();
  await expect(page.locator("#inspector")).toContainText("Filter Graph");

  expect(diagnostics).toEqual([]);
});

test("Composer Studio exposes preset devices, four signal kinds, live analysis, surround, and record modes", async ({ page }) => {
  const diagnostics = [];
  await page.addInitScript(() => {
    globalThis.__composerMidiEvents = [];
    globalThis.__fakeMidiInput = {
      id: "composer-test-input",
      name: "Composer test input",
      manufacturer: "Morphazoid",
      state: "connected",
      connection: "open",
      onmidimessage: null,
    };
    globalThis.__fakeMidiOutput = {
      id: "composer-test-output",
      name: "Composer test output",
      manufacturer: "Morphazoid",
      state: "connected",
      connection: "open",
      clears: 0,
      scheduled: [],
      send(data, timestamp) {
        if (Number.isFinite(Number(timestamp))) this.scheduled.push({ data: [...data], timestamp });
      },
      clear() {
        this.clears += 1;
        this.scheduled = [];
      },
    };
    Object.defineProperty(globalThis.navigator, "requestMIDIAccess", {
      configurable: true,
      value: async () => ({
        inputs: new Map([[globalThis.__fakeMidiInput.id, globalThis.__fakeMidiInput]]),
        outputs: new Map([[globalThis.__fakeMidiOutput.id, globalThis.__fakeMidiOutput]]),
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    globalThis.addEventListener("morphazoid:composer-midi", (event) => {
      globalThis.__composerMidiEvents.push(event.detail);
    });
  });
  page.on("pageerror", (error) => diagnostics.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(message.text());
  });
  await page.goto("constellation.html", { waitUntil: "domcontentloaded" });

  const patchPreset = page.locator("#presetSelect");
  await patchPreset.selectOption("composer-studio");
  await expect(patchPreset).toHaveValue("composer-studio");
  await expect(page.locator("#presetDescription")).toContainText("shared-clock instrument, effect, MIDI, analysis, surround, and recording patch");

  const canvas = page.locator("#constellationCanvas");
  const studioTopology = await graphTopology(canvas);
  expect([...new Set(studioTopology.edges.map((edge) => edge.split(":").at(-1)))].sort()).toEqual([
    "audio",
    "control",
    "midi",
    "trigger",
  ]);
  for (const nodeId of [
    "master-clock",
    "midi-input",
    "midi-clock",
    "sync",
    "hiccup",
    "acid",
    "scope",
    "level",
    "spectrum",
    "frequency-midi",
    "fft",
    "surround",
  ]) {
    await expect(canvas.locator(`[data-device-node-id="${nodeId}"]`)).toHaveCount(1);
  }
  await expect(canvas.locator('[data-device-node-id="hiccup"]')).toContainText("Rubber Face");
  await expect(canvas.locator('[data-device-node-id="acid"]')).toContainText("Lysergic Ribbon");
  await expect(canvas.locator('[data-device-node-id="sync"]')).toContainText("Clock / MIDI sync");

  await canvas.locator('[data-device-node-id="hiccup"]').click();
  const devicePreset = page.locator("#inspector").getByRole("combobox", { name: "Device preset", exact: true });
  await expect(devicePreset).toHaveValue("rubber-face");
  await devicePreset.selectOption("humming-head");
  await expect(devicePreset).toHaveValue("humming-head");
  await expect(page.locator("#inspector")).toContainText("Hiccup Head physical-model preset: Humming head.");

  const palette = page.locator("#instrumentBrowser");
  await palette.getByRole("button", { name: "converter", exact: true }).click();
  await expect(palette.locator('[data-device-kind="converter"]')).toHaveCount(5);
  await expect(palette.locator('[data-device-id="frequency-to-midi"]')).toContainText("Frequency → MIDI");
  await expect(palette.locator('[data-device-id="audio-to-fft-bands"]')).toContainText("Audio → FFT Bands");
  await palette.getByRole("button", { name: "monitor", exact: true }).click();
  await expect(palette.locator('[data-device-kind="monitor"]')).toHaveCount(5);
  await expect(palette.locator('[data-device-id="scope"]')).toContainText("Oscilloscope");
  await expect(palette.locator('[data-device-id="spectrum"]')).toContainText("Spectrum / FFT");

  const scopeReadout = canvas.locator('[data-monitor-node-id="scope"][data-monitor-analysis="waveform"]');
  await expect(scopeReadout).toHaveCount(1);
  await expect(scopeReadout.locator(".constellation-monitor-wave")).toHaveCount(1);
  const levelReadout = canvas.locator('[data-monitor-node-id="level"][data-monitor-analysis="rms-peak"]');
  await expect(levelReadout.locator(".constellation-monitor-meter")).toHaveCount(1);
  const spectrumReadout = canvas.locator('[data-monitor-node-id="spectrum"][data-monitor-analysis="fft"]');
  await expect(spectrumReadout.locator(".constellation-monitor-spectrum")).toHaveCount(1);
  const converterReadout = canvas.locator('[data-monitor-node-id="frequency-midi"][data-monitor-analysis="frequency-to-midi"]');
  await expect(converterReadout.locator(".constellation-data-value")).toHaveCount(1);

  await page.locator("#outputRouteButton").click();
  await expect(page.locator("#inspector")).toContainText("7.1.4 surround");
  const layoutPreset = page.locator("#inspector").getByRole("combobox", { name: "Device preset", exact: true });
  await expect(layoutPreset).toHaveValue("7-4-1");
  await layoutPreset.selectOption("quad");
  await expect(layoutPreset).toHaveValue("quad");
  await expect(page.locator("#spatialState")).toContainText("Quad");

  const recordMode = page.locator("#recordMode");
  await expect(recordMode.locator("option")).toHaveText(["Stereo mix", "Individual stems"]);
  await recordMode.selectOption("stems");
  await expect(recordMode).toHaveValue("stems");
  await expect(page.locator("#liveStatus")).toHaveText("Individual stem recording selected.");
  await recordMode.selectOption("mix");
  await expect(recordMode).toHaveValue("mix");
  await expect(page.locator("#recordButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#recordButton")).toContainText("Record");
  await expect(page.locator("#recordState")).toHaveText(/ready|unavailable/);

  await page.locator("#midiButton").click();
  await expect(page.locator("#midiState")).not.toHaveText("off");
  await expect.poll(() => page.evaluate(() => typeof globalThis.__fakeMidiInput.onmidimessage)).toBe("function");
  await canvas.click({ position: { x: 30, y: 30 } });
  await page.keyboard.down("z");
  await page.waitForTimeout(80);
  await page.keyboard.up("z");
  await expect.poll(() => page.evaluate(() => globalThis.__composerMidiEvents.length)).toBeGreaterThan(0);

  const dividedClockNotes = await page.evaluate(() => {
    globalThis.__composerMidiEvents.length = 0;
    globalThis.__fakeMidiOutput.scheduled = [];
    for (let index = 0; index < 8; index += 1) {
      globalThis.__fakeMidiInput.onmidimessage({
        data: new Uint8Array([0xf8]),
        timeStamp: performance.now() + index,
      });
    }
    return globalThis.__composerMidiEvents.filter(({ bytes }) => (
      bytes.length >= 3 && (bytes[0] & 0xf0) === 0x90 && bytes[2] > 0
    )).map(({ event, bytes }) => ({
      bytes,
      id: event.id,
      note: event.note,
      liveRouteKey: event.liveRouteKey,
    }));
  });
  expect(dividedClockNotes).toHaveLength(2);
  const dividedClockOutput = await page.evaluate(() => {
    const messages = globalThis.__fakeMidiOutput.scheduled.map(({ data }) => data);
    return {
      clocks: messages.filter(([status]) => status === 0xf8).length,
      noteOns: messages.filter(([status, , velocity]) => (
        (status & 0xf0) === 0x90 && velocity > 0
      )).length,
      noteOffs: messages.filter(([status, , velocity]) => (
        (status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && velocity === 0)
      )).length,
    };
  });
  expect(dividedClockOutput).toEqual({ clocks: 8, noteOns: 2, noteOffs: 2 });

  await page.locator("#audioButton").click();
  await expect(page.locator("#audioState")).toHaveText("off");
  await page.evaluate(() => {
    globalThis.__fakeMidiOutput.clears = 0;
    globalThis.__fakeMidiOutput.scheduled = [];
    globalThis.__fakeMidiInput.onmidimessage({
      data: new Uint8Array([0x90, 60, 100]),
      timeStamp: performance.now(),
    });
  });
  await expect.poll(() => page.evaluate(() => globalThis.__fakeMidiOutput.scheduled.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => {
    const messages = globalThis.__fakeMidiOutput.scheduled.map(({ data }) => data);
    return {
      noteOns: messages.filter(([status, , velocity]) => (
        (status & 0xf0) === 0x90 && velocity > 0
      )).length,
      noteOffs: messages.filter(([status, , velocity]) => (
        (status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && velocity === 0)
      )).length,
    };
  })).toEqual({ noteOns: 1, noteOffs: 0 });
  await page.evaluate(() => {
    globalThis.__fakeMidiInput.onmidimessage({
      data: new Uint8Array([0x80, 60, 0]),
      timeStamp: performance.now(),
    });
  });
  await expect.poll(() => page.evaluate(() => {
    const messages = globalThis.__fakeMidiOutput.scheduled.map(({ data }) => data);
    return messages.filter(([status, , velocity]) => (
      (status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && velocity === 0)
    )).length;
  })).toBe(1);
  await canvas.locator('[data-device-node-id="hiccup"]').click();
  await page.locator("#inspector").getByRole("combobox", { name: "Device preset", exact: true }).selectOption("cavern-gob");
  await expect.poll(() => page.evaluate(() => globalThis.__fakeMidiOutput.clears)).toBeGreaterThan(0);
  expect(await page.evaluate(() => globalThis.__fakeMidiOutput.scheduled.length)).toBe(0);

  expect(diagnostics).toEqual([]);
});

test("Morphazoid Composer remains navigable across graph views in a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("constellation.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#constellationCanvas")).toBeVisible();
  await expect(page.locator("#constellationCanvas [data-device-node-id]").first()).toBeVisible();
  await expect(page.locator("#graphBreadcrumb")).toBeVisible();
  await expect(page.locator("#instrumentBrowser")).toBeVisible();
  await expect(page.locator("#instrumentBrowser .constellation-instrument-card").first()).toBeVisible();

  await page.getByRole("tab", { name: /Live Flow/i }).click();
  await expect(page.locator("#flowCanvas [data-graph-path]")).toBeVisible();
  await expect(page.locator("#flowCanvas .constellation-flow-ledger")).toBeVisible();

  await page.getByRole("tab", { name: /Projected Timeline/i }).click();
  await expect(page.locator("#timelineCanvas")).toBeVisible();
  await expect(page.locator("#timelineCanvas [data-projected-event-id]").first()).toBeVisible();
});

test("Composer audio and graph transport start only from explicit gestures", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("constellation.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#audioState")).toHaveText("off");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#transportPosition")).toHaveText(/CYCLE 1 · BEAT 1\.00/);

  await page.locator("#audioButton").click();
  await expect(page.locator("#audioState")).toHaveText("on", { timeout: 10_000 });
  await page.locator("#playButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playButton")).toContainText("Pause");
  await expect(page.locator("#liveStatus")).toContainText("Patch running");

  await page.locator("#stopButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#playButton")).toContainText("Run");
  await expect(page.locator("#transportPosition")).toHaveText(/CYCLE 1 · BEAT 1\.00/);
  expect(pageErrors).toEqual([]);
});
