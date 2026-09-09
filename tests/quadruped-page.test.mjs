import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const animals = [
  "elephant", "unicorn", "gazelle", "cat", "cheetah", "giraffe",
  "lizard", "horse", "dog", "goat", "rabbit", "camel",
];

test("Quadruped page exposes animal choices, four feet, sixteen cards, one surface, and one path", async () => {
  const html = await read("quadruped.html");
  assert.match(html, /<title>Quadruped · Morphazoid<\/title>/);
  assert.match(html, /<h1 id="pageTitle">QUADRUPED<\/h1>/);
  assert.doesNotMatch(html, /FIVE CONTACT LANES|quadroped/i);
  for (const animal of animals) assert.match(html, new RegExp(`data-animal-id="${animal}"`));
  for (const lane of ["front-left", "front-right", "rear-left", "rear-right"]) {
    assert.match(html, new RegExp(`data-lane-id="${lane}"`));
  }
  assert.doesNotMatch(html, /data-lane-id="tail"/);
  assert.match(html, /id="sequenceGrid"[^>]*role="grid"/);
  assert.match(html, /16 CABINET FRAMES/);
  assert.match(html, /·<\/b> no new touchdown/);
  assert.match(html, /○<\/b> soft/);
  assert.match(html, /●<\/b> strong/);
  assert.match(html, /planted/);
  assert.match(html, /No new touchdown does not necessarily mean the foot is airborne/);
  assert.match(html, /id="tempoOut"[^>]*>96 BPM · global/);
  assert.match(html, /Tempo changes immediately/);
  assert.match(html, /At 1× pace, sixteen cards take one beat before extra air or slide rests/);
  for (const ratio of ["0.5", "1", "2", "3"]) assert.ok(html.includes(`data-pace-ratio="${ratio}"`));
  assert.match(html, /id="suspensionBeats"[^>]*max="8"/);
  assert.match(html, /<b>One surface<\/b>/);
  assert.match(html, /<select id="terrain">[\s\S]*Packed earth[\s\S]*Resonant crystal/);
  assert.match(html, /<select id="groundProfile">[\s\S]*Level ground[\s\S]*Steps up[\s\S]*Steps down/);
  assert.match(html, /Touchdown, load, push, lift\. Feet drive the clock\./);
  assert.match(html, /aria-label="Interactive side-view Quadruped/);
  assert.match(html, /id="playButton"[\s\S]*?data-primary-transport/);
  assert.match(html, /Audio is off — turn it on to hear playback/);
  assert.match(html, /type="module" src="quadruped-app\.js"/);
});

test("the old misspelled route redirects to canonical Quadruped and preserves location state", async () => {
  const html = await read("quadroped.html");
  assert.match(html, /http-equiv="refresh" content="0; url=quadruped\.html"/);
  assert.match(html, /rel="canonical" href="quadruped\.html"/);
  assert.match(html, /destination\.search = location\.search/);
  assert.match(html, /destination\.hash = location\.hash/);
});

test("transport remains independent of explicit Audio arming", async () => {
  const app = await read("quadruped-app.js");
  const start = app.match(/function startTransport\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const stop = app.match(/function stopTransport\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const close = app.match(/async function closeAudio\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.ok(start.length > 0 && stop.length > 0 && close.length > 0);
  assert.doesNotMatch(start, /ensureAudio|createAudioGraph|toggleAudio/);
  assert.doesNotMatch(stop, /closeAudio/);
  assert.doesNotMatch(close, /stopTransport|transportPlaying\s*=\s*false/);
  assert.match(app, /if \(graph\) resetAudioSchedule\(\{ includeCurrentBoundary: true \}\)/);
});

test("animation and audio both advance from the foot-driven motor", async () => {
  const app = await read("quadruped-app.js");
  for (const symbol of [
    "advanceQuadrupedMotor", "createQuadrupedMotorState", "kickQuadrupedMotor",
    "predictQuadrupedMotor", "quadrupedMotorSnapshot", "synchronizeQuadrupedMotorTempo",
  ]) assert.match(app, new RegExp(`\\b${symbol}\\b`));
  const position = app.match(/function currentPosition[^\{]*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const scheduler = app.match(/function scheduleAudioWindow\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(position, /materializeMotor\(now\)\.position/);
  assert.match(scheduler, /predictQuadrupedMotor\(actor\.score, actor\.motor,/);
  assert.match(scheduler, /for \(const crossing of prediction\.events\)/);
  assert.match(scheduler, /scheduleStep\(/);
  assert.match(scheduler, /crossing\.offsetSeconds/);
  assert.doesNotMatch(app, /transportAnchorPosition|transportAnchorPerformance|quadrupedStepDurationSeconds/);
  assert.match(app, /stalled · add a footfall/);
  assert.match(app, /function wakeMotorAtFootfall/);
  const loop = app.match(/function animationLoop\(now\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(loop, /syncGridPlayhead\(snapshot\.frame\)/);
  assert.match(loop, /updateStageReadouts\(snapshot\.frame\)/);
});

test("the compact score makes touchdown strength and continuing support independent", async () => {
  const [app, css] = await Promise.all([read("quadruped-app.js"), read("quadruped.css")]);
  assert.match(app, /aria-rowcount", "8"/);
  assert.match(app, /aria-colcount", String\(QUADRUPED_STEP_COUNT \+ 1\)/);
  assert.match(app, /cell\.setAttribute\("role", "columnheader"\)/);
  assert.match(app, /cell\.setAttribute\("role", "gridcell"\)/);
  assert.match(app, /const level = value <= 0 \? "none" : value < 0\.8 \? "soft" : "strong"/);
  assert.match(app, /button\.textContent = value <= 0 \? "·" : value < 0\.8 \? "○" : "●"/);
  assert.match(app, /value <= 0 \? "false" : value < 0\.8 \? "mixed" : "true"/);
  assert.match(app, /continuing support from an earlier touchdown/);
  assert.match(css, /\.quadruped-grid-row\s*\{[\s\S]*?grid-template-columns:\s*86px repeat\(16, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.quadruped-grid-cell[\s\S]*?min-height:\s*34px/);
  assert.match(css, /\.quadruped-grid-cell\[data-support="true"\]/);
  assert.match(css, /data-level="none"/);
});

test("the centered animal uses stair footprints and one fixed three-segment limb chain in cards and stage", async () => {
  const app = await read("quadruped-app.js");
  assert.match(app, /const centerX = width \* 0\.5/);
  assert.match(app, /lastFootprintHits/);
  assert.match(app, /quadrupedGroundHeightAtWorldX\(state\.groundProfileId/);
  assert.match(app, /solveQuadrupedLimbChain/g);
  assert.equal((app.match(/solveQuadrupedLimbChain\(/g) ?? []).length, 2);
  assert.match(app, /context\.lineTo\(chain\.kneeX, chain\.kneeY\)/);
  assert.match(app, /context\.lineTo\(chain\.ankleX, chain\.ankleY\)/);
  assert.match(app, /context\.lineTo\(chain\.footX, chain\.footY\)/);
  assert.match(app, /morphology\.family !== "rabbit"/);
  assert.match(app, /morphology\.haunch/);
  assert.match(app, /morphology\.shoulder/);
  assert.match(app, /const miniTailRoot = bodyPoint/);
  assert.match(app, /state\.animalId === "giraffe"/);
  assert.ok((app.match(/morphology\.family === "camel"/g) ?? []).length >= 3);
  assert.match(app, /pose\.forwardRoll \* Math\.PI \* 2/);
  assert.match(app, /pose\.rollTuck/);
});

test("audio uses one material resonator, stance accents, and an exact no-support flight voice", async () => {
  const app = await read("quadruped-app.js");
  assert.match(app, /mixBus\.gain\.value = 1\.45/);
  assert.equal((app.match(/const materialBus = createMaterialBus\(/g) ?? []).length, 1);
  assert.match(app, /const flightVoices = Array\.from\(\{ length: 3 \}/);
  assert.match(app, /applyMaterialProfile\(graph\.materialBus, quadrupedTerrain\(state\.surfaceId\)/);
  const flight = app.match(/function syncFlightVoice\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(flight, /snapshot\.supportCount === 0/);
  assert.match(flight, /unsupported \? 0\.075/);
  const scheduler = app.match(/function scheduleAudioWindow\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(scheduler, /transition\.type === "load" \|\| transition\.type === "push"/);
  assert.match(scheduler, /scheduleStanceAccent/);
  assert.match(scheduler, /scheduleToeOff/);
  const step = app.match(/function scheduleStep\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(step, /for \(const contact of contacts\)/);
  assert.match(step, /scheduleFoot\(/);
  assert.doesNotMatch(step, /scheduleHead|scheduleTail/);
  assert.equal((app.match(/scheduleHead\(/g) ?? []).length, 1, "head scheduler stays defined but is not called");
  assert.equal((app.match(/scheduleTail\(/g) ?? []).length, 1, "tail scheduler stays defined but is not called");
  assert.match(app, /activeSources\.size >= QUADRUPED_LIMITS\.maxScheduledVoices/);
  assert.match(app, /source\.onended = \(\) => removeAudioSource\(record\)/);
  assert.match(app, /pagehide/);
  assert.match(app, /context\.close\(\)/);
});

test("edits preserve motion and global surface/path changes relatch honestly", async () => {
  const [app, model, motor, catalog] = await Promise.all([
    read("quadruped-app.js"),
    read("src/quadruped.js"),
    read("src/quadruped-motor.js"),
    read("src/instrument-catalog.js"),
  ]);
  const keyboard = app.match(/function handleGridKeydown\(event\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(keyboard, /setQuadrupedContact[\s\S]*?retimeTransport\(position, now, \{ preserveMotion: true \}\)/);
  assert.match(app, /setQuadrupedSurface/);
  assert.match(app, /setQuadrupedGroundProfile/);
  assert.match(app, /current stance relatches to this course/);
  assert.match(app, /const behaviors = quadrupedBehaviorsForAnimal\(state.animalId\);/);
  assert.match(motor, /quadrupedAnimal/);
  assert.doesNotMatch(motor, /SPECIES_PHYSICS/);
  for (const property of ["mass", "power", "compliance", "rollingResistance", "baseGravity"]) {
    assert.match(model, new RegExp(`${property}:`));
  }
  assert.match(catalog, /species-shaped bodies, including Frog/);
  assert.match(catalog, /touchdown, load, push, support, lift-off, and landing/);
  assert.match(catalog, /exact global BPM clock/i);
  assert.match(catalog, /tempo stays independent/i);
});

test("the sequencer and controls remain reachable at desktop, portrait, and short landscape sizes", async () => {
  const css = await read("quadruped.css");
  assert.match(css, /\.quadruped-grid-scroll\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.quadruped-grid-row-label\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /@media \(max-width: 1280px\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-height: 480px\) and \(orientation: landscape\)/);
  const landscape = css.match(/@media \(max-height: 480px\) and \(orientation: landscape\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(landscape, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(landscape, /grid-column:\s*1 \/ -1/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?min-height:\s*48px/);
  assert.match(css, /\.quadruped-play\s*\{[\s\S]*?min-height:\s*48px/);
  assert.match(css, /#stage:focus-visible/);
});

test("the shared gait dictionary stays compact and scrollable", async () => {
  const css = await read("quadruped.css");
  assert.match(css, /\.quadruped-behavior-buttons\s*\{\s*grid-template-columns:\s*repeat\(5,\s*1fr\);[\s\S]*?max-height:\s*230px;[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.quadruped-behavior-buttons\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*1fr\)/);
  assert.match(css, /\.quadruped-behavior-buttons button\s*\{[\s\S]*?font-size:\s*0\.61rem/);
});

test("Quadruped markup does not duplicate ids", async () => {
  const html = await read("quadruped.html");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("the release builder carries the Quadruped motor into static and WAX output", async () => {
  const build = await read("scripts/build-site.sh");
  assert.equal((build.match(/src\/quadruped-motor\.js/g) ?? []).length, 2);
  assert.equal((build.match(/src\/quadruped-voices\.js/g) ?? []).length, 2);
  assert.equal((build.match(/src\/quadruped-world\.js/g) ?? []).length, 2);
});
