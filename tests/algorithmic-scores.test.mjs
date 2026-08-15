import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ALGORITHMIC_INSTRUMENTS,
  ALGORITHMIC_SCORE_PRESETS,
  algorithmicInstrumentById,
  deriveAlgorithmicEventVoices,
  generateAlgorithmicScore,
  generateDijkstraScore,
  generateEuclideanScore,
  generateHanoiScore,
  generateMinimaxScore,
  generateNQueensScore,
  sanitizeAlgorithmicScoreParams,
} from "../src/algorithmic-scores.js";

test("algorithmic score bank exposes five non-sorting instruments", () => {
  assert.deepEqual(
    ALGORITHMIC_SCORE_PRESETS.map(({ id }) => id),
    ["dijkstra", "hanoi", "minimax", "nqueens", "euclid"],
  );
  assert.ok(ALGORITHMIC_SCORE_PRESETS.every(({ label }) => !/sort/i.test(label)));
  assert.equal(new Set(ALGORITHMIC_SCORE_PRESETS.map(({ family }) => family)).size, 5);
});

test("each score has an independent route, starting patch, and output profile", () => {
  assert.deepEqual(
    ALGORITHMIC_INSTRUMENTS.map(({ id }) => id),
    ["dijkstra", "hanoi", "minimax", "nqueens", "euclid"],
  );
  assert.equal(new Set(ALGORITHMIC_INSTRUMENTS.map(({ href }) => href)).size, 5);
  assert.equal(
    new Set(ALGORITHMIC_INSTRUMENTS.map(({ defaults }) => JSON.stringify(defaults))).size,
    5,
  );
  assert.equal(
    new Set(ALGORITHMIC_INSTRUMENTS.map(({ audio }) => JSON.stringify(audio))).size,
    5,
  );
  for (const instrument of ALGORITHMIC_INSTRUMENTS) {
    assert.equal(instrument.defaults.algorithmId, instrument.id);
    assert.equal(algorithmicInstrumentById(instrument.id), instrument);
    assert.match(instrument.href, /^[a-z]+\.html$/);
    assert.ok(instrument.audio.dry > 0 && instrument.audio.dry <= 1);
    assert.ok(instrument.audio.compressorRatio >= 1);
  }
  assert.equal(algorithmicInstrumentById("missing").id, "dijkstra");
});

test("Dijkstra settles nondecreasing distances and returns a valid cheapest path", () => {
  const score = generateDijkstraScore({ complexity: 6, seed: 1234 });
  const settled = score.events.filter(({ kind }) => kind === "settle" || kind === "goal");
  for (let index = 1; index < settled.length; index += 1) {
    assert.ok(settled[index].distance >= settled[index - 1].distance);
  }
  const { width, weights, start, goal, path } = score.scene;
  assert.equal(path[0], start);
  assert.equal(path.at(-1), goal);
  for (let index = 1; index < path.length; index += 1) {
    const difference = Math.abs(path[index] - path[index - 1]);
    assert.ok(difference === 1 || difference === width);
  }
  const pathCost = path.slice(1).reduce((total, node) => total + weights[node], 0);
  assert.equal(pathCost, score.metrics.pathCost);
  assert.equal(score.events.at(-1).kind, "path");
});

test("Towers of Hanoi emits the minimum legal move sequence", () => {
  const score = generateHanoiScore({ complexity: 7, seed: 4 });
  assert.equal(score.metrics.moveCount, (2 ** score.metrics.disks) - 1);
  for (const event of score.events) {
    for (const stack of event.stacks) {
      for (let index = 1; index < stack.length; index += 1) {
        assert.ok(stack[index - 1] > stack[index], "larger disks must stay below smaller disks");
      }
    }
  }
  assert.equal(score.scene.finalStacks[score.metrics.target].length, score.metrics.disks);
  assert.equal(score.events.at(-1).kind, "complete");
});

test("alpha-beta score preserves the full minimax root value while pruning", () => {
  const score = generateMinimaxScore({ complexity: 7, seed: 9182 });
  const { depth, leafValues } = score.scene;

  function fullMinimax(node) {
    const nodeDepth = Math.floor(Math.log2(node + 1));
    if (nodeDepth === depth) return leafValues[node];
    const left = fullMinimax(node * 2 + 1);
    const right = fullMinimax(node * 2 + 2);
    return nodeDepth % 2 === 0 ? Math.max(left, right) : Math.min(left, right);
  }

  assert.equal(score.metrics.rootValue, fullMinimax(0));
  assert.ok(score.metrics.prunedCount > 0);
  assert.ok(score.events.some(({ kind }) => kind === "prune"));
  assert.equal(score.events.at(-1).kind, "complete");
});

test("N-Queens finishes with one conflict-free queen per row and column", () => {
  const score = generateNQueensScore({ complexity: 8, seed: 4242 });
  const solution = score.scene.solution;
  assert.equal(score.metrics.solved, true);
  assert.equal(solution.length, score.metrics.size);
  assert.equal(new Set(solution).size, solution.length);
  for (let row = 0; row < solution.length; row += 1) {
    for (let other = row + 1; other < solution.length; other += 1) {
      assert.notEqual(Math.abs(solution[row] - solution[other]), Math.abs(row - other));
    }
  }
  assert.equal(score.events.at(-1).kind, "solution");
});

test("Euclidean score exposes exact quotient and remainder arithmetic", () => {
  const score = generateEuclideanScore({ complexity: 8, seed: 5511 });
  for (const { a, b, quotient, remainder } of score.scene.history) {
    assert.equal(a, quotient * b + remainder);
    assert.ok(remainder >= 0 && remainder < b);
  }
  const gcd = (left, right) => {
    while (right !== 0) [left, right] = [right, left % right];
    return left;
  };
  assert.equal(gcd(score.metrics.initialA, score.metrics.initialB), score.metrics.gcd);
  assert.ok(score.metrics.quotientPulseCount >= score.metrics.divisionCount);
  assert.equal(score.events.at(-1).kind, "complete");
});

test("generic score generation is deterministic and routes every preset", () => {
  for (const preset of ALGORITHMIC_SCORE_PRESETS) {
    const first = generateAlgorithmicScore({
      algorithmId: preset.id,
      complexity: 4,
      seed: 2026,
    });
    const repeated = generateAlgorithmicScore({
      algorithmId: preset.id,
      complexity: 4,
      seed: 2026,
    });
    assert.deepEqual(first, repeated);
    assert.equal(first.preset.id, preset.id);
    assert.ok(first.events.length > 1);
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(first.events));
  }
});

test("event voice derivation stays bounded while producing layered intense patches", () => {
  for (const preset of ALGORITHMIC_SCORE_PRESETS) {
    const score = generateAlgorithmicScore({
      algorithmId: preset.id,
      complexity: 4,
      seed: 73,
    });
    const event = score.events.find(({ accent }) => accent) ?? score.events[0];
    const voices = deriveAlgorithmicEventVoices(event, {
      ...score.settings,
      intensity: 1,
      roughness: 1,
      brightness: 1,
    });
    assert.ok(voices.length >= 3);
    assert.ok(voices.length <= 4);
    for (const voice of voices) {
      assert.ok(voice.frequencyHz >= 24 && voice.frequencyHz <= 18_000);
      assert.ok(voice.gain > 0 && voice.gain <= 0.16);
      assert.ok(voice.pan >= -1 && voice.pan <= 1);
      assert.ok(voice.durationSeconds >= 0.018 && voice.durationSeconds <= 1.8);
      assert.ok(voice.filterHz >= 300 && voice.filterHz <= 16_000);
    }
  }
});

test("algorithm score sanitizer bounds hostile controls", () => {
  const safe = sanitizeAlgorithmicScoreParams({
    algorithmId: "missing",
    seed: 0,
    complexity: 100,
    tempoBpm: -1,
    swing: 9,
    intensity: -3,
    brightness: 4,
    roughness: 4,
    space: 4,
    baseFrequencyHz: 9_999,
    pitchSpanOctaves: -4,
    output: 4,
  });
  assert.equal(safe.algorithmId, "dijkstra");
  assert.equal(safe.seed, 0x51c0ffee);
  assert.equal(safe.complexity, 8);
  assert.equal(safe.tempoBpm, 40);
  assert.equal(safe.swing, 0.46);
  assert.equal(safe.intensity, 0);
  assert.equal(safe.brightness, 1);
  assert.equal(safe.roughness, 1);
  assert.equal(safe.space, 0.88);
  assert.equal(safe.baseFrequencyHz, 440);
  assert.equal(safe.pitchSpanOctaves, 1);
  assert.equal(safe.output, 0.82);
});

test("five scores are five native interactive Morphazoid instrument pages", async () => {
  const [app, css, router] = await Promise.all([
    readFile(new URL("../algorithmic-scores-app.js", import.meta.url), "utf8"),
    readFile(new URL("../algorithmic-scores.css", import.meta.url), "utf8"),
    readFile(new URL("../algorithmic-scores.html", import.meta.url), "utf8"),
  ]);

  const pageTraits = {
    dijkstra: ["DJ Dijkstra", "Rewire graph", "Path resonance"],
    hanoi: ["Hanoi Carillon", "Recast tower", "Bell decay"],
    minimax: ["Alpha-Beta Minimax", "Reseed contest", "Prune bite"],
    nqueens: ["N-Queens Backtracker", "Shuffle columns", "Collision noise"],
    euclid: ["Euclidean Pulse", "Choose new ratio", "Quotient punch"],
  };
  for (const instrument of ALGORITHMIC_INSTRUMENTS) {
    const html = await readFile(new URL(`../${instrument.href}`, import.meta.url), "utf8");
    assert.match(html, new RegExp(`<body[^>]*data-algorithm="${instrument.id}"`));
    for (const trait of pageTraits[instrument.id]) assert.ok(html.includes(trait));
    assert.match(html, /id="mutateScore"/);
    assert.match(html, /id="playButton"/);
    assert.match(html, /id="loopScore"[^>]*checked/);
    assert.match(html, /id="intensity"/);
    assert.match(html, /id="roughness"/);
    assert.match(html, /id="space"/);
    assert.doesNotMatch(html, /<button[^>]+data-algorithm=/);
    assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
    assert.match(html, /<script type="module" src="algorithmic-scores-app\.js"><\/script>/);
    assert.doesNotMatch(html, /https?:\/\//i);
  }

  assert.match(router, /dijkstra:\s*"dijkstra\.html"/);
  assert.match(router, /euclid:\s*"euclid\.html"/);
  assert.match(app, /deriveAlgorithmicEventVoices/);
  assert.match(app, /algorithmicInstrumentById/);
  assert.match(app, /querySelectorAll\("button\[data-algorithm\]"\)/);
  assert.doesNotMatch(app, /querySelectorAll\("\[data-algorithm\]"\)/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /createDelay/);
  assert.match(app, /pointermove/);
  assert.match(css, /\.algorithmic-scores-shell/);
  assert.match(css, /data-algorithm="minimax"/);
});
