import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONTROL_LIMITS,
  animalState,
  resolveGestureTimeline,
} from "../src/syrinx.js";

const root = new URL("../", import.meta.url);

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `Unable to isolate ${name}`);
  return source.slice(start, end);
}

test("Syrinx UI exposes the two-menu preset bank, universal controls, and loop silence", async () => {
  const [html, css, app, original, build] = await Promise.all([
    readFile(new URL("syrinx-ui.html", root), "utf8"),
    readFile(new URL("syrinx-ui.css", root), "utf8"),
    readFile(new URL("syrinx-app.js", root), "utf8"),
    readFile(new URL("syrinx.html", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
  ]);

  assert.match(html, /<title>Syrinx UI · Morphazoid<\/title>/);
  assert.match(html, /<body[^>]*class="[^"]*syrinx-ui-page[^"]*"/);
  assert.match(html, /syrinx-preset-bank[\s\S]*id="animalSelect"[\s\S]*id="callSelect"/);
  assert.match(html, /id="loopGap"[^>]*type="range"[^>]*max="8000"/);
  assert.match(html, /id="loopGapOut"/);
  assert.match(html, /id="breathButton"/);
  assert.match(html, /src="syrinx-app\.js\?v=syrinx-ui-[^"]+"/);
  assert.match(html, /href="syrinx-ui\.css\?v=syrinx-ui-[^"]+"/);
  assert.match(original, /<body[^>]*class="[^"]*syrinx-ui-page[^"]*"/);
  assert.match(original, /href="syrinx-ui\.css\?v=syrinx-ui-[^"]+"/);
  assert.match(css, /\.syrinx-ui-page/);
  assert.match(css, /orientation:\s*landscape[\s\S]*grid-template-columns:[\s\S]*\.syrinx-ui-page \.panel[\s\S]*overflow-y:\s*auto/);
  assert.doesNotMatch(html, /class="syrinx-word"/);
  assert.match(html, /syrinx-panel-transport[\s\S]*syrinx-panel-presets[\s\S]*syrinx-specimen-card/);
  const stageMarkup = html.match(/<section class="stage syrinx-stage"[\s\S]*?<\/section>/)?.[0] ?? "";
  const panelMarkup = html.match(/<aside class="panel"[\s\S]*?<\/aside>/)?.[0] ?? "";
  assert.doesNotMatch(stageMarkup, /id="playButton"|id="animalSelect"|id="callSelect"/);
  assert.match(panelMarkup, /id="playButton"[\s\S]*id="animalSelect"[\s\S]*id="callSelect"/);
  assert.match(html, /id="randomizeButton"/);
  assert.match(html, /id="vibratoButton"[\s\S]*id="howlDriftButton"/);
  for (const number of [1, 2, 3]) {
    assert.match(html, new RegExp(`id="mod${number}Enable"[\\s\\S]*id="mod${number}Target"[\\s\\S]*id="mod${number}Rate"[\\s\\S]*id="mod${number}Depth"`));
  }
  assert.match(app, /function renderUniversalStage/);
  assert.match(app, /FOLD CAN/);
  assert.match(app, /radius:\s*12/);
  assert.match(app, /function drawUniversalRail/);
  const universalStage = functionBody(app, "renderUniversalStage", "renderStage");
  assert.match(universalStage, /handles\.forEach\(drawUniversalRail\)/);
  assert.match(universalStage, /handles\.forEach\(drawHandle\)/);
  assert.doesNotMatch(universalStage, /css(?:Width|Height)\s*[<>]/);
  assert.match(app, /const SILHOUETTE_PRESETS/);
  assert.match(app, /function drawAnimalSilhouette/);
  for (const control of ["level", "gestureRate", "loopGapMs", "modulators"]) {
    assert.match(app, new RegExp(control), control + " feeds the graphic system");
  }
  assert.match(app, /canvasBreathControl/);
  assert.match(app, /drawing\.fillText\("BREATH"/);
  assert.match(app, /randomizeSyrinxState/);
  assert.match(app, /modulateSyrinxState/);

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "every Syrinx UI id must be unique");
  for (const id of [
    "pressure",
    "tension",
    "adduction",
    "tractLength",
    "mouthOpening",
    "cavityCoupling",
    "asymmetry",
    "sourceBalance",
    "roughness",
    "gestureRate",
    "loopGap",
  ]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*type="range"`), `${id} is a range control`);
  }

  assert.match(app, /UI_MODE[\s\S]*biologicalLock:\s*false/);
  for (const control of [
    "pressure",
    "adduction",
    "asymmetry",
    "sourceBalance",
    "roughness",
  ]) {
    assert.match(app, new RegExp(`type:\\s*"${control}"`), `${control} has a canvas handle`);
  }

  const loadAnimal = functionBody(app, "loadAnimal", "loadCall");
  const loadCall = functionBody(app, "loadCall", "setControl");
  const manualBreath = functionBody(app, "setManualBreath", "updateCallOptions");
  assert.doesNotMatch(loadAnimal, /stopPerformance\s*\(/);
  assert.doesNotMatch(loadCall, /stopPerformance\s*\(/);
  assert.doesNotMatch(manualBreath, /gesturePlaying\s*=\s*false/);
  assert.match(loadAnimal, /transportWasRunning/);
  assert.match(loadCall, /gestureStartTime\s*=\s*performance\.now\(\)/);
  assert.match(manualBreath, /call transport continues/);
  assert.match(manualBreath, /hasActiveParameterModulators\(\)/);

  for (const runtimeFile of ["syrinx-ui.html", "syrinx-ui.css"]) {
    assert.match(build, new RegExp(runtimeFile.replaceAll(".", "\\.")));
  }
});


test("Tongued Beasts keeps viewport handles and the parameter panel available on mobile", async () => {
  const [html, css, app, build] = await Promise.all([
    readFile(new URL("tongued-beasts.html", root), "utf8"),
    readFile(new URL("tongued-beasts.css", root), "utf8"),
    readFile(new URL("syrinx-app.js", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
  ]);
  assert.match(html, /class="[^"]*syrinx-ui-page[^"]*tongued-beasts-page[^"]*"/);
  assert.match(html, /src="syrinx-app\.js\?v=syrinx-ui-[^"]+"/);
  assert.match(html, /href="tongued-beasts\.css\?v=syrinx-ui-[^"]+"/);
  assert.match(css, /orientation:\s*landscape[\s\S]*grid-template-columns:[\s\S]*\.tongued-beasts-page \.panel[\s\S]*overflow-y:\s*auto/);
  assert.match(html, /id="tongueAirwayOut"[\s\S]*id="tongueMotionOut"/);
  for (const id of [
    "p", "b", "l", "rolled-r", "raspberry", "la-la", "wiggle", "gyrate", "lick", "suck",
  ]) {
    assert.match(html, new RegExp(`data-tongue-motion="${id}"`), `${id} motion is exposed`);
  }
  for (const id of ["meat-tornado", "rubber-opera", "panic-goblin", "inside-out"]) {
    assert.match(html, new RegExp(`data-feral-preset="${id}"`), `${id} feral macro is exposed`);
  }
  for (const id of [
    "tonguePosition", "tongueHeight", "tongueShape", "tongueTip",
    "tongueExtension", "tongueCurl", "tongueLateral",
  ]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*type="range"`), `${id} is directly controllable`);
  }
  assert.match(app, /function tongueAtPoint/);
  assert.match(app, /function dragTongue/);
  assert.match(app, /setPointerCapture/);
  assert.doesNotMatch(
    app,
    /className\s*=\s*["']parameter-(?:control-row|mod-strip|mod-toggle|mini-knob|mod-knob)["']/,
    "Tongued Beasts must not inject modulation widgets beside right-panel inputs",
  );
  assert.doesNotMatch(
    app,
    /input\.before\(row\)|row\.append\(input\)|closest\(["']\.control["']\)/,
    "right-panel sliders stay structurally untouched",
  );
  assert.match(app, /sampleTongueMotionPreset/);
  assert.doesNotMatch(
    css,
    /\.parameter-(?:control-row|mod-strip|mod-toggle|mini-knob|mod-knob)\b/,
    "obsolete right-panel modulator styles are removed",
  );
  assert.match(css, /\.tongue-motion-presets/);
  assert.match(css, /\.tongue-feral-bank/);
  assert.match(build, /src\/tongue-performance\.js/);
});

test("Tongued Beasts puts modulation buttons and expanded rate/depth controls on viewport rails", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("tongued-beasts.html", root), "utf8"),
    readFile(new URL("tongued-beasts.css", root), "utf8"),
    readFile(new URL("syrinx-app.js", root), "utf8"),
  ]);
  const stageMarkup = html.match(/<section class="stage syrinx-stage"[\s\S]*?<\/section>/)?.[0] ?? "";
  const panelMarkup = html.match(/<aside class="panel"[\s\S]*?<\/aside>/)?.[0] ?? "";
  const installViewportModulators = functionBody(
    app,
    "installViewportParameterModulators",
    "positionViewportParameterModulators",
  );
  const createViewportRange = functionBody(
    app,
    "createViewportModulationRange",
    "collapseViewportModulatorControls",
  );
  const positionViewportModulators = functionBody(
    app,
    "positionViewportParameterModulators",
    "disableTongueParameterModulators",
  );
  const universalHandles = functionBody(app, "universalHandleList", "drawUniversalRail");
  const renderUniversalStage = functionBody(app, "renderUniversalStage", "renderStage");
  const canvasInteraction = functionBody(app, "installCanvasInteraction", "updatePerformance");

  assert.match(stageMarkup, /id="stage"[\s\S]*id="viewportModulationLayer"/);
  assert.match(stageMarkup, /id="viewportModulationLayer"[^>]*role="group"/);
  assert.doesNotMatch(panelMarkup, /id="viewportModulationLayer"/);
  assert.doesNotMatch(
    panelMarkup,
    /parameter-mod-(?:toggle|knob|strip)|data-parameter-modulator/,
    "the parameter pane contains no modulation affordances",
  );

  assert.match(installViewportModulators, /className\s*=\s*["']viewport-mod-toggle["']/);
  assert.match(installViewportModulators, /button\.type\s*=\s*["']button["']/);
  assert.match(installViewportModulators, /button\.addEventListener\(["']click["']/);
  assert.match(installViewportModulators, /aria-pressed/);
  assert.match(
    installViewportModulators,
    /className\s*=\s*["']viewport-mod-controls["']/,
    "rate/depth controls expand beside the pressed viewport button",
  );
  assert.match(createViewportRange, /type\s*=\s*["']range["']/);
  assert.match(installViewportModulators, /rateHz[\s\S]{0,1800}depth|depth[\s\S]{0,1800}rateHz/);
  assert.match(
    installViewportModulators,
    /viewportModulationLayer\.(?:append|appendChild|replaceChildren)\(/,
    "the native controls mount in the viewport overlay",
  );
  assert.match(installViewportModulators, /pointerdown[\s\S]{0,100}stopPropagation/);
  assert.doesNotMatch(
    installViewportModulators,
    /closest\(["']\.control["']\)|input\.before\(|row\.append\(input\)/,
    "installation targets the stage overlay, never the right panel",
  );
  assert.match(css, /\.viewport-mod-toggle\b/);
  assert.match(css, /\.viewport-mod-controls\b/);
  assert.match(css, /\.viewport-modulator[^}]*position:\s*absolute/i);
  assert.match(css, /\.viewport-modulator[^}]*pointer-events:\s*(?:auto|none)/i);

  assert.match(positionViewportModulators, /handles/);
  assert.match(positionViewportModulators, /(?:style\.setProperty|style\.(?:left|top|transform))/);
  assert.match(positionViewportModulators, /modDirection/);
  assert.match(universalHandles, /modAnchor\s*:/);
  assert.match(universalHandles, /modDirection\s*:/);
  for (const type of [
    "pressure", "tension", "adduction", "roughness", "asymmetry",
    "sourceBalance", "cavityCoupling", "tractLengthM", "mouthOpening",
  ]) {
    assert.match(
      app,
      new RegExp(`VIEWPORT_MODULATION_TARGETS[\\s\\S]{0,700}["']${type}["']`),
      `${type} viewport rail receives a modulation button`,
    );
  }

  assert.match(
    renderUniversalStage,
    /universalHandleList\([^;]*performanceState[^;]*\)/,
    "an enabled modulator visibly oscillates its viewport slider handle",
  );
  assert.doesNotMatch(
    renderUniversalStage,
    /universalHandleList\([^;]*,\s*state\s*\)/,
    "viewport handle positions must not remain pinned to the unmodulated base state",
  );
  assert.match(renderUniversalStage, /positionViewportParameterModulators\(/);
  assert.match(
    installViewportModulators,
    /(?:modulator|modulation)\.enabled\s*=\s*!|enabled\s*:\s*!(?:[A-Za-z]*modulator|[A-Za-z]*modulation)\.enabled/i,
    "pressing a viewport modulation button toggles oscillation",
  );
  assert.match(
    canvasInteraction,
    /activePointerId\s*!=\s*null\s*&&\s*activePointerId\s*!==?\s*event\.pointerId/,
    "a second pointer cannot steal an active viewport control",
  );
  assert.match(canvasInteraction, /activePointerId\s*=\s*event\.pointerId/);
  assert.match(
    canvasInteraction,
    /event\.pointerId\s*!==?\s*activePointerId[\s\S]*return/,
    "move/release events from the wrong pointer are ignored",
  );
  assert.doesNotMatch(
    installViewportModulators,
    /activePointerId\s*=/,
    "native overlay controls do not steal or overwrite the canvas drag pointer",
  );
});

test("viewport modulation editors remain draggable while expanded", async () => {
  const [css, app] = await Promise.all([
    readFile(new URL("tongued-beasts.css", root), "utf8"),
    readFile(new URL("syrinx-app.js", root), "utf8"),
  ]);
  const createViewportRange = functionBody(
    app,
    "createViewportModulationRange",
    "collapseViewportModulatorControls",
  );
  const handleAt = functionBody(app, "handleAt", "canvasPoint");
  const canvasInteraction = functionBody(app, "installCanvasInteraction", "updatePerformance");

  assert.match(
    css,
    /\.viewport-modulator\.is-expanded\s*\{[^}]*z-index:\s*(?:[2-9]|[1-9]\d+)/i,
    "the open editor paints and hit-tests above neighboring viewport buttons",
  );
  assert.match(
    css,
    /\.viewport-mod-range input\[type=["']range["']\]\s*\{[^}]*(?:height|min-height):\s*(?:2[4-9]|[3-9]\d|\d{3,})px/i,
    "Speed and Width expose a comfortably draggable pointer target",
  );
  assert.match(
    createViewportRange,
    /pointerdown[\s\S]*setPointerCapture\s*\(\s*event\.pointerId\s*\)/,
    "a slider keeps ownership when the pointer moves outside its narrow visual track",
  );
  assert.match(
    createViewportRange,
    /classList\.add\(["']is-adjusting["']\)/,
    "the editor records an active adjustment instead of treating it as a hover exit",
  );
  assert.match(
    createViewportRange,
    /(?:pointerup|lostpointercapture|pointercancel)[\s\S]*classList\.remove\(["']is-adjusting["']\)/,
    "the drag state is cleared after pointer release or cancellation",
  );
  assert.match(handleAt, /handle\.rail[\s\S]*distanceToSegment/);
  assert.doesNotMatch(
    canvasInteraction,
    /pointerdown[\s\S]{0,220}collapseViewportModulatorControls/,
    "dragging a base rail does not dismiss its open modulation editor",
  );
});

test("Tongued Beasts exposes its motion presets in a viewport hover and focus palette", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("tongued-beasts.html", root), "utf8"),
    readFile(new URL("tongued-beasts.css", root), "utf8"),
  ]);
  const stageMarkup = html.match(/<section class="stage syrinx-stage"[\s\S]*?<\/section>/)?.[0] ?? "";

  assert.match(stageMarkup, /class="[^"]*viewport-tongue-presets[^"]*"/);
  assert.match(
    stageMarkup,
    /class="[^"]*viewport-tongue-preset-trigger[^"]*"[^>]*(?:aria-haspopup|aria-expanded|aria-controls)=/,
    "the viewport palette has a discoverable keyboard-accessible trigger",
  );
  assert.match(
    stageMarkup,
    /class="[^"]*viewport-tongue-preset-popover[^"]*"[^>]*(?:role="(?:group|toolbar)"|aria-label=)/,
    "the hover box is exposed as a named preset group",
  );
  for (const id of [
    "p", "b", "l", "rolled-r", "raspberry", "la-la", "wiggle", "gyrate", "lick", "suck", "",
  ]) {
    assert.match(
      stageMarkup,
      new RegExp(`data-tongue-motion="${id}"`),
      `${id || "free-hand"} motion is selectable without leaving the viewport`,
    );
  }

  assert.match(css, /\.viewport-tongue-preset-popover\s*\{[^}]*(?:visibility:\s*hidden|opacity:\s*0|pointer-events:\s*none)/i);
  assert.match(
    css,
    /\.viewport-tongue-presets(?::hover|:focus-within|\.is-open)[\s\S]{0,500}\.viewport-tongue-preset-popover/,
    "hover, focus, or the latched open state reveals the viewport palette",
  );
  assert.match(
    css,
    /\.viewport-tongue-preset-popover[^}]*\{[^}]*pointer-events:\s*(?:auto|none)/i,
    "the palette explicitly owns pointer interaction rather than leaking drags to the canvas",
  );
});

test("unlocked Syrinx states use full safe ranges while locked presets retain species bounds", () => {
  const locked = animalState("raven", {
    pressure: 0,
    tension: 1,
    tractLengthM: CONTROL_LIMITS.tractLengthM[1],
  });
  const unlocked = animalState("raven", {
    biologicalLock: false,
    pressure: 0,
    tension: 1,
    tractLengthM: CONTROL_LIMITS.tractLengthM[1],
  });

  assert.equal(locked.biologicalLock, true);
  assert.notEqual(locked.pressure, 0);
  assert.notEqual(locked.tension, 1);
  assert.notEqual(locked.tractLengthM, CONTROL_LIMITS.tractLengthM[1]);

  assert.equal(unlocked.biologicalLock, false);
  assert.equal(unlocked.pressure, 0);
  assert.equal(unlocked.tension, 1);
  assert.equal(unlocked.tractLengthM, CONTROL_LIMITS.tractLengthM[1]);
  assert.equal(animalState("raven", { biologicalLock: false, loopGapMs: 99_000 }).loopGapMs, 8_000);
});

test("gesture timeline inserts exact silence without stopping loop transport", () => {
  const beforeGap = resolveGestureTimeline(399, 400, true, 3_000);
  const gapStart = resolveGestureTimeline(400, 400, true, 3_000);
  const gapMiddle = resolveGestureTimeline(1_900, 400, true, 3_000);
  const nextCall = resolveGestureTimeline(3_400, 400, true, 3_000);

  assert.equal(beforeGap.active, true);
  assert.equal(beforeGap.complete, false);
  assert.equal(gapStart.active, false);
  assert.equal(gapStart.complete, false);
  assert.equal(gapStart.remainingGapMs, 3_000);
  assert.equal(gapMiddle.remainingGapMs, 1_500);
  assert.equal(nextCall.active, true);
  assert.equal(nextCall.phase, 0);

  assert.deepEqual(resolveGestureTimeline(400, 400, false, 3_000), {
    active: false,
    complete: true,
    phase: 1,
    remainingGapMs: 0,
  });
  assert.equal(resolveGestureTimeline(400, 400, true, 0).active, true);
});
