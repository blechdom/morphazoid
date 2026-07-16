import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Shape and Lattice expose reciprocal instrument navigation", async () => {
  const [shapeHtml, latticeHtml] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("lattice.html", root), "utf8"),
  ]);

  assert.match(shapeHtml, /<a class="tab active" href="\.\/" aria-current="page">shape<\/a>/);
  assert.match(shapeHtml, /<a class="tab" href="lattice\.html">lattice<\/a>/);
  assert.match(latticeHtml, /<a class="tab" href="\.\/">shape<\/a>/);
  assert.match(latticeHtml, /<a class="tab active" href="lattice\.html" aria-current="page">lattice<\/a>/);
});

test("Lattice is one centered line instrument with no walk controls", async () => {
  const [html, app, geometry] = await Promise.all([
    readFile(new URL("lattice.html", root), "utf8"),
    readFile(new URL("lattice-app.js", root), "utf8"),
    readFile(new URL("src/lattice.js", root), "utf8"),
  ]);

  assert.equal((html.match(/<canvas[^>]+id="stage"/g) ?? []).length, 1);
  assert.equal((html.match(/<canvas\b/g) ?? []).length, 2);
  assert.match(html, /The line stays centered/);
  assert.match(html, /Only edges touched by the line become voices/);
  assert.match(html, /id="angle"/);
  assert.match(html, /id="position"/);
  assert.match(html, /id="voiceCap"/);
  assert.match(html, /src="lattice-app\.js"/);
  assert.doesNotMatch(html, /walk dot|walk length|turn bias/i);
  assert.doesNotMatch(`${app}\n${geometry}`, /walkNet|walkToPolyline|_probeWalk|walkLen/);
  assert.match(app, /createScanLine\(viewBounds, 0\.5, state\.angle\)/);
  assert.match(app, /contactsForLine/);
  assert.match(app, /new VoicePool\(MAX_VOICES\)/);
});

test("Lattice exposes complete shape controls and single-patch synth modes", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("lattice.html", root), "utf8"),
    readFile(new URL("lattice-app.js", root), "utf8"),
  ]);
  assert.match(html, /id="tilingType"/);
  assert.match(html, /id="parameter5"/);
  assert.match(html, /id="edgeCurve4"/);
  assert.match(html, /Rigid I classes remain straight/);
  assert.match(html, /id="straightenEdges"/);
  assert.match(html, /id="intersectionAccent"/);
  assert.match(html, /id="tileEditorPanel" hidden/);
  assert.match(html, /id="tileEditorCanvas"/);
  assert.match(html, /Edit tile by dragging/);
  assert.match(app, /parametersForDraggedVertex/);
  assert.doesNotMatch(html, /id="waveform"|Triangle<\/option>|alternating sine/i);
  assert.match(app, /TILING_TYPES/);
  assert.match(app, /waveform: "sine"/);
  assert.doesNotMatch(app, /waveform: state\.|"triangle"|"alternating"/);
  for (const mode of ["sine", "percussion", "shepard", "fm", "pm"]) {
    assert.match(html, new RegExp(`<option value="${mode}"`));
  }
  assert.match(app, /synthParametersForMode/);
  assert.match(app, /emitIntersectionStrikes/);
});

test("Lattice markup has unique ids and complete control labels", async () => {
  const html = await readFile(new URL("lattice.html", root), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "every lattice id must be unique");

  for (const control of [
    "level", "position", "angle", "tilingType", "density",
    "parameter0", "parameter1", "parameter2", "parameter3", "parameter4", "parameter5",
    "edgeCurve0", "edgeCurve1", "edgeCurve2", "edgeCurve3", "edgeCurve4",
    "baseFrequency", "pitchRange", "contactLevel", "intersectionAccent", "voiceCap",
    "soundMode", "percussionAttack", "percussionDecay", "shepardCycles",
    "shepardDirection", "shepardWidth", "fmIndex", "fmRatio", "pmIndex", "pmRatio",
    "pitchSource", "pitchCurve", "synthSource", "levelSource", "levelCurve", "stereoWidth",
  ]) {
    assert.match(html, new RegExp(`<label[^>]*for="${control}"`), `${control} needs a label`);
  }
  assert.match(html, /<input id="speed" aria-label="Pattern speed"/);
});
