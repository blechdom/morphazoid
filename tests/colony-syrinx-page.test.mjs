import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createColonySyrinxState } from "../src/colony-syrinx.js";

const root = new URL("../", import.meta.url);

function percentile(values, amount) {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * amount)];
}

test("Colony Syrinx page exposes fixed organism slots, continuous contours, and generators", async () => {
  const html = await readFile(new URL("colony-syrinx.html", root), "utf8");
  const routeValves = html.match(/<button id="route-s\d-m\d"[^>]*>/g) ?? [];
  assert.equal((html.match(/\bdata-lung="\d+"/g) ?? []).length, 16);
  assert.equal((html.match(/\bid="fold\d+Meter"/g) ?? []).length, 8);
  assert.equal((html.match(/class="route-valve"/g) ?? []).length, 12);
  assert.equal(routeValves.filter((button) => /aria-pressed="true"/.test(button)).length, 9);
  assert.equal((html.match(/class="mouth-card mouth-[abc]"/g) ?? []).length, 3);
  assert.equal((html.match(/\bdata-vessel-lung="\d+"/g) ?? []).length, 16);
  assert.equal((html.match(/\bdata-vessel-source="\d+"/g) ?? []).length, 4);
  assert.equal((html.match(/\bdata-vessel-route="\d+-\d+"/g) ?? []).length, 12);
  assert.equal((html.match(/\bdata-vessel-mouth="\d+"/g) ?? []).length, 3);
  assert.equal((html.match(/id="colonySac[A-D]"/g) ?? []).length, 4);
  assert.equal((html.match(/href="#colonyGarden"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /class="sequence-lane mouth-[abc]"/);
  assert.doesNotMatch(html, /\bdata-step="\d+"/);
  assert.match(html, /id="contourLanes"[^>]*data-contour-count="6"/);
  assert.match(html, /One flowing breath, six continuous contours/);
  for (const id of [
    "lungCount",
    "throatCount",
    "mouthCount",
    "connectionDensity",
    "randomizeAllButton",
    "randomizeBodyButton",
    "randomizeRoutesButton",
    "randomizeMotionButton",
    "mutateMotionButton",
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="mediumSelect"[\s\S]*value="air"[\s\S]*value="hydraulic"[\s\S]*value="granular"/);
  assert.match(html, /id="playButton"[^>]*data-primary-transport/);
  assert.match(html, /class="colony-console control-rail"/);
  assert.match(html, /src="nav\.js"[\s\S]*src="colony-syrinx-app\.js"/);
});

test("controller owns valve MIDI, continuous breath, contour transport, generation, and panic", async () => {
  const source = await readFile(new URL("colony-syrinx-app.js", root), "utf8");
  assert.match(source, /const MIDI_BASE_NOTE = 48/);
  assert.match(source, /colonySyrinxRouteFromMidiNote\(note, midiBaseNote\)/);
  assert.match(source, /morphazoid:midi-input/);
  assert.match(source, /controller === 64/);
  assert.match(source, /controller === 120 \|\| controller === 123/);
  for (const type of ["configure", "breath", "transport", "panic"]) {
    assert.match(source, new RegExp(`type: "${type}"`));
  }
  assert.match(source, /colony-syrinx-pressure-network/);
  assert.match(source, /phonatorEnabled/);
  assert.match(source, /mouthEnabled/);
  assert.match(source, /alternateRoutes/);
  assert.match(source, /contourDurationSeconds/);
  assert.match(source, /contourPhase/);
  assert.match(source, /randomizeAllButton/);
  assert.match(source, /randomizeBodyButton/);
  assert.match(source, /randomizeRoutesButton/);
  assert.match(source, /randomizeMotionButton/);
  assert.match(source, /telemetry\.routeApertures/);
  assert.match(source, /telemetry\.contourValues/);
  assert.match(source, /sampleColonySyrinxContour\(contour, phase\)/);
  assert.match(source, /option\.dataset\.exactRate = "true"/);
  assert.match(source, /key === "p" \|\| key === " "/);
  assert.match(source, /masterGain\.gain\.value = 1/);
  assert.doesNotMatch(source, /masterGain\.gain\.setTargetAtTime/);
  assert.match(source, /function queueRouteStart\(index, velocity, owner\)/);
  assert.match(source, /if \(!ready \|\| \(owner && !keyOwners\.has\(owner\)\)\) return/);
  assert.match(source, /vessel\?\.classList\.toggle\(\s*"is-flowing"/);
  assert.match(source, /mouthVessels\[index\]\?\.classList\.toggle\("is-sounding"/);
});

test("telemetry CSS maps anatomy and the six contour editor lanes", async () => {
  const css = await readFile(new URL("colony-syrinx.css", root), "utf8");
  assert.match(css, /\.lung\.is-pressured/);
  assert.match(css, /--activity/);
  assert.match(css, /\.route-valve\.is-flowing/);
  assert.match(css, /--flow/);
  assert.match(css, /\.mouth-card\.is-sounding/);
  assert.match(css, /\.vessel-route\.is-open/);
  assert.match(css, /\.vessel-mouth\.is-sounding/);
  assert.match(css, /\.vessel-lung\.is-exhaling/);
  assert.match(css, /\.contour-lane/);
  assert.match(css, /\.contour-path/);
  assert.match(css, /\.contour-point/);
  assert.match(css, /\.generator-section/);
  assert.doesNotMatch(
    css,
    /\.colony-shell\.is-running \.vessel-route\.is-open/,
    "an open route must not masquerade as live flow",
  );
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("worklet continuously morphs one pressure flow, honors active organs, and panics cleanly", async () => {
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
    const processorSource = await readFile(
      new URL("../src/colony-syrinx-processor.js", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(processorSource, /AUTO_EXHALE_PATTERN|autoExhaleEnvelope/);
    assert.doesNotMatch(processorSource, /SOURCE_STEP_RATIOS|bankExhaleGates/);
    assert.match(processorSource, /interpolateMouthGesture/);
    assert.match(processorSource, /_updateContinuousBreathMotion/);

    const processorUrl = new URL("../src/colony-syrinx-processor.js", import.meta.url);
    processorUrl.searchParams.set("test", String(Date.now()));
    await import(processorUrl.href);
    assert.equal(registeredName, "colony-syrinx-pressure-network");
    assert.equal(typeof RegisteredProcessor, "function");

    const base = createColonySyrinxState();
    const configuration = createColonySyrinxState({
      seed: 4_321,
      breath: 0.82,
      contourDurationSeconds: 3.2,
      pressureGain: 1.5,
      crossCoupling: 0.38,
      colonyAmount: 0,
      leak: 0.08,
      valveSlewMs: 38,
      sequencerEnabled: true,
      level: 0.72,
      phonatorEnabled: [true, true, true, true],
      mouthEnabled: [true, true, true],
      routes: [
        [0.92, 0.48, 0.28],
        [0.62, 0.9, 0.46],
        [0.38, 0.72, 0.94],
        [0.84, 0.34, 0.76],
      ],
      alternateRoutes: [
        [0.3, 0.92, 0.7],
        [0.94, 0.32, 0.78],
        [0.82, 0.88, 0.24],
        [0.44, 0.96, 0.9],
      ],
      mouths: base.mouths.map((mouth, index) => ({
        ...mouth,
        opening: [0.82, 0.68, 0.58][index],
        slewMs: [92, 54, 24][index],
      })),
    });
    const processor = new RegisteredProcessor({
      processorOptions: {
        configuration,
        breathActive: false,
        playing: false,
        seed: configuration.seed,
      },
    });
    assert.equal(processor.breathActive, false);
    assert.equal(processor.transportPlaying, false);

    const render = (seconds, collect = false) => {
      const windowFrames = 2_400;
      const blocks = Math.ceil(seconds * 48_000 / 128);
      const windows = [];
      let windowSquares = 0;
      let windowSize = 0;
      let squareSum = 0;
      let frameCount = 0;
      let maximum = 0;
      for (let block = 0; block < blocks; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        assert.equal(processor.process([], [[left, right]]), true);
        for (let index = 0; index < left.length; index += 1) {
          assert.ok(Number.isFinite(left[index]));
          assert.ok(Number.isFinite(right[index]));
          maximum = Math.max(maximum, Math.abs(left[index]), Math.abs(right[index]));
          const squares = (left[index] ** 2 + right[index] ** 2) * 0.5;
          squareSum += squares;
          frameCount += 1;
          if (!collect) continue;
          windowSquares += squares;
          windowSize += 1;
          if (windowSize === windowFrames) {
            windows.push(Math.sqrt(windowSquares / windowSize));
            windowSquares = 0;
            windowSize = 0;
          }
        }
      }
      return {
        maximum,
        rms: Math.sqrt(squareSum / Math.max(1, frameCount)),
        windows,
      };
    };

    processor.port.onmessage({ data: { type: "transport", playing: true, reset: true } });
    render(2.4);
    const reportStart = telemetry.length;
    const flowing = render(4.8, true);
    const reports = telemetry.slice(reportStart).filter(({ type }) => type === "telemetry");
    assert.ok(flowing.maximum > 0.02 && flowing.maximum <= 0.920001);
    assert.ok(flowing.rms > 0.006);
    assert.ok(flowing.windows.length > 40);
    const p10 = percentile(flowing.windows, 0.1);
    const p90 = percentile(flowing.windows, 0.9);
    assert.ok(p10 > 1e-5, `continuous pressure must not contain silent attack gaps: ${p10}`);
    assert.ok(p10 > p90 * 0.002, `quiet windows must remain part of one flow: ${p10} / ${p90}`);
    assert.ok(p90 > p10 * 1.08, "the sustained flow still needs expressive dynamic motion");
    assert.ok(reports.length > 60);

    for (const report of reports) {
      assert.equal(report.lungs.length, 16);
      assert.equal(report.folds.length, 8);
      assert.equal(report.routes.length, 12);
      assert.equal(report.mouths.length, 3);
      assert.equal(report.exhales.length, 4);
      assert.equal(report.laneSteps.length, 6);
      assert.equal(report.lanePhases.length, 6);
      assert.equal(report.laneVelocities.length, 6);
      assert.equal(report.contourValues.length, 6);
      assert.equal(report.mouthFormantsHz.length, 3);
      assert.ok(report.exhales.filter((value) => value > 0.05).length >= 2);
      assert.ok(report.contourPhase >= 0 && report.contourPhase < 1);
    }

    const bankSpans = Array.from({ length: 4 }, (_, bank) => {
      const values = reports.map((report) => report.exhales[bank]);
      return Math.max(...values) - Math.min(...values);
    });
    assert.ok(bankSpans.every((span) => span > 0.04), `all banks must undulate: ${bankSpans}`);
    assert.ok(reports.some((report) => new Set(
      report.exhales.map((value) => value.toFixed(3)),
    ).size >= 3), "the banks need overlapping but staggered breath levels");

    const phaseDeltas = reports.slice(1).map((report, index) => (
      (report.contourPhase - reports[index].contourPhase + 1) % 1
    ));
    assert.ok(phaseDeltas.every((delta) => delta > 0 && delta < 0.08));
    const changingRoutes = Array.from({ length: 12 }, (_, route) => {
      const values = reports.map((report) => report.routeApertures[route]);
      return Math.max(...values) - Math.min(...values);
    }).filter((span) => span > 0.025).length;
    assert.ok(changingRoutes >= 6, `routing contour should bend many paths: ${changingRoutes}`);
    const routeJumps = reports.slice(1).flatMap((report, index) => (
      report.routeApertures.map((value, route) => Math.abs(value - reports[index].routeApertures[route]))
    ));
    assert.ok(Math.max(...routeJumps) < 0.32, "route morphing must slew rather than step");

    for (let mouth = 0; mouth < 3; mouth += 1) {
      const firstFormants = reports.map((report) => report.mouthFormantsHz[mouth][0]);
      assert.ok(new Set(firstFormants.map((value) => value.toFixed(2))).size > 12);
      const jumps = firstFormants.slice(1).map((value, index) => Math.abs(value - firstFormants[index]));
      assert.ok(Math.max(...jumps) < 1_400, `mouth ${mouth + 1} formants must interpolate`);
    }
    assert.equal(reports.at(-1).activeCounts.lungs, 16);
    assert.equal(reports.at(-1).activeCounts.phonators, 4);
    assert.equal(reports.at(-1).activeCounts.mouths, 3);
    assert.deepEqual(reports.at(-1).sourceModels, [
      "collision-roar",
      "split-syrinx",
      "pulse-membrane",
      "needle-syrinx",
    ]);
    const activeFrequencies = reports.at(-1).sourceFrequenciesHz.filter((value) => value > 0);
    assert.equal(activeFrequencies.length, 4);
    assert.ok(
      Math.max(...activeFrequencies) / Math.min(...activeFrequencies) > 3,
      "the sustained organism must retain four contrasting source registers",
    );

    processor.port.onmessage({ data: { type: "transport", playing: true, reset: true } });
    assert.equal(processor.runtime.timeSeconds, 0);
    assert.equal(processor.runtime.contourPhase, 0);
    processor._advancePressureNetwork(processor.controlQuantum);
    assert.ok(processor.runtime.contourPhase > 0 && processor.runtime.contourPhase < 0.01);
    const pausedPhase = processor.runtime.contourPhase;
    processor.port.onmessage({ data: { type: "transport", playing: false } });
    for (let index = 0; index < 12; index += 1) {
      processor._advancePressureNetwork(processor.controlQuantum);
    }
    assert.equal(processor.runtime.contourPhase, pausedPhase);
    processor.port.onmessage({ data: { type: "transport", playing: true } });
    processor._advancePressureNetwork(processor.controlQuantum);
    assert.ok(processor.runtime.contourPhase > pausedPhase);

    processor.port.onmessage({
      data: {
        type: "configure",
        configuration: {
          phonatorEnabled: [true, false, false, false],
          mouthEnabled: [true, false, false],
        },
      },
    });
    render(0.9);
    const reducedStart = telemetry.length;
    const reduced = render(0.6, true);
    const reducedReport = telemetry.slice(reducedStart).findLast(({ type }) => type === "telemetry");
    assert.ok(reduced.rms > 1e-5, "one connected throat and mouth should keep breathing");
    assert.equal(reducedReport.activeCounts.phonators, 1);
    assert.equal(reducedReport.activeCounts.mouths, 1);
    assert.ok(reducedReport.sourceFrequenciesHz.slice(1).every((value) => value === 0));
    assert.ok(reducedReport.routes.every((value, index) => index === 0 || value < 1e-5));
    assert.ok(reducedReport.mouthLoads.slice(1).every((value) => value === 0));

    processor.port.onmessage({
      data: {
        type: "configure",
        configuration: {
          phonatorEnabled: [false, false, false, false],
          mouthEnabled: [false, false, false],
        },
      },
    });
    render(0.8);
    const disabled = render(0.4, true);
    const disabledReport = telemetry.findLast(({ type }) => type === "telemetry");
    assert.ok(disabled.rms < 1e-6, `disabled sound organs must be silent: ${disabled.rms}`);
    assert.deepEqual(disabledReport.activeCounts, { lungs: 16, phonators: 0, mouths: 0, routes: 0 });
    assert.ok(processor.phonatorSources.every((source) => source === 0));

    processor.port.onmessage({ data: { type: "panic" } });
    assert.equal(processor.transportPlaying, false);
    assert.equal(processor.breathActive, false);
    assert.equal(processor.runtime.contourPhase, 0);
    assert.ok(processor.runtime.reservoirPressures.every((pressure) => pressure === 0));
    assert.ok(processor.runtime.routeFlows.every((flow) => flow === 0));
    assert.ok(processor.bankExhaleLevels.every((value) => value === 0));

    const seedFromPatch = new RegisteredProcessor({
      processorOptions: {
        configuration: createColonySyrinxState({ seed: 111 }),
        playing: true,
      },
    });
    seedFromPatch.port.onmessage({
      data: { type: "configure", patch: { seed: 222 } },
    });
    const seedFromBirth = new RegisteredProcessor({
      processorOptions: {
        configuration: createColonySyrinxState({ seed: 222 }),
        playing: true,
      },
    });
    let seedMaximumDifference = 0;
    let seededSquareSum = 0;
    let seededFrameCount = 0;
    for (let block = 0; block < 420; block += 1) {
      const patchedLeft = new Float32Array(128);
      const patchedRight = new Float32Array(128);
      const freshLeft = new Float32Array(128);
      const freshRight = new Float32Array(128);
      seedFromPatch.process([], [[patchedLeft, patchedRight]]);
      seedFromBirth.process([], [[freshLeft, freshRight]]);
      for (let index = 0; index < 128; index += 1) {
        seedMaximumDifference = Math.max(
          seedMaximumDifference,
          Math.abs(patchedLeft[index] - freshLeft[index]),
          Math.abs(patchedRight[index] - freshRight[index]),
        );
        seededSquareSum += patchedLeft[index] ** 2 + patchedRight[index] ** 2;
        seededFrameCount += 2;
      }
    }
    assert.ok(Math.sqrt(seededSquareSum / seededFrameCount) > 1e-4);
    assert.equal(seedMaximumDifference, 0, "a live seed must reproduce a creature born with that seed");

    const closedMatrix = Array.from({ length: 4 }, () => [0, 0, 0]);
    for (const mediumId of ["air", "water", "pellets"]) {
      const closedProcessor = new RegisteredProcessor({
        processorOptions: {
          configuration: createColonySyrinxState({
            seed: 991,
            mediumId,
            breath: 1,
            pressureGain: 3,
            level: 1,
            routes: closedMatrix,
            alternateRoutes: closedMatrix,
          }),
          playing: true,
        },
      });
      let closedSquareSum = 0;
      let closedPeak = 0;
      let closedFrameCount = 0;
      for (let block = 0; block < 300; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        closedProcessor.process([], [[left, right]]);
        if (block < 150) continue;
        for (let index = 0; index < 128; index += 1) {
          closedPeak = Math.max(closedPeak, Math.abs(left[index]), Math.abs(right[index]));
          closedSquareSum += left[index] ** 2 + right[index] ** 2;
          closedFrameCount += 2;
        }
      }
      const closedRms = Math.sqrt(closedSquareSum / closedFrameCount);
      assert.ok(closedPeak < 1e-7, `${mediumId} closed-route peak leaked: ${closedPeak}`);
      assert.ok(closedRms < 1e-8, `${mediumId} closed-route RMS leaked: ${closedRms}`);
      assert.ok(closedProcessor.phonatorSources.every((value) => value === 0));
    }

    globalThis.sampleRate = 384_000;
    const highRate = new RegisteredProcessor({
      processorOptions: { configuration, breathActive: false, playing: false },
    });
    assert.equal(highRate.sourceRate, 384_000);
    assert.equal(highRate.sourceStepsPerOutput, 1);
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});
