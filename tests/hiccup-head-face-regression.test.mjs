import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("Hiccup Head keeps one stable mouth, colored lids, and nose clearance", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  assert.match(app, /const mouthY = featureY \+ ry \* 0\.39/);
  assert.match(app, /const pupilDriftX = 0;\s*const pupilDriftY = 0;/);
  assert.match(app, /const eyeRy = baseEyeRy/);
  assert.match(app, /const lidCover = 0\.08 \+ eyeClosure \* 0\.44/);
  assert.match(app, /rgb\(244, 126, 173\)/);
  assert.match(app, /rgb\(157, 218, 125\)/);
  assert.match(app, /context\.lineWidth = 13\.2 \+ goofballEnergy \* 2\.8/);
  assert.match(app, /const noseClearanceOpening = Math\.max\([\s\S]*?noseY \+ noseRadius \* 1\.12/);
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
  const html = await readFile(new URL("hiccup-head.html", root), "utf8");
  assert.match(html, /id="resetEffectsButton"[^>]*aria-label="Reset all face effects"/);
  assert.doesNotMatch(html, /id="(?:delay|reverb|nasal|stereo)EffectButton"/);
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

test("Hiccup Head skin uses an opaque warm and green checker palette", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const palette = app.slice(
    app.indexOf("const STOPPED_SKIN_CHECKER_COLORS"),
    app.indexOf("function skinCheckerColorsForStep"),
  );
  assert.match(palette, /pink/);
  assert.match(palette, /yellow/);
  assert.match(palette, /orange/);
  assert.match(palette, /green/);
  assert.doesNotMatch(palette, /rgba|hsla|purple|blue/);
});

test("Hiccup Head keeps FX energy balanced and gives BRUSH tuned marimba steps", async () => {
  const [app, processor] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("src/hiccup-head-processor.js", root), "utf8"),
  ]);
  assert.match(processor, /earLeft \* 0\.94 \+ leftHairTap \* leftDelayBlend/);
  assert.match(processor, /hairLeft \* 0\.96[\s\S]*?eyeDampedLeft \* roomBlend/);
  assert.match(processor, /const eyeActivation = smoothstep/);
  assert.match(processor, /const eyelidFuzz = smoothstep/);
  assert.match(processor, /Math\.tanh\(roomLeft \* fuzzDrive\) \/ fuzzDrive/);
  assert.match(processor, /Math\.tanh\(presenceLeft \* 42\)/);
  assert.match(app, /\[130\.81, 0\.42\][\s\S]*?\[587\.33, 0\.62\]/);
  assert.match(app, /delaySeconds: 0\.025 \+ index \* 0\.044/);
});
