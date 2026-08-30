import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createColonySyrinxState } from "../src/colony-syrinx.js";

const root = new URL("../", import.meta.url);

test("Colony Syrinx page exposes its complete playable anatomy", async () => {
  const html = await readFile(new URL("colony-syrinx.html", root), "utf8");
  const routeValves = html.match(/<button id="route-s\d-m\d"[^>]*>/g) ?? [];
  assert.equal((html.match(/\bdata-lung="\d+"/g) ?? []).length, 16);
  assert.equal((html.match(/\bid="fold\d+Meter"/g) ?? []).length, 8);
  assert.equal((html.match(/class="route-valve"/g) ?? []).length, 12);
  assert.equal(routeValves.filter((button) => /aria-pressed="true"/.test(button)).length, 9);
  assert.equal((html.match(/class="mouth-card mouth-[abc]"/g) ?? []).length, 3);
  assert.equal((html.match(/class="sequence-lane mouth-[abc]"/g) ?? []).length, 3);
  assert.equal((html.match(/\bdata-step="\d+"/g) ?? []).length, 48);
  assert.equal((html.match(/\bdata-vessel-lung="\d+"/g) ?? []).length, 16);
  assert.equal((html.match(/\bdata-vessel-source="\d+"/g) ?? []).length, 4);
  assert.equal((html.match(/\bdata-vessel-route="\d+-\d+"/g) ?? []).length, 12);
  assert.equal((html.match(/\bdata-vessel-mouth="\d+"/g) ?? []).length, 3);
  assert.equal((html.match(/id="colonySac[A-D]"/g) ?? []).length, 4);
  assert.equal((html.match(/href="#colonyGarden"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /id="colonyLobe"/);
  assert.match(html, /id="mediumSelect"[\s\S]*value="air"[\s\S]*value="hydraulic"[\s\S]*value="granular"/);
  assert.match(html, /id="playButton"[^>]*data-primary-transport/);
  assert.match(html, /class="colony-console control-rail"/);
  assert.match(html, /src="nav\.js"[\s\S]*src="colony-syrinx-app\.js"/);
});

test("controller owns exact valve MIDI, breath, transport, and panic messages", async () => {
  const source = await readFile(new URL("colony-syrinx-app.js", root), "utf8");
  assert.match(source, /const MIDI_BASE_NOTE = 48/);
  assert.match(source, /colonySyrinxRouteFromMidiNote\(note, midiBaseNote\)/);
  assert.match(source, /message\.type/);
  assert.match(source, /morphazoid:midi-input/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /controller === 64/);
  assert.match(source, /controller === 120 \|\| controller === 123/);
  assert.match(source, /type: "configure"/);
  assert.match(source, /type: "breath"/);
  assert.match(source, /type: "transport"/);
  assert.match(source, /type: "panic"/);
  assert.match(source, /colony-syrinx-pressure-network/);
  assert.match(
    source,
    /active: manualBreathingNow\(\)/,
    "manual breath and sustain must request the continuous-pressure override",
  );
  assert.match(source, /return breathActive \|\| sustainActive \|\| transportPlaying/);
  assert.match(source, /return breathActive \|\| sustainActive/);
  assert.match(
    source,
    /if \(!transportPlaying\) setTransport\(true, \{ reset: true \}\)/,
    "one Audio click must begin automatic pressure instead of leaving a silent graph",
  );
  assert.match(source, /telemetry\.routeApertures/);
  assert.match(source, /telemetry\.exhales/);
  assert.match(source, /vessel\?\.classList\.toggle\(\s*"is-flowing"/);
  assert.match(source, /mouthVessels\[index\]\?\.classList\.toggle\("is-sounding"/);
});

test("telemetry CSS maps pressure, flow, fold motion, mouth load, and reduced motion", async () => {
  const css = await readFile(new URL("colony-syrinx.css", root), "utf8");
  assert.match(css, /\.lung\.is-pressured/);
  assert.match(css, /--activity/);
  assert.match(css, /\.route-valve\.is-flowing/);
  assert.match(css, /--flow/);
  assert.match(css, /\.mouth-card\.is-sounding/);
  assert.match(css, /\.vessel-route\.is-open/);
  assert.match(css, /\.vessel-mouth\.is-sounding/);
  assert.match(css, /\.vessel-lung\.is-exhaling/);
  assert.match(css, /\.lung-garden-membranes use/);
  assert.match(css, /\.lung:nth-child\(4\) > i/);
  assert.doesNotMatch(
    css,
    /\.colony-shell\.is-running \.vessel-route\.is-open/,
    "a latched valve must stay visible without masquerading as active flow",
  );
  assert.match(css, /\.sequence-lane\.is-muted/);
  assert.match(css, /\.midi-learn-button\.is-learning/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("AudioWorklet renders finite stereo, staggered exhales, manual override, and panic", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let registeredName = "";
  let RegisteredProcessor = null;
  const telemetry = [];

  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage(message) { telemetry.push(message); },
      };
    }
  }

  globalThis.AudioWorkletProcessor = FakeAudioWorkletProcessor;
  globalThis.sampleRate = 48_000;
  globalThis.registerProcessor = (name, Processor) => {
    registeredName = name;
    RegisteredProcessor = Processor;
  };

  try {
    const processorUrl = new URL("../src/colony-syrinx-processor.js", import.meta.url);
    processorUrl.searchParams.set("test", String(Date.now()));
    await import(processorUrl.href);
    assert.equal(registeredName, "colony-syrinx-pressure-network");
    assert.equal(typeof RegisteredProcessor, "function");

    const configuration = createColonySyrinxState({
      breath: 1,
      sequencerEnabled: false,
      routes: Array.from({ length: 4 }, () => [1, 1, 1]),
      mouths: createColonySyrinxState().mouths.map((mouth) => ({ ...mouth, opening: 0.9 })),
    });
    const processor = new RegisteredProcessor({
      processorOptions: { configuration, breathActive: false, playing: false },
    });
    assert.equal(processor.breathActive, false, "hold-to-breathe must not puff on startup");
    processor.port.onmessage({ data: { type: "breath", active: true, value: 1 } });

    let energy = 0;
    for (let block = 0; block < 440; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([], [[left, right]]), true);
      for (let index = 0; index < left.length; index += 1) {
        assert.ok(Number.isFinite(left[index]));
        assert.ok(Number.isFinite(right[index]));
        energy += Math.abs(left[index]) + Math.abs(right[index]);
      }
    }
    assert.ok(energy > 0.01, "an open, pressurized manifold must radiate sound");
    const report = telemetry.findLast((message) => message.type === "telemetry");
    assert.equal(report?.lungs.length, 16);
    assert.equal(report?.folds.length, 8);
    assert.equal(report?.routes.length, 12);
    assert.equal(report?.mouths.length, 3);
    assert.equal(report?.exhales.length, 4);
    assert.equal(report?.laneSteps.length, 3);
    assert.deepEqual(report?.sourceModels, [
      "collision-roar",
      "split-syrinx",
      "pulse-membrane",
      "needle-syrinx",
    ]);
    assert.equal(report?.sourceFrequenciesHz.length, 4);
    assert.ok(report?.limiterGain > 0 && report?.limiterGain <= 1);

    processor.port.onmessage({ data: { type: "panic" } });
    assert.equal(processor.breathActive, false);
    assert.ok(processor.runtime.reservoirPressures.every((pressure) => pressure === 0));
    assert.ok(processor.runtime.routeFlows.every((flow) => flow === 0));

    const disconnected = new RegisteredProcessor({
      processorOptions: {
        configuration: createColonySyrinxState({
          breath: 1,
          sequencerEnabled: false,
          lungEnabled: Array(16).fill(false),
          routes: Array.from({ length: 4 }, () => [1, 1, 1]),
          mouths: createColonySyrinxState().mouths.map((mouth) => ({
            ...mouth,
            opening: 1,
          })),
        }),
        breathActive: true,
        playing: false,
      },
    });
    let disconnectedEnergy = 0;
    for (let block = 0; block < 96; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      disconnected.process([], [[left, right]]);
      for (let index = 0; index < left.length; index += 1) {
        disconnectedEnergy += left[index] ** 2 + right[index] ** 2;
      }
    }
    assert.ok(disconnected.runtime.reservoirPressures.every((pressure) => pressure === 0));
    assert.ok(disconnected.phonatorSources.every((source) => source === 0));
    assert.ok(
      disconnectedEnergy < 1e-10,
      "manual breath must not bypass disabled lungs or an empty pressure network",
    );

    globalThis.sampleRate = 384_000;
    const highRate = new RegisteredProcessor({
      processorOptions: { configuration, breathActive: false, playing: false },
    });
    assert.equal(highRate.sourceRate, 384_000);
    assert.equal(highRate.sourceStepsPerOutput, 1);
    globalThis.sampleRate = 48_000;

    const autoConfiguration = createColonySyrinxState({
      breath: 1,
      tempoBpm: 60,
      sequencerEnabled: false,
      colonyAmount: 0,
      crossCoupling: 0,
      valveSlewMs: 2,
      routes: Array.from({ length: 4 }, () => [1, 1, 1]),
      mouths: createColonySyrinxState().mouths.map((mouth) => ({
        ...mouth,
        opening: 1,
        slewMs: 2,
      })),
    });
    const automatic = new RegisteredProcessor({
      processorOptions: {
        configuration: autoConfiguration,
        breathActive: false,
        playing: false,
        seed: 1_234,
      },
    });
    automatic.port.onmessage({ data: { type: "transport", playing: true, reset: true } });

    const renderFrames = (frameCount, collectWindows = false) => {
      const windowFrames = 2_400;
      const windows = [];
      let squareSum = 0;
      let windowSize = 0;
      let maximum = 0;
      for (let rendered = 0; rendered < frameCount; rendered += 128) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        automatic.process([], [[left, right]]);
        for (let index = 0; index < left.length; index += 1) {
          assert.ok(Number.isFinite(left[index]));
          assert.ok(Number.isFinite(right[index]));
          maximum = Math.max(maximum, Math.abs(left[index]), Math.abs(right[index]));
          if (!collectWindows) continue;
          squareSum += (left[index] ** 2 + right[index] ** 2) * 0.5;
          windowSize += 1;
          if (windowSize === windowFrames) {
            windows.push(Math.sqrt(squareSum / windowSize));
            squareSum = 0;
            windowSize = 0;
          }
        }
      }
      return { maximum, windows };
    };

    renderFrames(4 * 48_000);
    const telemetryStart = telemetry.length;
    const measured = renderFrames(4 * 48_000, true);
    const exhaleReports = telemetry.slice(telemetryStart).filter((message) => (
      message.type === "telemetry" && Array.isArray(message.exhales)
    ));
    assert.ok(measured.maximum <= 0.920001);
    const sortedWindows = measured.windows.toSorted((left, right) => left - right);
    const p10 = sortedWindows[Math.floor((sortedWindows.length - 1) * 0.1)];
    const p90 = sortedWindows[Math.floor((sortedWindows.length - 1) * 0.9)];
    assert.ok(p90 > 0.01, "automatic exhales must remain clearly audible");
    assert.ok(p10 < p90 * 0.05, "automatic breathing needs a real quiet floor between events");
    assert.ok(
      measured.windows.filter((value) => value < p90 * 0.1).length / measured.windows.length >= 0.4,
      "at least forty percent of the phrase should be separated breath-space",
    );

    const expectedStarts = [0, 0.72, 1.58, 2.46];
    const expectedPeaks = [1, 0.8, 0.96, 1];
    const firstCrossings = Array(4).fill(null);
    const peaks = Array(4).fill(0);
    let longestRest = 0;
    let currentRest = 0;
    for (const exhale of exhaleReports) {
      const activeBanks = exhale.exhales.filter((value) => value > 0.01).length;
      assert.ok(activeBanks <= 1, "exhale banks must answer rather than overlap");
      if (activeBanks === 0) {
        currentRest += 1;
        longestRest = Math.max(longestRest, currentRest);
      } else currentRest = 0;
      exhale.exhales.forEach((value, index) => {
        peaks[index] = Math.max(peaks[index], value);
        if (firstCrossings[index] == null && value > 0.05) firstCrossings[index] = exhale.exhaleBeat;
      });
    }
    expectedStarts.forEach((start, index) => {
      assert.ok(Math.abs(firstCrossings[index] - start) <= 0.06);
      assert.ok(peaks[index] >= expectedPeaks[index] * 0.95);
    });
    assert.ok(longestRest >= 20, "the four-bank phrase must end with a demarcated group rest");

    automatic.autoExhaleBeat = 3;
    automatic.bankExhaleLevels.fill(0);
    automatic._advancePressureNetwork(400);
    assert.ok(automatic.runtime.routeTargets.every((value) => value === 0));
    const phaseBeforeManual = automatic.autoExhaleBeat;
    automatic.port.onmessage({ data: { type: "breath", active: true, value: 1 } });
    automatic._advancePressureNetwork(400);
    assert.ok(automatic.runtime.routeTargets.every((value) => value === 1));
    assert.ok(automatic.autoExhaleBeat > phaseBeforeManual);
    automatic.port.onmessage({ data: { type: "breath", active: false } });
    automatic._advancePressureNetwork(400);
    assert.ok(automatic.runtime.routeTargets.every((value) => value === 0));
    automatic.port.onmessage({ data: { type: "transport", playing: true, reset: true } });
    assert.equal(automatic.autoExhaleBeat, 0);
    assert.ok(automatic.bankExhaleLevels.every((value) => value === 0));

    const phraseConfiguration = createColonySyrinxState({
      mediumId: "air",
      breath: 0.68,
      breathRateBpm: 24 + 0.68 * 42,
      pressureGain: 0.48 + 0.68 * 1.72,
      crossCoupling: 0.32,
      colonyAmount: 0.28,
      gateHysteresis: 0.32,
      leak: 0.21,
      valveSlewMs: 18,
      tempoBpm: 118,
      stepsPerBeat: 4,
      swing: 0.14,
      sequencerEnabled: true,
      level: 1,
      phonators: [86, 133, 219, 347].map((frequencyHz, index) => ({
        frequencyHz,
        tension: [0.28, 0.43, 0.61, 0.78][index],
        closure: 0.62 - index * 0.055,
        asymmetry: [-0.16, 0.1, -0.08, 0.18][index],
        roughness: [0.31, 0.24, 0.17, 0.12][index],
      })),
      routes: [[1, 1, 0], [1, 1, 1], [0, 1, 1], [1, 0, 1]],
      mouths: [0, 1, 2].map((index) => ({
        id: ["maw", "speech", "click"][index],
        label: ["Subharmonic maw", "Vowel biter", "Needle scream"][index],
        opening: [0.74, 0.48, 0.48][index],
        tongueSize: [0.92, 0.58, 0.2][index],
        tonguePosition: [0.31, 0.58, 0.76][index],
        lipSize: [0.96, 0.54, 0.18][index],
        lipTension: [0.28, 0.56, 0.84][index],
        cavity: [0.9, 0.56, 0.2][index],
        resonanceHz: [118, 420, 1_480][index],
        pan: [-0.72, 0, 0.72][index],
        leak: [0.018, 0.012, 0.006][index],
        slewMs: [138, 62, 18][index],
      })),
      lanes: [
        { id: "maw", length: 13, rate: 1, muted: false, steps: [1, 0, 0, 0.48, 0, 0, 0.76, 0, 0, 0.38, 0, 0, 0.62, 0, 0, 0] },
        { id: "speech", length: 11, rate: 1.5, muted: false, steps: [0.82, 0, 0.42, 0, 1, 0, 0.58, 0.28, 0, 0.74, 0, 0, 0, 0, 0, 0] },
        { id: "click", length: 7, rate: 2, muted: false, steps: [1, 0.36, 0, 0.72, 0, 0.48, 0.86, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      ],
      sequence: Array.from({ length: 16 }, (_, index) => ({
        routeMask: (1 << 12) - 1,
        mouthGates: [1, 1, 1],
        accent: index % 4 === 0 ? 1 : index % 2 === 0 ? 0.82 : 0.66,
      })),
    });
    const phrase = new RegisteredProcessor({
      processorOptions: {
        configuration: phraseConfiguration,
        breathActive: false,
        playing: false,
        seed: 4_321,
      },
    });
    phrase.port.onmessage({ data: { type: "transport", playing: true, reset: true } });
    const eventSquares = Array(4).fill(0);
    const eventFrames = Array(4).fill(0);
    const eventMonoSquares = Array(4).fill(0);
    const eventDerivativeSquares = Array(4).fill(0);
    const eventCrossings = Array(4).fill(0);
    const eventPeaks = Array(4).fill(0);
    const previousMono = Array(4).fill(0);
    const hasPreviousMono = Array(4).fill(false);
    let measuredSampleSum = 0;
    let measuredSampleCount = 0;
    let ceilingRun = 0;
    let longestCeilingRun = 0;
    const renderPhrase = (seconds, collect = false) => {
      const frameCount = Math.ceil(seconds * 48_000 / 128) * 128;
      for (let rendered = 0; rendered < frameCount; rendered += 128) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        phrase.process([], [[left, right]]);
        if (!collect) continue;
        const activeBank = phrase.bankExhaleLevels.findIndex((value) => value > 0.01);
        if (activeBank < 0) hasPreviousMono.fill(false);
        for (let frame = 0; frame < left.length; frame += 1) {
          measuredSampleSum += left[frame] + right[frame];
          measuredSampleCount += 2;
          if (Math.max(Math.abs(left[frame]), Math.abs(right[frame])) > 0.918) {
            ceilingRun += 1;
            longestCeilingRun = Math.max(longestCeilingRun, ceilingRun);
          } else ceilingRun = 0;
          if (activeBank < 0) continue;
          eventSquares[activeBank] += (left[frame] ** 2 + right[frame] ** 2) * 0.5;
          eventFrames[activeBank] += 1;
          const mono = (left[frame] + right[frame]) * 0.5;
          eventMonoSquares[activeBank] += mono * mono;
          eventPeaks[activeBank] = Math.max(eventPeaks[activeBank], Math.abs(mono));
          if (hasPreviousMono[activeBank]) {
            const difference = mono - previousMono[activeBank];
            eventDerivativeSquares[activeBank] += difference * difference;
            if ((mono >= 0) !== (previousMono[activeBank] >= 0)) {
              eventCrossings[activeBank] += 1;
            }
          }
          previousMono[activeBank] = mono;
          hasPreviousMono[activeBank] = true;
        }
      }
    };
    const phraseSeconds = 4 * 60 / 118;
    renderPhrase(phraseSeconds * 2);
    renderPhrase(phraseSeconds * 4, true);
    const eventRms = eventSquares.map((square, index) => (
      Math.sqrt(square / Math.max(1, eventFrames[index]))
    ));
    const totalEventEnergy = eventSquares.reduce((sum, value) => sum + value, 0);
    const eventShares = eventSquares.map((value) => value / totalEventEnergy);
    const derivativeRatios = eventDerivativeSquares.map((value, index) => (
      Math.sqrt(value / Math.max(1e-18, eventMonoSquares[index]))
    ));
    const crossingRatesHz = eventCrossings.map((value, index) => (
      value * 48_000 / Math.max(1, eventFrames[index]) / 2
    ));
    const eventCrests = eventPeaks.map((value, index) => (
      value / Math.max(1e-9, Math.sqrt(eventMonoSquares[index] / eventFrames[index]))
    ));
    assert.ok(
      eventRms.every((value) => value > 0.025),
      `every default reservoir exhale must be audible: ${eventRms.join(", ")}`,
    );
    assert.ok(
      eventShares.every((value) => value > 0.08 && value < 0.45),
      `every freak source must own part of the phrase: ${eventShares.join(", ")}`,
    );
    assert.ok(
      derivativeRatios[0] < 0.55
        && derivativeRatios.filter((value) => value > 0.65).length >= 2,
      `the maw and bright mouths need different spectral slopes: ${derivativeRatios.join(", ")}`,
    );
    assert.ok(
      Math.max(...crossingRatesHz) / Math.max(1, Math.min(...crossingRatesHz)) > 2,
      `paired sources must occupy contrasting registers: ${crossingRatesHz.join(", ")}`,
    );
    assert.ok(
      eventCrests.some((value) => value > 3.2),
      `at least one mouth must produce a pressure-release transient: ${eventCrests.join(", ")}`,
    );
    assert.ok(
      Math.abs(measuredSampleSum / measuredSampleCount) < 0.002,
      "the aggressive patch still needs negligible DC",
    );
    assert.ok(longestCeilingRun <= 3, "the limiter must not hide sustained clipping");
    assert.ok(phrase.limitedShare < 0.01, "automatic phrasing should rarely touch the limiter");
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});
