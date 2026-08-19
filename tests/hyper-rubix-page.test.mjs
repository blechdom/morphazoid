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
  assert.match(sequencePanel, /<h2 class="group-title">Auto-twist sequencer<\/h2>/);
  assert.match(sequencePanel, /id="clockSummary">112 BPM · 1\/8<\/span>/);

  const play = openingTag(sequencePanel, "button", "playButton");
  assert.equal(attribute(play, "type"), "button");
  assert.equal(attribute(play, "aria-pressed"), "false");
  assert.equal(hasBooleanAttribute(play, "data-primary-transport"), true);
  assert.match(sequencePanel, /id="playLabel">Play auto-twists<\/b>/);
  assert.match(sequencePanel, /id="playState">16-step twist tape<\/small>/);

  const restart = openingTag(sequencePanel, "button", "restartLoop");
  assert.equal(attribute(restart, "type"), "button");
  assert.match(attribute(restart, "aria-label") ?? "", /restart.+step 1/i);
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
  ]);
  assert.equal(rates.filter(({ tag }) => hasBooleanAttribute(tag, "selected")).length, 1);
  assert.equal(rates.find(({ tag }) => hasBooleanAttribute(tag, "selected"))?.value, "2");
  assert.deepEqual(selectOptions(sequencePanel, "sequencePattern").map(({ value }) => value), [
    "axis-break", "straight-xyz", "w-pressure", "random-walk",
  ]);
  assert.deepEqual(selectOptions(sequencePanel, "playbackMode").map(({ value }) => value), [
    "forward", "reverse", "pendulum", "random",
  ]);
  assert.equal(
    hasBooleanAttribute(openingTag(sequencePanel, "button", "reseedPattern"), "disabled"),
    true,
  );

  assert.match(app, /const LOOKAHEAD_MS = 110/);
  assert.match(app, /const SCHEDULER_INTERVAL_MS = 24/);
  const scheduler = sourceSection(app, "function schedulerTick()", "function restartTransportClock(");
  assert.match(scheduler, /audio\.context\.currentTime\s*\+\s*Math\.max\(0, nextStepAtMs - nowMs\) \/ 1_000/);
  assert.match(scheduler, /audio\.strike\(step\.move, scheduledWhen, step\.accent \? 1\.16 : 0\.78\)/);
  assert.match(scheduler, /scheduleVisualSequenceStep\(/);
  assert.match(scheduler, /nextStepAtMs \+= stepDurationMs/);
  const stop = sourceSection(app, "function stopTransport(", "function moveLabel(");
  assert.match(stop, /state\.playing = false/);
  assert.match(stop, /clearScheduler\(\)/);
  assert.match(stop, /item\.source !== "transport"/);
});

test("the twist panel exposes all cells, a dynamic legal-plane host, and complete puzzle actions", async () => {
  const { html, app } = await pageSources();
  const twistPanel = sourceSection(
    html,
    '<details class="group control-section hyper-rubix-control-section" data-section="twist"',
    "</details>",
  );

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
  assert.match(resetSource, /stopTransport\(\)/);
  assert.match(resetSource, /state\.puzzle = createSolvedHyperRubix\(\)/);
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
    "buildHyperRubixTesseractWireframe",
    "createHyperRubixScramble",
    "createHyperRubixSequence",
    "createSeededHyperRubixRandom",
    "createSolvedHyperRubix",
    "hyperRubixDisorder",
    "hyperRubixSequenceIndex",
    "hyperRubixStepDurationSeconds",
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
    "buildHyperRubixTesseractWireframe",
    "createHyperRubixScramble",
    "createHyperRubixSequence",
    "createSeededHyperRubixRandom",
    "createSolvedHyperRubix",
    "hyperRubixDisorder",
    "hyperRubixSequenceIndex",
    "hyperRubixStepDurationSeconds",
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
    (drawing.match(/drawSticker\(item\)/g) ?? []).length,
    1,
    "stickers should remain in a single depth-ordered paint pass",
  );
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
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
