import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEFAULT_FM_DRUM_VOICES } from "../src/fm-drums.js";
import {
  buildShape,
  pointAtPath,
  verticalIntersections,
} from "../src/geometry.js";
import {
  mappedShapeDrumVoice,
  normalizedShapeContact,
  SHAPE_DRUM_MAPPING_MODES,
  shapeDrumVoiceIndex,
} from "../src/shape-drums.js";

const bounds = { minX: -2, minY: -1, maxX: 2, maxY: 1, width: 4, height: 2 };
const root = new URL("../", import.meta.url);

test("shape drum mappings cover contour, corner, tangent, position, playhead, and incidence", () => {
  assert.equal(SHAPE_DRUM_MAPPING_MODES.length, 3);
  assert.equal(shapeDrumVoiceIndex({
    cornerIndex: 2,
    u: .4,
    tangentAngle: Math.PI * 1.4,
  }), 10);
  assert.equal(shapeDrumVoiceIndex(
    { x: -1.9, y: .9 },
    { mode: "position-grid", bounds },
  ), 0);
  assert.equal(shapeDrumVoiceIndex(
    { headIndex: 3, incidence: .8 },
    { mode: "incidence-playhead", bounds },
  ), 15);
});

test("contact normalization and shape drum modulation remain bounded", () => {
  assert.deepEqual(normalizedShapeContact({ x: 0, y: 0 }, bounds), { x: .5, y: .5 });
  const voice = mappedShapeDrumVoice(
    { frequency: 100, tone: .2, modIndex: 8, level: .8 },
    { x: 0, y: -1, cornerStrength: 1, incidence: 1 },
    { bounds, pitchDepth: 12, characterDepth: 1, contactCount: 16 },
  );
  assert.equal(voice.frequency, 200);
  assert.equal(voice.tone, 1);
  assert.ok(voice.modIndex > 8);
  assert.ok(voice.level > 0 && voice.level <= .4);
});

test("bell voices become shorter and quieter shape percussion", () => {
  const bell = DEFAULT_FM_DRUM_VOICES.find(({ id }) => id === "soft-chime");
  const voice = mappedShapeDrumVoice(
    bell,
    { x: 0, y: 0, cornerStrength: 1, incidence: 0 },
    { bounds, pitchDepth: 0, characterDepth: 0, contactCount: 1 },
  );
  assert.equal(voice.attack, .006);
  assert.equal(voice.decay, .58);
  assert.ok(voice.modIndex < bell.modIndex);
  assert.ok(voice.level < bell.level);
  assert.equal(bell.decay, 1.8);
});

test("real shape contacts resolve to playable FM drum voices", () => {
  const path = buildShape({
    sides: 7,
    shapeType: "star",
    starDepth: .42,
    curvature: -.2,
    aspect: .3,
    skew: -.15,
  });
  const contacts = [
    pointAtPath(path, .37),
    ...verticalIntersections(path, 0),
  ];
  assert.ok(contacts.length > 1);
  for (const contact of contacts) {
    const index = shapeDrumVoiceIndex(contact, {
      mode: "contour-corner",
      bounds: path.bounds,
    });
    assert.ok(index >= 0 && index < DEFAULT_FM_DRUM_VOICES.length);
    const voice = mappedShapeDrumVoice(DEFAULT_FM_DRUM_VOICES[index], contact, {
      bounds: path.bounds,
      contactCount: contacts.length,
    });
    assert.ok(voice.frequency >= 20 && voice.frequency <= 12_000);
    assert.ok(voice.level >= 0 && voice.level <= 1);
  }
});

test("Shape Drum Machine keeps Shape controls and the compact shared FM drum bank", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("shape-drums.html", root), "utf8"),
    readFile(new URL("shape-drums.css", root), "utf8"),
    readFile(new URL("shape-drums-app.js", root), "utf8"),
  ]);
  assert.match(html, /Shape Drum Machine/);
  assert.match(html, /id="stage"/);
  assert.doesNotMatch(html, /class="[^"]*(?:shape-drums-heading|instrument-heading)/);
  assert.doesNotMatch(css, /\.shape-drums-heading/);
  assert.match(html, /id="playMethod"/);
  assert.match(html, /id="headLayoutTrack"/);
  assert.match(html, /id="rotationMotion"/);
  assert.match(html, /id="formSection" data-section="form"/);
  assert.match(html, /id="closedShapeType"/);
  assert.match(html, /id="curvature"/);
  assert.match(html, /id="aspect"/);
  assert.match(html, /id="skew"/);
  assert.match(html, /id="drumMap"/);
  assert.match(html, /src="shape-drums-app\.js"/);
  assert.doesNotMatch(html, /data-section="(?:sound|pitch)"|soundMode|synth-panel|voiceEditor/);
  assert.doesNotMatch(
    html,
    /id="(?:playSection|formSection)"[^>]*\sopen(?:\s|>)/,
    "Shape control sections should follow the collapsed page convention",
  );
  assert.match(css, /\.shape-drum-map[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(app, /FM_DRUM_STORAGE_KEY/);
  assert.match(app, /FmDrumAudio/);
  assert.match(app, /buildShape/);
  assert.match(app, /horizontalIntersections/);
  assert.match(app, /verticalIntersections/);
  assert.match(app, /rayIntersections/);
  assert.match(app, /mappedShapeDrumVoice/);
  assert.match(app, /voice\.key === key/);
});
