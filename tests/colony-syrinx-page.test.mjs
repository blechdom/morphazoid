import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createColonySyrinxState } from "../src/colony-syrinx.js";

const root = new URL("../", import.meta.url);

function percentile(values, amount) {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * amount)];
}

function sourceSection(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `missing source token: ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `missing source token after ${startToken}: ${endToken}`);
  return source.slice(start, end);
}

const CUSTOM_PRESET_MARKER = new RegExp([
  "selectedCallId\\s*=\\s*null",
  "mark\\w*Custom",
  "clear\\w*Preset",
  "invalidate\\w*(?:Call|Preset)",
  "(?:stop|cancel|finish)\\w*Call",
  "setTransport\\(\\s*false",
].join("|"), "i");

const CALL_IDENTITY_MARKER = /call(?:Token|Generation)|generation|token/i;

const INACTIVE_FREQUENCY_MARKER = new RegExp([
  "\\w*FoldCount\\s*(?:===?|<=)\\s*0\\s*\\?\\s*[\"'](?:unvoiced|inactive|no folds|off|[—–-]{2,})[\"']",
  "if\\s*\\(\\s*!\\w*(?:Folds?|Voic\\w*)\\s*\\)[\\s\\S]{0,160}[\"'](?:unvoiced|inactive|no folds|off|[—–-]{2,})[\"']",
].join("|"), "i");

test("former instrument URLs redirect to canonical Monstrozoid without dropping URL state", async () => {
  for (const legacyPage of ["monsterzoid.html", "colony-syrinx.html"]) {
    const html = await readFile(new URL(legacyPage, root), "utf8");
    assert.match(html, /http-equiv="refresh" content="0; url=monstrozoid\.html"/);
    assert.match(html, /rel="canonical" href="monstrozoid\.html"/);
    assert.match(html, /destination\.search = location\.search/);
    assert.match(html, /destination\.hash = location\.hash/);
    assert.doesNotMatch(html, /src="colony-syrinx-app\.js"/);
  }
});

test("Monstrozoid page exposes anatomy slots, variable-count controls, literal headings, and calls", async () => {
  const html = await readFile(new URL("monstrozoid.html", root), "utf8");
  const routeValves = html.match(/<button id="route-s\d-m\d"[^>]*>/g) ?? [];
  assert.match(html, /<title>Monstrozoid/);
  assert.match(html, /<h1 id="pageTitle">MONSTROZOID<\/h1>/);
  assert.doesNotMatch(html, /MULTI-SOURCE VOCAL NETWORK/);
  assert.ok(
    html.indexOf('class="colony-body-stage"') < html.indexOf('class="colony-titlebar"')
      && html.indexOf('class="colony-titlebar"') < html.indexOf('class="colony-body"'),
    "the one-piece wordmark must live inside the monster graphic instead of a separate banner",
  );
  assert.equal((html.match(/class="body-aura monster-body-shell"/g) ?? []).length, 1);
  assert.equal((html.match(/class="monster-head-shell"/g) ?? []).length, 3);
  assert.equal((html.match(/class="monster-eye"/g) ?? []).length, 3);
  assert.equal((html.match(/class="monster-secondary-eye"/g) ?? []).length, 3);
  assert.equal((html.match(/class="monster-secondary-pupil"/g) ?? []).length, 3);
  assert.equal((html.match(/class="mouth-upper"/g) ?? []).length, 3);
  assert.equal((html.match(/class="mouth-lower"/g) ?? []).length, 3);
  assert.equal((html.match(/class="mouth-maw"/g) ?? []).length, 3);
  assert.equal((html.match(/class="jaw-hinge"/g) ?? []).length, 3);
  assert.equal((html.match(/class="mouth-tongue"/g) ?? []).length, 3);
  assert.equal((html.match(/class="psycho-eye-rays"/g) ?? []).length, 3);
  assert.equal((html.match(/class="monster-mad-brow"/g) ?? []).length, 3);
  assert.equal((html.match(/class="monster-eye-cluster"/g) ?? []).length, 1);
  assert.equal((html.match(/class="monster-bone-plates"/g) ?? []).length, 1);
  assert.equal((html.match(/class="monster-tendrils"/g) ?? []).length, 1);
  assert.equal((html.match(/class="alien-limb alien-limb-[a-f]"/g) ?? []).length, 6);
  assert.equal((html.match(/class="monster-deformation-web"/g) ?? []).length, 1);
  assert.equal((html.match(/\bdata-lung="\d+"/g) ?? []).length, 16);
  assert.equal((html.match(/\bid="fold\d+Meter"/g) ?? []).length, 8);
  assert.equal((html.match(/class="route-valve"/g) ?? []).length, 12);
  assert.equal(routeValves.filter((button) => /aria-pressed="true"/.test(button)).length, 9);
  assert.equal((html.match(/class="mouth-card mouth-[abc]"/g) ?? []).length, 3);
  assert.equal((html.match(/\bdata-vessel-lung="\d+"/g) ?? []).length, 16);
  assert.equal((html.match(/class="lung-membrane"/g) ?? []).length, 16);
  assert.equal((html.match(/class="lung-bronchial-tree"/g) ?? []).length, 16);
  assert.equal((html.match(/class="lung-pleural-folds"/g) ?? []).length, 16);
  assert.equal((html.match(/\bdata-vessel-source="\d+"/g) ?? []).length, 4);
  assert.equal((html.match(/\bdata-vessel-route="\d+-\d+"/g) ?? []).length, 12);
  assert.equal((html.match(/\bdata-vessel-mouth="\d+"/g) ?? []).length, 3);
  assert.equal((html.match(/id="colonySac[A-D]"/g) ?? []).length, 4);
  assert.equal((html.match(/href="#colonyGarden"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /class="sequence-lane mouth-[abc]"/);
  assert.doesNotMatch(html, /\bdata-step="\d+"/);
  assert.match(html, /id="contourLanes"[^>]*data-contour-count="6"/);
  assert.match(html, /id="primaryActionsTitle">Generate and audition<\/h2>/);
  assert.equal((html.match(/id="callPresetSelect"/g) ?? []).length, 1);
  assert.match(html, /id="callPresetSelect"[^>]*aria-describedby="selectedCallReadout"/);
  assert.match(html, /Call preset <small>← → auditions<\/small>/);
  assert.match(html, /id="playCallButton"[^>]*aria-describedby="selectedCallReadout"/);
  assert.match(html, /id="selectedCallReadout"/);
  assert.match(html, /id="presetTextOutput"[^>]*readonly/);
  assert.match(html, /id="mobilePrimaryMount"/);
  assert.match(html, /id="copyPresetButton"/);
  assert.doesNotMatch(html, /id="callBank"|class="call-bank"|class="call-preset-button"/);
  assert.ok(
    html.indexOf('id="callPresetSelect"') > html.indexOf('class="panel colony-console control-rail"'),
    "the compact preset chooser must live in the right control rail",
  );
  assert.ok(
    html.indexOf('id="randomizeAllButton"') < html.indexOf('id="callPresetSelect"'),
    "Randomize all must be the first performance action in the rail",
  );
  assert.match(html, /class="colony-anatomy" aria-label="Interactive creature"/);
  assert.match(html, /class="spatial-sound-field" data-spatial-background/);
  assert.match(html, /id="spatialTriggerFeedback"[^>]*hidden/);
  assert.match(html, /id="dragSoundFeedback"[^>]*hidden/);
  assert.match(html, /Drag halos[\s\S]*position \+ sound/i);
  assert.match(html, /Diamonds[\s\S]*shape \+ sound/i);
  assert.match(html, /position changes pressure, pitch, and resonance/i);
  assert.match(html, /<details class="anatomy-inspector">/);
  assert.match(html, /<summary><span>Detailed organ controls<\/span>/);
  assert.doesNotMatch(html, /<details class="anatomy-inspector"[^>]*\bopen\b/);
  assert.doesNotMatch(html, /id="anatomyTitle"|class="anatomy-legend"/);
  assert.match(html, /id="sequencerTitle">Continuous parameter contours<\/h2>/);
  assert.doesNotMatch(
    html,
    /id="mediumTitle"|id="mediumSelect"|Excitation material|>Air<|>Water<|>Pellets</i,
  );
  assert.match(html, /<b>Play continuous flow<\/b>/);
  assert.doesNotMatch(
    html,
    /One flowing breath|One body, one evolving field|What moves through it\?|Flow the freak|Lung, vocal-fold-source, route, mouth-resonator|Continuous contours control pressure|>ANATOMY<|>Pressure network<|>\s+pressure<\/span>|>\s*source<\/span>|>\s*open route<\/span>/i,
  );
  for (const id of [
    "lungCount",
    "throatCount",
    "foldCount",
    "mouthCount",
    "routeCount",
    "contourCount",
    "randomizeAllButton",
    "randomizeBodyButton",
    "randomizeRoutesButton",
    "randomizeMotionButton",
    "mutateMotionButton",
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="lungCount"[^>]*min="1"[^>]*max="16"/);
  assert.match(html, /id="foldCount"[^>]*min="0"[^>]*max="8"/);
  assert.match(html, /id="routeCount"[^>]*min="0"[^>]*max="12"/);
  assert.match(html, /id="contourCount"[^>]*min="1"[^>]*max="6"/);
  assert.match(html, /id="tempo"[^>]*min="1"/);
  assert.doesNotMatch(html, /id="connectionDensity(?:Out)?"/);
  assert.match(html, /id="playButton"[^>]*data-primary-transport/);
  assert.match(html, /class="panel colony-console control-rail"/);
  assert.match(html, /src="nav\.js"[\s\S]*src="colony-syrinx-app\.js"/);
});

test("interactive anatomy graph exposes direct manipulation and keyboard-safe routing", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("monstrozoid.html", root), "utf8"),
    readFile(new URL("colony-syrinx-app.js", root), "utf8"),
    readFile(new URL("colony-syrinx.css", root), "utf8"),
  ]);

  const bodySvg = html.match(/<svg\b[^>]*class="colony-body"[^>]*>/)?.[0] ?? "";
  assert.ok(bodySvg, "interactive anatomy SVG should exist");
  assert.match(bodySvg, /\brole="group"/);
  assert.doesNotMatch(bodySvg, /\brole="img"/);

  for (const id of [
    "scatterGraphButton",
    "resetGraphButton",
    "graphMotionButton",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should be present in the graph toolbar`);
  }

  for (const id of ["lungFeedVessels", "routeHitVessels", "routeDraft"]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should host dynamic graph geometry`);
  }

  assert.match(app, /from "\.\/src\/colony-syrinx-graph\.js"/);
  assert.match(app, /createColonySyrinxGraphLayout\(/);
  assert.match(app, /alignGraphLayout\(/);
  assert.match(app, /function persistGraphLayoutInState\(/);
  assert.match(app, /function hydrateGraphLayoutFromState\(/);
  assert.match(app, /function graphLayoutChanged\(/);
  assert.match(app, /colonySyrinxOrganLayoutFromGraph\(graphLayout\)/);
  assert.match(app, /applyColonySyrinxGraphAcoustics\(controls, layout\)/);
  assert.match(app, /graphMotionEnabled = Boolean\(state\.organMotionEnabled\)/);
  assert.match(app, /organMotionEnabled: graphMotionEnabled/);
  assert.match(app, /if \(scope === "anatomy" \|\| scope === "all"\)[\s\S]*hydrateGraphLayoutFromState\(\)/);
  assert.match(app, /graphMotionEnabled = Boolean\(state\.organMotionEnabled\)/);
  assert.match(app, /liveMouthApertures/);
  assert.match(app, /liveContourValues/);
  assert.match(app, /let audioStartPromise = null/);
  assert.match(app, /function resolveSpatialAuditionTarget\(/);
  assert.match(app, /function spatialAuditionConfiguration\(/);
  assert.match(app, /async function playSpatialAudition\(/);
  assert.match(app, /\[data-spatial-background\]/);
  assert.match(app, /spatialTriggerFeedback/);
  assert.match(app, /querySelector\("\.mouth-upper"\).*setAttribute/s);
  assert.match(app, /querySelector\("\.mouth-lower"\).*setAttribute/s);
  assert.match(app, /querySelector\("\.mouth-tongue"\).*setAttribute/s);
  assert.match(app, /moveColonySyrinxGraphNode\(/);
  assert.match(app, /createMonstrozoidBodyGeometry\(/);
  assert.match(app, /function renderMonsterBody\(/);
  assert.match(app, /function showDragSoundFeedback\(/);
  assert.match(app, /function startGraphDragAudition\(/);
  assert.match(html, /id="graphMotionButton"[^>]*aria-pressed="false"/);

  for (const eventName of ["pointerdown", "pointermove", "pointerup"]) {
    assert.match(
      app,
      new RegExp(`colonyBody\\?\\.addEventListener\\("${eventName}"`),
      `anatomy SVG should bind ${eventName}`,
    );
  }

  const buildGraphSource = sourceSection(
    app,
    "function buildAnatomyGraph()",
    "\nfunction graphMotionLayout(",
  );
  for (const handle of ["lung-shape", "fold-shape", "mouth-jaw", "mouth-tongue"]) {
    assert.match(
      buildGraphSource,
      new RegExp(`"data-graph-parameter": "${handle}"`),
      `${handle} should be exposed as a direct-manipulation handle`,
    );
  }
  assert.match(buildGraphSource, /source-port/);
  assert.match(buildGraphSource, /mouth-port/);

  const parameterSource = sourceSection(
    app,
    "function updateGraphParameter(",
    "\nfunction routeDraftPath(",
  );
  assert.match(parameterSource, /lung-shape[\s\S]*\bcompliance:[\s\S]*\bdrive:/);
  assert.match(parameterSource, /fold-shape[\s\S]*\btension:[\s\S]*\bclosure:/);
  assert.match(parameterSource, /mouth-jaw[\s\S]*\bopening:[\s\S]*\blipSize:/);
  assert.match(parameterSource, /mouth-tongue[\s\S]*\btonguePosition:[\s\S]*\btongueSize:/);

  const graphGestureSource = sourceSection(
    app,
    "function beginGraphGesture(",
    "\nfunction moveFocusedGraphNode(",
  );
  assert.match(graphGestureSource, /source-port/);
  assert.match(graphGestureSource, /route-draw/);
  assert.match(graphGestureSource, /nearestMouthForPoint\(/);
  assert.match(graphGestureSource, /setManualRoute\(/);

  const endGestureSource = sourceSection(
    app,
    "function endGraphGesture(",
    "\nfunction moveFocusedGraphNode(",
  );
  assert.match(endGestureSource, /gesture\.kind === "move-node"[\s\S]*playSpatialAudition/);
  assert.match(endGestureSource, /gesture\.kind === "breath"[\s\S]*playSpatialAudition/);
  assert.doesNotMatch(endGestureSource, /playShortCall\(/);

  const moveGestureSource = sourceSection(
    app,
    "function moveGraphGesture(",
    "\nfunction nearestMouthForPoint(",
  );
  assert.match(
    moveGestureSource,
    /graphGesture\.kind === "route-aperture"[\s\S]*\baperture\s*=\s*clamp\([\s\S]*setManualRoute\([^;]*\baperture\b/,
  );

  const globalKeySource = sourceSection(app, "function handleKeyDown(", "\nfunction handleKeyUp(");
  assert.match(globalKeySource, /event\.defaultPrevented/);

  const bindControlsStart = app.indexOf("function bindControls()");
  const routeBindingsStart = app.indexOf("routeVessels.forEach", bindControlsStart);
  const routeBindingsEnd = app.indexOf("mouthCards.forEach", routeBindingsStart);
  assert.ok(bindControlsStart >= 0 && routeBindingsStart >= 0 && routeBindingsEnd > routeBindingsStart);
  const routeBindings = app.slice(routeBindingsStart, routeBindingsEnd);
  const routeKeyBinding = sourceSection(
    routeBindings,
    'vessel.addEventListener("keydown"',
    "\n    renderRouteBase",
  );
  assert.match(routeKeyBinding, /event\.preventDefault\(\)/);
  assert.match(routeKeyBinding, /event\.stopPropagation\(\)/);

  assert.match(
    css,
    /\.colony-body\s+\.is-absent\s*\{[^}]*display:\s*none\s*!important/,
    "absent anatomy should not remain visible or interactive",
  );
});

test("controller owns calls, valve MIDI, continuous flow, variable counts, preset text, and panic", async () => {
  const source = await readFile(new URL("colony-syrinx-app.js", root), "utf8");
  assert.match(source, /const MIDI_BASE_NOTE = 48/);
  assert.match(source, /colonySyrinxRouteFromMidiNote\(note, midiBaseNote\)/);
  assert.match(source, /morphazoid:midi-input/);
  assert.match(source, /controller === 64/);
  assert.match(source, /controller === 120 \|\| controller === 123/);
  for (const type of ["configure", "breath", "transport", "panic"]) {
    assert.match(source, new RegExp(`type: "${type}"`));
  }
  assert.match(source, /colony-syrinx-pressure-network/);
  assert.match(source, /phonatorEnabled/);
  assert.match(source, /foldEnabled/);
  assert.match(source, /mouthEnabled/);
  assert.match(source, /alternateRoutes/);
  assert.match(source, /contourDurationSeconds/);
  assert.match(source, /contourPhase/);
  assert.match(source, /randomizeAllButton/);
  assert.match(source, /placePrimaryControls/);
  assert.match(source, /compactLayoutQuery/);
  assert.match(source, /randomizeBodyButton/);
  assert.match(source, /randomizeRoutesButton/);
  assert.match(source, /randomizeMotionButton/);
  assert.match(source, /bindRange\("foldCount"/);
  assert.match(source, /bindRange\("routeCount"/);
  assert.match(source, /bindRange\("contourCount"/);
  assert.doesNotMatch(source, /connectionDensity/);
  assert.match(source, /for \(const recipe of COLONY_SYRINX_CALLS\)/);
  assert.match(source, /option\.dataset\.callId = recipe\.id/);
  assert.match(source, /void playShortCall\(event\.currentTarget\.value\)/);
  assert.match(source, /playShortCall\(selectedCallId\)/);
  assert.match(source, /buildCallMenu\(\)/);
  assert.match(source, /callDisplayLabel\(recipe\)/);
  assert.doesNotMatch(source, /callMaterialLabel|mediumSelect|updateMediumPresentation/);
  assert.match(source, /formatCallDuration\(recipe\.durationSeconds\)/);
  assert.match(source, /articulation: recipe\.articulation/);
  assert.match(source, /formatColonySyrinxPreset\(state\)/);
  assert.match(source, /navigator\.clipboard\.writeText\(output\.value\)/);
  assert.match(source, /type: "call"/);
  assert.match(source, /data\?\.type === "call-ended"/);
  assert.match(source, /telemetry\.routeApertures/);
  assert.match(source, /telemetry\.contourValues/);
  assert.match(source, /sampleColonySyrinxContour\(contour, phase\)/);
  assert.match(source, /option\.dataset\.exactRate = "true"/);
  assert.match(source, /key === "p" \|\| key === " "/);
  assert.match(source, /masterGain\.gain\.value = 1/);
  assert.doesNotMatch(source, /masterGain\.gain\.setTargetAtTime/);
  assert.match(source, /function queueRouteStart\(index, velocity, owner\)/);
  assert.match(source, /if \(!ready \|\| \(owner && !keyOwners\.has\(owner\)\)\) return/);
  assert.match(source, /vessel\?\.classList\.toggle\(\s*"is-flowing"/);
  assert.match(source, /mouthVessels\[index\]\?\.classList\.toggle\("is-sounding"/);

  const toggleAudioStart = source.indexOf("async function toggleAudio()");
  const toggleAudioEnd = source.indexOf("\nfunction setTransport", toggleAudioStart);
  assert.ok(toggleAudioStart >= 0 && toggleAudioEnd > toggleAudioStart);
  const toggleAudioSource = source.slice(toggleAudioStart, toggleAudioEnd);
  assert.doesNotMatch(
    toggleAudioSource,
    /setTransport\(\s*true/,
    "enabling audio must not start the indefinite continuous transport",
  );
  assert.match(
    toggleAudioSource,
    /if \(await ensureAudio\(\)\) \{\s*announce\("Monstrozoid audio on"\);\s*\}/,
  );
});

test("call UI keeps one-shot identity separate from continuous transport and edited settings", async () => {
  const [appSource, processorSource] = await Promise.all([
    readFile(new URL("colony-syrinx-app.js", root), "utf8"),
    readFile(new URL("../src/colony-syrinx-processor.js", import.meta.url), "utf8"),
  ]);

  const ensureAudioSource = sourceSection(
    appSource,
    "async function ensureAudio()",
    "\nasync function toggleAudio()",
  );
  const transportSync = ensureAudioSource.indexOf('type: "transport"');
  assert.ok(transportSync >= 0, "ensureAudio must synchronize continuous transport when no call is active");
  assert.match(
    ensureAudioSource.slice(0, transportSync),
    /if\s*\(\s*!callActive\s*\)/,
    "ensureAudio must not cancel an active one-shot by synchronizing continuous transport",
  );

  const toggleTransportSource = sourceSection(
    appSource,
    "async function toggleTransport()",
    "\nfunction setBreath(",
  );
  assert.match(
    toggleTransportSource,
    /if\s*\(\s*callActive\s*\)[\s\S]*setTransport\(\s*true\b/,
    "the continuous control must explicitly replace a finite call with continuous flow",
  );

  const callMessageSource = sourceSection(
    processorSource,
    'if (message.type === "call")',
    'if (message.type === "transport")',
  );
  const finishCallSource = sourceSection(
    processorSource,
    "_finishCall()",
    "\n  _setClockStep(",
  );
  assert.match(callMessageSource, CALL_IDENTITY_MARKER, "the worklet must retain a call token or generation");
  assert.match(finishCallSource, /callId/, "call-ended must identify the completed preset");
  assert.match(finishCallSource, CALL_IDENTITY_MARKER, "call-ended must identify the exact invocation");

  const portMessageSource = sourceSection(
    appSource,
    "sourceNode.port.onmessage =",
    "\n  sourceNode.onprocessorerror",
  );
  const finishShortCallSource = sourceSection(
    appSource,
    "function finishShortCall(",
    "\nasync function playShortCall(",
  );
  assert.match(portMessageSource, CALL_IDENTITY_MARKER);
  assert.match(finishShortCallSource, CALL_IDENTITY_MARKER);
  assert.match(
    finishShortCallSource,
    /(?:!==|===)\s*activeCall(?:Token|Generation)|activeCall(?:Token|Generation)\s*(?:!==|===)/,
    "a stale call-ended event must not finish the current call",
  );

  for (const [label, startToken, endToken] of [
    ["organ count", "function setOrganCount(", "\nfunction setRouteCount("],
    ["route count", "function setRouteCount(", "\nfunction setContourCount("],
    ["contour count", "function setContourCount(", "\nfunction mutateCreature("],
    ["randomization", "function mutateCreature(", "\nfunction selectedCallRecipe("],
    ["contour editing", "function updateContour(", "\nfunction setContourPoint("],
    ["manual plumbing", "function setManualRoute(", "\nfunction setHeldRoute("],
    ["panic", "function panic(", "\nfunction resetControllers("],
  ]) {
    assert.match(
      sourceSection(appSource, startToken, endToken),
      CUSTOM_PRESET_MARKER,
      `${label} must clear the selected preset identity or stop its active call`,
    );
  }

  const selectedPresentationSource = sourceSection(
    appSource,
    "function updateCallPresentation()",
    "\nfunction buildCallMenu()",
  );
  const callMenuSource = sourceSection(
    appSource,
    "function buildCallMenu()",
    "\nfunction selectShortCall(",
  );
  assert.match(selectedPresentationSource, /counts\.phonators/, "selected call metadata must include sources");
  assert.match(selectedPresentationSource, /callPresetSelect/, "selected call must stay synchronized with the native menu");
  assert.doesNotMatch(callMenuSource, /document\.createElement\("optgroup"\)/);
  assert.match(callMenuSource, /document\.createElement\("option"\)/);
  assert.match(callMenuSource, /select\.append\(option\)/, "menu order must follow the curated call order");
  assert.match(callMenuSource, /recipe\.durationSeconds/, "menu labels must retain call duration");
  assert.match(appSource, /function callDisplayLabel\(/);
  assert.match(appSource, /function stepCallPreset\(/);
  assert.match(appSource, /event\.target === \$\("callPresetSelect"\)/);
  assert.match(appSource, /key === "arrowright" \|\| key === "arrowleft"/);
  assert.doesNotMatch(appSource, /call-preset-button|--call-progress/);

  const renderTelemetrySource = sourceSection(
    appSource,
    "function renderTelemetry()",
    "\nfunction cleanup()",
  );
  assert.doesNotMatch(
    renderTelemetrySource,
    /selectedCallReadout/,
    "telemetry frames must not replace stable selected-call metadata",
  );
  const frequencyStart = renderTelemetrySource.indexOf("SOURCE_DISPLAY_FREQUENCIES.forEach");
  const frequencyEnd = renderTelemetrySource.indexOf("routeButtons.forEach", frequencyStart);
  assert.ok(frequencyStart >= 0 && frequencyEnd > frequencyStart);
  const frequencyPresentationSource = renderTelemetrySource.slice(frequencyStart, frequencyEnd);
  assert.match(
    frequencyPresentationSource,
    /foldEnabled/,
    "source frequency presentation must inspect whether either fold exists",
  );
  assert.match(
    frequencyPresentationSource,
    INACTIVE_FREQUENCY_MARKER,
    "a source with zero folds must display an inactive state instead of a fallback frequency",
  );
});

test("telemetry CSS maps anatomy and the six contour editor lanes", async () => {
  const css = await readFile(new URL("colony-syrinx.css", root), "utf8");
  assert.match(css, /\.lung\.is-pressured/);
  assert.match(css, /--activity/);
  assert.match(css, /\.route-valve\.is-flowing/);
  assert.match(css, /--flow/);
  assert.match(css, /\.mouth-card\.is-sounding/);
  assert.match(css, /\.vessel-route\.is-open/);
  assert.match(css, /\.vessel-mouth\.is-sounding/);
  assert.match(css, /\.vessel-lung\.is-exhaling/);
  assert.match(css, /\.vessel-lung \.lung-membrane/);
  assert.match(css, /\.vessel-lung \.lung-bronchial-tree/);
  assert.match(css, /\.vessel-lung \.lung-pleural-folds/);
  assert.match(css, /\.anatomy-inspector > summary/);
  assert.match(css, /\.spatial-trigger-wave/);
  assert.match(css, /\.graph-interaction-key/);
  assert.match(css, /\.alien-limb/);
  assert.match(css, /\.monster-deformation-web/);
  assert.match(css, /\.drag-sound-feedback/);
  assert.match(css, /\.vessel-mouth \.mouth-maw/);
  assert.match(css, /\.vessel-mouth \.psycho-eye-rays/);
  assert.match(css, /\.contour-lane/);
  assert.match(css, /\.contour-path/);
  assert.match(css, /\.contour-point/);
  assert.match(css, /\.generator-section/);
  assert.match(css, /\.colony-primary-section/);
  assert.match(css, /\.call-preset-select select/);
  assert.match(css, /\.preset-text-section/);
  assert.match(
    css,
    /\.colony-titlebar\s*\{[\s\S]*?position:\s*absolute;/,
    "the wordmark should overlay the monster field",
  );
  assert.doesNotMatch(css, /\.call-bank|\.call-preset-button/);
  assert.doesNotMatch(
    css,
    /\.colony-shell\.is-running \.vessel-route\.is-open/,
    "an open route must not masquerade as live flow",
  );
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("worklet continuously morphs one pressure flow, honors active organs, and panics cleanly", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let registeredName = "";
  let RegisteredProcessor = null;
  const telemetry = [];

  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage(message) { telemetry.push(message); },
      };
    }
  }

  globalThis.AudioWorkletProcessor = FakeAudioWorkletProcessor;
  globalThis.sampleRate = 48_000;
  globalThis.registerProcessor = (name, Processor) => {
    registeredName = name;
    RegisteredProcessor = Processor;
  };

  try {
    const processorSource = await readFile(
      new URL("../src/colony-syrinx-processor.js", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(processorSource, /AUTO_EXHALE_PATTERN|autoExhaleEnvelope/);
    assert.doesNotMatch(processorSource, /SOURCE_STEP_RATIOS/);
    assert.match(processorSource, /_callBankExhaleGates\(\)/);
    assert.match(processorSource, /options\.bankExhaleGates = articulationGates/);
    assert.match(processorSource, /triggerArticulation\(/);
    assert.match(processorSource, /mouthBurstPeaks/);
    assert.match(processorSource, /mouthBursts:/);
    assert.match(processorSource, /interpolateMouthGesture/);
    assert.match(processorSource, /_updateContinuousBreathMotion/);
    assert.match(processorSource, /if \(message\.type === "call"\)/);
    assert.match(processorSource, /_callEnvelope\(\)/);
    assert.match(processorSource, /type: "call-ended"/);
    assert.match(processorSource, /callActive: this\.callActive/);
    assert.match(processorSource, /callProgress:/);

    const processorUrl = new URL("../src/colony-syrinx-processor.js", import.meta.url);
    processorUrl.searchParams.set("test", String(Date.now()));
    await import(processorUrl.href);
    assert.equal(registeredName, "colony-syrinx-pressure-network");
    assert.equal(typeof RegisteredProcessor, "function");

    const base = createColonySyrinxState();
    const configuration = createColonySyrinxState({
      seed: 4_321,
      breath: 0.82,
      contourDurationSeconds: 3.2,
      pressureGain: 1.5,
      crossCoupling: 0.38,
      colonyAmount: 0,
      leak: 0.08,
      valveSlewMs: 38,
      sequencerEnabled: true,
      level: 0.72,
      phonatorEnabled: [true, true, true, true],
      mouthEnabled: [true, true, true],
      routes: [
        [0.92, 0.48, 0.28],
        [0.62, 0.9, 0.46],
        [0.38, 0.72, 0.94],
        [0.84, 0.34, 0.76],
      ],
      alternateRoutes: [
        [0.3, 0.92, 0.7],
        [0.94, 0.32, 0.78],
        [0.82, 0.88, 0.24],
        [0.44, 0.96, 0.9],
      ],
      mouths: base.mouths.map((mouth, index) => ({
        ...mouth,
        opening: [0.82, 0.68, 0.58][index],
        slewMs: [92, 54, 24][index],
      })),
    });
    const processor = new RegisteredProcessor({
      processorOptions: {
        configuration,
        breathActive: false,
        playing: false,
        seed: configuration.seed,
      },
    });
    assert.equal(processor.breathActive, false);
    assert.equal(processor.transportPlaying, false);

    const render = (seconds, collect = false) => {
      const windowFrames = 2_400;
      const blocks = Math.ceil(seconds * 48_000 / 128);
      const windows = [];
      let windowSquares = 0;
      let windowSize = 0;
      let squareSum = 0;
      let frameCount = 0;
      let maximum = 0;
      for (let block = 0; block < blocks; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        assert.equal(processor.process([], [[left, right]]), true);
        for (let index = 0; index < left.length; index += 1) {
          assert.ok(Number.isFinite(left[index]));
          assert.ok(Number.isFinite(right[index]));
          maximum = Math.max(maximum, Math.abs(left[index]), Math.abs(right[index]));
          const squares = (left[index] ** 2 + right[index] ** 2) * 0.5;
          squareSum += squares;
          frameCount += 1;
          if (!collect) continue;
          windowSquares += squares;
          windowSize += 1;
          if (windowSize === windowFrames) {
            windows.push(Math.sqrt(windowSquares / windowSize));
            windowSquares = 0;
            windowSize = 0;
          }
        }
      }
      return {
        maximum,
        rms: Math.sqrt(squareSum / Math.max(1, frameCount)),
        windows,
      };
    };

    processor.port.onmessage({ data: { type: "transport", playing: true, reset: true } });
    render(2.4);
    const reportStart = telemetry.length;
    const flowing = render(4.8, true);
    const reports = telemetry.slice(reportStart).filter(({ type }) => type === "telemetry");
    assert.ok(flowing.maximum > 0.02 && flowing.maximum <= 0.920001);
    assert.ok(flowing.rms > 0.006);
    assert.ok(flowing.windows.length > 40);
    const p10 = percentile(flowing.windows, 0.1);
    const p90 = percentile(flowing.windows, 0.9);
    assert.ok(p10 > 1e-5, `continuous pressure must not contain silent attack gaps: ${p10}`);
    assert.ok(p10 > p90 * 0.002, `quiet windows must remain part of one flow: ${p10} / ${p90}`);
    assert.ok(p90 > p10 * 1.08, "the sustained flow still needs expressive dynamic motion");
    assert.ok(reports.length > 60);

    for (const report of reports) {
      assert.equal(report.lungs.length, 16);
      assert.equal(report.folds.length, 8);
      assert.equal(report.routes.length, 12);
      assert.equal(report.mouths.length, 3);
      assert.equal(report.exhales.length, 4);
      assert.equal(report.laneSteps.length, 6);
      assert.equal(report.lanePhases.length, 6);
      assert.equal(report.laneVelocities.length, 6);
      assert.equal(report.contourValues.length, 6);
      assert.equal(report.mouthApertures.length, 3);
      assert.ok(report.mouthApertures.every((value) => (
        Number.isFinite(value) && value >= 0 && value <= 1
      )));
      assert.equal(report.mouthFormantsHz.length, 3);
      assert.ok(report.exhales.filter((value) => value > 0.05).length >= 2);
      assert.ok(report.contourPhase >= 0 && report.contourPhase < 1);
    }

    const bankSpans = Array.from({ length: 4 }, (_, bank) => {
      const values = reports.map((report) => report.exhales[bank]);
      return Math.max(...values) - Math.min(...values);
    });
    assert.ok(bankSpans.every((span) => span > 0.04), `all banks must undulate: ${bankSpans}`);
    assert.ok(reports.some((report) => new Set(
      report.exhales.map((value) => value.toFixed(3)),
    ).size >= 3), "the banks need overlapping but staggered breath levels");

    const phaseDeltas = reports.slice(1).map((report, index) => (
      (report.contourPhase - reports[index].contourPhase + 1) % 1
    ));
    assert.ok(phaseDeltas.every((delta) => delta > 0 && delta < 0.08));
    const changingRoutes = Array.from({ length: 12 }, (_, route) => {
      const values = reports.map((report) => report.routeApertures[route]);
      return Math.max(...values) - Math.min(...values);
    }).filter((span) => span > 0.025).length;
    assert.ok(changingRoutes >= 6, `routing contour should bend many paths: ${changingRoutes}`);
    const routeJumps = reports.slice(1).flatMap((report, index) => (
      report.routeApertures.map((value, route) => Math.abs(value - reports[index].routeApertures[route]))
    ));
    assert.ok(Math.max(...routeJumps) < 0.32, "route morphing must slew rather than step");

    const mouthApertureSpans = Array.from({ length: 3 }, (_, mouth) => {
      const values = reports.map((report) => report.mouthApertures[mouth]);
      return Math.max(...values) - Math.min(...values);
    });
    assert.ok(
      mouthApertureSpans.every((span) => span > 0.025),
      `mouth contours must move every reported aperture: ${mouthApertureSpans}`,
    );

    for (let mouth = 0; mouth < 3; mouth += 1) {
      const firstFormants = reports.map((report) => report.mouthFormantsHz[mouth][0]);
      assert.ok(new Set(firstFormants.map((value) => value.toFixed(2))).size > 12);
      const jumps = firstFormants.slice(1).map((value, index) => Math.abs(value - firstFormants[index]));
      const maximumJump = Math.max(...jumps);
      assert.ok(maximumJump < 1_600, `mouth ${mouth + 1} formants must interpolate: ${maximumJump}`);
    }
    assert.equal(reports.at(-1).activeCounts.lungs, 16);
    assert.equal(reports.at(-1).activeCounts.phonators, 4);
    assert.equal(reports.at(-1).activeCounts.folds, 8);
    assert.equal(reports.at(-1).activeCounts.mouths, 3);
    assert.deepEqual(reports.at(-1).sourceModels, [
      "collision-roar",
      "split-syrinx",
      "pulse-membrane",
      "needle-syrinx",
    ]);
    const activeFrequencies = reports.at(-1).sourceFrequenciesHz.filter((value) => value > 0);
    assert.equal(activeFrequencies.length, 4);
    assert.ok(
      Math.max(...activeFrequencies) / Math.min(...activeFrequencies) > 3,
      "the sustained organism must retain four contrasting source registers",
    );

    processor.port.onmessage({ data: { type: "transport", playing: true, reset: true } });
    assert.equal(processor.runtime.timeSeconds, 0);
    assert.equal(processor.runtime.contourPhase, 0);
    processor._advancePressureNetwork(processor.controlQuantum);
    assert.ok(processor.runtime.contourPhase > 0 && processor.runtime.contourPhase < 0.01);
    const pausedPhase = processor.runtime.contourPhase;
    processor.port.onmessage({ data: { type: "transport", playing: false } });
    for (let index = 0; index < 12; index += 1) {
      processor._advancePressureNetwork(processor.controlQuantum);
    }
    assert.equal(processor.runtime.contourPhase, pausedPhase);
    processor.port.onmessage({ data: { type: "transport", playing: true } });
    processor._advancePressureNetwork(processor.controlQuantum);
    assert.ok(processor.runtime.contourPhase > pausedPhase);

    processor.port.onmessage({
      data: {
        type: "configure",
        configuration: {
          phonatorEnabled: [true, false, false, false],
          mouthEnabled: [true, false, false],
        },
      },
    });
    render(0.9);
    const reducedStart = telemetry.length;
    const reduced = render(0.6, true);
    const reducedReport = telemetry.slice(reducedStart).findLast(({ type }) => type === "telemetry");
    assert.ok(reduced.rms > 1e-5, "one connected throat and mouth should keep breathing");
    assert.equal(reducedReport.activeCounts.phonators, 1);
    assert.equal(reducedReport.activeCounts.folds, 2);
    assert.equal(reducedReport.activeCounts.mouths, 1);
    assert.ok(reducedReport.sourceFrequenciesHz.slice(1).every((value) => value === 0));
    assert.ok(reducedReport.routes.every((value, index) => index === 0 || value < 1e-5));
    assert.ok(reducedReport.mouthLoads.slice(1).every((value) => value === 0));

    processor.port.onmessage({
      data: {
        type: "configure",
        configuration: {
          phonatorEnabled: [false, false, false, false],
          mouthEnabled: [false, false, false],
        },
      },
    });
    render(0.8);
    const disabled = render(0.4, true);
    const disabledReport = telemetry.findLast(({ type }) => type === "telemetry");
    assert.ok(disabled.rms < 1e-6, `disabled sound organs must be silent: ${disabled.rms}`);
    assert.deepEqual(
      disabledReport.activeCounts,
      { lungs: 16, phonators: 0, folds: 0, mouths: 0, routes: 0 },
    );
    assert.ok(processor.phonatorSources.every((source) => source === 0));

    processor.port.onmessage({ data: { type: "panic" } });
    assert.equal(processor.transportPlaying, false);
    assert.equal(processor.breathActive, false);
    assert.equal(processor.runtime.contourPhase, 0);
    assert.ok(processor.runtime.reservoirPressures.every((pressure) => pressure === 0));
    assert.ok(processor.runtime.routeFlows.every((flow) => flow === 0));
    assert.ok(processor.bankExhaleLevels.every((value) => value === 0));

    const seedFromPatch = new RegisteredProcessor({
      processorOptions: {
        configuration: createColonySyrinxState({ seed: 111 }),
        playing: true,
      },
    });
    seedFromPatch.port.onmessage({
      data: { type: "configure", patch: { seed: 222 } },
    });
    const seedFromBirth = new RegisteredProcessor({
      processorOptions: {
        configuration: createColonySyrinxState({ seed: 222 }),
        playing: true,
      },
    });
    let seedMaximumDifference = 0;
    let seededSquareSum = 0;
    let seededFrameCount = 0;
    for (let block = 0; block < 420; block += 1) {
      const patchedLeft = new Float32Array(128);
      const patchedRight = new Float32Array(128);
      const freshLeft = new Float32Array(128);
      const freshRight = new Float32Array(128);
      seedFromPatch.process([], [[patchedLeft, patchedRight]]);
      seedFromBirth.process([], [[freshLeft, freshRight]]);
      for (let index = 0; index < 128; index += 1) {
        seedMaximumDifference = Math.max(
          seedMaximumDifference,
          Math.abs(patchedLeft[index] - freshLeft[index]),
          Math.abs(patchedRight[index] - freshRight[index]),
        );
        seededSquareSum += patchedLeft[index] ** 2 + patchedRight[index] ** 2;
        seededFrameCount += 2;
      }
    }
    assert.ok(Math.sqrt(seededSquareSum / seededFrameCount) > 1e-4);
    assert.equal(seedMaximumDifference, 0, "a live seed must reproduce a fresh configuration with that seed");

    const callTelemetryStart = telemetry.length;
    const callDurationSeconds = 0.5;
    const callDurationSamples = Math.round(callDurationSeconds * 48_000);
    const callProcessor = new RegisteredProcessor({
      processorOptions: { configuration, breathActive: false, playing: false },
    });
    callProcessor.port.onmessage({
      data: {
        type: "call",
        playing: true,
        reset: true,
        durationSeconds: callDurationSeconds,
        callId: "test-short-call",
        callToken: 37,
        callGeneration: 37,
        articulation: {
          mode: "lip-pop",
          strike: 1,
          attackMs: 0.5,
          releaseMs: 32,
          prechargeMs: 20,
          burst: 0.92,
          pulseRateHz: 0,
          pulseDepth: 0,
          pushPull: 0,
          brightness: 0.32,
          noise: 0.12,
        },
      },
    });
    const callSamples = [];
    for (let block = 0; block < Math.ceil((callDurationSamples + 128) / 128); block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      callProcessor.process([], [[left, right]]);
      callSamples.push(...left);
    }
    const callEndedEvents = telemetry.slice(callTelemetryStart).filter(({ type }) => (
      type === "call-ended"
    ));
    assert.equal(callEndedEvents.length, 1);
    assert.equal(callEndedEvents[0].callId, "test-short-call");
    assert.equal(
      callEndedEvents[0].callToken
        ?? callEndedEvents[0].callGeneration
        ?? callEndedEvents[0].generation
        ?? callEndedEvents[0].token,
      37,
      "call-ended must echo the exact invocation identity",
    );
    assert.equal(callEndedEvents[0].renderedSamples, callDurationSamples);
    assert.equal(callProcessor.transportPlaying, false);
    assert.equal(callProcessor.callActive, false);
    assert.equal(Math.abs(callSamples[0]), 0);
    assert.equal(Math.abs(callSamples[callDurationSamples - 1]), 0);
    assert.ok(callSamples.slice(callDurationSamples).every((sample) => sample === 0));
    assert.ok(
      Math.max(...callSamples.slice(2_400, callDurationSamples - 2_400).map(Math.abs)) > 1e-4,
      "one-shot call must remain audible between its attack and release",
    );
    const callReports = telemetry.slice(callTelemetryStart).filter(({ type }) => type === "telemetry");
    assert.ok(
      callReports.some((report) => report.mouthBursts.some((value) => value > 0.05)),
      "a lip-pop call must release a measurable mouth transient",
    );

    const closedMatrix = Array.from({ length: 4 }, () => [0, 0, 0]);
    for (const mediumId of ["air", "water", "pellets"]) {
      const closedProcessor = new RegisteredProcessor({
        processorOptions: {
          configuration: createColonySyrinxState({
            seed: 991,
            mediumId,
            breath: 1,
            pressureGain: 3,
            level: 1,
            routes: closedMatrix,
            alternateRoutes: closedMatrix,
          }),
          playing: true,
        },
      });
      let closedSquareSum = 0;
      let closedPeak = 0;
      let closedFrameCount = 0;
      for (let block = 0; block < 300; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        closedProcessor.process([], [[left, right]]);
        if (block < 150) continue;
        for (let index = 0; index < 128; index += 1) {
          closedPeak = Math.max(closedPeak, Math.abs(left[index]), Math.abs(right[index]));
          closedSquareSum += left[index] ** 2 + right[index] ** 2;
          closedFrameCount += 2;
        }
      }
      const closedRms = Math.sqrt(closedSquareSum / closedFrameCount);
      assert.ok(closedPeak < 1e-7, `${mediumId} closed-route peak leaked: ${closedPeak}`);
      assert.ok(closedRms < 1e-8, `${mediumId} closed-route RMS leaked: ${closedRms}`);
      assert.ok(closedProcessor.phonatorSources.every((value) => value === 0));
    }

    globalThis.sampleRate = 384_000;
    const highRate = new RegisteredProcessor({
      processorOptions: { configuration, breathActive: false, playing: false },
    });
    assert.equal(highRate.sourceRate, 384_000);
    assert.equal(highRate.sourceStepsPerOutput, 1);
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});
