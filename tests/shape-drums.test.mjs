import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEFAULT_FM_DRUM_VOICES } from "../src/fm-drums.js";
import {
  buildShape,
  pingPong01,
  pointAtPath,
  verticalIntersections,
} from "../src/geometry.js";
import {
  limitShapeDrumHits,
  mappedShapeDrumVoice,
  normalizedShapeContact,
  reversedShapeHeadState,
  sanitizeShapeSideSubdivisions,
  SHAPE_DRUM_MAPPING_MODES,
  shapeDrumEventToken,
  shapeRotationTravelForAngle,
  shapeDrumVoiceIndex,
  shapeSideSubdivision,
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

test("Shape motion helpers preserve ping-pong angle and head position", () => {
  assert.equal(shapeRotationTravelForAngle(30, "pingpong"), 7 / 12);
  const displayedAngle = pingPong01(
    shapeRotationTravelForAngle(30, "pingpong"),
  ) * 360 - 180;
  assert.ok(Math.abs(displayedAngle - 30) < 1e-12);
  const before = 0.7 + 0.25;
  const reversed = reversedShapeHeadState({
    position: 0.7,
    direction: 1,
    offset: 0.25,
  });
  const after = reversed.direction * 0.7 + 0.25 + reversed.adjustment;
  assert.ok(Math.abs(after - before) < 1e-12);
});

test("polygon sides divide into actual side regions starting at one per side", () => {
  const path = buildShape({
    sides: 4,
    shapeType: "polygon",
    curvature: 0,
    samplesPerEdge: 48,
  });
  const sideStart = path.vertexDistances[1];
  const sideEnd = path.vertexDistances[2];
  const contactAt = (amount) => pointAtPath(
    path,
    (sideStart + (sideEnd - sideStart) * amount) / path.totalLength,
  );
  assert.equal(sanitizeShapeSideSubdivisions(-4), 1);
  assert.equal(sanitizeShapeSideSubdivisions(20), 16);
  const firstSubdivision = shapeSideSubdivision(contactAt(.1), path, 4);
  assert.equal(firstSubdivision.sideIndex, 1);
  assert.equal(firstSubdivision.sideCount, 4);
  assert.equal(firstSubdivision.subdivisionIndex, 0);
  assert.equal(firstSubdivision.subdivisions, 4);
  assert.equal(firstSubdivision.globalIndex, 4);
  assert.ok(Math.abs(firstSubdivision.local - .1) < 1e-12);
  assert.equal(shapeSideSubdivision(contactAt(.26), path, 4).subdivisionIndex, 1);
  assert.equal(shapeSideSubdivision(contactAt(.99), path, 4).subdivisionIndex, 3);

  const contact = contactAt(.74);
  assert.equal(Math.floor(shapeDrumVoiceIndex(contact, {
    path,
    sideSubdivisions: 1,
  }) / 4), 1);
  assert.equal(Math.floor(shapeDrumVoiceIndex(contact, {
    path,
    sideSubdivisions: 4,
  }) / 4), 2);
  const circle = buildShape({ sides: 1, shapeType: "circle" });
  assert.equal(shapeSideSubdivision(pointAtPath(circle, .25), circle, 4), null);
});

test("polygon event tokens depend only on side subdivision while circles retain phase and voice", () => {
  const path = buildShape({
    sides: 4,
    shapeType: "polygon",
    curvature: 0,
    samplesPerEdge: 48,
  });
  const start = path.vertexDistances[1];
  const end = path.vertexDistances[2];
  const contactAt = (amount) => pointAtPath(
    path,
    (start + (end - start) * amount) / path.totalLength,
  );
  assert.equal(
    shapeDrumEventToken(contactAt(.1), path, 1, 0),
    shapeDrumEventToken(contactAt(.9), path, 1, 15),
  );
  assert.notEqual(
    shapeDrumEventToken(contactAt(.1), path, 4, 0),
    shapeDrumEventToken(contactAt(.3), path, 4, 0),
  );

  const circle = buildShape({ sides: 1, shapeType: "circle" });
  const circleContact = pointAtPath(circle, .25);
  assert.notEqual(
    shapeDrumEventToken(circleContact, circle, 1, 2),
    shapeDrumEventToken(circleContact, circle, 1, 3),
  );
});

test("Shape simultaneous-hit cap returns no more than the configured frame limit", () => {
  const candidates = Array.from({ length: 16 }, (_, index) => ({ index }));
  assert.deepEqual(limitShapeDrumHits(candidates, 3), candidates.slice(0, 3));
  assert.equal(limitShapeDrumHits(candidates, 0).length, 1);
  assert.equal(limitShapeDrumHits(candidates, 99).length, 16);
  assert.deepEqual(candidates.map(({ index }) => index), [...Array(16).keys()]);
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
  assert.match(
    html,
    /id="sideSubdivisions"[\s\S]*min="1"[\s\S]*max="16"[\s\S]*value="2"/,
  );
  assert.match(html, />Subdivisions \/ side</);
  assert.ok(
    html.indexOf('id="speed"') < html.indexOf('id="sideSubdivisions"')
      && html.indexOf('id="sideSubdivisions"') < html.indexOf('id="playMethod"'),
    "Subdivisions should sit directly after playhead speed in Play",
  );
  assert.ok(
    html.indexOf('id="sideSubdivisions"') < html.indexOf('id="mappingSection"'),
    "Subdivisions should not remain in Drum mapping",
  );
  assert.match(html, /id="mappingMode" aria-describedby="mappingDescription mappingOrigin"/);
  assert.match(html, /id="mappingOrigin"/);
  assert.match(html, /id="mappingLegendSource0"/);
  assert.match(html, /id="hitCapStatus"/);
  assert.match(html, />Simultaneous hit cap</);
  assert.doesNotMatch(html, /id="hitCapStatus"[^>]*aria-live/);
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
  assert.match(app, /shapeRotationTravelForAngle/);
  assert.match(app, /reversedShapeHeadState/);
  assert.match(app, /shapeSideSubdivision/);
  assert.match(app, /shapeDrumEventToken\(/);
  assert.match(app, /start marker/);
  assert.doesNotMatch(app, /fillText\(\s*["']1["']/);
  assert.match(app, /limitShapeDrumHits\(candidates, state\.strikeLimit\)/);
  assert.match(app, /subdivision < state\.sideSubdivisions/);
  assert.doesNotMatch(app, /held by the/);
  assert.match(app, /voice\.key === key/);
});
