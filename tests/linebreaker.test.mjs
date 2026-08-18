import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LINEBREAKER_PRESETS,
  dft2D,
  dominantFourierBins,
  energy2D,
  findClearLine,
  isCantorCoordinate,
  makeLinebreakerMask,
  probeLine,
  sampledPorosityDiagnostics,
  shiftedMagnitude,
  ternaryDigits,
} from "../src/linebreaker.js";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

function approximately(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );
}

test("Linebreaker presets build deterministic ternary masks with exact counts", () => {
  assert.deepEqual(
    LINEBREAKER_PRESETS.map(({ id }) => id),
    ["crossed-lines", "sierpinski-carpet", "cantor-dust"],
  );
  assert.ok(Object.isFrozen(LINEBREAKER_PRESETS));
  assert.deepEqual(ternaryDigits(5, 3), [2, 1, 0]);
  assert.equal(isCantorCoordinate(6, 2), true);
  assert.equal(isCantorCoordinate(4, 2), false);

  for (const depth of [1, 2, 3, 4]) {
    const size = 3 ** depth;
    const crossed = makeLinebreakerMask("crossed-lines", depth);
    const carpet = makeLinebreakerMask("sierpinski-carpet", depth);
    const dust = makeLinebreakerMask("cantor-dust", depth);
    assert.equal(crossed.size, size);
    assert.equal(crossed.occupiedCount, size * 2 - 1);
    assert.equal(carpet.occupiedCount, 8 ** depth);
    assert.equal(dust.occupiedCount, 4 ** depth);
    assert.deepEqual(
      Array.from(makeLinebreakerMask("dust", depth).data),
      Array.from(dust.data),
    );
  }
});

test("complete rails survive crossed lines and a Sierpinski carpet but not Cantor dust", () => {
  const depth = 3;
  const size = 3 ** depth;
  const firstRowOffset = -0.5 + 0.5 / size;
  const crossed = probeLine(makeLinebreakerMask("crossed-lines", depth), {
    angleDegrees: 0,
    offset: 0,
    sampleCount: 216,
  });
  const carpet = probeLine(makeLinebreakerMask("sierpinski-carpet", depth), {
    angleDegrees: 0,
    offset: firstRowOffset,
    sampleCount: 216,
  });
  const dust = probeLine(makeLinebreakerMask("cantor-dust", depth), {
    angleDegrees: 0,
    offset: firstRowOffset,
    sampleCount: 216,
  });

  assert.equal(crossed.occupancy, 1);
  assert.equal(crossed.longestOccupiedFraction, 1);
  assert.equal(crossed.clearGapCount, 0);
  assert.equal(carpet.occupancy, 1);
  assert.equal(carpet.longestOccupiedFraction, 1);
  assert.ok(dust.occupancy < 0.4);
  assert.ok(dust.longestOccupiedFraction < 0.2);
  assert.ok(dust.clearGapCount >= 3);
});

test("the finite rail search is deterministic and distinguishes the dust example", () => {
  const carpetMask = makeLinebreakerMask("sierpinski-carpet", 3);
  const dustMask = makeLinebreakerMask("cantor-dust", 3);
  const options = { angleSteps: 36, offsetSteps: 27, sampleCount: 108 };
  const first = findClearLine(carpetMask, options);
  const second = findClearLine(carpetMask, options);
  const dust = findClearLine(dustMask, options);
  assert.deepEqual(first, second);
  assert.equal(first.longestOccupiedFraction, 1);
  assert.equal(first.occupancy, 1);
  assert.ok(dust.longestOccupiedFraction < 0.5);
  assert.ok(dust.clearGapCount > 0);
});

test("finite sampled diagnostics are explicit proxies and report complete occupied rails", () => {
  const carpet = sampledPorosityDiagnostics(makeLinebreakerMask("sierpinski-carpet", 3), {
    angleSteps: 18,
    offsetSteps: 27,
    sampleCount: 108,
  });
  const dust = sampledPorosityDiagnostics(makeLinebreakerMask("cantor-dust", 3), {
    angleSteps: 18,
    offsetSteps: 27,
    sampleCount: 108,
  });
  assert.equal(carpet.qualification, "finite-sampled-diagnostic-only");
  assert.ok(carpet.completeOccupiedLines > 0);
  assert.equal(dust.completeOccupiedLines, 0);
  assert.ok(dust.lineGapCoverage > carpet.lineGapCoverage);
  assert.ok(dust.vacancyFraction > carpet.vacancyFraction);
});

test("complete means every sampled point is occupied and probe widths stay odd", () => {
  const size = 9;
  const row = new Uint8Array(size * size);
  for (let x = 0; x < size; x += 1) row[4 * size + x] = 1;
  const complete = probeLine(row, { size, angleDegrees: 0, offset: 0, sampleCount: 9 });
  assert.equal(complete.occupiedSamples, complete.sampleCount);
  row[4 * size + 4] = 0;
  const missing = probeLine(row, { size, angleDegrees: 0, offset: 0, sampleCount: 9 });
  assert.ok(missing.occupiedSamples < missing.sampleCount);
  assert.equal(probeLine(row, { size, widthPixels: 2 }).widthPixels, 3);
  assert.equal(probeLine(row, { size, widthPixels: 4 }).widthPixels, 5);
});

test("the normalized separable 2D DFT preserves energy and round-trips complex fields", () => {
  const size = 5;
  const real = Float64Array.from({ length: size * size }, (_, index) => Math.sin(index * 0.71));
  const imaginary = Float64Array.from({ length: size * size }, (_, index) => Math.cos(index * 0.37) * 0.25);
  const before = energy2D(real, imaginary);
  const forward = dft2D({ size, real, imaginary });
  const inverse = dft2D(forward, undefined, { inverse: true });
  approximately(forward.energy, before, 1e-9);
  approximately(inverse.energy, before, 1e-9);
  for (let index = 0; index < real.length; index += 1) {
    approximately(inverse.real[index], real[index], 1e-10);
    approximately(inverse.imaginary[index], imaginary[index], 1e-10);
  }
});

test("a spatial delta spreads uniformly while a horizontal line makes a perpendicular Fourier ridge", () => {
  const size = 9;
  const delta = new Float64Array(size * size);
  delta[4 * size + 3] = 1;
  const deltaTransform = dft2D(delta, size);
  for (const magnitude of deltaTransform.magnitude) approximately(magnitude, 1 / size, 1e-11);

  const horizontal = new Float64Array(size * size);
  for (let x = 0; x < size; x += 1) horizontal[4 * size + x] = 1;
  const lineTransform = dft2D(horizontal, size);
  for (let ky = 0; ky < size; ky += 1) {
    approximately(lineTransform.magnitude[ky * size], 1, 1e-10);
    for (let kx = 1; kx < size; kx += 1) {
      assert.ok(lineTransform.magnitude[ky * size + kx] < 1e-10);
    }
  }
  approximately(lineTransform.energy, size, 1e-9);
  assert.equal(shiftedMagnitude(lineTransform).length, size * size);
  assert.equal(dominantFourierBins(lineTransform, 4).length, 4);
});

test("fftshift centers DC on odd ternary grids", () => {
  const size = 27;
  const transform = {
    size,
    magnitude: new Float64Array(size * size),
  };
  transform.magnitude[0] = 1;
  const shifted = shiftedMagnitude(transform, { logarithmic: false });
  const center = Math.floor(size / 2);
  assert.equal(shifted[center * size + center], 1);
  assert.equal(shifted.reduce((sum, value) => sum + value, 0), 1);
});

test("Linebreaker markup states the model boundary, mappings, and primary sources", async () => {
  const html = await read("linebreaker.html");
  assert.match(html, /<body class="fractal-uncertainty-page linebreaker-page">/);
  assert.match(html, /<main class="shell fractal-uncertainty-shell"/);
  assert.match(html, /<link rel="stylesheet" href="style\.css"/);
  assert.match(html, /<link rel="stylesheet" href="fractal-uncertainty\.css"/);
  assert.match(html, /FRACTAL UNCERTAINTY · 03/);
  assert.match(html, /<h1 id="linebreakerTitle">Linebreaker<\/h1>/);
  assert.match(html, /FINITE CLASSICAL FOURIER MODEL · NOT A PROOF · NOT QPU OUTPUT/);
  assert.match(html, /one concentration set is porous in balls and the other, on the Fourier side, is porous along every line/);
  assert.match(html, /the roles may be swapped/);
  assert.match(html, /Ordinary porosity alone is insufficient in higher dimensions/);
  assert.match(html, /finite probe only illustrates[\s\S]*does not verify the hypotheses or prove/);
  assert.match(html, /https:\/\/annals\.math\.princeton\.edu\/2025\/202-1\/p04/);
  assert.match(html, /https:\/\/annals\.math\.princeton\.edu\/2018\/187-3\/p05/);
  assert.equal((html.match(/target="_blank" rel="noopener"/g) ?? []).length, 2);

  for (const mapping of [
    "probe angle → one-octave contour",
    "2D Fourier peaks → tuned partials",
    "occupied runs / gaps → tones / rests",
    "complete rail → organ · dust → grains",
    "occupancy + run length → gain",
    "probe offset → stereo position",
    "recursion depth → register layers",
    "angle scan + phrase rate → contour speed",
  ]) assert.ok(html.includes(mapping), `missing sound mapping: ${mapping}`);

  for (const id of [
    "stage",
    "stageReadout",
    "liveStatus",
    "audioButton",
    "audioState",
    "audioError",
    "presetButtons",
    "depth",
    "probeAngle",
    "probeOffset",
    "probeWidth",
    "scanButton",
    "findLineButton",
    "rootFrequency",
    "scanRate",
    "resetButton",
    "anatomyState",
    "anatomyPitch",
    "anatomyVoiceCount",
    "anatomyHarmony",
    "anatomyPhrase",
    "anatomyDynamics",
    "anatomyTimbre",
    "anatomyStereo",
    "anatomyScan",
    "anatomyVoiceList",
    "anatomyDiagnosis",
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  assert.match(html, /class="sound-anatomy"/);
  assert.match(html, /What you hear now/);
  assert.match(html, /angle ÷ 15 semitones continuously/);
  assert.match(html, /offset × 1\.9/);
  assert.match(html, /deliberately not quantized to a scale/);
  assert.match(html, /<dt>Scan angle<\/dt>/);
  assert.match(html, /<dt>Find clearest line<\/dt>/);
  assert.match(html, /id="probeWidth"[^>]*min="1"[^>]*max="5"[^>]*step="2"/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="linebreaker-app\.js"><\/script>/);
});

test("Linebreaker app provides bounded continuous sonification, gestures, and BFCache cleanup", async () => {
  const app = await read("linebreaker-app.js");
  assert.match(app, /const MAX_AUDIO_VOICES = 12/);
  assert.match(app, /new VoicePool\(MAX_AUDIO_VOICES/);
  assert.match(app, /pool\.setVoices\(voices/);
  assert.match(app, /probe\.samples\[index\]/);
  assert.match(app, /peakHarmonic\(peak\)/);
  assert.match(app, /state\.offset \* 1\.9/);
  assert.match(app, /state\.depth \+ 1/);
  assert.match(app, /mode: dusty \?/);
  assert.doesNotMatch(app, /Math\.round\(state\.angle \/ 15\)/);
  assert.match(app, /probe\.occupiedSamples === probe\.sampleCount/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(app, /event\.code === "Space"/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "f"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /event\.persisted/);
  assert.match(app, /pool\.close\(\)/);
  assert.match(app, /Math\.sqrt\(3_000_000/);
  assert.match(app, /function paintSoundAnatomy/);
  assert.match(app, /voices\.reduce\(\(sum, voice\) => sum \+ voice\.gain/);
  assert.match(app, /raw two-dimensional FFT-bin distances/);
  assert.match(app, /Every sampled phrase cell is occupied/);
  assert.match(app, /0 audible · \$\{voices\.length\} continuous contacts programmed/);
  assert.match(app, /onset transient counted separately/);
  assert.match(app, /An eligible rest→tone edge, throttled to at most one strike per 75 ms, adds/);
  assert.match(app, /Onset transient: separate rest→tone strike/);
  assert.match(app, /remain underneath at the 1\.8% rest tail/);
  assert.match(app, /Main worklet: sine-carrier \$\{synthesisModes\}/);
  assert.match(app, /Native fallback: plain \$\{waveforms\} oscillators without FM\/PM/);
  for (const id of ["rootFrequency", "scanRate", "level"]) {
    assert.match(
      app,
      new RegExp(`\\$\\("${id}"\\)\\.addEventListener\\("input", \\(\\) => \\{[\\s\\S]*?paintSoundAnatomy\\(\\)`),
      `${id} must refresh the live sound anatomy`,
    );
  }
});
