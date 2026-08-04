import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAOTIC_FM_DEFAULTS,
  deriveChaoticFmStack,
} from "../src/chaotic-fm.js";
import { buildChaoticFmFlowDiagram } from "../src/chaotic-fm-flow.js";

function diagramAtDepth(depth) {
  const stack = deriveChaoticFmStack({
    ...CHAOTIC_FM_DEFAULTS,
    depth,
  });
  return {
    diagram: buildChaoticFmFlowDiagram(stack, {
      outputLevel: CHAOTIC_FM_DEFAULTS.output,
    }),
    stack,
  };
}

test("Chaotic FM separates the center sum from the entry oscillator", () => {
  for (const depth of [0, 1, 5, 10]) {
    const { diagram } = diagramAtDepth(depth);
    assert.ok(diagram.entry);
    assert.ok(
      diagram.entry.centerRight <= diagram.entry.inputX - 14,
      "the CENTER block must leave a readable gap before ENTRY SINE",
    );
    assert.ok(
      diagram.entry.junctionRight <= diagram.entry.inputX - 8,
      "the sum junction must not sit on the ENTRY SINE border",
    );
  }
});

test("Chaotic FM draws one directional recursive drive for every turn", () => {
  for (const depth of [0, 1, 5, 10]) {
    const { diagram, stack } = diagramAtDepth(depth);
    assert.equal(diagram.recursiveLinks.length, stack.turns.length);
    assert.equal(
      (diagram.markup.match(/class="chaotic-path-recursive-wire"/g) ?? []).length,
      stack.turns.length * 2,
    );
    assert.equal(
      (diagram.markup.match(/PREVIOUS SINE → NEXT FREQUENCY/g) ?? []).length,
      stack.turns.length,
    );
    assert.ok(diagram.markup.includes('marker-end="url(#chaoticFmSignalArrow)"'));
  }
});

test("Chaotic FM ships a legible compact mobile explanation", () => {
  const { diagram } = diagramAtDepth(5);
  assert.match(diagram.markup, /class="chaotic-path-detail"/);
  assert.match(diagram.markup, /class="chaotic-path-compact"/);
  assert.match(
    diagram.markup,
    /RECURSIVE FM · EACH SINE DRIVES THE NEXT SINE'S FREQUENCY/,
  );
  assert.match(diagram.markup, /SINE WAVE → NEXT FREQUENCY/);
  assert.match(diagram.markup, /× AMOUNT · TANH · × RATE/);
  assert.match(diagram.markup, /AUDIO DEPTH TAPS/);
  assert.match(diagram.ariaLabel, /dotted vertical routes are audio depth taps/i);
});
