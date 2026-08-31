import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

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
  assert.match(app, /id: "left-lid"[\s\S]*?key: "leftEyeClosure"[\s\S]*?id: "right-lid"[\s\S]*?key: "rightEyeClosure"/);
  assert.doesNotMatch(app, /type: "eye-2d"|browKey: handle\.id/);
  assert.match(app, /return Math\.round\(bounded \* 4\) \/ 4/);
  assert.doesNotMatch(html, /for="eyeClosure"|for="leftBrow"|for="rightBrow"/);
  assert.match(html, /id="eyebrowEmphasis"[^>]*max="0\.75"[^>]*value="0\.32"/);
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
  assert.match(app, /const noseClearanceOpening = Math\.max\([\s\S]*?noseY \+ noseRadius \* 1\.12/);
  assert.match(app, /async function triggerNoseHonk\(\)[\s\S]*?nasalMix: 0\.88[\s\S]*?soundId: "doo"[\s\S]*?delaySeconds/);
  assert.match(app, /noseHonkVisualActive[\s\S]*?physicalStatus = noseHonkVisualActive \? null/);
  assert.match(app, /drag\.handleId === "nose"[\s\S]*?clickTravel < 10[\s\S]*?triggerNoseHonk\(\)/);
  assert.match(app, /const noseHonkAmount =[\s\S]*?\* \(1 \+ noseHonkAmount \* 0\.28\)/);
  assert.match(html, /Click the nose to honk or drag it to change nasality/);
  const oralOpening = app.slice(
    app.indexOf("const lipRimWidth"),
    app.indexOf("// These are discrete upper teeth"),
  );
  assert.match(oralOpening, /const lipRimWidth = clamp\(Math\.min\(rx, ry\) \* 0\.04, 5, 10\)/);
  assert.match(oralOpening, /context\.ellipse\(cx, mouthY, mouthWidth, liveOpening/);
  assert.equal(oralOpening.match(/context\.ellipse\(/g)?.length, 1);
  assert.match(oralOpening, /context\.fill\(\);\s*context\.stroke\(\);/);
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

test("Hiccup Head keeps mutation audible and freckles clear of anatomy", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  assert.match(app, /lungPressure: clamp\(state\.lungPressure, 0\.5, 1\)/);
  assert.match(app, /tonguePosition: clamp\(state\.tonguePosition, -0\.25, 1\.25\)/);
  assert.match(app, /const forbiddenCircles = \[/);
  assert.match(app, /const mouthDistance = Math\.hypot\(mouthDx, mouthDy\)/);
});

test("Hiccup Head stays centered and preserves the mobile sequencer row", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("hiccup-head.css", root), "utf8"),
  ]);
  assert.match(app, /const cx = cssWidth \* 0\.5/);
  assert.doesNotMatch(app, /headingClearance/);
  assert.match(css, /grid-template-rows:[\s\S]*?minmax\(250px,[\s\S]*?8px[\s\S]*?minmax\(360px/);
});

test("Hiccup Head skin uses an opaque mixed checker palette", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const palette = app.slice(
    app.indexOf("const SKIN_CHECKER_PALETTE"),
    app.indexOf("function skinCheckerColorsForStep"),
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
  assert.match(palette, /function randomCheckerPair\(random = Math\.random\)/);
  assert.match(palette, /const STOPPED_SKIN_CHECKER_COLORS = randomCheckerPair\(\)/);
  assert.match(palette, /const secondIndex = secondDraw >= firstIndex \? secondDraw \+ 1 : secondDraw/);
  assert.doesNotMatch(palette, /rgba|hsla/);
});

test("Hiccup Head keeps FX energy balanced and gives BRUSH tuned marimba steps", async () => {
  const [app, processor] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("src/hiccup-head-processor.js", root), "utf8"),
  ]);
  assert.match(processor, /Both hairs feed a centered two-tap delay network/);
  assert.match(processor, /const centeredDelay =/);
  assert.match(processor, /const hairLeft = cleanWave\(earLeft \* 0\.94 \+ centeredDelay\)/);
  assert.match(processor, /const hairRight = cleanWave\(earRight \* 0\.94 \+ centeredDelay\)/);
  assert.match(processor, /hairLeft \* \(0\.98 - roomBlend \* 0\.32\)[\s\S]*?eyeDampedLeft \* roomBlend/);
  assert.match(processor, /const eyeActivation = smoothstep/);
  assert.match(processor, /const eyeDistance = Math\.abs\(this\.eyeAmount\)/);
  assert.match(processor, /const leftLidDarken = smoothstep\(leftEyeClosure\)/);
  assert.match(processor, /const rightLidFuzz = smoothstep\(rightEyeClosure\)/);
  assert.match(processor, /const eyelidFuzz = rightLidFuzz/);
  assert.match(processor, /const roomWet = eyeActivation \* \(0\.52 \+ this\.eyeReverbAmount \* 0\.92\)/);
  assert.match(processor, /const lidToneAlpha = 0\.86 - leftLidDarken \* 0\.82/);
  assert.match(processor, /const drive = 1 \+ lidFuzz \* 10/);
  assert.match(processor, /const postVelocity = 0\.42 \+ finite\(this\.gesture\?\.velocity, 0\.65\) \* 0\.58/);
  assert.match(processor, /Math\.tanh\(presenceLeft \* 42\)/);
  assert.match(app, /\[130\.81, 0\.42\][\s\S]*?\[587\.33, 0\.62\]/);
  assert.match(app, /delaySeconds: 0\.025 \+ index \* 0\.044/);
});
