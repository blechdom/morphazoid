import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function pageSources() {
  const [html, css, app] = await Promise.all([
    readFile(new URL("hyper-rubix.html", root), "utf8"),
    readFile(new URL("hyper-rubix.css", root), "utf8"),
    readFile(new URL("hyper-rubix-app.js", root), "utf8"),
  ]);
  return { html, css, app };
}

function openingTag(source, tagName, id) {
  const match = source.match(new RegExp(`<${tagName}\\b[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(match, `${tagName}#${id} should exist`);
  return match[0];
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
}

function hasBooleanAttribute(tag, name) {
  return new RegExp(`(?:^|\\s)${name}(?:\\s|>|=)`).test(tag);
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${startMarker} should precede ${endMarker}`);
  return source.slice(start, end);
}

function selectOptions(source, id) {
  const select = source.match(new RegExp(`<select\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/select>`));
  assert.ok(select, `select#${id} should exist`);
  return [...select[1].matchAll(/<option\b([^>]*)>([^<]+)<\/option>/g)].map((match) => ({
    label: match[2].trim(),
    tag: `<option${match[1]}>`,
    value: attribute(`<option${match[1]}>`, "value"),
  }));
}

test("Hyper Rubix is a standalone Morphazoid Canvas page with accessible instructions", async () => {
  const { html } = await pageSources();

  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<title>Hyper Rubix — Morphazoid<\/title>/);
  assert.match(html, /<body class="hyper-rubix-page">/);
  assert.match(html, /<link rel="stylesheet" href="style\.css" \/>/);
  assert.match(html, /<link rel="stylesheet" href="hyper-rubix\.css" \/>/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="hyper-rubix-app\.js"><\/script>/);
  assert.match(html, /<main class="[^"]*\bhyper-rubix-shell\b[^"]*" id="hyperRubix">/);
  assert.match(html, /<aside class="[^"]*\bhyper-rubix-panel\b[^"]*" aria-label="Hyper Rubix controls">/);
  assert.match(html, /<div class="hyper-rubix-heading">[\s\S]*?<h1 id="hyperRubixTitle">/);

  const canvas = openingTag(html, "canvas", "stage");
  assert.equal(attribute(canvas, "tabindex"), "0");
  assert.equal(attribute(canvas, "role"), "application");
  assert.match(attribute(canvas, "aria-label") ?? "", /four-dimensional|4D/i);
  assert.deepEqual(
    new Set((attribute(canvas, "aria-describedby") ?? "").split(/\s+/).filter(Boolean)),
    new Set(["canvasInstructions", "liveStatus"]),
  );
  assert.match(
    html,
    /id="canvasInstructions"[\s\S]*?Drag to orbit[\s\S]*?Fold W[\s\S]*?minus or plus[\s\S]*?Press Enter/i,
  );
  assert.match(
    html,
    /id="restartInstructions"[\s\S]*?Press R[\s\S]*?Twist[\s\S]*?step one/i,
  );
  assert.match(html, /id="liveStatus"[^>]*aria-live="polite"/);
  assert.match(html, /class="hyper-rubix-status" aria-live="polite"/);
  assert.match(html, /id="audioError"[^>]*role="alert"[^>]*hidden/);

  const authoredUrls = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.ok(authoredUrls.length >= 6);
  for (const url of authoredUrls) {
    assert.doesNotMatch(url, /^(?:[a-z][a-z\d+.-]*:|\/\/)/i, `${url} should remain local`);
  }
});

test("the authored-open clock exposes a complete 16-step auto-twist transport", async () => {
  const { html, app } = await pageSources();
  const sequencePanel = sourceSection(
    html,
    '<details class="group control-section hyper-rubix-control-section" data-section="sequence" open>',
    "</details>",
  );

  assert.match(sequencePanel, /^<details\b[^>]*\bdata-section="sequence"[^>]*\bopen>/);
  assert.match(sequencePanel, /<h2 class="group-title">Time \+ twist sequencer<\/h2>/);
  assert.match(sequencePanel, /id="clockSummary">112 BPM · 1\/8<\/span>/);

  const play = openingTag(sequencePanel, "button", "playButton");
  assert.equal(attribute(play, "type"), "button");
  assert.equal(attribute(play, "aria-pressed"), "false");
  assert.equal(hasBooleanAttribute(play, "data-primary-transport"), true);
  assert.match(sequencePanel, /id="playLabel">Play auto-twists<\/b>/);
  assert.match(sequencePanel, /id="playState">16-step twist tape<\/small>/);

  const restart = openingTag(sequencePanel, "button", "restartLoop");
  assert.equal(attribute(restart, "type"), "button");
  assert.match(attribute(restart, "aria-label") ?? "", /restart Twist tape at step one/i);
  assert.equal(attribute(restart, "title"), attribute(restart, "aria-label"));
  const strip = openingTag(sequencePanel, "div", "stepStrip");
  assert.equal(attribute(strip, "role"), "group");
  assert.match(attribute(strip, "aria-label") ?? "", /sixteen-step auto-twist playhead/i);

  const tempo = openingTag(sequencePanel, "input", "tempo");
  assert.deepEqual(
    ["type", "min", "max", "step", "value"].map((name) => attribute(tempo, name)),
    ["range", "30", "300", "1", "112"],
  );
  const swing = openingTag(sequencePanel, "input", "swing");
  assert.deepEqual(
    ["type", "min", "max", "step", "value"].map((name) => attribute(swing, name)),
    ["range", "0", "0.42", "0.01", "0.08"],
  );
  const density = openingTag(sequencePanel, "input", "twistDensity");
  assert.deepEqual(
    ["type", "min", "max", "step", "value"].map((name) => attribute(density, name)),
    ["range", "0.25", "1", "0.01", "1"],
  );

  const rates = selectOptions(sequencePanel, "twistRate");
  assert.deepEqual(rates.map(({ value, label }) => [value, label]), [
    ["1", "1/4"],
    ["2", "1/8"],
    ["4", "1/16"],
    ["8", "1/32"],
    ["16", "1/64"],
  ]);
  assert.equal(rates.filter(({ tag }) => hasBooleanAttribute(tag, "selected")).length, 1);
  assert.equal(rates.find(({ tag }) => hasBooleanAttribute(tag, "selected"))?.value, "2");
  assert.match(sequencePanel, /<span class="field-label">Pulse rate<\/span>/);
  assert.equal(attribute(openingTag(sequencePanel, "select", "twistRate"), "aria-describedby"), "pulseRateHelp");
  assert.match(sequencePanel, /id="pulseRateHelp"[^>]*>[^<]*1\/4[^<]*quarter-note beat[^<]*1\/64/i);
  const motion = selectOptions(sequencePanel, "twistMotion");
  assert.deepEqual(motion.map(({ value }) => value), ["auto", "beat", "bar", "off"]);
  assert.equal(motion.filter(({ tag }) => hasBooleanAttribute(tag, "selected")).length, 1);
  assert.equal(motion.find(({ tag }) => hasBooleanAttribute(tag, "selected"))?.value, "auto");
  assert.equal(attribute(openingTag(sequencePanel, "select", "twistMotion"), "aria-describedby"), "twistMotionHelp");
  assert.match(sequencePanel, /id="twistMotionHelp"[^>]*>[^<]*Serial sticker modes[^<]*motion off/i);
  assert.deepEqual(selectOptions(sequencePanel, "sequencePattern").map(({ value }) => value), [
    "axis-break", "straight-xyz", "w-pressure", "random-walk",
  ]);
  assert.deepEqual(selectOptions(sequencePanel, "playbackMode").map(({ value }) => value), [
    "forward", "reverse", "pendulum", "random",
  ]);
  const methods = selectOptions(sequencePanel, "sequenceMethod");
  assert.deepEqual(methods.map(({ value, label }) => [value, label]), [
    ["twist-tape", "Twist tape · 16"],
    ["sticker-stream", "Sticker stream · 216"],
    ["corner-stream", "Corner stream · 64"],
    ["sticker-hyperbar", "Sticker hyperbar · 27"],
    ["hybrid-coil", "Hybrid coil · 16 × 27"],
  ]);
  assert.equal(methods.filter(({ tag }) => hasBooleanAttribute(tag, "selected")).length, 1);
  assert.equal(methods.find(({ tag }) => hasBooleanAttribute(tag, "selected"))?.value, "twist-tape");
  assert.equal(attribute(openingTag(sequencePanel, "select", "sequenceMethod"), "aria-describedby"), "sequenceMethodHelp");
  assert.match(sequencePanel, /id="sequenceMethodHelp"[^>]*>[^<]*intentional rests/i);
  const hyperbarPanel = openingTag(sequencePanel, "div", "hyperbarPanel");
  assert.equal(hasBooleanAttribute(hyperbarPanel, "hidden"), true);
  const hyperbar = openingTag(sequencePanel, "div", "hyperbarGrid");
  assert.equal(attribute(hyperbar, "role"), "grid");
  assert.match(attribute(hyperbar, "aria-label") ?? "", /eight color voices.+twenty-seven/i);
  assert.equal(attribute(hyperbar, "aria-describedby"), "hyperbarInstructions");
  assert.deepEqual(
    [attribute(hyperbar, "aria-rowcount"), attribute(hyperbar, "aria-colcount")],
    ["8", "27"],
  );
  assert.match(
    sequencePanel,
    /id="hyperbarInstructions"[\s\S]*?arrow keys[\s\S]*?Home and End[\s\S]*?Space or Enter/i,
  );
  assert.equal(
    hasBooleanAttribute(openingTag(sequencePanel, "button", "reseedPattern"), "disabled"),
    true,
  );

  assert.match(app, /const LOOKAHEAD_MS = 110/);
  assert.match(app, /const SCHEDULER_INTERVAL_MS = 24/);
  assert.match(app, /function restartPositionPhrase\(/);
  assert.match(app, /seeded Random shuffle/);
  assert.match(app, /\$\("restartInstructions"\)\.textContent/);
  const scheduler = sourceSection(app, "function schedulerTick()", "function restartTransportClock(");
  assert.match(scheduler, /audio\.context\.currentTime\s*\+\s*Math\.max\(0, nextStepAtMs - nowMs\) \/ 1_000/);
  assert.match(scheduler, /audio\.withTransportScope\(\(\) =>/);
  assert.match(scheduler, /audio\.strike\(step\.move, scheduledWhen, step\.accent \? 1\.16 : 0\.78\)/);
  assert.match(
    scheduler,
    /method\.hyperbar \? topologyVisualStickerIds\(method, activeHyperbarEvents\) : null/,
  );
  assert.match(scheduler, /scheduleVisualSequenceStep\(/);
  assert.match(scheduler, /nextStepAtMs \+= stepDurationMs/);
  const clear = sourceSection(app, "function clearScheduler(", "function transportAnimationDuration(");
  assert.match(clear, /clearSoundingStickerPulses\(\)/);
  assert.match(clear, /audio\.cancelTransportAudio\(undefined, \{ hard: hardAudio \}\)/);
  const stop = sourceSection(app, "function stopTransport(", "function moveLabel(");
  assert.match(stop, /state\.playing = false/);
  assert.match(stop, /clearScheduler\(\{ hardAudio \}\)/);
  assert.match(stop, /item\.source !== "transport"/);
});

test("the sound panel exposes fold sound, explicit geometry mappings, and a default-off rattle", async () => {
  const { html, app } = await pageSources();
  const soundPanel = sourceSection(
    html,
    '<details class="group control-section hyper-rubix-control-section" data-section="sound"',
    "</details>",
  );

  const rattle = openingTag(soundPanel, "button", "rattleButton");
  assert.equal(attribute(rattle, "type"), "button");
  assert.equal(attribute(rattle, "aria-pressed"), "false");
  assert.match(soundPanel, /id="rattleState"/);

  const level = openingTag(soundPanel, "input", "rattleLevel");
  assert.deepEqual(
    ["type", "min", "max", "step", "value"].map((name) => attribute(level, name)),
    ["range", "0", "0.8", "0.01", "0.34"],
  );
  const decay = openingTag(soundPanel, "input", "decay");
  assert.deepEqual(
    ["type", "min", "max", "step", "value"].map((name) => attribute(decay, name)),
    ["range", "0.02", "4", "0.01", "0.58"],
  );

  const foldModes = selectOptions(soundPanel, "foldSound");
  assert.deepEqual(foldModes.map(({ value }) => value), ["glide", "ticks", "both", "off"]);
  assert.equal(foldModes.filter(({ tag }) => hasBooleanAttribute(tag, "selected")).length, 1);
  assert.equal(foldModes.find(({ tag }) => hasBooleanAttribute(tag, "selected"))?.value, "glide");
  const foldLevel = openingTag(soundPanel, "input", "foldLevel");
  assert.deepEqual(
    ["type", "min", "max", "step", "value"].map((name) => attribute(foldLevel, name)),
    ["range", "0", "0.6", "0.01", "0.12"],
  );
  const hearAutoDrift = openingTag(soundPanel, "button", "hearAutoDrift");
  assert.equal(attribute(hearAutoDrift, "type"), "button");
  assert.equal(attribute(hearAutoDrift, "aria-pressed"), "false");
  assert.equal(attribute(hearAutoDrift, "aria-describedby"), "foldSoundHelp");

  const topologyModes = selectOptions(soundPanel, "topologyMode");
  assert.deepEqual(topologyModes.map(({ value }) => value), [
    "mesh", "cohesion", "faults", "off",
  ]);
  assert.equal(
    topologyModes.find(({ tag }) => hasBooleanAttribute(tag, "selected"))?.value,
    "mesh",
  );
  const topologyRanges = [
    ["topologyLevel", "0", "0.8", "0.01", "0.22", "22%"],
    ["topologySpan", "0", "24", "0.25", "12", "12 st"],
    ["topologyStrum", "0", "0.08", "0.001", "0.018", "18 ms"],
    ["topologyRing", "0.02", "3.5", "0.01", "0.48", "0.48 s"],
    ["topologyWarp", "0", "2", "0.01", "1", "100%"],
  ];
  for (const [id, min, max, step, value, output] of topologyRanges) {
    const input = openingTag(soundPanel, "input", id);
    assert.deepEqual(
      ["type", "min", "max", "step", "value"].map((name) => attribute(input, name)),
      ["range", min, max, step, value],
    );
    assert.match(
      soundPanel,
      new RegExp(`<output\\b[^>]*\\bid="${id}Out"[^>]*>${output.replace("%", "\\%")}<\\/output>`),
    );
  }
  assert.match(soundPanel, /one tuned resonator for each real lattice connection/i);
  assert.match(soundPanel, /Matching colors[\s\S]*mixed colors[\s\S]*fault lines/i);

  const influences = [
    ["pitchInfluence", "0.72", "72%"],
    ["filterInfluence", "0.72", "72%"],
    ["stereoInfluence", "0.72", "72%"],
    ["neighborResponse", "1", "100%"],
    ["wInfluence", "0.72", "72%"],
    ["disorderInfluence", "0.6", "60%"],
  ];
  for (const [id, value, displayed] of influences) {
    const input = openingTag(soundPanel, "input", id);
    assert.deepEqual(
      ["type", "min", "max", "step", "value"].map((name) => attribute(input, name)),
      ["range", "0", "2", "0.01", value],
    );
    assert.equal(attribute(input, "aria-describedby"), `${id}Help`);
    assert.match(soundPanel, new RegExp(`<output\\b[^>]*\\bid="${id}Out"[^>]*>${displayed.replace("%", "\\%")}</output>`));
    assert.match(soundPanel, new RegExp(`id="${id}Help"[^>]*>[^<]+</small>`));
  }
  assert.doesNotMatch(soundPanel, /\bid="shapeInfluence"/);
  assert.match(soundPanel, /id="stickerModulationHelp"[^>]*>[^<]*100%[^<]*above it exaggerate/i);
  const rates = selectOptions(soundPanel, "rattleRate");
  assert.deepEqual(rates.map(({ value, label }) => [value, label]), [
    ["2", "1/8"],
    ["4", "1/16"],
    ["8", "1/32"],
  ]);
  assert.equal(rates.filter(({ tag }) => hasBooleanAttribute(tag, "selected")).length, 1);
  assert.equal(rates.find(({ tag }) => hasBooleanAttribute(tag, "selected"))?.value, "4");

  assert.equal(attribute(openingTag(html, "button", "audioButton"), "aria-pressed"), "false");
  assert.match(app, /Number\.isFinite\(numericDepth\) \? numericDepth : 0\.5/);
  assert.match(app, /Number\.isFinite\(numericAngle\) \? numericAngle : 0\.5/);
  assert.match(app, /TOPOLOGY_CONNECTIONS_PER_CELL = 6/);
  assert.match(app, /createTopologyGraph\(\)/);
  assert.match(app, /HYPER_RUBIX_CELL_ORDER\.length \* TOPOLOGY_CONNECTIONS_PER_CELL/);
  assert.match(app, /event\?\.topology\?\.connections/);
  assert.match(app, /scheduleTopologyNetwork\(event, when/);
  assert.match(app, /this\.silenceTopology\(cancelAt, \{ immediate: hard \}\)/);
  assert.match(app, /silenceTopology\(when = [^)]*\?\? 0, \{ immediate = false \} = \{\}\)/);
});

test("the guide distinguishes intentional, geometry, and serial playback behavior", async () => {
  const { html } = await pageSources();
  const guide = sourceSection(
    html,
    '<details class="group control-section hyper-rubix-control-section" data-section="guide"',
    "</details>",
  );

  assert.match(guide, /Sticker hyperbar[\s\S]*?sparse gates[\s\S]*?pulse empty/i);
  assert.match(guide, /Sticker stream[\s\S]*?216 stickers[\s\S]*?Corner stream[\s\S]*?64 stickers/i);
  assert.match(guide, /Each pulse sounds and lights that exact sticker/i);
  assert.match(guide, /serial modes begin without automatic twists/i);
  assert.match(guide, /Twist tape[\s\S]*?intentional authored rests[\s\S]*?default/i);
});

test("the twist panel exposes all cells, a dynamic legal-plane host, and complete puzzle actions", async () => {
  const { html, app } = await pageSources();
  const twistPanel = sourceSection(
    html,
    '<details class="group control-section hyper-rubix-control-section" data-section="twist"',
    "</details>",
  );

  const sizes = selectOptions(twistPanel, "puzzleSize");
  assert.deepEqual(sizes.map(({ value, label }) => [value, label]), [
    ["2", "2 × 2 × 2 × 2"],
    ["3", "3 × 3 × 3 × 3"],
    ["4", "4 × 4 × 4 × 4"],
  ]);
  assert.equal(sizes.filter(({ tag }) => hasBooleanAttribute(tag, "selected")).length, 1);
  assert.equal(sizes.find(({ tag }) => hasBooleanAttribute(tag, "selected"))?.value, "3");
  assert.equal(attribute(openingTag(twistPanel, "select", "puzzleSize"), "aria-describedby"), "puzzleSizeHelp");
  assert.match(twistPanel, /id="puzzleSizeHelp"[^>]*>[^<]*216 stickers[^<]*27 spatial pulses/i);
  const resizeSource = sourceSection(app, "function rebuildPuzzleForSize(", '$("puzzleSize").addEventListener');
  assert.match(resizeSource, /stopTransport\(\{ hardAudio: true \}\)/);
  assert.match(resizeSource, /audio\.silenceFold\(\)/);
  assert.match(resizeSource, /moveQueue = \[\]/);
  assert.match(resizeSource, /activeMove = null/);
  assert.match(resizeSource, /history = \[\]/);
  assert.match(resizeSource, /state\.puzzle = createSolvedHyperRubix\(metrics\.size\)/);
  assert.match(resizeSource, /hyperbarGateOverrides = new Map\(\)/);
  assert.match(resizeSource, /rebuildHyperbarSnapshot\(\)/);

  const faceButtons = [...twistPanel.matchAll(/<button\b([^>]*)\bdata-face="([xyzw][+-])"([^>]*)>/g)]
    .map((match) => ({
      id: match[2],
      tag: `<button${match[1]}data-face="${match[2]}"${match[3]}>`,
    }));
  assert.equal(faceButtons.length, 8);
  assert.deepEqual(
    new Set(faceButtons.map(({ id }) => id)),
    new Set(["x-", "x+", "y-", "y+", "z-", "z+", "w-", "w+"]),
  );
  assert.equal(faceButtons.filter(({ tag }) => attribute(tag, "aria-pressed") === "true").length, 1);
  assert.equal(
    faceButtons.find(({ tag }) => attribute(tag, "aria-pressed") === "true")?.id,
    "w+",
  );
  const voiceTerms = {
    "x-": ["orange", "sub"],
    "x+": ["red", "kick"],
    "y-": ["yellow", "snare"],
    "y+": ["white", "clap"],
    "z-": ["blue", "closed hat"],
    "z+": ["green", "open hat"],
    "w-": ["cyan", "rim"],
    "w+": ["violet", "stab"],
  };
  for (const { id, tag } of faceButtons) {
    const label = attribute(tag, "aria-label")?.toLowerCase() ?? "";
    for (const term of voiceTerms[id]) assert.match(label, new RegExp(`\\b${term}\\b`));
  }
  assert.match(twistPanel, /id="facePicker"[^>]*role="group"[^>]*aria-label="Boundary cell"/);

  const planeHost = twistPanel.match(
    /<div\b[^>]*\bid="planePicker"[^>]*role="group"[^>]*aria-label="Turn plane"[^>]*>([\s\S]*?)<\/div>/,
  );
  assert.ok(planeHost, "the legal turn-plane host should exist");
  assert.equal(planeHost[1].trim(), "", "turn planes should be derived from the selected 4D cell");
  const planeRenderer = sourceSection(app, "function renderPlanePicker()", "function updateSelectionUI()");
  assert.match(planeRenderer, /hyperRubixBoundaryCell\(state\.selectedCell\)/);
  assert.match(planeRenderer, /for \(const plane of cell\.tangentPlanes\)/);
  assert.match(planeRenderer, /document\.createElement\("button"\)/);
  assert.match(planeRenderer, /button\.dataset\.plane = plane/);
  assert.match(planeRenderer, /button\.setAttribute\("aria-pressed"/);
  assert.match(planeRenderer, /\$\("planePicker"\)\.replaceChildren\(fragment\)/);

  const counterTurn = openingTag(twistPanel, "button", "turnCounterclockwise");
  const clockwiseTurn = openingTag(twistPanel, "button", "turnClockwise");
  assert.equal(attribute(counterTurn, "type"), "button");
  assert.equal(attribute(clockwiseTurn, "type"), "button");
  assert.match(attribute(counterTurn, "aria-label") ?? "", /counterclockwise/i);
  assert.match(attribute(clockwiseTurn, "aria-label") ?? "", /clockwise/i);
  assert.match(twistPanel, /id="turnCounterclockwise"[\s\S]*?−90°/);
  assert.match(twistPanel, /id="turnClockwise"[\s\S]*?\+90°/);
  assert.match(app, /\$\("turnCounterclockwise"\)\.addEventListener\("click", \(\) => turnSelected\(-1\)\)/);
  assert.match(app, /\$\("turnClockwise"\)\.addEventListener\("click", \(\) => turnSelected\(1\)\)/);

  for (const id of ["scramblePuzzle", "undoMove", "unwindPuzzle"]) {
    const button = openingTag(twistPanel, "button", id);
    assert.equal(attribute(button, "type"), "button");
  }
  assert.equal(hasBooleanAttribute(openingTag(twistPanel, "button", "undoMove"), "disabled"), true);
  assert.equal(hasBooleanAttribute(openingTag(twistPanel, "button", "unwindPuzzle"), "disabled"), true);
  assert.match(app, /createHyperRubixScramble\(12\)/);
  assert.match(app, /invertHyperRubixMove\(history\.at\(-1\)\)/);
  assert.match(app, /invertHyperRubixMoves\(history\)/);
  assert.match(app, /\$\("scramblePuzzle"\)\.addEventListener\("click"/);
  assert.match(app, /\$\("undoMove"\)\.addEventListener\("click", undoLastMove\)/);
  assert.match(app, /\$\("unwindPuzzle"\)\.addEventListener\("click"/);
});

test("hyperspace, audio defaults, and in-place reset remain explicit controls", async () => {
  const { html, app } = await pageSources();
  const hyperspace = sourceSection(
    html,
    '<details class="group control-section hyper-rubix-control-section" data-section="hyperspace"',
    "</details>",
  );

  const dragModes = [...html.matchAll(/<button\b[^>]*\bdata-drag-mode="([^"]+)"[^>]*>/g)];
  assert.deepEqual(new Set(dragModes.map((match) => match[1])), new Set(["orbit", "fold"]));
  assert.equal(dragModes.filter((match) => attribute(match[0], "aria-pressed") === "true").length, 1);

  const autoRotate = openingTag(hyperspace, "button", "autoRotate");
  assert.equal(attribute(autoRotate, "aria-pressed"), "true");
  for (const id of ["rotationSpeed", "projectionDepth", "cellSeparation", "stickerScale"]) {
    const input = openingTag(hyperspace, "input", id);
    assert.equal(attribute(input, "type"), "range", `${id} should be a range control`);
    assert.notEqual(attribute(input, "value"), null, `${id} should publish its starting value`);
  }
  assert.equal(attribute(openingTag(hyperspace, "input", "projectionDepth"), "min"), "3.4");
  assert.match(app, /const PROJECTION_DEPTH_MIN = 3\.4/);
  for (const id of ["resetView", "randomView"]) {
    assert.equal(attribute(openingTag(hyperspace, "button", id), "type"), "button");
  }
  assert.match(app, /rotation: Object\.freeze\(\{[^}]*xw:[^}]*yw:[^}]*zw:/);
  assert.match(app, /projectHyperRubixPoint4\(rotated, state\.projectionDepth\)/);
  assert.match(app, /function normalizePuzzlePoint\([\s\S]*?point\[axis\] \/ radius/);
  assert.match(app, /const halfExtent = 0\.29 \* state\.stickerScale \/ metrics\.radius/);
  assert.match(app, /state\.rotation\.xw = normalizeDegrees/);
  assert.match(app, /state\.rotation\.yw = normalizeDegrees/);
  assert.match(app, /state\.rotation\.zw = normalizeDegrees/);

  const audioButton = openingTag(html, "button", "audioButton");
  assert.equal(attribute(audioButton, "type"), "button");
  assert.equal(attribute(audioButton, "aria-pressed"), "false");
  assert.match(html, /id="audioState">off<\/small>/);
  assert.match(app, /audio: false/);
  assert.match(app, /if \(!state\.audio \|\| !this\.context \|\| !this\.master\) return/);
  assert.match(app, /\$\("audioButton"\)\.addEventListener\("click", async \(\) =>/);

  const reset = openingTag(html, "button", "resetAll");
  assert.equal(attribute(reset, "type"), "button");
  assert.equal(hasBooleanAttribute(reset, "data-reset-all"), true);
  assert.equal(hasBooleanAttribute(reset, "data-reset-in-place"), true);
  const resetSource = sourceSection(app, "function resetAll()", "function updateMoveAnimation(time)");
  assert.match(resetSource, /stopTransport\(\{ hardAudio: true \}\)/);
  assert.match(resetSource, /clearSoundingStickerPulses\(\)/);
  assert.match(resetSource, /state\.puzzle = createSolvedHyperRubix\(DEFAULTS\.puzzleSize\)/);
  assert.match(resetSource, /history = \[\]/);
  assert.match(resetSource, /state\.selectedCell = DEFAULTS\.selectedCell/);
  assert.match(resetSource, /state\.selectedPlane = DEFAULTS\.selectedPlane/);
  for (const key of [
    "tempo", "swing", "subdivisionsPerBeat", "patternId", "playbackMode", "twistDensity",
  ]) {
    assert.match(resetSource, new RegExp(`state\\.${key} = DEFAULTS\\.${key}`));
  }
  assert.match(resetSource, /rebuildSequence\(\)/);
  assert.match(app, /\$\("resetAll"\)\.addEventListener\("click", resetAll\)/);
});

test("the app consumes the pure core, supports pointer and keyboard play, and stays network-free", async () => {
  const { css, app } = await pageSources();

  const coreImport = app.match(
    /import\s*\{([\s\S]*?)\}\s*from "\.\/src\/hyper-rubix\.js";/,
  );
  assert.ok(coreImport, "the page app should import the pure Hyper Rubix core");
  for (const name of [
    "HYPER_RUBIX_BOUNDARY_CELLS",
    "HYPER_RUBIX_CELL_ORDER",
    "HYPER_RUBIX_PLANE_DRUMS",
    "HYPER_RUBIX_SEQUENCE_LENGTH",
    "HYPER_RUBIX_SEQUENCE_PATTERNS",
    "HYPER_RUBIX_TECHNO_VOICES",
    "buildHyperRubixTesseractWireframe",
    "createHyperRubixHyperbarSnapshot",
    "createHyperRubixScramble",
    "createHyperRubixSequence",
    "createSeededHyperRubixRandom",
    "createSolvedHyperRubix",
    "hyperRubixDisorder",
    "hyperRubixSequenceIndex",
    "hyperRubixSizeMetrics",
    "hyperRubixStepDurationSeconds",
    "hyperRubixTechnoVoiceParameters",
    "invertHyperRubixMove",
    "invertHyperRubixMoves",
    "isHyperRubixSolved",
    "normalizeHyperRubixMove",
    "projectHyperRubixPoint4",
    "rotateHyperRubixPoint4",
    "turnHyperRubixBoundaryCell",
  ]) {
    assert.match(coreImport[1], new RegExp(`\\b${name}\\b`), `${name} should come from the core`);
  }
  for (const name of [
    "HYPER_RUBIX_CELL_ORDER",
    "HYPER_RUBIX_PLANE_DRUMS",
    "HYPER_RUBIX_SEQUENCE_LENGTH",
    "HYPER_RUBIX_SEQUENCE_PATTERNS",
    "HYPER_RUBIX_TECHNO_VOICES",
    "buildHyperRubixTesseractWireframe",
    "createHyperRubixHyperbarSnapshot",
    "createHyperRubixScramble",
    "createHyperRubixSequence",
    "createSeededHyperRubixRandom",
    "createSolvedHyperRubix",
    "hyperRubixDisorder",
    "hyperRubixSequenceIndex",
    "hyperRubixSizeMetrics",
    "hyperRubixStepDurationSeconds",
    "hyperRubixTechnoVoiceParameters",
    "invertHyperRubixMove",
    "invertHyperRubixMoves",
    "isHyperRubixSolved",
    "normalizeHyperRubixMove",
    "projectHyperRubixPoint4",
    "rotateHyperRubixPoint4",
    "turnHyperRubixBoundaryCell",
  ]) {
    assert.ok(
      (app.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length >= 2,
      `${name} should be used after import`,
    );
  }

  assert.match(app, /canvas\.addEventListener\("pointerdown"/);
  assert.match(app, /canvas\.addEventListener\("pointermove"/);
  assert.match(app, /canvas\.addEventListener\("pointerup", finishPointer\)/);
  assert.match(app, /canvas\.addEventListener\("wheel"/);
  const drawing = sourceSection(app, "function drawScene(time)", "class HyperRubixAudio");
  assert.equal(
    (drawing.match(/drawSticker\(item, time\)/g) ?? []).length,
    1,
    "stickers should remain in a single depth-ordered paint pass",
  );
  const stickerDrawing = sourceSection(
    app,
    "function drawSticker(item, time)",
    "function drawTurnArc(time)",
  );
  assert.match(app, /soundingStickerPulses\.get\(stickerId\)/);
  assert.match(drawing, /expireSoundingStickerPulses\(time\)/);
  assert.match(stickerDrawing, /soundingStickerStrength\(item\.sticker\.id, time\)/);
  assert.match(stickerDrawing, /context\.shadowBlur = 18 \+ soundingStrength \* 18/);
  assert.match(stickerDrawing, /context\.lineWidth = soundingStrength > 0/);
  assert.match(app, /window\.addEventListener\("pagehide"/);
  assert.match(app, /audio\.dispose\(\)/);
  const keyboard = sourceSection(
    app,
    'canvas.addEventListener("keydown", (event) => {',
    "function bindRange(",
  );
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Backspace"]) {
    assert.match(keyboard, new RegExp(`"${key}"`));
  }
  assert.match(keyboard, /event\.key\.toLowerCase\(\) === "w"/);
  assert.match(keyboard, /event\.key === " "[\s\S]*?\$\("playButton"\)\.click\(\)[\s\S]*?event\.preventDefault\(\)/);
  assert.match(keyboard, /event\.key\.toLowerCase\(\) === "r"[\s\S]*?\$\("restartLoop"\)\.click\(\)[\s\S]*?event\.preventDefault\(\)/);
  assert.match(keyboard, /event\.key === "\[" \|\| event\.key === "\]"/);

  const importSpecifiers = [...app.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
    .map((match) => match[1]);
  assert.ok(importSpecifiers.length >= 1);
  assert.equal(importSpecifiers.every((specifier) => specifier.startsWith("./")), true);
  assert.doesNotMatch(
    app,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b|\bimport\s*\(/,
  );
  assert.doesNotMatch(css, /https?:\/\/|@import\s+url/i);

  assert.match(css, /\.hyper-rubix-page\s*\{/);
  assert.match(css, /\.hyper-rubix-shell\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /\.hyper-rubix-face-picker\s*\{/);
  assert.match(css, /\.hyper-rubix-plane-picker\s*\{/);
  assert.match(css, /\.hyper-rubix-turn-row\s*\{/);
  assert.match(css, /\.hyper-rubix-view-switch\s*\{/);
  assert.match(css, /\.hyper-rubix-hyperbar-cell:focus-visible\s*\{/);
  assert.match(css, /repeat\(var\(--hyperbar-columns, 27\), minmax\(10px, 1fr\)\)/);
  assert.match(css, /\.hyper-rubix-hyperbar-row\s*\{[\s\S]*?width: max-content;[\s\S]*?min-width: 100%/);
  assert.match(css, /\.hyper-rubix-hyperbar-cell\s*\{[\s\S]*?min-width: 10px;[\s\S]*?height: 14px/);
  assert.match(css, /\.hyper-rubix-hyperbar-cell\.is-group-start\s*\{/);
  assert.match(css, /\.hyper-rubix-shell\s*\{[\s\S]*?clamp\(390px, 30vw, 500px\)/);
  assert.match(css, /\.hyper-rubix-sequence-selects\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.hyper-rubix-fold-toggle\s*\{/);
  assert.match(css, /\.hyper-rubix-fold-toggle\[aria-pressed="true"\]\s*\{/);
  assert.match(css, /\.hyper-rubix-modulation\s*\{/);
  assert.match(css, /\.hyper-rubix-modulation-grid\s*\{/);
  const touchHyperbar = sourceSection(
    css,
    "@media (pointer: coarse), (max-width: 650px)",
    "@media (max-width: 650px)",
  );
  assert.match(touchHyperbar, /\.hyper-rubix-hyperbar-grid\s*\{[\s\S]*?overflow-x: auto/);
  assert.match(touchHyperbar, /grid-template-columns: 30px repeat\(var\(--hyperbar-columns, 27\), 28px\)/);
  assert.match(touchHyperbar, /\.hyper-rubix-hyperbar-cell\s*\{[\s\S]*?width: 28px;[\s\S]*?height: 28px/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /@media \(max-width: 650px\)/);
  const narrowPhone = sourceSection(
    css,
    "@media (max-width: 410px)",
    "@media (prefers-reduced-motion: reduce)",
  );
  assert.match(narrowPhone, /\.hyper-rubix-sequence-selects,[\s\S]*?\.hyper-rubix-fold-controls\s*\{[\s\S]*?grid-template-columns: 1fr/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
