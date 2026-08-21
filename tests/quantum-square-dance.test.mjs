import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS,
  DEFAULT_SQUARE_DANCE_SETTINGS,
  PHYSICAL_EXCHANGE_CYCLE_SECONDS,
  SQUARE_DANCE_BASIS,
  SQUARE_DANCE_PREPARATIONS,
  createSquareDanceRandom,
  deriveSquareDanceSound,
  exchangeDensityMatrix,
  exchangeState,
  normalizeSquareDanceSettings,
  sampleSquareDance,
  simulateSquareDance,
  squareDanceCall,
  timeLensDiagnostics,
} from "../src/quantum-square-dance.js";

const TOLERANCE = 1e-11;
const TAU = Math.PI * 2;

function close(actual, expected, tolerance = TOLERANCE, message = "") {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message || `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function closeArray(actual, expected, tolerance = TOLERANCE) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => close(value, expected[index], tolerance));
}

function amplitudePower(amplitude) {
  return amplitude.re ** 2 + amplitude.im ** 2;
}

test("public constants preserve the measured exchange period and safe defaults", () => {
  assert.equal(PHYSICAL_EXCHANGE_CYCLE_SECONDS, 285e-6);
  assert.deepEqual(SQUARE_DANCE_BASIS, ["00", "01", "10", "11"]);
  assert.deepEqual(SQUARE_DANCE_PREPARATIONS, [
    "up-down",
    "down-up",
    "up-up",
    "down-down",
  ]);
  assert.deepEqual(DEFAULT_SQUARE_DANCE_SETTINGS, {
    preparation: "up-down",
    exchangeAngle: 0,
    visibility: 1,
  });
  assert.ok(Object.isFrozen(DEFAULT_SQUARE_DANCE_SETTINGS));
  assert.ok(Object.isFrozen(DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS));
});

test("settings normalize aliases, phase, full-cycle endpoint, and visibility", () => {
  const negative = normalizeSquareDanceSettings({
    preparation: "↑↓",
    theta: -Math.PI / 2,
    coherenceVisibility: 9,
  });
  assert.deepEqual(negative, {
    preparation: "up-down",
    exchangeAngle: 3 * Math.PI / 2,
    visibility: 1,
  });

  const phase = normalizeSquareDanceSettings({
    preparation: "10",
    cyclePhase: 1.25,
    visibility: -3,
  });
  assert.equal(phase.preparation, "down-up");
  close(phase.exchangeAngle, Math.PI / 2);
  assert.equal(phase.visibility, 0);

  assert.equal(normalizeSquareDanceSettings({ exchangeAngle: TAU }).exchangeAngle, TAU);
  assert.equal(normalizeSquareDanceSettings({ exchangeAngle: TAU * 2 }).exchangeAngle, TAU);
  assert.deepEqual(normalizeSquareDanceSettings({ preparation: "unknown", exchangeAngle: NaN }), {
    preparation: "up-down",
    exchangeAngle: 0,
    visibility: 1,
  });
});

test("the default ideal state follows the Anderlini exchange truth table exactly", () => {
  const initial = exchangeState(0, "up-down");
  assert.deepEqual(initial, [
    { re: 0, im: 0 },
    { re: 1, im: 0 },
    { re: 0, im: 0 },
    { re: 0, im: 0 },
  ]);

  const halfSwap = exchangeState(Math.PI / 2, "up-down");
  close(halfSwap[1].re, Math.SQRT1_2);
  close(halfSwap[1].im, 0);
  close(halfSwap[2].re, 0);
  close(halfSwap[2].im, -Math.SQRT1_2);

  const fullSwap = exchangeState(Math.PI, "up-down");
  close(fullSwap[1].re, 0);
  close(fullSwap[2].im, -1);

  const returned = exchangeState(TAU, "up-down");
  close(returned[1].re, -1);
  close(returned.reduce((sum, value) => sum + amplitudePower(value), 0), 1);
});

test("down-up traverses the same exchange with the opposite coherent contour", () => {
  const forward = simulateSquareDance({
    preparation: "up-down",
    exchangeAngle: Math.PI / 2,
    visibility: 0.4,
  });
  const reverse = simulateSquareDance({
    preparation: "down-up",
    exchangeAngle: Math.PI / 2,
    visibility: 0.4,
  });

  closeArray(forward.probabilities, [0, 0.5, 0.5, 0]);
  closeArray(reverse.probabilities, [0, 0.5, 0.5, 0]);
  close(forward.coherence.im, 0.2);
  close(reverse.coherence.im, -0.2);
  close(forward.observables.xy, 0.4);
  close(reverse.observables.xy, -0.4);
  close(forward.concurrence, reverse.concurrence);
  assert.equal(forward.exchangeDirection, 1);
  assert.equal(reverse.exchangeDirection, -1);

  const reverseState = exchangeState(Math.PI / 2, "down-up");
  close(reverseState[1].im, -Math.SQRT1_2);
  close(reverseState[2].re, Math.SQRT1_2);
});

test("aligned preparations never swap, entangle, or acquire exchange coherence", () => {
  for (const [preparation, basisIndex, zz, localZ] of [
    ["up-up", 0, 1, 1],
    ["down-down", 3, 1, -1],
  ]) {
    for (const angle of [0, Math.PI / 7, Math.PI / 2, Math.PI, 1.73 * Math.PI, TAU]) {
      for (const visibility of [0, 0.23, 1]) {
        const diagnostics = simulateSquareDance({ preparation, exchangeAngle: angle, visibility });
        const expected = [0, 0, 0, 0];
        expected[basisIndex] = 1;
        closeArray(diagnostics.probabilities, expected);
        close(diagnostics.concurrence, 0);
        close(diagnostics.entanglementOfFormation, 0);
        close(diagnostics.coherence.magnitude, 0);
        close(diagnostics.jointPurity, 1);
        close(diagnostics.reducedPurity.excited, 1);
        close(diagnostics.reducedPurity.ground, 1);
        close(diagnostics.localEntropy.excited, 0);
        close(diagnostics.localEntropy.ground, 0);
        close(diagnostics.observables.zz, zz);
        close(diagnostics.observables.xy, 0);
        close(diagnostics.observables.zExcited, localZ);
        close(diagnostics.observables.zGround, localZ);
        assert.equal(diagnostics.timeline.stage, "aligned");
      }
    }
  }
});

test("visibility damps only off-diagonal exchange coherence", () => {
  const coherent = simulateSquareDance({ exchangeAngle: Math.PI / 3, visibility: 1 });
  const partial = simulateSquareDance({ exchangeAngle: Math.PI / 3, visibility: 0.25 });
  const incoherent = simulateSquareDance({ exchangeAngle: Math.PI / 3, visibility: 0 });

  closeArray(coherent.probabilities, [0, 0.75, 0.25, 0]);
  closeArray(partial.probabilities, coherent.probabilities);
  closeArray(incoherent.probabilities, coherent.probabilities);
  close(partial.coherence.im, coherent.coherence.im * 0.25);
  close(incoherent.coherence.magnitude, 0);
  close(partial.concurrence, 0.25 * Math.sin(Math.PI / 3));
  close(incoherent.concurrence, 0);

  const density = exchangeDensityMatrix(Math.PI / 3, 0.25, "up-down");
  close(density[1][1].re, 0.75);
  close(density[2][2].re, 0.25);
  close(density[1][2].im, Math.sin(Math.PI / 3) * 0.25 / 2);
  close(density[2][1].im, -density[1][2].im);
});

test("concurrence, entropy, observables, and purities match closed-form invariants", () => {
  for (const preparation of ["up-down", "down-up"]) {
    const direction = preparation === "up-down" ? 1 : -1;
    for (const angle of [0, Math.PI / 9, Math.PI / 2, Math.PI, 1.41 * Math.PI, TAU]) {
      for (const visibility of [0, 0.17, 0.6, 1]) {
        const diagnostics = simulateSquareDance({ preparation, exchangeAngle: angle, visibility });
        const sine = Math.sin(angle);
        close(diagnostics.concurrence, visibility * Math.abs(sine));
        close(diagnostics.observables.zz, -1);
        close(diagnostics.observables.xy, visibility * direction * sine);
        close(diagnostics.observables.yx, -visibility * direction * sine);
        close(diagnostics.reducedPurity.excited, 1 - 0.5 * sine ** 2);
        close(diagnostics.reducedPurity.ground, 1 - 0.5 * sine ** 2);
        close(diagnostics.jointPurity, 1 - 0.5 * (1 - visibility ** 2) * sine ** 2);
        close(diagnostics.invariants.trace, 1);
        close(diagnostics.invariants.stateNorm, 1);
        close(diagnostics.invariants.hermitianError, 0);
        assert.ok(diagnostics.invariants.minimumEigenvalue >= -TOLERANCE);
        assert.equal(diagnostics.invariants.normalized, true);
        assert.equal(diagnostics.invariants.hermitian, true);
        assert.equal(diagnostics.invariants.positiveSemidefinite, true);
      }
    }
  }
});

test("local mixedness is not mislabeled as entanglement after full dephasing", () => {
  const pureHalfSwap = simulateSquareDance({ exchangeAngle: Math.PI / 2, visibility: 1 });
  close(pureHalfSwap.concurrence, 1);
  close(pureHalfSwap.entanglementOfFormation, 1);
  close(pureHalfSwap.localEntropy.excited, 1);
  close(pureHalfSwap.localEntropy.ground, 1);
  close(pureHalfSwap.reducedPurity.excited, 0.5);
  close(pureHalfSwap.jointPurity, 1);

  const classicalMixture = simulateSquareDance({ exchangeAngle: Math.PI / 2, visibility: 0 });
  close(classicalMixture.concurrence, 0);
  close(classicalMixture.entanglementOfFormation, 0);
  close(classicalMixture.localEntropy.excited, 1);
  close(classicalMixture.reducedPurity.excited, 0.5);
  close(classicalMixture.jointPurity, 0.5);
  closeArray(classicalMixture.densityEigenvalues, [0, 0, 0.5, 0.5]);
  assert.equal(classicalMixture.interpretation.populationsAloneProveEntanglement, false);
});

test("seeded ensemble shots are repeatable, normalized, and basis-limited", () => {
  const diagnostics = simulateSquareDance({ exchangeAngle: Math.PI / 2 });
  const first = sampleSquareDance(diagnostics, { shots: 128, seed: "same floor" });
  const second = sampleSquareDance(diagnostics, { shots: 128, seed: "same floor" });
  const third = sampleSquareDance(diagnostics, { shots: 128, seed: "another floor" });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.outcomes, third.outcomes);
  assert.equal(first.outcomes.length, 128);
  assert.equal(Object.values(first.counts).reduce((sum, count) => sum + count, 0), 128);
  close(Object.values(first.frequencies).reduce((sum, frequency) => sum + frequency, 0), 1);
  assert.ok(first.outcomes.every((outcome) => outcome === "01" || outcome === "10"));
  assert.equal(first.counts["00"], 0);
  assert.equal(first.counts["11"], 0);
  assert.equal(first.empiricalZZ, -1);

  const aligned = sampleSquareDance(
    simulateSquareDance({ preparation: "up-up", exchangeAngle: Math.PI / 2 }),
    { shots: 31, seed: 7 },
  );
  assert.deepEqual(aligned.counts, { "00": 31, "01": 0, "10": 0, "11": 0 });

  const randomA = createSquareDanceRandom("repeatable");
  const randomB = createSquareDanceRandom("repeatable");
  assert.deepEqual(
    Array.from({ length: 16 }, () => randomA()),
    Array.from({ length: 16 }, () => randomB()),
  );
});

test("timeline landmarks and square-dance calls describe the exact exchange stages", () => {
  const stages = [
    [0, "prepared", "Honor your partner"],
    [Math.PI / 2, "sqrt-swap", "Half-swap, branches balanced"],
    [Math.PI, "swapped", "Trade spin roles"],
    [3 * Math.PI / 2, "sqrt-swap-return", "Half-swap on the return"],
    [TAU, "returned", "Home with your partner"],
  ];
  for (const [exchangeAngle, stage, call] of stages) {
    const diagnostics = simulateSquareDance({ exchangeAngle });
    assert.equal(diagnostics.timeline.stage, stage);
    assert.equal(squareDanceCall(diagnostics).call, call);
  }
  assert.equal(
    squareDanceCall(simulateSquareDance({ exchangeAngle: Math.PI / 4 })).id,
    "entangling",
  );
  assert.equal(
    squareDanceCall(simulateSquareDance({ preparation: "down-down", exchangeAngle: Math.PI / 2 })).id,
    "aligned",
  );
  assert.throws(() => squareDanceCall({}), /simulateSquareDance/);
});

test("the 7000x musical time lens keeps every physical landmark explicit", () => {
  const lens = timeLensDiagnostics(2);
  close(lens.physicalCycleSeconds, 285e-6);
  close(lens.physicalCycleMicroseconds, 285);
  close(lens.physicalExchangeFrequencyHz, 1 / 285e-6);
  close(lens.sqrtSwapPhysicalSeconds, 71.25e-6);
  close(lens.fullSwapPhysicalSeconds, 142.5e-6);
  close(lens.sqrtSwapMusicalSeconds, 0.5);
  close(lens.fullSwapMusicalSeconds, 1);
  close(lens.timeLens, 2 / 285e-6);
  close(lens.fourBeatTempoBpm, 120);
  assert.deepEqual(timeLensDiagnostics(0), lens);
});

test("sonification keeps population, coherence, contour, space, rhythm, and proof roles separate", () => {
  const angle = Math.PI / 3;
  const forwardDiagnostics = simulateSquareDance({
    preparation: "up-down",
    exchangeAngle: angle,
    visibility: 0.5,
  });
  const reverseDiagnostics = simulateSquareDance({
    preparation: "down-up",
    exchangeAngle: angle,
    visibility: 0.5,
  });
  const forward = deriveSquareDanceSound(forwardDiagnostics);
  const reverse = deriveSquareDanceSound(reverseDiagnostics);

  close(forward.branches.stay.probability, 0.75);
  close(forward.branches.swap.probability, 0.25);
  close(forward.branches.stay.gain, 0.72 * Math.sqrt(0.75));
  close(forward.branches.swap.gain, 0.72 * 0.5);
  assert.equal(forward.branches.stay.basis, "01");
  assert.equal(forward.branches.swap.basis, "10");
  assert.equal(reverse.branches.stay.basis, "10");
  assert.equal(reverse.branches.swap.basis, "01");
  close(forward.contour.position, -reverse.contour.position);
  close(forward.contour.coherentFlow, -reverse.contour.coherentFlow);
  assert.equal(forward.contour.direction, 1);
  assert.equal(reverse.contour.direction, -1);
  close(forward.spatialRoles.excited.up + forward.spatialRoles.excited.down, 1);
  close(forward.spatialRoles.ground.up + forward.spatialRoles.ground.down, 1);
  assert.ok(forward.spatialRoles.excited.pan < 0);
  assert.ok(forward.spatialRoles.ground.pan > 0);
  close(forward.tempo.bpm, 120);
  assert.equal(forward.rhythm.steps.length, 8);
  assert.equal(forward.rhythm.activeStep, 1);
  close(forward.interference.normalizedCoherence, forwardDiagnostics.concurrence);
  assert.equal(forward.scientificGuardrail.populationsAloneProveEntanglement, false);
  assert.equal(forward.scientificGuardrail.populationPowerSeparatedFromCoherence, true);
});

test("dephasing changes only the sound coherence layer, not branch power", () => {
  const coherent = deriveSquareDanceSound(simulateSquareDance({
    exchangeAngle: Math.PI / 2,
    visibility: 1,
  }));
  const dephased = deriveSquareDanceSound(simulateSquareDance({
    exchangeAngle: Math.PI / 2,
    visibility: 0,
  }));
  assert.deepEqual(coherent.branches, dephased.branches);
  close(coherent.interference.normalizedCoherence, 1);
  close(dephased.interference.normalizedCoherence, 0);
  close(coherent.dynamics.coherenceGain, 0.72);
  close(dephased.dynamics.coherenceGain, 0);
  close(dephased.rhythm.coherenceWeight, 0);

  const aligned = deriveSquareDanceSound(simulateSquareDance({
    preparation: "up-up",
    exchangeAngle: Math.PI / 2,
  }));
  close(aligned.branches.stay.probability, 1);
  close(aligned.branches.swap.probability, 0);
  close(aligned.branches.swap.gain, 0);
  assert.equal(aligned.contour.direction, 0);
  assert.ok(aligned.rhythm.steps.every((step) => (
    step.stayWeight === 1 && step.swapWeight === 0 && step.coherenceWeight === 0
  )));
});

test("the scientific core remains import-safe and free of browser/audio side effects", async () => {
  const source = await readFile(new URL("../src/quantum-square-dance.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|AudioContext|webkitAudioContext/);
  assert.doesNotMatch(source, /Math\.random|setTimeout|setInterval|requestAnimationFrame/);
});

test("the page presents the physical exchange experiment, exact caveats, and accessible controls", async () => {
  const html = await readFile(new URL("../quantum-square-dance.html", import.meta.url), "utf8");
  assert.match(html, /<link rel="stylesheet" href="style\.css"/);
  assert.match(html, /<link rel="stylesheet" href="quantum-synths\.css"/);
  assert.match(html, /<body class="quantum-page quantum-square-dance-page">/);
  assert.match(html, /<main class="shell quantum-shell square-dance-shell" id="quantumSquareDance">/);
  assert.match(html, /QUANTUM SYNTHS · 04/);
  assert.match(html, /<h1 id="squareDanceTitle">Quantum Square Dance<\/h1>/);
  assert.match(html, /EXCHANGE PAIRS · √SWAP ENTANGLEMENT · MUSICAL TIME LENS/);
  assert.match(html, /Exact ideal two-state classical simulation · not a QPU or audio emitted by atoms/);
  assert.match(html, /Partners exchange spin states—not places on a drawn square/);
  assert.match(html, /50\/50 populations alone do not prove entanglement/);
  assert.match(html, /There is no faster-than-light signal/);
  assert.match(html, /about 60,000 rubidium-87 atoms/);
  assert.match(html, /285\(1\) μs/);
  assert.match(html, /href="https:\/\/arxiv\.org\/abs\/0708\.2073"/);
  assert.match(html, /href="https:\/\/doi\.org\/10\.1038\/nature06011"/);
  assert.match(html, /href="bell-square\.html"/);
  assert.match(html, /id="playButton"[\s\S]*?data-primary-transport[\s\S]*?data-no-midi-preview/);
  assert.match(html, /id="exchangePhase"[\s\S]*?data-no-midi-preview/);
  assert.match(html, /id="cycleDuration"[\s\S]*?data-no-midi-preview/);
  assert.match(html, /at most four normalized, detuned audio layers/);
  assert.doesNotMatch(html, /signed linear gain|quarter-cycle quadrature/);

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "every page id must be unique");
  for (const control of [
    "level", "scene", "exchangePhase", "cycleDuration", "preparation", "coherence",
    "pairCount", "rootNote", "contourRange", "phraseDensity", "spectralColor",
  ]) {
    assert.match(html, new RegExp(`<label[^>]*for="${control}"`), `${control} needs a visible label`);
  }
  for (const id of [
    "audioButton", "audioState", "audioError", "stage", "stageReadout", "liveStatus",
    "halfSwapButton", "swapButton", "reprepareButton", "measureButton", "shotsButton",
    "stateVectorReadout", "relativePhase", "soundAnatomyState", "soundDiagnosis",
  ]) assert.match(html, new RegExp(`id="${id}"`), `${id} must exist`);
});

test("the browser controller is event-based, explicit-audio, mapped, and BFCache safe", async () => {
  const app = await readFile(new URL("../quantum-square-dance-app.js", import.meta.url), "utf8");
  assert.match(app, /new VoicePool\(4\)/);
  assert.match(app, /const MAX_ENSEMBLE_AUDIO_LAYERS = 4/);
  assert.match(app, /voices\.setVoices\(\[\]\)/);
  assert.doesNotMatch(app, /voices\.setVoices\((?!\[\])/);
  assert.match(app, /function contourNotes[\s\S]*sound\.spinVoices\.up\.midi[\s\S]*sound\.spinVoices\.down\.midi/);
  assert.match(app, /function branchStrikes[\s\S]*sound\.branches\.stay\.probability[\s\S]*sound\.spatialRoles\.excited\.pan[\s\S]*sound\.interference\.spectralFusion/);
  assert.match(app, /voices\.strike\(/);
  assert.match(app, /function toggleAudio[\s\S]*await voices\.start\(\)/);
  const playBlock = app.match(/function setPlaying\([\s\S]*?\n}\n\nfunction togglePlaying/)?.[0] ?? "";
  assert.doesNotMatch(playBlock, /toggleAudio|voices\.start|audioOn\s*=\s*true/);
  assert.match(app, /ρ mixed/);
  assert.match(app, /relativePhaseText/);
  assert.match(app, /simulation\.orbitalMarginals\.excited/);
  assert.match(app, /data-no-midi-preview|publishPhasePreview/);
  assert.match(app, /emitMidiOutputPreview/);
  assert.match(app, /state\.scene === "hold-half-swap"/);
  assert.match(app, /function repreparePair\(\)/);
  assert.match(app, /pointercancel/);
  assert.match(app, /lostpointercapture/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /event\.persisted/);
  assert.match(app, /addEventListener\("pageshow"/);
  assert.match(app, /voices\.close\(\)/);
  assert.match(app, /prefers-reduced-motion: reduce/);
});
