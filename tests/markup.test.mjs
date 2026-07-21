import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the mobile instrument markup exposes the complete compact control surface", async () => {
  const [html, css, app, packageJson] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("style.css", root), "utf8"),
    readFile(new URL("app.js", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(html, /<script\s+type="module"\s+src="app\.js"><\/script>/);
  assert.match(html, /<canvas[\s\S]+?id="stage"/);
  assert.doesNotMatch(html, /Shape Player/i);

  const openingTag = (id) => {
    const match = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`));
    assert.ok(match, `missing opening tag for #${id}`);
    return match[0];
  };

  const sectionIds = ["playSection", "formSection", "soundSection", "mappingSection", "outputSection"];
  const sectionPositions = sectionIds.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(sectionPositions.every((position) => position >= 0));
  assert.deepEqual(sectionPositions, [...sectionPositions].sort((a, b) => a - b));
  for (const id of sectionIds) {
    assert.match(openingTag(id), /^<details\b/);
    assert.doesNotMatch(openingTag(id), /\sopen(?:\s|>)/, `${id} should start collapsed`);
  }
  for (const title of ["Play", "Form", "Sound", "Mapping", "Output"]) {
    assert.match(html, new RegExp(`<h2[^>]*>${title}<\\/h2>`));
  }
  assert.doesNotMatch(html, />\s*Advanced\s*</i);
  assert.equal((html.match(/class="group-summary"/g) ?? []).length, sectionIds.length);

  // Shared playback position and speed lead the Play section, before method selection.
  const playStart = html.indexOf('id="playSection"');
  const positionStart = html.indexOf('id="position"', playStart);
  const speedStart = html.indexOf('id="speed"', playStart);
  const methodStart = html.indexOf('id="playMethod"', playStart);
  assert.ok(playStart >= 0 && positionStart > playStart && speedStart > positionStart);
  assert.ok(methodStart > speedStart);
  assert.ok(html.indexOf('id="traceMode"', methodStart) < html.indexOf('id="scanMode"', methodStart));
  assert.ok(html.indexOf('id="scanMode"', methodStart) < html.indexOf('id="radialMode"', methodStart));

  const assertDefaultLeftChoice = (groupId, selectedId, selectedLabel, otherId) => {
    const groupStart = html.indexOf(`id="${groupId}"`);
    const selectedStart = html.indexOf(`id="${selectedId}"`, groupStart);
    const otherStart = html.indexOf(`id="${otherId}"`, groupStart);
    assert.ok(groupStart >= 0 && selectedStart > groupStart && otherStart > selectedStart);
    assert.match(openingTag(selectedId), /aria-pressed="true"/);
    assert.match(openingTag(otherId), /aria-pressed="false"/);
    assert.match(html.slice(selectedStart, otherStart), new RegExp(`>${selectedLabel}<\\/button>`));
  };

  // Reading method remains a compact rocker control.
  assertDefaultLeftChoice("playMethod", "traceMode", "Points", "scanMode");
  assert.equal((html.match(/class="choice-switch/g) ?? []).length, 4);
  assert.match(openingTag("loopMotion"), /aria-pressed="true"[^>]*aria-label="Loop movement"/);
  assert.match(openingTag("pingPongMotion"), /aria-pressed="false"[^>]*aria-label="Back-and-forth movement"/);
  assert.match(html, /id="loopMotion"[\s\S]*?>⟳<[\s\S]*?id="pingPongMotion"[\s\S]*?>↔</);

  // Loop / ping-pong is shared by every playhead type and forms one continuous
  // three-button array with direction beside Playhead speed, not the count row.
  const motionStart = html.indexOf('id="playheadMotion"', speedStart);
  const stepperStart = html.indexOf('id="playheadStepper"', methodStart);
  assert.ok(motionStart > speedStart && motionStart < methodStart);
  assert.ok(stepperStart > methodStart);
  assert.match(openingTag("playheadMotion"), /class="transport-button-array"/);
  assert.doesNotMatch(html, /playhead-count-motion-row|playhead-motion-choice/);
  assert.doesNotMatch(html, /Line movement/i);
  assert.doesNotMatch(html, /id="scanMotionControl"/);

  // Points and the first relative-spacing marker start at zero, the far left.
  assert.match(openingTag("position"), /value="0"/);
  assert.match(html, /id="positionOut"[^>]*>0\.0%<\/output>/);
  assert.doesNotMatch(openingTag("headsControl"), /\bhidden\b/);
  assert.match(openingTag("lineCountControl"), /\bhidden\b/);
  const options = [...html.matchAll(/id="headOption(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(options, Array.from({ length: 12 }, (_, index) => index));
  assert.match(openingTag("headOption0"), /class="head-option-toggle"/);
  assert.doesNotMatch(openingTag("headOption0"), /\bhidden\b/);
  assert.match(openingTag("headOption0"), /aria-label="Playhead 1 forward; reverse direction"/);
  assert.match(openingTag("headOption1"), /\bhidden\b/);
  assert.doesNotMatch(html, /id="lineAxis\d+"/);
  for (let index = 0; index < 12; index += 1) {
    assert.match(openingTag(`headOption${index}`), /class="head-option-toggle"/);
  }

  // Direction and motion mode stay visible whether or not either transport runs.
  assert.doesNotMatch(openingTag("traversalDirection"), /\bhidden\b/);
  assert.doesNotMatch(openingTag("rotationDirection"), /\bhidden\b/);
  assert.doesNotMatch(html, /id="(?:traversal|rotation)(?:Forward|Reverse)"/);
  assert.match(openingTag("rotationMotion"), /class="transport-button-array"/);
  assert.match(openingTag("rotationLoopMotion"), /aria-pressed="true"[^>]*aria-label="Loop rotation"/);
  assert.match(openingTag("rotationPingPongMotion"), /aria-pressed="false"[^>]*aria-label="Back-and-forth rotation"/);
  assert.match(html, /id="rotationLoopMotion"[\s\S]*?>⟳<[\s\S]*?id="rotationPingPongMotion"[\s\S]*?>↔</);
  assert.match(openingTag("resetRotation"), /aria-label="Reset rotation angle to zero degrees"/);
  assert.match(html, /class="rotation-angle-row"[\s\S]{0,300}id="rotation"[\s\S]{0,300}id="resetRotation"[^>]*>0°<\/button>/);
  assert.match(app, /const SPEED_MAX = 4;/);
  assert.match(app, /SPEED_MAX \* Math\.expm1\(SPEED_CURVE \* position\) \/ Math\.expm1\(SPEED_CURVE\)/);
  assert.match(app, /shepardPositionForContact/);
  assert.match(openingTag("rotationSpeed"), /max="4"/);
  assert.ok(html.includes('id="speedLabel"'));

  // The playhead phase editor is compact, draggable, keyboard-operable, and resettable.
  assert.ok(html.includes('id="headLayoutTrack"'));
  assert.ok(html.includes('id="resetHeadSpacing"'));
  assert.match(html, /id="resetHeadSpacing"[^>]*>Equidistant<\/button>/);
  for (const id of ["playheadStepper", "removePlayhead", "playheadCountOut", "addPlayhead"]) {
    assert.ok(html.includes(`id="${id}"`), `missing compact playhead control #${id}`);
  }
  assert.match(openingTag("addPlayhead"), /aria-label="Add one playhead"/);
  const markers = [...html.matchAll(/id="headMarker(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(markers, Array.from({ length: 12 }, (_, index) => index));
  assert.match(openingTag("headMarker0"), /aria-valuenow="0"/);
  assert.doesNotMatch(openingTag("headMarker0"), /\bhidden\b/);
  assert.match(openingTag("headMarker1"), /\bhidden\b/);

  // Side count directly selects circle/open line; closed forms retain a compact
  // polygon/star choice and star depth. Form transforms use centered signed
  // ranges with an adjacent reset action.
  assert.match(openingTag("sides"), /min="1"[^>]*max="32"[^>]*step="1"/);
  assert.match(html, /<b>Sides \/ points<\/b>/);
  assert.match(html, /1 circle · 2 open line · 3\+ polygon or star/);
  assertDefaultLeftChoice("closedShapeType", "polygonShape", "Polygon", "starShape");
  assert.match(openingTag("starDepthControl"), /\bhidden\b/);
  assert.match(openingTag("starDepth"), /min="0\.05"[^>]*max="0\.82"[^>]*value="0\.48"/);
  assert.match(openingTag("curvature"), /min="-1"[^>]*max="1"[^>]*value="0"/);
  assert.match(openingTag("aspect"), /min="-2"[^>]*max="2"/);
  assert.match(openingTag("skew"), /min="-2"[^>]*max="2"/);
  assert.match(html, /<span>In<\/span><span>Straight<\/span><span>Out<\/span>/);

  const assertAdjacentReset = (sliderId, resetId, label) => {
    assert.match(
      html,
      new RegExp(`<div class="form-range-row">[\\s\\S]{0,600}id="${sliderId}"[\\s\\S]{0,400}id="${resetId}"`),
    );
    assert.match(openingTag(resetId), new RegExp(`aria-label="[^"]*${label}[^"]*"`, "i"));
  };
  assertAdjacentReset("curvature", "resetCurvature", "straight");
  assertAdjacentReset("aspect", "resetAspect", "even");
  assertAdjacentReset("skew", "resetSkew", "zero");
  assert.doesNotMatch(
    html,
    /id="(?:shapeType|circleShape|asymmetry|asymmetryControl|curvatureDirection|curvatureOutward|curvatureIn)"/,
  );

  const soundSelect = html.match(/<select\s+id="soundMode"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(soundSelect, "missing sound mode select");
  assert.match(soundSelect[1], /<option[^>]*\svalue="sine"\s+selected>Sine\b/);
  assert.match(soundSelect[1], /<option\s+value="percussion">Percussion\b/);
  assert.match(soundSelect[1], /<option\s+value="shepard">Shepard\b/);
  assert.match(soundSelect[1], /<option\s+value="fm">FM\b/);
  assert.match(soundSelect[1], /<option\s+value="pm">PM\b/);
  assert.doesNotMatch(openingTag("amplitudeArticulation"), /\bhidden\b/);
  assert.match(openingTag("percussionArticulation"), /\bhidden\b/);
  assert.match(openingTag("shepardArticulation"), /\bhidden\b/);
  assert.match(openingTag("fmArticulation"), /\bhidden\b/);
  assert.match(openingTag("pmArticulation"), /\bhidden\b/);
  for (const id of [
    "amplitudeEnvelopeToggle", "amplitudeEnvelopeToggleText", "cornerSwellToggle", "cornerSwellToggleText",
    "amplitudeEnvelopePresets", "amplitudePresetPluck", "amplitudePresetNote",
    "amplitudePresetSustain", "amplitudePresetPad",
    "amplitudeCurveEditor", "amplitudeCurvePath", "resetAmplitudeCurve",
    "amplitudeCurveState", "amplitudeReleaseBehavior", "amplitudeIntervalHelp",
  ]) assert.ok(html.includes(`id="${id}"`), `missing amplitude ADSR control #${id}`);
  assert.match(openingTag("amplitudeEnvelopeToggle"), /aria-pressed="true"[^>]*aria-label="Amplitude ADSR on"/);
  assert.match(openingTag("cornerSwellToggle"), /aria-pressed="false"[^>]*aria-label="Corner swell off"/);
  assert.match(html, /id="cornerSwellToggleText"[^>]*>Swell off</);
  assert.match(html, /id="cornerSwellToggle"[\s\S]{0,160}>▶◀</);
  assert.match(openingTag("amplitudePresetPluck"), /data-value="pluck"[^>]*aria-pressed="true"/);
  assert.match(openingTag("amplitudePresetNote"), /data-value="note"[^>]*aria-pressed="false"/);
  const amplitudeNodes = [...html.matchAll(/id="amplitudeNode(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(amplitudeNodes, [0, 1, 2, 3, 4]);
  assert.match(html, /Corner trigger 0% → next corner 100%/);
  assert.doesNotMatch(html, /id="(?:sineArticulation|sineAccent|sineDecay)"/);
  assert.match(app, /sampleAmplitudeEnvelope/);
  assert.match(app, /scaleShapeVoiceGains/);
  assert.match(app, /state\.cornerSwell/);
  assert.match(app, /mirroredCornerPhase\(path, contact\)/);
  assert.match(openingTag("cornerDecay"), /min="15"[^>]*max="2000"[^>]*value="90"/);

  // Mapping has one permanent reference: fixed stage/screen axes. There is no
  // Form-local coordinate-frame choice to drift when the contour rotates.
  assert.doesNotMatch(html, /id="mappingFrame"|Shape axes · rotate with form/);
  assert.doesNotMatch(app, /mappingFrame|currentLocalShape/);
  for (const id of [
    "mappingSummary", "pitchDimension", "pitchVertical", "pitchHorizontal", "pitchCenter",
    "pitchCurvePresets", "pitchCurveLinear", "pitchCurveExponential", "pitchCurveLogarithmic",
    "pitchCurveSmooth", "pitchCurveInverted", "pitchCurveEditor", "pitchCurvePath",
    "resetPitchCurve", "stereoDimension", "stereoHorizontal", "stereoVertical", "stereoCenter",
    "stereoInvert", "stereoMappingNote", "stereoWidth", "panRouteSource", "panRouteCurve",
    "percussionMapping", "percussionLevelSource", "percussionLevelCurve",
    "timbreMapping", "timbreSource", "timbreMappingNote", "timbreSourceHelp", "percussionSourceHelp",
    "shepardCycles", "shepardDirection", "shepardWidth",
    "fmIndex", "fmRatio", "pmIndex", "pmRatio",
  ]) assert.ok(html.includes(`id="${id}"`));
  assert.match(html, /Octaves per circuit/);
  assert.match(html, /oct \/ circuit/);
  assertDefaultLeftChoice("pitchDimension", "pitchVertical", "[\\s\\S]*Vertical", "pitchHorizontal");
  assert.match(openingTag("pitchHorizontal"), /data-value="horizontal"[^>]*aria-pressed="false"/);
  assert.match(openingTag("pitchCenter"), /data-value="center"[^>]*aria-pressed="false"/);
  assert.match(html, /Stage \/ screen axes stay fixed while the form rotates/);
  assert.doesNotMatch(html, /id="pitchSource"/);
  assert.match(app, /source === "horizontal"/);
  assert.match(app, /return clamp\(normalized\.y, 0, 1\)/);
  assert.match(app, /sourceValueForContact/);
  assert.doesNotMatch(app, /rawMarkForSource/);
  assert.doesNotMatch(html, /id="pitchCurve"/);
  assert.match(openingTag("pitchCurveLinear"), /data-value="linear"[^>]*aria-pressed="true"/);
  assert.match(openingTag("pitchCurveExponential"), /data-value="exponential"[^>]*aria-pressed="false"/);
  assert.match(openingTag("pitchCurveLogarithmic"), /data-value="logarithmic"[^>]*aria-pressed="false"/);
  const pitchCurveNodes = [...html.matchAll(/id="pitchCurveNode(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(pitchCurveNodes, [0, 1, 2, 3, 4]);
  assert.match(openingTag("pitchCurveNode2"), /role="slider"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-valuenow="50"/);
  assert.match(html, /Drag nodes · arrows 1% · Shift 5%/);
  assert.match(app, /updateMappingCurveNode/);
  assert.match(app, /evaluateMappingCurve/);
  assertDefaultLeftChoice("stereoDimension", "stereoHorizontal", "[\\s\\S]*Horizontal", "stereoVertical");
  assert.match(openingTag("stereoVertical"), /data-value="vertical"[^>]*aria-pressed="false"/);
  assert.match(openingTag("stereoCenter"), /data-value="center"[^>]*aria-pressed="false"/);
  assert.match(openingTag("stereoInvert"), /aria-pressed="false"[^>]*aria-label="Reverse horizontal stereo direction"/);
  assert.match(html, /0% mono · 100% full mapped width/);
  assert.match(app, /panSource \* 2 - 1/);
  assert.match(app, /state\.stereoInverted \? -1 : 1/);

  // Timbre has an explicit source and a sound-specific DSP destination.
  assert.match(html, /<span class="field-label">Timbre source<\/span>/);
  assert.match(openingTag("timbreSource"), /aria-describedby="timbreMappingNote timbreSourceHelp"/);
  assert.match(openingTag("percussionLevelSource"), /aria-describedby="percussionSourceHelp"/);
  assert.match(html, />Crossing angle<\/option>/);
  assert.match(html, />Corner sharpness<\/option>/);
  assert.match(html, />Contour position<\/option>/);
  assert.match(html, />Distance from center<\/option>/);
  assert.match(html, /Maximum spectral width/);
  assert.match(html, /id="pmIndexOut"[^>]*>2\.00 rad max<\/output>/);
  assert.match(html, /0 is smooth · 1 is the sharpest turn/);
  assert.match(app, /\["fm", "pm", "shepard"\]\.includes\(state\.soundMode\)/);
  assert.match(app, /TIMBRE_TARGET_LABELS/);
  assert.match(app, /SOURCE_HELP/);
  assert.match(app, /0 is stage top · 1 is stage bottom/);
  assert.match(app, /0 follows the contour · 1 crosses at 90°/);
  assert.match(app, /if \(state\.playMethod === "trace"\) return 0;/);
  assert.match(app, /Point playheads follow the contour · crossing angle stays 0/);
  assert.match(app, /Stage top → audio left · stage bottom → audio right/);
  assert.match(app, /scanAxis: head\?\.axis === "path" \? undefined : head\?\.axis/);
  assert.match(app, /strikeCorner\(path, afterVertex, headIndex, time01, afterHead\)/);
  assert.doesNotMatch(html, /mark-driven|drive mark|level mark|Pitch mark|Realtime mark|Corner magnitude|>Incidence<|Contour phase/i);

  // Output is a realtime mapping dashboard with clearly future-facing external routes.
  for (const id of [
    "markPhaseOut", "markPositionOut", "markCenterOut", "markTurnOut", "markDistanceOut",
    "markIncidenceOut", "markTangentOut", "markPitchValueOut", "markFrequencyOut",
    "markGainOut", "markPanOut", "markSynthDriveOut", "markSynthValueOut",
    "markDecayOut", "markRotationOut", "contactStream",
    "timbreRoute", "timbreRouteSource", "timbreRouteTarget", "timbreRouteCurve",
  ]) assert.ok(html.includes(`id="${id}"`), `missing output #${id}`);
  assert.match(html, /aria-label="Realtime mapping values"/);
  assert.match(html, /<dt>Pitch source value<\/dt>/);
  assert.match(html, /<dt>Timbre source value<\/dt>/);
  assert.match(html, /Web MIDI · planned/);
  assert.match(html, /OSC · planned/);
  assert.match(html, /JSON stream · planned/);

  // On narrow screens the stage stays put while the parameter panel owns scrolling.
  assert.match(css, /@media\s*\(max-width:\s*960px\)[\s\S]*?\.stage\s*\{[\s\S]*?position:\s*sticky;/);
  assert.match(css, /@media\s*\(max-width:\s*960px\)[\s\S]*?\.panel\s*\{[\s\S]*?overflow-y:\s*auto;/);
  assert.match(css, /@media\s*\(max-width:\s*960px\)\s*and\s*\(max-height:\s*560px\)/);
  assert.match(css, /\.head-layout-track\.has-head-options[\s\S]*?height:\s*76px/);
  assert.match(css, /\.transport-button-array\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*42px\)/);
  assert.match(css, /\.transport-button-array\s*>\s*button\s*\{[\s\S]*?width:\s*42px;[\s\S]*?height:\s*44px;/);
  assert.match(css, /\.transport-button-array\s*>\s*button\s*\+\s*button\s*\{[\s\S]*?border-left:\s*0;/);
  assert.match(css, /\.curve-editor\s*\{[\s\S]*?height:\s*96px;/);
  assert.match(css, /\.curve-node\s*\{[\s\S]*?position:\s*absolute;/);
  assert.match(css, /\.amplitude-mode-buttons\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*52px\)/);
  assert.match(css, /\.amplitude-preset-strip\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*1fr\)/);
  assert.match(css, /\.master-level-row\s*\{/);
  assert.match(css, /\.mapping-source-help\s*\{/);
  assert.match(css, /\.audio-strip\.shape-audio-strip\s*\{[\s\S]*?grid-template-columns:\s*max-content/);
  assert.match(css, /@media\s*\(pointer:\s*coarse\)[\s\S]*?\.head-option-toggle\s*\{[\s\S]*?width:\s*36px/);
  assert.match(openingTag("amplitudeNode2"), /role="slider"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-valuenow="32"/);
  assert.match(app, /amplitudeCurveEditor"\)\.setAttribute\("aria-disabled"/);
  assert.match(app, /speed"\)\.setAttribute\("aria-valuetext", formatPlayheadSpeed\(\)\)/);
  assert.match(app, /marker\.setAttribute\("aria-label", `\$\{reader\} \$\{index \+ 1\} relative phase`\)/);
  assert.match(app, /rgba\(214,232,226,\.25\)/);

  assert.ok(html.indexOf('id="audioButton"') < html.indexOf('id="playSection"'));
  assert.ok(html.indexOf('id="level"') > html.indexOf('id="outputSection"'));
  assert.ok(html.indexOf('id="level"') < html.indexOf('class="reset-all-row"'));
  assert.match(html, /<b>Master level<\/b>/);
  assert.doesNotMatch(html.slice(0, html.indexOf("<main")), /id="level"|class="header-level"/);
  assert.doesNotMatch(html, /id="restartButton"|id="displayTitle"|id="guidesToggle"|id="verticesToggle"|id="trailsToggle"/);

  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(htmlIds).size, htmlIds.length, "HTML ids must be unique");

  const referencedIds = new Set(
    [...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]),
  );
  for (const match of app.matchAll(/bindRange\("([^"]+)"/g)) {
    referencedIds.add(match[1]);
    referencedIds.add(`${match[1]}Out`);
  }
  const idSet = new Set(htmlIds);
  const missing = [...referencedIds].filter((id) => !idSet.has(id));
  assert.deepEqual(missing, [], `app.js references missing ids: ${missing.join(", ")}`);

  const manifest = JSON.parse(packageJson);
  assert.equal(manifest.name, "morphazoid");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.devDependencies, undefined);
  assert.doesNotMatch(packageJson, /next|react|typescript/i);
});
