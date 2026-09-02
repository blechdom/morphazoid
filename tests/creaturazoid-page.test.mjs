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
    /aria-label="A front-view horned mammal-bird hybrid whose feathered wings, eyes, beak-muzzle, tongue, teeth, forelegs, hooves, tail, vibrating neck, lungs, and belly exaggerate each sounding gesture around restrained draggable anatomy controls\."/,
  );
  assert.match(html, /A forward-facing horned mammal-bird chimera with one wildly morphing physical airway\./);

  for (const anatomy of [
    "horns",
    "feathered bird wings",
    "eyes enlarge",
    "beaked mouth",
    "tongue",
    "teeth",
    "belly",
    "lungs",
    "cheek arches",
    "neck vibrates",
    "forelegs stomp",
    "claws rake",
    "tail whips",
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

test("the page describes and edits an explicitly monophonic call grid", () => {
  assert.match(html, /Creaturazoid monophonic call sequencer/);
  assert.match(html, /ONE AIRWAY/);
  assert.match(html, /calls change · body stays/);
  assert.match(html, /Rhythm presets never replace it or stack a second creature/);
  assert.match(
    html,
    /Each column can contain one call only; choosing another call replaces it\./,
  );
  assert.match(html, /Each step holds at most one onset/);
  assert.match(html, /Empty sequence columns let long calls keep sounding/);
  assert.match(html, /id="sequenceGrid"[\s\S]*role="grid"/);
  assert.match(html, /aria-rowcount="51"/);
  assert.match(html, /aria-colcount="33"/);
  assert.match(html, /id="sequenceLength"[^>]+aria-labelledby="sequenceLengthLabel"/);

  assert.match(app, /pattern = cycleCreaturazoidStep\(pattern, step, soundId\);/);
  assert.match(app, /any previous call was replaced/);
  assert.match(app, /step \$\{currentStep \+ 1\}`\} · monophonic/);
  assert.match(app, /headerRow\.setAttribute\("role", "row"\);/);
  assert.match(app, /row\.setAttribute\("role", "row"\);/);
});

test("body, attack, vibrato, and modulation controls are present and wired to the page module", () => {
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
  ];
  for (const id of [...rangeIds, "modulationTarget", "modulationShape"]) {
    assert.match(html, new RegExp(`(?:for|id)="${id}"`), `missing ${id} control`);
  }
  for (const id of rangeIds) {
    assert.match(app, new RegExp(`id: "${id}"`), `the app must bind ${id}`);
  }
  assert.match(app, /\$\("modulationTarget"\)\.addEventListener\("change"/);
  assert.match(app, /\$\("modulationShape"\)\.addEventListener\("change"/);

  assert.match(html, /Persistent body shape/);
  assert.match(html, /Skeleton \/ feather plan/);
  assert.match(html, /Body imprint/);
  assert.match(html, /Call retarget/);
  assert.match(html, /Rhythmic attack/);
  assert.match(html, /id="bodyScale"[^>]+min="0\.55"[^>]+max="1\.35"/);
  assert.match(html, /id="bodyRoundness"[^>]+min="-1"[^>]+max="1"/);
  assert.match(html, /id="attackMs"[^>]+min="8"[^>]+max="48"/);
  assert.match(html, /id="bodySizeReadout"/);
  assert.match(html, /id="bodyMotionReadout"/);
  assert.match(html, /Mutate this body/);
  assert.match(html, /body parameters change · sequence stays intact/);
  assert.match(html, /Left-wing vibrato rate/);
  assert.match(html, /Right-wing vibrato depth/);
  assert.match(html, /Feather motion target/);
  assert.match(html, /Feather motion shape/);
  assert.match(html, /Feather motion rate/);
  assert.match(html, /Feather motion depth/);
  assert.match(html, /fast soft-knee compressor/);
  assert.match(html, /50 voices and body gestures/);
  assert.match(html, /No recordings are used/);

  assert.match(html, /<link rel="stylesheet" href="creaturazoid\.css\?v=[^"]+" \/>/);
  assert.match(html, /<script type="module" src="nav\.js\?v=[^"]+"><\/script>/);
  assert.match(html, /<script type="module" src="creaturazoid-app\.js\?v=[^"]+"><\/script>/);
  assert.match(app, /from "\.\/src\/creaturazoid\.js\?v=[^"]+"/);
  assert.match(app, /from "\.\/src\/syrinx\.js\?v=[^"]+"/);
  assert.match(app, /\.\/src\/creaturazoid-processor\.js\?v=/);
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

  assert.match(html, /body is persistent and absolute/i);
  assert.match(html, /Multi-peak pressure, pitch, closure, mouth, cavity, roughness, split, and balance contours survive/i);
  assert.match(html, /call-local Speed and Depth envelopes/i);
  assert.match(html, /short rhythmic attack makes each occupied step speak promptly/i);
  assert.doesNotMatch(html, />Creature preset</i);
});

test("the instrument uses Morphazoid black surfaces and Hiccup-style rectangular steps", () => {
  assert.match(css, /--creature-paper:\s*#080507/);
  assert.match(css, /grid-template-columns:\s*108px repeat\(var\(--sequence-steps\), minmax\(32px, 1fr\)\)/);
  assert.match(css, /grid-auto-rows:\s*29px/);
  assert.match(css, /\.creaturazoid-grid-cell\s*\{[\s\S]*?border-radius:\s*0/);
  assert.match(css, /\.creaturazoid-grid-cell\[data-level="3"\]::before/);
  assert.match(css, /\.creaturazoid-grid-cell\.is-sustain::after/);
  assert.match(css, /\.creaturazoid-preset-deck > \.creaturazoid-body-metrics\s*\{/);
  assert.match(css, /\.creaturazoid-body-metrics\s+output\s*\{/);
  assert.match(app, /cell\.dataset\.level = String\(level\)/);
  assert.match(app, /cell\.style\.setProperty\("--row-color", sound\.color\)/);
  assert.match(css, /grid-template-columns:\s*172px 118px minmax\(180px, 1fr\)/);
  assert.match(css, /\.creaturazoid-transport\s*\{[\s\S]*?width:\s*172px/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.creaturazoid-transport\s*\{[\s\S]*?width:\s*144px/);
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
  assert.match(app, /const contourOffsets = creaturazoidContourOffsets\(duration, [^)]+\);/);
  assert.match(app, /events\.push\(\{[\s\S]*?serial,[\s\S]*?begin:\s*index === 0/);
  assert.match(app, /begin:\s*index === 0/);
  assert.match(app, /contact:\s*index === 0 && sound\.articulation\?\.contact/);
  assert.match(app, /events\.push\(\{[\s\S]*?velocity:\s*clamp\(velocity\),[\s\S]*?configuration:/);
  for (const field of [
    "airwayGate", "articulationVoicing", "articulationPressure", "turbulence",
    "burstGain", "burstFrequencyHz", "flutterHz", "flutterDepth", "flowDirection",
  ]) assert.match(app, new RegExp(`${field}:`), `${field} must reach the physical tract`);
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

  for (const response of [
    "mouthOpen",
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
    "clawSwipe",
    "footStrike",
  ]) {
    assert.match(app, new RegExp(`${response}:|const ${response} =`), `${response} must follow the sounding gesture`);
  }

  assert.match(app, /function rhythmicPalette\(palette, pose\)/);
  assert.match(app, /const palette = rhythmicPalette\(selectedPalette\(\), pose\);/);
  assert.match(app, /drawSpecimenWings\(drawing, timeSeconds, palette, pose, anatomy\);/);
  assert.match(app, /drawSpecimenThorax\(drawing, palette, pose, anatomy\);/);
  assert.match(app, /drawSpecimenLimbsAndActions\(drawing, palette, pose, anatomy\);/);
  assert.match(app, /drawSpecimenHead\(drawing, palette, pose, anatomy\);/);
  assert.match(app, /drawSoundProjection\(drawing, palette, pose, anatomy\);/);
  assert.match(app, /drawSpecimenHorns\(context, palette, pose, anatomy, skullWidth, top\);/);
  assert.match(app, /A muscular tongue follows/);
  assert.match(app, /const toothCount = pose\.active \? 9 : 5;/);

  const bodyRestore = app.indexOf("drawSoundProjection(drawing, palette, pose, anatomy);\n  drawing.restore();");
  const stableControls = app.indexOf("drawSpecimenControls(drawing, timeSeconds, palette);", bodyRestore);
  assert.ok(bodyRestore >= 0 && stableControls > bodyRestore, "opaque controls must remain outside the projected body transform");
});

test("the specimen uses luminous translucent anatomy with strong outlines and opaque controls", () => {
  assert.match(app, /const SPECIMEN_OPACITY = Object\.freeze\(\{/);
  assert.match(app, /shellIdle:\s*0\.16/);
  assert.match(app, /organActive:\s*0\.58/);
  assert.match(app, /function specimenColorWithAlpha\(color, opacity\)/);
  assert.match(app, /function specimenFillColor\(color, pose, idleOpacity, activeOpacity\)/);
  assert.match(app, /function specimenOutlineWidth\(scale, weight = 1\)/);
  assert.match(app, /Math\.max\(2, scale \* 0\.01 \* weight\)/);

  const expectedHelperCoverage = [
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
      `${name} needs scale-aware thick outlines`,
    );
  }

  const rhythmColors = standaloneFunctionBody(app, "rhythmicPalette");
  assert.match(rhythmColors, /brightenSpecimenColor/);
  assert.match(rhythmColors, /0\.16 \+ pose\.velocity \* 0\.12/);

  const controls = standaloneFunctionBody(app, "drawSpecimenControls");
  assert.doesNotMatch(controls, /specimenFillColor|specimenOutlineWidth/);
  assert.match(controls, /context\.fillStyle = pointerDrag\?\.id === handle\.id/);
});

test("loud cross-species attacks are trimmed, compressed, and kept rhythmically aligned", () => {
  assert.match(app, /mammal:\s*1,/);
  assert.match(app, /bird:\s*0\.82,/);
  assert.match(app, /frog:\s*0\.88,/);
  assert.match(app, /rodent:\s*0\.72,/);
  assert.match(app, /compressor\.threshold\.value = -18;/);
  assert.match(app, /compressor\.knee\.value = 18;/);
  assert.match(app, /compressor\.ratio\.value = 6;/);
  assert.match(app, /compressor\.attack\.value = 0\.002;/);
  assert.match(app, /compressor\.release\.value = 0\.16;/);
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
    /_postProcessOutput\(output\)\s*\{\s*this\._mixCreatureContact\(output\);/,
  );
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
