import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_FM_DRUM_VOICES } from "../src/fm-drums.js";
import {
  TILING_TYPES,
  buildLattice,
  contactsForLine,
  createScanLine,
  latticeOffsetForPhase,
} from "../src/lattice.js";
import {
  LATTICE_DRUM_MAPPING_MODES,
  latticeColorPairVoiceIndex,
  latticeDrumVoiceIndex,
  mappedLatticeDrumVoice,
  normalizedLatticeContact,
} from "../src/lattice-drums.js";

const bounds = { minX: -2, minY: -1, maxX: 2, maxY: 1 };
const root = new URL("../", import.meta.url);

test("lattice drum mappings cover geometry, density, and touching tile colors", () => {
  assert.deepEqual(
    LATTICE_DRUM_MAPPING_MODES.map(({ id }) => id),
    ["edge-angle", "position-grid", "incidence-density", "tile-color-pair"],
  );
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

test("touching tile colors map to fifteen unordered voices plus a junction", () => {
  const expectedPairs = [
    [0, 0], [0, 1], [1, 1], [0, 2], [1, 2],
    [2, 2], [0, 3], [1, 3], [2, 3], [3, 3],
    [0, 4], [1, 4], [2, 4], [3, 4], [4, 4],
  ];
  expectedPairs.forEach((pair, index) => {
    const contact = { adjacentTiles: pair.map((color) => ({ color })) };
    const reversed = { adjacentTiles: [...contact.adjacentTiles].reverse() };
    assert.equal(latticeColorPairVoiceIndex(contact), index);
    assert.equal(latticeColorPairVoiceIndex(reversed), index);
    assert.equal(
      latticeDrumVoiceIndex(contact, { mode: "tile-color-pair" }),
      index,
    );
  });
  assert.equal(latticeColorPairVoiceIndex({ adjacentTiles: [] }), 15);
  assert.equal(latticeColorPairVoiceIndex({ adjacentTiles: [{ color: 2 }] }), 15);
  assert.equal(latticeColorPairVoiceIndex({
    isVertexContact: true,
    adjacentTiles: [{ color: 0 }, { color: 1 }],
  }), 15);
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
  for (const mapping of LATTICE_DRUM_MAPPING_MODES) {
    for (const contact of contacts) {
      const index = latticeDrumVoiceIndex(contact, {
        mode: mapping.id,
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
  }
  const pairClasses = new Set(
    lattice.edges
      .filter(({ adjacentTiles }) => adjacentTiles.length === 2)
      .map(latticeColorPairVoiceIndex),
  );
  assert.equal(pairClasses.size, 11);
});

test("lattice adjacency identities keep one color pair across all families", () => {
  for (const info of TILING_TYPES) {
    const lattice = buildLattice({ type: info.type, bounds, scale: .28 });
    const pairsByAdjacency = new Map();
    for (const edge of lattice.edges) {
      assert.ok([1, 2].includes(edge.adjacentTiles.length));
      for (const tile of edge.adjacentTiles) {
        assert.ok(Number.isInteger(tile.t1));
        assert.ok(Number.isInteger(tile.t2));
        assert.ok(Number.isInteger(tile.aspect));
        assert.ok(Number.isInteger(tile.edgeIndex));
        assert.equal(tile.color, Math.abs(tile.aspect) % 5);
      }
      if (edge.adjacentTiles.length !== 2) continue;
      const pair = edge.adjacentTiles.map(({ color }) => color).sort().join("-");
      if (!pairsByAdjacency.has(edge.adjacencyKey)) {
        pairsByAdjacency.set(edge.adjacencyKey, new Set());
      }
      pairsByAdjacency.get(edge.adjacencyKey).add(pair);
    }
    assert.ok(pairsByAdjacency.size > 0, `${info.code} needs complete adjacency data`);
    for (const pairs of pairsByAdjacency.values()) {
      assert.equal(pairs.size, 1, `${info.code} adjacency must be period-stable`);
    }
  }
});

test("a reader vertex contact selects the dedicated junction voice", () => {
  const adjacentTiles = [
    { key: "left", t1: 0, t2: 0, aspect: 0, color: 0, edgeIndex: 0 },
    { key: "right", t1: 0, t2: 0, aspect: 1, color: 1, edgeIndex: 0 },
  ];
  const edge = (key, points) => ({
    key,
    periodicKey: `periodic-${key}`,
    adjacencyKey: `adjacency-${key}`,
    points,
    adjacentTiles,
    aspect: 0,
    edgeIndex: 0,
    edgeShapeId: 0,
  });
  const lattice = {
    scale: 1,
    edges: [
      edge("a", [{ x: -1, y: 0 }, { x: 0, y: 0 }]),
      edge("b", [{ x: 0, y: 0 }, { x: 1, y: 1 }]),
    ],
  };
  const contacts = contactsForLine(
    lattice,
    createScanLine({ minX: -1, minY: -1, maxX: 1, maxY: 1 }, .5, 90),
  );
  assert.equal(contacts.length, 1);
  assert.deepEqual(contacts[0].edgeKeys, ["a", "b"]);
  assert.equal(contacts[0].isVertexContact, true);
  assert.equal(
    latticeDrumVoiceIndex(contacts[0], { mode: "tile-color-pair" }),
    15,
  );
});

test("hexagon drum contacts keep changing physical onset keys", () => {
  const lattice = buildLattice({
    type: 1,
    bounds,
    scale: .26,
    alignPeriodToDegrees: 180,
  });
  const scan = createScanLine(bounds, .5, 90);
  let previousVoiceKeys = new Set();
  let previousOnsetKeys = new Set();
  let periodicVoiceChanges = 0;
  let physicalOnsets = 0;

  for (let step = 0; step < 48; step += 1) {
    const contacts = contactsForLine(
      lattice,
      scan,
      undefined,
      latticeOffsetForPhase(lattice, step / 48),
    );
    const voiceKeys = new Set(contacts.map(({ voiceKey }) => voiceKey));
    const onsetKeys = new Set(contacts.map(({ onsetKey }) => onsetKey));
    if (step > 0) {
      periodicVoiceChanges += [...voiceKeys].filter((key) => !previousVoiceKeys.has(key)).length;
      physicalOnsets += [...onsetKeys].filter((key) => !previousOnsetKeys.has(key)).length;
    }
    previousVoiceKeys = voiceKeys;
    previousOnsetKeys = onsetKeys;
  }

  assert.equal(periodicVoiceChanges, 0);
  assert.ok(physicalOnsets > 0);
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
  assert.match(html, /id="drumEngine"/);
  assert.match(html, /id="engineStatus"/);
  assert.match(html, /id="auditionEngine"/);
  assert.match(html, /808\/909 samples/);
  assert.match(html, /src="lattice-drums-app\.js"/);
  assert.match(css, /\.lattice-drum-map[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(app, /TILING_TYPES/);
  assert.match(app, /buildPrototile/);
  assert.match(app, /parametersForDraggedVertex/);
  assert.match(app, /constrainPrototileEdit/);
  assert.match(app, /configureTilingControls/);
  assert.match(app, /contactsForLine/);
  assert.match(app, /mappedLatticeDrumVoice/);
  assert.match(app, /SampleDrumAudio/);
  assert.match(app, /mappedLatticeSampleDrumVoice/);
  assert.match(app, /currentAudio\(\)\.trigger\(voice\)/);
  assert.match(app, /function auditionCurrentEngine/);
  assert.match(app, /Loading 808\/909 audition/);
  assert.match(app, /ENGINE_AUDITION_PATTERN/);
  assert.match(app, /lastStrikeTimes\.clear\(\);[\s\S]+suppressStrikes = 0;/);
  assert.match(app, /contactOnsetKey/);
  assert.doesNotMatch(
    html,
    /voiceEditor|editorControls|saveBank|soundMode|soundSection|synthMapping/,
  );
});
