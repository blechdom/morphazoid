import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_FM_DRUM_VOICES } from "../src/fm-drums.js";
import {
  SPIRAL_DRUM_MAPPING_MODES,
  mappedSpiralDrumVoice,
  normalizedSpiralContact,
  spiralDrumVoiceIndex,
} from "../src/spiral-drums.js";
import {
  buildSpiralTessellation,
  contactsForSpiralReader,
  createSpiralReader,
} from "../src/spiral.js";

const bounds = { innerRadius: 0.05, outerRadius: 1 };
const root = new URL("../", import.meta.url);

test("spiral mapping modes cover scale, angle, shape, reader path, and incidence", () => {
  assert.deepEqual(
    SPIRAL_DRUM_MAPPING_MODES.map(({ id }) => id),
    ["radius-angle", "shape-angle", "reader-incidence"],
  );
  assert.equal(spiralDrumVoiceIndex(
    { radius: 1, angle01: 0.1 },
    { mode: "radius-angle", bounds },
  ), 0);
  assert.equal(spiralDrumVoiceIndex(
    { radius: 0.05, angle01: 0.99 },
    { mode: "radius-angle", bounds },
  ), 15);
  assert.equal(spiralDrumVoiceIndex(
    { edgeShapeId: 2, aspect: 1, edgeIndex: 0, angle01: 0.7 },
    { mode: "shape-angle", bounds },
  ), 14);
  assert.equal(spiralDrumVoiceIndex(
    { along01: 0.8, incidence: 0.3 },
    { mode: "reader-incidence", bounds },
  ), 13);
});

test("spiral contact normalization follows logarithmic radius and stays bounded", () => {
  const middle = Math.sqrt(bounds.innerRadius * bounds.outerRadius);
  const normalized = normalizedSpiralContact({
    radius: middle,
    angle01: 1.25,
    along01: -1,
    incidence: 2,
    orientation: 0.4,
  }, bounds);
  assert.ok(Math.abs(normalized.radius01 - 0.5) < 1e-12);
  assert.ok(Math.abs(normalized.angle01 - 0.25) < 1e-12);
  assert.equal(normalized.along01, 0);
  assert.equal(normalized.incidence, 1);
  assert.equal(normalized.orientation, 0.4);

  const fromPoint = normalizedSpiralContact({ x: 0, y: 1 }, bounds);
  assert.equal(fromPoint.radius, 1);
  assert.equal(fromPoint.radius01, 1);
  assert.equal(fromPoint.angle01, 0.75);
});

test("radial pitch, incidence character, and polyphonic headroom remain bounded", () => {
  const baseVoice = {
    frequency: 100,
    tone: 0.2,
    modIndex: 8,
    level: 0.8,
  };
  const original = { ...baseVoice };
  const inner = mappedSpiralDrumVoice(
    baseVoice,
    { radius: bounds.innerRadius, incidence: 1 },
    {
      bounds,
      pitchDepth: 12,
      characterDepth: 1,
      contactCount: 16,
    },
  );
  const outer = mappedSpiralDrumVoice(
    baseVoice,
    { radius: bounds.outerRadius, incidence: 0 },
    { bounds, pitchDepth: 12, characterDepth: 0 },
  );
  assert.deepEqual(baseVoice, original);
  assert.equal(inner.frequency, 200);
  assert.equal(inner.tone, 1);
  assert.ok(inner.modIndex > baseVoice.modIndex);
  assert.equal(inner.level, 0.4);
  assert.equal(outer.frequency, 50);
  assert.ok(outer.tone >= 0 && outer.tone <= 1);
  assert.ok(outer.modIndex >= 0 && outer.modIndex <= 20);
  assert.ok(outer.level >= 0 && outer.level <= 1);
});

test("every intrinsic Spiral reader resolves contacts through every drum mapping", () => {
  const tessellation = buildSpiralTessellation({
    type: 20,
    spiralA: 1,
    spiralB: 5,
  });
  for (const readerMode of ["radius", "angle", "spiral"]) {
    const reader = createSpiralReader({
      ...tessellation.bounds,
      mode: readerMode,
      phase: 0.37,
      turns: 2,
    });
    const contacts = contactsForSpiralReader(tessellation, reader);
    assert.ok(contacts.length > 0, `${readerMode} reader should produce contacts`);
    for (const mapping of SPIRAL_DRUM_MAPPING_MODES) {
      for (const contact of contacts) {
        const index = spiralDrumVoiceIndex(contact, {
          mode: mapping.id,
          bounds: tessellation.bounds,
        });
        assert.ok(Number.isInteger(index));
        assert.ok(index >= 0 && index < DEFAULT_FM_DRUM_VOICES.length);
        const voice = mappedSpiralDrumVoice(
          DEFAULT_FM_DRUM_VOICES[index],
          contact,
          {
            bounds: tessellation.bounds,
            pitchDepth: 12,
            characterDepth: 0.7,
            contactCount: contacts.length,
          },
        );
        assert.ok(voice.frequency >= 20 && voice.frequency <= 12_000);
        assert.ok(voice.tone >= 0 && voice.tone <= 1);
        assert.ok(voice.modIndex >= 0 && voice.modIndex <= 20);
        assert.ok(voice.level >= 0 && voice.level <= 1);
      }
    }
  }
});

test("Spiral Drum Machine keeps the full geometry UI and excludes legacy sound panels", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("spiral-drums.html", root), "utf8"),
    readFile(new URL("spiral-drums.css", root), "utf8"),
    readFile(new URL("spiral-drums-app.js", root), "utf8"),
  ]);
  for (const id of [
    "stage",
    "radiusTime",
    "angleTime",
    "spiralTime",
    "loopPhase",
    "tileEditorCanvas",
    "parameter5",
    "edgeCurve4",
    "straightenEdges",
    "spiralA",
    "spiralB",
    "patternScale",
    "patternRotation",
    "mappingMode",
    "drumMap",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.match(html, /src="spiral-drums-app\.js"/);
  assert.match(css, /\.spiral-drum-map[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(app, /buildSpiralTessellation/);
  assert.match(app, /contactsForSpiralReader/);
  assert.match(app, /mappedSpiralDrumVoice/);
  assert.match(app, /parametersForDraggedVertex/);
  assert.match(app, /constrainPrototileEdit/);
  assert.doesNotMatch(
    html,
    /soundMode|amplitudeControl|percussionArticulation|pitchSource|voiceCap/,
  );
  assert.doesNotMatch(
    app,
    /VoicePool|createAmplitudeControl|synthParametersForMode|pitch01ToFrequency/,
  );
});
