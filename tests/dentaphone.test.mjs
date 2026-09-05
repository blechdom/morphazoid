import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DENTAPHONE_BRUSH_ROUTE,
  DENTAPHONE_DEFAULT_PITCH_STATE,
  DENTAPHONE_PITCH_LAYOUTS,
  DENTAPHONE_TEETH,
  buildDentaphonePitchMap,
  dentaphonePitchRange,
  dentaphoneToothLabel,
  sanitizeDentaphonePitchState,
} from "../src/dentaphone.js";
import {
  PHYSICAL_SOUND_PRESETS,
  buildPhysicalModalBank,
} from "../src/physical-sounds.js";

const EXPECTED_IMAGE_REGIONS = Object.freeze({
  upper: Object.freeze([
    [.3223, .4618, 5.60, 6.54, -2],
    [.3251, .3854, 6.45, 9.38, -5],
    [.3375, .3047, 6.32, 9.08, -8],
    [.3509, .2375, 5.53, 6.74, -15],
    [.3679, .1836, 5.21, 7.23, -23],
    [.3904, .1285, 4.82, 8.30, -28],
    [.4265, .0896, 4.49, 8.50, -18],
    [.4747, .0717, 5.60, 9.47, -3],
    [.5292, .0714, 5.53, 9.38, 3],
    [.5760, .0890, 4.49, 8.40, 18],
    [.6105, .1293, 4.75, 8.30, 28],
    [.6334, .1839, 5.27, 7.23, 23],
    [.6497, .2376, 5.60, 6.74, 15],
    [.6627, .3050, 6.45, 9.18, 8],
    [.6748, .3862, 6.45, 9.38, 5],
    [.6765, .4616, 5.60, 6.54, 2],
  ]),
  lower: Object.freeze([
    [.3259, .5811, 5.86, 8.30, 0],
    [.3380, .6572, 6.05, 9.08, -4],
    [.3557, .7225, 5.14, 6.84, -8],
    [.3717, .7747, 4.62, 6.64, -14],
    [.3931, .8244, 4.04, 6.93, -24],
    [.4210, .8611, 3.65, 7.52, -24],
    [.4512, .8816, 3.52, 7.42, -12],
    [.4836, .8912, 3.39, 7.23, -3],
    [.5159, .8854, 3.52, 7.42, 3],
    [.5484, .8816, 3.52, 7.42, 12],
    [.5791, .8605, 3.71, 7.42, 24],
    [.6069, .8235, 3.97, 6.93, 24],
    [.6283, .7748, 4.69, 6.64, 14],
    [.6447, .7224, 5.14, 6.64, 8],
    [.6626, .6575, 6.12, 9.08, 4],
    [.6749, .5813, 5.86, 8.30, 0],
  ]),
});

function parseGlbJson(bytes) {
  assert.ok(bytes.byteLength >= 20, "GLB must include a header and JSON chunk header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, "GLB magic must be glTF");
  assert.equal(view.getUint32(4, true), 2, "Dentaphone model must use glTF 2");
  assert.equal(view.getUint32(8, true), bytes.byteLength, "GLB declared length must match the file");

  const chunks = [];
  let offset = 12;
  while (offset < bytes.byteLength) {
    assert.ok(offset + 8 <= bytes.byteLength, "every GLB chunk must include a complete header");
    const byteLength = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    assert.equal(byteLength % 4, 0, "GLB chunks must be four-byte aligned");
    offset += 8;
    assert.ok(offset + byteLength <= bytes.byteLength, "every GLB chunk must fit inside the file");
    chunks.push({ type, bytes: bytes.subarray(offset, offset + byteLength) });
    offset += byteLength;
  }
  assert.equal(offset, bytes.byteLength, "GLB chunks must consume the declared file length");
  assert.equal(chunks[0]?.type, 0x4e4f534a, "the first GLB chunk must be JSON");
  assert.equal(chunks.filter(({ type }) => type === 0x4e4f534a).length, 1, "GLB must have one JSON chunk");
  assert.equal(chunks.filter(({ type }) => type === 0x004e4942).length, 1, "GLB must have one binary chunk");

  const gltf = JSON.parse(
    Buffer.from(chunks[0].bytes)
      .toString("utf8")
      .replace(/\u0000+$/u, "")
      .trimEnd(),
  );
  assert.equal(gltf.buffers?.length, 1, "the embedded model must declare one binary buffer");
  const binaryChunk = chunks.find(({ type }) => type === 0x004e4942).bytes;
  assert.ok(binaryChunk.byteLength >= gltf.buffers[0].byteLength, "the binary chunk must contain its declared buffer");
  assert.ok(binaryChunk.byteLength - gltf.buffers[0].byteLength < 4, "the binary chunk may contain only alignment padding");
  return gltf;
}

function gltfTriangleCount(gltf) {
  return gltf.meshes.reduce((total, mesh) => total + mesh.primitives.reduce((meshTotal, primitive) => {
    const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
    const elementCount = gltf.accessors?.[accessorIndex]?.count;
    assert.ok(Number.isInteger(elementCount) && elementCount > 0, "every primitive needs a finite element count");
    const mode = primitive.mode ?? 4;
    if (mode === 4) return meshTotal + Math.floor(elementCount / 3);
    if (mode === 5 || mode === 6) return meshTotal + Math.max(0, elementCount - 2);
    return meshTotal;
  }, 0), 0);
}

test("Dentaphone fixes all 32 controls to measured regions of the two anatomical images", () => {
  assert.equal(DENTAPHONE_TEETH.length, 32);
  assert.equal(new Set(DENTAPHONE_TEETH.map(({ id }) => id)).size, 32);

  for (const arch of ["upper", "lower"]) {
    const teeth = DENTAPHONE_TEETH.filter((tooth) => tooth.arch === arch);
    assert.equal(teeth.length, 16);
    assert.deepEqual(
      teeth.map(({ type }) => type),
      [
        "third-molar", "second-molar", "first-molar",
        "second-premolar", "first-premolar", "canine",
        "lateral-incisor", "central-incisor", "central-incisor",
        "lateral-incisor", "canine", "first-premolar",
        "second-premolar", "first-molar", "second-molar", "third-molar",
      ],
    );
    assert.ok(teeth.every(({ x, y }) => x > 0.03 && x < 0.97 && y > 0.02 && y < 0.98));
    assert.ok(teeth.every(({ width, height }) => width > 3 && width < 7 && height > 6 && height < 11));
    assert.ok(teeth.every(({ strikePosition }) => strikePosition > 0 && strikePosition < 1));
    assert.deepEqual(
      teeth.map(({ x, y, width, height, rotation }) => [x, y, width, height, rotation]),
      EXPECTED_IMAGE_REGIONS[arch],
      `${arch} controls must remain aligned one-to-one with their measured crowns`,
    );
    assert.ok(
      teeth.every(({ y }) => arch === "upper" ? y < 0.5 : y > 0.5),
      `${arch} controls must stay inside their illustrated half of the plate`,
    );
    assert.equal(teeth[0].type, "third-molar");
    assert.equal(teeth.at(-1).type, "third-molar");
  }

  assert.deepEqual(
    DENTAPHONE_TEETH.filter(({ arch }) => arch === "upper").map(({ universalNumber }) => universalNumber),
    Array.from({ length: 16 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    DENTAPHONE_TEETH.filter(({ arch }) => arch === "lower").map(({ universalNumber }) => universalNumber),
    Array.from({ length: 16 }, (_, index) => 32 - index),
  );
  assert.equal(new Set(DENTAPHONE_TEETH.map(({ strikePosition }) => strikePosition)).size, 32);
});

test("the automatic toothbrush sweeps out and back across both complete arches", () => {
  const knownToothIds = new Set(DENTAPHONE_TEETH.map(({ id }) => id));
  assert.equal(DENTAPHONE_BRUSH_ROUTE.length, 62);
  assert.deepEqual(new Set(DENTAPHONE_BRUSH_ROUTE), knownToothIds);
  assert.ok(DENTAPHONE_BRUSH_ROUTE.every((id) => knownToothIds.has(id)));

  assert.deepEqual(DENTAPHONE_BRUSH_ROUTE.slice(0, 16), [
    ...Array.from({ length: 16 }, (_, index) => `upper-${String(index + 1).padStart(2, "0")}`),
  ]);
  assert.deepEqual(DENTAPHONE_BRUSH_ROUTE.slice(16, 31), [
    ...Array.from({ length: 15 }, (_, index) => `upper-${String(15 - index).padStart(2, "0")}`),
  ]);
  assert.deepEqual(DENTAPHONE_BRUSH_ROUTE.slice(31, 47), [
    ...Array.from({ length: 16 }, (_, index) => `lower-${String(index + 1).padStart(2, "0")}`),
  ]);
  assert.deepEqual(DENTAPHONE_BRUSH_ROUTE.slice(47), [
    ...Array.from({ length: 15 }, (_, index) => `lower-${String(15 - index).padStart(2, "0")}`),
  ]);
  assert.notEqual(DENTAPHONE_BRUSH_ROUTE[15], DENTAPHONE_BRUSH_ROUTE[16]);
  assert.notEqual(DENTAPHONE_BRUSH_ROUTE[46], DENTAPHONE_BRUSH_ROUTE[47]);
});

test("Dentaphone optional GLB has two jaw groups, 32 named teeth, and complete geometry", async () => {
  const bytes = await readFile(new URL("../assets/models/dentaphone-chomper.glb", import.meta.url));
  const gltf = parseGlbJson(bytes);
  assert.equal(gltf.asset?.version, "2.0");
  assert.ok(Array.isArray(gltf.nodes), "Dentaphone GLB must define nodes");
  assert.ok(Array.isArray(gltf.meshes), "Dentaphone GLB must define meshes");
  assert.ok(Array.isArray(gltf.accessors), "Dentaphone GLB must define accessors");
  assert.ok(gltfTriangleCount(gltf) >= 7_200, "the complete dentition must retain at least 7,200 triangles");

  const entriesByName = new Map();
  gltf.nodes.forEach((node, index) => {
    if (!node.name) return;
    const entries = entriesByName.get(node.name) ?? [];
    entries.push({ index, node });
    entriesByName.set(node.name, entries);
  });
  const rootEntries = entriesByName.get("DentaphoneChomper") ?? [];
  assert.equal(rootEntries.length, 1, "DentaphoneChomper must occur exactly once");
  assert.equal(rootEntries[0].node.extras?.source, "MakeHuman system asset: teeth_base");
  assert.equal(rootEntries[0].node.extras?.license, "CC0 1.0 Universal");
  assert.match(rootEntries[0].node.extras?.sourceSha256 ?? "", /^[a-f0-9]{64}$/u);

  const jawEntries = {};
  for (const [arch, jawName] of [["upper", "UpperJaw"], ["lower", "LowerJaw"]]) {
    const matches = entriesByName.get(jawName) ?? [];
    assert.equal(matches.length, 1, `${jawName} must occur exactly once`);
    jawEntries[arch] = matches[0];
    assert.ok(rootEntries[0].node.children?.includes(matches[0].index), `${jawName} must be parented by the model root`);
  }

  const descendantsOf = ({ node }) => {
    const descendants = new Set();
    const pending = [...(node.children ?? [])];
    while (pending.length) {
      const childIndex = pending.pop();
      assert.ok(
        Number.isInteger(childIndex) && childIndex >= 0 && childIndex < gltf.nodes.length,
        "jaw hierarchy contains an invalid child index",
      );
      if (descendants.has(childIndex)) continue;
      descendants.add(childIndex);
      pending.push(...(gltf.nodes[childIndex].children ?? []));
    }
    return descendants;
  };
  const jawDescendants = Object.fromEntries(
    Object.entries(jawEntries).map(([arch, entry]) => [arch, descendantsOf(entry)]),
  );

  const expectedToothIds = DENTAPHONE_TEETH.map(({ id }) => id).sort();
  const modelToothIds = gltf.nodes
    .map(({ name }) => name)
    .filter((name) => /^(?:upper|lower)-(?:0[1-9]|1[0-6])$/u.test(name ?? ""))
    .sort();
  assert.deepEqual(modelToothIds, expectedToothIds);

  for (const tooth of DENTAPHONE_TEETH) {
    const matches = entriesByName.get(tooth.id) ?? [];
    assert.equal(matches.length, 1, `${tooth.id} must occur exactly once`);
    const [{ index, node }] = matches;
    assert.ok(
      Number.isInteger(node.mesh) && node.mesh >= 0 && node.mesh < gltf.meshes.length,
      `${tooth.id} must reference a valid mesh`,
    );
    assert.ok(jawDescendants[tooth.arch].has(index), `${tooth.id} must belong to its ${tooth.arch} jaw`);
    const oppositeArch = tooth.arch === "upper" ? "lower" : "upper";
    assert.equal(jawDescendants[oppositeArch].has(index), false, `${tooth.id} must not belong to both jaws`);
  }
});

test("the default map is chromatic across both complete arches", () => {
  const map = buildDentaphonePitchMap();
  assert.deepEqual(
    map.filter(({ arch }) => arch === "lower").map(({ midi }) => midi),
    Array.from({ length: 16 }, (_, index) => 48 + index),
  );
  assert.deepEqual(
    map.filter(({ arch }) => arch === "upper").map(({ midi }) => midi),
    Array.from({ length: 16 }, (_, index) => 60 + index),
  );
  assert.equal(dentaphonePitchRange(map, "lower"), "C3–D♯4");
  assert.equal(dentaphonePitchRange(map, "upper"), "C4–D♯5");
});

test("all pitch distributions produce two complete finite playable layers", () => {
  for (const { id } of DENTAPHONE_PITCH_LAYOUTS) {
    const map = buildDentaphonePitchMap({ layout: id, root: 9, octave: 2 });
    assert.equal(map.length, 32);
    assert.equal(map.filter(({ arch }) => arch === "upper").length, 16);
    assert.equal(map.filter(({ arch }) => arch === "lower").length, 16);
    assert.ok(map.every(({ midi, note }) => midi >= 24 && midi <= 107 && /\d$/.test(note)));
    assert.ok(new Set(map.filter(({ arch }) => arch === "upper").map(({ midi }) => midi)).size > 12);
    assert.ok(new Set(map.filter(({ arch }) => arch === "lower").map(({ midi }) => midi)).size > 12);
  }
});

test("pitch settings sanitize without mutating the shared defaults", () => {
  assert.deepEqual(sanitizeDentaphonePitchState({
    layout: "not-a-layout",
    root: 80,
    octave: -4,
  }), {
    ...DENTAPHONE_DEFAULT_PITCH_STATE,
    root: 11,
    octave: 1,
  });
  assert.deepEqual(DENTAPHONE_DEFAULT_PITCH_STATE, {
    layout: "paired-chromatic",
    root: 0,
    octave: 3,
  });
});

test("playable tooth labels combine anatomy, numbering, note, and material", () => {
  const tooth = buildDentaphonePitchMap().find(({ id }) => id === "upper-03");
  assert.equal(
    dentaphoneToothLabel(tooth, "Glass bowl"),
    "Upper right first molar, tooth 3, D4, Glass bowl",
  );
});

test("every terminal and interior tooth excites every preserved Object Forge material", () => {
  const map = buildDentaphonePitchMap();
  for (const preset of PHYSICAL_SOUND_PRESETS["object-forge"]) {
    for (const tooth of map) {
      const state = {
        ...preset.settings,
        presetId: preset.id,
        baseFrequencyHz: 440 * (2 ** ((tooth.midi - 69) / 12)),
        strikePosition: tooth.strikePosition,
      };
      const bank = buildPhysicalModalBank("object-forge", state);
      const inputWeight = [...bank.strikeWeights].reduce((sum, value) => sum + Math.abs(value), 0);
      assert.ok(inputWeight > 0.08, `${preset.id} ${tooth.id} must not land on a silent modal node`);
    }
  }
});

test("every allowed Dentaphone pitch layer stays unique at MIDI boundaries", () => {
  for (const { id: layout } of DENTAPHONE_PITCH_LAYOUTS) {
    for (let root = 0; root < 12; root += 1) {
      for (let octave = 1; octave <= 3; octave += 1) {
        const map = buildDentaphonePitchMap({ layout, root, octave });
        for (const arch of ["upper", "lower"]) {
          const notes = map.filter((tooth) => tooth.arch === arch).map((tooth) => tooth.midi);
          assert.equal(new Set(notes).size, 16, `${layout} root ${root} octave ${octave} ${arch}`);
        }
      }
    }
  }
});
