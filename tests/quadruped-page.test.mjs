import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Quadruped page uses the standard name and exposes all seven animal scores", async () => {
  const html = await read("quadruped.html");
  assert.match(html, /<title>Quadruped · Morphazoid<\/title>/);
  assert.match(html, /<h1 id="pageTitle">QUADRUPED<\/h1>/);
  assert.doesNotMatch(html, /FIVE CONTACT LANES/i);
  assert.doesNotMatch(html, /Write the feet\. The creature has to live with the rhythm\./i);
  for (const animal of ["elephant", "unicorn", "gazelle", "cat", "cheetah", "giraffe", "lizard"]) {
    assert.match(html, new RegExp(`data-animal-id="${animal}"`));
  }
  for (const lane of ["front-left", "front-right", "rear-left", "rear-right", "tail"]) {
    assert.match(html, new RegExp(`data-lane-id="${lane}"`));
  }
  assert.match(html, /id="sequenceGrid"[^>]*role="grid"/);
  assert.match(html, /16 CABINET FRAMES/);
  assert.match(html, /OFF · ○ SOFT · ● LOUD/);
  assert.match(html, /Gait dictionary/);
  assert.match(html, /Choose any gait for any animal/);
  assert.match(html, /Gait drive/);
  assert.match(html, /cycles\/min/);
  assert.match(html, /id="momentum"[^>]*type="range"/);
  assert.match(html, /id="gravity"[^>]*type="range"/);
  assert.match(html, /Feet push\. Momentum coasts\. Gravity lands\./);
  assert.match(html, /id="stage"[\s\S]*?role="application"[\s\S]*?tabindex="0"/);
  assert.match(html, /aria-label="Interactive side-view Quadruped/);
  assert.match(html, /id="playButton"[\s\S]*?data-primary-transport/);
  assert.match(html, /id="transportHint"[\s\S]*?Audio is off — turn it on to hear playback/);
  assert.match(html, /type="module" src="quadruped-app\.js"/);
  assert.doesNotMatch(html, /quadroped/i);
});

test("the old misspelled route redirects to canonical Quadruped and preserves location state", async () => {
  const html = await read("quadroped.html");
  assert.match(html, /http-equiv="refresh" content="0; url=quadruped\.html"/);
  assert.match(html, /rel="canonical" href="quadruped\.html"/);
  assert.match(html, /destination\.search = location\.search/);
  assert.match(html, /destination\.hash = location\.hash/);
});

test("Quadruped transport never implicitly arms or disables audio", async () => {
  const app = await read("quadruped-app.js");
  const startTransport = app.match(/function startTransport\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const stopTransport = app.match(/function stopTransport\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const closeAudio = app.match(/async function closeAudio\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.ok(startTransport.length > 0);
  assert.doesNotMatch(startTransport, /ensureAudio|createAudioGraph|toggleAudio/);
  assert.doesNotMatch(stopTransport, /closeAudio/);
  assert.doesNotMatch(closeAudio, /stopTransport|transportPlaying\s*=\s*false/);
  assert.match(app, /const AUDIO_OFF_MESSAGE = "Audio is off — turn it on to hear playback"/);
  assert.match(app, /if \(graph\) resetAudioSchedule\(\{ includeCurrentBoundary: true \}\)/);
});

test("Quadruped advances animation and audio from motor-predicted frame crossings, not an independent wall clock", async () => {
  const app = await read("quadruped-app.js");
  assert.match(app, /from "\.\/src\/quadruped-motor\.js"/);
  for (const symbol of [
    "advanceQuadrupedMotor",
    "createQuadrupedMotorState",
    "kickQuadrupedMotor",
    "predictQuadrupedMotor",
    "quadrupedMotorSnapshot",
  ]) {
    assert.match(app, new RegExp(`\\b${symbol}\\b`));
  }
  const currentPosition = app.match(/function currentPosition[^\{]*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const scheduler = app.match(/function scheduleAudioWindow\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(currentPosition, /materializeMotor\(now\)\.position/);
  assert.match(scheduler, /predictQuadrupedMotor\(state, motor,/);
  assert.match(scheduler, /for \(const crossing of prediction\.events\)/);
  assert.match(scheduler, /scheduleStep\(\s*crossing\.ordinal/);
  assert.match(scheduler, /graph\.context\.currentTime \+ Math\.max\(0\.006, crossing\.offsetSeconds\)/);
  assert.doesNotMatch(app, /transportAnchorPosition|transportAnchorPerformance|scheduledPerformanceForOrdinal|quadrupedStepDurationSeconds/);
  assert.doesNotMatch(currentPosition, /\(now\s*-.*\)\s*\//);
  assert.match(app, /stalled · add a footfall/);
  assert.match(app, /Feet cleared\. Stored momentum is coasting; the score will stall without another foot push\./);
  assert.match(app, /function wakeMotorAtFootfall/);
  assert.match(app, /if \(transportPlaying && motor\.velocity <= 0\.012\) wakeMotorAtFootfall\(now\);/);
  const animationLoop = app.match(/function animationLoop\(now\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(animationLoop, /syncGridPlayhead\(snapshot\.frame\)/);
  assert.match(animationLoop, /updateStageReadouts\(snapshot\.frame\)/);
});

test("Quadruped keeps the animal centered while its score moves underneath and head gestures stay specific", async () => {
  const app = await read("quadruped-app.js");
  assert.match(app, /lastTerrainHits/);
  assert.match(app, /headPerformanceStrength/);
  assert.match(app, /const centerX = width \* 0\.5/);
  assert.match(app, /nostril|muzzle/i);
  assert.match(app, /trunk[-A-Z_a-z]*lift/i);
  assert.match(app, /head[-A-Z_a-z]*toss/i);
  assert.match(app, /function drawCabinetPose/);
  assert.match(app, /quadruped-cabinet-frame/);
  assert.match(app, /pose\.airborne/);
});

test("Quadruped schedules audio against AudioContext time with bounded voices and cleanup", async () => {
  const app = await read("quadruped-app.js");
  assert.match(app, /graph\.context\.currentTime/);
  assert.match(app, /mixBus\.gain\.value = 1\.45/);
  assert.match(app, /schedulerLookaheadSeconds/);
  assert.match(app, /function manualHeadEvent\(\) \{\s*return quadrupedHeadPhrase\(state, selectedStep\);\s*\}/);
  assert.match(app, /head\.kind === "trumpet"/);
  assert.match(app, /head\.kind === "neigh-arpeggio"/);
  assert.match(app, /head\.kind === "marimba-string"/);
  assert.match(app, /head\.kind === "purr-meow"/);
  assert.match(app, /head\.kind === "chirp-run"/);
  assert.match(app, /head\.kind === "neck-harp"/);
  assert.match(app, /head\.kind === "hiss-click"/);
  assert.match(app, /const isFront = contact\.id\.startsWith\("front"\)/);
  assert.match(app, /isLeft \? 82 : 104/);
  assert.match(app, /isLeft \? 659 : 880/);
  assert.match(app, /isLeft \? 520 : 690/);
  assert.match(app, /notes\.forEach\(\(note, index\) =>/);
  assert.match(app, /exponentialRampToValueAtTime\(Math\.max\(0\.0002, peak \* 0\.72\)/);
  assert.match(app, /manualImpulses\.delete\("head"\)/);
  assert.match(app, /transportPlaying \? pose\.headPerformance/);
  assert.match(app, /activeSources\.size >= QUADRUPED_LIMITS\.maxScheduledVoices/);
  assert.match(app, /source\.onended = \(\) => removeAudioSource\(record\)/);
  assert.match(app, /pagehide/);
  assert.match(app, /pointercancel/);
  assert.match(app, /lostpointercapture/);
  assert.match(app, /cancelAnimationFrame/);
  assert.match(app, /context\.close\(\)/);
  const tail = app.match(/function scheduleTail\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  for (const animal of ["elephant", "unicorn", "gazelle", "cat", "cheetah", "giraffe"]) {
    assert.match(tail, new RegExp(`state\\.animalId === "${animal}"`));
  }
  assert.match(tail, /index \* 0\.003/);
  assert.doesNotMatch(tail, /index \* 0\.018/);
});

test("Quadruped rebases edited support, freezes the paused frame, and shares one animal physics source", async () => {
  const [app, model, motor, catalog] = await Promise.all([
    read("quadruped-app.js"),
    read("src/quadruped.js"),
    read("src/quadruped-motor.js"),
    read("src/instrument-catalog.js"),
  ]);
  const stopTransport = app.match(/function stopTransport\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const keyboard = app.match(/function handleGridKeydown\(event\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(stopTransport, /selectedStep = mod\(Math\.floor\(stoppedPosition\), QUADRUPED_STEP_COUNT\)/);
  assert.match(keyboard, /state = setQuadrupedContact[\s\S]*?retimeTransport\(position, now, \{ preserveMotion: true \}\)/);
  assert.match(app, /const behaviors = \[\.\.\.quadrupedBehaviorsForAnimal[\s\S]*?leftFit - rightFit/);
  assert.match(motor, /quadrupedAnimal/);
  assert.doesNotMatch(motor, /SPECIES_PHYSICS/);
  for (const property of ["mass", "power", "compliance", "rollingResistance", "baseGravity"]) {
    assert.match(model, new RegExp(`${property}:`));
  }
  for (const animal of ["Elephant", "Unicorn", "Gazelle", "Cat", "Cheetah", "Giraffe", "Lizard"]) {
    assert.match(catalog, new RegExp(animal));
  }
  assert.match(catalog, /traction advances the music/i);
});

test("Quadruped keeps its sequencer scrollable and primary coarse-pointer targets reachable", async () => {
  const css = await read("quadruped.css");
  assert.match(css, /\.quadruped-grid-scroll\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.quadruped-cabinet-frame\s*\{/);
  assert.match(css, /\.quadruped-grid-row-label\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /@media\s*\(max-height:\s*480px\)\s*and\s*\(orientation:\s*landscape\)/);
  assert.match(css, /@media\s*\(pointer:\s*coarse\)[\s\S]*?min-height:\s*48px/);
  assert.match(css, /\.quadruped-play\s*\{[\s\S]*?min-height:\s*48px/);
  assert.match(css, /grid-template-areas:\s*"stage"\s*"sequence"\s*"console"/);
  assert.match(css, /#stage:focus-visible|\.quadruped-stage[^\n]*focus-visible/);
});

test("the expanded gait dictionary stays compact and scrollable across desktop and phone layouts", async () => {
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
});
