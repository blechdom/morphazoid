import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Quadruped page uses the standard name and exposes all three animal scores", async () => {
  const html = await read("quadruped.html");
  assert.match(html, /<title>Quadruped · Morphazoid<\/title>/);
  assert.match(html, /<h1 id="pageTitle">QUADRUPED<\/h1>/);
  assert.doesNotMatch(html, /FIVE CONTACT LANES/i);
  assert.doesNotMatch(html, /Write the feet\. The creature has to live with the rhythm\./i);
  for (const animal of ["elephant", "unicorn", "gazelle"]) {
    assert.match(html, new RegExp(`data-animal-id="${animal}"`));
  }
  for (const lane of ["front-left", "front-right", "rear-left", "rear-right", "tail"]) {
    assert.match(html, new RegExp(`data-lane-id="${lane}"`));
  }
  assert.match(html, /id="sequenceGrid"[^>]*role="grid"/);
  assert.match(html, /16 CABINET FRAMES/);
  assert.match(html, /OFF · ○ SOFT · ● LOUD/);
  assert.match(html, /Gait dictionary/);
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

test("Quadruped markup does not duplicate ids", async () => {
  const html = await read("quadruped.html");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});
