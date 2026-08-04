import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BELL_SQUARE_OUTCOMES,
  bellSquareState,
  correlationExpectation,
  createSeededRandom,
  dephaseDensityMatrix,
  densityMatrix,
  jointProbabilityMatrix,
  matrixPurity,
  measurementProbabilities,
  pureStateConcurrence,
  reducedDensityMatrix,
  sampleJoint,
  simulateBellSquare,
  stateFidelity,
  stateNorm,
} from "../src/bell-square.js";

const root = new URL("../", import.meta.url);
const TOLERANCE = 1e-10;
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

test("Bell Square circuit remains normalized over representative collision phases", () => {
  for (const phase of [0, Math.PI / 7, Math.PI / 2, Math.PI, 1.87 * Math.PI, TAU]) {
    close(stateNorm(bellSquareState(phase)), 1);
  }
});

test("CP(pi) followed by I x H produces Bell Phi+ up to global phase", () => {
  const targetPhiPlus = [
    { re: Math.SQRT1_2, im: 0 },
    { re: 0, im: 0 },
    { re: 0, im: 0 },
    { re: Math.SQRT1_2, im: 0 },
  ];
  const state = bellSquareState(Math.PI);
  close(stateFidelity(state, targetPhiPlus), 1);
  close(pureStateConcurrence(state), 1);
  close(state[1].re, 0);
  close(state[2].re, 0);
});

test("zero and full-turn collision phases are separable while intermediate phases entangle", () => {
  close(pureStateConcurrence(bellSquareState(0)), 0);
  close(pureStateConcurrence(bellSquareState(TAU)), 0);
  close(pureStateConcurrence(bellSquareState(Math.PI / 2)), Math.SQRT1_2);

  const zero = simulateBellSquare({ collisionPhase: 0 });
  closeArray(zero.probabilities, [0.5, 0, 0.5, 0]);
  close(zero.alicePurity, 1);
  close(zero.bobPurity, 1);

  const bell = simulateBellSquare({ collisionPhase: Math.PI });
  close(bell.alicePurity, 0.5);
  close(bell.bobPurity, 0.5);
  close(bell.globalPurity, 1);
});

test("Bell correlations follow independent local X-Z measurement rotations", () => {
  const bellDensity = densityMatrix(bellSquareState(Math.PI));
  const zByZ = measurementProbabilities(bellDensity, 0, 0);
  const xByX = measurementProbabilities(bellDensity, Math.PI / 2, Math.PI / 2);
  const zByX = measurementProbabilities(bellDensity, 0, Math.PI / 2);
  const zByMinusZ = measurementProbabilities(bellDensity, 0, Math.PI);

  closeArray(zByZ, [0.5, 0, 0, 0.5]);
  closeArray(xByX, [0.5, 0, 0, 0.5]);
  closeArray(zByX, [0.25, 0.25, 0.25, 0.25]);
  closeArray(zByMinusZ, [0, 0.5, 0.5, 0]);
  close(correlationExpectation(zByZ), 1);
  close(correlationExpectation(zByMinusZ), -1);
  close(correlationExpectation(zByX), 0);
  assert.deepEqual(jointProbabilityMatrix(zByZ), [[zByZ[0], zByZ[1]], [zByZ[2], zByZ[3]]]);
});

test("a separable |+0> endpoint responds independently to local basis choice", () => {
  const endpoint = densityMatrix(bellSquareState(0));
  closeArray(measurementProbabilities(endpoint, Math.PI / 2, 0), [1, 0, 0, 0]);
  closeArray(measurementProbabilities(endpoint, -Math.PI / 2, 0), [0, 0, 1, 0]);
});

test("local dephasing damps off-diagonals by their qubit Hamming distance", () => {
  const rho = densityMatrix(bellSquareState(Math.PI));
  const halfDephased = dephaseDensityMatrix(rho, 0.5);
  close(halfDephased[0][0].re, rho[0][0].re);
  close(halfDephased[3][3].re, rho[3][3].re);
  close(halfDephased[0][3].re, rho[0][3].re * 0.25);

  const productRho = densityMatrix(bellSquareState(0));
  const halfProduct = dephaseDensityMatrix(productRho, 0.5);
  close(halfProduct[0][2].re, productRho[0][2].re * 0.5);
});

test("full dephasing preserves Z populations but removes Bell X correlation and concurrence", () => {
  const coherent = simulateBellSquare({
    collisionPhase: Math.PI,
    aliceAxis: 0,
    bobAxis: 0,
    dephasing: 0,
  });
  const dephasedZ = simulateBellSquare({
    collisionPhase: Math.PI,
    aliceAxis: 0,
    bobAxis: 0,
    dephasing: 1,
  });
  const dephasedX = simulateBellSquare({
    collisionPhase: Math.PI,
    aliceAxis: Math.PI / 2,
    bobAxis: Math.PI / 2,
    dephasing: 1,
  });

  closeArray(dephasedZ.probabilities, coherent.probabilities);
  closeArray(dephasedX.probabilities, [0.25, 0.25, 0.25, 0.25]);
  close(dephasedZ.concurrence, 0, 1e-8);
  close(dephasedZ.globalPurity, 0.5);
  close(dephasedX.correlation, 0);
});

test("reported purities agree with direct partial traces", () => {
  const simulated = simulateBellSquare({ collisionPhase: Math.PI / 3, dephasing: 0.37 });
  const alice = reducedDensityMatrix(simulated.densityMatrix, "alice");
  const bob = reducedDensityMatrix(simulated.densityMatrix, "bob");
  close(matrixPurity(alice), simulated.alicePurity);
  close(matrixPurity(bob), simulated.bobPurity);
  assert.throws(
    () => reducedDensityMatrix(simulated.densityMatrix, "charlie"),
    /alice.*bob/,
  );
});

test("seeded one-shot and 32-shot measurement streams are deterministic", () => {
  const probabilities = [0.5, 0, 0, 0.5];
  const oneA = sampleJoint(probabilities, { shots: 1, seed: "bell-square" });
  const oneB = sampleJoint(probabilities, { shots: 1, seed: "bell-square" });
  assert.deepEqual(oneA, oneB);
  assert.ok(oneA.outcomes[0] === "00" || oneA.outcomes[0] === "11");

  const batchA = sampleJoint(probabilities, { shots: 32, seed: 2026 });
  const batchB = sampleJoint(probabilities, { shots: 32, seed: 2026 });
  assert.deepEqual(batchA, batchB);
  assert.equal(Object.values(batchA.counts).reduce((sum, count) => sum + count, 0), 32);
  assert.equal(batchA.outcomes.length, 32);
  assert.equal(batchA.counts["01"], 0);
  assert.equal(batchA.counts["10"], 0);
  close(Object.values(batchA.frequencies).reduce((sum, frequency) => sum + frequency, 0), 1);

  const randomA = createSeededRandom(91);
  const randomB = createSeededRandom(91);
  assert.deepEqual(
    Array.from({ length: 12 }, randomA),
    Array.from({ length: 12 }, randomB),
  );
});

test("Bell Square markup exposes the quantum section, exact-simulation framing, and controls", async () => {
  const html = await readFile(new URL("bell-square.html", root), "utf8");
  assert.match(html, /<link rel="stylesheet" href="style\.css"/);
  assert.match(html, /<link rel="stylesheet" href="quantum-synths\.css"/);
  assert.match(html, /<body class="quantum-page bell-square-page">/);
  assert.match(html, /<main class="shell quantum-shell" id="bellSquare">/);
  assert.match(html, /class="stage quantum-stage bell-square-stage"/);
  assert.match(html, /id="stage"[\s\S]+tabindex="0"[\s\S]+role="img"/);
  assert.match(html, /aria-describedby="bellSquareDescription canvasInstructions liveStatus"/);
  assert.match(html, /QUANTUM SYNTHS · 02/);
  assert.match(html, /<h1 id="bellSquareTitle">Bell Square<\/h1>/);
  assert.match(html, /EXACT TWO-QUBIT CLASSICAL SIMULATION · LOCAL STREAMS STAY RANDOM/);
  assert.match(html, /not audio from quantum matter or a live QPU/i);

  for (const route of ["./", "order-tones.html", "bell-square.html", "annealogue.html"]) {
    assert.match(html, new RegExp(`(?:href|value)="${route.replace(".", "\\.")}"`));
  }
  for (const id of [
    "audioButton", "audioState", "audioError", "stageReadout", "liveStatus",
    "playButton", "collisionPhase", "aliceAxis", "bobAxis", "dephasing",
    "measureButton", "shotsButton", "resetBellSquare", "lastOutcome", "shotSummary",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} must exist`);
  }
  for (const outcome of BELL_SQUARE_OUTCOMES) {
    assert.match(html, new RegExp(`id="probability${outcome}"`));
  }
});

test("Bell Square markup has unique ids and every adjustable control is labelled", async () => {
  const html = await readFile(new URL("bell-square.html", root), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const control of ["level", "collisionPhase", "aliceAxis", "bobAxis", "dephasing"]) {
    assert.match(html, new RegExp(`<label[^>]*for="${control}"`), `${control} needs a label`);
  }
  assert.match(html, /id="audioState">off<\/small>/);
  assert.match(html, /id="audioButton"[^>]+aria-pressed="false"/);
});

test("Bell Square app uses bounded VoicePool audio, exact shots, shortcuts, and cleanup", async () => {
  const [app, core] = await Promise.all([
    readFile(new URL("bell-square-app.js", root), "utf8"),
    readFile(new URL("src/bell-square.js", root), "utf8"),
  ]);
  assert.match(app, /new VoicePool\(8\)/);
  assert.match(app, /simulation\.probabilities\.forEach/);
  assert.match(app, /probability \* 0\.2/);
  assert.match(app, /voices\.strike\(/);
  assert.match(app, /sampleJoint\(simulation\.probabilities/);
  assert.match(app, /shots: 32|performMeasurement\(32\)/);
  assert.match(app, /voices\.start\(\)/);
  assert.match(app, /voices\.disable\(\)/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(app, /event\.key === " "/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "m"/);
  assert.match(app, /ArrowLeft[\s\S]+ArrowRight[\s\S]+ArrowUp[\s\S]+ArrowDown/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /event\.persisted/);
  assert.match(app, /addEventListener\("pageshow"/);
  assert.doesNotMatch(app, /addEventListener\("pagehide"[\s\S]{0,500}\{ once: true \}/);
  assert.match(app, /voices\.close\(\)/);
  assert.doesNotMatch(core, /\bdocument\b|AudioContext|requestAnimationFrame|window\.addEventListener/);
});
