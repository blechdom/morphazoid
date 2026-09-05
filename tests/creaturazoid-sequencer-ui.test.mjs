import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CREATURAZOID_SOUNDS } from "../src/creaturazoid.js";

const root = new URL("../", import.meta.url);

async function readSequencerSources() {
  const [app, css, html] = await Promise.all([
    readFile(new URL("creaturazoid-app.js", root), "utf8"),
    readFile(new URL("creaturazoid.css", root), "utf8"),
    readFile(new URL("creaturazoid.html", root), "utf8"),
  ]);
  return { app, css, html };
}

function topLevelFunctionSegments(source) {
  const starts = [...source.matchAll(/^(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/gm)]
    .map((match) => match.index);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length));
}

function functionNamed(source, name) {
  const expression = new RegExp("^(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  return topLevelFunctionSegments(source).find((segment) => expression.test(segment)) ?? "";
}

function cssRulesContaining(source, selectorFragment) {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.includes(selectorFragment))
    .map((match) => match[0])
    .join("\n");
}

test("the 32-step sequencer stays one unwrapped zero-gap dual-lane row through 64 steps", async () => {
  const { app, css, html } = await readSequencerSources();
  const gridBuilder = functionNamed(app, "buildSequenceGrid");
  const gridRules = cssRulesContaining(css, ".creaturazoid-sequence-grid");
  const rowRules = cssRulesContaining(css, ".creaturazoid-grid-single-lane");
  const slotRules = cssRulesContaining(css, ".creaturazoid-step-slot");
  const cellRules = cssRulesContaining(css, ".creaturazoid-step-cell");
  const soundLaneRules = cssRulesContaining(css, ".creaturazoid-step-sound-lane");
  const laneRules = gridRules + "\n" + rowRules;

  assert.equal(CREATURAZOID_SOUNDS.length, 50);
  assert.equal(CREATURAZOID_SOUNDS[0].id, "roar");
  assert.equal(CREATURAZOID_SOUNDS.at(-1).id, "jumping");
  assert.match(html, /id="sequenceGrid"[^>]+aria-rowcount="1"[^>]+aria-colcount="32"/);
  assert.match(html, /id="sequenceLengthEntry"[^>]+min="1"[^>]+max="64"[^>]+value="32"/);
  assert.match(html, /id="sequenceLength"[^>]+min="1"[^>]+max="64"[^>]+value="32"/);
  assert.match(html, /data-sequence-length="64"/);

  assert.ok(gridBuilder, "buildSequenceGrid must remain independently testable");
  assert.match(gridBuilder, /gridCellsByStep = Array\(pattern\.length\)\.fill\(null\)/);
  assert.match(gridBuilder, /gridSoundLanesByStep = Array\(pattern\.length\)\.fill\(null\)/);
  assert.match(gridBuilder, /--sequence-columns", String\(pattern\.length\)/);
  assert.match(gridBuilder, /--sequence-min-width", \x60\$\{pattern\.length \* 42\}px\x60/);
  assert.match(gridBuilder, /setAttribute\("aria-rowcount", "1"\)/);
  assert.match(gridBuilder, /setAttribute\("aria-colcount", String\(pattern\.length\)\)/);
  assert.match(gridBuilder, /className = "creaturazoid-grid-row creaturazoid-grid-single-lane"/);
  assert.match(gridBuilder, /for \(let step = 0; step < pattern\.length; step \+= 1\)/);
  assert.match(gridBuilder, /slot\.append\(cell, preview, selector, soundLaneShell\)/);
  assert.doesNotMatch(gridBuilder, /headerRow|gridHeadingsByStep|creaturazoid-step-number/);

  assert.match(gridRules, /width:\s*max\(100%, var\(--sequence-min-width, 100%\)\)/);
  assert.match(
    laneRules,
    /repeat\(var\(--sequence-columns, 32\), minmax\(0, 1fr\)\)/,
  );
  assert.match(rowRules, /(?:^|[;{]\s*)(?:column-)?gap:\s*0(?:px)?\s*(?:;|})/m);
  assert.match(slotRules, /grid-template-rows:\s*136px[^;]*--step-selector-height[^;]*--step-sound-lane-height/);
  assert.match(slotRules, /--step-sound-lane-height:\s*72px/);
  assert.match(slotRules, /--step-sound-lane-height:\s*64px/);
  assert.match(slotRules, /(?:^|[;{]\s*)(?:row-)?gap:\s*0(?:px)?\s*(?:;|})/m);
  assert.match(cellRules, /min-height:\s*136px/);
  assert.match(cellRules, /min-height:\s*104px/);
  assert.match(soundLaneRules, /min-height:\s*44px/);
  assert.match(soundLaneRules, /touch-action:\s*none/);
  assert.match(css, /grid-template-rows:\s*minmax\(250px, 1fr\) 8px minmax\(280px, 37dvh\)/);
});

test("continuous y-volume reaches zero, interpolates horizontally, and preserves each step sound", async () => {
  const { app, css } = await readSequencerSources();
  const velocitySetter = functionNamed(app, "setSequenceStepVelocity");
  const pointerMapping = functionNamed(app, "sequenceVelocityFromPointer");
  const stepPainter = functionNamed(app, "paintSequenceVelocityStep");
  const pointerPainter = functionNamed(app, "applySequenceVelocityPointer");
  const cellRenderer = functionNamed(app, "renderSequenceCell");
  const gridBuilder = functionNamed(app, "buildSequenceGrid");
  const bindings = functionNamed(app, "bindControls");
  const pointerEnd = functionNamed(app, "handleSequenceVelocityPointerEnd");
  const clickHandler = functionNamed(app, "handleSequenceGridClick");
  const fillRules = cssRulesContaining(css, ".creaturazoid-step-volume-lane::before");

  assert.ok(velocitySetter, "step volume needs one canonical setter");
  assert.match(velocitySetter, /clamp\(numeric, 0, 1\)/);
  assert.match(
    velocitySetter,
    /pattern = setCreaturazoidStep\(pattern, step, velocity > 0 \? sound\.id : null, velocity\)/,
  );
  assert.match(velocitySetter, /return \{ active: velocity > 0, sound, step, velocity \}/);
  assert.doesNotMatch(velocitySetter, /cycleCreaturazoidStep|resetSequenceSchedule|silencePhysicalModel/);

  assert.match(pointerMapping, /querySelector\("\.creaturazoid-step-volume-lane"\)/);
  assert.match(pointerMapping, /\(rect\.bottom - clientY\) \/ rect\.height/);
  assert.match(pointerMapping, /Math\.round\(clamp\([^;]+\* 100\) \/ 100/);
  assert.match(stepPainter, /current\?\.soundId \?\? edit\.soundIds\[step\] \?\? edit\.soundId/);
  assert.match(stepPainter, /markCustom:\s*false/);
  assert.match(stepPainter, /render:\s*false/);
  assert.match(pointerPainter, /sequencePaintTargetAtX\(edit, event\.clientX\)/);
  assert.match(pointerPainter, /for \(let offset = 1; offset <= distance; offset \+= 1\)/);
  assert.match(pointerPainter, /previous\.velocity \+ \(velocity - previous\.velocity\) \* progress/);

  assert.match(cellRenderer, /button\.dataset\.active = String\(active\)/);
  assert.match(cellRenderer, /button\.dataset\.velocity = String\(velocity\)/);
  assert.match(cellRenderer, /--step-velocity", String\(clamp\(velocity, 0, 1\)\)/);
  assert.match(fillRules, /height:\s*calc\(var\(--step-velocity\) \* 100%\)/);
  assert.match(fillRules, /bottom:\s*0/);
  assert.doesNotMatch(gridBuilder, /step-velocity-number|hitMark|textContent\s*=\s*["']×["']/);
  assert.match(css, /\.creaturazoid-step-cell\s*\{[\s\S]*?touch-action:\s*none/);
  assert.match(css, /\.creaturazoid-step-cell\[data-active="true"\]/);
  assert.match(bindings, /pointerdown[\s\S]*?handleSequenceVelocityPointerDown/);
  assert.match(bindings, /pointermove[\s\S]*?handleSequenceVelocityPointerMove/);
  assert.match(bindings, /pointerup[\s\S]*?handleSequenceVelocityPointerEnd/);
  assert.match(bindings, /pointercancel[\s\S]*?handleSequenceVelocityPointerEnd/);
  assert.doesNotMatch(pointerEnd, /triggerSound|ensureAudio|scheduleSound|resetSequenceSchedule|silencePhysicalModel/);
  assert.doesNotMatch(clickHandler, /audition|triggerSound|ensureAudio|scheduleSound/);
});

test("each exact 50-sound dropdown expands lazily and collapses to its selected title", async () => {
  const { app, css } = await readSequencerSources();
  const fullOptions = functionNamed(app, "fullSoundOptions");
  const compactOptions = functionNamed(app, "compactSoundOptions");
  const expandSelector = functionNamed(app, "expandStepSoundSelector");
  const compactSelector = functionNamed(app, "compactStepSoundSelector");
  const gridBuilder = functionNamed(app, "buildSequenceGrid");
  const bindings = functionNamed(app, "bindControls");

  assert.match(fullOptions, /empty\.textContent = "—"/);
  assert.match(fullOptions, /const options = \[empty\]/);
  assert.match(fullOptions, /for \(const sound of CREATURAZOID_SOUNDS\)/);
  assert.match(fullOptions, /option\.textContent = sequenceSoundLabel\(sound\)/);
  assert.match(compactOptions, /empty\.textContent = "\+"/);
  assert.match(compactOptions, /selected\.textContent = sound\.label/);
  assert.doesNotMatch(compactOptions, /sequenceSoundLabel\(sound\)/);
  assert.match(expandSelector, /replaceChildren\(\.\.\.fullSoundOptions\(selectedId\)\)/);
  assert.match(expandSelector, /selector\.dataset\.expanded = "true"/);
  assert.match(compactSelector, /replaceChildren\(\.\.\.compactSoundOptions\(selectedId\)\)/);
  assert.match(compactSelector, /delete selector\.dataset\.expanded/);
  assert.match(gridBuilder, /selector\.className = "creaturazoid-step-sound-select"/);
  assert.match(gridBuilder, /replaceChildren\(\.\.\.compactSoundOptions\(event\?\.soundId \?\? ""\)\)/);
  assert.doesNotMatch(gridBuilder, /fullSoundOptions/);
  assert.match(bindings, /pointerdown[\s\S]*?expandStepSoundSelector\(selector\)/);
  assert.match(bindings, /focusin[\s\S]*?expandStepSoundSelector\(selector\)/);
  assert.match(bindings, /focusout[\s\S]*?compactStepSoundSelector\(selector\)/);
  assert.match(bindings, /change[\s\S]*?setStepSound\(Number\(selector\.dataset\.step\), selector\.value\)/);
  assert.match(
    cssRulesContaining(css, ".creaturazoid-step-sound-select"),
    /min-height:\s*0/,
  );
});

test("the lower bar maps bottom to sound 1 and top to sound 50 while preserving velocity", async () => {
  const { app, css, html } = await readSequencerSources();
  const gridBuilder = functionNamed(app, "buildSequenceGrid");
  const laneRenderer = functionNamed(app, "renderStepSoundLane");
  const pointerMapping = functionNamed(app, "sequenceSoundIndexFromPointer");
  const stepPainter = functionNamed(app, "paintSequenceSoundStep");
  const pointerPainter = functionNamed(app, "applySequenceSoundPointer");
  const pointerStart = functionNamed(app, "handleSequenceSoundPointerDown");
  const pointerEnd = functionNamed(app, "handleSequenceSoundPointerEnd");
  const laneControl = functionNamed(app, "setSoundFromLaneControl");
  const soundSetter = functionNamed(app, "setStepSound");
  const soundLaneRules = cssRulesContaining(css, ".creaturazoid-step-sound-lane");

  assert.match(gridBuilder, /soundLane\.className = "creaturazoid-step-sound-lane"/);
  assert.match(gridBuilder, /soundLane\.type = "range"/);
  assert.match(gridBuilder, /soundLane\.min = "1"/);
  assert.match(gridBuilder, /soundLane\.max = String\(CREATURAZOID_SOUNDS\.length\)/);
  assert.match(gridBuilder, /soundLane\.step = "1"/);
  assert.match(gridBuilder, /soundLane\.setAttribute\("aria-orientation", "vertical"\)/);
  assert.match(gridBuilder, /gridSoundLanesByStep\[step\] = soundLane/);
  assert.match(laneRenderer, /sequenceSoundIndexById\.get\(event\.soundId\)/);
  assert.match(laneRenderer, /--step-sound-position/);
  assert.match(laneRenderer, /position \* 5/);
  assert.match(laneRenderer, /aria-valuetext/);
  assert.match(laneRenderer, /Empty step; add volume or choose from the pull-down first/);
  assert.match(pointerMapping, /\(rect\.bottom - clientY\) \/ rect\.height/);
  assert.match(pointerMapping, /Math\.floor\(normalized \* CREATURAZOID_SOUNDS\.length\)/);
  assert.match(pointerStart, /soundIds:\s*CREATURAZOID_SOUNDS\.map\(\(\{ id \}\) => id\)/);
  assert.match(pointerStart, /lastChanged:\s*null/);
  assert.match(pointerPainter, /sequencePaintTargetAtX\(edit, event\.clientX\)/);
  assert.match(pointerPainter, /for \(let offset = 1; offset <= distance; offset \+= 1\)/);
  assert.match(pointerPainter, /previous\.soundIndex \+ \(soundIndex - previous\.soundIndex\) \* progress/);
  assert.match(stepPainter, /creaturazoidStepEvent\(pattern, step\)/);
  assert.match(stepPainter, /if \(!current\) return/);
  assert.match(stepPainter, /setStepSound\(step, edit\.soundIds\[safeIndex\]/);
  assert.match(stepPainter, /edit\.lastChanged = \{ soundIndex: safeIndex, step: result\.step \}/);
  assert.match(stepPainter, /announceState:\s*false/);
  assert.match(stepPainter, /markCustom:\s*false/);
  assert.match(stepPainter, /render:\s*false/);
  assert.match(soundSetter, /const velocity = previous\?\.velocity \?\? DEFAULT_SEQUENCE_STEP_VELOCITY/);
  assert.match(soundSetter, /setCreaturazoidStep\(pattern, step, validId \|\| null, validId \? velocity : 0\)/);
  assert.doesNotMatch(soundSetter, /resetSequenceSchedule|silencePhysicalModel|stopSequence/);
  assert.match(pointerEnd, /if \(!edit\.lastChanged \|\| event\.type === "pointercancel"\) return/);
  assert.match(laneControl, /creaturazoidStepEvent\(pattern, step\)/);
  assert.match(laneControl, /if \(!current\)[\s\S]*?renderStepSoundLane\(lane, null, step\)/);
  assert.match(soundLaneRules, /var\(--sequence-sound-bank\)/);
  assert.match(soundLaneRules, /writing-mode:\s*vertical-lr/);
  assert.match(soundLaneRules, /direction:\s*rtl/);
  assert.match(html, /sound one at the bottom to sound fifty at the top/i);
  assert.match(html, /Empty steps stay empty until you add volume above or choose from the dropdown/i);
});

test("a dedicated audition button requires armed stopped Audio and never edits or resets", async () => {
  const { app } = await readSequencerSources();
  const gridBuilder = functionNamed(app, "buildSequenceGrid");
  const previewHandler = functionNamed(app, "previewSequenceStep");

  assert.match(gridBuilder, /preview\.className = "creaturazoid-step-audition"/);
  assert.match(gridBuilder, /preview\.addEventListener\("click",[\s\S]*?previewSequenceStep\(step\)/);
  assert.match(gridBuilder, /slot\.append\(cell, preview, selector, soundLaneShell\)/);
  assert.match(previewHandler, /const event = creaturazoidStepEvent\(pattern, step\)/);
  assert.match(previewHandler, /audioContext\?\.state === "running"/);
  assert.match(previewHandler, /getAttribute\("aria-pressed"\) === "true"/);
  assert.match(previewHandler, /Audio is off — turn it on to hear this step/);
  assert.match(previewHandler, /if \(sequenceRunning\)/);
  assert.match(previewHandler, /scheduleSound\(event\.sound, event\.velocity, audioContext\.currentTime \+ 0\.018\)/);
  assert.doesNotMatch(previewHandler, /triggerSound|ensureAudio|resetSequenceSchedule|silencePhysicalModel|schedulerTick/);
  assert.doesNotMatch(
    previewHandler,
    /setCreaturazoidStep|setStepSound|setSequenceStepVelocity|markPatternCustom|renderPattern|resetSequenceSchedule/,
  );
});

test("the upper cells use a roving tab stop and complete keyboard controls", async () => {
  const { app } = await readSequencerSources();
  const tabStop = functionNamed(app, "setGridTabStop");
  const focusCell = functionNamed(app, "focusGridCell");
  const keyHandler = functionNamed(app, "handleSequenceGridKeydown");
  const gridBuilder = functionNamed(app, "buildSequenceGrid");

  assert.match(gridBuilder, /cell\.tabIndex = step === 0 \? 0 : -1/);
  assert.match(gridBuilder, /if \(step === 0\) gridTabStop = cell/);
  assert.match(tabStop, /gridTabStop\.tabIndex = -1/);
  assert.match(tabStop, /cell\.tabIndex = 0/);
  assert.match(focusCell, /gridCellsByStep\[\(step \+ pattern\.length\) % pattern\.length\]/);
  assert.match(focusCell, /setGridTabStop\(target\)/);
  assert.match(focusCell, /target\.focus\(\)/);
  assert.match(keyHandler, /event\.key === "ArrowUp" \|\| event\.key === "ArrowDown"/);
  assert.match(keyHandler, /event\.shiftKey \? 0\.1 : 0\.05/);
  assert.match(keyHandler, /DEFAULT_SEQUENCE_STEP_VELOCITY/);
  assert.match(keyHandler, /\["Delete", "Backspace", "0"\]\.includes\(event\.key\)/);
  assert.match(keyHandler, /setSequenceStepVelocity\(step, 0, \{ announceState: true \}\)/);
  assert.match(keyHandler, /event\.key === "ArrowLeft"/);
  assert.match(keyHandler, /event\.key === "ArrowRight"/);
  assert.match(keyHandler, /event\.key === "Home" \? 0/);
  assert.match(keyHandler, /event\.key === "End" \? pattern\.length - 1/);
  assert.match(keyHandler, /focusGridCell\(target\)/);
});

test("live edits, length changes, presets, and scatter preserve natural audio tails", async () => {
  const { app } = await readSequencerSources();
  const naturalTailFunctions = [
    "setSequenceStepVelocity",
    "setStepSound",
    "setPatternLength",
    "setSequencePreset",
    "scatterPattern",
  ];

  for (const name of naturalTailFunctions) {
    const body = functionNamed(app, name);
    assert.ok(body, name + " must remain independently testable");
    assert.doesNotMatch(
      body,
      /resetSequenceSchedule|silencePhysicalModel|stopSequence/,
      name + " must not restart the scheduler or truncate an already sounding call",
    );
  }

  assert.match(functionNamed(app, "setSequenceStepVelocity"), /pattern = setCreaturazoidStep\(/);
  assert.match(functionNamed(app, "setStepSound"), /pattern = setCreaturazoidStep\(/);
  assert.match(functionNamed(app, "setPatternLength"), /pattern = sanitizeCreaturazoidPattern\(pattern, length\)/);
  assert.match(functionNamed(app, "setPatternLength"), /reconcileSequenceTimeline\(length\)/);
  assert.match(functionNamed(app, "setSequencePreset"), /reconcileSequenceTimeline\(pattern\.length\)/);
  assert.match(functionNamed(app, "setPatternLength"), /buildSequenceGrid\(\{ preserveScroll: false \}\)/);
  assert.doesNotMatch(functionNamed(app, "setSequenceStepVelocity"), /buildSequenceGrid/);
  assert.doesNotMatch(functionNamed(app, "setStepSound"), /buildSequenceGrid/);

  const reconciliation = functionNamed(app, "reconcileSequenceTimeline");
  assert.match(reconciliation, /if \(currentStep >= 0\) currentStep %= safeLength/);
  assert.match(reconciliation, /scheduledSteps = scheduledSteps\.map/);
  assert.match(reconciliation, /event\.step === null \|\| event\.step === undefined/);
  assert.match(reconciliation, /\(\(event\.step % safeLength\) \+ safeLength\) % safeLength/);
  assert.doesNotMatch(
    reconciliation,
    /nextStepNumber\s*=|nextStepTime\s*=|resetSequenceSchedule|silencePhysicalModel|stopSequence/,
  );
});
