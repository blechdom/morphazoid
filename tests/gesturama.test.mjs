import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MotionDifferencer,
  TriggerGate,
  countMotionByZone,
  crossedHorizontalLines,
  defaultGridZones,
  diffLuma,
  displayPointToNormalized,
  findColorCentroid,
  mirroredX,
  motionCentroid,
  rasterizeZones,
  sampleFrameColor,
  starterZones,
} from "../src/gesturama-core.js";

const root = new URL("../", import.meta.url);

test("Gesturama is a native Morphazoid page with explicit local camera startup", async () => {
  const [html, css, app, audio] = await Promise.all([
    readFile(new URL("gesturama.html", root), "utf8"),
    readFile(new URL("gesturama.css", root), "utf8"),
    readFile(new URL("gesturama-app.js", root), "utf8"),
    readFile(new URL("src/gesturama-audio.js", root), "utf8"),
  ]);

  assert.match(html, /<title>Gesturama — Morphazoid<\/title>/);
  assert.match(html, /class="wordmark" href="\.\/" aria-label="Morphazoid home"/);
  assert.match(html, /href="style\.css"[\s\S]*href="gesturama\.css"/);
  assert.match(html, /class="tab active" href="gesturama\.html" aria-current="page"/);
  assert.equal((html.match(/id="start-button"/g) ?? []).length, 1);
  assert.equal((html.match(/>Start camera<\/span>/g) ?? []).length, 1);
  assert.match(
    html,
    /<button id="start-button" class="primary-button" type="button">\s*<span>Start camera<\/span>\s*<\/button>/,
  );
  assert.match(html, /<p class="start-privacy">Camera processing stays on this device<\/p>/);
  assert.doesNotMatch(html, /class="start-art"|paint-orb orb-(?:kick|snare|hat|clap)/);
  assert.doesNotMatch(html, /MORPHAZOID PRESENTS GESTURAMA/);
  assert.doesNotMatch(html, /Paint the stage\.<br \/>Move to perform\./);
  assert.doesNotMatch(html, /Your pointer paints sound\. Your camera movement/);
  assert.doesNotMatch(html, /↗/);
  assert.doesNotMatch(html, /id="start-without-camera"/);
  assert.doesNotMatch(app, /startWithoutCamera|#start-without-camera/);
  assert.match(html, /id="paint-canvas"[\s\S]*aria-describedby="canvas-instructions"/);
  assert.match(html, /id="camera-feed"[^>]*autoplay[^>]*muted[^>]*playsinline/);
  assert.equal((html.match(/data-note="(?:36|38|39|42)"/g) ?? []).length, 4);
  assert.match(html, /src="nav\.js"[\s\S]*src="gesturama-app\.js"/);

  assert.match(css, /^\.gesturama-app\s*\{/m);
  assert.doesNotMatch(css, /^:root\s*\{/m);
  assert.doesNotMatch(css, /^\.brand-mark\s*\{/m);
  assert.match(
    css,
    /@media \(max-width: 960px\)[\s\S]*?html\s*\{[^}]*height:\s*auto[^}]*overflow-y:\s*auto/s,
  );
  assert.match(
    css,
    /@media \(max-width: 960px\)[\s\S]*?body\.gesturama-page\s*\{[^}]*height:\s*auto[^}]*overflow-y:\s*auto/s,
  );
  assert.match(
    css,
    /@media \(max-width: 960px\)[\s\S]*?\.gesturama-app #paint-canvas\s*\{[^}]*touch-action:\s*pan-y/s,
  );
  assert.match(app, /navigator\.mediaDevices\.getUserMedia/);
  assert.doesNotMatch(app, /document\.documentElement\.style\.setProperty/);
  assert.match(app, /window\.addEventListener\("pagehide"[\s\S]*stopCamera\(\)[\s\S]*audio\.close\(\)/);
  assert.match(audio, /async close\(\)/);
});

test("Gesturama has no Draw or Play mode and pointer hover cannot perform sounds", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("gesturama.html", root), "utf8"),
    readFile(new URL("gesturama-app.js", root), "utf8"),
  ]);

  assert.doesNotMatch(html, /\bdata-mode=/);
  assert.doesNotMatch(html, /class="mode-switch"/);
  assert.doesNotMatch(html, /id="mode-hint"/);
  assert.doesNotMatch(app, /\bstate\.mode\b/);
  assert.doesNotMatch(app, /\bmodeButtons\b/);
  assert.doesNotMatch(app, /function setMode\(/);
  assert.doesNotMatch(app, /\bpointerPlayZone\b/);
  assert.doesNotMatch(app, /function playableTargetAtPoint\(/);

  const pointerMoveStart = app.indexOf("function handlePointerMove(event)");
  const pointerMoveEnd = app.indexOf("function finishPointer(event)", pointerMoveStart);
  assert.ok(pointerMoveStart >= 0 && pointerMoveEnd > pointerMoveStart);
  const pointerMove = app.slice(pointerMoveStart, pointerMoveEnd);
  assert.match(pointerMove, /if \(!state\.gesture \|\| state\.gesture\.pointerId !== event\.pointerId\) return;/);
  assert.doesNotMatch(
    pointerMove,
    /triggerZone|triggerGridCell|processPerformancePoint|startGesturePad|updateGesturePad|pluckString/,
  );
});

test("Gesturama exposes presets, harp, motion view, microphone sampling, and color controls", async () => {
  const html = await readFile(new URL("gesturama.html", root), "utf8");
  const cells = [...html.matchAll(
    /<span\s+data-grid-cell="(\d+)"\s+data-instrument="(kick|snare|hat|clap)"/g,
  )].map((match) => ({ index: Number(match[1]), instrument: match[2] }));

  assert.match(html, /id="trigger-grid"[\s\S]*?class="trigger-grid"/);
  assert.equal(cells.length, 12);
  assert.deepEqual(cells.map((cell) => cell.index), [...Array(12).keys()]);
  const instrumentCounts = Object.fromEntries(
    ["kick", "snare", "hat", "clap"].map((instrument) => [
      instrument,
      cells.filter((cell) => cell.instrument === instrument).length,
    ]),
  );
  assert.deepEqual(instrumentCounts, { kick: 3, snare: 3, hat: 3, clap: 3 });

  assert.match(html, /<select id="preset-select"[^>]*aria-describedby="preset-description"/);
  assert.deepEqual(
    [...html.matchAll(/<option value="(drums|pads|harp)"[^>]*>/g)].map((match) => match[1]),
    ["drums", "pads", "harp"],
  );
  const harpStrings = [...html.matchAll(/data-harp-string="(\d+)" data-note="(\d+)"/g)];
  assert.equal(harpStrings.length, 12);
  assert.deepEqual(harpStrings.map((match) => Number(match[1])), [...Array(12).keys()]);
  assert.deepEqual(harpStrings.map((match) => Number(match[2])), [...Array(12)].map((_, index) => 60 + index));
  assert.match(html, /id="harp-strings"[\s\S]*?class="harp-strings"[\s\S]*?hidden[\s\S]*?aria-hidden="true"/);
  assert.match(html, /id="motion-view-button"[\s\S]*?aria-pressed="false"[\s\S]*?aria-controls="feedback-canvas"/);

  assert.match(html, /data-instrument="sample"[\s\S]*?data-note="40"/);
  assert.match(html, /id="record-sample-button"[\s\S]*?aria-pressed="false"/);
  assert.match(html, /id="sample-status"[^>]*role="status"[^>]*aria-live="polite">No sample/);
  assert.match(html, /The microphone is used only while recording this one slot\./);

  assert.match(html, /id="sample-color-button"[^>]*aria-pressed="false"/);
  assert.match(html, /id="tracked-color"[^>]*data-active="false"/);
  assert.match(html, /id="tracked-color-value">Not set</);
  assert.match(html, /id="tracker-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="color-tolerance"[\s\S]*?min="5"[\s\S]*?max="80"[\s\S]*?value="28"/);
  assert.match(html, /id="show-color-mask" type="checkbox"/);
  assert.match(html, /id="clear-tracked-color"[^>]*disabled/);
  assert.match(html, /id="color-tracker-marker"[^>]*hidden[^>]*aria-hidden="true"/);
});

test("Gesturama wires mirrored local color sampling into camera performance", async () => {
  const app = await readFile(new URL("gesturama-app.js", root), "utf8");

  assert.match(app, /findColorCentroid,[\s\S]*sampleFrameColor,/);
  assert.match(app, /gridCells:\s*\[\.\.\.root\.querySelectorAll\("#trigger-grid \[data-grid-cell\]"\)\]/);
  for (const id of [
    "sample-color-button",
    "tracked-color",
    "tracker-status",
    "color-tolerance",
    "show-color-mask",
    "clear-tracked-color",
    "color-tracker-marker",
  ]) {
    assert.match(app, new RegExp(`querySelector\\("#${id}"\\)`));
  }

  assert.match(
    app,
    /if \(state\.mirrored\) \{[\s\S]*?analysisContext\.translate\(targetWidth, 0\);[\s\S]*?analysisContext\.scale\(-1, 1\);[\s\S]*?analysisContext\.drawImage\(/,
  );
  assert.match(
    app,
    /function sampleTrackedColorAt\(point\) \{[\s\S]*?drawVideoCover\(\)[\s\S]*?analysisContext\.getImageData\([\s\S]*?sampleFrameColor\([\s\S]*?state\.colorPickerArmed = false;[\s\S]*?state\.trackedColor = color;/,
  );
  assert.doesNotMatch(app, /\b(?:fetch|WebSocket)\s*\(/);

  assert.match(
    app,
    /function handlePointerDown\(event\) \{[\s\S]*?if \(state\.colorPickerArmed\) \{[\s\S]*?sampleTrackedColorAt\(point\);[\s\S]*?return;[\s\S]*?setPointerCapture/,
  );
  assert.match(
    app,
    /const trackedCentroid = colorTrackingActive \? updateColorTracking[\s\S]*?processPerformancePoint\([\s\S]*?source: "color"/,
  );
  assert.doesNotMatch(app, /\b(?:fetch|WebSocket)\s*\(/);
});

test("camera analysis combines the default grid with painted-zone priority", async () => {
  const app = await readFile(new URL("gesturama-app.js", root), "utf8");

  assert.match(app, /const gridZones = defaultGridZones\(\);/);
  assert.match(
    app,
    /function rebuildOwnershipMap\(\) \{[\s\S]*?rasterizeZones\([\s\S]*?\[\.\.\.gridZones, \.\.\.state\.zones\][\s\S]*?state\.owners = result\.owners;[\s\S]*?state\.areas = result\.areas;/,
  );
  assert.match(
    app,
    /function processMotionPerformance\(result, now, sensitivity\) \{[\s\S]*?countMotionByZone\(result\.mask, state\.owners\)[\s\S]*?paintTriggerGate\.update\(state\.zones, scores, state\.areas[\s\S]*?activePaintZones[\s\S]*?gridTriggerGate\.update\(gridZones, scores, state\.areas/,
  );
});

test("continuous pads, harp crossings, and grayscale motion levels are wired", async () => {
  const [app, audio] = await Promise.all([
    readFile(new URL("gesturama-app.js", root), "utf8"),
    readFile(new URL("src/gesturama-audio.js", root), "utf8"),
  ]);

  assert.match(
    app,
    /function performContinuousPad\([\s\S]*?audio\.startGesturePad\(target\.key, voiceOptions\)[\s\S]*?audio\.updateGesturePad\(target\.key, voiceOptions\)/,
  );
  assert.match(app, /state\.preset === "pads"[\s\S]*?performContinuousPad\(target, cell \? gridPointParameters\(cell, point\) : null/);
  assert.match(app, /function stopActivePad\([\s\S]*?audio\.stopGesturePad\(state\.activePadKey, \{ release \}\)/);
  assert.match(
    app,
    /function pluckHarpCrossings\([\s\S]*?crossedHorizontalLines\(previous, point, lineCount\)[\s\S]*?audio\.pluckString\(stringIndex, frequency, velocity, clamp\(point\.x/,
  );
  assert.match(
    app,
    /motionCentroid\(result\.mask, analysisCanvas\.width, analysisCanvas\.height[\s\S]*?processPerformancePoint\([\s\S]*?source: "motion"/,
  );
  assert.match(app, /state\.lastMotionLevels = result\.levels;/);
  assert.match(
    app,
    /if \(state\.motionView\) \{[\s\S]*?state\.lastMotionLevels[\s\S]*?const level = state\.lastMotionLevels\[index\][\s\S]*?motionViewContext\.putImageData\([\s\S]*?context\.drawImage\(motionViewCanvas[\s\S]*?return;/,
  );

  for (const method of ["startGesturePad", "updateGesturePad", "stopGesturePad", "pluckString"]) {
    assert.match(audio, new RegExp(`\\b${method}\\(`));
  }
});

test("microphone recorder and stored sample lifecycle are wired", async () => {
  const [app, audio] = await Promise.all([
    readFile(new URL("gesturama-app.js", root), "utf8"),
    readFile(new URL("src/gesturama-audio.js", root), "utf8"),
  ]);

  assert.match(audio, /export class MicrophoneRecorder/);
  assert.match(audio, /mediaDevices\.getUserMedia\(\{[\s\S]*?audio:[\s\S]*?video: false/);
  assert.match(audio, /new MediaRecorderClass\(stream/);
  assert.match(audio, /recorder\.start\(\)/);
  assert.match(audio, /session\.recorder\.stop\(\)/);
  assert.match(audio, /setTimeout\(\(\) => \{[\s\S]*?this\.stop\(\)/);
  assert.match(audio, /stopStreamTracks\(session\.stream\)/);
  assert.match(audio, /this\.engine\.decodeSample\([\s\S]*?\{ store: true \}/);
  assert.match(audio, /cancel\(\) \{/);
  assert.match(
    audio,
    /const generation = this\.generation \+ 1;[\s\S]*?getUserMedia\([\s\S]*?generation !== this\.generation[\s\S]*?stopStreamTracks\(stream\)/,
  );
  assert.match(audio, /cancel\(\) \{[\s\S]*?this\.generation \+= 1;/);
  assert.match(audio, /if \(instrument === "sample"\) return this\.playSample\(amount\)/);
  assert.match(audio, /get hasSample\(\)/);
  assert.match(audio, /clearSample\(\)/);

  assert.match(app, /const recorder = new MicrophoneRecorder\(audio, \{ maxDurationMs: 8_000 \}\)/);
  assert.match(app, /await recorder\.start\(\{ maxDurationMs: 8_000 \}\)/);
  assert.match(app, /const buffer = await recorder\.stop\(\)/);
  assert.match(app, /recorder\.finished[\s\S]*?finishRecording/);
  assert.match(app, /window\.addEventListener\("pagehide"[\s\S]*?recorder\.cancel\(\)/);
  assert.match(
    audio,
    /gestureVoiceStartTokens\.set\(voiceId, startToken\)[\s\S]*?gestureVoiceStartTokens\.get\(voiceId\) !== startToken[\s\S]*?return null;/,
  );
  assert.match(audio, /stopGesturePad\([\s\S]*?gestureVoiceStartTokens\.delete\(voiceId\)/);
  assert.match(audio, /stopAllGesturePads\([\s\S]*?gestureVoiceStartTokens\.clear\(\)/);
});

test("color tracking clears back to motion mode and cleans up marker/debug state", async () => {
  const app = await readFile(new URL("gesturama-app.js", root), "utf8");

  assert.match(
    app,
    /function clearTrackedColor\([\s\S]*?state\.trackedColor = null;[\s\S]*?state\.lastColorMask = null;[\s\S]*?differencer\.reset\(\);/,
  );
  assert.match(app, /clearTrackedColor\?\.addEventListener\("click", \(\) => clearTrackedColor\(\)\)/);
  assert.match(
    app,
    /function resetTrackerTarget\(\) \{[\s\S]*?state\.trackerTargetKey = null;[\s\S]*?classList\.remove\("is-tracked"\)[\s\S]*?colorTrackerMarker\) elements\.colorTrackerMarker\.hidden = true;/,
  );
  assert.match(
    app,
    /function stopCamera\(\) \{[\s\S]*?state\.lastColorMask = null;[\s\S]*?resetTrackerTarget\(\);/,
  );
  assert.match(app, /trackedColor: state\.trackedColor \? \{ \.\.\.state\.trackedColor \} : null,/);
  assert.match(app, /trackerTarget: state\.trackerTargetKey,/);
  assert.match(app, /window\.addEventListener\("pagehide"[\s\S]*?stopCamera\(\);[\s\S]*?audio\.close\(\);/);
});

function solidFrame(width, height, value) {
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < frame.length; index += 4) {
    frame[index] = value;
    frame[index + 1] = value;
    frame[index + 2] = value;
    frame[index + 3] = 255;
  }
  return frame;
}

function setFramePixel(frame, width, x, y, [red, green, blue, alpha = 255]) {
  const index = (y * width + x) * 4;
  frame.set([red, green, blue, alpha], index);
}

test("display coordinates normalize independently of canvas backing resolution", () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  assert.deepEqual(displayPointToNormalized(110, 45, rect), { x: 0.5, y: 0.25 });
  assert.deepEqual(displayPointToNormalized(-50, 500, rect), { x: 0, y: 1 });
});

test("front camera coordinates mirror into paint coordinates", () => {
  assert.equal(mirroredX(0.9), 0.09999999999999998);
  assert.equal(mirroredX(0), 1);
});

test("motion centroid preserves sub-cell position for continuous gesture control", () => {
  const mask = new Uint8Array(8 * 4);
  mask[1 * 8 + 5] = 1;
  mask[1 * 8 + 6] = 1;
  mask[2 * 8 + 5] = 1;
  mask[2 * 8 + 6] = 1;
  assert.deepEqual(motionCentroid(mask, 8, 4, { minPixels: 4 }), {
    x: 5.5,
    y: 1.5,
    normalizedX: 0.75,
    normalizedY: 0.5,
    count: 4,
  });
  assert.equal(motionCentroid(mask, 8, 4, { minPixels: 5 }), null);
});

test("horizontal string crossings retain movement direction", () => {
  assert.deepEqual(crossedHorizontalLines({ y: 0.1 }, { y: 0.9 }, 4), [0, 1, 2, 3]);
  assert.deepEqual(crossedHorizontalLines({ y: 0.9 }, { y: 0.1 }, 4), [3, 2, 1, 0]);
  assert.deepEqual(crossedHorizontalLines({ y: 0.2 }, { y: 0.2 }, 4), []);
});

test("default grid zones cover the frame while the starter kit stays four drums", () => {
  const grid = defaultGridZones();
  assert.equal(grid.length, 12);
  assert.deepEqual(
    Object.fromEntries(["kick", "snare", "hat", "clap"].map((instrument) => [
      instrument,
      grid.filter((zone) => zone.instrument === instrument).length,
    ])),
    { kick: 3, snare: 3, hat: 3, clap: 3 },
  );
  assert.deepEqual(grid[0].points, [{ x: 0, y: 0 }, { x: 0.25, y: 1 / 3 }]);
  assert.deepEqual(grid.at(-1).points, [{ x: 0.75, y: 2 / 3 }, { x: 1, y: 1 }]);
  assert.equal(starterZones().length, 4);
});

test("frame color sampling returns RGB and clamps edge coordinates", () => {
  const frame = solidFrame(2, 2, 0);
  setFramePixel(frame, 2, 0, 0, [10, 20, 30]);
  setFramePixel(frame, 2, 1, 0, [40, 50, 60]);
  setFramePixel(frame, 2, 0, 1, [70, 80, 90]);
  setFramePixel(frame, 2, 1, 1, [100, 110, 120]);

  assert.deepEqual(sampleFrameColor(frame, 2, 2, 0.9, 1.8), { r: 70, g: 80, b: 90 });
  assert.deepEqual(sampleFrameColor(frame, 2, 2, -20, 99), { r: 70, g: 80, b: 90 });
  assert.equal(sampleFrameColor(frame, 2, 2, Number.NaN, 0), null);
  assert.equal(sampleFrameColor(new Uint8ClampedArray(3), 2, 2, 0, 0), null);
});

test("frame color sampling uses a local median to reject a glare pixel", () => {
  const frame = new Uint8ClampedArray(5 * 5 * 4);
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) setFramePixel(frame, 5, x, y, [190, 24, 32]);
  }
  setFramePixel(frame, 5, 2, 2, [255, 255, 255]);
  assert.deepEqual(
    sampleFrameColor(frame, 5, 5, 2, 2, { radius: 2 }),
    { r: 190, g: 24, b: 32 },
  );
});

test("color centroid includes the RGB tolerance boundary", () => {
  const frame = solidFrame(5, 3, 0);
  setFramePixel(frame, 5, 1, 1, [103, 104, 100]);
  setFramePixel(frame, 5, 3, 1, [97, 96, 100]);
  setFramePixel(frame, 5, 4, 2, [106, 100, 100]);

  assert.deepEqual(
    findColorCentroid(frame, 5, 3, { r: 100, g: 100, b: 100 }, { tolerance: 5 }),
    { x: 2, y: 1, normalizedX: 0.5, normalizedY: 0.5, count: 2 },
  );
});

test("color centroid honors sampling stride and reports no-match safely", () => {
  const frame = solidFrame(4, 4, 0);
  setFramePixel(frame, 4, 0, 0, [255, 0, 0]);
  setFramePixel(frame, 4, 1, 1, [255, 0, 0]);
  setFramePixel(frame, 4, 2, 2, [255, 0, 0]);

  assert.deepEqual(
    findColorCentroid(frame, 4, 4, { r: 255, g: 0, b: 0 }, { tolerance: 0, stride: 2 }),
    { x: 1, y: 1, normalizedX: 0.375, normalizedY: 0.375, count: 2 },
  );
  assert.equal(
    findColorCentroid(frame, 4, 4, { r: 0, g: 0, b: 255 }, { tolerance: 0 }),
    null,
  );
  assert.equal(findColorCentroid(frame, 4, 4, null), null);
});

test("color centroid follows the connected blob nearest the sampled origin", () => {
  const frame = solidFrame(10, 5, 0);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
    setFramePixel(frame, 10, x, y, [240, 20, 25]);
  }
  for (const [x, y] of [[6, 1], [7, 1], [8, 1], [6, 2], [7, 2], [8, 2]]) {
    setFramePixel(frame, 10, x, y, [240, 20, 25]);
  }

  const nearest = findColorCentroid(
    frame,
    10,
    5,
    { r: 240, g: 20, b: 25 },
    { tolerance: 0, origin: { x: 0.2, y: 0.3 }, minComponentPixels: 4 },
  );
  assert.deepEqual(nearest, { x: 1.5, y: 1.5, normalizedX: 0.2, normalizedY: 0.4, count: 4 });

  const largeEnough = findColorCentroid(
    frame,
    10,
    5,
    { r: 240, g: 20, b: 25 },
    { tolerance: 0, origin: { x: 0.2, y: 0.3 }, minComponentPixels: 5 },
  );
  assert.deepEqual(largeEnough, { x: 7, y: 1.5, normalizedX: 0.75, normalizedY: 0.4, count: 6 });
});

test("identical luma frames produce no motion", () => {
  const previous = new Uint8Array(25).fill(80);
  const current = new Uint8Array(25).fill(80);
  assert.deepEqual([...diffLuma(previous, current, 5, 5, 20, 0)], new Array(25).fill(0));
});

test("motion threshold includes the boundary and rejects smaller changes", () => {
  const previous = new Uint8Array(9).fill(10);
  const current = new Uint8Array(9).fill(10);
  current[4] = 29;
  assert.equal(diffLuma(previous, current, 3, 3, 20, 0)[4], 0);
  current[4] = 30;
  assert.equal(diffLuma(previous, current, 3, 3, 20, 0)[4], 1);
});

test("motion differencer primes before reporting a changed block", () => {
  const differencer = new MotionDifferencer(5, 5);
  const first = solidFrame(5, 5, 20);
  const second = solidFrame(5, 5, 20);
  for (const [x, y] of [[2, 2], [2, 3], [3, 2], [3, 3]]) {
    const index = (y * 5 + x) * 4;
    second[index] = 180;
    second[index + 1] = 180;
    second[index + 2] = 180;
  }
  assert.equal(differencer.process(first, 20).primed, false);
  const result = differencer.process(second, 20);
  assert.equal(result.primed, true);
  assert.ok(result.count >= 4);
  assert.ok(result.levels[2 * 5 + 2] >= 48, "motion view keeps a gray/white intensity");
  assert.equal(result.levels[0], 0, "unchanged pixels stay black in motion view");
});

test("zone rasterizer assigns independent IDs and topmost overlap", () => {
  const zones = [
    { id: 1, type: "rect", instrument: "kick", points: [{ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.6 }] },
    { id: 2, type: "dot", instrument: "snare", points: [{ x: 0.5, y: 0.5 }], radius: 0.2 },
  ];
  const { owners, areas } = rasterizeZones(zones, 20, 20, { hitSlop: 0 });
  assert.equal(owners[2 * 20 + 2], 1);
  assert.equal(owners[10 * 20 + 10], 2);
  assert.ok(areas.get(1) > 0);
  assert.ok(areas.get(2) > 0);
});

test("brush and line zones are rasterized with forgiving width", () => {
  const zones = [{
    id: 7,
    type: "line",
    instrument: "hat",
    points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
    size: 0.08,
  }];
  const { owners } = rasterizeZones(zones, 40, 20, { hitSlop: 1 });
  assert.equal(owners[10 * 40 + 20], 7);
  assert.equal(owners[2 * 40 + 20], 0);
});

test("motion is counted only where it overlaps a zone", () => {
  const motion = Uint8Array.from([1, 0, 1, 1, 0, 1]);
  const owners = Uint16Array.from([0, 1, 1, 2, 2, 2]);
  const counts = countMotionByZone(motion, owners);
  assert.equal(counts.get(1), 1);
  assert.equal(counts.get(2), 2);
  assert.equal(counts.has(0), false);
});

test("motion and ownership maps must have matching dimensions", () => {
  assert.throws(() => countMotionByZone(new Uint8Array(2), new Uint16Array(3)), RangeError);
});

test("trigger gate fires on entry, not during sustained occupancy", () => {
  const zone = { id: 3, type: "rect", instrument: "kick", points: [] };
  const gate = new TriggerGate({ releaseDelay: 50 });
  const areas = new Map([[3, 100]]);
  const active = new Map([[3, 20]]);
  assert.equal(gate.update([zone], active, areas, 100, 60).length, 1);
  assert.equal(gate.isActive(zone.id), true);
  assert.equal(gate.update([zone], active, areas, 200, 60).length, 0);
  assert.equal(gate.update([zone], active, areas, 400, 60).length, 0);
});

test("trigger gate does not mark sub-threshold motion as active", () => {
  const zone = { id: 5, type: "rect", instrument: "snare", points: [] };
  const gate = new TriggerGate();
  const hits = gate.update([zone], new Map([[zone.id, 3]]), new Map([[zone.id, 1_000]]), 100, 60);
  assert.deepEqual(hits, []);
  assert.equal(gate.isActive(zone.id), false);
});

test("trigger gate rearms after release and respects cooldown", () => {
  const zone = { id: 8, type: "rect", instrument: "hat", points: [] };
  const gate = new TriggerGate({ releaseDelay: 40 });
  const areas = new Map([[8, 100]]);
  const active = new Map([[8, 20]]);
  const quiet = new Map();
  assert.equal(gate.update([zone], active, areas, 100, 60).length, 1);
  gate.update([zone], quiet, areas, 120, 60);
  gate.update([zone], quiet, areas, 161, 60);
  assert.equal(gate.isActive(zone.id), false);
  assert.equal(gate.update([zone], active, areas, 162, 60).length, 0, "cooldown blocks a fast re-entry");
  gate.update([zone], quiet, areas, 170, 60);
  gate.update([zone], quiet, areas, 211, 60);
  assert.equal(gate.update([zone], active, areas, 220, 60).length, 1);
});

test("separate zones can trigger polyphonically", () => {
  const zones = [
    { id: 1, instrument: "kick" },
    { id: 2, instrument: "clap" },
  ];
  const areas = new Map([[1, 90], [2, 90]]);
  const scores = new Map([[1, 20], [2, 20]]);
  const hits = new TriggerGate().update(zones, scores, areas, 1_000, 60);
  assert.deepEqual(hits.map((hit) => hit.zone.id), [1, 2]);
});

test("starter kit provides one semantic zone per drum", () => {
  const zones = starterZones(10);
  assert.deepEqual(zones.map((zone) => zone.id), [10, 11, 12, 13]);
  assert.deepEqual(zones.map((zone) => zone.instrument), ["kick", "snare", "hat", "clap"]);
});
