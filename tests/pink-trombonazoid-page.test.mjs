import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import {
  PINK_TROMBONAZOID_LANES,
  PINK_TROMBONAZOID_VOICE_HARMONIES,
  PINK_TROMBONAZOID_VOICE_PRESETS,
} from "../src/pink-trombonazoid.js";

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
  assert.match(
    html,
    /href="pink-trombonazoid\.css\?v=pink-trombonazoid-20260821-7"/,
  );
  assert.match(
    html,
    /<script type="module" src="pink-trombonazoid-app\.js\?v=pink-trombonazoid-20260821-6"><\/script>/,
  );
  assert.match(
    app,
    /from "\.\/src\/pink-trombonazoid\.js\?v=pink-trombonazoid-20260821-6"/,
    "the app and its core must share a cache version",
  );

  const ids = idsIn(html);
  const idSet = new Set(ids);
  assert.equal(idSet.size, ids.length, "page IDs must be unique");
  for (const id of [
    "pinkTrombonazoid", "audioButton", "audioState", "level",
    "wordInput", "buildWordButton", "pronunciationStatus", "phonemeRuler",
    "timelineScroll", "laneGutter", "timelineSvg", "playButton", "stopButton",
    "loopButton", "selectedPhone", "selectedPhoneKind", "selectedPhoneHelp",
    "segmentDuration", "segmentPitch", "segmentIntensity",
    "segmentBreath", "personality", "voiceThroats", "voiceHarmony",
    "voiceRegister", "voiceDetune", "voiceBody", "voiceTension",
    "voiceVariation", "voiceCoupling", "voiceSpread", "voiceEngineNote",
    "speechRate", "wordGap", "pitchModShape",
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
  assert.doesNotMatch(html, /tractCanvas|ptz-tract-card/);
  assert.equal((html.match(/<details class="ptz-panel-section/g) ?? []).length, 4);
  assert.equal((html.match(/<section class="ptz-panel-section/g) ?? []).length, 0);
  assert.match(html, /<details class="ptz-panel-section ptz-selected-editor"[^>]* open>/);
  assert.match(html, /<details class="ptz-panel-section"[^>]* open>/);
  assert.match(html, /<details class="ptz-panel-section ptz-modulators"[^>]*>/);
  assert.doesNotMatch(html, /<details class="ptz-panel-section ptz-modulators"[^>]* open>/);
  assert.doesNotMatch(html, /<details class="ptz-panel-section ptz-effects"[^>]* open>/);

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

  assert.doesNotMatch(html, /THROATAZOID × HYBRINX|Local CMU pronunciation dictionary/);
  assert.match(html, /<p class="sr-only" id="pronunciationStatus" role="status" aria-live="polite"><\/p>/);
  assert.match(html, /Consonants keep discrete closures and releases/);
  assert.match(html, /44-section tract/);
  assert.match(html, /href="https:\/\/dood\.al\/pinktrombone\/"/);
  assert.match(html, /Phoneme identity still comes from the timeline/);
  assert.match(html, /pronunciation stays fixed/i);
  assert.match(html, /Ensemble presets layer the same phone across throats/);
  assert.match(html, /Diphthongs keep two tract gestures under one block and one acoustic envelope/);
  assert.match(html, /id="echo"[^>]*value="0"/);

  assert.match(app, /loadSpellingPronunciations\(text\)/);
  assert.match(app, /\$\("buildWordButton"\)\.addEventListener\("click", \(\) => void buildWord\(\)\)/);
  assert.match(app, /function populatePhoneOptions\(select,[\s\S]*?select\.replaceChildren\(\)/);
  assert.match(app, /function populatePhoneMenu\(\)[\s\S]*?placeholder: true/);
  assert.match(app, /populatePhoneMenu\(\);[\s\S]*?await buildWord\("hello", \{ announceBuild: false \}\);/);
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
  assert.match(app, /PINK_TROMBONAZOID_PHONE_CATALOG/);
  assert.match(app, /PINK_TROMBONAZOID_VOICE_PRESETS/);
  assert.match(app, /PINK_TROMBONAZOID_VOICE_HARMONIES/);
  assert.equal((app.match(/voice:\s*voiceSettings\(\)/g) ?? []).length, 2);
  assert.match(app, /personality:\s*selectedVoicePreset\(\)\.personality/);
  assert.match(app, /Multi-throat shaping needs the physical tube/);
  assert.match(app, /replacePinkTrombonazoidPhone\(/);
  assert.match(app, /insertPinkTrombonazoidPhone\(/);
  assert.match(app, /movePinkTrombonazoidPhone\(/);
  assert.match(app, /removePinkTrombonazoidPhone\(/);
  assert.match(app, /document\.createElement\("select"\)[\s\S]*?ptz-inline-phone-select/);
  assert.match(app, /populatePhoneOptions\(select\)[\s\S]*?select\.value = entry\.phone/);
  assert.match(app, /select\.addEventListener\("change"[\s\S]*?replacePhone\(entry\.id/);
  assert.match(app, /shortLabel\.textContent = entry\.phoneLabel/);
  assert.match(app, /removeButton\.textContent = "x"/);
  assert.match(app, /placeholderLabel: "\+"/);
  assert.match(app, /moveButton\.draggable = true/);
  assert.match(app, /\["ArrowLeft", "ArrowRight"\][\s\S]*?movePhone\(/);
  assert.match(app, /focusOrigin === "timeline"[\s\S]*?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /rulerScrollLeft[\s\S]*?timelineScrollLeft/);
  assert.match(app, /Diphthongs \+ R-colored vowels/);
  assert.match(app, /\$\("selectedPhone"\)\.disabled = !phone/);
  assert.doesNotMatch(app, /drawTract|tractCanvas|getContext\("2d"\)/);
  assert.match(
    app,
    /audio\.activeEngine !== "tube"[\s\S]*?segment\.articulationIndex > 0[\s\S]*?durationMs:\s*phone\.durationMs/,
    "fallback voices play one joined sample for a multi-gesture phone",
  );
  assert.match(
    app,
    /segment\.articulationIndex > 0\)[\s\S]*?audio\.modulate\(\{ performance: event\.performance \}\)/,
    "the physical tube morphs later diphthong gestures without a second vowel attack",
  );
  assert.match(app, /carrierPerformance:\s*null/);
  assert.match(app, /function keepPlaybackAfterEdit[\s\S]*?playbackSegmentIndex/);
  assert.match(app, /function followPlayhead[\s\S]*?scroller\.scrollLeft = next[\s\S]*?ruler\.scrollLeft = next/);
  assert.match(app, /cap\?\.setAttribute[\s\S]*?followPlayhead\(x\)/);
  assert.match(app, /function resizeTimeline[\s\S]*?renderPhonemeRuler\(\)[\s\S]*?renderTimeline\(\)/);
  assert.match(app, /new ResizeObserver/);
  assert.deepEqual(
    PINK_TROMBONAZOID_LANES.map(({ id }) => id),
    [
      "pitch", "intensity", "breath", "tonguePosition", "tongueHeight",
      "lipOpening", "nasalCoupling", "mutation",
    ],
  );
  assert.equal(Object.keys(PINK_TROMBONAZOID_VOICE_PRESETS).length, 18);
  assert.deepEqual(Object.keys(PINK_TROMBONAZOID_VOICE_HARMONIES), [
    "shared", "unison", "fifths", "choir",
  ]);
});

test("Pink Trombonazoid uses the source palette and responsive Hybrinx-style lanes", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("pink-trombonazoid.html", ROOT), "utf8"),
    readFile(new URL("pink-trombonazoid.css", ROOT), "utf8"),
  ]);

  assert.match(html, /name="theme-color" content="#050205"/);
  assert.match(css, /--ptz-black:\s*#050205/);
  assert.match(css, /\.pink-trombonazoid-page\s*\{[\s\S]*?background:[\s\S]*?var\(--ptz-black\)/);
  assert.match(css, /#wordInput\s*\{[\s\S]*?background:\s*var\(--ptz-pale\)/);
  assert.match(css, /\.ptz-sequencer\s*\{[\s\S]*?background:\s*var\(--ptz-white\)/);
  assert.match(css, /\.ptz-panel\s*\{[\s\S]*?background:\s*var\(--ptz-black\)/);
  assert.match(css, /\.audio-button\[aria-pressed="true"\]\s*\{[\s\S]*?background:\s*rgba\(216, 95, 146, 0\.2\)/);
  for (const color of ["#ffffff", "#ffeef5", "#ffc0cb", "#e779a8", "#d85f92"]) {
    assert.ok(css.toLowerCase().includes(color), `missing Pink Trombone color ${color}`);
  }
  assert.match(css, /\.ptz-phoneme-ruler\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.ptz-timeline-scroll\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(css, /\.ptz-lane-gutter\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /\.ptz-phone-pill select\s*\{[\s\S]*?border-radius:\s*999px/);
  assert.match(css, /\.ptz-phone-pill select\s*\{[\s\S]*?appearance:\s*none/);
  assert.match(css, /\.ptz-phoneme-select\s*\{[\s\S]*?min-height:\s*32px/);
  assert.match(css, /\.ptz-phoneme-select\s*\{[\s\S]*?touch-action:\s*manipulation/);
  assert.match(css, /\.ptz-phoneme-short\s*\{[\s\S]*?font-size:\s*12px/);
  assert.match(css, /\.ptz-phone-tools\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, 24px\)/);
  assert.match(css, /\.ptz-phone-move,[\s\S]*?\.ptz-phone-delete\s*\{[\s\S]*?width:\s*24px;[\s\S]*?height:\s*24px/);
  assert.match(css, /\.ptz-phone-delete\s*\{[\s\S]*?font-size:\s*11px/);
  assert.match(css, /\.ptz-empty-phone-add\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px/);
  assert.match(css, /\.ptz-phoneme-cell\.is-drop-before/);
  assert.match(css, /@media \(max-width:\s*650px\)[\s\S]*?\.ptz-phoneme-select\s*\{[\s\S]*?font-size:\s*16px/);
  assert.match(css, /\.ptz-voice-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/);
  assert.match(css, /\.ptz-panel-section > \.ptz-panel-summary::after\s*\{[\s\S]*?content:\s*""/);
  assert.match(css, /\.ptz-panel-section\[open\] > \.ptz-panel-summary::after\s*\{[\s\S]*?background:\s*linear-gradient/);
  assert.match(css, /@media \(max-width:\s*420px\)[\s\S]*?\.ptz-voice-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /tractCanvas|ptz-tract-card/);
  assert.match(css, /\.ptz-keyframe,[\s\S]*?\.ptz-keyframe-hit\s*\{[\s\S]*?touch-action:\s*none/);
  assert.match(css, /@media \(max-width:\s*650px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media \(forced-colors:\s*active\)/);
});
