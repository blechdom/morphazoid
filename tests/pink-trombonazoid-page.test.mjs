import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { PINK_TROMBONAZOID_LANES } from "../src/pink-trombonazoid.js";

const ROOT = new URL("../", import.meta.url);

function idsIn(markup) {
  return [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
}

test("Pink Trombonazoid page wires its accessible editor and local modules", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("pink-trombonazoid.html", ROOT), "utf8"),
    readFile(new URL("pink-trombonazoid-app.js", ROOT), "utf8"),
  ]);

  assert.match(html, /<body\b[^>]*class="[^"]*\bpink-trombonazoid-page\b/);
  assert.match(html, /href="pink-trombonazoid\.html"[\s\S]*?aria-current="page"/);
  assert.match(html, /<option value="pink-trombonazoid\.html" selected>Pink Trombonazoid<\/option>/);
  assert.match(html, /<script type="module" src="pink-trombonazoid-app\.js"><\/script>/);

  const ids = idsIn(html);
  const idSet = new Set(ids);
  assert.equal(idSet.size, ids.length, "page IDs must be unique");
  for (const id of [
    "pinkTrombonazoid", "audioButton", "audioState", "level", "tractCanvas",
    "wordInput", "buildWordButton", "pronunciationStatus", "phonemeRuler",
    "timelineScroll", "laneGutter", "timelineSvg", "playButton", "stopButton",
    "loopButton", "segmentDuration", "segmentPitch", "segmentIntensity",
    "segmentBreath", "personality", "speechRate", "wordGap", "pitchModShape",
    "pitchModRate", "pitchModDepth", "breathModShape", "breathModRate",
    "breathModDepth", "modulationBypass", "drive", "tone", "echo",
    "echoTime", "effectsBypass", "resetPinkTrombonazoid", "liveStatus",
  ]) assert.ok(idSet.has(id), `missing #${id}`);

  const runtimeIds = new Set(["timelinePlayhead", "timelinePlayheadCap"]);
  for (const id of [...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1])) {
    if (runtimeIds.has(id)) continue;
    assert.ok(idSet.has(id), `pink-trombonazoid-app.js references missing #${id}`);
  }
  for (const match of html.matchAll(/\b(?:for|aria-labelledby|aria-describedby)="([^"]+)"/g)) {
    for (const id of match[1].trim().split(/\s+/)) {
      assert.ok(idSet.has(id), `markup references missing #${id}`);
    }
  }
  for (const button of html.matchAll(/<button\b[^>]*>/g)) {
    assert.match(button[0], /\btype="button"/, `${button[0]} needs type=button`);
  }

  const localAssets = [...html.matchAll(/<(?:link|script)\b[^>]*(?:href|src)="([^"]+)"[^>]*>/g)]
    .map((match) => match[1])
    .filter((path) => !/^(?:https?:|data:|#)/.test(path));
  for (const path of localAssets) {
    assert.equal((await stat(new URL(path, ROOT))).isFile(), true, `${path} must resolve`);
  }
  for (const path of [...app.matchAll(/\bfrom\s+"(\.[^"]+)"/g)].map((match) => match[1])) {
    assert.equal(
      (await stat(new URL(path, new URL("pink-trombonazoid-app.js", ROOT)))).isFile(),
      true,
      `${path} must resolve from the page app`,
    );
  }
});

test("the page explains and implements word-to-tract sequencing", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("pink-trombonazoid.html", ROOT), "utf8"),
    readFile(new URL("pink-trombonazoid-app.js", ROOT), "utf8"),
  ]);

  assert.match(html, /Local CMU pronunciation dictionary/);
  assert.match(html, /Consonants keep discrete closures and releases/);
  assert.match(html, /44-section tract/);
  assert.match(html, /href="https:\/\/dood\.al\/pinktrombone\/"/);
  assert.match(html, /Phoneme identity still comes from the timeline/);

  assert.match(app, /loadSpellingPronunciations\(text\)/);
  assert.match(app, /compilePinkTrombonazoid\(text, sequenceSettings\(\)\)/);
  assert.match(app, /segment\.type === "boundary"[\s\S]*?audio\.release/);
  assert.match(app, /pinkTrombonazoidAudioEvent\(segment/);
  assert.match(app, /audio\.articulate\(event\)/);
  assert.match(app, /samplePinkTrombonazoidLfo/);
  assert.match(app, /audio\.modulate\(/);
  assert.match(app, /automationLaneValuesAt\(state\.elapsedMs\)/);
  assert.match(app, /performance:\s*event\?\.performance/);
  assert.match(app, /audio\.setEffects\(/);
  assert.match(app, /updatePinkTrombonazoidSegment/);
  assert.match(
    app,
    /audio\.activeEngine !== "tube"[\s\S]*?segment\.articulationIndex > 0[\s\S]*?durationMs:\s*phone\.durationMs/,
    "fallback voices play one joined sample for a multi-gesture phone",
  );
  assert.deepEqual(
    PINK_TROMBONAZOID_LANES.map(({ id }) => id),
    [
      "pitch", "intensity", "breath", "tonguePosition", "tongueHeight",
      "lipOpening", "nasalCoupling", "mutation",
    ],
  );
});

test("Pink Trombonazoid uses the source palette and responsive Hybrinx-style lanes", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("pink-trombonazoid.html", ROOT), "utf8"),
    readFile(new URL("pink-trombonazoid.css", ROOT), "utf8"),
  ]);

  assert.match(html, /name="theme-color" content="#FFEEF5"/);
  for (const color of ["#ffffff", "#ffeef5", "#ffc0cb", "#da70d6", "#c070c6"]) {
    assert.ok(css.toLowerCase().includes(color), `missing Pink Trombone color ${color}`);
  }
  assert.match(css, /\.ptz-phoneme-ruler\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.ptz-timeline-scroll\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(css, /\.ptz-lane-gutter\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /#tractCanvas\s*\{[\s\S]*?touch-action:\s*pan-y/);
  assert.match(css, /\.ptz-keyframe,[\s\S]*?\.ptz-keyframe-hit\s*\{[\s\S]*?touch-action:\s*none/);
  assert.match(css, /@media \(max-width:\s*650px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media \(forced-colors:\s*active\)/);
});
