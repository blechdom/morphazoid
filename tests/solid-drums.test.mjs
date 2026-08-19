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
  solidDrumProjectedPosition,
  solidDrumSubdivisionCount,
  solidDrumSubdivisionMarkers,
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
  assert.ok(contacts.every(({ segmentIndex }) => segmentIndex === 0));
  assert.ok(contacts.every(({ segmentCount }) => segmentCount === 1));
  assert.equal(new Set(contacts.map(({ voiceKey }) => voiceKey)).size, contacts.length);
  assert.deepEqual(
    new Set(contacts.map(({ voiceKey }) => voiceKey)),
    new Set(reversed.map(({ voiceKey }) => voiceKey)),
  );
  assert.equal(solidDrumContactKey({ edgeIndex: 3, t: 0 }), "edge:3:segment:0");
  assert.equal(solidDrumContactKey({ edgeIndex: 3, t: 0.5 }), "edge:3:segment:0");
  assert.equal(solidDrumContactKey({ edgeIndex: 3, t: 1 }), "edge:3:segment:0");
  assert.equal(solidDrumContactKey({ edgeIndex: 3, t: 0.5 }, 4), "edge:3:segment:2");
  assert.equal(solidDrumContactKey({ edgeIndex: 3, t: 1 }, 4), "edge:3:segment:3");
  assert.equal(
    solidDrumContactKey({ edgeIndex: 3, t: 0.1, segmentPosition: 0.74 }, 4),
    "edge:3:segment:2",
  );
});

test("Solid side subdivisions are bounded, projected evenly, and carried by contacts", () => {
  assert.equal(solidDrumSubdivisionCount(undefined), 1);
  assert.equal(solidDrumSubdivisionCount(0), 1);
  assert.equal(solidDrumSubdivisionCount(3.9), 3);
  assert.equal(solidDrumSubdivisionCount(40), 16);
  assert.deepEqual(solidDrumSubdivisionMarkers(1), []);
  assert.deepEqual(solidDrumSubdivisionMarkers(4), [0.25, 0.5, 0.75]);
  assert.equal(solidDrumSubdivisionMarkers(16).length, 15);
  assert.equal(
    solidDrumProjectedPosition(
      { x: 35, y: 12 },
      { x: 10, y: 12 },
      { x: 110, y: 12 },
    ),
    0.25,
  );

  const cube = buildSolid("cube");
  const normal = planeNormal(0, 0);
  const contacts = solidDrumContacts(
    planeIntersections(cube, normal, 0),
    cube,
    normal,
    4,
  );
  assert.ok(contacts.every(({ segmentPosition }) => segmentPosition === 0.5));
  assert.ok(contacts.every(({ segmentIndex }) => segmentIndex === 2));
  assert.ok(contacts.every(({ segmentCount }) => segmentCount === 4));
  assert.ok(contacts.every(({ voiceKey }) => voiceKey.endsWith(":segment:2")));
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
    "playheadMotion",
    "traversalDirection",
    "loopMotion",
    "pingPongMotion",
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
    "subdivisions",
    "mappingMode",
    "drumMap",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.doesNotMatch(html, /<h1|subtitle|solid-drums-heading/);
  assert.doesNotMatch(html, /data-section="mapping" open/);
  assert.match(html, /src="solid-drums-app\.js"/);
  assert.match(
    html,
    /<b>Subdivisions \/ side<\/b>[\s\S]*?id="subdivisions"[\s\S]*?min="1"[\s\S]*?max="16"[\s\S]*?step="1"[\s\S]*?value="2"/,
  );
  assert.ok(
    html.indexOf('id="speed"') < html.indexOf('id="playheadMotion"')
      && html.indexOf('id="playheadMotion"') < html.indexOf('id="subdivisions"'),
    "The Shape-style transport should sit with surface speed before subdivisions",
  );
  assert.ok(
    html.indexOf('id="subdivisions"') < html.indexOf('data-section="form"'),
    "Subdivisions should not remain in Drum Mapping",
  );
  assert.match(html, /moving surface reader crossing[\s\S]*?projected solid side \(edge\)/);
  assert.match(html, /id="mappingMode" aria-describedby="mappingDescription solidMappingSourceText"/);
  assert.match(html, /id="solidMappingSourceText"/);
  assert.match(css, /\.solid-drum-map[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(css, /\.solid-trigger-source/);
  assert.match(css, /\.solid-mapping-source/);
  assert.match(app, /FM_DRUM_STORAGE_KEY/);
  assert.match(app, /FmDrumAudio/);
  assert.match(app, /solidDrumContacts/);
  assert.match(app, /solidDrumProjectedPosition/);
  assert.match(app, /drawEdgeSubdivisionMarkers/);
  assert.match(app, /SEGMENT \$\{\(contact\.segmentIndex/);
  assert.match(app, /mappedSolidDrumVoice/);
  assert.match(app, /pickRotationTarget/);
  const endpointHelper = app.match(/function endpointSafePhase\(value\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(endpointHelper, /phase >= 1 \? 1 - 1e-9 : phase/);
  assert.doesNotMatch(endpointHelper, /motionMode/);
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
