import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const REQUIRED_IDS = Object.freeze([
  "audioButton",
  "audioState",
  "playButton",
  "playLabel",
  "playState",
  "level",
  "levelOut",
  "restartButton",
  "patternSelect",
  "randomPatternButton",
  "mutatePatternButton",
  "clearPatternButton",
  "sequenceLength",
  "sequenceLengthOut",
  "tempo",
  "tempoOut",
  "swing",
  "swingOut",
  "breathRatio",
  "breathRatioOut",
  "pluckClock",
  "breathClock",
  "pluckClockHand",
  "breathClockHand",
  "pluckClockReadout",
  "breathClockReadout",
  "performerStage",
  "performerStep",
  "performerGesture",
  "performerVoice",
  "performerVowel",
  "performerPull",
  "performerAir",
  "performerPulse",
  "drawModeButton",
  "scrollModeButton",
  "paintHint",
  "sequenceScroller",
  "sequenceLane",
  "selectedStepNumber",
  "selectedStepSummary",
  "stepActionPluck",
  "stepActionSustain",
  "stepActionRest",
  "stepVowel",
  "stepVoice",
  "stepPitch",
  "stepPitchOut",
  "stepPull",
  "stepPullOut",
  "stepAir",
  "stepAirOut",
  "stepRate",
  "stepRateOut",
  "auditionButton",
  "panicButton",
  "performanceReadout",
  "telemetryEnergy",
  "telemetryBreath",
  "telemetryMaterial",
  "telemetryVowel",
  "telemetryPitch",
  "audioError",
  "liveStatus",
]);

const DYNAMIC_STEP_CLASSES = Object.freeze([
  "jaw-jam-step",
  "jaw-jam-step-action",
  "jaw-jam-pitch-lane",
  "jaw-jam-pitch-limit",
  "jaw-jam-note-block",
  "jaw-jam-note-pull",
  "jaw-jam-note-air",
  "jaw-jam-pulse-meter",
  "jaw-jam-step-flash",
]);

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function occurrences(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

test("Jaw Jam page exposes one complete accessible workstation contract", async () => {
  const html = await readFile(new URL("jaw-jam.html", root), "utf8");

  assert.match(html, /<body class="jaw-jam-page">/);
  assert.match(html, /<main class="jaw-jam-shell" id="jawJam">/);
  assert.match(html, /<h1 id="jawJamTitle">Jaw Jam<\/h1>/);
  assert.match(html, /pull \+ air = pulse/i);
  assert.match(html, /id="sequenceLength"[^>]*min="1"[^>]*max="32"/);
  assert.match(html, /id="tempo"[^>]*min="36"[^>]*max="480"/);
  assert.match(html, /id="playButton"[\s\S]{0,120}data-primary-transport/);
  assert.match(html, /id="sequenceScroller"[\s\S]{0,180}tabindex="0"[\s\S]{0,180}role="region"/);
  assert.match(html, /id="sequenceScroller"[\s\S]{0,300}aria-describedby="sequenceHelp"/);
  assert.match(html, /id="sequenceLane"[\s\S]{0,120}role="list"/);
  assert.match(html, /id="performerStage"[\s\S]{0,240}aria-label="Animated cutaway profile/);
  assert.match(html, /aria-label="Animated performer state"/);
  assert.match(html, /role="toolbar" aria-label="Sequence paint parameter"/);
  assert.equal(occurrences(html, /data-paint-mode="/g), 8);
  for (const mode of ["pitch", "pull", "air", "rate", "vowel", "voice", "sustain", "rest"]) {
    assert.match(html, new RegExp(`data-paint-mode="${mode}"`));
  }
  assert.match(html, /id="drawModeButton"[^>]*aria-pressed="true"/);
  assert.match(html, /id="scrollModeButton"[^>]*aria-pressed="false"/);
  assert.match(html, /class="jaw-jam-step-inspector"[\s\S]*aria-labelledby="stepInspectorTitle"/);
  assert.match(html, /id="stepActionPluck"[^>]*data-step-action="pluck"/);
  assert.match(html, /id="stepActionSustain"[^>]*data-step-action="sustain"/);
  assert.match(html, /id="stepActionRest"[^>]*data-step-action="rest"/);
  assert.match(html, /id="stepPitch"[^>]*min="27"[^>]*max="53"/);
  assert.match(html, /id="stepPull"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /id="stepAir"[^>]*min="0"[^>]*max="3"/);
  assert.match(html, /id="stepRate"[^>]*min="0\.125"[^>]*max="8"/);
  assert.match(html, /id="selectedStepSummary" aria-live="polite"/);
  assert.match(html, /id="audioError" role="alert" hidden/);
  assert.match(html, /id="liveStatus" aria-live="polite"/);
  assert.match(html, /aria-label="Sequence notation legend"/);
  assert.match(html, /Pluck[\s\S]*new pitch \+ reed strike/);
  assert.match(html, /Sustain[\s\S]*carry pitch \+ reshape mouth/);
  assert.match(html, /Rest[\s\S]*stop reed \+ breath/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="jaw-jam-app\.js"><\/script>/);

  for (const id of REQUIRED_IDS) {
    assert.equal(
      occurrences(html, new RegExp(`\\bid="${escaped(id)}"`, "g")),
      1,
      `${id} must occur exactly once`,
    );
  }

  const laneMarkup = html.match(
    /<div\s+class="jaw-jam-sequence-lane"[\s\S]*?id="sequenceLane"[\s\S]*?<\/div>/,
  )?.[0] ?? "";
  assert.ok(laneMarkup, "sequence lane markup exists");
  assert.match(laneMarkup, />\s*<\/div>$/, "the app, not HTML, owns all step cards");
  const staticClasses = [...html.matchAll(/\bclass="([^"]*)"/g)]
    .flatMap(([, classList]) => classList.trim().split(/\s+/));
  assert.ok(!staticClasses.includes("jaw-jam-step"), "the app, not HTML, owns all step cards");

  const ratioMarkup = html.match(/<select id="breathRatio"[\s\S]*?<\/select>/)?.[0] ?? "";
  for (const value of ["0.3333333333", "0.5", "1", "2", "3"]) {
    assert.match(ratioMarkup, new RegExp(`value="${escaped(value)}"`));
  }
});

test("Jaw Jam app owns compact monophonic cells, one shared inspector, and lane-wide paint gestures", async () => {
  const app = await readFile(new URL("jaw-jam-app.js", root), "utf8");

  for (const className of DYNAMIC_STEP_CLASSES) {
    assert.ok(app.includes(className), `app must build ${className}`);
  }
  for (const stateClass of ["is-pluck", "is-sustain", "is-rest", "is-current", "is-selected"]) {
    assert.ok(app.includes(stateClass), `app must paint ${stateClass}`);
  }

  assert.match(app, /const ACTION_ORDER = Object\.freeze\(\["pluck", "sustain", "rest"\]\)/);
  assert.match(app, /lane\.replaceChildren\(\.\.\.stepViews\.map/);
  assert.match(app, /jawJamResolvedMidi\(pattern, index\)/);
  assert.match(app, /view\.pitchLane\.setAttribute\("aria-disabled"/);
  assert.match(app, /jawJamPulseEnergy\(step\)/);
  assert.match(app, /--pull-level/);
  assert.match(app, /--air-level/);
  assert.match(app, /--pulse-energy/);
  assert.match(app, /Pulse: .*tine pull plus .*breath strength/);

  assert.match(app, /\$\(`stepAction\$\{action\[0\]\.toUpperCase\(\)\}\$\{action\.slice\(1\)\}`\)/);
  for (const id of ["stepVowel", "stepVoice", "stepPitch", "stepPull", "stepAir", "stepRate"]) {
    assert.ok(app.includes(`$("${id}")`), `app must wire the shared ${id} control`);
  }

  for (const mode of ["pitch", "pull", "air", "rate", "vowel", "voice", "sustain", "rest"]) {
    assert.ok(app.includes(`"${mode}"`), `app must support the ${mode} paint brush`);
  }
  assert.match(app, /\[data-paint-mode\]/);
  assert.match(app, /addEventListener\("pointerdown"/);
  assert.match(app, /addEventListener\("pointermove"/);
  assert.match(app, /setPointerCapture\?\./);
  assert.match(app, /getCoalescedEvents\?\./);
  assert.match(app, /lostpointercapture/);
  assert.match(app, /message\.type === "sequence-step"[\s\S]{0,120}&& playing/);
  assert.match(app, /function capturePaintGeometry\(/);
  const paintIndexSource = app.match(/function paintIndexFromClientX\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(paintIndexSource, /getBoundingClientRect/, "paint movement must use gesture-cached geometry");
  assert.match(app, /function flushPaintVisuals\(/);
  assert.match(app, /if \(!finished\.changed\) \{[\s\S]*?updateSelectedStepSummary\(\)/);
  assert.doesNotMatch(app, /function installPitchDrag\(/, "painting must be owned by the full lane, not one captured step");
  assert.doesNotMatch(app, /function createMiniKnob\(/, "per-step knobs were replaced by the selected-step inspector");
  assert.match(app, /drawPerformerStage\(time\)/);
  assert.match(app, /triggerPerformerPluck/);
  assert.match(app, /\$\("performerStep"\)/);
  assert.match(app, /\$\("performerGesture"\)/);
  assert.match(app, /\$\("randomPatternButton"\)\?\.addEventListener\("click", randomizePattern\)/);
  assert.match(app, /\$\("mutatePatternButton"\)\?\.addEventListener\("click", mutatePattern\)/);
  assert.match(app, /\$\("clearPatternButton"\)\?\.addEventListener\("click", clearPattern\)/);
  assert.match(app, /\$\("auditionButton"\)\?\.addEventListener\("click"/);
  assert.match(app, /\$\("panicButton"\)\?\.addEventListener\("click", panic\)/);
  assert.match(app, /\$\("breathRatio"\)\?\.addEventListener\("change"/);
  assert.match(app, /\$\("pluckClockHand"\)[\s\S]*?style\.transform/);
  assert.match(app, /\$\("breathClockHand"\)[\s\S]*?style\.transform/);
});

test("Jaw Jam CSS keeps cells compact while preserving sustain bridges, hard rests, painting, and the performer", async () => {
  const css = await readFile(new URL("jaw-jam.css", root), "utf8");

  assert.match(css, /--jaw-jam-copper:\s*#df9d5a/);
  assert.match(css, /--jaw-jam-cyan:\s*#76dfd3/);
  assert.match(css, /\.jaw-jam-shell\s*\{[\s\S]*?padding:\s*clamp\(22px/);
  assert.match(css, /\.jaw-jam-sequence-scroller\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.jaw-jam-sequence-lane\s*\{[\s\S]*?width:\s*max-content/);
  assert.match(css, /\.jaw-jam-sequence-lane\s*\{[\s\S]*?touch-action:\s*none/);
  assert.match(css, /\.jaw-jam-sequence-lane\.is-scroll-mode\s*\{[\s\S]*?touch-action:\s*pan-x/);
  assert.match(css, /\.jaw-jam-sequence-lane\.is-scroll-mode \.jaw-jam-pitch-lane,[\s\S]*?touch-action:\s*pan-x/);
  assert.match(css, /\.jaw-jam-step\s*\{[\s\S]*?width:\s*clamp\([^;]*84px\);[\s\S]*?min-width:\s*clamp\([^;]*84px\)/);
  const stepRule = css.match(/\.jaw-jam-step\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(stepRule, /width:\s*178px/);
  const stepHeaderRules = [...css.matchAll(/\.jaw-jam-step > header\s*\{([^}]*)\}/g)];
  assert.ok(stepHeaderRules.length >= 1, "compact steps must define a header grid");
  for (const [, rule] of stepHeaderRules) {
    assert.match(
      rule,
      /grid-template-columns:\s*16px minmax\(24px, 1fr\) 16px/,
      "every responsive step-header rule must preserve at least 24px for its action",
    );
  }
  assert.match(css, /grid-template-rows:\s*32px 154px 48px/);
  assert.match(css, /\.jaw-jam-pitch-lane\s*\{[\s\S]*?height:\s*154px/);
  assert.match(css, /\.jaw-jam-step\.is-sustain \.jaw-jam-note-block\s*\{[\s\S]*?left:\s*-4px/);
  assert.match(css, /\.jaw-jam-step\.is-sustain \.jaw-jam-note-block::before\s*\{[\s\S]*?width:\s*4px/);
  assert.match(css, /\.jaw-jam-pulse-meter\s*\{[\s\S]*?conic-gradient/);
  assert.match(css, /\.jaw-jam-pulse-meter::before\s*\{[\s\S]*?--air-level/);
  assert.match(css, /\.jaw-jam-note-pull\s*\{[\s\S]*?--pull-level/);
  assert.match(css, /\.jaw-jam-note-air\s*\{[\s\S]*?--air-level/);
  assert.match(css, /\.jaw-jam-step\.is-rest \.jaw-jam-pitch-lane::after\s*\{[\s\S]*?content:\s*"X"/);
  assert.match(css, /\.jaw-jam-step-inspector\s*\{/);
  assert.match(css, /\.jaw-jam-inspector-actions\s*\{/);
  assert.match(css, /\.jaw-jam-inspector-slider\s*\{/);
  assert.match(css, /\.jaw-jam-performer\s*\{/);
  assert.match(css, /#performerStage\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%/);
  assert.match(css, /\.jaw-jam-step\.is-current/);
  assert.match(css, /\.jaw-jam-step\.is-selected/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.jaw-jam-page button:focus-visible/);
});
