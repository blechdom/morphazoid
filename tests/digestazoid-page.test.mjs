import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [html, css, app] = await Promise.all([
  readFile(new URL("digestazoid.html", root), "utf8"),
  readFile(new URL("digestazoid.css", root), "utf8"),
  readFile(new URL("digestazoid-app.js", root), "utf8"),
]);

test("Digestazoid exposes a tactile persistent digestive system", () => {
  assert.match(html, /<title>Digestazoid · Morphazoid<\/title>/);
  assert.match(html, /one wet pressure network · no samples/i);
  assert.match(html, /compliant stomach/i);
  assert.match(html, /peristaltic intestines/i);
  assert.match(html, /gas and liquid slugs/i);
  assert.match(html, /pressure-driven rubbery farts/i);
  assert.match(html, /aria-label="Interactive cutaway digestive system[^\"]+"/i);
  assert.match(html, /id="canvasInstructions"/);
  assert.match(html, /aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /id="liveStatus" aria-live="polite"/);
  assert.match(html, /It is not a diagnostic simulation/i);
});

test("the complete direct-manipulation and inflation vocabulary is present", () => {
  for (const id of [
    "inflateButton",
    "deflateButton",
    "digestButton",
    "gas",
    "liquid",
    "sludge",
    "viscosity",
    "bubbleSize",
    "peristalsisRate",
    "peristalsisDepth",
    "stomachCompliance",
    "gutTension",
    "bodyPulse",
    "upperValve",
    "pyloricValve",
    "lowerValve",
    "outletStretch",
    "turbulence",
    "listeningMode",
  ]) assert.match(html, new RegExp(`id="${id}"`), `${id} must be exposed`);

  for (const gesture of ["growl", "burble", "bubble", "slosh", "burp", "burple", "fart", "long-fart"]) {
    assert.match(html, new RegExp(`data-gesture="${gesture}"`), `${gesture} pad is missing`);
  }
  assert.match(app, /TARGET_ACTIONS/);
  assert.match(app, /upperValve:\s*"pinch"/);
  assert.match(app, /stomach:\s*"squeeze"/);
  assert.match(app, /smallIntestine:\s*"knead"/);
  assert.match(app, /outlet:\s*"stretch"/);
  assert.match(app, /setPointerCapture/);
  assert.match(app, /postInteraction\("release"/);
  assert.match(app, /beginGasChange\(direction/);
});

test("one stereo AudioWorklet owns the physical body and no sample API is used", () => {
  assert.equal([...app.matchAll(/new AudioWorkletNode\(/g)].length, 1);
  assert.match(app, /new AudioWorkletNode\(context, "digestazoid-physical-model"/);
  assert.match(app, /outputChannelCount:\s*\[2\]/);
  assert.match(app, /connectAudioOutput\(context, analyser/);
  assert.match(app, /type:\s*"configure"/);
  assert.match(app, /type:\s*"gesture"/);
  assert.match(app, /type:\s*"interaction"/);
  assert.match(app, /type:\s*"set-performing"/);
  assert.match(app, /type:\s*"silence"/);
  assert.doesNotMatch(app, /AudioBufferSourceNode|createBufferSource|decodeAudioData|fetch\s*\(/);
  assert.doesNotMatch(html, /<audio\b|\.mp3|\.wav|\.ogg/i);
});

test("the canvas visibly reports pressure, contents, valves, and release motion", () => {
  for (const name of [
    "traceTorso",
    "stomachPath",
    "traceColon",
    "traceSmallIntestine",
    "drawValve",
    "drawGasBlister",
    "drawContents",
    "drawDigestiveSystem",
  ]) assert.match(app, new RegExp(`function ${name}\\(`));
  assert.match(app, /telemetry\.peristalsisPhase/);
  assert.match(app, /telemetry\.upperFlow/);
  assert.match(app, /telemetry\.lowerFlow/);
  assert.match(app, /pressureValue\("stomach"/);
  assert.match(app, /pointerDrag\?\.target === "outlet"/);
  assert.match(css, /\.digestazoid-pressure-rail/);
  assert.match(css, /\.digestazoid-balance/);
  assert.match(css, /\.digestazoid-inflate-tools/);
});

test("bubble controls describe a physical lifecycle instead of a decorative whistle", () => {
  assert.match(html, /pinch · ring · rupture/i);
  assert.match(html, /Each bubble can grow, pinch off, ring under liquid, open a surface cavity, and burst/i);
  assert.match(html, /Seethe \/ turbulence/i);
  assert.match(app, /const rupture = smoothstep/);
  assert.match(app, /state\.turbulence \* 0\.055/);
});

test("Digestazoid stays playable on touch screens and honors reduced motion", () => {
  assert.match(css, /\.digestazoid-stage-wrap\s*\{[\s\S]*?touch-action:\s*none/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(app, /devicePixelRatio/);
  assert.match(app, /pixelBudgetRatio/);
  assert.match(app, /ResizeObserver/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /pagehide/);
});

test("the research note and catalog icon ship with the instrument", async () => {
  const [research, icon, iconStat] = await Promise.all([
    readFile(new URL("DIGESTAZOID_RESEARCH.md", root), "utf8"),
    readFile(new URL("assets/instruments/digestazoid.webp", root)),
    stat(new URL("assets/instruments/digestazoid.webp", root)),
  ]);
  assert.match(research, /Recording analysis/);
  assert.match(research, /263 accepted/);
  assert.match(research, /Whoopee Cushion/);
  assert.match(research, /PhysioNet/);
  assert.match(research, /pressure-driven soft valves/i);
  assert.match(research, /Scientific limitation/);
  assert.ok(iconStat.size > 1_000);
  assert.equal(icon.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(icon.subarray(8, 12).toString("ascii"), "WEBP");
});
