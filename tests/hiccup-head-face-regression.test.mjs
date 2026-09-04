import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  HICCUP_HEAD_DEFAULTS,
  HICCUP_HEAD_TOOTH_TINE_PROFILES,
  hiccupHeadFaceEffectTargets,
} from "../src/hiccup-head.js";

const root = new URL("../", import.meta.url);

function inspectPcmWave(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WAVE");
  let formatOffset = -1;
  let dataOffset = -1;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") formatOffset = offset + 8;
    if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize & 1);
  }
  assert.ok(formatOffset >= 0, "wave file needs a fmt chunk");
  assert.ok(dataOffset >= 0, "wave file needs a data chunk");
  const audioFormat = buffer.readUInt16LE(formatOffset);
  const channels = buffer.readUInt16LE(formatOffset + 2);
  const sampleRate = buffer.readUInt32LE(formatOffset + 4);
  const bitsPerSample = buffer.readUInt16LE(formatOffset + 14);
  const bytesPerFrame = channels * bitsPerSample / 8;
  const frames = dataSize / bytesPerFrame;
  let leftEnergy = 0;
  let rightEnergy = 0;
  let differenceEnergy = 0;
  let tailEnergy = 0;
  let earlyFieldEnergy = 0;
  let diffuseTailEnergy = 0;
  let totalEnergy = 0;
  const tailStart = Math.max(0, frames - Math.round(sampleRate * 0.2));
  const earlyFieldEnd = Math.round(sampleRate * 0.1);
  const diffuseTailStart = Math.round(sampleRate * 0.5);
  for (let frame = 0; frame < frames; frame += 1) {
    const sampleOffset = dataOffset + frame * bytesPerFrame;
    const left = buffer.readInt16LE(sampleOffset) / 32_768;
    const right = buffer.readInt16LE(sampleOffset + 2) / 32_768;
    leftEnergy += left * left;
    rightEnergy += right * right;
    differenceEnergy += (left - right) ** 2;
    const frameEnergy = left * left + right * right;
    totalEnergy += frameEnergy;
    if (frame < earlyFieldEnd) earlyFieldEnergy += frameEnergy;
    if (frame >= diffuseTailStart) diffuseTailEnergy += frameEnergy;
    if (frame >= tailStart) tailEnergy += left * left + right * right;
  }
  return {
    audioFormat,
    bitsPerSample,
    channels,
    durationSeconds: frames / sampleRate,
    diffuseTailEnergyShare: diffuseTailEnergy / Math.max(1e-12, totalEnergy),
    earlyFieldEnergyShare: earlyFieldEnergy / Math.max(1e-12, totalEnergy),
    frames,
    leftRms: Math.sqrt(leftEnergy / frames),
    rightRms: Math.sqrt(rightEnergy / frames),
    sampleRate,
    stereoDifferenceRms: Math.sqrt(differenceEnergy / frames),
    tailRms: Math.sqrt(tailEnergy / Math.max(1, (frames - tailStart) * 2)),
  };
}

test("Hiccup Head keeps one stable mouth, colored lids, and nose clearance", async () => {
  const [app, html] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("hiccup-head.html", root), "utf8"),
  ]);
  assert.match(app, /const mouthY = featureY \+ ry \* 0\.39/);
  assert.match(app, /const pupilDriftX = 0;\s*const pupilDriftY = 0;/);
  assert.match(app, /const eyeRy = baseEyeRy/);
  assert.match(app, /const lidCover = 0\.08 \+ eyeClosure \* 0\.44/);
  assert.match(app, /rgb\(244, 126, 173\)/);
  assert.match(app, /rgb\(157, 218, 125\)/);
  assert.match(app, /const earRadius = Math\.min\(rx, ry\)/);
  assert.match(app, /context\.arc\(earX, earY, earRadius, 0, Math\.PI \* 2\)/);
  assert.match(app, /rgba\(183, 116, 237/);
  assert.match(app, /rgba\(120, 78, 194/);
  assert.match(app, /context\.strokeStyle = "rgba\(151, 92, 220, 0\.98\)"/);
  assert.match(app, /context\.fillStyle = skinCheckerColors\[side < 0 \? 0 : 1\]/);
  assert.match(app, /context\.arc\(earX, earY, earRadius, 0, Math\.PI \* 2\);\s*context\.fill\(\);\s*context\.stroke\(\)/);
  assert.match(app, /id: "left-brow"[\s\S]*?step: 0\.25[\s\S]*?id: "right-brow"[\s\S]*?step: 0\.25/);
  assert.match(app, /key === "leftBrow" \|\| key === "rightBrow"[\s\S]*?normalizedBrowValue\(value\)/);
  assert.match(app, /id: "left-lid"[\s\S]*?key: "leftEyeClosure"[\s\S]*?id: "right-lid"[\s\S]*?key: "rightEyeClosure"/);
  assert.doesNotMatch(app, /type: "eye-2d"|browKey: handle\.id/);
  assert.match(app, /return Math\.round\(bounded \* 4\) \/ 4/);
  assert.doesNotMatch(html, /for="eyeClosure"|for="leftBrow"|for="rightBrow"/);
  assert.match(html, /id="eyebrowEmphasis"[^>]*max="0\.9"[^>]*value="0\.7"/);
  assert.equal(HICCUP_HEAD_DEFAULTS.leftBrow, 0);
  assert.equal(HICCUP_HEAD_DEFAULTS.rightBrow, 0);
  assert.match(app, /const DEFAULT_EYEBROW_EMPHASIS = 0\.7/);
  const resetAllSource = app.slice(
    app.indexOf("function resetAll()"),
    app.indexOf("function resetFaceEffects()"),
  );
  const resetEffectsSource = app.slice(
    app.indexOf("function resetFaceEffects()"),
    app.indexOf("function populateSelects()"),
  );
  for (const resetSource of [resetAllSource, resetEffectsSource]) {
    assert.match(resetSource, /state\.leftBrow = (?:HICCUP_HEAD_DEFAULTS|neutral)\.leftBrow/);
    assert.match(resetSource, /state\.rightBrow = (?:HICCUP_HEAD_DEFAULTS|neutral)\.rightBrow/);
    assert.match(resetSource, /eyebrowEmphasis = DEFAULT_EYEBROW_EMPHASIS/);
  }
  assert.match(app, /return \[0, 8, 6, 4, 2\]\[Math\.round/);
  assert.match(app, /const rightOffset = rightPeriod \* 0\.5/);
  assert.match(app, /state\.leftHairLength = Math\.max\(state\.leftHairLength, 0\.34\)/);
  assert.match(app, /state\.rightHairLength = Math\.max\(state\.rightHairLength, 0\.34\)/);
  assert.match(app, /state\.earSpread = Math\.max\(state\.earSpread, 0\.28\)/);
  assert.match(app, /const strandCount = compactHair \? 11 : 15/);
  assert.match(app, /const visibleEarSpread = Math\.max\(HICCUP_HEAD_DEFAULTS\.earSpread, pose\.earSpread\)/);
  assert.match(app, /const earOffset = rx \* \(0\.88 \+ visibleEarSpread \* 0\.64\)/);
  assert.match(app, /const rootX = hair\.rootX \+ side \* rx \* fan \* 0\.15/);
  assert.match(app, /const rootY = hair\.rootY \+ fan \* ry \* 0\.4/);
  assert.match(app, /strandLength \* 0\.27/);
  assert.match(app, /rawLengthAmount : 0\.14, 0\.14, 1/);
  assert.match(app, /Math\.max\(HICCUP_HEAD_DEFAULTS\.earSpread, pose\.earSpread\)/);
  assert.match(app, /HICCUP_HEAD_DEFAULTS\[pointerDrag\.lengthKey\],[\s\S]*?1,/);
  assert.match(app, /context\.bezierCurveTo\([\s\S]*?normalX \* curveAmount[\s\S]*?tipX,[\s\S]*?tipY/);
  assert.match(app, /context\.lineWidth = 13\.2 \+ goofballEnergy \* 2\.8/);
  assert.doesNotMatch(app, /noseClearanceOpening|noseY \+ noseRadius \* 1\.12/);
  const noseHonkSource = app.slice(
    app.indexOf("async function triggerNoseHonk()"),
    app.indexOf("function toothTineAtPoint("),
  );
  assert.ok(noseHonkSource.startsWith("async function triggerNoseHonk()"));
  assert.ok(
    noseHonkSource.indexOf("if (!(await ensureAudio())) return false")
      < noseHonkSource.indexOf("noseHonkStartedAt = performance.now()"),
    "a blocked audio start must not animate a honk which never sounded",
  );
  assert.match(
    noseHonkSource,
    /const duckConfiguration = sanitizeHiccupHeadState\(\{[\s\S]*?nasalMix: 0\.82,[\s\S]*?mouthOpening: 0\.09,/,
  );
  assert.match(
    noseHonkSource,
    /const duckVoice = sanitizeHiccupHeadVoice\(\{[\s\S]*?characterId: "reed",[\s\S]*?modulation: \{[\s\S]*?source: "triangle",[\s\S]*?target: "pitch",/,
  );
  assert.equal(
    (noseHonkSource.match(/graph\.sourceNode\.port\.postMessage\(/g) ?? []).length,
    1,
    "clicking the nose must schedule one physical duck strike",
  );
  assert.match(
    noseHonkSource,
    /graph\.sourceNode\.port\.postMessage\(\{[\s\S]*?type: "strike",[\s\S]*?soundId: "hiccup",[\s\S]*?configuration: audioConfiguration\(duckConfiguration\),[\s\S]*?voice: duckVoice,[\s\S]*?\}\)/,
  );
  assert.doesNotMatch(
    noseHonkSource,
    /firstHonkConfiguration|secondHonkConfiguration|secondDuckConfiguration|hornVoice|bikeHornVoice|gooseVoice/,
  );
  assert.match(
    noseHonkSource,
    /clearTimeout\(manualConfigurationResetTimer\);[\s\S]*?manualConfigurationResetTimer = setTimeout\(\(\) => \{[\s\S]*?manualConfigurationResetTimer = 0;[\s\S]*?postConfiguration\(\);[\s\S]*?\}, \d+\)/,
    "the temporary duck tract must return to the live face after a delayed reset",
  );
  assert.match(app, /noseHonkVisualActive[\s\S]*?physicalStatus = noseHonkVisualActive \? null/);
  assert.match(app, /drag\.handleId === "nose"[\s\S]*?clickTravel < 10[\s\S]*?triggerNoseHonk\(\)/);
  assert.match(app, /const noseHonkAmount =[\s\S]*?\* \(1 \+ noseHonkAmount \* 0\.28\)/);
  assert.match(app, /const noseY =[\s\S]*?- ry \* noseHonkAmount \* 0\.14/);
  assert.match(app, /const noseY = featureY \+ ry \* 0\.045 - ry \* pose\.nasalMix \* 0\.32/);
  assert.match(app, /Number\.isFinite\(independentEyeClosure\)/);
  assert.doesNotMatch(app, /context\.moveTo\(cx, mouthY - opening \* 0\.58\)/);
  assert.match(html, /Click the nose to quack or drag it to change nasality/);
  const oralOpening = app.slice(
    app.indexOf("const lipRimWidth"),
    app.indexOf("// These are discrete upper teeth"),
  );
  assert.match(oralOpening, /const lipRimWidth = clamp\(Math\.min\(rx, ry\) \* 0\.04, 5, 10\)/);
  assert.match(oralOpening, /context\.ellipse\(cx, mouthY, mouthWidth, liveOpening/);
  const canonicalMouthEllipses = oralOpening.match(/context\.ellipse\(\s*cx,\s*mouthY,/g) ?? [];
  assert.ok(canonicalMouthEllipses.length >= 1);
  assert.equal(
    canonicalMouthEllipses.length,
    oralOpening.match(/context\.ellipse\(/g)?.length,
    "every skin must reuse the one canonical mouth center",
  );
  assert.match(oralOpening, /source padding or asymmetry from ever reading as a second mouth/);
  assert.match(oralOpening, /context\.clip\("evenodd"\)/);
  assert.doesNotMatch(oralOpening, /outerMouthWidth|lipGradient|stripe/);
});

test("Hiccup Head exposes one reset-all FX control", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("hiccup-head.html", root), "utf8"),
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
  ]);
  assert.match(html, /id="resetEffectsButton"[^>]*aria-label="Reset all face effects"/);
  assert.doesNotMatch(html, /id="(?:delay|reverb|nasal|stereo)EffectButton"/);
  assert.match(app, /for \(const key of FACE_EFFECT_KEYS\) faceEffectEnabled\[key\] = true/);
  assert.match(app, /const featureOutlineWidth = 3\.2/);
  assert.match(app, /id: "left-lid"[\s\S]*?eyeRadius \* 0\.88[\s\S]*?id: "right-lid"[\s\S]*?eyeRadius \* 0\.88/);
  assert.match(app, /id: "left-lid"[\s\S]*?scale: eyeRadius \* 0\.7[\s\S]*?id: "right-lid"[\s\S]*?scale: eyeRadius \* 0\.7/);
});

test("Hiccup Head presets have next buttons and performance arrow shortcuts", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("hiccup-head.html", root), "utf8"),
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
  ]);
  assert.match(html, /id="nextFacePresetButton"[^>]*aria-label="Next face preset"/);
  assert.match(html, /id="nextPatternButton"[^>]*aria-label="Next rhythm preset"/);
  assert.match(app, /function cycleFacePreset\(direction = 1\)/);
  assert.match(app, /function cyclePatternPreset\(direction = 1\)/);
  assert.match(app, /event\.code === "ArrowLeft" \|\| event\.code === "ArrowRight"/);
  assert.match(app, /event\.code === "ArrowUp" \|\| event\.code === "ArrowDown"/);
});

test("right-eyebrow accents remain audible when their mask overlaps the left brow", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const source = app.slice(
    app.indexOf("function normalizedBrowValue("),
    app.indexOf("function scheduleSequence("),
  );
  const makeGain = Function(
    "clamp",
    "eyebrowEmphasis",
    `${source}; return browSequenceGain;`,
  );
  const localClamp = (value, minimum = 0, maximum = 1) => (
    Math.min(maximum, Math.max(minimum, Number(value) || 0))
  );
  const gain = makeGain(localClamp, 0.7);

  assert.ok(gain(3, 0, 0.25, 0.7) > gain(3, 0, 0, 0.7));
  assert.ok(gain(3, 1, 0.25, 0.7) > gain(3, 1, 0, 0.7));
  assert.ok(gain(3, 0.75, 0.25, 0.7) > gain(3, 0.75, 0, 0.7));
  assert.ok(gain(2, 0, 0.5, 0.7) > gain(2, 0, 0, 0.7));
  assert.match(source, /const hitCount = Number\(leftHit\) \+ Number\(rightHit\)/);
});

test("Hiccup Head keeps mutation audible and freckles clear of anatomy", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  assert.match(app, /lungPressure: clamp\(state\.lungPressure, 0\.5, 1\)/);
  assert.match(app, /tonguePosition: clamp\(state\.tonguePosition, -0\.25, 1\.25\)/);
  assert.match(app, /const forbiddenCircles = \[/);
  assert.match(app, /const mouthDistance = Math\.hypot\(mouthDx, mouthDy\)/);
});

test("Hiccup Head stays centered and keeps the mobile one-lane sequencer nearby", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("hiccup-head.css", root), "utf8"),
  ]);
  assert.match(app, /const cx = cssWidth \* 0\.5/);
  assert.doesNotMatch(app, /headingClearance/);
  const mobile = css.slice(css.indexOf("@media (max-width: 960px)"));
  assert.match(mobile, /\.hiccup-head-shell\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(mobile, /\.hiccup-head-workspace\s*\{[\s\S]*?display:\s*contents/);
  assert.match(mobile, /\.hiccup-head-stage\s*\{[\s\S]*?position:\s*sticky[\s\S]*?top:\s*0/);
  assert.match(css, /\.hiccup-head-step-slot\s*\{[\s\S]*?grid-template-rows:\s*208px 24px/);
  assert.match(mobile, /\.hiccup-head-step-slot\s*\{[\s\S]*?grid-template-rows:\s*150px 44px/);
  assert.doesNotMatch(css, /\.hiccup-head-step-number/);
});

test("Hiccup Head loads black and warm white, then varies distinct step checker pairs", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const palette = app.slice(
    app.indexOf("const SKIN_CHECKER_PALETTE"),
    app.indexOf("// These are performance-level bypasses"),
  );
  assert.match(palette, /pink/);
  assert.match(palette, /yellow/);
  assert.match(palette, /orange/);
  assert.match(palette, /green/);
  assert.match(palette, /blue/);
  assert.match(palette, /white/);
  assert.match(palette, /brown/);
  assert.match(palette, /black/);
  assert.match(palette, /dark berry/);
  assert.match(palette, /function seededCheckerIndex\(step, salt\)/);
  assert.match(palette, /const secondIndex = secondDraw >= firstIndex \? secondDraw \+ 1 : secondDraw/);
  assert.doesNotMatch(palette, /rgba|hsla/);

  const checkerApi = Function(
    "HICCUP_HEAD_STEP_COUNT",
    `${palette}\nreturn {
      palette: SKIN_CHECKER_PALETTE,
      stopped: STOPPED_SKIN_CHECKER_COLORS,
      sequence: SEQUENCE_SKIN_CHECKER_COLORS,
      forStep: skinCheckerColorsForStep,
    };`,
  )(64);
  assert.deepEqual(
    checkerApi.stopped,
    ["rgb(22, 20, 24)", "rgb(250, 246, 232)"],
    "the face must first appear as a black and warm-white checkerboard",
  );
  assert.equal(checkerApi.forStep(-1), checkerApi.stopped);
  assert.equal(checkerApi.forStep(Number.NaN), checkerApi.stopped);
  assert.equal(checkerApi.sequence.length, 64);

  const paletteSet = new Set(checkerApi.palette);
  const pairSignatures = [];
  const usedColors = new Set();
  for (let step = 0; step < checkerApi.sequence.length; step += 1) {
    const pair = checkerApi.sequence[step];
    assert.equal(pair.length, 2);
    assert.notEqual(pair[0], pair[1], `step ${step + 1} needs two distinct colors`);
    assert.ok(paletteSet.has(pair[0]));
    assert.ok(paletteSet.has(pair[1]));
    assert.equal(checkerApi.forStep(step), pair);
    assert.equal(checkerApi.forStep(step + 64), pair);
    pairSignatures.push(pair.join("|"));
    usedColors.add(pair[0]);
    usedColors.add(pair[1]);
  }
  assert.ok(
    new Set(pairSignatures).size >= 40,
    "the 64 sequencer steps must retain broadly varied seeded color pairings",
  );
  assert.equal(
    usedColors.size,
    checkerApi.palette.length,
    "step pairings should continue sampling the full mixed checker palette",
  );
});

test("local EMT plate and York hall impulses are real stereo PCM with attribution", async () => {
  const [app, attribution, plateFile, cathedralFile] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("assets/audio/HICCUP_HEAD_REVERB_ATTRIBUTION.md", root), "utf8"),
    readFile(new URL("assets/audio/hiccup-head-emt140-warm-plate.wav", root)),
    readFile(new URL("assets/audio/hiccup-head-york-minster-warm-hall.wav", root)),
  ]);
  const plate = inspectPcmWave(plateFile);
  const cathedral = inspectPcmWave(cathedralFile);
  for (const impulse of [plate, cathedral]) {
    assert.equal(impulse.audioFormat, 1, "IR assets must be uncompressed PCM");
    assert.equal(impulse.bitsPerSample, 16);
    assert.equal(impulse.channels, 2);
    assert.equal(impulse.sampleRate, 48_000);
    assert.ok(impulse.leftRms > 0.0001);
    assert.ok(impulse.rightRms > 0.0001);
    assert.ok(impulse.stereoDifferenceRms > 0.0001, "IR channels must not be mono clones");
    assert.ok(impulse.tailRms > 0.00001, "IR must preserve an audible decaying tail");
  }
  assert.equal(plate.durationSeconds, 2.6);
  assert.equal(cathedral.durationSeconds, 4.4);
  assert.ok(cathedral.frames > plate.frames * 1.6);
  assert.ok(plate.earlyFieldEnergyShare < 0.17);
  assert.ok(plate.diffuseTailEnergyShare > 0.19);
  assert.ok(cathedral.earlyFieldEnergyShare < 0.09);
  assert.ok(cathedral.diffuseTailEnergyShare > 0.34);
  assert.ok(plateFile.length < 600_000, "plate asset should stay practical on phones");
  assert.ok(cathedralFile.length < 900_000, "hall asset should stay practical on phones");

  assert.match(app, /hiccup-head-emt140-warm-plate\.wav/);
  assert.match(app, /hiccup-head-york-minster-warm-hall\.wav/);
  const urls = app.slice(
    app.indexOf("const WARM_ROOM_IMPULSE_URLS"),
    app.indexOf("let warmRoomImpulseDataPromise"),
  );
  assert.doesNotMatch(urls, /https?:\/\//, "runtime IR requests must remain same-origin");
  assert.match(attribution, /Greg Hopkins/);
  assert.match(attribution, /Oramics Sampled/);
  assert.match(attribution, /emt_140_dark_3\.wav/);
  assert.match(attribution, /Creative Commons Attribution/);
  assert.match(attribution, /OpenAIR/);
  assert.match(attribution, /University of York/);
  assert.match(attribution, /York Minster/);
  assert.match(attribution, /Creative Commons Attribution 4\.0/);
  assert.match(attribution, /retained the first 2\.6 seconds/);
  assert.match(attribution, /retained the following 4\.4-second diffuse late field/);
  assert.match(attribution, /initial field[\s\S]*?40% through 5 ms[\s\S]*?120 ms/);
  assert.match(attribution, /initial field[\s\S]*?40% through 12 ms[\s\S]*?170 ms/);
});

test("eye convolution sends and the in-series high-pass sweep progressively", () => {
  const enabled = { reverb: true };
  const neutral = hiccupHeadFaceEffectTargets({ eyeDivergence: 0 }, enabled);
  const crossed = hiccupHeadFaceEffectTargets({ eyeDivergence: -1 }, enabled);
  const outward = hiccupHeadFaceEffectTargets({ eyeDivergence: 1 }, enabled);
  assert.equal(neutral.plateSendGain, 0);
  assert.equal(neutral.cathedralSendGain, 0);
  assert.equal(neutral.roomDryGain, 1);
  assert.equal(crossed.plateSendGain, 0.38);
  assert.equal(crossed.cathedralSendGain, 0);
  assert.equal(outward.cathedralSendGain, 0.36);
  assert.equal(outward.plateSendGain, 0);

  const positive = [0, 0.25, 0.5, 0.75, 1].map((eyeDivergence) => (
    hiccupHeadFaceEffectTargets({ eyeDivergence }, enabled)
  ));
  const negative = [0, -0.25, -0.5, -0.75, -1].map((eyeDivergence) => (
    hiccupHeadFaceEffectTargets({ eyeDivergence }, enabled)
  ));
  for (let index = 1; index < positive.length; index += 1) {
    assert.ok(positive[index].cathedralSendGain > positive[index - 1].cathedralSendGain);
    assert.equal(positive[index].plateSendGain, 0);
    assert.ok(negative[index].plateSendGain > negative[index - 1].plateSendGain);
    assert.equal(negative[index].cathedralSendGain, 0);
  }
  for (const targets of [...positive, ...negative]) assert.equal(targets.roomDryGain, 1);
  assert.equal(hiccupHeadFaceEffectTargets({ eyeDivergence: -0.9 }, enabled).plateSendGain, 0.38);
  assert.equal(hiccupHeadFaceEffectTargets({ eyeDivergence: 0.9 }, enabled).cathedralSendGain, 0.36);

  const closures = [0, 0.25, 0.5, 0.75, 1];
  const highpassTargets = closures.map((leftEyeClosure) => hiccupHeadFaceEffectTargets({
    leftEyeClosure,
    rightEyeClosure: 0,
  }, enabled));
  const fuzzTargets = closures.map((rightEyeClosure) => hiccupHeadFaceEffectTargets({
    leftEyeClosure: 0,
    rightEyeClosure,
  }, enabled));
  for (let index = 1; index < closures.length; index += 1) {
    assert.ok(Math.abs(
      highpassTargets[index].highpassAmount - closures[index] ** 0.75
    ) < 1e-12);
    assert.ok(
      highpassTargets[index].highpassCutoffHz > highpassTargets[index - 1].highpassCutoffHz,
    );
    assert.ok(highpassTargets[index].highpassQ > highpassTargets[index - 1].highpassQ);
    assert.ok(
      highpassTargets[index].highpassMakeupGain
        > highpassTargets[index - 1].highpassMakeupGain,
    );
    assert.equal(highpassTargets[index].highpassWetGain, 1);
    assert.equal(highpassTargets[index].highpassDryGain, 0);
    assert.ok(fuzzTargets[index].fuzzDriveGain > fuzzTargets[index - 1].fuzzDriveGain);
    assert.ok(fuzzTargets[index].fuzzWetGain > fuzzTargets[index - 1].fuzzWetGain);
    assert.ok(fuzzTargets[index].fuzzDryGain < fuzzTargets[index - 1].fuzzDryGain);
    assert.equal(fuzzTargets[index].fuzzToneHz, 0);
  }
  assert.equal(highpassTargets[0].highpassCutoffHz, 30);
  assert.equal(highpassTargets[0].highpassQ, 0.707);
  assert.equal(highpassTargets[0].highpassMakeupGain, 1);
  const closedHighpass = highpassTargets.at(-1);
  assert.ok(Math.abs(closedHighpass.highpassCutoffHz - 10_000) < 1e-9);
  assert.equal(closedHighpass.highpassQ, 2.707);
  assert.equal(closedHighpass.highpassMakeupGain, 1.32);
  assert.equal(closedHighpass.highpassDryGain, 0);
  assert.equal(closedHighpass.highpassWetGain, 1);
  assert.equal(closedHighpass.fuzzAmount, 0);
  const closedFuzz = fuzzTargets.at(-1);
  assert.equal(closedFuzz.fuzzDriveGain, 10);
  assert.equal(closedFuzz.fuzzWetGain, 0.99 * 0.74);
  assert.ok(Math.abs(closedFuzz.fuzzDryGain - 0.01) < 1e-12);
  assert.equal(closedFuzz.fuzzToneHz, 0);
  assert.equal(closedFuzz.highpassAmount, 0);

  const bypassed = hiccupHeadFaceEffectTargets({
    eyeDivergence: 1,
    leftEyeClosure: 1,
    rightEyeClosure: 1,
  }, { reverb: false });
  assert.equal(bypassed.cathedralSendGain, 0);
  assert.equal(bypassed.plateSendGain, 0);
  assert.equal(bypassed.roomWetGate, 0);
  assert.equal(bypassed.roomDryGain, 1);
  assert.equal(bypassed.highpassAmount, 1);
  assert.equal(bypassed.fuzzAmount, 1);

});

test("native convolution feeds post-room fuzz and the in-series Biquad makeup stage", async () => {
  const [app, processor] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("src/hiccup-head-processor.js", root), "utf8"),
  ]);
  const postConfiguration = app.slice(
    app.indexOf("function postConfiguration("),
    app.indexOf("function startOutputPrimer("),
  );
  const nativeUpdate = app.slice(
    app.indexOf("function updateNativeFaceEffects("),
    app.indexOf("function clearNativeRoomHistory("),
  );
  const graphSource = app.slice(
    app.indexOf("async function createAudioGraph("),
    app.indexOf("async function initializeAudio("),
  );

  assert.match(postConfiguration, /const configuration = audioConfiguration\(overrides\)/);
  assert.match(postConfiguration, /type: "configure",\s*configuration/);
  assert.match(postConfiguration, /graph\?\.sourceNode\?\.port\.postMessage/);
  assert.match(postConfiguration, /graph\?\.facePostNode\?\.port\.postMessage/);
  assert.match(postConfiguration, /updateNativeFaceEffects\(configuration\)/);
  assert.match(nativeUpdate, /hiccupHeadFaceEffectTargets\(configuration, faceEffectEnabled\)/);
  for (const target of [
    "roomDryGain", "plateSendGain", "cathedralSendGain", "roomWetGate",
    "highpassCutoffHz", "highpassQ", "highpassMakeupGain",
  ]) {
    assert.match(nativeUpdate, new RegExp(`targets\\.${target}`));
  }
  assert.doesNotMatch(nativeUpdate, /targets\.fuzz|highpassDryGain|highpassWetGain/);
  assert.doesNotMatch(
    nativeUpdate,
    /fetch|decodeAudioData|createConvolver|createBiquadFilter|createWaveShaper/,
    "live face drags must only automate existing nodes",
  );

  assert.match(app, /const attempt = Promise\.all/);
  assert.match(app, /warmRoomImpulseDataPromise = attempt/);
  assert.match(app, /Promise\.race\([\s\S]*?fetch\(url/);
  assert.match(app, /WARM_ROOM_FETCH_TIMEOUT_MS = 4_000/);
  assert.match(app, /warmRoomImpulseDataPromise === attempt[\s\S]*?warmRoomImpulseDataPromise = null/);
  assert.match(app, /context\.decodeAudioData\(encoded\.plate\.slice\(0\)\)/);
  assert.match(app, /context\.decodeAudioData\(encoded\.cathedral\.slice\(0\)\)/);
  assert.match(graphSource, /const nativeHighpassAvailable = typeof context\.createBiquadFilter === "function"/);
  assert.match(
    graphSource,
    /const nativeReverbAvailable = Boolean\([\s\S]*?warmRoomBuffers\?\.plate && warmRoomBuffers\?\.cathedral/,
  );
  assert.match(graphSource, /externalFuzz: true/);
  assert.match(graphSource, /externalHighpass: true/);
  assert.match(graphSource, /externalReverb: true/);
  assert.match(graphSource, /new AudioWorkletNode\(context, "hiccup-head-face-post"/);
  assert.match(graphSource, /facePostNode[\s\S]*?externalHighpass: nativeHighpassAvailable/);
  assert.equal((graphSource.match(/context\.createConvolver\(\)/g) ?? []).length, 2);
  assert.match(graphSource, /plateConvolver\.normalize = true/);
  assert.match(graphSource, /plateConvolver\.buffer = warmRoomBuffers\.plate/);
  assert.match(graphSource, /cathedralConvolver\.normalize = true/);
  assert.match(graphSource, /cathedralConvolver\.buffer = warmRoomBuffers\.cathedral/);
  assert.match(graphSource, /plateReturnHighpass\.frequency\.value = 120/);
  assert.match(graphSource, /plateReturnLowpass\.frequency\.value = 7_200/);
  assert.match(graphSource, /cathedralReturnHighpass\.frequency\.value = 100/);
  assert.match(graphSource, /cathedralReturnLowpass\.frequency\.value = 5_800/);
  assert.match(graphSource, /highpass\.type = "highpass"/);
  assert.doesNotMatch(graphSource, /createWaveShaper|context\.createDelay\(/);

  for (const edge of [
    "sourceNode.connect(roomDryGain)",
    "roomDryGain.connect(roomBus)",
    "sourceNode.connect(plateSendGain)",
    "plateSendGain.connect(plateConvolver)",
    "plateConvolver.connect(plateReturnHighpass)",
    "plateReturnHighpass.connect(plateReturnLowpass)",
    "plateReturnLowpass.connect(plateReturnGain)",
    "plateReturnGain.connect(roomBus)",
    "sourceNode.connect(cathedralSendGain)",
    "cathedralSendGain.connect(cathedralConvolver)",
    "cathedralConvolver.connect(cathedralReturnHighpass)",
    "cathedralReturnHighpass.connect(cathedralReturnLowpass)",
    "cathedralReturnLowpass.connect(cathedralReturnGain)",
    "cathedralReturnGain.connect(roomBus)",
    "postRoomNode.connect(facePostNode)",
    "postRoomNode.connect(highpass)",
    "highpass.connect(highpassMakeupGain)",
    "highpassMakeupGain.connect(masterGain)",
  ]) {
    assert.ok(graphSource.includes(edge), `missing native face edge: ${edge}`);
  }
  assert.ok(
    graphSource.indexOf("postRoomNode = roomBus")
      < graphSource.indexOf("postRoomNode.connect(facePostNode)")
      && graphSource.indexOf("postRoomNode.connect(facePostNode)")
        < graphSource.indexOf("postRoomNode.connect(highpass)"),
    "room convolution must feed post-room fuzz, then the in-series native sweep",
  );
  assert.ok(
    graphSource.indexOf("let postRoomNode = sourceNode")
      < graphSource.indexOf("if (nativeReverbAvailable)")
      && graphSource.indexOf("if (nativeReverbAvailable)")
        < graphSource.indexOf("postRoomNode.connect(facePostNode)"),
    "failed IR loading must retain the dry source path into post-room face processing",
  );
  assert.match(processor, /constructor\(rate, externalReverb = false\)/);
  assert.match(processor, /this\.externalHighpass = Boolean\(options\.processorOptions\?\.externalHighpass\)/);
  assert.match(processor, /this\.externalFuzz = Boolean\(options\.processorOptions\?\.externalFuzz\)/);
  assert.match(processor, /this\.externalReverb = Boolean\(options\.processorOptions\?\.externalReverb\)/);
  assert.match(processor, /this\.faceSpace = new FaceSpace\(this\.rate, this\.externalReverb\)/);
  assert.match(
    processor,
    /if \(this\.externalReverb\) \{[\s\S]*?this\.left = hairLeft;[\s\S]*?this\.right = hairRight;[\s\S]*?return;/,
  );
  const stableFuzzSource = processor.slice(
    processor.indexOf("function initializeStableFuzz("),
    processor.indexOf("class HiccupHeadPhysicalProcessor"),
  );
  assert.match(stableFuzzSource, /function envelopeRoundedFuzzSample\(sample, envelope, drive\)/);
  assert.match(stableFuzzSource, /sample \/ envelope \* drive/);
  assert.match(stableFuzzSource, /drivenInput \/ Math\.sqrt\(1 \+ drivenInput \* drivenInput\)/);
  assert.match(stableFuzzSource, /const drive = 1 \+ 9 \* lidFuzz \*\* 1\.1/);
  assert.match(stableFuzzSource, /const blend = lidFuzz \* 0\.99/);
  assert.doesNotMatch(stableFuzzSource, /Math\.tanh|allpass|fuzzTone|clippedInput/);
  assert.match(processor, /if \(!this\.externalFuzz\) \{[\s\S]*?processStableFuzz\(this, boundedLeft, boundedRight, lidFuzz\)/);
  assert.match(processor, /if \(!this\.externalHighpass\) \{/);
  assert.match(processor, /class HiccupHeadFacePostProcessor extends AudioWorkletProcessor/);
  const facePostSource = processor.slice(
    processor.indexOf("class HiccupHeadFacePostProcessor"),
    processor.indexOf('registerProcessor("hiccup-head-physical-model"'),
  );
  assert.match(facePostSource, /processStableFuzz\(this, left, right, this\.rightClosure\)/);
  assert.match(facePostSource, /if \(!this\.externalHighpass\)/);
  assert.ok(
    facePostSource.indexOf("processStableFuzz(this, left, right")
      < facePostSource.indexOf("if (!this.externalHighpass)"),
    "the compatibility high-pass must follow post-room fuzz",
  );
  assert.match(processor, /registerProcessor\("hiccup-head-face-post", HiccupHeadFacePostProcessor\)/);
});

test("Hiccup Head keeps FX energy balanced and gives BRUSH tuned marimba steps", async () => {
  const [app, processor] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("src/hiccup-head-processor.js", root), "utf8"),
  ]);
  assert.match(processor, /Both hairs feed a centered two-tap delay network/);
  assert.match(processor, /const centeredDelay =/);
  assert.match(processor, /const matchedWidthFrames = Math\.max\(12, Math\.round\(rate \* 0\.00517\)\)/);
  for (const name of [
    "widthLeftBuffer", "widthLeftTailBuffer", "widthLeftThirdBuffer",
    "widthRightBuffer", "widthRightTailBuffer", "widthRightThirdBuffer",
  ]) {
    assert.match(processor, new RegExp(`this\\.${name} = new Float64Array`));
  }
  assert.match(
    processor,
    /matchedWidthFrames - widthLeftFrames - widthLeftTailFrames/,
  );
  assert.match(
    processor,
    /matchedWidthFrames - widthRightFrames - widthRightTailFrames/,
  );
  const faceProcess = processor.slice(
    processor.indexOf("  process(left, right, configuration)"),
    processor.indexOf("  scalarsAreFinite()"),
  );
  assert.ok(
    faceProcess.indexOf("const hairMidpoint")
      < faceProcess.indexOf("const widthCoefficient"),
    "the matched ear field must widen the complete centered hair result",
  );
  assert.match(faceProcess, /const widthLeftHead = this\._allpass[\s\S]*?const widthLeftTail = this\._allpass[\s\S]*?const phaseLeft = this\._allpass/);
  assert.match(faceProcess, /const widthRightHead = this\._allpass[\s\S]*?const widthRightTail = this\._allpass[\s\S]*?const phaseRight = this\._allpass/);
  assert.match(faceProcess, /const widthCoefficient = 0\.35/);
  assert.doesNotMatch(processor, /widthCoefficient\s*=\s*[^;]*earCurve/);
  assert.match(faceProcess, /const rawDecorrelatedSide = \(phaseLeft - phaseRight\) \* 0\.5/);
  assert.match(faceProcess, /const decorrelatedSide = rawDecorrelatedSide - this\.widthSideLow/);
  assert.match(faceProcess, /const existingSideGain = 1 \+ this\.earAmount \* 1\.25/);
  assert.match(faceProcess, /const diffuseSideGain = earCurve \* \(0\.35 \+ this\.earAmount \* 0\.65\)/);
  assert.match(faceProcess, /const widenedSide = hairInputSide \* existingSideGain[\s\S]*?decorrelatedSide \* diffuseSideGain/);
  assert.match(faceProcess, /const hairLeft = cleanWave\(hairMidpoint \+ widenedSide\)/);
  assert.match(faceProcess, /const hairRight = cleanWave\(hairMidpoint - widenedSide\)/);
  assert.match(processor, /this\.stereoDelayMs = 0/);
  assert.match(processor, /const leftLidHighpass = leftEyeClosure \*\* 0\.75/);
  assert.match(processor, /const rightLidFuzz = rightEyeClosure/);
  assert.match(processor, /this\.eyelidHighpassAmount = leftLidHighpass/);
  assert.match(processor, /this\.eyelidFuzzAmount = rightLidFuzz/);
  assert.match(processor, /const postVelocity = 0\.42 \+ finite\(this\.gesture\?\.velocity, 0\.65\) \* 0\.58/);
  assert.match(processor, /Math\.tanh\(presenceLeft \* 42\)/);
  assert.equal(HICCUP_HEAD_DEFAULTS.level, 0.76);
  const outputTrimMatch = processor.match(
    /const GESTURE_OUTPUT_GAIN = Object\.freeze\((\{[\s\S]*?\})\);/,
  );
  assert.ok(outputTrimMatch, "gesture output trims must remain explicit and auditable");
  const outputTrims = Function(`return (${outputTrimMatch[1]});`)();
  assert.deepEqual(outputTrims, {
    bop: 1.15,
    boop: 2.35,
    pop: 2.8,
    shh: 2.15,
    pff: 2.6,
    hiccup: 3,
    mwah: 2.35,
    kiss: 2.7,
    pbpb: 2.15,
    tomhi: 2.1,
    braap: 1.7,
    brush: 0.72,
    huff: 2.1,
    waow: 0.82,
    whoop: 0.72,
    doodoo: 1,
    llll: 0.75,
    purr: 0.98,
    grunt: 1.18,
    klikklak: 1.55,
    rrrr: 0.92,
    lrroll: 0.72,
    lalatrip: 0.9,
    hiccuplong: 1.35,
    zzzz: 1.35,
    ehyeah: 0.9,
    rattle: 0.35,
  });
  assert.deepEqual(
    HICCUP_HEAD_TOOTH_TINE_PROFILES.map(({ frequencyHz, brightness }) => [frequencyHz, brightness]),
    [
      [130.81, 0.42], [146.83, 0.46], [164.81, 0.5], [196, 0.54],
      [220, 0.48], [261.63, 0.56], [293.66, 0.5], [329.63, 0.58],
      [392, 0.52], [440, 0.6], [523.25, 0.54], [587.33, 0.62],
    ],
  );
  assert.match(app, /const TOOTH_TINE_PROFILES = HICCUP_HEAD_TOOTH_TINE_PROFILES/);
  assert.match(app, /brushDirection = nextBrushDirection;[\s\S]*?nextBrushDirection \*= -1/);
  assert.match(processor, /this\.brushSweepDirection = this\.currentPlan\.brushDirection === -1 \? -1 : 1/);
  assert.match(processor, /while \(this\.brushContactIndex < nextContact\)[\s\S]*?this\.toothTine\.strikeNow/);
  assert.match(app, /const travelPhase = brushSweep\.direction < 0 \? 1 - phase : phase/);
  assert.match(app, /const scrub = Math\.sin\(phase \* Math\.PI \* 24\)/);
  assert.match(app, /hotspot\.soundId === "brush"/);
  assert.match(processor, /frame\.soundId === "kiss" \? 2\.2/);
  const reverbBypass = app.slice(
    app.indexOf("if (!faceEffectEnabled.reverb)"),
    app.indexOf("if (!faceEffectEnabled.nasal)"),
  );
  assert.match(reverbBypass, /configuration\.eyeDivergence = 0/);
  assert.doesNotMatch(reverbBypass, /eyeClosure|leftEyeClosure|rightEyeClosure/);
});

test("quiet fuzz, fallback high-pass, and post-hair ear width stay audible and balanced", async () => {
  const keys = ["sampleRate", "AudioWorkletProcessor", "registerProcessor"];
  const originals = new Map(keys.map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  const processors = new Map();
  let PhysicalProcessor = null;
  let FacePostProcessor = null;
  Object.defineProperty(globalThis, "sampleRate", {
    configurable: true,
    writable: true,
    value: 48_000,
  });
  Object.defineProperty(globalThis, "AudioWorkletProcessor", {
    configurable: true,
    writable: true,
    value: class {
      constructor() {
        this.port = { onmessage: null, postMessage() {} };
      }
    },
  });
  Object.defineProperty(globalThis, "registerProcessor", {
    configurable: true,
    writable: true,
    value: (name, Constructor) => { processors.set(name, Constructor); },
  });

  const rms = (samples, start = 0, end = samples.length) => {
    let energy = 0;
    for (let index = start; index < end; index += 1) energy += samples[index] ** 2;
    return Math.sqrt(energy / Math.max(1, end - start));
  };
  const render = (
    soundId,
    overrides,
    blocks,
    {
      externalFuzz = false,
      externalHighpass = false,
      externalReverb = false,
    } = {},
  ) => {
    const configuration = {
      ...HICCUP_HEAD_DEFAULTS,
      leftHairLength: 0,
      rightHairLength: 0,
      eyeDivergence: 0,
      eyeClosure: 0,
      leftEyeClosure: 0,
      rightEyeClosure: 0,
      ...overrides,
    };
    const processor = new PhysicalProcessor({
      processorOptions: {
        configuration,
        externalFuzz,
        externalHighpass,
        externalReverb,
      },
    });
    processor._handleMessage({
      type: "strike",
      soundId,
      velocity: 0.86,
      configuration,
    });
    const left = new Float32Array(blocks * 128);
    const right = new Float32Array(blocks * 128);
    for (let block = 0; block < blocks; block += 1) {
      processor.process([], [[
        left.subarray(block * 128, (block + 1) * 128),
        right.subarray(block * 128, (block + 1) * 128),
      ]]);
    }
    return { left, right, processor };
  };
  const processFacePost = (
    input,
    overrides,
    { externalHighpass = true } = {},
  ) => {
    const configuration = {
      ...HICCUP_HEAD_DEFAULTS,
      eyeClosure: 0,
      leftEyeClosure: 0,
      rightEyeClosure: 0,
      ...overrides,
    };
    const processor = new FacePostProcessor({
      processorOptions: { configuration, externalHighpass },
    });
    const left = new Float32Array(input.left.length);
    const right = new Float32Array(input.right.length);
    for (let offset = 0; offset < left.length; offset += 128) {
      const end = Math.min(left.length, offset + 128);
      processor.process(
        [[input.left.subarray(offset, end), input.right.subarray(offset, end)]],
        [[left.subarray(offset, end), right.subarray(offset, end)]],
      );
    }
    return { left, right, processor };
  };
  const relativeDifference = (clean, effected) => {
    let differenceEnergy = 0;
    let cleanEnergy = 0;
    for (let index = 0; index < clean.length; index += 1) {
      differenceEnergy += (clean[index] - effected[index]) ** 2;
      cleanEnergy += clean[index] ** 2;
    }
    return Math.sqrt(differenceEnergy / Math.max(1e-12, cleanEnergy));
  };
  const sineInput = (amplitude, frames = 16_384, frequencyHz = 375) => {
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = amplitude * Math.sin(Math.PI * 2 * frequencyHz * frame / 48_000);
      left[frame] = sample;
      right[frame] = sample;
    }
    return { left, right };
  };
  const sinusoidAmplitude = (
    samples,
    frequencyHz,
    start = 4_096,
    end = samples.length,
  ) => {
    let sine = 0;
    let cosine = 0;
    for (let frame = start; frame < end; frame += 1) {
      const phase = Math.PI * 2 * frequencyHz * frame / 48_000;
      sine += samples[frame] * Math.sin(phase);
      cosine += samples[frame] * Math.cos(phase);
    }
    return Math.hypot(sine, cosine) * 2 / Math.max(1, end - start);
  };
  const harmonicRatio = (samples, fundamentalHz = 375) => {
    const fundamental = sinusoidAmplitude(samples, fundamentalHz);
    const third = sinusoidAmplitude(samples, fundamentalHz * 3);
    const fifth = sinusoidAmplitude(samples, fundamentalHz * 5);
    return Math.hypot(third, fifth) / Math.max(1e-12, fundamental);
  };
  const upperHarmonicShare = (samples, fundamentalHz = 375) => {
    const partials = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]
      .map((partial) => ({
        partial,
        amplitude: sinusoidAmplitude(samples, fundamentalHz * partial),
      }));
    const distortion = Math.hypot(...partials.map(({ amplitude }) => amplitude));
    const upper = Math.hypot(...partials
      .filter(({ partial }) => [15, 21, 31].includes(partial))
      .map(({ amplitude }) => amplitude));
    return upper / Math.max(1e-12, distortion);
  };
  const stereoMetrics = ({ left, right }, start = 0, end = left.length) => {
    let leftEnergy = 0;
    let rightEnergy = 0;
    let midEnergy = 0;
    let sideEnergy = 0;
    for (let frame = start; frame < end; frame += 1) {
      const mid = (left[frame] + right[frame]) * 0.5;
      const side = (left[frame] - right[frame]) * 0.5;
      leftEnergy += left[frame] ** 2;
      rightEnergy += right[frame] ** 2;
      midEnergy += mid ** 2;
      sideEnergy += side ** 2;
    }
    const frames = Math.max(1, end - start);
    const midRms = Math.sqrt(midEnergy / frames);
    const sideRms = Math.sqrt(sideEnergy / frames);
    return {
      leftRms: Math.sqrt(leftEnergy / frames),
      midRms,
      rightRms: Math.sqrt(rightEnergy / frames),
      sideRms,
      sideToMid: sideRms / Math.max(1e-12, midRms),
    };
  };

  try {
    await import(`../src/hiccup-head-processor.js?face-fx=${Date.now()}-${Math.random()}`);
    PhysicalProcessor = processors.get("hiccup-head-physical-model");
    FacePostProcessor = processors.get("hiccup-head-face-post");
    assert.equal(typeof PhysicalProcessor, "function");
    assert.equal(typeof FacePostProcessor, "function");

    for (const amplitude of [0.0005, 0.002, 0.01]) {
      const input = sineInput(amplitude);
      const clean = processFacePost(input, {}, { externalHighpass: true });
      const halfFuzzy = processFacePost(
        input,
        { rightEyeClosure: 0.5 },
        { externalHighpass: true },
      );
      const fuzzy = processFacePost(
        input,
        { rightEyeClosure: 1 },
        { externalHighpass: true },
      );
      const cleanHarmonics = harmonicRatio(clean.left);
      const halfHarmonics = harmonicRatio(halfFuzzy.left);
      const fuzzHarmonics = harmonicRatio(fuzzy.left);
      const fuzzLevelRatio = rms(fuzzy.left, 4_096) / Math.max(1e-12, rms(clean.left, 4_096));
      assert.ok(cleanHarmonics < 0.0001, `${amplitude} clean harmonics ${cleanHarmonics}`);
      assert.ok(halfHarmonics > 0.04, `${amplitude} half-fuzz harmonics ${halfHarmonics}`);
      assert.ok(fuzzHarmonics > halfHarmonics * 1.08, `${amplitude} full-fuzz harmonics ${fuzzHarmonics}`);
      assert.ok(
        fuzzLevelRatio > 0.9 && fuzzLevelRatio < 1.1,
        `${amplitude} fuzz level ${fuzzLevelRatio}`,
      );
      assert.ok(
        upperHarmonicShare(fuzzy.left) < 0.11,
        `${amplitude} rounded fuzz must keep the metallic upper partials restrained`,
      );
      assert.ok(
        rms(fuzzy.left, 4_096) > amplitude * 0.35,
        `${amplitude} fuzz must stay above an absolute quiet-source floor`,
      );
    }

    const impulseInput = {
      left: new Float32Array(256),
      right: new Float32Array(256),
    };
    impulseInput.left[37] = 0.002;
    impulseInput.right[37] = 0.002;
    const fuzzyImpulse = processFacePost(
      impulseInput,
      { rightEyeClosure: 1 },
      { externalHighpass: true },
    );
    const nonzeroFrames = [];
    for (const [frame, sample] of fuzzyImpulse.left.entries()) {
      if (Math.abs(sample) > 1e-12) nonzeroFrames.push(frame);
    }
    assert.deepEqual(nonzeroFrames, [37], "static cubic fuzz must add neither latency nor a tail");
    assert.ok(Math.abs(fuzzyImpulse.left[37]) > 0.00015);

    const fallbackInput = sineInput(0.002);
    const fallbackDry = processFacePost(
      fallbackInput,
      {},
      { externalHighpass: false },
    );
    const fallbackHighpassed = processFacePost(
      fallbackInput,
      { leftEyeClosure: 1 },
      { externalHighpass: false },
    );
    const fallbackHighpassRatio = rms(fallbackHighpassed.left)
      / Math.max(1e-12, rms(fallbackDry.left));
    assert.ok(
      fallbackHighpassRatio < 0.08,
      `fallback high-pass must make a decisive full-lid sweep (${fallbackHighpassRatio})`,
    );
    assert.ok(relativeDifference(fallbackDry.left, fallbackHighpassed.left) > 0.8);

    const externalHighpassed = processFacePost(
      fallbackInput,
      { leftEyeClosure: 1 },
      { externalHighpass: true },
    );
    assert.ok(
      relativeDifference(fallbackDry.left, externalHighpassed.left) < 1e-9,
      "the worklet must bypass only its fallback sweep when a native Biquad owns it",
    );

    const hairPose = {
      leftHairLength: 0.72,
      rightHairLength: 0.58,
      leftHairAngle: -0.18,
      rightHairAngle: 0.22,
    };
    const narrow = render(
      "aah",
      { ...hairPose, earSpread: 0 },
      420,
      { externalFuzz: true, externalHighpass: true, externalReverb: true },
    );
    const wide = render(
      "aah",
      { ...hairPose, earSpread: 1 },
      420,
      { externalFuzz: true, externalHighpass: true, externalReverb: true },
    );
    const narrowStereo = stereoMetrics(narrow);
    const wideStereo = stereoMetrics(wide);
    const stereoBalance = wideStereo.leftRms / Math.max(1e-12, wideStereo.rightRms);
    const midLevelRatio = wideStereo.midRms / Math.max(1e-12, narrowStereo.midRms);
    assert.ok(
      wideStereo.sideToMid > Math.max(0.08, narrowStereo.sideToMid * 1.25),
      `ear S/M ${wideStereo.sideToMid} vs ${narrowStereo.sideToMid}`,
    );
    assert.ok(wideStereo.sideToMid < 0.9, `bounded ear S/M ${wideStereo.sideToMid}`);
    assert.ok(stereoBalance > 0.8 && stereoBalance < 1.25, `ear balance ${stereoBalance}`);
    assert.ok(midLevelRatio > 0.98 && midLevelRatio < 1.02, `ear mono level ${midLevelRatio}`);
    const widthBuffers = narrow.processor.faceSpace;
    const leftWidthFrames = widthBuffers.widthLeftBuffer.length
      + widthBuffers.widthLeftTailBuffer.length
      + widthBuffers.widthLeftThirdBuffer.length;
    const rightWidthFrames = widthBuffers.widthRightBuffer.length
      + widthBuffers.widthRightTailBuffer.length
      + widthBuffers.widthRightThirdBuffer.length;
    assert.equal(leftWidthFrames, rightWidthFrames, "both three-section ears need matched total delay");
    assert.equal(leftWidthFrames, Math.round(48_000 * 0.00517));

    const externalRoomDry = render(
      "bop",
      {},
      320,
      { externalFuzz: true, externalHighpass: true, externalReverb: true },
    );
    const externalRoomMoved = render(
      "bop",
      { eyeDivergence: 1 },
      320,
      { externalFuzz: true, externalHighpass: true, externalReverb: true },
    );
    assert.ok(
      relativeDifference(externalRoomDry.left, externalRoomMoved.left) < 1e-9,
      "external convolution mode must stay dry if its IR graph is unavailable",
    );
    assert.equal(externalRoomMoved.processor.faceSpace.eyeLeftBuffer.length, 4);
    assert.ok(externalRoomMoved.processor.faceSpace.eyeReverbAmount > 0.99);

    const sourceLidMoved = render(
      "bop",
      { rightEyeClosure: 1 },
      320,
      { externalFuzz: true, externalHighpass: true, externalReverb: true },
    );
    assert.ok(
      relativeDifference(externalRoomDry.left, sourceLidMoved.left) < 1e-9,
      "the source must bypass its pre-room fuzz when the post node owns it",
    );
    const externalFuzzy = processFacePost(
      externalRoomDry,
      { rightEyeClosure: 1 },
      { externalHighpass: true },
    );
    assert.ok(
      relativeDifference(externalRoomDry.left, externalFuzzy.left) > 0.1,
      "right-lid fuzz must remain active after native room convolution",
    );
    assert.ok(sourceLidMoved.processor.faceSpace.eyelidFuzzAmount > 0.99);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
