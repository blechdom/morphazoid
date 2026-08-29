import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMBO_GEOMETRIES,
  COMBO_PLAYING_MODES,
  comboSelectionFor,
  sanitizeComboFocus,
} from "../src/combo-host.js";
import { resolveActiveTool, TOOL_GROUPS } from "../nav.js";

const repositoryRoot = new URL("../", import.meta.url);

test("Shapes routes dimensions and playing modes as state rather than pages", () => {
  assert.deepEqual(Object.keys(COMBO_GEOMETRIES), ["shape", "solid", "hyper"]);
  assert.deepEqual(
    Object.values(COMBO_GEOMETRIES).map(({ stateId, dimension }) => [stateId, dimension]),
    [["2d", "2D"], ["3d", "3D"], ["4d", "4D"]],
  );
  assert.deepEqual(COMBO_PLAYING_MODES.map(({ id }) => id), ["continuous", "notes", "triggers"]);
  assert.deepEqual(comboSelectionFor("solid", "drums"), { dimension: "3d", playingMode: "triggers" });
  assert.deepEqual(sanitizeComboFocus({ dimension: "4d", playingMode: "notes" }), {
    dimension: "4d",
    playingMode: "notes",
  });
  assert.deepEqual(sanitizeComboFocus({ geometry: "invalid", sound: "noise" }), {
    dimension: "2d",
    playingMode: "continuous",
  });
  assert.deepEqual(sanitizeComboFocus(null), {
    dimension: "2d",
    playingMode: "continuous",
  });
  for (const geometry of Object.values(COMBO_GEOMETRIES)) {
    assert.equal("href" in geometry, false);
    assert.equal("appModule" in geometry, false);
  }
});

test("Shapes is one native Morphazoid route with no embedded page dependencies", async () => {
  const [html, redirect, css, app, scene, rhythm, state] = await Promise.all([
    readFile(new URL("shapes.html", repositoryRoot), "utf8"),
    readFile(new URL("combo.html", repositoryRoot), "utf8"),
    readFile(new URL("combo.css", repositoryRoot), "utf8"),
    readFile(new URL("combo-app.js", repositoryRoot), "utf8"),
    readFile(new URL("src/shapes-scene.js", repositoryRoot), "utf8"),
    readFile(new URL("src/shapes-rhythm.js", repositoryRoot), "utf8"),
    readFile(new URL("src/shapes-state.js", repositoryRoot), "utf8"),
  ]);

  const comboTool = TOOL_GROUPS.flatMap(({ tools }) => tools).find(({ id }) => id === "combo");
  assert.equal(comboTool?.href, "shapes.html");
  assert.equal(comboTool?.label, "Shapes");
  assert.equal(TOOL_GROUPS.find(({ id }) => id === "apps")?.tools[0]?.id, "combo");
  assert.equal(resolveActiveTool(
    "https://example.test/morphazoid/shapes.html",
    "https://example.test/morphazoid/",
  )?.id, "combo");

  assert.match(redirect, /new URL\("shapes\.html", window\.location\.href\)/);
  assert.match(redirect, /window\.location\.replace\(destination\)/);
  assert.match(html, /<title>Shapes — Morphazoid<\/title>/);
  assert.match(html, /<header class="masthead">/);
  assert.match(html, /<a class="tab active" href="shapes\.html" aria-current="page">Shapes<\/a>/);
  assert.match(html, /<canvas id="stage"/);
  assert.match(html, /<aside class="shapes-panel"/);
  assert.doesNotMatch(html, /Shapes app|One form, three dimensions/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="combo-app\.js"><\/script>/);
  assert.doesNotMatch(html, /<(?:iframe|object|embed)\b/i);
  assert.doesNotMatch(html, /(?:shape|solid|hyper)(?:-drums)?\.html/i);

  assert.doesNotMatch(app, /contentDocument|contentWindow|window\.frames|createElement\(["']iframe/);
  assert.doesNotMatch(app, /(?:^|["'/])(?:app|solid-app|hyper-app|shape-drums-app|solid-drums-app|hyper-drums-app)\.js/);
  assert.match(app, /from "\.\/src\/shapes-state\.js"/);
  assert.match(app, /from "\.\/src\/shapes-scene\.js"/);
  assert.match(app, /from "\.\/src\/shapes-rhythm\.js"/);
  assert.match(app, /legacySound === "synth"[\s\S]*?"continuous"/);
  assert.match(app, /createShapesRhythmSample\(seedState\)/);
  assert.match(app, /advanceShapesRhythmSample\(discreteRhythmSample, sampledState\)/);
  assert.match(app, /DISCRETE_SCHEDULER_INTERVAL_MS = 20/);
  assert.match(app, /DISCRETE_SCHEDULER_LEAD_SECONDS = 0\.012/);
  assert.match(app, /DISCRETE_SAMPLE_INTERVAL_SECONDS = 1 \/ 256/);
  assert.match(app, /setInterval\(runDiscreteScheduler, DISCRETE_SCHEDULER_INTERVAL_MS\)/);
  assert.match(app, /DISCRETE_EVENT_RATE_LIMIT/);
  assert.match(app, /shapesEventRegionKeys\(scene\)/);
  assert.match(app, /lastEventRegions\[clock\] = regionSet/);
  assert.match(app, /lastEventAtByVoice/);
  assert.match(app, /getContext\("2d", \{ desynchronized: true \}\)/);
  assert.match(app, /activeAudioContext\(\)[\s\S]*?currentTime/);
  assert.match(app, /setVoiceTrajectory\(/);
  assert.match(app, /AUDIO_LOOKAHEAD_SECONDS = 0\.075/);
  assert.match(app, /CANVAS_PIXEL_BUDGET = 3_000_000/);
  assert.match(app, /if \(!moving\) synthAudio\.setVoices\(\[\]/);
  assert.match(app, /directedCornerEnvelopeProfile\(/);
  assert.match(app, /shapes2dContactContourDirection\(/);
  assert.match(app, /scene\.geometry\?\.shapeType === "circle"/);
  assert.match(app, /gain = 0\.12/);
  assert.match(app, /gain = \(0\.18 \+ 0\.5 \* clamp\(profile\.strength, 0, 1\)\) \* envelope/);
  assert.match(app, /scaleShapeVoiceGains\(specs\)/);
  assert.match(app, /new VoicePool\(32, \{ continuousPeakCeiling: 0\.78 \}\)/);
  assert.match(app, /new LinearDrumAudio\(globalThis\)/);
  assert.match(app, /RATTLESNAKE_PRESET\.settings/);
  assert.match(app, /rattlesnakeAudio\.trigger\([\s\S]*?startAt/);
  assert.match(app, /state\.trigger\.soundBank === "rattlesnake"/);
  assert.match(app, /state\.trigger\.soundBank === "fm-kit"/);
  assert.match(app, /phaseRate: sourceState\.play\.running[\s\S]*?: intendedPhaseDirection/);
  assert.match(app, /fixedTwoDimensionalFrame = scene\.dimension === "2d"/);
  assert.match(app, /centerX = fixedTwoDimensionalFrame \? 0/);
  assert.match(app, /centerY = fixedTwoDimensionalFrame \? 0/);
  assert.match(app, /Math\.min\(cssWidth, cssHeight\) \* 0\.39/);
  assert.match(app, /function pointerHitsTwoDimensionalShape/);
  assert.match(app, /const moveReader = pointerHitsTwoDimensionalShape\(event\)/);
  assert.match(app, /pointerRotation = \{/);
  assert.match(app, /scrubPlayheadFromPointer\(event\)/);
  const frameBody = app.slice(app.indexOf("function frame(now)"), app.indexOf("async function prepareActiveAudio"));
  assert.doesNotMatch(frameBody, /resizeCanvas\(/, "the animation frame does not force layout measurement");
  assert.match(app, /synthAudio\.strike\(spec, \{[\s\S]*?startAt,/);
  assert.match(app, /drumAudio\.trigger\(voice, Number\.isFinite\(startAt\) \? \{ startAt \}/);
  assert.match(app, /if \(startAt < schedulableAfter\) continue/);
  assert.match(app, /document\.hidden[\s\S]*?stopDiscreteScheduler\(\)[\s\S]*?drumAudio\.silence\(\)/);
  assert.match(app, /morphazoid:midi-input/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(scene, /from "\.\/geometry\.js"/);
  assert.match(scene, /from "\.\/solid\.js"/);
  assert.match(scene, /from "\.\/hyper\.js"/);
  assert.match(scene, /eventKey: `2d:\$\{contactRegionOnPath/);
  assert.match(scene, /twoDimensionalPathCache/);
  assert.match(rhythm, /export function createShapesRhythmSample/);
  assert.match(rhythm, /export function advanceShapesRhythmSample/);
  assert.match(state, /playingMode:\s*"continuous"/);
  assert.match(state, /profile:\s*Object\.freeze\(\{ sides: 4,/);
  assert.match(state, /representation: "cube"/);
  assert.match(state, /representation: "tesseract"/);
  assert.match(state, /divisions: 2/);
  assert.match(state, /SHAPES_STORAGE_KEY = "morphazoid:shapes:standalone:v3"/);
  assert.match(state, /selection\.playingMode/);
});

test("Shapes owns the fixed application picker and local 2D, 3D, 4D submenu", async () => {
  const html = await readFile(new URL("shapes.html", repositoryRoot), "utf8");
  const dimensionOptions = [...html.matchAll(/<option value="(2d|3d|4d)">/g)].map((match) => match[1]);
  assert.deepEqual(dimensionOptions.slice(0, 3), ["2d", "3d", "4d"]);
  assert.match(html, /<select id="dimensionSelect" aria-label="Shapes dimension">/);
  assert.match(html, /data-playing-mode="continuous"/);
  assert.match(html, /data-playing-mode="notes"/);
  assert.match(html, /data-playing-mode="triggers"/);
  assert.match(html, /data-playing-mode="continuous"[^>]*>Continuous<\/button>/);
  assert.match(html, /data-playing-mode="notes"[^>]*>Notes<\/button>/);
  assert.match(html, /data-playing-mode="triggers"[^>]*>Triggers<\/button>/);
  assert.match(html, /id="divisionsControl"[^>]*for="divisions"[^>]*hidden/);
  assert.match(html, /id="divisions"[^>]*max="16"[^>]*value="2"/);
  assert.equal((html.match(/id="divisions"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /id="(?:noteDivisions|triggerDivisions)"/);
  assert.match(html, /class="shapes-bank-tabs" role="tablist"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 4);
  assert.match(html, /id="shapeReadout">4-SIDED POLYGON/);
  assert.match(html, /id="profileSides"[^>]*value="4"/);
  assert.ok(
    html.indexOf("id=\"playingMode\"") > html.indexOf("<aside class=\"shapes-panel\""),
    "playing modes live in the right-hand Shapes panel",
  );
  assert.ok(
    html.indexOf("id=\"divisionsControl\"") > html.indexOf("data-bank-panel=\"main\"")
      && html.indexOf("id=\"divisionsControl\"") < html.indexOf("data-bank-panel=\"form\""),
    "the mode-aware Divisions control lives on Main",
  );

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Shapes HTML IDs stay unique");
});

test("Shapes uses an original-style hierarchy with restrained control chrome", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("shapes.html", repositoryRoot), "utf8"),
    readFile(new URL("combo.css", repositoryRoot), "utf8"),
  ]);
  assert.match(html, /class="shapes-twin-rack"/);
  assert.doesNotMatch(html, />0[12]<\/span>/);
  assert.match(html, /class="control shapes-primary-range shapes-speed-row"/);
  assert.match(html, /id="playButton"[^>]*aria-label="Start playback"/);
  assert.match(html, /id="rotateButton"[^>]*aria-label="Start automatic rotation"/);
  assert.match(html, /id="directionButton"[^>]*aria-label="Reader direction: forward"/);
  assert.match(html, /<h3 id="playRackTitle">Transport<\/h3>/);
  assert.match(html, /<h3 id="motionRackTitle">Shape<\/h3>/);
  for (const label of ["Playhead position", "Playhead speed", "Sound", "Form", "Reader", "Playheads", "Spacing"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.doesNotMatch(html, />Traversal<|>Spin<|>Voice engine</);
  assert.match(html, /id="rotationTransport"[^>]*aria-label="Shape rotation transport"/);
  assert.match(html, /id="triggerSoundBank"[^>]*aria-label="Percussion sound bank"[\s\S]*?Rattlesnake[\s\S]*?FM drum kit/);
  assert.match(html, /id="triggerMappingControl"[^>]*hidden[^>]*>[\s\S]*?FM kit assignment/);
  assert.match(html, /id="removePlayhead"[^>]*aria-label="Remove one playhead"/);
  assert.match(html, /id="addPlayhead"[^>]*aria-label="Add one playhead"/);
  assert.match(html, /id="headLayoutTrack"[^>]*aria-label="Relative playhead spacing"/);
  assert.match(html, /drag on or inside the shape to move the reader; drag outside the shape to rotate it/i);
  assert.ok(
    html.indexOf('id="readerRack"') < html.indexOf('id="motionRackTitle"'),
    "Reader and playhead spacing controls stay above Shape",
  );
  for (const label of ["Main controls", "Form controls", "Rotation controls", "Mapping controls"]) {
    assert.match(html, new RegExp(`role="tab"[^>]*aria-label="${label}"`));
  }
  assert.ok(
    html.indexOf('id="playButton"') < html.indexOf('for="position"'),
    "the transport button stays to the left of the reader-position control",
  );
  for (const label of ["Main", "Form", "Rotate", "Map"]) {
    assert.match(html, new RegExp(`class="shapes-bank-tab-label">${label}<`));
  }
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) clamp\(340px, 27vw, 390px\)/);
  assert.match(css, /\.shapes-twin-rack\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.shapes-speed-row\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.shapes-panel-header\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.shapes-bank-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
  assert.match(css, /\.shapes-divisions-row\s*\{/);
  assert.match(css, /\.shapes-bank-tabs button\s*\{[^}]*width:\s*auto[^}]*border:\s*0[^}]*border-bottom:\s*2px solid transparent/s);
  assert.match(css, /\.shapes-knob\s*\{[^}]*width:\s*36px[^}]*border:\s*0/s);
  assert.match(css, /select option,[\s\S]*?background-color:\s*var\(--panel-high\)/);
  assert.match(css, /\.shapes-rack-card\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/s);
  assert.match(css, /\.shapes-primary-range\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/s);
  assert.ok(html.indexOf("data-bank-panel=\"main\"") < html.indexOf("shapes-output-details"));
});
