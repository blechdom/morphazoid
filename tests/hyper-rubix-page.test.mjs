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

test("Hyper Rubix is a standalone accessible Morphazoid instrument", async () => {
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
    /id="canvasInstructions"[\s\S]*?Drag to orbit[\s\S]*?Fold W[\s\S]*?Press Space[\s\S]*?shape loop/i,
  );
  assert.match(html, /Arrow keys orbit[\s\S]*?Shift plus an arrow folds[\s\S]*?Backspace undoes/i);
  assert.match(html, /id="serializationInstructions"[\s\S]*?216[\s\S]*?bright cursor[\s\S]*?time/i);
  assert.match(html, /clock[\s\S]*?never turns the puzzle automatically/i);
  assert.match(html, /id="liveStatus"[^>]*aria-live="polite"/);
  const statusTag = html.match(/<div class="hyper-rubix-status"[^>]*>/)?.[0] ?? "";
  assert.ok(statusTag);
  assert.doesNotMatch(statusTag, /aria-live/);
  assert.match(html, /id="audioError"[^>]*role="alert"[^>]*hidden/);

  const authoredUrls = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(authoredUrls.length >= 6);
  for (const url of authoredUrls) {
    assert.doesNotMatch(url, /^(?:[a-z][a-z\d+.-]*:|\/\/)/i, `${url} should remain local`);
  }
});

test("the open Shape loop exposes one forward all-sticker transport and five presets", async () => {
  const { html, app } = await pageSources();
  const sequencePanel = sourceSection(
    html,
    '<details class="group control-section hyper-rubix-control-section" data-section="sequence" open>',
    "</details>",
  );

  assert.match(sequencePanel, /<h2 class="group-title">Shape loop<\/h2>/);
  assert.match(sequencePanel, /id="clockSummary">216 notes · 112 BPM · 1\/8<\/span>/);
  const presets = selectOptions(sequencePanel, "voice");
  assert.deepEqual(presets.map(({ value, label }) => [value, label]), [
    ["pulse", "Hyper kit"],
    ["glass", "Prism kit"],
    ["dust", "Bit kit"],
    ["webgpu-303", "WebGPU 303"],
    ["rattlesnake", "Rattlesnake"],
  ]);
  assert.equal(presets.find(({ tag }) => hasBooleanAttribute(tag, "selected"))?.value, "pulse");
  assert.ok(sequencePanel.indexOf('id="voice"') < sequencePanel.indexOf('id="playButton"'));
  assert.match(sequencePanel, /id="voiceHelp"[^>]*>[^<]*live sticker loop[^<]*Orbit, fold, and twist/i);

  const play = openingTag(sequencePanel, "button", "playButton");
  assert.equal(attribute(play, "aria-pressed"), "false");
  assert.equal(hasBooleanAttribute(play, "data-primary-transport"), true);
  assert.match(sequencePanel, /id="playLabel">Play shape loop<\/b>/);
  assert.match(sequencePanel, /id="playState">216 stickers · one note each<\/small>/);
  const restart = openingTag(sequencePanel, "button", "restartLoop");
  assert.match(attribute(restart, "aria-label") ?? "", /first sticker/i);

  const grid = openingTag(sequencePanel, "div", "hyperbarGrid");
  assert.equal(attribute(grid, "role"), "grid");
  assert.match(attribute(grid, "aria-label") ?? "", /eight color lanes.+two hundred sixteen/i);
  assert.deepEqual(
    [attribute(grid, "aria-rowcount"), attribute(grid, "aria-colcount")],
    ["8", "27"],
  );
  assert.equal(hasBooleanAttribute(openingTag(sequencePanel, "div", "hyperbarPanel"), "hidden"), false);
  assert.match(sequencePanel, /216-sticker loop[\s\S]*?one note per sticker · every note active/i);

  const tempo = openingTag(sequencePanel, "input", "tempo");
  assert.deepEqual(
    ["type", "min", "max", "step", "value"].map((name) => attribute(tempo, name)),
    ["range", "30", "300", "1", "112"],
  );
  const rates = selectOptions(sequencePanel, "twistRate");
  assert.deepEqual(rates.map(({ value }) => value), ["1", "2", "4", "8", "16"]);
  assert.match(sequencePanel, /id="pulseRateHelp"[^>]*>[^<]*1\/4[^<]*quarter-note beat[^<]*1\/64/i);

  const compatibility = sourceSection(sequencePanel, '<div hidden aria-hidden="true">', "</div>");
  assert.equal(selectOptions(compatibility, "sequenceMethod").find(({ tag }) => (
    hasBooleanAttribute(tag, "selected")
  ))?.value, "sticker-stream");
  assert.deepEqual(selectOptions(compatibility, "playbackMode").map(({ value }) => value), ["forward"]);
  assert.deepEqual(selectOptions(compatibility, "twistMotion").map(({ value }) => value), ["off"]);
  assert.equal(hasBooleanAttribute(openingTag(compatibility, "button", "reseedPattern"), "disabled"), true);

  assert.match(app, /sequenceMethod: "sticker-stream"/);
  assert.match(app, /twistMotion: "off"/);
  assert.match(app, /playbackMode: "forward"/);
  assert.match(app, /autoRotate: false/);
  assert.match(app, /"sticker-stream": Object\.freeze\([\s\S]*?serial: true[\s\S]*?autoTwist: false/);
  assert.match(app, /`Shape loop playing all \$\{method\.length\} stickers/);
  const tempoBinding = sourceSection(
    app,
    'bindRange("tempo", "tempo"',
    'bindRange("swing", "swing"',
  );
  assert.doesNotMatch(tempoBinding, /stopTransport|restartTransportClock|state\.playing\s*=\s*false/);
  const finishedTurn = sourceSection(app, "function finishActiveMove(time)", "function enqueueMove(");
  assert.match(finishedTurn, /if \(state\.playing && sequenceMethodConfig\(\)\.serial\)/);
  assert.match(finishedTurn, /transportPuzzle = state\.puzzle/);
  assert.match(finishedTurn, /rebuildTransportStickerStream\(sequenceMethodConfig\(\), state\.puzzle\)/);
  assert.doesNotMatch(finishedTurn, /stopTransport/);
});

test("shape position, topology, Rattlesnake, and WebGPU 303 are mapped as live preset behavior", async () => {
  const { html, app } = await pageSources();
  const soundPanel = sourceSection(
    html,
    '<details class="group control-section hyper-rubix-control-section" data-section="sound"',
    "</details>",
  );

  assert.doesNotMatch(soundPanel, /<select\b[^>]*\bid="voice"/);
  assert.match(soundPanel, /<h2 class="group-title">Shape mapping<\/h2>/);
  assert.match(soundPanel, /one tuned resonator for each real lattice connection/i);
  assert.match(soundPanel, /Matching colors[\s\S]*mixed colors[\s\S]*fault lines/i);
  assert.deepEqual(selectOptions(soundPanel, "topologyMode").map(({ value }) => value), [
    "mesh", "cohesion", "faults", "off",
  ]);

  for (const [id, value] of [
    ["pitchInfluence", "0.72"],
    ["filterInfluence", "0.72"],
    ["stereoInfluence", "0.72"],
    ["neighborResponse", "1"],
    ["wInfluence", "0.72"],
    ["disorderInfluence", "0.6"],
  ]) {
    const input = openingTag(soundPanel, "input", id);
    assert.deepEqual(
      ["min", "max", "step", "value"].map((name) => attribute(input, name)),
      ["0", "2", "0.01", value],
    );
    assert.equal(attribute(input, "aria-describedby"), `${id}Help`);
  }

  assert.deepEqual(selectOptions(soundPanel, "foldSound").map(({ value }) => value), [
    "glide", "ticks", "both", "off",
  ]);
  assert.equal(hasBooleanAttribute(openingTag(soundPanel, "button", "hearAutoDrift"), "hidden"), true);
  assert.equal(hasBooleanAttribute(openingTag(soundPanel, "button", "rattleButton"), "hidden"), true);
  assert.equal(hasBooleanAttribute(openingTag(soundPanel, "div", "rattlesnakeControls"), "hidden"), true);
  assert.deepEqual(selectOptions(soundPanel, "rattleRate").map(({ value, label }) => [value, label]), [
    ["2", "Loose"], ["4", "Dense"], ["8", "Swarm"],
  ]);
  assert.match(soundPanel, /Each preset reads the same complete sticker loop/i);
  assert.match(soundPanel, /manual quarter-turn changes both the immediate audition and every later visit/i);

  const geometry = sourceSection(app, "function audioGeometryForCell(", "function audioGeometryForStickerEvent(");
  assert.match(geometry, /const rotated = transformed4\(sourcePosition\)/);
  assert.match(geometry, /const viewed = rotatePoint3\(projected4\)/);
  assert.match(geometry, /position: \{[\s\S]*?x: clamp\(viewed\.x[\s\S]*?y: clamp\(viewed\.y[\s\S]*?z: clamp\(viewed\.z[\s\S]*?w: clamp\(rotated\.w/);
  assert.match(geometry, /pan: clamp\([\s\S]*?projected\.x/);
  assert.match(app, /state\.rattleEnabled = isRattlesnakePreset\(\)/);
  assert.match(app, /return state\.voice === "rattlesnake"/);
  assert.match(app, /if \(isRattlesnakePreset\(\)\)[\s\S]*?audio\.scheduleRattleStep/);

  assert.match(app, /import \{ WebGpu303Audio, webGpu303Support \} from "\.\/src\/webgpu-303\.js"/);
  assert.match(app, /createHyperRubixWebGpu303Pattern,[\s\S]*?from "\.\/src\/hyper-rubix-webgpu-303\.js"/);
  assert.match(app, /function syncWebGpu303Pattern\(/);
  assert.match(app, /function queueWebGpu303Sync\(/);
  assert.match(app, /async function stopWebGpu303Engine\(/);
  assert.match(app, /async function fallbackFromWebGpu303\(/);
  assert.match(app, /audible Web Audio acid fallback/);
  assert.match(app, /start\(pattern\.params, \{[\s\S]*?context: audio\.context,[\s\S]*?destination: audio\.drumBus,[\s\S]*?autoStart: false/);
  assert.match(app, /setErrorHandler\(/);
  assert.match(app, /sequencePhase: webGpu303SequencePhase/);
  assert.match(app, /currentPlaybackTime\?\.\(\)/);
  assert.doesNotMatch(app, /return transportPosition \/ Math\.max/);
  assert.match(app, /button\.setAttribute\("role", "gridcell"\)/);
  assert.match(app, /button\.setAttribute\("aria-colindex"/);
  assert.match(app, /setAttribute\("aria-current", "step"\)/);
  assert.match(app, /function followHyperbarPlayhead\([\s\S]*?grid\.scrollLeft \+=/);
  assert.match(app, /strikeStickerTopology/);
});

test("variable-order twists stay manual and the guide explains 64, 216, and 512 notes", async () => {
  const { html, app } = await pageSources();
  const twistPanel = sourceSection(
    html,
    '<details class="group control-section hyper-rubix-control-section" data-section="twist" open>',
    "</details>",
  );
  assert.deepEqual(selectOptions(twistPanel, "puzzleSize").map(({ value, label }) => [value, label]), [
    ["2", "2 × 2 × 2 × 2"],
    ["3", "3 × 3 × 3 × 3"],
    ["4", "4 × 4 × 4 × 4"],
  ]);
  assert.match(twistPanel, /id="puzzleSizeHelp"[^>]*>[^<]*216 stickers[^<]*27 spatial pulses/i);

  const faceButtons = [...twistPanel.matchAll(/<button\b([^>]*)\bdata-face="([xyzw][+-])"([^>]*)>/g)];
  assert.equal(faceButtons.length, 8);
  assert.deepEqual(new Set(faceButtons.map((match) => match[2])), new Set([
    "x-", "x+", "y-", "y+", "z-", "z+", "w-", "w+",
  ]));
  assert.equal(attribute(openingTag(twistPanel, "div", "planePicker"), "role"), "group");
  for (const id of ["turnCounterclockwise", "turnClockwise", "scramblePuzzle", "undoMove", "unwindPuzzle"]) {
    assert.equal(attribute(openingTag(twistPanel, "button", id), "type"), "button");
  }
  assert.match(app, /function turnSelected\(quarterTurns\) \{[\s\S]*?enqueueMove\(/);
  const turnSelected = sourceSection(app, "function turnSelected(quarterTurns)", '$("turnCounterclockwise")');
  assert.doesNotMatch(turnSelected, /stopTransport|state\.playing\s*=\s*false/);

  const hyperspace = sourceSection(
    html,
    '<details class="group control-section hyper-rubix-control-section" data-section="hyperspace"',
    "</details>",
  );
  const autoRotate = openingTag(hyperspace, "button", "autoRotate");
  assert.equal(attribute(autoRotate, "aria-pressed"), "false");
  assert.equal(hasBooleanAttribute(autoRotate, "hidden"), true);
  assert.match(hyperspace, /projection stays still until you touch it/i);
  assert.match(hyperspace, /Orbit changes[\s\S]*?Fold W changes[\s\S]*?clock continues/i);

  const guide = sourceSection(
    html,
    '<details class="group control-section hyper-rubix-control-section" data-section="guide"',
    "</details>",
  );
  assert.match(guide, /tesseract has eight cubic boundary cells/i);
  assert.match(guide, /eight colored boundary cells across 27 spatial addresses/i);
  assert.match(guide, /Size 2 has 64 notes, size 3 has 216, and size 4 has 512/i);
  assert.match(guide, /clock never twists the puzzle/i);

  const resize = sourceSection(app, "function rebuildPuzzleForSize(", '$("puzzleSize").addEventListener');
  assert.match(resize, /stopTransport\(\{ hardAudio: true \}\)/);
  assert.match(resize, /state\.puzzle = createSolvedHyperRubix\(metrics\.size\)/);
  assert.match(resize, /paintSequenceMethod\(\)/);
});

test("the app keeps its pure core, keyboard play, local imports, and responsive canvas styling", async () => {
  const { css, app } = await pageSources();
  const coreImport = app.match(/import\s*\{([\s\S]*?)\}\s*from "\.\/src\/hyper-rubix\.js";/);
  assert.ok(coreImport);
  for (const name of [
    "HYPER_RUBIX_BOUNDARY_CELLS",
    "HYPER_RUBIX_CELL_ORDER",
    "HYPER_RUBIX_TECHNO_VOICES",
    "createHyperRubixHyperbarSnapshot",
    "createHyperRubixStickerStream",
    "createSolvedHyperRubix",
    "hyperRubixDisorder",
    "hyperRubixSizeMetrics",
    "hyperRubixTechnoVoiceParameters",
    "projectHyperRubixPoint4",
    "rotateHyperRubixPoint4",
    "turnHyperRubixBoundaryCell",
  ]) assert.match(coreImport[1], new RegExp(`\\b${name}\\b`));

  assert.match(app, /canvas\.addEventListener\("pointerdown"/);
  assert.match(app, /canvas\.addEventListener\("pointermove"/);
  assert.match(app, /canvas\.addEventListener\("pointerup", finishPointer\)/);
  assert.match(app, /canvas\.addEventListener\("wheel"/);
  const keyboard = sourceSection(app, 'canvas.addEventListener("keydown", (event) => {', "function bindRange(");
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Backspace"]) {
    assert.match(keyboard, new RegExp(`"${key}"`));
  }
  assert.match(keyboard, /event\.key === " "[\s\S]*?\$\("playButton"\)\.click\(\)/);
  assert.match(keyboard, /event\.key\.toLowerCase\(\) === "r"[\s\S]*?\$\("restartLoop"\)\.click\(\)/);
  assert.match(app, /window\.addEventListener\("pagehide"/);
  assert.match(app, /audio\.dispose\(\)/);

  const importSpecifiers = [...app.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]);
  assert.ok(importSpecifiers.length >= 4);
  assert.equal(importSpecifiers.every((specifier) => specifier.startsWith("./")), true);
  assert.doesNotMatch(app, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b|\bimport\s*\(/);
  assert.doesNotMatch(css, /https?:\/\/|@import\s+url/i);
  assert.match(css, /\.hyper-rubix-shell\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /\.hyper-rubix-face-picker\s*\{/);
  assert.match(css, /\.hyper-rubix-hyperbar-cell:focus-visible\s*\{/);
  assert.match(css, /repeat\(var\(--hyperbar-columns, 27\), minmax\(10px, 1fr\)\)/);
  assert.match(css, /@media \(max-width:/);
});
