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

function standaloneFunctionBody(source, name) {
  const signature = new RegExp(`function\\s+${name}\\s*\\(`);
  const match = signature.exec(source);
  assert.ok(match, `Missing ${name}()`);
  const parametersStart = source.indexOf("(", match.index);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === "(") parameterDepth += 1;
    if (source[index] === ")") parameterDepth -= 1;
    if (parameterDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  const bodyStart = source.indexOf("{", parametersEnd);
  assert.ok(bodyStart >= 0, `Missing body for ${name}()`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`Unterminated ${name}()`);
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
    /href="pink-trombonazoid\.css\?v=pink-trombonazoid-20260822-12"/,
  );
  assert.match(
    html,
    /<script type="module" src="pink-trombonazoid-app\.js\?v=pink-trombonazoid-20260822-12"><\/script>/,
  );
  assert.match(
    app,
    /from "\.\/src\/pink-trombonazoid\.js\?v=pink-trombonazoid-20260822-12"/,
    "the app and its core must share a cache version",
  );

  const ids = idsIn(html);
  const idSet = new Set(ids);
  assert.equal(idSet.size, ids.length, "page IDs must be unique");
  for (const id of [
    "pinkTrombonazoid", "audioButton", "audioState", "level",
    "wordInput", "buildWordButton", "pronunciationStatus", "phonemeRuler",
    "timelineScroll", "laneGutter", "timelineSvg", "timelineZoomY",
    "timelineZoomYOut", "playButton", "stopButton",
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
  assert.doesNotMatch(html, /ptz-hero-readouts|What should it say\?|dictionary → tract gestures/);
  assert.equal((html.match(/<details class="ptz-panel-section/g) ?? []).length, 4);
  assert.equal((html.match(/<section class="ptz-panel-section/g) ?? []).length, 0);
  assert.match(html, /<details class="ptz-panel-section ptz-selected-editor"[^>]* open>/);
  assert.match(html, /<details class="ptz-panel-section"[^>]* open>/);
  assert.match(html, /<details class="ptz-panel-section ptz-modulators"[^>]*>/);
  assert.doesNotMatch(html, /<details class="ptz-panel-section ptz-modulators"[^>]* open>/);
  assert.doesNotMatch(html, /<details class="ptz-panel-section ptz-effects"[^>]* open>/);

  const zoomInput = html.match(/<input\b[^>]*id="timelineZoomY"[^>]*>/i)?.[0] ?? "";
  assert.match(html, /<label\b[^>]*class="[^"]*ptz-timeline-zoom[^"]*"[^>]*for="timelineZoomY"/i);
  assert.match(zoomInput, /type="range"/i);
  assert.match(zoomInput, /min="100"/i, "100% is the fitted lane-height baseline");
  assert.match(zoomInput, /max="400"/i, "vertical zoom must provide fine-grained enlargement");
  assert.match(zoomInput, /value="100"/i);
  assert.match(zoomInput, /aria-label="[^"]*(?:vertical|lane)[^"]*zoom[^"]*"/i);
  assert.match(html, /<output\b[^>]*id="timelineZoomYOut"[^>]*for="timelineZoomY"[^>]*>100%<\/output>/i);

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
  assert.match(app, /ptz-phone-add-shell/);
  assert.match(app, /shell\.append\(glyph, select\)/);
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

test("timeline automation supports multiple two-dimensional keys, live playback, and lane zoom", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("pink-trombonazoid.html", ROOT), "utf8"),
    readFile(new URL("pink-trombonazoid-app.js", ROOT), "utf8"),
  ]);
  const renderTimeline = standaloneFunctionBody(app, "renderTimeline");
  const timelineGeometry = standaloneFunctionBody(app, "timelineGeometry");
  const continueDrag = standaloneFunctionBody(app, "continueDrag");
  const activateSegment = standaloneFunctionBody(app, "activateSegment");
  const automationLaneValuesAt = standaloneFunctionBody(app, "automationLaneValuesAt");

  assert.match(html, /drag keys in (?:any direction|2D)/i);
  assert.match(html, /double-click(?: a lane)? to add/i);
  assert.match(html, /Drag a key left or right within its phoneme for time, and up or down for value/i);
  assert.match(html, /press Delete to remove it/i);

  for (const api of [
    "addPinkTrombonazoidKeyframe",
    "updatePinkTrombonazoidKeyframe",
    "removePinkTrombonazoidKeyframe",
  ]) {
    assert.match(app, new RegExp(`\\b${api}\\b`), `${api} must be wired into the page app`);
  }
  for (const attribute of ["data-keyframe-id", "data-segment-id", "data-lane"]) {
    assert.match(renderTimeline, new RegExp(`["']${attribute}["']`));
  }
  assert.match(renderTimeline, /laneKeyframes/);
  assert.match(renderTimeline, /(?:class|className)\s*[:=]\s*["']ptz-lane-key-add["']/);
  assert.match(renderTimeline, /addEventListener\(["']dblclick["']/);
  assert.match(renderTimeline, /addEventListener\(["']click["']/);
  assert.match(
    renderTimeline,
    /add(?:PinkTrombonazoid)?Keyframe[\s\S]*?timeMs[\s\S]*?value|timeMs[\s\S]*?value[\s\S]*?add(?:PinkTrombonazoid)?Keyframe/,
    "double-click and + additions must author both the new key's time and value",
  );

  assert.match(continueDrag, /timeMs/);
  assert.match(continueDrag, /value/);
  assert.match(
    continueDrag,
    /updatePinkTrombonazoidKeyframe|editKeyframe/,
    "pointer drags must update a stable key rather than overwrite the whole phone",
  );
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    assert.match(renderTimeline, new RegExp(`["']${key}["']`));
  }
  assert.match(renderTimeline, /["'](?:Delete|Backspace)["']/);
  assert.match(renderTimeline, /removePinkTrombonazoidKeyframe|removeKeyframe/);
  assert.match(
    app,
    /updatePinkTrombonazoidKeyframe\([\s\S]{0,900}?renderAll\(\)[\s\S]{0,500}?keepPlaybackAfterEdit\(/,
    "moving a key must preserve an active loop or playback pass",
  );
  assert.match(
    app,
    /addPinkTrombonazoidKeyframe\([\s\S]{0,900}?renderAll\(\)[\s\S]{0,500}?keepPlaybackAfterEdit\(/,
    "adding a key must preserve an active loop or playback pass",
  );
  assert.match(
    app,
    /removePinkTrombonazoidKeyframe\([\s\S]{0,900}?renderAll\(\)[\s\S]{0,500}?keepPlaybackAfterEdit\(/,
    "removing a key must preserve an active loop or playback pass",
  );

  assert.match(automationLaneValuesAt, /samplePinkTrombonazoidAutomation/);
  assert.match(activateSegment, /automationLaneValuesAt\(/);
  assert.match(
    activateSegment,
    /pinkTrombonazoidAudioEvent\([\s\S]*?laneValues/,
    "the first audio event must consume the authored contour instead of waiting for a later tick",
  );

  assert.match(app, /timelineZoomY:\s*1/);
  assert.match(app, /LANE_HEIGHT\s*\*\s*state\.timelineZoomY/);
  assert.match(
    app,
    /Math\.max\(\s*LANE_GRAPH_HEIGHT\s*,\s*laneHeight\s*-\s*\(LANE_HEIGHT\s*-\s*LANE_GRAPH_HEIGHT\)\s*,?\s*\)/,
    "vertical zoom must increase usable value-drag resolution as lanes get taller",
  );
  assert.match(
    app,
    /bindRange\(\s*["']timelineZoomY["'][\s\S]{0,200}?setTimelineZoomY\s*\)/,
    "lane zoom must update live while the range is dragged",
  );
  const setTimelineZoomY = standaloneFunctionBody(app, "setTimelineZoomY");
  assert.match(setTimelineZoomY, /state\.timelineZoomY\s*=/);
  assert.match(setTimelineZoomY, /renderTimeline\(\)/);
  assert.match(timelineGeometry, /PINK_TROMBONAZOID_LANES\.length\s*\*\s*laneHeight/);
  assert.match(continueDrag, /graphHeight/);
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
  assert.match(css, /\.ptz-sequencer\s*\{[\s\S]*?background:\s*var\(--ptz-black-panel\)/);
  assert.match(css, /\.ptz-panel\s*\{[\s\S]*?background:\s*var\(--ptz-black\)/);
  assert.match(css, /\.audio-button\[aria-pressed="true"\]\s*\{[\s\S]*?background:\s*rgba\(216, 95, 146, 0\.2\)/);
  for (const color of ["#ffffff", "#ffeef5", "#ffc0cb", "#e779a8", "#d85f92"]) {
    assert.ok(css.toLowerCase().includes(color), `missing Pink Trombone color ${color}`);
  }
  assert.match(
    css,
    /\.ptz-phoneme-ruler\s*\{[^}]*overflow-x:\s*auto[^}]*overscroll-behavior-x:\s*contain[^}]*overscroll-behavior-y:\s*auto[^}]*touch-action:\s*pan-x pan-y[^}]*-webkit-overflow-scrolling:\s*touch/s,
    "the phoneme ruler must allow page swipes while retaining horizontal timeline scrolling",
  );
  assert.match(
    css,
    /\.ptz-timeline-scroll\s*\{[^}]*overflow:\s*auto[^}]*overscroll-behavior-x:\s*contain[^}]*overscroll-behavior-y:\s*auto[^}]*touch-action:\s*pan-x pan-y[^}]*-webkit-overflow-scrolling:\s*touch/s,
    "the lane scroller must allow page swipes while retaining two-axis timeline scrolling",
  );
  assert.match(css, /\.ptz-lane-gutter\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /\.ptz-timeline-controls\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.ptz-phoneme-row\s*\{[^}]*grid-template-columns:\s*128px minmax\(0, 1fr\)/s);
  assert.match(css, /\.ptz-timeline-zoom\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.ptz-timeline-zoom input\[type="range"\]\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.ptz-zoom-knob > i\s*\{[^}]*conic-gradient/s);
  assert.match(css, /\.ptz-timeline-svg\s*\{[^}]*background:\s*var\(--ptz-black-panel\)/s);
  assert.match(css, /\.ptz-lane-gutter\s*\{[^}]*background:\s*rgba\(12, 7, 13, 0\.98\)/s);
  assert.match(
    css,
    /\.ptz-lane-key-add\s*\{[^}]*width:\s*20px;[^}]*min-width:\s*20px;[^}]*height:\s*20px;[^}]*min-height:\s*20px;/s,
    "each lane needs a compact keyboard-accessible add-key button",
  );
  assert.match(css, /\.ptz-phone-pill select\s*\{[\s\S]*?border-radius:\s*999px/);
  assert.match(css, /\.ptz-phone-pill select\s*\{[\s\S]*?appearance:\s*none/);
  assert.match(css, /\.ptz-phoneme-ruler\s*\{[\s\S]*?min-height:\s*42px/);
  assert.match(css, /\.ptz-phoneme-cell\s*\{[\s\S]*?min-height:\s*41px/);
  assert.match(css, /\.ptz-phoneme-select\s*\{[\s\S]*?min-height:\s*26px/);
  assert.match(css, /\.ptz-phoneme-select\s*\{[\s\S]*?touch-action:\s*manipulation/);
  assert.match(css, /\.ptz-phoneme-short\s*\{[\s\S]*?font-size:\s*10px/);
  assert.match(css, /\.ptz-phone-tools\s*\{[\s\S]*?position:\s*static[\s\S]*?grid-column:\s*2[\s\S]*?grid-template-columns:\s*repeat\(3, 20px\)/);
  assert.match(css, /\.ptz-phone-move,[\s\S]*?\.ptz-phone-delete\s*\{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px/);
  assert.match(
    css,
    /\.ptz-phone-add\s*\{[^}]*min-width:\s*20px;[^}]*max-width:\s*20px;[^}]*min-height:\s*20px;[^}]*max-height:\s*20px;/s,
    "the phoneme add select must override the global tall select minimum with a compact square",
  );
  assert.match(css, /\.ptz-phone-add-shell\s*\{[^}]*position:\s*relative;[^}]*overflow:\s*hidden/s);
  assert.match(
    css,
    /\.ptz-phone-add\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*opacity:\s*0/s,
    "the native mobile picker must be an invisible overlay on a deterministic square +",
  );
  assert.match(css, /\.ptz-phone-delete\s*\{[\s\S]*?font-size:\s*9px/);
  assert.match(
    css,
    /\.ptz-empty-phone-add\s*\{[^}]*width:\s*28px;[^}]*min-width:\s*28px;[^}]*max-width:\s*28px;[^}]*height:\s*28px;[^}]*min-height:\s*28px;[^}]*max-height:\s*28px;/s,
  );
  assert.match(css, /\.ptz-phoneme-cell\.is-drop-before/);
  assert.match(css, /@media \(max-width:\s*650px\)[\s\S]*?\.ptz-phoneme-select\s*\{[\s\S]*?font-size:\s*16px/);
  assert.match(css, /\.ptz-voice-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/);
  assert.match(css, /\.ptz-panel-section > \.ptz-panel-summary::after\s*\{[\s\S]*?content:\s*""/);
  assert.match(css, /\.ptz-panel-section\[open\] > \.ptz-panel-summary::after\s*\{[\s\S]*?background:\s*linear-gradient/);
  assert.match(css, /@media \(max-width:\s*420px\)[\s\S]*?\.ptz-voice-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /tractCanvas|ptz-tract-card/);
  assert.match(css, /\.ptz-keyframe,[\s\S]*?\.ptz-keyframe-hit\s*\{[\s\S]*?touch-action:\s*none/);
  assert.match(
    css,
    /\.ptz-keyframe,[^}]*\.ptz-keyframe-hit\s*\{[^}]*cursor:\s*move/s,
    "timeline diamonds must advertise two-dimensional movement",
  );
  assert.match(css, /@media \(max-width:\s*650px\)/);
  assert.match(
    css,
    /@media \(max-width:\s*650px\)[\s\S]*?\.ptz-timeline-controls\s*\{[^}]*grid-template-columns:\s*1fr/s,
    "vertical zoom and transport controls need a compact phone layout",
  );
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media \(forced-colors:\s*active\)/);

  const mobileCss = css.match(
    /@media \(max-width:\s*960px\)\s*\{[\s\S]*?(?=@media \(max-width:\s*880px\))/,
  )?.[0] ?? "";
  assert.match(
    mobileCss,
    /html\s*\{[^}]*height:\s*auto[^}]*min-height:\s*100%[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s,
    "compact screens must give vertical scrolling back to the document root",
  );
  assert.match(
    mobileCss,
    /body\.pink-trombonazoid-page\s*\{[^}]*height:\s*auto[^}]*min-height:\s*100dvh[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto[^}]*overscroll-behavior-y:\s*auto[^}]*-webkit-overflow-scrolling:\s*touch/s,
    "Pink Trombonazoid must remain a naturally scrolling document on mobile",
  );
  assert.match(
    mobileCss,
    /\.ptz-timeline-scroll\s*\{[^}]*max-height:\s*none/s,
    "the short mobile timeline must hand vertical swipes directly to the page",
  );
});
