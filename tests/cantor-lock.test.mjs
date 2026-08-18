import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  analyzeCantorLock,
  applyRestrictedAdjoint,
  applyRestrictedOperator,
  buildCantorLockMasks,
  cantorDimension,
  cantorMask,
  complexEnergy,
  createSeededRandom,
  inverseUnitaryDft,
  normalizeComplex,
  optimizeRestrictedConcentration,
  seededMaskState,
  solidIntervalMask,
  unitaryDft,
} from "../src/cantor-lock.js";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

function approximately(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );
}

function complexInnerProduct(left, right) {
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < left.length; index += 2) {
    const ar = left[index];
    const ai = left[index + 1];
    const br = right[index];
    const bi = right[index + 1];
    real += ar * br + ai * bi;
    imaginary += ar * bi - ai * br;
  }
  return { real, imaginary };
}

test("ternary Cantor masks retain exactly 2^depth of 3^depth cells", () => {
  assert.equal(cantorDimension(5), 243);
  assert.deepEqual(
    [...cantorMask(3)].map((value, index) => value ? index : -1).filter((index) => index >= 0),
    [0, 2, 6, 8, 18, 20, 24, 26],
  );
  for (let depth = 1; depth <= 5; depth += 1) {
    const mask = cantorMask(depth);
    assert.equal(mask.length, 3 ** depth);
    assert.equal(mask.reduce((sum, value) => sum + value, 0), 2 ** depth);
    const shifted = cantorMask(depth, 2);
    for (let index = 0; index < mask.length; index += 1) {
      assert.equal(shifted[(index + 2) % mask.length], mask[index]);
    }
  }
});

test("solid comparator has equal measure but no recursive middle-third gaps", () => {
  const cantor = buildCantorLockMasks({ depth: 4, mode: "cantor", offset: 7 });
  const solid = buildCantorLockMasks({ depth: 4, mode: "solid", offset: 7 });
  assert.equal(cantor.count, 16);
  assert.equal(solid.count, 16);
  assert.equal(cantor.positionMask.reduce((sum, value) => sum + value, 0), 16);
  assert.equal(solid.positionMask.reduce((sum, value) => sum + value, 0), 16);
  assert.deepEqual([...solidIntervalMask(9, 4, 7)], [1, 1, 0, 0, 0, 0, 0, 1, 1]);
  assert.notDeepEqual([...cantor.positionMask], [...solid.positionMask]);
});

test("the normalized DFT round-trips complex vectors and preserves energy", () => {
  const random = createSeededRandom("parseval");
  const vector = Float64Array.from({ length: 54 }, () => random() * 2 - 1);
  const transformed = unitaryDft(vector);
  const roundTrip = inverseUnitaryDft(transformed);
  approximately(complexEnergy(transformed), complexEnergy(vector), 1e-9);
  for (let index = 0; index < vector.length; index += 1) {
    approximately(roundTrip[index], vector[index], 2e-10);
  }

  const impulse = new Float64Array(18);
  impulse[0] = 1;
  const flat = unitaryDft(impulse);
  for (let bin = 0; bin < 9; bin += 1) {
    approximately(Math.hypot(flat[bin * 2], flat[bin * 2 + 1]), 1 / 3);
  }
});

test("restricted operator and its declared adjoint satisfy the complex inner-product identity", () => {
  const { positionMask, frequencyMask } = buildCantorLockMasks({ depth: 3, offset: 4 });
  const frequencyState = seededMaskState(frequencyMask, "frequency");
  const positionState = seededMaskState(positionMask, "position");
  const left = complexInnerProduct(
    applyRestrictedOperator(frequencyState, positionMask, frequencyMask),
    positionState,
  );
  const right = complexInnerProduct(
    frequencyState,
    applyRestrictedAdjoint(positionState, positionMask, frequencyMask),
  );
  approximately(left.real, right.real, 2e-10);
  approximately(left.imaginary, right.imaginary, 2e-10);
});

test("power iteration is deterministic, bounded, and never loses the best Rayleigh concentration", () => {
  const masks = buildCantorLockMasks({ depth: 4, offset: 3, mode: "cantor" });
  const first = optimizeRestrictedConcentration({ ...masks, seed: 91, iterations: 28 });
  const second = optimizeRestrictedConcentration({ ...masks, seed: 91, iterations: 28 });
  approximately(first.retainedEnergy, second.retainedEnergy, 1e-14);
  assert.deepEqual(first.history, second.history);
  assert.ok(first.retainedEnergy >= first.initialRetainedEnergy - 1e-12);
  assert.ok(first.history.every((value) => value >= 0 && value <= 1 + 1e-12));
  for (let index = 1; index < first.history.length; index += 1) {
    assert.ok(first.history[index] >= first.history[index - 1] - 1e-11);
  }
  approximately(first.retainedEnergy + first.leakedEnergy, 1, 2e-9);
  approximately(first.responseNorm ** 2, first.retainedEnergy, 1e-12);
  approximately(complexEnergy(first.frequencyState), 1, 1e-10);
  approximately(complexEnergy(normalizeComplex(first.frequencyState)), 1, 1e-10);
});

test("the finite solid-window comparator can concentrate much more strongly than Cantor gaps", () => {
  const cantor = analyzeCantorLock({ depth: 4, offset: 0, seed: 37, mode: "cantor", iterations: 36 });
  const solid = analyzeCantorLock({ depth: 4, offset: 0, seed: 37, mode: "solid", iterations: 36 });
  assert.ok(cantor.retainedEnergy > 0.45 && cantor.retainedEnergy < 0.7);
  assert.ok(solid.retainedEnergy > 0.98);
  assert.ok(solid.retainedEnergy > cantor.retainedEnergy + 0.35);
  assert.equal(cantor.size, solid.size);
  assert.equal(cantor.count, solid.count);
});

test("different phase seeds change the untightened instrument state repeatably", () => {
  const first = analyzeCantorLock({ depth: 3, seed: 4, iterations: 0 });
  const repeat = analyzeCantorLock({ depth: 3, seed: 4, iterations: 0 });
  const other = analyzeCantorLock({ depth: 3, seed: 5, iterations: 0 });
  assert.deepEqual([...first.frequencyState], [...repeat.frequencyState]);
  assert.notDeepEqual([...first.frequencyState], [...other.frequencyState]);
  assert.throws(() => cantorMask(6), /depth/);
  assert.throws(() => solidIntervalMask(3, 4), /count/);
});

test("Cantor Lock markup discloses scope, sources, controls, and the sound correspondence ledger", async () => {
  const html = await read("cantor-lock.html");
  assert.match(html, /<body class="fractal-uncertainty-page cantor-lock-page">/);
  assert.match(html, /<main class="shell fractal-uncertainty-shell"/);
  assert.match(html, /href="style\.css"/);
  assert.match(html, /href="fractal-uncertainty\.css"/);
  assert.match(html, /FRACTAL UNCERTAINTY · 01/);
  assert.match(html, /<h1 id="cantorLockTitle">Cantor Lock<\/h1>/);
  assert.match(html, /FINITE CLASSICAL FOURIER MODEL · NOT A PROOF · NOT QPU OUTPUT/);
  assert.match(html, /annals\.math\.princeton\.edu\/2018\/187-3\/p05/);
  assert.match(html, /annals\.math\.princeton\.edu\/2025\/202-1\/p04/);
  assert.match(html, /target="_blank" rel="noopener"/);
  assert.match(html, /The computed singular value belongs only to this finite sampled operator/);
  for (const id of [
    "stage", "stageReadout", "liveStatus", "audioButton", "audioState", "audioError",
    "depth", "offset", "seed", "cantorMode", "solidMode", "tightenButton", "reseedButton",
    "retainedReadout", "leakReadout", "sigmaReadout", "cadenceReadout", "phraseReadout",
    "articulationReadout", "resetButton",
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  assert.match(html, /Y address → pitch \+ pulse order/);
  assert.match(html, /The pitches follow sampled Fourier addresses directly rather than a conventional scale/);
  assert.match(html, /<script type="module" src="cantor-lock-app\.js"><\/script>/);
});

test("Cantor Lock exposes an accessible live sound anatomy and musician-facing control guide", async () => {
  const html = await read("cantor-lock.html");
  assert.match(html, /class="group control-section sound-anatomy" open aria-labelledby="soundAnatomyTitle"/);
  assert.match(html, /<h2 class="group-title" id="soundAnatomyTitle">Sound anatomy <small>What you hear now<\/small><\/h2>/);
  assert.match(html, /What you hear now/);
  assert.match(
    html,
    /id="soundAnatomyState"[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-atomic="true"/,
  );
  assert.match(html, /class="sound-anatomy-grid" aria-label="Live Cantor Lock audio behavior"/);
  assert.match(html, /class="sound-anatomy-voices" aria-labelledby="renderedVoicesTitle"/);
  assert.match(html, /class="sound-control-guide" aria-labelledby="controlGuideTitle"/);
  assert.match(html, /the bed is always present while audio is on, which can read as a drone/i);
  assert.match(html, /Note names are nearest 12-tone references/);
  assert.match(html, /which part feels static: the cyan pitch stack, the amber halo, or the address pulses/);
  for (const id of [
    "soundDiagnosisReadout", "activeVoicesReadout", "coreRegisterReadout",
    "haloRegisterReadout", "pulseTimingReadout", "dynamicsAnatomyReadout",
    "timbreAnatomyReadout", "stereoAnatomyReadout", "nextAddressReadout",
    "coreVoiceList", "haloVoiceList", "geometryGuideReadout", "depthGuideReadout",
    "offsetGuideReadout", "seedGuideReadout", "tightenGuideReadout", "levelGuideReadout",
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing live sound explanation #${id}`);
});

test("Cantor Lock sound anatomy mirrors the render pool and every audible mapping live", async () => {
  const app = await read("cantor-lock-app.js");
  assert.match(app, /levelToGain,[\s\S]*limitVoicePeakSum,[\s\S]*normalizeVoiceGains,[\s\S]*reduceVoiceContacts/);
  assert.match(app, /function continuousMix\(now = performance\.now\(\)\)/);
  assert.match(app, /reduceVoiceContacts\([\s\S]*MAX_AUDIO_VOICES/);
  assert.match(app, /limitVoicePeakSum\([\s\S]*normalizeVoiceGains\(reduced\)[\s\S]*0\.68/);
  assert.match(app, /function noteReference\(frequency\)/);
  assert.match(app, /Hz`/);
  assert.match(app, /function addressPulseDetails\(cell\)/);
  assert.match(app, /One address every \$\{interval\.toFixed\(1\)\} ms/);
  assert.match(app, /\$\{hitCount\} hits \+ \$\{restCount\} literal rests/);
  assert.match(app, /phase-aligned peak ceiling/);
  assert.match(app, /Output \$\{percent\(state\.level, 0\)\} applies master gain/);
  assert.match(app, /Main worklet: sine-carrier \$\{modulationModes\}/);
  assert.match(app, /Native fallback: plain \$\{waveforms\} oscillators without FM\/PM/);
  assert.match(app, /\$\{leftCount\} left \/ \$\{centerCount\} center \/ \$\{rightCount\} right/);
  assert.match(app, /Address \$\{nextCell\}\/\$\{result\.size - 1\} is a literal rest/);
  assert.match(app, /paintSoundAnatomy\(now\)/);
  assert.match(app, /if \(catchUp > 0\) paintSoundAnatomy\(now\)/);
  assert.match(app, /changes complex phases only: every kept Fourier bin still has equal magnitude/);
  assert.match(app, /\$\("level"\)\.addEventListener\("input", \(\) => \{[\s\S]*paintSoundAnatomy\(\)/);
  for (const stateDependency of [
    "state.mode", "state.depth", "state.offset", "state.seed", "state.level",
    "state.tightened", "result.retainedEnergy", "result.leakedEnergy", "result.frequencyMask",
  ]) assert.match(app, new RegExp(stateDependency.replace(".", "\\.")), `missing anatomy dependency ${stateDependency}`);
});

test("Cantor Lock app keeps audio bounded, live, accessible, and BFCache safe", async () => {
  const [app, core] = await Promise.all([
    read("cantor-lock-app.js"),
    read("src/cantor-lock.js"),
  ]);
  assert.match(app, /VoicePool,[\s\S]*from "\.\/src\/audio\.js"/);
  assert.match(app, /const MAX_AUDIO_VOICES = 12/);
  assert.match(app, /new VoicePool\(MAX_AUDIO_VOICES, \{ continuousPeakCeiling: 0\.68 \}\)/);
  assert.match(app, /pool\.setVoices/);
  assert.match(app, /pool\.strike/);
  assert.match(app, /advanceModelPhrase/);
  assert.match(app, /frequencyMask\[cell\]/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(app, /Math\.min\(2, Math\.max\(1, globalThis\.devicePixelRatio/);
  assert.match(app, /pagehide/);
  assert.match(app, /pageshow/);
  assert.match(app, /event\.persisted/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "t"/);
  assert.doesNotMatch(core, /\bdocument\.|\bwindow\./);
});
