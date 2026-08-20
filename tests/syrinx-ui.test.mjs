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

  for (const runtimeFile of ["syrinx-ui.html", "syrinx-ui.css"]) {
    assert.match(build, new RegExp(runtimeFile.replaceAll(".", "\\.")));
  }
});


test("Tongued Beasts keeps viewport handles and the parameter panel available on mobile", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("tongued-beasts.html", root), "utf8"),
    readFile(new URL("tongued-beasts.css", root), "utf8"),
  ]);
  assert.match(html, /class="[^"]*syrinx-ui-page[^"]*tongued-beasts-page[^"]*"/);
  assert.match(html, /src="syrinx-app\.js\?v=syrinx-ui-[^"]+"/);
  assert.match(html, /href="tongued-beasts\.css\?v=syrinx-ui-[^"]+"/);
  assert.match(css, /orientation:\s*landscape[\s\S]*grid-template-columns:[\s\S]*\.tongued-beasts-page \.panel[\s\S]*overflow-y:\s*auto/);
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
