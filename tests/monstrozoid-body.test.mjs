import assert from "node:assert/strict";
import test from "node:test";

import { createMonstrozoidBodyGeometry } from "../src/monstrozoid-body.js";

const layout = {
  seed: 77,
  nodes: {
    "lung-1": { id: "lung-1", kind: "lung", index: 0, x: 110, y: 120 },
    "lung-2": { id: "lung-2", kind: "lung", index: 1, x: 240, y: 430 },
    "source-1": { id: "source-1", kind: "source", index: 0, x: 520, y: 275 },
    "mouth-1": { id: "mouth-1", kind: "mouth", index: 0, x: 840, y: 180 },
    "mouth-2": { id: "mouth-2", kind: "mouth", index: 1, x: 825, y: 455 },
  },
};

const state = {
  lungEnabled: [true, true],
  phonatorEnabled: [true],
  mouthEnabled: [true, true],
};

test("body geometry is deterministic, finite, and six-limbed", () => {
  const first = createMonstrozoidBodyGeometry(layout, state);
  const second = createMonstrozoidBodyGeometry(layout, state);
  assert.deepEqual(first, second);
  assert.match(first.shell, /^M .+ Z$/);
  assert.match(first.web, /^M /);
  assert.equal(first.limbs.length, 6);
  for (const path of [first.shell, first.web, ...first.limbs]) {
    assert.doesNotMatch(path, /NaN|Infinity/);
  }
});

test("dragging any enabled organ deforms the connective body", () => {
  const original = createMonstrozoidBodyGeometry(layout, state);
  for (const id of Object.keys(layout.nodes)) {
    const node = layout.nodes[id];
    const moved = {
      ...layout,
      nodes: {
        ...layout.nodes,
        [id]: { ...node, x: node.x + 31, y: node.y + 23 },
      },
    };
    const result = createMonstrozoidBodyGeometry(moved, state);
    assert.notEqual(result.web, original.web, `${id} should pull the connective web`);
    assert.notDeepEqual(result.limbs, original.limbs, `${id} should pull the appendages`);
  }
});

test("disabled organs stop pulling on the membrane", () => {
  const disabled = {
    ...state,
    mouthEnabled: [true, false],
  };
  const first = createMonstrozoidBodyGeometry(layout, disabled);
  const movedDisabled = {
    ...layout,
    nodes: {
      ...layout.nodes,
      "mouth-2": { ...layout.nodes["mouth-2"], x: 740, y: 90 },
    },
  };
  assert.deepEqual(createMonstrozoidBodyGeometry(movedDisabled, disabled), first);
});
