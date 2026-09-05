import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [html, app, model, processor, css, icon] = await Promise.all([
  readFile(new URL("creaturazoid.html", root), "utf8"),
  readFile(new URL("creaturazoid-app.js", root), "utf8"),
  readFile(new URL("src/creaturazoid.js", root), "utf8"),
  readFile(new URL("src/creaturazoid-processor.js", root), "utf8"),
  readFile(new URL("creaturazoid.css", root), "utf8"),
  readFile(new URL("assets/instruments/creaturazoid.webp", root)),
]);

function occurrences(source, expression) {
  return [...source.matchAll(expression)];
}

function standaloneFunctionBody(source, name) {
  const signature = new RegExp(`function\\s+${name}\\s*\\(`);
  const match = signature.exec(source);
  assert.ok(match, `missing ${name}()`);
  const bodyStart = source.indexOf("{", source.indexOf(")", match.index));
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`unterminated ${name}()`);
}

test("Creaturazoid exposes three horned, feather-winged anatomical forms and action limbs to assistive technology", () => {
  assert.match(html, /<title>Creaturazoid · Morphazoid<\/title>/);
  assert.match(html, /aria-label="Interactive front-view horned mammal-bird hybrid specimen"/);
  assert.match(
    html,
    /aria-label="A front-view horned mammal-bird hybrid whose varied mobile ears, feathered wings, slit eyes, morphing muzzle, physical tongue, irregular teeth, forelegs, hooves, morphing tail, vibrating neck, lungs, and belly exaggerate each sounding gesture around restrained draggable anatomy controls\."/,
  );
  assert.match(html, /A forward-facing horned mammal-bird chimera with one wildly morphing physical airway\./);

  for (const anatomy of [
    "horns recoil",
    "ears twitch",
    "feathered wings flare",
    "slit eyes tense",
    "physical tongue",
    "irregular teeth",
    "belly",
    "lungs",
    "cheek arches",
    "neck",
    "forelegs stomp",
    "claws rake",
    "persistent tail whips",
  ]) {
    assert.match(html, new RegExp(anatomy, "i"), `${anatomy} needs accessible instructions`);
  }

  assert.match(html, /id="anatomySelect"/);
  assert.match(html, /value="scapular-wings"/);
  assert.match(html, /value="branchial-mantle"/);
  assert.match(html, /value="costal-glider"/);
  assert.doesNotMatch(html, /Brow vibrato/i);

  assert.match(html, /id="canvasInstructions"/);
  assert.match(html, /aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /id="liveStatus" aria-live="polite"/);
});

test("the page describes and builds one monophonic dual-lane step row", () => {
  assert.match(html, /Creaturazoid monophonic call sequencer/);
  assert.match(html, /ONE AIRWAY/);
  assert.match(html, /continuous volume/i);
  assert.match(html, /exact call (?:from its dropdown|selector)/i);
  assert.match(html, /lower sound selector/i);
  assert.match(html, /(?:drag|paint) horizontally/i);
  assert.match(html, /Each step holds at most one onset/);
  assert.match(html, /Empty sequence columns let long calls keep sounding/);
  assert.match(html, /id="sequenceGrid"[^>]+role="grid"[^>]+aria-describedby="sequenceStepHelp"/);
  assert.match(html, /aria-rowcount="1"/);
  assert.match(html, /aria-colcount="32"/);
  assert.match(html, /id="sequenceLengthEntry"[^>]+min="1"[^>]+max="64"[^>]+value="32"/);
  assert.match(html, /id="sequenceLength"[^>]+min="1"[^>]+max="64"[^>]+value="32"/);

  const gridBuilder = standaloneFunctionBody(app, "buildSequenceGrid");
  assert.match(gridBuilder, /className = "creaturazoid-grid-row creaturazoid-grid-single-lane"/);
  assert.match(gridBuilder, /row\.setAttribute\("role", "row"\)/);
  assert.match(gridBuilder, /for \(let step = 0; step < pattern\.length; step \+= 1\)/);
  assert.match(gridBuilder, /slot\.className = "creaturazoid-step-slot"/);
  assert.match(gridBuilder, /slot\.setAttribute\("role", "gridcell"\)/);
  assert.match(gridBuilder, /cell\.className = "creaturazoid-step-cell"/);
  assert.match(gridBuilder, /selector\.className = "creaturazoid-step-sound-select"/);
  assert.match(gridBuilder, /soundLane\.className = "creaturazoid-step-sound-lane"/);
  assert.match(gridBuilder, /slot\.append\(cell, preview, selector, soundLaneShell\)/);
  assert.doesNotMatch(gridBuilder, /headerRow|creaturazoid-grid-cell/);
  assert.match(app, /pattern = setCreaturazoidStep\(/);
  assert.match(app, /monophonic/);
});

test("sequence presets recall length, tempo, and swing while manual timing becomes custom", () => {
  assert.match(html, /id="tempoOut"[^>]*>126 BPM<\/output>/);
  assert.match(html, /id="tempo"[^>]*value="126"/);
  assert.match(html, /id="swingOut"[^>]*>8%<\/output>/);
  assert.match(html, /id="swing"[^>]*value="0\.08"/);

  const loadPreset = standaloneFunctionBody(app, "setSequencePreset");
  assert.match(loadPreset, /sanitizeCreaturazoidPattern\(preset, preset\.length\)/);
  assert.match(loadPreset, /tempo:\s*preset\.tempo/);
  assert.match(loadPreset, /swing:\s*preset\.swing/);
  assert.match(loadPreset, /patternLength:\s*preset\.length/);
  assert.match(loadPreset, /sequencePresetId:\s*preset\.id/);
  assert.match(loadPreset, /syncControls\(\);/);
  assert.match(loadPreset, /buildSequenceGrid\(\{ preserveScroll: false \}\);/);
  assert.doesNotMatch(loadPreset, /resetSequenceSchedule|silencePhysicalModel|stopSequence/);
  assert.match(loadPreset, /BPM[\s\S]*percent swing/);

  const sync = standaloneFunctionBody(app, "syncControls");
  assert.match(sync, /\$\("sequenceLength"\)\.value = String\(pattern\.length\)/);
  assert.match(sync, /\$\("sequenceLengthEntry"\)\.value = String\(pattern\.length\)/);
  assert.match(sync, /--knob-turn/);
  assert.match(sync, /\$\("tempo"\)\.value = String\(state\.tempo\)/);
  assert.match(sync, /\$\("swing"\)\.value = String\(state\.swing\)/);
  assert.match(sync, /button\.classList\.toggle\("is-active", active\)/);
  assert.match(sync, /button\.setAttribute\("aria-pressed", String\(active\)\)/);

  const scheduler = standaloneFunctionBody(app, "schedulerTick");
  assert.match(scheduler, /nextStepNumber % pattern\.length/);
  assert.match(scheduler, /creaturazoidStepIntervalSeconds\(state\.tempo, state\.swing, nextStepNumber\)/);
  const custom = standaloneFunctionBody(app, "markPatternCustom");
  assert.match(custom, /currentPatternId = "custom"/);
  assert.match(custom, /Custom rhythm/);
  assert.match(app, /\$\("tempo"\)\.addEventListener\("input", \(\) => \{[\s\S]{0,420}?markPatternCustom\(\)/);
  assert.match(app, /\$\("swing"\)\.addEventListener\("input", \(\) => \{[\s\S]{0,420}?markPatternCustom\(\)/);
});

test("body, tongue, ear, attack, vibrato, and modulation controls are present and wired", () => {
  const rangeIds = [
    "bodyScale",
    "bodyRoundness",
    "morph",
    "morphMs",
    "attackMs",
    "vibratoRate",
    "vibratoDepth",
    "modulationRate",
    "modulationDepth",
    "earSpread",
    "tongueReach",
    "tongueMotion",
  ];
  for (const id of [...rangeIds, "modulationTarget", "modulationShape"]) {
    assert.match(html, new RegExp(`(?:for|id)="${id}"`), `missing ${id} control`);
  }
  for (const id of rangeIds) {
    assert.match(app, new RegExp(`id: "${id}"`), `the app must bind ${id}`);
  }
  assert.match(app, /\$\("modulationTarget"\)\.addEventListener\("change"/);
  assert.match(app, /\$\("modulationShape"\)\.addEventListener\("change"/);

  const pointerDown = standaloneFunctionBody(app, "handleCanvasPointerDown");
  assert.match(pointerDown, /hitDistance: distance\(candidate, point\)/);
  assert.match(pointerDown, /sort\(\(left, right\) => left\.hitDistance - right\.hitDistance\)/);

  assert.match(html, /Body shape preset/);
  assert.match(html, /Ears \/ horns \/ wings/);
  assert.match(html, /Body morph/);
  assert.match(html, /Call retarget/);
  assert.match(html, /Pad attack/);
  assert.match(html, /id="bodyScale"[^>]+min="0\.55"[^>]+max="1\.35"/);
  assert.match(html, /id="bodyRoundness"[^>]+min="-1"[^>]+max="1"/);
  assert.match(html, /id="attackMs"[^>]+min="8"[^>]+max="48"/);
  assert.match(html, /id="bodySizeReadout"/);
  assert.match(html, /id="bodyMotionReadout"/);
  assert.match(html, /Mutate body shape/);
  assert.match(html, /Left-wing vibrato/);
  assert.match(html, /Right-wing depth/);
  assert.match(html, /Ear spread/);
  assert.match(html, /Tongue reach/);
  assert.match(html, /Tongue motion/);
  assert.match(html, /Feather motion target/);
  assert.match(html, /Feather motion shape/);
  assert.match(html, /Feather motion rate/);
  assert.match(html, /Feather motion depth/);
  assert.doesNotMatch(html, /class="creaturazoid-airway-card"/);
  assert.doesNotMatch(html, /class="[^"]*creaturazoid-model-notes/);
  assert.doesNotMatch(html, /id="presetDescription"/);
  assert.doesNotMatch(app, /\$\("presetDescription"\)/);
  const controlLabels = occurrences(html, /<label class="control"[\s\S]*?<\/label>/g)
    .map(([markup]) => markup);
  assert.ok(controlLabels.length > 0);
  assert.ok(controlLabels.every((markup) => !/<small\b/.test(markup)), "parameter rows must not restore helper copy");

  const mutateBody = standaloneFunctionBody(app, "randomizeCreature");
  assert.match(mutateBody, /state = mutateCreaturazoidState\(state\)/);
  assert.doesNotMatch(mutateBody, /Math\.random/);
  assert.match(mutateBody, /bodyMutationVisual = Object\.freeze/);

  assert.match(html, /<link rel="stylesheet" href="creaturazoid\.css\?v=[^"]+" \/>/);
  assert.match(html, /<script type="module" src="nav\.js\?v=[^"]+"><\/script>/);
  assert.match(html, /<script type="module" src="creaturazoid-app\.js\?v=[^"]+"><\/script>/);
  assert.match(app, /from "\.\/src\/creaturazoid\.js\?v=[^"]+"/);
  assert.match(app, /from "\.\/src\/syrinx\.js\?v=[^"]+"/);
  assert.match(app, /\.\/src\/creaturazoid-processor\.js\?v=/);
});

test("mobile actions precede the sequencer while the stage stays fixed above the lower scroller", () => {
  const belowStageIndex = html.indexOf('<div class="creaturazoid-below-stage">');
  const mobileActionsIndex = html.indexOf('<div class="creaturazoid-mobile-actions"');
  const sequencerIndex = html.indexOf('<section class="creaturazoid-sequencer"');
  const panelIndex = html.indexOf('<aside class="panel creaturazoid-panel"');
  assert.ok(
    belowStageIndex >= 0
      && mobileActionsIndex > belowStageIndex
      && sequencerIndex > mobileActionsIndex
      && panelIndex > sequencerIndex,
    "the mobile mutate/randomize strip must sit above the sequencer and parameter panel",
  );
  assert.match(html, /id="mobileMutateButton"[^>]+data-creaturazoid-action="mutate-body"/);
  assert.match(html, /id="mobileRandomPatternButton"[^>]+data-creaturazoid-action="randomize-rhythm"/);

  const bindings = standaloneFunctionBody(app, "bindControls");
  assert.match(bindings, /querySelectorAll\('\[data-creaturazoid-action="mutate-body"\]'\)/);
  assert.match(bindings, /querySelectorAll\('\[data-creaturazoid-action="randomize-rhythm"\]'\)/);

  const mobileStart = css.indexOf("@media (max-width: 960px)");
  const narrowStart = css.indexOf("@media (max-width: 680px)", mobileStart);
  const desktopCss = css.slice(0, mobileStart);
  const mobileCss = css.slice(mobileStart, narrowStart);
  assert.ok(mobileStart >= 0 && narrowStart > mobileStart);
  assert.match(desktopCss, /\.creaturazoid-mobile-actions\s*\{\s*display:\s*none/);
  assert.match(mobileCss, /\.creaturazoid-page\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(mobileCss, /\.creaturazoid-shell\s*\{[\s\S]*?height:\s*calc\(100dvh - 58px\)[\s\S]*?grid-template-rows:\s*clamp\(260px, 44dvh, 420px\) minmax\(0, 1fr\)/);
  assert.match(mobileCss, /\.creaturazoid-stage\s*\{[\s\S]*?grid-row:\s*1/);
  assert.match(mobileCss, /\.creaturazoid-below-stage\s*\{[\s\S]*?overflow-y:\s*auto[\s\S]*?grid-row:\s*2/);
  assert.match(mobileCss, /\.creaturazoid-mobile-actions\s*\{[\s\S]*?position:\s*sticky[\s\S]*?top:\s*0[\s\S]*?display:\s*grid/);
  assert.match(mobileCss, /#randomPatternButton,\s*\.creaturazoid-preset-deck #randomizeButton\s*\{\s*display:\s*none/);
});

test("body presets are persistent physical shapes while calls retain local multi-envelope motion", () => {
  assert.match(model, /export const CREATURAZOID_BODY_PRESETS/);
  assert.match(model, /export function creaturazoidBodyPreset\s*\(/);
  assert.match(
    model,
    /export function\s+\w*(?:BodyBaseline|BodyBase)\w*\s*\(/i,
    "the model must expose a persistent body-baseline resolver",
  );
  assert.match(
    model,
    /export function\s+\w*(?:AttackPhase|RhythmicPhase)\w*\s*\(/i,
    "the model must expose its shortened attack-phase mapping",
  );
  assert.match(model, /bodyMotion\s*[:,]/);
  assert.match(model, /(?:speed|rate)\s*:[\s\S]{0,180}depth\s*:/i);

  assert.match(app, /state\.bodyPresetId/);
  assert.match(app, /creaturazoidBodyPreset\(state\.bodyPresetId\)|selectedBody(?:Palette|Profile)\s*\(/);
  assert.match(
    app,
    /elapsedSeconds:\s*(?:offsetSeconds|callLocalElapsedSeconds|eventElapsedSeconds|gestureElapsedSeconds)/,
    "scheduled modulation must restart in call-local time",
  );
  assert.match(app, /\$\("bodySizeReadout"\)/);
  assert.match(app, /\$\("bodyMotionReadout"\)/);

  const sequencePresetBody = standaloneFunctionBody(app, "setSequencePreset");
  assert.doesNotMatch(
    sequencePresetBody,
    /creaturazoidState\(\s*preset\.(?:voice|body)PresetId/,
    "loading rhythm must not load its suggested body",
  );
  assert.match(sequencePresetBody, /sanitizeCreaturazoidState|bodyPresetId/);

  assert.match(html, /Body shape preset/);
  assert.match(html, /Mutate body shape/);
  assert.doesNotMatch(html, /creaturazoid-model-notes/);
  assert.doesNotMatch(html, />Creature preset</i);
});

test("the instrument uses Morphazoid black surfaces and Hiccup-style rectangular steps", () => {
  assert.match(css, /--creature-paper:\s*#030806/);
  for (const color of ["#baff54", "#e3ff9f", "#59f1df", "#b6fff5", "#ff5f87", "#ffcf68", "#d08cff", "#64cfff", "#ff7b6f"]) {
    assert.match(`${css}\n${model}`, new RegExp(color), `${color} must survive from the Hybrinx palette`);
  }
  assert.match(css, /\.creaturazoid-grid-single-lane\s*\{[\s\S]*?grid-template-columns:\s*repeat\(var\(--sequence-columns, 32\), minmax\(0, 1fr\)\)[\s\S]*?gap:\s*0/);
  assert.match(css, /\.creaturazoid-step-cell\s*\{[\s\S]*?min-height:\s*136px[\s\S]*?border-radius:\s*0/);
  assert.match(css, /\.creaturazoid-step-volume-lane::before\s*\{[\s\S]*?bottom:\s*0[\s\S]*?height:\s*calc\(var\(--step-velocity\) \* 100%\)/);
  assert.match(css, /\.creaturazoid-step-sound-lane-shell\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /input\.creaturazoid-step-sound-lane\s*\{[\s\S]*?writing-mode:\s*vertical-lr[\s\S]*?touch-action:\s*none/);
  assert.match(css, /\.creaturazoid-preset-deck > \.creaturazoid-body-metrics\s*\{/);
  assert.match(css, /\.creaturazoid-body-metrics\s+output\s*\{/);
  assert.doesNotMatch(app, /cell\.dataset\.level = String\(level\)/);
  assert.match(app, /selector\.style\.setProperty\("--row-color", rowColor\)/);
  assert.match(app, /selector\.closest\("\.creaturazoid-step-slot"\)\?\.style\.setProperty\("--row-color", rowColor\)/);
  assert.match(css, /grid-template-columns:\s*96px 132px minmax\(180px, 1fr\)/);
  assert.match(css, /\.creaturazoid-transport\s*\{[\s\S]*?width:\s*96px/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.creaturazoid-step-cell\s*\{[\s\S]*?min-height:\s*104px/);
  assert.match(app, /sequenceRunning \? "Stop" : "Play"/);
});

test("one AudioWorklet node receives sample-addressed contours for one physical voice", () => {
  assert.equal(
    occurrences(app, /\bnew\s+AudioWorkletNode\s*\(/g).length,
    1,
    "Creaturazoid must construct one AudioWorklet node",
  );
  assert.match(
    app,
    /new AudioWorkletNode\(context, "creaturazoid-physical-model", \{/,
  );

  const appVoiceCounts = occurrences(app, /voiceCount:\s*([^,}\n]+)/g)
    .map((match) => match[1].trim());
  assert.ok(appVoiceCounts.length > 0);
  assert.deepEqual(new Set(appVoiceCounts), new Set(["1"]));
  assert.match(app, /voiceSpreadCents:\s*0/);

  assert.match(app, /frame:\s*Math\.round\(eventTime \* audioContext\.sampleRate\)/);
  assert.match(app, /const serial = \+\+serialCounter;/);
  assert.match(app, /creaturazoidContourOffsets\(duration, state, sound, \{ sequenced \}\)/);
  assert.match(app, /creaturazoidSequenceDurationSeconds\(sound\)/);
  assert.match(app, /scheduleSound\(event\.sound, event\.velocity, time, \{ visual: false, sequenced: true \}\)/);
  assert.match(app, /events\.push\(\{[\s\S]*?serial,[\s\S]*?begin:\s*index === 0/);
  assert.match(app, /begin:\s*index === 0/);
  assert.match(app, /contact:\s*index === 0 && sound\.articulation\?\.contact/);
  assert.match(app, /startPhase:\s*sequenceOnsetPhase/);
  assert.match(app, /makeupGain:\s*creaturazoidLevelMakeup\(sound\)/);
  assert.match(app, /bodyGainTrim:\s*creaturazoidBodyLevelTrim\(sound, stateSnapshot\)/);
  assert.match(app, /events\.push\(\{[\s\S]*?velocity:\s*clamp\(velocity\),[\s\S]*?configuration:/);
  const scheduler = standaloneFunctionBody(app, "scheduleSound");
  assert.match(scheduler, /velocity:\s*targetState\.velocity/);
  assert.match(scheduler, /sequenced:\s*targetState\.sequenced/);
  for (const field of [
    "airwayGate", "articulationVoicing", "articulationPressure", "turbulence",
    "burstGain", "burstFrequencyHz", "flutterHz", "flutterDepth", "flowDirection",
  ]) assert.match(app, new RegExp(`${field}:`), `${field} must reach the physical tract`);
  const physicalConfiguration = standaloneFunctionBody(app, "physicalConfiguration");
  assert.match(physicalConfiguration, /const tongue = performanceState\.tongue \?\? creaturazoidTongueState/);
  assert.match(physicalConfiguration, /\.\.\.tongue/);
  assert.match(physicalConfiguration, /earSpread:\s*state\.earSpread/);
  assert.match(physicalConfiguration, /const effectiveAirwayGate = Math\.min\(articulationGate, tongueGate\)/);
  assert.match(physicalConfiguration, /performanceState\.sequenced[\s\S]*?effectiveAirwayGate >= 0\.2/);
  assert.match(physicalConfiguration, /0\.24 \+ clamp\(performanceState\.velocity \?\? 1\) \* 0\.76/);
  assert.equal(
    occurrences(app, /postMessage\(\{ type: "schedule", events \}\)/g).length,
    1,
  );
});

test("each scheduled gesture drives an exaggerated sound-specific anatomy pose", () => {
  assert.match(app, /function familyPose\(sound, timeSeconds, performanceState\)/);
  assert.match(app, /const visual = sound \? activeVisualEvent : null;/);
  assert.match(app, /const phase = visual[\s\S]*?visual\.duration/);
  assert.match(app, /const velocity = visual \? clamp\(visual\.velocity\) : 0;/);
  assert.match(app, /performanceState\?\.pressure/);
  assert.match(app, /const actionPhase = clamp\(finiteOr\(performanceState\?\.articulationPhase, phase\)\)/);

  for (const response of [
    "mouthOpen",
    "mouthExpression",
    "expressionAmount",
    "mean",
    "happy",
    "hungry",
    "gobsmacked",
    "howl",
    "openBeak",
    "eyeBurst",
    "neckStretch",
    "neckWobble",
    "throatPulse",
    "breath",
    "wingFlap",
    "projection",
    "beakMorph",
    "colorBeat",
    "jawSnap",
    "tongueFlick",
    "nostrilFlare",
    "hornKick",
    "featherRuffle",
    "bodyDrop",
    "tailSweep",
    "tailMotion",
    "earTwitch",
    "earSplay",
    "clawSwipe",
    "footStrike",
  ]) {
    assert.match(app, new RegExp(`${response}:|const ${response} =`), `${response} must follow the sounding gesture`);
  }
  assert.match(app, /const expression = creaturazoidMouthExpression\(sound\)/);

  assert.match(app, /function rhythmicPalette\(palette, pose\)/);
  assert.match(app, /const palette = rhythmicPalette\(selectedPalette\(\), pose\);/);
  assert.match(app, /drawSpecimenWings\(drawing, timeSeconds, palette, pose, anatomy\);/);
  assert.match(app, /drawSpecimenTail\(drawing, timeSeconds, palette, pose, anatomy\);/);
  assert.match(app, /drawSpecimenThorax\(drawing, palette, pose, anatomy\);/);
  assert.match(app, /drawSpecimenLimbsAndActions\(drawing, palette, pose, anatomy\);/);
  assert.match(app, /drawSpecimenHead\(drawing, palette, pose, anatomy\);/);
  assert.match(app, /drawSpecimenEars\(drawing, palette, pose, anatomy\);/);
  assert.match(app, /drawSoundProjection\(drawing, palette, pose, anatomy\);/);
  assert.match(app, /drawSpecimenHorns\(context, palette, pose, anatomy, skullWidth, top\);/);
  assert.match(app, /The exact Hybrinx tongue state that reshapes the waveguide is rendered/);
  assert.match(app, /const toothPositions = \[0\.07, 0\.2, 0\.34, 0\.49, 0\.63, 0\.78, 0\.92\];/);
  assert.match(app, /const canine = index === 1 \|\| index === toothPositions\.length - 2;/);

  const anatomy = standaloneFunctionBody(app, "activeAnatomyDesign");
  for (const field of [
    "mouthWidth", "mouthDepth", "jawTaper", "lipCurl",
    "earType", "earLength", "earWidth", "earDroop", "earRotation",
    "tailType", "tailLength", "tailThickness", "tailCurl", "tailTuft", "tongueWidth",
  ]) assert.match(anatomy, new RegExp(`${field}:`), `${field} must follow the selected body`);
  const head = standaloneFunctionBody(app, "drawSpecimenHead");
  assert.match(head, /anatomy\.mouthWidth/);
  assert.match(head, /anatomy\.mouthDepth/);
  for (const channel of ["mean", "happy", "hungry", "gobsmacked", "howl", "openBeak"]) {
    assert.match(head, new RegExp(`pose\\.${channel}`), `the head renderer must consume ${channel}`);
  }

  const bodyRestore = app.indexOf("drawSoundProjection(drawing, palette, pose, anatomy);\n  drawing.restore();");
  const stableControls = app.indexOf("drawSpecimenControls(drawing, timeSeconds, palette);", bodyRestore);
  assert.ok(bodyRestore >= 0 && stableControls > bodyRestore, "opaque controls must remain outside the projected body transform");
});

test("the specimen uses brighter translucent anatomy with thin outlines, pink tissue, and opaque controls", () => {
  assert.match(app, /const SPECIMEN_OPACITY = Object\.freeze\(\{/);
  assert.match(app, /shellIdle:\s*0\.18/);
  assert.match(app, /shellActive:\s*0\.38/);
  assert.match(app, /tissueIdle:\s*0\.5/);
  assert.match(app, /tissueActive:\s*0\.74/);
  assert.match(app, /organIdle:\s*0\.58/);
  assert.match(app, /organActive:\s*0\.86/);
  assert.match(app, /appendageIdle:\s*0\.42/);
  assert.match(app, /appendageActive:\s*0\.7/);
  assert.match(app, /function specimenColorWithAlpha\(color, opacity\)/);
  assert.match(app, /function specimenFillColor\(color, pose, idleOpacity, activeOpacity\)/);
  assert.match(app, /function specimenOutlineWidth\(scale, weight = 1\)/);
  assert.match(app, /Math\.max\(1\.15, scale \* 0\.0072 \* weight\)/);

  const resize = standaloneFunctionBody(app, "resizeCanvas");
  assert.match(resize, /width < 560 \? width \* 0\.215 : width \* 0\.33/);
  assert.match(resize, /Math\.max\(64, Math\.min\(widthScale, height \* 0\.41\)\)/);

  const expectedHelperCoverage = [
    ["drawSpecimenTail", 3, 3],
    ["drawSpecimenEars", 1, 3],
    ["drawSpecimenWings", 3, 4],
    ["drawSpecimenThorax", 4, 5],
    ["drawSpecimenLimbsAndActions", 1, 1],
    ["drawSpecimenHorns", 2, 2],
    ["drawSpecimenHead", 6, 10],
  ];
  for (const [name, minimumFills, minimumOutlines] of expectedHelperCoverage) {
    const body = standaloneFunctionBody(app, name);
    assert.ok(
      occurrences(body, /specimenFillColor\(/g).length >= minimumFills,
      `${name} needs translucent anatomical fills`,
    );
    assert.ok(
      occurrences(body, /specimenOutlineWidth\(/g).length >= minimumOutlines,
      `${name} needs scale-aware thin outlines`,
    );
  }

  const rhythmColors = standaloneFunctionBody(app, "rhythmicPalette");
  assert.match(rhythmColors, /brightenSpecimenColor/);
  assert.match(rhythmColors, /0\.16 \+ pose\.velocity \* 0\.12/);
  for (const [index, color] of [[2, "#ff5f87"], [4, "#ff72b6"], [8, "#ff7ba8"]]) {
    assert.match(rhythmColors, new RegExp(`colors\\[${index}\\] = brightenSpecimenColor\\("${color}"`));
  }
  assert.match(css, /--creature-pink:\s*#ff72b6/);

  const controls = standaloneFunctionBody(app, "drawSpecimenControls");
  assert.doesNotMatch(controls, /specimenFillColor|specimenOutlineWidth/);
  assert.match(controls, /context\.fillStyle = pointerDrag\?\.id === handle\.id/);
});

test("cross-species attacks are cropped, leveled, and kept rhythmically aligned", () => {
  assert.match(app, /mammal:\s*1,/);
  assert.match(app, /bird:\s*0\.82,/);
  assert.match(app, /frog:\s*0\.88,/);
  assert.match(app, /rodent:\s*0\.72,/);
  assert.match(app, /outputGain:\s*clamp\(0\.82/);
  assert.match(app, /compressor\.threshold\.value = -18;/);
  assert.match(app, /compressor\.knee\.value = 18;/);
  assert.match(app, /compressor\.ratio\.value = 6;/);
  assert.match(app, /compressor\.attack\.value = 0\.002;/);
  assert.match(app, /compressor\.release\.value = 0\.08;/);
  assert.match(app, /makeupGain\.gain\.value = 1\.12;/);

  const sourceToCompressor = app.indexOf("sourceNode.connect(compressor);");
  const compressorToMakeup = app.indexOf("compressor.connect(makeupGain);");
  const makeupToLevel = app.indexOf("makeupGain.connect(masterGain);");
  assert.ok(
    sourceToCompressor >= 0 && compressorToMakeup > sourceToCompressor && makeupToLevel > compressorToMakeup,
    "compression and makeup must happen before the user's output level",
  );

  assert.match(app, /time:\s*scheduled\?\.time \?\? time,/);
  assert.match(app, /while \(nextStepTime < now - 0\.025/);
  assert.match(app, /const recoveryFloor = now \+ 0\.008;/);
  assert.match(app, /setRhythmAccent\(currentStep, event\.velocity, event\.sound\);/);
  assert.match(app, /document\.body\.classList\.add\("is-sounding"\);/);
});

test("the dedicated processor subclasses the Hybrinx physical model and rejects displaced contours", () => {
  assert.match(
    processor,
    /class CreaturazoidPhysicalProcessor extends SyrinxPhysicalProcessor/,
  );
  assert.match(processor, /if \(message\.type === "schedule"\)/);
  assert.match(processor, /this\.creatureQueue\.sort/);
  assert.match(processor, /candidate\.frame < queuedEvent\.frame/);
  assert.match(processor, /if \(serial !== this\.activeCreatureSerial\) return;/);
  assert.match(processor, /Number\(event\.configuration\?\.source\?\.pressure\) <= 0/);
  assert.match(processor, /if \(event\.serial !== this\.activeCreatureSerial\) return;/);
  assert.match(processor, /nextFrame - blockStart/);
  assert.match(processor, /_beginCreatureContact\(event\.contact/);
  assert.match(
    processor,
    /_postProcessOutput\(output\)\s*\{\s*this\._mixCreatureContact\(output\);\s*this\._applyCreatureEarWidth\(output\);\s*this\._applyCreatureMakeup\(output\);/,
  );
  assert.match(processor, /bodyGainTrim:\s*clamp\(event\.bodyGainTrim \?\? 1, 0\.36, 3\.75\)/);
  assert.match(processor, /const eventMakeupGain = event\.makeupGain \* \(event\.bodyGainTrim \?\? 1\)/);
  assert.match(processor, /\(configuration\.tract\?\.onsetBurstPrime \?\? 0\) \/ eventMakeup/);
  assert.match(processor, /this\.previousAirwayGate = primedAirwayGate/);
  assert.match(processor, /this\.currentAirwayGate = primedAirwayGate/);
  assert.match(processor, /this\.creatureMakeupGain = eventMakeupGain/);
  assert.match(processor, /eventMakeupGain > this\.creatureMakeupGain \* 1\.5/);
  assert.match(processor, /this\.creatureMakeupDelayRemaining = isolateMakeupRise/);
  assert.match(processor, /configuration\.resetTract \|\| isolateMakeupRise/);
  assert.match(processor, /for \(const source of this\.sources\) source\.reset\(\)/);
  assert.match(processor, /this\.creatureMakeupRampFrames = Math\.max\(1, Math\.round\(this\.workletRate \* 0\.0005\)\)/);
  assert.match(processor, /source\.current\.pressure = source\.target\.pressure/);
  assert.match(processor, /source\.current\.outputGain = source\.target\.outputGain/);
  assert.match(processor, /source\.target\.model === "whistle"/);
  assert.match(processor, /const primedAmplitude = clamp\(Math\.sqrt\(growth \/ 64\) \* 0\.5, 0\.08, 1\.1\)/);
  assert.match(processor, /primedAmplitude \* 1\.25/);
  assert.match(processor, /this\.creatureAttackTransitionFrames/);
  assert.match(processor, /const startPhase = clamp\(profile\.startPhase \?\? 0\)/);
  assert.match(processor, /343 \/ \(4 \* tractLengthM\)/);
  assert.match(
    processor,
    /registerProcessor\("creaturazoid-physical-model", CreaturazoidPhysicalProcessor\);/,
  );

  const processorVoiceCounts = occurrences(processor, /voiceCount:\s*([^,}\n]+)/g)
    .map((match) => match[1].trim());
  assert.ok(processorVoiceCounts.length >= 3);
  assert.deepEqual(new Set(processorVoiceCounts), new Set(["1"]));
});

test("the catalogue icon is a complete 512-pixel WebP asset", () => {
  assert.ok(icon.length > 1_000);
  assert.equal(icon.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(icon.readUInt32LE(4), icon.length - 8);
  assert.equal(icon.subarray(8, 12).toString("ascii"), "WEBP");
  assert.equal(icon.subarray(12, 16).toString("ascii"), "VP8 ");
  assert.deepEqual([...icon.subarray(23, 26)], [0x9d, 0x01, 0x2a]);
  assert.equal(icon.readUInt16LE(26) & 0x3fff, 512);
  assert.equal(icon.readUInt16LE(28) & 0x3fff, 512);
});
