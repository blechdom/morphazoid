import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATAPOEIA_CONTOUR_SOURCES,
  AUTOMATAPOEIA_DEFAULT_OBJECT_MODE,
  AUTOMATAPOEIA_DEFAULT_POLARITY,
  AUTOMATAPOEIA_DEFAULT_SONIFICATION_MODE,
  AUTOMATAPOEIA_DEFAULT_TRANSFORM,
  AUTOMATAPOEIA_DEFAULT_VOICE,
  AUTOMATAPOEIA_DEFAULT_BOUNDARY,
  AUTOMATAPOEIA_DEFAULT_FAMILY,
  AUTOMATAPOEIA_FAMILIES,
  AUTOMATAPOEIA_FREQUENCY_MAX,
  AUTOMATAPOEIA_FREQUENCY_MIN,
  AUTOMATAPOEIA_RULES,
  AUTOMATAPOEIA_SONIFICATION_MODES,
  AUTOMATAPOEIA_TOTALISTIC_RULES,
  AUTOMATAPOEIA_TRANSFORMS,
  AUTOMATAPOEIA_VOICES,
  automatapoeiaColumnTransitions,
  automatapoeiaConjugateRule,
  automatapoeiaConnectedForms,
  automatapoeiaConnectedPaths,
  automatapoeiaConnectedSoundUnits,
  automatapoeiaContourStats,
  automatapoeiaEnvelopeAmplitude,
  automatapoeiaFamilyLabel,
  automatapoeiaFrequencyAtPosition,
  automatapoeiaLiveRuns,
  automatapoeiaNextRow,
  automatapoeiaPitchResponse,
  automatapoeiaPolarityMask,
  automatapoeiaPolarityRuns,
  automatapoeiaPreviewRows,
  automatapoeiaReflectRule,
  automatapoeiaResizeRow,
  automatapoeiaRetimedAccumulator,
  automatapoeiaRowStats,
  automatapoeiaRowsPath,
  automatapoeiaRuleOrbit,
  automatapoeiaRuleBits,
  automatapoeiaSonificationModeLabel,
  automatapoeiaSwingInterval,
  automatapoeiaSwingPosition,
  automatapoeiaTotalisticConjugateRule,
  automatapoeiaTotalisticNextRow,
  automatapoeiaTotalisticRuleBits,
  automatapoeiaTotalisticRuleOrbit,
  automatapoeiaTransformLabel,
  automatapoeiaTransformRow,
  buildAutomatapoeiaEvents,
  renderAutomatapoeiaRow,
  sanitizeAutomatapoeiaBoundary,
  sanitizeAutomatapoeiaFamily,
  sanitizeAutomatapoeiaObjectMode,
  sanitizeAutomatapoeiaPolarity,
  sanitizeAutomatapoeiaSonificationMode,
  sanitizeAutomatapoeiaTransform,
  sanitizeAutomatapoeiaVoice,
  writeAutomatapoeiaRaster,
} from "../src/automatapoeia.js";

function signalMetrics(samples) {
  let peak = 0;
  let energy = 0;
  for (const sample of samples) {
    assert.ok(Number.isFinite(sample));
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample;
  }
  return {
    peak,
    rms: Math.sqrt(energy / Math.max(1, samples.length)),
  };
}

function differenceRms(first, second) {
  const length = Math.min(first.length, second.length);
  let energy = 0;
  for (let index = 0; index < length; index += 1) {
    const difference = first[index] - second[index];
    energy += difference * difference;
  }
  return Math.sqrt(energy / Math.max(1, length));
}

test("Automatapoeia exposes eight distinct physical, oscillator, and noise techniques", () => {
  assert.equal(AUTOMATAPOEIA_DEFAULT_VOICE, "rattlesnake");
  assert.deepEqual(
    AUTOMATAPOEIA_VOICES.map(({ id }) => id),
    [
      "rattlesnake",
      "karplus-carpet",
      "ouroboros",
      "modal-fm",
      "cascade-pm",
      "glass-lattice",
      "wavefold-ribbon",
      "formant-dust",
    ],
  );
  assert.deepEqual(
    AUTOMATAPOEIA_CONTOUR_SOURCES.map(({ id }) => id),
    ["motion", "expansion", "edge-flux", "persistence", "birth-death"],
  );
  assert.equal(sanitizeAutomatapoeiaVoice("ouroboros"), "ouroboros");
  assert.equal(sanitizeAutomatapoeiaVoice("unknown"), AUTOMATAPOEIA_DEFAULT_VOICE);
});

test("sonification and post-step transform catalogs sanitize stable public ids", () => {
  assert.equal(AUTOMATAPOEIA_DEFAULT_SONIFICATION_MODE, "row-events");
  assert.deepEqual(AUTOMATAPOEIA_SONIFICATION_MODES.map(({ id }) => id), [
    "row-events",
    "vertical-sine",
  ]);
  assert.equal(sanitizeAutomatapoeiaSonificationMode("vertical-sine"), "vertical-sine");
  assert.equal(sanitizeAutomatapoeiaSonificationMode("unknown"), "row-events");
  assert.equal(automatapoeiaSonificationModeLabel("vertical-sine"), "Vertical sine bank");

  assert.equal(AUTOMATAPOEIA_DEFAULT_TRANSFORM, "none");
  assert.deepEqual(AUTOMATAPOEIA_TRANSFORMS.map(({ id }) => id), [
    "none",
    "shift-left",
    "shift-right",
    "reflect",
    "complement",
  ]);
  assert.equal(sanitizeAutomatapoeiaTransform("reflect"), "reflect");
  assert.equal(sanitizeAutomatapoeiaTransform("unknown"), "none");
  assert.equal(automatapoeiaTransformLabel("complement"), "Complement");
});

test("radius-2 totalistic family exposes all 64 exact five-cell sum codes", () => {
  assert.equal(AUTOMATAPOEIA_DEFAULT_FAMILY, "elementary");
  assert.deepEqual(
    AUTOMATAPOEIA_FAMILIES.map(({ id, ruleCount }) => [id, ruleCount]),
    [["elementary", 256], ["totalistic-r2", 64]],
  );
  assert.equal(sanitizeAutomatapoeiaFamily("totalistic-r2"), "totalistic-r2");
  assert.equal(sanitizeAutomatapoeiaFamily("unknown"), "elementary");
  assert.equal(automatapoeiaFamilyLabel("totalistic-r2"), "Totalistic · radius 2");
  assert.equal(AUTOMATAPOEIA_TOTALISTIC_RULES.length, 64);
  assert.equal(
    new Set(AUTOMATAPOEIA_TOTALISTIC_RULES.map(({ representative }) => representative)).size,
    36,
  );

  for (let code = 0; code < 64; code += 1) {
    assert.equal(
      automatapoeiaTotalisticRuleBits(code),
      code.toString(2).padStart(6, "0"),
    );
    assert.equal(automatapoeiaRuleBits(code, "totalistic-r2"), automatapoeiaTotalisticRuleBits(code));
    assert.equal(
      automatapoeiaTotalisticConjugateRule(automatapoeiaTotalisticConjugateRule(code)),
      code,
    );
    assert.ok(automatapoeiaTotalisticRuleOrbit(code).includes(code));
    for (let neighborhood = 0; neighborhood < 32; neighborhood += 1) {
      const cells = Array.from(
        { length: 5 },
        (_, index) => (neighborhood >> (4 - index)) & 1,
      );
      const total = cells.reduce((sum, cell) => sum + cell, 0);
      const expected = (code >> total) & 1;
      assert.equal(
        automatapoeiaTotalisticNextRow(cells, code, "fixed")[2],
        expected,
        `code ${code}, neighborhood ${cells.join("")}, total ${total}`,
      );
      assert.equal(
        automatapoeiaNextRow(cells, code, "fixed", "totalistic-r2")[2],
        expected,
      );
    }
  }

  assert.equal(automatapoeiaTotalisticRuleBits(-1), "000000");
  assert.equal(automatapoeiaTotalisticRuleBits(99), "111111");
  assert.deepEqual(AUTOMATAPOEIA_TOTALISTIC_RULES[10].activeTotals, [1, 3]);
  assert.equal(AUTOMATAPOEIA_TOTALISTIC_RULES[10].bits, "001010");
  assert.deepEqual(AUTOMATAPOEIA_TOTALISTIC_RULES[20].activeTotals, [2, 4]);
  assert.equal(AUTOMATAPOEIA_TOTALISTIC_RULES[20].bits, "010100");
  assert.deepEqual(AUTOMATAPOEIA_TOTALISTIC_RULES[52].activeTotals, [2, 4, 5]);
  assert.deepEqual(automatapoeiaTotalisticNextRow([1, 0, 0, 0, 0], 10, "fixed"), [1, 1, 1, 0, 0]);
  assert.deepEqual(automatapoeiaTotalisticNextRow([1, 0, 0, 0, 0], 10, "periodic"), [1, 1, 1, 1, 1]);
  assert.deepEqual(automatapoeiaTotalisticNextRow([1, 0, 1], 0, "periodic"), [0, 0, 0]);
  assert.deepEqual(automatapoeiaTotalisticNextRow([1, 0, 1], 63, "fixed"), [1, 1, 1]);
});

test("totalistic previews are deterministic and distinct from elementary previews", () => {
  const options = { family: "totalistic-r2", width: 15, height: 8, seed: 19 };
  const first = automatapoeiaPreviewRows(20, options);
  assert.deepEqual(first, automatapoeiaPreviewRows(20, options));
  assert.notDeepEqual(first, automatapoeiaPreviewRows(20, { ...options, family: "elementary" }));
  let row = first[0];
  for (let index = 1; index < first.length; index += 1) {
    row = automatapoeiaNextRow(row, 20, "periodic", "totalistic-r2");
    assert.deepEqual(first[index], row);
  }
});

test("all 256 elementary rules use the exact Wolfram neighborhood-bit lookup", () => {
  assert.equal(AUTOMATAPOEIA_DEFAULT_BOUNDARY, "fixed");
  assert.equal(sanitizeAutomatapoeiaBoundary("periodic"), "periodic");
  assert.equal(sanitizeAutomatapoeiaBoundary("unknown"), "fixed");
  for (let rule = 0; rule <= 255; rule += 1) {
    assert.equal(automatapoeiaRuleBits(rule), rule.toString(2).padStart(8, "0"));
    for (let neighborhood = 0; neighborhood < 8; neighborhood += 1) {
      const cells = [
        (neighborhood >> 2) & 1,
        (neighborhood >> 1) & 1,
        neighborhood & 1,
      ];
      assert.equal(
        automatapoeiaNextRow(cells, rule, "fixed")[1],
        (rule >> neighborhood) & 1,
        `rule ${rule}, neighborhood ${cells.join("")}`,
      );
    }
  }
  assert.equal(automatapoeiaRuleBits(30), "00011110");
});

test("all rules form exactly 88 reflection and Boolean-conjugation families", () => {
  assert.equal(AUTOMATAPOEIA_RULES.length, 256);
  assert.equal(new Set(AUTOMATAPOEIA_RULES.map(({ representative }) => representative)).size, 88);
  assert.deepEqual(automatapoeiaRuleOrbit(30), [30, 86, 135, 149]);
  assert.deepEqual(automatapoeiaRuleOrbit(90), [90, 165]);
  for (let rule = 0; rule < 256; rule += 1) {
    assert.equal(automatapoeiaReflectRule(automatapoeiaReflectRule(rule)), rule);
    assert.equal(automatapoeiaConjugateRule(automatapoeiaConjugateRule(rule)), rule);
    assert.ok(automatapoeiaRuleOrbit(rule).includes(rule));
  }
});

test("rule previews are deterministic vector paths built from horizontal live runs", () => {
  const first = automatapoeiaPreviewRows(30, { width: 15, height: 8, seed: 19 });
  const second = automatapoeiaPreviewRows(30, { width: 15, height: 8, seed: 19 });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, automatapoeiaPreviewRows(90, { width: 15, height: 8, seed: 19 }));
  assert.match(automatapoeiaRowsPath(first), /^M\d+ \d+h\d+v1h-\d+z/);
});

test("bulk raster writing reuses and clears one RGBA target", () => {
  const rows = [[1, 0, 1], [0, 1, 0]];
  const target = new Uint8ClampedArray(24).fill(255);
  assert.equal(writeAutomatapoeiaRaster(rows, 0, 2, target), target);
  assert.deepEqual([...target], [
    219, 228, 224, 240, 0, 0, 0, 0, 219, 228, 224, 240,
    0, 0, 0, 0, 219, 228, 224, 240, 0, 0, 0, 0,
  ]);
  const clipped = new Uint8ClampedArray(12).fill(255);
  writeAutomatapoeiaRaster(rows, 1, 1, clipped);
  assert.deepEqual([...clipped], [0, 0, 0, 0, 219, 228, 224, 240, 0, 0, 0, 0]);
});

test("center resizing clips or pads without rewriting the source row", () => {
  const source = [1, 0, 1];
  assert.deepEqual(automatapoeiaResizeRow(source, 7), [0, 0, 1, 0, 1, 0, 0]);
  assert.deepEqual(automatapoeiaResizeRow([1, 0, 1, 1, 0, 1, 0], 3), [1, 1, 0]);
  assert.deepEqual(automatapoeiaResizeRow(source, 4), [1, 0, 1, 0]);
  assert.deepEqual(source, [1, 0, 1]);
});

test("row transforms distinguish fixed shifts from periodic ring rotations", () => {
  const row = [1, 0, 1, 1];
  assert.deepEqual(automatapoeiaTransformRow(row), row);
  assert.notEqual(automatapoeiaTransformRow(row), row);
  assert.deepEqual(automatapoeiaTransformRow(row, "shift-left", "fixed"), [0, 1, 1, 0]);
  assert.deepEqual(automatapoeiaTransformRow(row, "shift-left", "periodic"), [0, 1, 1, 1]);
  assert.deepEqual(automatapoeiaTransformRow(row, "shift-right", "fixed"), [0, 1, 0, 1]);
  assert.deepEqual(automatapoeiaTransformRow(row, "shift-right", "periodic"), [1, 1, 0, 1]);
  assert.deepEqual(automatapoeiaTransformRow(row, "reflect"), [1, 1, 0, 1]);
  assert.deepEqual(automatapoeiaTransformRow(row, "complement"), [0, 1, 0, 0]);
  assert.deepEqual(row, [1, 0, 1, 1]);
});

test("column transitions align changing widths on doubled lattice coordinates", () => {
  const transitions = automatapoeiaColumnTransitions(
    [0, 1, 1, 0, 0],
    [0, 1, 1, 0, 1, 0, 0],
  );
  assert.deepEqual(transitions.attacks.map(({ key }) => key), [-4, 2]);
  assert.deepEqual(transitions.holds.map(({ key }) => key), [-2]);
  assert.deepEqual(transitions.releases.map(({ key }) => key), [0]);
  assert.deepEqual(transitions.active.map(({ key }) => key), [-4, -2, 2]);
  assert.deepEqual(transitions.holds[0], {
    currentIndex: 2,
    index: 2,
    key: -2,
    previousIndex: 1,
  });
  assert.ok(Object.isFrozen(transitions));
  assert.ok(Object.isFrozen(transitions.attacks));
  assert.ok(Object.isFrozen(transitions.holds[0]));

  const inverse = automatapoeiaColumnTransitions([1, 0, 1], [0, 0, 1], { polarity: "zero" });
  assert.deepEqual(inverse.attacks.map(({ key }) => key), [-2]);
  assert.deepEqual(inverse.holds.map(({ key }) => key), [0]);
  assert.deepEqual(inverse.releases.map(({ key }) => key), []);
});

test("mixed-width raster rows are centered and may use an explicit canvas width", () => {
  const rows = [[1, 0, 1], [1, 0, 0, 0, 1], [1]];
  const target = new Uint8ClampedArray(5 * 3 * 4);
  writeAutomatapoeiaRaster(rows, 0, 3, target, 5);
  const alpha = Array.from({ length: 3 }, (_, y) => (
    Array.from({ length: 5 }, (_, x) => target[(y * 5 + x) * 4 + 3] ? 1 : 0)
  ));
  assert.deepEqual(alpha, [
    [0, 1, 0, 1, 0],
    [1, 0, 0, 0, 1],
    [0, 0, 1, 0, 0],
  ]);

  const inferred = new Uint8ClampedArray(5 * 2 * 4);
  writeAutomatapoeiaRaster(rows, 0, 2, inferred);
  assert.equal(inferred[1 * 4 + 3], 240);
});

test("canonical Rule 30 and Rule 90 single-cell rows match their known evolutions", () => {
  const evolve = (rule) => {
    const rows = [];
    let row = [0, 0, 0, 0, 1, 0, 0, 0, 0];
    for (let generation = 0; generation < 4; generation += 1) {
      rows.push(row.join(""));
      row = automatapoeiaNextRow(row, rule, "fixed");
    }
    return rows;
  };
  assert.deepEqual(evolve(30), [
    "000010000",
    "000111000",
    "001100100",
    "011011110",
  ]);
  assert.deepEqual(evolve(90), [
    "000010000",
    "000101000",
    "001000100",
    "010101010",
  ]);
});

test("fixed-zero and periodic boundaries evolve and count domain walls explicitly", () => {
  assert.deepEqual(automatapoeiaNextRow([1, 0, 0], 90, "fixed"), [0, 1, 0]);
  assert.deepEqual(automatapoeiaNextRow([1, 0, 0], 90, "periodic"), [0, 1, 1]);
  assert.deepEqual(automatapoeiaRowStats([1, 1, 1], "fixed"), {
    density: 1,
    transitions: 2,
  });
  assert.deepEqual(automatapoeiaRowStats([1, 1, 1], "periodic"), {
    density: 1,
    transitions: 0,
  });
});

test("polarity and connected-object modes sanitize predictably without mutating cells", () => {
  assert.equal(AUTOMATAPOEIA_DEFAULT_POLARITY, "one");
  assert.equal(AUTOMATAPOEIA_DEFAULT_OBJECT_MODE, "runs");
  assert.equal(sanitizeAutomatapoeiaPolarity("zero"), "zero");
  assert.equal(sanitizeAutomatapoeiaPolarity("unknown"), AUTOMATAPOEIA_DEFAULT_POLARITY);
  assert.equal(sanitizeAutomatapoeiaObjectMode("connected"), "connected");
  assert.equal(sanitizeAutomatapoeiaObjectMode("unknown"), AUTOMATAPOEIA_DEFAULT_OBJECT_MODE);

  const cells = [0, 1, false, true, null];
  const original = [...cells];
  const ones = automatapoeiaPolarityMask(cells, "one");
  const zeros = automatapoeiaPolarityMask(cells, "zero");
  assert.deepEqual(ones, [0, 1, 0, 1, 0]);
  assert.deepEqual(zeros, [1, 0, 1, 0, 1]);
  assert.deepEqual(cells, original);
  assert.ok(Object.isFrozen(ones));
  assert.ok(Object.isFrozen(zeros));
});

test("zero-polarity runs stay clipped at fixed sides and merge only across a periodic seam", () => {
  const cells = [0, 0, 1, 0, 0];
  assert.deepEqual(
    automatapoeiaPolarityRuns(cells, { polarity: "zero", boundary: "fixed" })
      .map(({ start, end, length, wraps }) => ({ start, end, length, wraps })),
    [
      { start: 0, end: 1, length: 2, wraps: false },
      { start: 3, end: 4, length: 2, wraps: false },
    ],
  );
  assert.deepEqual(
    automatapoeiaPolarityRuns(cells, { polarity: "zero", boundary: "periodic" })
      .map(({ start, end, length, wraps }) => ({ start, end, length, wraps })),
    [{ start: 3, end: 1, length: 4, wraps: true }],
  );
});

test("diagonal continuation joins runs into one deterministic connected form", () => {
  const rows = [
    [1, 0, 0, 0, 1],
    [0, 1, 0, 1, 0],
    [0, 0, 1, 0, 0],
  ];
  const forms = automatapoeiaConnectedForms(rows, {
    boundary: "fixed",
    polarity: "one",
    rowOffset: 40,
  });
  assert.equal(forms.components.length, 1);
  assert.equal(forms.nodes.length, 5);
  assert.equal(forms.edges.length, 4);
  assert.equal(forms.components[0].cellCount, 5);
  assert.equal(forms.components[0].startGeneration, 40);
  assert.equal(forms.components[0].endGeneration, 42);
  assert.deepEqual(forms.components[0].profile.map(({ cellCount }) => cellCount), [2, 2, 1]);
  assert.ok(forms.edges.every(({ verticalOverlap }) => verticalOverlap === 0));
  assert.deepEqual(automatapoeiaConnectedForms(rows, {
    boundary: "fixed",
    polarity: "one",
    rowOffset: 40,
  }), forms);
  assert.ok(Object.isFrozen(forms));
  assert.ok(Object.isFrozen(forms.components[0]));
});

test("connected forms honor fixed, periodic, and per-row seam topology", () => {
  const rows = [[1, 0, 0, 0, 1]];
  const fixed = automatapoeiaConnectedForms(rows, { boundary: "fixed", polarity: "one" });
  const periodic = automatapoeiaConnectedForms(rows, { boundary: "periodic", polarity: "one" });
  const overridden = automatapoeiaConnectedForms(rows, {
    boundary: "fixed",
    boundaryByRow: ["periodic"],
    polarity: "one",
  });
  assert.equal(fixed.components.length, 2);
  assert.equal(periodic.components.length, 1);
  assert.equal(periodic.components[0].cellCount, 2);
  assert.equal(periodic.nodes.length, 1);
  assert.equal(periodic.nodes[0].wraps, true);
  assert.equal(overridden.components.length, 1);
  assert.deepEqual(overridden.boundaries, ["periodic"]);
});

test("connected-form edges preserve every merge and split branch", () => {
  const merge = automatapoeiaConnectedForms([
    [1, 0, 1],
    [0, 1, 0],
  ]);
  assert.equal(merge.edges.length, 2);
  assert.equal(merge.nodes.at(-1).parentEdgeIds.length, 2);
  assert.equal(merge.edges.filter(({ principal }) => principal).length, 1);
  assert.deepEqual(new Set(merge.edges.map(({ to }) => to)).size, 1);

  const split = automatapoeiaConnectedForms([
    [0, 1, 0],
    [1, 0, 1],
  ]);
  assert.equal(split.edges.length, 2);
  assert.equal(split.nodes[0].childEdgeIds.length, 2);
  assert.ok(split.edges.every(({ principal }) => principal));
  assert.equal(new Set(split.edges.map(({ from }) => from)).size, 1);
});

test("only a newly closed interior form becomes an island sound unit", () => {
  const interior = automatapoeiaConnectedForms([
    [0, 0, 0, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ]);
  assert.equal(interior.enclosedIslandCount, 1);
  assert.equal(interior.newlyClosedIslandCount, 1);
  assert.equal(interior.components[0].closedThisStep, true);
  assert.equal(interior.components[0].touches.fixedSide, false);
  assert.deepEqual(
    automatapoeiaConnectedSoundUnits(interior).map(({ objectKind, componentArea }) => ({
      objectKind,
      componentArea,
    })),
    [{ objectKind: "island", componentArea: 1 }],
  );

  const sideBackground = automatapoeiaConnectedForms([
    [0, 1, 1],
    [0, 1, 1],
    [1, 1, 1],
  ], { polarity: "zero", boundary: "fixed" });
  assert.equal(sideBackground.enclosedIslandCount, 0);
  assert.equal(sideBackground.newlyClosedIslandCount, 0);
  assert.equal(sideBackground.components[0].touches.fixedSide, true);
  assert.deepEqual(automatapoeiaConnectedSoundUnits(sideBackground), []);
});

test("connected vector paths are finite, deterministic, and split periodic seam links", () => {
  const stream = automatapoeiaConnectedForms([
    [1, 0, 0],
    [0, 0, 1],
  ], { boundary: "periodic" });
  const first = automatapoeiaConnectedPaths(stream);
  const second = automatapoeiaConnectedPaths(stream);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.equal(first.streamLinkCount, 1);
  assert.equal(first.linksPath, "M0.5 0.5L0 1M3 1L2.5 1.5");
  assert.equal(first.linkPath, first.linksPath);
  assert.doesNotMatch(first.linksPath, /NaN|Infinity|undefined/);

  const island = automatapoeiaConnectedPaths(automatapoeiaConnectedForms([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]));
  assert.equal(island.islandCellCount, 1);
  assert.equal(island.islandsPath, "M1 1h1v1h-1z");
  assert.equal(island.islandPath, island.islandsPath);
  assert.doesNotMatch(island.islandsPath, /NaN|Infinity|undefined/);
});

test("live regions retain their gaps and map continuously from left to right", () => {
  const cells = [false, true, true, false, true, false, false, true, true, true];
  assert.deepEqual(
    automatapoeiaLiveRuns(cells).map(({ start, end, center }) => ({ start, end, center })),
    [
      { start: 1, end: 2, center: 1.5 },
      { start: 4, end: 4, center: 4 },
      { start: 7, end: 9, center: 8 },
    ],
  );
  assert.equal(automatapoeiaFrequencyAtPosition(0), AUTOMATAPOEIA_FREQUENCY_MIN);
  assert.equal(automatapoeiaFrequencyAtPosition(1), AUTOMATAPOEIA_FREQUENCY_MAX);
  const plan = buildAutomatapoeiaEvents(cells, 8);
  assert.equal(plan.events.length, 3);
  assert.equal(plan.frameCount, 6_000);
  for (let index = 1; index < plan.events.length; index += 1) {
    assert.ok(plan.events[index].at > plan.events[index - 1].at);
    assert.ok(plan.events[index].frequency > plan.events[index - 1].frequency);
  }
  assert.ok(plan.events.some((event, index) => (
    index > 0 && plan.events[index - 1].at + plan.events[index - 1].duration > event.at
  )), "finite release tails can overlap");
});

test("event planning inverts foreground polarity and accepts connected sound units", () => {
  const cells = [1, 0, 0, 1];
  const ones = buildAutomatapoeiaEvents(cells, { polarity: "one", sampleRate: 8_000 });
  const zeros = buildAutomatapoeiaEvents(cells, { polarity: "zero", sampleRate: 8_000 });
  assert.equal(ones.polarity, "one");
  assert.equal(zeros.polarity, "zero");
  assert.deepEqual(ones.events.map(({ start, length }) => ({ start, length })), [
    { start: 0, length: 1 },
    { start: 3, length: 1 },
  ]);
  assert.deepEqual(zeros.events.map(({ start, length }) => ({ start, length })), [
    { start: 1, length: 2 },
  ]);

  const forms = automatapoeiaConnectedForms([
    [1, 0, 0, 0, 0],
    [1, 0, 0, 1, 0],
    [1, 0, 0, 0, 0],
  ], { polarity: "one", boundary: "fixed" });
  const connectedUnits = automatapoeiaConnectedSoundUnits(forms);
  assert.deepEqual(connectedUnits.map(({ objectKind }) => objectKind), ["stream", "island"]);
  const connected = buildAutomatapoeiaEvents([1, 0, 0, 0, 0], {
    boundary: "fixed",
    connectedUnits,
    objectMode: "connected",
    polarity: "one",
    sampleRate: 8_000,
  });
  assert.equal(connected.objectMode, "connected");
  assert.equal(connected.polarity, "one");
  assert.equal(connected.totalObjects, 2);
  assert.equal(connected.totalRuns, 2);
  assert.equal(connected.activeStreams, 1);
  assert.equal(connected.newlyClosedIslands, 1);
  assert.deepEqual(connected.events.map(({ objectKind }) => objectKind), ["stream", "island"]);
  assert.deepEqual(
    connected.events.map(({ componentArea, componentHeight }) => ({
      componentArea,
      componentHeight,
    })),
    [
      { componentArea: 3, componentHeight: 3 },
      { componentArea: 1, componentHeight: 1 },
    ],
  );
});

test("contour statistics follow run motion, persistence, growth, and edge change", () => {
  const previous = [0, 1, 1, 0, 0];
  const current = [0, 0, 1, 1, 0];
  const shifted = automatapoeiaContourStats(current, previous, "fixed");
  assert.equal(shifted.activity, 0.4);
  assert.equal(shifted.densityDelta, 0);
  assert.equal(shifted.centroidDelta, 0.25);
  assert.equal(shifted.persistence, 1 / 3);
  assert.equal(shifted.runs.length, 1);
  assert.equal(shifted.runs[0].centerDrift, 0.25);
  assert.equal(shifted.runs[0].verticalPersistence, 0.5);
  assert.ok(shifted.wallFlux > 0);
  const traced = buildAutomatapoeiaEvents(current, {
    contourAmount: 0,
    pitchTrace: 1,
    previousCells: previous,
  });
  assert.ok(traced.events[0].frequencyStart < traced.events[0].frequency);

  const grown = automatapoeiaContourStats(
    [0, 1, 1, 1, 0],
    [0, 0, 1, 0, 0],
    "fixed",
  );
  assert.equal(grown.centroidDelta, 0);
  assert.equal(grown.densityDelta, 0.4);
  assert.equal(grown.runs[0].expansion, 0.4);
  assert.ok(grown.spreadDelta > 0);

  const empty = automatapoeiaContourStats([], [], "periodic");
  assert.ok(Object.values(empty).every((value) => (
    typeof value !== "number" || Number.isFinite(value)
  )));
});

test("periodic contour tracking merges the seam and follows the shortest circular path", () => {
  const seamRun = automatapoeiaLiveRuns([1, 1, 0, 0, 1], "periodic");
  assert.equal(seamRun.length, 1);
  assert.deepEqual(
    (({ start, end, center, length, wraps }) => ({ start, end, center, length, wraps }))(seamRun[0]),
    { start: 4, end: 1, center: 0, length: 3, wraps: true },
  );
  assert.equal(automatapoeiaLiveRuns([1, 1, 0, 0, 1], "fixed").length, 2);

  const previous = [1, 0, 0, 0, 0, 0, 1, 1];
  const current = [1, 1, 0, 0, 0, 0, 0, 1];
  const stats = automatapoeiaContourStats(current, previous, "periodic");
  assert.equal(stats.runCount, 1);
  assert.equal(stats.centroidDefined, true);
  assert.ok(Math.abs(stats.centroid - 1 / 16) < 1e-12);
  assert.ok(Math.abs(stats.centroidDelta - 1 / 8) < 1e-12);
  assert.equal(stats.runs[0].born, false);
  assert.ok(Math.abs(stats.runs[0].centerDrift - 1 / 8) < 1e-12);
  assert.equal(stats.runs[0].verticalPersistence, 2 / 3);

  const allLive = automatapoeiaContourStats(Array(8).fill(1), Array(8).fill(1), "periodic");
  assert.equal(allLive.runCount, 1);
  assert.equal(allLive.runs[0].length, 8);
  assert.equal(allLive.centroidDefined, false);
  assert.equal(allLive.centroidDelta, 0);

  const plan = buildAutomatapoeiaEvents([1, 1, 0, 0, 1], {
    boundary: "periodic",
    phraseShape: "bands",
    sampleRate: 8_000,
  });
  assert.equal(plan.events.length, 1);
  assert.equal(plan.events[0].length, 3);
  assert.ok(plan.events[0].gateFrames > 0);
});

test("signed swing preserves pair duration and monotonically bends within-row time", () => {
  const rate = 8;
  assert.equal(
    automatapoeiaSwingInterval(0, rate, 0.24)
      + automatapoeiaSwingInterval(1, rate, 0.24),
    2 / rate,
  );
  assert.ok(automatapoeiaSwingInterval(0, rate, 0.24) > 1 / rate);
  assert.ok(automatapoeiaSwingInterval(0, rate, -0.24) < 1 / rate);
  const straight = [0, 0.125, 0.25, 0.5, 0.75, 1].map((value) => (
    automatapoeiaSwingPosition(value, 0)
  ));
  assert.deepEqual(straight, [0, 0.125, 0.25, 0.5, 0.75, 1]);
  const swung = [0, 0.125, 0.25, 0.5, 0.75, 1].map((value) => (
    automatapoeiaSwingPosition(value, 0.3)
  ));
  assert.ok(swung.every((value, index) => index === 0 || value >= swung[index - 1]));
  assert.ok(swung[1] > straight[1]);
  const retimed = automatapoeiaRetimedAccumulator(0.8, 0, 1, 0, 24, 0);
  assert.ok(retimed < automatapoeiaSwingInterval(0, 24, 0));
  assert.ok(Math.abs(
    retimed / automatapoeiaSwingInterval(0, 24, 0) - 0.8,
  ) < 1e-12);
  assert.ok(
    automatapoeiaRetimedAccumulator(2, 0, 1, 0, 24, 0)
      < automatapoeiaSwingInterval(0, 24, 0),
  );
});

test("audio mappings keep exact row slots while shaping pitch and cellular timbre", () => {
  const cells = [0, 1, 0, 1, 1, 0, 0, 1];
  const previousCells = [0, 0, 1, 1, 0, 0, 1, 0];
  const reverse = buildAutomatapoeiaEvents(cells, {
    detail: 8,
    frequencyMin: 80,
    frequencyMax: 800,
    pitchCurve: "reverse",
    previousCells,
    rate: 12,
    sampleRate: 48_000,
    timbreSource: "activity",
  });
  assert.equal(reverse.frameCount, 4_000);
  assert.equal(reverse.duration, 1 / 12);
  assert.equal(reverse.activity, 0.625);
  assert.ok(reverse.events[0].frequency > reverse.events.at(-1).frequency);
  assert.ok(reverse.events.every((event) => Number.isInteger(event.startFrame) && Number.isInteger(event.frameCount)));
  assert.equal(automatapoeiaPitchResponse(0.25, "late"), 0.0625);
  const silent = buildAutomatapoeiaEvents(Array(8).fill(0), { rate: 12, sampleRate: 48_000 });
  assert.equal(silent.frameCount, 4_000);
  assert.equal(silent.events.length, 0);
  assert.equal(silent.bufferFrameCount, silent.frameCount);
  assert.equal(silent.renderDuration, silent.duration);
  const denseFast = buildAutomatapoeiaEvents(
    Array.from({ length: 127 }, (_, index) => index % 2),
    { detail: 16, rate: 24, release: 2, sampleRate: 48_000 },
  );
  assert.equal(denseFast.eventBudget, 3);
  assert.equal(denseFast.events.length, 3);
  assert.equal(denseFast.detailCapped, true);
  assert.equal(denseFast.releaseCapped, true);
  assert.equal(denseFast.releaseLimit, denseFast.duration * 6);
  assert.ok(denseFast.renderDuration <= denseFast.duration * 9);
});

test("ADSR and release tails are finite, controllable, and independent of row slots", () => {
  const plan = buildAutomatapoeiaEvents([0, 1, 1, 0], {
    attack: 0.01,
    decay: 0.02,
    release: 0.3,
    rate: 10,
    sampleRate: 8_000,
    strikeLength: 1.2,
    sustain: 0.6,
  });
  const event = plan.events[0];
  assert.equal(automatapoeiaEnvelopeAmplitude(0, event), 0);
  assert.ok(automatapoeiaEnvelopeAmplitude(event.attackFrames, event) > 0.99);
  assert.ok(automatapoeiaEnvelopeAmplitude(event.gateFrames - 1, event) > 0);
  assert.equal(automatapoeiaEnvelopeAmplitude(event.frameCount - 1, event), 0);
  assert.equal(automatapoeiaEnvelopeAmplitude(event.frameCount, event), 0);
  assert.ok(plan.bufferFrameCount > plan.frameCount);
  assert.ok(plan.renderDuration > plan.duration);

  const chord = buildAutomatapoeiaEvents([1, 0, 1, 0, 1], {
    detail: 8,
    sampleRate: 8_000,
    timeSpread: 0,
  });
  assert.equal(new Set(chord.events.map(({ startFrame }) => startFrame)).size, 1);

  const bands = buildAutomatapoeiaEvents([1, 0, 1, 1, 1], {
    contourAmount: 0,
    phraseShape: "bands",
    sampleRate: 8_000,
    strikeLength: 1,
    timeSpread: 1,
  });
  assert.ok(bands.events[1].gateFrames > bands.events[0].gateFrames);
  const centers = buildAutomatapoeiaEvents([1, 0, 1, 1, 1], {
    contourAmount: 0,
    phraseShape: "centers",
    sampleRate: 8_000,
    strikeLength: 1,
  });
  assert.equal(centers.events[0].gateFrames, centers.events[1].gateFrames);
});

test("zero contour depth is neutral and physical voices fill long finite envelopes", () => {
  const cells = [0, 1, 1, 0, 0, 1, 0, 0];
  const previousCells = [1, 1, 0, 0, 0, 0, 1, 0];
  for (const voice of ["glass-lattice", "wavefold-ribbon", "formant-dust"]) {
    const motion = renderAutomatapoeiaRow(cells, {
      contourAmount: 0,
      contourSource: "motion",
      previousCells,
      rate: 4,
      sampleRate: 8_000,
      seed: 23,
      voice,
    });
    const flux = renderAutomatapoeiaRow(cells, {
      contourAmount: 0,
      contourSource: "edge-flux",
      previousCells,
      rate: 4,
      sampleRate: 8_000,
      seed: 23,
      voice,
    });
    assert.ok(motion.events.every((event) => event.contour === 0.5));
    assert.deepEqual(motion.samples, flux.samples);
  }

  for (const voice of ["rattlesnake", "karplus-carpet", "ouroboros"]) {
    const row = renderAutomatapoeiaRow([0, 1, 1, 0], {
      attack: 0.01,
      contourAmount: 0,
      decay: 0.02,
      phraseShape: "centers",
      rate: 1,
      release: 1,
      sampleRate: 8_000,
      seed: 31,
      strikeLength: 1,
      sustain: 1,
      timeSpread: 0,
      voice,
    });
    const event = row.events[0];
    const lateStart = event.startFrame + Math.round(row.sampleRate * 0.5);
    const lateEnd = lateStart + Math.round(row.sampleRate * 0.15);
    assert.ok(signalMetrics(row.samples.slice(lateStart, lateEnd)).rms > 0.00001);
  }
});

test("each Automatapoeia material renders an audible bounded mono row", () => {
  const cells = Array.from({ length: 72 }, (_, index) => (
    (index >= 3 && index <= 7)
    || (index >= 20 && index <= 22)
    || (index >= 38 && index <= 48)
    || index === 66
  ));
  const rendered = AUTOMATAPOEIA_VOICES.map(({ id }) => renderAutomatapoeiaRow(cells, {
    rate: 8,
    sampleRate: 48_000,
    generation: 5,
    rule: 30,
    seed: 17,
    voice: id,
  }));

  for (const row of rendered) {
    assert.ok(row.samples instanceof Float32Array);
    assert.equal(row.samples.length, Math.round(row.renderDuration * row.sampleRate));
    assert.ok(row.renderDuration > row.duration);
    assert.ok(row.events.length > 0 && row.events.length <= 8);
    const { peak, rms } = signalMetrics(row.samples);
    assert.ok(peak > 0.05 && peak <= 0.781);
    assert.ok(rms > 0.003);
  }

  for (let first = 0; first < rendered.length; first += 1) {
    for (let second = first + 1; second < rendered.length; second += 1) {
      assert.ok(differenceRms(rendered[first].samples, rendered[second].samples) > 0.002);
    }
  }
  const repeated = renderAutomatapoeiaRow(cells, {
    generation: 5,
    rate: 8,
    rule: 30,
    sampleRate: 48_000,
    seed: 17,
    voice: "rattlesnake",
  });
  assert.deepEqual(repeated.samples, rendered[0].samples);
});
