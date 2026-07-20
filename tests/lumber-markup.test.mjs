import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Lumber keeps a traditional looper surface with optional advanced playback", async () => {
  const [html, app, css, packageJson] = await Promise.all([
    readFile(new URL("lumber.html", root), "utf8"),
    readFile(new URL("lumber-app.js", root), "utf8"),
    readFile(new URL("style.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(html, /<body class="lumber-page"/);
  assert.match(html, /data-lumber-mode="expanded"/);
  assert.equal((html.match(/<canvas\b/g) ?? []).length, 1);
  for (const id of [
    "recordButton", "playButton", "replaceRing", "ringList",
    "clearAllRings", "syncAllRings", "circlePreset", "trianglePreset",
    "squarePreset", "removeVertex", "addVertex", "vertexCountOut",
    "backingOff", "backingOn",
    "shapePitchDepth", "advancedSummary", "viewFlat",
    "viewThreeD", "viewTilt", "viewYaw", "ringDepth", "spreadDepth",
    "reverbOff", "reverbOn", "reverbLeft", "reverbRight", "reverbIntensityOut",
    "fuzzOff", "fuzzOn", "fuzzLeft", "fuzzRight", "fuzzIntensityOut",
    "delayRingToggle", "resetDelayRing", "delayRotationPlay", "delayRotationSpeed",
    "delayRotationSpeedOut", "delaySpread", "delaySpreadOut", "mixDelayTimeOut",
    "mixDelayFeedbackOut", "mixDelayWetOut", "effectsSummary",
    "filterTone", "filterResonance",
    "timingFree", "timingSync", "lengthQuarter", "lengthHalf",
    "lengthFull", "lengthDouble",
    "removeLoopHead", "addLoopHead", "headCountOut", "headOffsetControls",
    "headOffset1", "headOffset2", "headOffset3",
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  for (const section of [
    "loopSection", "ringSection", "shapeSection", "advancedSection", "effectsSection",
    "depthSection",
  ]) {
    assert.match(html, new RegExp(`<details[^>]*id="${section}"`));
  }
  assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(
    html,
    /id="(?:playbackSection|shapeMapping)"/,
  );
  assert.doesNotMatch(html, /class="control-note"/);
  assert.doesNotMatch(html, /Native|Tape pitch|id="timeMode"|id="pitchShift"/i);
  assert.match(html, /Mix FX \+ ring tone/);
  assert.match(html, />Delay ring on\/off<\/button>/);
  assert.match(html, />Reset delay ring<\/button>/);
  assert.match(html, />Stereo spread</);
  assert.doesNotMatch(html, /delay brush|delay paint|brush size/i);
  assert.match(html, /id="backingOff"[^>]*aria-pressed="false"[^>]*>Pause rings/);
  assert.match(html, /id="backingOn"[^>]*aria-pressed="true"[^>]*>Hear rings/);

  assert.match(app, /getUserMedia/);
  assert.match(app, /createScriptProcessor/);
  assert.match(app, /createOuterRing/);
  assert.match(app, /mode: replace \? "replace" : "new"/);
  assert.match(app, /source\.playbackRate\.setValueAtTime\(ringPlaybackRate\(ring\),/);
  assert.match(app, /moveVertex/);
  assert.match(app, /nearestProjectedContourPhase/);
  assert.match(app, /RING_COLORS/);
  assert.match(app, /playScrubGrain/);
  assert.match(app, /toggleRingSolo/);
  assert.match(app, /data-ring-action="solo"/);
  assert.match(app, /data-ring-action="direction"/);
  assert.match(app, /data-ring-volume=/);
  assert.match(app, /data-ring-pan=/);
  assert.doesNotMatch(html, /id="ringDirection"|id="rotateLeft"|id="rotateRight"/);
  assert.match(css, /\.ring-volume-knob/);
  assert.match(css, /\.ring-pan-knob/);
  assert.match(app, /lastRingListSignature/);
  assert.match(app, /ringList"\)\.addEventListener\("pointerdown"/);
  assert.match(app, /pitchShiftLoopSamplesByContour/);
  assert.match(app, /ringCycleDuration/);
  assert.match(app, /setRingTimingMode/);
  assert.match(app, /setRingLengthRatio/);
  assert.match(app, /setRingHeadCount/);
  assert.match(app, /setRingHeadOffset/);
  assert.match(app, /expandedMode/);
  assert.match(app, /const rotation = -currentPhase\(ring\) \* TAU/);
  assert.match(app, /radialOffsets/);
  assert.match(app, /radialPointAt/);
  assert.match(app, /radialContourVertices/);
  assert.match(app, /maximumEditableRadialOffset/);
  assert.match(app, /WAVEFORM_RADIUS = 0\.065/);
  assert.match(app, /touch-pending/);
  assert.match(app, /tangentialMotion > radialMotion/);
  assert.match(app, /measureEnvelopePeak/);
  assert.match(app, /mixDelayParametersFromOffsets/);
  assert.match(app, /drawDelayRing/);
  assert.match(app, /updateMixDelay/);
  assert.match(app, /mixDelayNodes/);
  assert.match(app, /mixDelayPanners/);
  assert.doesNotMatch(app, /paintDelayMask|sampleDelayMask|drawDelayPaint|drawBrushCursor/);
  assert.match(app, /synchronizeAllRings/);
  assert.match(app, /createBiquadFilter/);
  assert.match(app, /createStereoPanner/);
  assert.match(app, /setThreeDView/);
  assert.match(app, /depthEffectIntensity/);
  assert.match(app, /createConvolver/);
  assert.match(app, /createWaveShaper/);
  assert.match(app, /depthReverbImpulse/);
  assert.match(css, /\.depth-effect-row/);

  assert.match(css, /\.lumber-page\s+#loopSection\s*\{/);
  assert.match(css, /\.lumber-page\s+#ringSection\s*\{/);
  assert.match(css, /\.lumber-page\s+#shapeSection\s*\{/);
  assert.match(css, /\.lumber-page\s+#advancedSection\s*\{/);
  assert.match(css, /\.lumber-page\s+#effectsSection\s*\{/);
  assert.match(css, /\.lumber-page\s+#depthSection\s*\{/);
  assert.match(css, /\.lumber-page #loopSection\s*\{\s*--accent:\s*#e8c46b;/);
  assert.match(css, /\.lumber-page #ringSection\s*\{\s*--accent:\s*#5fe8c4;/);
  assert.match(css, /\.lumber-page #shapeSection\s*\{\s*--accent:\s*#c79bff;/);
  assert.match(css, /\.lumber-page #advancedSection\s*\{\s*--accent:\s*#7db4ff;/);
  assert.match(css, /\.lumber-page #effectsSection\s*\{\s*--accent:\s*#ff826f;/);
  assert.match(css, /\.lumber-page #depthSection\s*\{\s*--accent:\s*#ffb86b;/);
  for (const section of [
    "loopSection", "ringSection", "shapeSection", "advancedSection", "effectsSection",
    "depthSection",
  ]) {
    assert.match(
      css,
      new RegExp(`\\.lumber-page #${section}\\s*\\{[\\s\\S]*?--accent-glow:`),
      `${section} needs its own matching heading background`,
    );
  }
  assert.doesNotMatch(css, /--section-(?:accent|wash)/);
  assert.match(JSON.parse(packageJson).scripts.check, /(?:lumber-app\.js|\*-app\.js)/);
});

test("Lumber markup has unique ids and complete labels", async () => {
  const html = await readFile(new URL("lumber.html", root), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /<label[^>]*for="level"/);
  assert.match(html, /<input id="level"[^>]*aria-label="Loop volume"/);
  assert.match(html, /id="stage"[\s\S]*aria-describedby="canvasInstructions liveStatus"/);
});
