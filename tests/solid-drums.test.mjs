import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEFAULT_FM_DRUM_VOICES } from "../src/fm-drums.js";
import {
  SOLID_DRUM_MAPPING_MODES,
  mappedSolidDrumVoice,
  normalizedSolidContact,
  solidDrumBounds,
  solidDrumContactKey,
  solidDrumContacts,
  solidDrumVoiceIndex,
} from "../src/solid-drums.js";
import {
  buildSolid,
  deformSolid,
  planeIntersections,
  planeNormal,
  rotatePoint3,
} from "../src/solid.js";

const fixedBounds = {
  minX: -1,
  minY: -1,
  minZ: -1,
  maxX: 1,
  maxY: 1,
  maxZ: 1,
};

test("solid drum mappings cover edge/axis, 3D position, incidence, and depth", () => {
  assert.deepEqual(
    SOLID_DRUM_MAPPING_MODES.map(({ id }) => id),
    ["edge-axis", "position-grid", "incidence-depth"],
  );
  assert.equal(solidDrumVoiceIndex(
    { edgeIndex: 6, axisIndex: 2 },
    { mode: "edge-axis", bounds: fixedBounds },
  ), 10);
  assert.equal(solidDrumVoiceIndex(
    { x: -1, y: 1 },
    { mode: "position-grid", bounds: fixedBounds },
  ), 0);
  assert.equal(solidDrumVoiceIndex(
    { z: 1, incidence: 1 },
    { mode: "incidence-depth", bounds: fixedBounds },
  ), 15);
});

test("solid contacts expose stable edge-segment keys, axis, and plane incidence", () => {
  const cube = buildSolid("cube");
  const normal = planeNormal(0, 0);
  const rawContacts = planeIntersections(cube, normal, 0);
  const contacts = solidDrumContacts(rawContacts, cube, normal);
  const reversed = solidDrumContacts([...rawContacts].reverse(), cube, normal);
  assert.equal(contacts.length, 4);
  assert.ok(contacts.every(({ axisIndex }) => axisIndex === 0));
  assert.ok(contacts.every(({ incidence }) => Math.abs(incidence - 1) < 1e-12));
  assert.equal(new Set(contacts.map(({ voiceKey }) => voiceKey)).size, contacts.length);
  assert.deepEqual(
    new Set(contacts.map(({ voiceKey }) => voiceKey)),
    new Set(reversed.map(({ voiceKey }) => voiceKey)),
  );
  assert.equal(solidDrumContactKey({ edgeIndex: 3, t: 0 }), "edge:3:segment:0");
  assert.equal(solidDrumContactKey({ edgeIndex: 3, t: 0.5 }), "edge:3:segment:2");
  assert.equal(solidDrumContactKey({ edgeIndex: 3, t: 1 }), "edge:3:segment:3");
});

test("solid contact normalization and tuning remain bounded without mutating presets", () => {
  const baseVoice = {
    frequency: 100,
    attack: 0.002,
    decay: 0.4,
    tone: 0.2,
    modIndex: 8,
    level: 0.8,
  };
  const original = { ...baseVoice };
  const high = mappedSolidDrumVoice(
    baseVoice,
    { x: 0, y: 1, z: 0, incidence: 1 },
    {
      bounds: fixedBounds,
      pitchDepth: 12,
      characterDepth: 1,
      contactCount: 16,
    },
  );
  const low = mappedSolidDrumVoice(
    baseVoice,
    { x: 0, y: -1, z: 0, incidence: 0 },
    { bounds: fixedBounds, pitchDepth: 12, characterDepth: 0 },
  );
  assert.deepEqual(baseVoice, original);
  assert.equal(high.frequency, 200);
  assert.equal(high.tone, 1);
  assert.ok(high.modIndex > baseVoice.modIndex);
  assert.equal(high.level, 0.4);
  assert.equal(low.frequency, 50);
  for (const voice of [high, low]) {
    assert.ok(voice.frequency >= 20 && voice.frequency <= 12_000);
    assert.ok(voice.tone >= 0 && voice.tone <= 1);
    assert.ok(voice.modIndex >= 0 && voice.modIndex <= 20);
    assert.ok(voice.level >= 0 && voice.level <= 1);
  }
  assert.deepEqual(normalizedSolidContact(
    { x: 4, y: -4, z: 0, t: 2, incidence: -1, axisIndex: 9 },
    fixedBounds,
  ), {
    x: 1,
    y: 0,
    z: 0.5,
    t: 1,
    incidence: 0,
    axisIndex: 3,
  });
});

test("bell voices become shorter and quieter Solid percussion", () => {
  const bell = DEFAULT_FM_DRUM_VOICES.find(({ id }) => id === "bronze-gong");
  const voice = mappedSolidDrumVoice(
    bell,
    { x: 0, y: 0, z: 0, incidence: 1 },
    {
      bounds: fixedBounds,
      pitchDepth: 0,
      characterDepth: 0,
      contactCount: 1,
    },
  );
  assert.equal(voice.attack, 0.006);
  assert.equal(voice.decay, 0.58);
  assert.ok(voice.modIndex < bell.modIndex);
  assert.ok(voice.level < bell.level);
  assert.equal(bell.decay, 2.35);
});

test("every Solid form resolves all drum mappings to the shared sixteen-voice bank", () => {
  for (const type of [
    "cube", "pyramid", "octahedron", "prism", "cone", "cylinder", "sphere", "torus",
  ]) {
    const source = deformSolid(buildSolid(type), {
      scaleX: 1.2,
      scaleY: 0.8,
      scaleZ: 1.1,
      skewX: 0.15,
      skewZ: -0.1,
    });
    const solid = {
      ...source,
      vertices: source.vertices.map((point) => rotatePoint3(point, {
        x: -24,
        y: 36,
        z: 8,
      })),
    };
    const normal = planeNormal(45, -22);
    const contacts = solidDrumContacts(
      planeIntersections(solid, normal, 0),
      solid,
      normal,
    );
    assert.ok(contacts.length > 0, `${type} should intersect its center plane`);
    const bounds = solidDrumBounds(solid);
    for (const mapping of SOLID_DRUM_MAPPING_MODES) {
      for (const contact of contacts) {
        const index = solidDrumVoiceIndex(contact, {
          mode: mapping.id,
          bounds,
        });
        assert.ok(Number.isInteger(index));
        assert.ok(index >= 0 && index < DEFAULT_FM_DRUM_VOICES.length);
      }
    }
  }
});

test("Solid Drum Machine keeps Solid controls and excludes legacy synth panels", async () => {
  const root = new URL("../", import.meta.url);
  const [html, css, app] = await Promise.all([
    readFile(new URL("solid-drums.html", root), "utf8"),
    readFile(new URL("solid-drums.css", root), "utf8"),
    readFile(new URL("solid-drums-app.js", root), "utf8"),
  ]);
  for (const id of [
    "stage",
    "selectSolid",
    "selectSurface",
    "position",
    "speed",
    "directionButton",
    "planeYaw",
    "planePitch",
    "planeYawPlay",
    "planePitchPlay",
    "solidType",
    "formScaleX",
    "formScaleY",
    "formScaleZ",
    "formSkewX",
    "formSkewZ",
    "rotationX",
    "rotationY",
    "rotationZ",
    "rotationXPlay",
    "rotationYPlay",
    "rotationZPlay",
    "mappingMode",
    "drumMap",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.doesNotMatch(html, /<h1|subtitle|solid-drums-heading/);
  assert.doesNotMatch(html, /data-section="mapping" open/);
  assert.match(html, /src="solid-drums-app\.js"/);
  assert.match(css, /\.solid-drum-map[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(app, /FM_DRUM_STORAGE_KEY/);
  assert.match(app, /FmDrumAudio/);
  assert.match(app, /solidDrumContacts/);
  assert.match(app, /mappedSolidDrumVoice/);
  assert.match(app, /pickRotationTarget/);
  assert.doesNotMatch(
    html,
    /soundMode|amplitudeControl|percussionArticulation|fmControls|baseFrequency|pitchRange/,
  );
  assert.doesNotMatch(
    app,
    /VoicePool|createAmplitudeControl|synthParametersForMode|pitch01ToFrequency/,
  );
  assert.match(
    html,
    /<\/details>\s*<div class="reset-all-row">[\s\S]*?<\/div>\s*<p class="audio-error" id="audioError"/,
  );
});
