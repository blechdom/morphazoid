import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEFAULT_FM_DRUM_VOICES } from "../src/fm-drums.js";
import {
  HYPER_DRUM_MAPPING_MODES,
  hyperContactVoiceKey,
  hyperDrumVoiceIndex,
  mappedHyperDrumVoice,
  normalizedHyperContact,
} from "../src/hyper-drums.js";
import {
  hyperplaneIntersections,
  transformedHyperShape,
} from "../src/hyper.js";

const root = new URL("../", import.meta.url);
const bounds = {
  minX: -2,
  minY: -1,
  minDepth: -1,
  minW: -1,
  maxX: 2,
  maxY: 1,
  maxDepth: 1,
  maxW: 1,
};

test("Hyper drum mappings cover edge axes, projection, W depth, and incidence", () => {
  assert.deepEqual(
    HYPER_DRUM_MAPPING_MODES.map(({ id }) => id),
    ["axis-depth", "projected-position", "w-incidence"],
  );
  assert.equal(hyperDrumVoiceIndex(
    { axis: "z", projectedDepth: 0.75 },
    { mode: "axis-depth", bounds },
  ), 11);
  assert.equal(hyperDrumVoiceIndex(
    { projectedX: -1.9, projectedY: 0.9 },
    { mode: "projected-position", bounds },
  ), 0);
  assert.equal(hyperDrumVoiceIndex(
    { w: -0.8, incidence: 0.8 },
    { mode: "w-incidence", bounds },
  ), 15);
  assert.equal(hyperDrumVoiceIndex(
    { axis: "u", projectedDepth: -0.75 },
    { mode: "axis-depth", bounds },
  ), 0);
  assert.equal(hyperDrumVoiceIndex(
    { axis: "v", projectedDepth: -0.75 },
    { mode: "axis-depth", bounds },
  ), 4);
});

test("Hyper edge contacts advance through four deduplicated rhythm segments", () => {
  assert.equal(hyperContactVoiceKey({ edgeIndex: 7, t: 0 }), "hyper:7:0");
  assert.equal(hyperContactVoiceKey({ edgeIndex: 7, t: 0.249 }), "hyper:7:0");
  assert.equal(hyperContactVoiceKey({ edgeIndex: 7, t: 0.25 }), "hyper:7:1");
  assert.equal(hyperContactVoiceKey({ edgeIndex: 7, t: 0.75 }), "hyper:7:3");
  assert.equal(hyperContactVoiceKey({ edgeIndex: 7, t: 1 }), "hyper:7:3");
});

test("Hyper contact normalization and FM modulation remain finite and bounded", () => {
  assert.deepEqual(
    normalizedHyperContact({
      projectedX: 0,
      projectedY: 0,
      projectedDepth: 0,
      w: 0,
      incidence: 2,
      t: -1,
    }, bounds),
    { x: 0.5, y: 0.5, depth: 0.5, w: 0.5, incidence: 1, along: 0 },
  );
  const baseVoice = {
    frequency: 100,
    tone: 0.2,
    modIndex: 8,
    level: 0.8,
  };
  const original = { ...baseVoice };
  const mapped = mappedHyperDrumVoice(
    baseVoice,
    { projectedY: 1, incidence: 1 },
    { bounds, pitchDepth: 12, characterDepth: 1, contactCount: 16 },
  );
  assert.deepEqual(baseVoice, original);
  assert.equal(mapped.frequency, 200);
  assert.equal(mapped.tone, 1);
  assert.ok(mapped.modIndex > baseVoice.modIndex);
  assert.ok(mapped.level > 0 && mapped.level <= 0.4);
});

test("Hyper bell voices use shorter and quieter geometry articulation", () => {
  const bell = DEFAULT_FM_DRUM_VOICES.find(({ id }) => id === "bronze-gong");
  const mapped = mappedHyperDrumVoice(
    bell,
    { projectedY: 0, incidence: 1 },
    { bounds, pitchDepth: 0, characterDepth: 0, contactCount: 1 },
  );
  assert.equal(mapped.attack, 0.006);
  assert.equal(mapped.decay, 0.58);
  assert.ok(mapped.modIndex < bell.modIndex);
  assert.ok(mapped.level < bell.level);
  assert.equal(bell.decay, 2.35);
});

test("real 4D hyperplane contacts resolve through every mapping mode", () => {
  const shape = transformedHyperShape(
    "tesseract",
    { xw: 24, yw: -18, zw: 12, xy: 16, yz: -9 },
    { x: 1, y: 1, z: 1, w: 1 },
  );
  const contacts = hyperplaneIntersections(shape, 0).map((contact) => {
    const edge = shape.edges[contact.edgeIndex];
    const a = shape.vertices[edge.a];
    const b = shape.vertices[edge.b];
    return {
      ...contact,
      projectedX: contact.x,
      projectedY: contact.y,
      projectedDepth: contact.z,
      incidence: Math.abs(b.w - a.w) / Math.hypot(
        b.x - a.x,
        b.y - a.y,
        b.z - a.z,
        b.w - a.w,
      ),
    };
  });
  assert.ok(contacts.length >= 4);
  for (const mode of HYPER_DRUM_MAPPING_MODES) {
    for (const contact of contacts) {
      const index = hyperDrumVoiceIndex(contact, { mode: mode.id, bounds });
      assert.ok(Number.isInteger(index));
      assert.ok(index >= 0 && index < DEFAULT_FM_DRUM_VOICES.length);
      const voice = mappedHyperDrumVoice(
        DEFAULT_FM_DRUM_VOICES[index],
        contact,
        { bounds, contactCount: contacts.length },
      );
      assert.ok(voice.frequency >= 20 && voice.frequency <= 12_000);
      assert.ok(voice.modIndex >= 0 && voice.modIndex <= 20);
      assert.ok(voice.level >= 0 && voice.level <= 1);
    }
  }
});

test("Hyper Drum Machine keeps the complete 4D UI and excludes legacy synth panels", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("hyper-drums.html", root), "utf8"),
    readFile(new URL("hyper-drums.css", root), "utf8"),
    readFile(new URL("hyper-drums-app.js", root), "utf8"),
  ]);
  for (const id of [
    "stage",
    "playButton",
    "position",
    "speed",
    "directionButton",
    "hyperShape",
    "hyperScaleX",
    "hyperScaleY",
    "hyperScaleZ",
    "hyperScaleW",
    "rotationXW",
    "rotationYW",
    "rotationZW",
    "rotationXWPlay",
    "rotationYWPlay",
    "rotationZWPlay",
    "rotationXWSpeed",
    "rotationYWSpeed",
    "rotationZWSpeed",
    "mappingMode",
    "drumMap",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /src="hyper-drums-app\.js"/);
  assert.doesNotMatch(html, /id="hyperDrumsTitle"|class="hyper-drums-heading"/);
  assert.doesNotMatch(
    html,
    /soundMode|amplitudeControl|baseFrequency|pitchRange|fmControls|percussionArticulation/,
  );
  assert.match(css, /\.hyper-drum-map[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(app, /FM_DRUM_STORAGE_KEY/);
  assert.match(app, /new FmDrumAudio\(globalThis\)/);
  assert.match(app, /hyperplaneIntersections/);
  assert.match(app, /hyperContactVoiceKey\(contact\)/);
  assert.match(app, /!previousContactKeys\.has\(voiceKey\)/);
  assert.match(app, /now - lastStrike < 75/);
  assert.match(app, /mappedHyperDrumVoice/);
});
