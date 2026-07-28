import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_FM_DRUM_VOICES } from "../src/fm-drums.js";
import {
  buildLattice,
  contactsForLine,
  createScanLine,
} from "../src/lattice.js";
import {
  LATTICE_DRUM_MAPPING_MODES,
  latticeDrumVoiceIndex,
  mappedLatticeDrumVoice,
  normalizedLatticeContact,
} from "../src/lattice-drums.js";

const bounds = { minX: -2, minY: -1, maxX: 2, maxY: 1 };
const root = new URL("../", import.meta.url);

test("lattice drum mappings cover edge, angle, position, incidence, and density", () => {
  assert.equal(LATTICE_DRUM_MAPPING_MODES.length, 3);
  assert.equal(latticeDrumVoiceIndex({
    edgeShapeId: 2,
    orientation: 0.7,
  }), 10);
  assert.equal(latticeDrumVoiceIndex(
    { x: -1.9, y: 0.9 },
    { mode: "position-grid", bounds },
  ), 0);
  assert.equal(latticeDrumVoiceIndex(
    { incidence: 0.8 },
    { mode: "incidence-density", contactCount: 12, densityCeiling: 16 },
  ), 15);
});

test("contact normalization and drum modulation remain bounded", () => {
  assert.deepEqual(normalizedLatticeContact({ x: 0, y: 0 }, bounds), { x: .5, y: .5 });
  const voice = mappedLatticeDrumVoice(
    { frequency: 100, tone: .2, modIndex: 8, level: .8 },
    { x: 0, y: 1, incidence: 1 },
    { bounds, pitchDepth: 12, characterDepth: 1, contactCount: 16 },
  );
  assert.equal(voice.frequency, 200);
  assert.equal(voice.tone, 1);
  assert.ok(voice.modIndex > 8);
  assert.ok(voice.level > 0 && voice.level <= .4);
});

test("bell voices become shorter and quieter geometry percussion", () => {
  const bell = DEFAULT_FM_DRUM_VOICES.find(({ id }) => id === "soft-chime");
  const voice = mappedLatticeDrumVoice(
    bell,
    { x: 0, y: 0, incidence: 1 },
    { bounds, pitchDepth: 0, characterDepth: 0, contactCount: 1 },
  );
  assert.equal(voice.attack, 0.006);
  assert.equal(voice.decay, 0.58);
  assert.ok(voice.modIndex < bell.modIndex);
  assert.ok(voice.level < bell.level);
  assert.equal(bell.decay, 1.8);
});

test("real lattice contacts resolve to playable FM drum voices", () => {
  const lattice = buildLattice({ type: 20, bounds, scale: .3 });
  const contacts = contactsForLine(lattice, createScanLine(bounds, .5, 90));
  assert.ok(contacts.length > 0);
  for (const contact of contacts) {
    const index = latticeDrumVoiceIndex(contact, {
      mode: "edge-angle",
      bounds,
      contactCount: contacts.length,
    });
    assert.ok(index >= 0 && index < DEFAULT_FM_DRUM_VOICES.length);
    const voice = mappedLatticeDrumVoice(DEFAULT_FM_DRUM_VOICES[index], contact, {
      bounds,
      contactCount: contacts.length,
    });
    assert.ok(voice.frequency >= 20 && voice.frequency <= 12_000);
    assert.ok(voice.level >= 0 && voice.level <= 1);
  }
});

test("Lattice Drum Machine uses the lattice core and compact FM drum bank", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("lattice-drums.html", root), "utf8"),
    readFile(new URL("lattice-drums.css", root), "utf8"),
    readFile(new URL("lattice-drums-app.js", root), "utf8"),
  ]);
  assert.match(html, /Lattice Drum Machine/);
  assert.match(html, /id="stage"/);
  assert.doesNotMatch(html, /id="latticeDrumsTitle"|class="lattice-drums-heading"/);
  assert.doesNotMatch(css, /\.lattice-drums-heading/);
  assert.match(html, /id="formSection" data-section="form"/);
  assert.match(html, /id="tileEditorCanvas"/);
  assert.match(html, /id="parameter5"/);
  assert.match(html, /id="edgeCurve4"/);
  assert.match(html, /id="straightenEdges"/);
  assert.match(html, /id="resetForm"/);
  assert.match(html, /id="patternAngle"[^>]+step="0\.1"/);
  assert.match(html, /id="lineAngle"[^>]+max="179\.9"[^>]+step="0\.1"/);
  assert.match(html, /id="drumMap"/);
  assert.match(html, /src="lattice-drums-app\.js"/);
  assert.match(css, /\.lattice-drum-map[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(app, /TILING_TYPES/);
  assert.match(app, /buildPrototile/);
  assert.match(app, /parametersForDraggedVertex/);
  assert.match(app, /constrainPrototileEdit/);
  assert.match(app, /configureTilingControls/);
  assert.match(app, /contactsForLine/);
  assert.match(app, /mappedLatticeDrumVoice/);
  assert.doesNotMatch(
    html,
    /voiceEditor|editorControls|saveBank|soundMode|soundSection|synthMapping/,
  );
});
