import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AMPLITUDE_COMPONENT_COUNT,
  ANNEALOGUE_LANDSCAPES,
  BASIS_STATE_COUNT,
  QUBIT_COUNT,
  bitstring,
  classicalGreedyDescent,
  createAnnealSchedule,
  createBasisState,
  createSeededRandom,
  createUniformState,
  evolveSchedule,
  expectedEnergy,
  expectedHamiltonianEnergy,
  greedyPath,
  groundStateIndices,
  hammingNeighbors,
  measureState,
  normalizeState,
  restartAnneal,
  runAnneal,
  simulateAnneal,
  splitStep,
  stateNorm,
  stateProbabilities,
  stepAnneal,
  successProbability,
} from "../src/annealogue.js";

const closeTo = (actual, expected, tolerance = 1e-10) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    String(actual) + " should be within " + tolerance + " of " + expected,
  );
};

const maximumDifference = (first, second) => Math.max(
  ...Array.from(first, (value, index) => Math.abs(value - second[index])),
);

test("Annealogue represents exactly three qubits and eight normalized amplitudes", () => {
  assert.equal(QUBIT_COUNT, 3);
  assert.equal(BASIS_STATE_COUNT, 8);
  assert.equal(AMPLITUDE_COMPONENT_COUNT, 16);

  const uniform = createUniformState();
  assert.ok(uniform instanceof Float64Array);
  assert.equal(uniform.length, 16);
  closeTo(stateNorm(uniform), 1);
  for (const probability of stateProbabilities(uniform)) closeTo(probability, 1 / 8);

  for (let index = 0; index < 8; index += 1) {
    const basis = createBasisState(index);
    assert.equal(bitstring(index).length, 3);
    assert.equal(stateProbabilities(basis)[index], 1);
    assert.deepEqual(
      hammingNeighbors(index).map((peer) => index ^ peer).sort(),
      [1, 2, 4],
    );
  }
});

test("every symmetric split step preserves norm without mutating its input", () => {
  const energies = ANNEALOGUE_LANDSCAPES["false-floor"].energies;
  let state = normalizeState(Float64Array.from({ length: 16 }, (_, index) => (
    Math.sin(index * 1.71) + Math.cos(index * 0.37)
  )));
  for (const progress of [0, 0.07, 0.35, 0.5, 0.91, 1]) {
    for (const gamma of [0, 0.5, 1.25, 3]) {
      const before = Float64Array.from(state);
      const evolved = splitStep(state, { energies, progress, gamma, dt: 0.037 });
      assert.deepEqual(state, before);
      assert.notStrictEqual(evolved, state);
      closeTo(stateNorm(evolved), 1, 2e-12);
      assert.ok(Array.from(evolved).every(Number.isFinite));
      state = evolved;
    }
  }
});

test("split-step endpoint operators have the correct invariants", () => {
  const energies = ANNEALOGUE_LANDSCAPES["single-basin"].energies;
  const arbitrary = normalizeState(Float64Array.from({ length: 16 }, (_, index) => (
    Math.sin(0.9 + index * 0.63)
  )));

  // At s=1 the driver is absent, so diagonal phase evolution cannot move
  // probability between computational-basis states.
  const diagonalOnly = splitStep(arbitrary, {
    energies,
    progress: 1,
    gamma: 99,
    dt: 0.41,
  });
  assert.ok(maximumDifference(
    stateProbabilities(arbitrary),
    stateProbabilities(diagonalOnly),
  ) < 2e-12);

  // At s=0, |+++> is an eigenstate of all three X operators.
  const driverOnly = splitStep(createUniformState(), {
    energies,
    progress: 0,
    gamma: 2.4,
    dt: 0.73,
  });
  for (const probability of stateProbabilities(driverOnly)) closeTo(probability, 1 / 8, 2e-12);
  closeTo(expectedHamiltonianEnergy(createUniformState(), energies, 0, 1.25), -3.75, 2e-12);
  closeTo(
    expectedHamiltonianEnergy(arbitrary, energies, 1, 1.25),
    expectedEnergy(arbitrary, energies),
    2e-12,
  );
});

test("a fixed-s split step reverses stably with a negative time step", () => {
  const energies = ANNEALOGUE_LANDSCAPES["false-floor"].energies;
  const initial = normalizeState(Float64Array.from({ length: 16 }, (_, index) => (
    Math.cos(index * 0.41) - Math.sin(index * 1.19)
  )));
  const forward = splitStep(initial, {
    energies,
    progress: 0.427,
    gamma: 1.37,
    dt: 0.083,
  });
  const reversed = splitStep(forward, {
    energies,
    progress: 0.427,
    gamma: 1.37,
    dt: -0.083,
  });
  assert.ok(maximumDifference(initial, reversed) < 5e-13);
});

test("complete schedules stay finite and normalized across all presets", () => {
  for (const [landscapeId, landscape] of Object.entries(ANNEALOGUE_LANDSCAPES)) {
    const atStart = simulateAnneal({ landscape: landscapeId, progress: 0 });
    assert.ok(maximumDifference(atStart, createUniformState()) < 2e-15);
    for (const gamma of [0, 0.7, 1.25, 2.8]) {
      for (const durationSeconds of [1, 4.5, 12]) {
        const result = simulateAnneal({
          landscape: landscapeId,
          gamma,
          durationSeconds,
          progress: 1,
        });
        closeTo(stateNorm(result), 1, 3e-12);
        assert.ok(Array.from(result).every(Number.isFinite));
        assert.ok(Number.isFinite(expectedEnergy(result, landscape.energies)));
        assert.ok(successProbability(result, landscape.energies) >= 0);
        assert.ok(successProbability(result, landscape.energies) <= 1 + 1e-12);
      }
    }
  }

  // With gamma=0, no population transfer occurs anywhere in the schedule.
  const noDriver = simulateAnneal({
    landscape: "single-basin",
    gamma: 0,
    durationSeconds: 11,
  });
  for (const probability of stateProbabilities(noDriver)) closeTo(probability, 1 / 8, 2e-12);
});

test("incremental evolution agrees with direct schedule evolution", () => {
  const landscape = ANNEALOGUE_LANDSCAPES["single-basin"];
  const direct = evolveSchedule(createUniformState(), {
    energies: landscape.energies,
    gamma: 1.1,
    durationSeconds: 7,
    fromProgress: 0,
    toProgress: 1,
  });
  const halfway = evolveSchedule(createUniformState(), {
    energies: landscape.energies,
    gamma: 1.1,
    durationSeconds: 7,
    fromProgress: 0,
    toProgress: 0.5,
  });
  const incremental = evolveSchedule(halfway, {
    energies: landscape.energies,
    gamma: 1.1,
    durationSeconds: 7,
    fromProgress: 0.5,
    toProgress: 1,
  });
  assert.ok(maximumDifference(direct, incremental) < 2e-5);
  closeTo(stateNorm(incremental), 1, 2e-12);
});

test("restart, step, and run schedule helpers keep explicit progress", () => {
  const schedule = createAnnealSchedule({
    landscape: "false-floor",
    durationSeconds: 10,
    gamma: 1.4,
  });
  assert.equal(schedule.progress, 0);
  assert.deepEqual(schedule.amplitudes, createUniformState());

  const stepped = stepAnneal(schedule, 2.5);
  assert.equal(stepped.progress, 0.25);
  closeTo(stateNorm(stepped.amplitudes), 1, 2e-12);
  const completed = runAnneal(stepped);
  assert.equal(completed.progress, 1);
  closeTo(stateNorm(completed.amplitudes), 1, 2e-12);

  const restarted = restartAnneal(completed);
  assert.equal(restarted.progress, 0);
  assert.equal(restarted.landscapeId, "false-floor");
  assert.equal(restarted.gamma, 1.4);
  assert.equal(restarted.durationSeconds, 10);
  assert.deepEqual(restarted.amplitudes, createUniformState());
});

test("preset minima and the classical greedy comparator are intentional", () => {
  assert.deepEqual(
    groundStateIndices(ANNEALOGUE_LANDSCAPES["single-basin"].energies),
    [0],
  );
  assert.deepEqual(
    groundStateIndices(ANNEALOGUE_LANDSCAPES["false-floor"].energies),
    [0],
  );
  assert.deepEqual(
    groundStateIndices(ANNEALOGUE_LANDSCAPES["frustrated-ring"].energies),
    [1, 2, 3, 4, 5, 6],
  );

  const basin = classicalGreedyDescent(
    ANNEALOGUE_LANDSCAPES["single-basin"].energies,
    ANNEALOGUE_LANDSCAPES["single-basin"].greedyStart,
  );
  assert.deepEqual(basin.path, [7, 3, 1, 0]);
  assert.equal(basin.reachedGround, true);
  assert.equal(basin.stuck, false);

  const falseFloor = classicalGreedyDescent(
    ANNEALOGUE_LANDSCAPES["false-floor"].energies,
    ANNEALOGUE_LANDSCAPES["false-floor"].greedyStart,
  );
  assert.deepEqual(falseFloor.path, [7]);
  assert.equal(falseFloor.reachedGround, false);
  assert.equal(falseFloor.stuck, true);
  assert.deepEqual(
    greedyPath(ANNEALOGUE_LANDSCAPES["false-floor"].energies, 7),
    falseFloor.path,
  );

  const frustrated = classicalGreedyDescent(
    ANNEALOGUE_LANDSCAPES["frustrated-ring"].energies,
    0,
  );
  assert.deepEqual(frustrated.path, [0, 1]);
  assert.equal(frustrated.reachedGround, true);
});

test("seeded measurement is deterministic and collapses to the sampled basis state", () => {
  const state = simulateAnneal({
    landscape: "false-floor",
    gamma: 1.3,
    durationSeconds: 7,
    progress: 0.63,
  });
  const first = measureState(state, { seed: "same-show" });
  const second = measureState(state, { seed: "same-show" });
  assert.equal(first.index, second.index);
  assert.equal(first.sample, second.sample);
  assert.equal(first.bitstring, bitstring(first.index));
  assert.equal(stateProbabilities(first.collapsedState)[first.index], 1);
  closeTo(stateNorm(first.collapsedState), 1);

  const generatorA = createSeededRandom(42);
  const generatorB = createSeededRandom(42);
  assert.deepEqual(
    Array.from({ length: 12 }, generatorA),
    Array.from({ length: 12 }, generatorB),
  );

  assert.equal(measureState(createUniformState(), () => 0).index, 0);
  assert.equal(measureState(createUniformState(), () => 0.999999999).index, 7);
});

test("Annealogue markup and browser controller honor the quantum instrument contract", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../annealogue.html", import.meta.url), "utf8"),
    readFile(new URL("../annealogue-app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<body class="quantum-page annealogue-page">/);
  assert.match(html, /<main class="shell quantum-shell"/);
  assert.match(html, /class="stage quantum-stage annealogue-stage"/);
  assert.match(html, /class="panel quantum-panel annealogue-panel"/);
  assert.match(html, /href="style\.css"/);
  assert.match(html, /href="quantum-synths\.css"/);
  assert.match(html, /QUANTUM SYNTHS · 03/);
  assert.match(html, /<h1 id="annealogueTitle">Annealogue<\/h1>/);
  assert.match(html, /EXACT THREE-QUBIT CLASSICAL SIMULATION · NO SPEEDUP CLAIM/);
  assert.match(html, /no QPU · no speedup claim/i);

  for (const id of [
    "stage", "stageWrap", "stageReadout", "liveStatus", "audioError",
    "audioButton", "audioState", "landscape", "duration", "gamma", "progress",
    "playButton", "restartButton", "stepButton", "measureButton", "resetAnnealogue",
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /id="stage"[\s\S]*?tabindex="0"[\s\S]*?role="img"/);
  assert.match(html, /aria-describedby="annealogueDescription liveStatus"/);
  assert.match(html, /id="audioState">off<\/small>/);
  assert.match(html, /data-reset-all>[\s\S]*?Reset all parameters/);
  assert.match(html, /Single Basin[\s\S]*False Floor[\s\S]*Frustrated Ring/);

  for (const [href, label] of [
    ["shape.html", "shape"],
    ["order-tones.html", "order tones"],
    ["bell-square.html", "bell square"],
    ["annealogue.html", "annealogue"],
  ]) {
    assert.match(html, new RegExp('href="' + href.replace(".", "\\.") + '"[^>]*>' + label));
    assert.match(html, new RegExp('value="' + href.replace(".", "\\.") + '"[^>]*>' + label));
  }
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="annealogue-app\.js"><\/script>/);

  assert.match(app, /new VoicePool\(8\)/);
  assert.match(app, /simulateAnneal/);
  assert.match(app, /evolveSchedule/);
  assert.match(app, /measureState/);
  assert.match(app, /classicalGreedyDescent/);
  assert.match(app, /pool\.enable\(\)/);
  assert.match(app, /pool\.strike\(measurementVoice/);
  assert.match(app, /pool\.setVoices\(voicesForState\(\)/);
  assert.match(app, /audioOn \? "on" : "off"/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /event\.key === " "/);
  assert.match(app, /event\.key === "ArrowRight" \|\| event\.key === "ArrowLeft"/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "m"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /HEIGHT  E\(z\)[\s\S]*HALO[\s\S]*AMBER  greedy/);
  assert.match(app, /EXACT 3-QUBIT CLASSICAL SIMULATION · NO QPU · NO SPEEDUP CLAIM/);
  assert.doesNotMatch(app, /new AudioContext|webkitAudioContext/);
});
