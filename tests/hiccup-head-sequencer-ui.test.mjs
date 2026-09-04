import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readSequencerSources() {
  const [app, css, html] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("hiccup-head.css", root), "utf8"),
    readFile(new URL("hiccup-head.html", root), "utf8"),
  ]);
  return { app, css, html };
}

function topLevelFunctionSegments(source) {
  const starts = [...source.matchAll(/^(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/gm)]
    .map((match) => match.index);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length));
}

function functionNamed(source, name) {
  return topLevelFunctionSegments(source).find((segment) => (
    new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`).test(segment)
  )) ?? "";
}

function cssRulesContaining(source, selectorFragment) {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.includes(selectorFragment))
    .map((match) => match[0])
    .join("\n");
}

function pixelValues(source, property) {
  const pattern = new RegExp(`${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, "g");
  return [...source.matchAll(pattern)].map((match) => Number(match[1]));
}

test("the sequencer stays one tall, unwrapped, zero-gap lane at every length", async () => {
  const { app, css } = await readSequencerSources();
  const gridRules = cssRulesContaining(css, ".hiccup-head-sequence-grid");
  const rowRules = cssRulesContaining(css, ".hiccup-head-grid-row");
  const slotRules = cssRulesContaining(css, ".hiccup-head-step-slot");
  const cellRules = cssRulesContaining(css, ".hiccup-head-step-cell");
  const barRules = cssRulesContaining(css, ".hiccup-head-step-volume-lane");
  const laneRules = `${gridRules}\n${rowRules}`;
  const columnsForLength = functionNamed(app, "sequenceColumnsForLength");

  assert.ok(columnsForLength, "sequenceColumnsForLength must remain independently testable");
  assert.doesNotMatch(app, /hiccup-head-step-number|gridHeadingsByStep/);
  assert.doesNotMatch(css, /\.hiccup-head-step-number/);
  assert.match(columnsForLength, /const\s+safeLength\s*=/);
  assert.match(
    columnsForLength,
    /return\s+safeLength\s*;/,
    "32, 48, and 64 steps should remain one row instead of being banked into many lines",
  );
  assert.doesNotMatch(columnsForLength, /Math\.(?:ceil|min|max)\s*\(\s*safeLength\s*\/|return\s+\d+/);

  assert.match(app, /\.style\.setProperty\(\s*["']--step-velocity["']/);
  assert.match(
    laneRules,
    /repeat\(\s*var\(--hiccup-head-sequence-(?:steps|columns)[^)]*\)\s*,\s*(?:minmax\(\s*0\s*,\s*1fr\s*\)|1fr)\s*\)/,
    "step columns should divide the available lane instead of retaining a wide fixed minimum",
  );
  assert.match(laneRules, /(?:^|[;{]\s*)(?:column-)?gap\s*:\s*0(?:px)?\s*(?:;|})/m);
  assert.match(slotRules, /(?:^|[;{]\s*)(?:row-)?gap\s*:\s*0(?:px)?\s*(?:;|})/m);
  assert.doesNotMatch(laneRules, /repeat\([^;{}]*,\s*\d{2,}px\s*\)/);
  assert.doesNotMatch(laneRules, /(?:column-)?gap\s*:\s*[1-9]\d*(?:\.\d+)?px/);
  assert.doesNotMatch(slotRules, /(?:row-)?gap\s*:\s*[1-9]\d*(?:\.\d+)?px/);
  assert.match(barRules, /--step-velocity/);
  assert.match(
    barRules,
    /(?:height|block-size)\s*:\s*calc\([^;{}]*var\(--step-velocity\)[^;{}]*\)/,
    "the visible rectangle height should be calculated from the step velocity",
  );
  assert.match(barRules, /bottom\s*:\s*0/);
  assert.match(
    cellRules,
    /min-height\s*:\s*208px/,
    "desktop step rectangles should be as tall as the WebGPU303-inspired lane",
  );
  assert.match(
    cellRules,
    /min-height\s*:\s*1(?:4\d|5\d|6\d)px/,
    "small/coarse screens may use a roughly 150px tall step without collapsing it",
  );
});

test("continuous step volume uses zero as the only off state and draws an X handle", async () => {
  const { app, css, html } = await readSequencerSources();
  const velocitySetter = functionNamed(app, "setSequenceStepVelocity");
  const pointerMapping = functionNamed(app, "sequenceVelocityFromPointer");
  const pointerPainter = functionNamed(app, "applySequenceVelocityPointer");
  const stepPainter = functionNamed(app, "paintSequenceVelocityStep");
  const paintRenderer = functionNamed(app, "renderSequenceVelocityPaint");
  const gridBuilder = functionNamed(app, "buildSequenceGrid");

  assert.doesNotMatch(
    html,
    /id="selectedStepVelocity"|hiccup-head-step-editor-velocity/,
    "volume belongs inside each step rather than in a floating editor",
  );
  assert.ok(velocitySetter, "step volume needs one canonical setter");
  assert.match(velocitySetter, /clamp\(numericVelocity, 0, 1\)/);
  assert.match(velocitySetter, /const active = velocity > 0/);
  assert.match(velocitySetter, /if \(active\)[\s\S]*?pattern\[sound\.id\]\[step\] = velocity/);
  assert.match(velocitySetter, /else \{[\s\S]*?clearStepExcept\(step, ""\)/);
  assert.doesNotMatch(velocitySetter, /cycleStepVelocity|enabled|disabled/);

  assert.ok(pointerMapping, "pointer height needs a direct volume mapping");
  assert.match(pointerMapping, /querySelector\("\.hiccup-head-step-volume-lane"\)/);
  assert.match(pointerMapping, /\(rect\.bottom - clientY\) \/ rect\.height/);
  assert.match(pointerMapping, /Math\.round\(normalized \* 100\) \/ 100/);
  assert.ok(pointerPainter, "held pointer movement needs a grid-wide volume painter");
  assert.match(pointerPainter, /sequencePaintTargetAtX\(edit, event\.clientX\)/);
  assert.match(pointerPainter, /for \(let offset = 1; offset <= distance; offset \+= 1\)/);
  assert.match(pointerPainter, /previous\.velocity \+ \(velocity - previous\.velocity\) \* progress/);
  assert.match(stepPainter, /soundIds\[physicalStep\]/, "mixed sounds must survive touching zero");
  assert.match(stepPainter, /rebuildOwnership:\s*false/);
  assert.match(stepPainter, /markCustom:\s*false/);
  assert.match(paintRenderer, /if \(edit\.needsOwnershipRebuild\) rebuildSequenceStepOwnership\(\)/);
  assert.match(app, /addEventListener\("pointerdown", handleSequenceVelocityPointerDown\)/);
  assert.match(app, /addEventListener\("pointermove", handleSequenceVelocityPointerMove\)/);
  assert.match(app, /addEventListener\("pointerup", handleSequenceVelocityPointerEnd\)/);
  assert.match(app, /event\.detail > 0/);

  assert.match(gridBuilder, /hitMark\.className = "hiccup-head-step-hit-mark"/);
  assert.match(gridBuilder, /hitMark\.textContent = "×"/);
  assert.match(css, /\.hiccup-head-step-hit-mark\s*\{[\s\S]*?var\(--step-velocity/);
  assert.match(css, /\.hiccup-head-step-cell[\s\S]*?touch-action:\s*none/);
  assert.match(css, /\.hiccup-head-step-cell\[data-active="true"\]/);
  assert.doesNotMatch(gridBuilder, /hiccup-head-step-velocity-number/);
  assert.doesNotMatch(css, /\.hiccup-head-step-velocity-number/);
  assert.doesNotMatch(functionNamed(app, "renderCell"), /button\.title\s*=/);
});

test("each step shows its sound number once while collapsed choices remain recognizable", async () => {
  const { app } = await readSequencerSources();
  const compactOptions = functionNamed(app, "compactSoundOptions");
  const gridBuilder = functionNamed(app, "buildSequenceGrid");
  const padBuilder = functionNamed(app, "buildPadGrid");

  assert.ok(compactOptions, "compactSoundOptions must remain independently testable");
  assert.doesNotMatch(compactOptions, /textContent\s*=\s*sequenceSoundNumberById\.get\(sound\.id\)/);
  assert.match(compactOptions, /emptyOption\.textContent\s*=\s*["']\+["']/);
  assert.match(compactOptions, /selectedOption\.textContent\s*=\s*["']⌄["']/);
  assert.doesNotMatch(
    compactOptions,
    /textContent\s*=\s*sequenceSoundLabel\(sound\)/,
    "the collapsed value should not spend horizontal space on the sound name",
  );
  assert.ok(gridBuilder, "buildSequenceGrid must remain independently testable");
  assert.match(gridBuilder, /soundNumber\.className\s*=\s*["']hiccup-head-step-sound-number["']/);
  assert.ok(padBuilder, "buildPadGrid must remain independently testable");
  assert.match(padBuilder, /sequenceSoundNumberById\.get\(sound\.id\)/);
  assert.match(padBuilder, /(?:number|badge)\.textContent\s*=\s*sequenceSoundNumberById\.get\(sound\.id\)/i);
  assert.match(padBuilder, /button\.append\([^)]*(?:number|badge)/i);
});

test("a dedicated step audition previews audio without editing the pattern", async () => {
  const { app } = await readSequencerSources();
  const gridBuilder = functionNamed(app, "buildSequenceGrid");
  const previewHandler = functionNamed(app, "previewSequenceStep");

  assert.ok(gridBuilder, "buildSequenceGrid must remain independently testable");
  assert.match(gridBuilder, /for\s*\([^)]*step[^)]*\)\s*\{/);
  assert.match(gridBuilder, /preview\.className\s*=\s*["']hiccup-head-step-audition["']/);
  assert.match(
    gridBuilder,
    /(?:cell|slot)\.append\([^;]*preview[^;]*\)/,
    "every generated step should contain its own preview button",
  );
  assert.match(gridBuilder, /preview\.addEventListener\(\s*["']click["'][\s\S]*?previewSequenceStep\(step\)/);

  // Inspect only the named preview operation. A broad search through a builder
  // also sees unrelated inline listeners and can falsely attribute their edits
  // to auditioning.
  assert.ok(previewHandler, "previewSequenceStep must remain independently testable");
  assert.match(previewHandler, /triggerSound\(\s*event\.sound\.id\s*,\s*event\.velocity\s*\)/);
  assert.doesNotMatch(previewHandler, /pattern\s*\[[^\]]+\]\s*\[/);
  assert.doesNotMatch(
    previewHandler,
    /\b(?:clearStepExcept|cycleStepVelocity|markPatternCustom|setStepSound|renderPattern)\s*\(/,
    "preview must never program, clear, or otherwise mutate the sequence",
  );
  const gridFocusHandler = functionNamed(app, "handleSequenceGridFocus");
  assert.doesNotMatch(
    gridFocusHandler,
    /hiccup-head-step-audition/,
    "previewing must not select a step or reveal the contextual editor",
  );
});

test("hold-span controls stay contextual while volume remains baked into each step", async () => {
  const { app, html } = await readSequencerSources();
  const contextMarkup = html.match(
    /<div\s+class=["']hiccup-head-step-context["'][\s\S]*?<\/div>\s*<div\s+class=["']hiccup-head-grid-scroll["']/,
  )?.[0] ?? "";
  const contextUpdater = functionNamed(app, "updateSelectedStepContext");

  assert.doesNotMatch(html, /hiccup-head-selected-step-inspector|id=["']selectedStepInspector["']/);
  assert.doesNotMatch(html, /id=["']selectedStepLabel["']/);
  assert.ok(contextMarkup, "the contextual step controls need stable markup");
  assert.match(contextMarkup, /class=["']hiccup-head-step-context["']/);
  assert.doesNotMatch(contextMarkup, /Volume|selectedStepVelocity/i);
  assert.match(contextMarkup, /id=["']selectedStepSpan["'][^>]*type=["']range["'][^>]*min=["']1["'][^>]*max=["']8["']/);
  assert.doesNotMatch(contextMarkup, /selectedStepMode|Across span|>\s*Repeat\s*</i);
  assert.match(contextMarkup, /id=["']selectedStepClear["']/i);

  assert.ok(contextUpdater, "updateSelectedStepContext must remain independently testable");
  assert.match(contextUpdater, /closest\(\s*["']\.hiccup-head-step-slot["']\s*\)/);
  assert.match(
    contextUpdater,
    /selectedSlot\.append\(context\)/,
    "the contextual controls should move into the selected step rather than consume a full row",
  );

  for (const controlId of [
    "selectedStepSpan",
    "selectedStepClear",
  ]) {
    assert.match(
      app,
      new RegExp(`(?:\\$\\(["']${controlId}["']\\)|${controlId})[\\s\\S]{0,160}?\\.addEventListener\\(`),
      `${controlId} must be wired to behavior, not just present in the markup`,
    );
  }
  assert.match(
    app,
    /function\s+updateSelectedStepContext\s*\(/,
    "selection changes need to refresh the contextual controls",
  );
});

test("step span metadata schedules holds and repeats inside the lookahead clock", async () => {
  const { app } = await readSequencerSources();
  const schedulingStart = app.search(/function\s+availableGestureSecondsUntilNextNote\s*\(/);
  const schedulingEnd = app.search(/(?:async\s+)?function\s+startSequence\s*\(/);
  assert.ok(schedulingStart >= 0 && schedulingEnd > schedulingStart);
  const scheduling = app.slice(schedulingStart, schedulingEnd);

  assert.match(app, /(?:sequence|step)[A-Za-z]*Metadata|(?:sequence|step)[A-Za-z]*Meta/);
  assert.match(scheduling, /while\s*\(\s*nextStepTime\s*<\s*audioContext\.currentTime\s*\+\s*lookaheadSeconds\s*\)/);
  assert.match(scheduling, /sequenceStepIntervalSeconds\s*\(/);
  assert.match(scheduling, /gestureDurationSeconds/);
  assert.match(scheduling, /["']hold["']/i);
  assert.match(scheduling, /["']repeat["']/i);
  assert.match(scheduling, /\bspan\b|spanSteps|lengthSteps/i);
  assert.match(scheduling, /postStrike\s*\(/);
  assert.match(
    scheduling,
    /(?:for|while)\s*\([^)]*(?:span|lengthSteps|spanSteps)[^)]*\)/i,
    "repeat mode should visit the steps covered by its span",
  );
});

test("Play and Pause stay compact without dropping below a 44px touch target", async () => {
  const { app, css, html } = await readSequencerSources();
  const playRules = cssRulesContaining(css, "#playButton");
  const transportButtonRules = cssRulesContaining(css, ".hiccup-head-transport button");
  const relevantRules = `${playRules}\n${transportButtonRules}`;
  const targetHeights = [
    ...pixelValues(relevantRules, "min-height"),
    ...pixelValues(relevantRules, "height"),
  ];
  const compactWidths = [
    ...pixelValues(playRules, "width"),
    ...pixelValues(playRules, "max-width"),
  ];

  assert.ok(targetHeights.some((value) => value >= 44), "Play/Pause needs a 44px or taller target");
  assert.ok(compactWidths.length > 0, "Play/Pause needs an explicit compact width contract");
  assert.ok(compactWidths.some((value) => value <= 96), "Play/Pause should be no wider than 96px");
  assert.match(html, /id=["']playButton["'][^>]*aria-pressed=["']false["'][^>]*aria-label=["']Play sequence["']/);
  assert.match(html, /id=["']restartButton["'][^>]*aria-label=["']Back to beginning["']/);

  const startSequence = functionNamed(app, "startSequence");
  const stopSequence = functionNamed(app, "stopSequence");
  assert.match(startSequence, /playButton[\s\S]{0,100}?aria-label[\s\S]{0,80}?Pause/i);
  assert.match(stopSequence, /playButton[\s\S]{0,100}?aria-label[\s\S]{0,80}?Play/i);
});

test("mobile keeps the face sticky while one shell scrolls through sequencer and controls", async () => {
  const { css } = await readSequencerSources();
  const shellRules = cssRulesContaining(css, ".hiccup-head-shell");
  const stageRules = cssRulesContaining(css, ".hiccup-head-stage");
  const panelRules = cssRulesContaining(css, ".hiccup-head-panel");

  assert.match(shellRules, /overflow-y\s*:\s*auto/);
  assert.match(shellRules, /height\s*:\s*calc\(100dvh\s*-\s*(?:54|58)px\)/);
  assert.match(stageRules, /position\s*:\s*sticky/);
  assert.match(stageRules, /top\s*:\s*0/);
  assert.match(stageRules, /z-index\s*:\s*[1-9]\d*/);
  assert.match(
    panelRules,
    /overflow\s*:\s*visible/,
    "the panel must participate in the shell scroll instead of trapping its own vertical scroll",
  );
});
