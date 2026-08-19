import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("L-system Delay exposes live recursion, current settings, safety, and an echo-tree stage", async () => {
  const [html, legacyRedirect, app, css] = await Promise.all([
    readFile(new URL("l-mic.html", root), "utf8"),
    readFile(new URL("micmic.html", root), "utf8"),
    readFile(new URL("micmic-app.js", root), "utf8"),
    readFile(new URL("micmic.css", root), "utf8"),
  ]);

  assert.match(html, /<title>L-system Delay — Morphazoid<\/title>/);
  assert.match(html, /<link rel="canonical" href="l-mic\.html"/);
  assert.match(html, /<body class="micmic-page">/);
  assert.match(html, /class="tab micmic-tab active"[^>]*href="l-mic\.html"[^>]*aria-current="page">L-system Delay/);
  assert.match(html, /<option value="l-mic\.html" selected>L-system Delay<\/option>/);
  assert.doesNotMatch(html, /mic\(mic\)/i);
  assert.match(legacyRedirect, /http-equiv="refresh" content="0; url=l-mic\.html"/);
  assert.match(legacyRedirect, /<link rel="canonical" href="l-mic\.html"/);
  assert.match(
    legacyRedirect,
    /window\.location\.replace\(`l-mic\.html\$\{window\.location\.search\}\$\{window\.location\.hash\}`\)/,
  );
  assert.match(html, /<span class="audio-copy"><b>Audio<\/b>/);
  assert.match(html, /src="micmic-app\.js(?:\?[^"]+)?"/);
  assert.match(html, /href="micmic\.css"/);
  for (const id of [
    "stage", "seedControl", "seedMicButton", "panicButton", "audioButton", "micButton",
    "freezeButton", "inputMeterBar", "inputTrim", "depth", "interval",
    "mutation", "wet", "dry", "spread", "settingsSection", "currentSettingsSummary",
    "generationPresetGrid", "presetSummary", "generations", "timeRatio", "generationAngle", "generationAsymmetry",
    "generationPitchScale", "generationTimingReadout", "generationPitchReadout", "resetGenerationRules",
    "generationPresetDescription", "generationCapacityInline", "generationCountReadout", "pitchDetail",
    "pitchDetailStatus", "pruningBias", "pruningBiasOut", "treeDescription",
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  for (const section of ["presetSection", "listenSection", "recursionSection", "mixSection", "settingsSection"]) {
    assert.match(html, new RegExp(`<details[^>]*id="${section}"`));
  }
  assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(html, /LIVE RECURSIVE MICROPHONE|Speak once\. Let every echo become the parent of another\.|<strong>mic/);
  assert.doesNotMatch(html, /Capture|recordButton|recordingBadge|downloadTake|clearTake/);
  assert.match(
    html,
    /<p class="micmic-headphone-warning">\s*<strong>Use headphones\.<\/strong> Speakers can feed the room back into the microphone before the digital recursion does\.\s*<\/p>/,
  );
  const mastheadMarkup = html.slice(
    html.indexOf('<header class="masthead">'),
    html.indexOf("</header>"),
  );
  assert.ok(
    mastheadMarkup.indexOf("micmic-headphone-warning")
      < mastheadMarkup.indexOf('class="audio-strip"'),
    "headphone warning should sit in the menu bar beside the audio controls",
  );
  assert.doesNotMatch(
    html.slice(html.indexOf('<aside class="panel"'), html.indexOf("</aside>")),
    /Use headphones/,
  );
  assert.match(html, /<b id="micButtonLabel">Start input<\/b>/);
  assert.match(html, /<b id="freezeLabel">Stop audio<\/b>/);
  assert.doesNotMatch(html, /Press Escape for an immediate panic stop|canvasInstructions/);
  assert.match(html, /id="generations"[^>]*min="1"[^>]*max="13"/);
  assert.match(html, /<h2 class="group-title">Presets<\/h2>/);
  assert.match(html, /id="generationPresetGrid"[^>]*role="group"/);
  assert.match(html, /data-generation-preset="pythagorean"[^>]*aria-pressed="true"/);
  for (const plantName of [
    "Bamboo Shoot", "Silver Birch", "Fern Frond", "Weeping Willow", "Midnight Ivy",
    "Mangrove Roots", "Giant Sequoia", "Ghost Orchid", "Kelp Forest", "Moss Carpet",
    "Blackberry Bramble", "Venus Flytrap",
  ]) {
    assert.match(html, new RegExp(`>${plantName}<`), `missing ${plantName} preset`);
  }
  assert.equal((html.match(/data-generation-preset="[^"]+"/g) ?? []).length, 16);
  for (const [band, count] of [
    ["robotic", 4],
    ["rhythmic", 4],
    ["spacious", 3],
    ["smooth", 5],
  ]) {
    assert.equal(
      (html.match(new RegExp(`data-preset-band="${band}"`, "g")) ?? []).length,
      count,
      `expected ${count} ${band} presets`,
    );
  }
  assert.match(html, /ROBOTIC · 1 ms fold/);
  assert.match(html, /SMOOTH · 3 s fold/);
  assert.ok(
    html.indexOf('data-generation-preset="moss"')
      < html.indexOf('data-generation-preset="sequoia"'),
    "presets should read from the tightest fold to the longest",
  );
  assert.match(html, /id="generations"[^>]*value="13"/);
  assert.doesNotMatch(html, /Fork density|id="branching"|id="branchingOut"/);
  assert.doesNotMatch(html, /Recursive bounce|branchRendererToggle|branchRendererState/);
  assert.match(html, /48 of 1,022 branches ready · breadth first pruning · device-adjusted/);
  assert.doesNotMatch(html, /AUTO CAP|AUTO CHECK|underrun rollback|selected branches/);
  assert.match(html, /Pruning strategy/);
  assert.match(html, /Breadth first[\s\S]*Balanced[\s\S]*Depth first/);
  assert.match(html, /id="pruningBias"[^>]*min="0"[^>]*max="1"[^>]*value="0"/);
  assert.match(html, /id="pruningBias"[^>]*aria-valuetext="breadth first"/);
  assert.match(html, /id="depth"[^>]*max="0\.96"/);
  assert.match(html, /id="interval"[^>]*min="0"[^>]*max="1000"[^>]*step="1"/);
  assert.match(html, /id="timeRatio"[^>]*min="0\.2"[^>]*max="2"[^>]*step="0\.01"/);
  assert.match(html, /id="generationCapacityInline"/);
  assert.doesNotMatch(html, /id="generationCapacityInline"[^>]*aria-live=/);
  assert.match(html, /id="mutation"[^>]*value="0"/);
  assert.match(html, /<label[^>]*for="pitchDetail"/);
  assert.match(html, /<span class="field-label">Pitch detail<\/span>/);
  assert.match(html, /<select id="pitchDetail"[^>]*aria-describedby="pitchDetailStatus"/);
  assert.match(html, /<option value="3">[^<]*3[^<]*<\/option>/);
  for (const value of ["7", "10", "16"]) {
    assert.match(
      html,
      new RegExp(`<option value="${value}">[^<]*${value}[^<]*<\\/option>`),
      `missing visible ${value}-lane Pitch Detail option`,
    );
  }
  assert.match(html, /<option value="24" selected>Maximum · Economy granular \(default\)<\/option>/);
  assert.match(html, /id="pitchDetailStatus"[^>]*>Maximum economy · 0 active shifted pitches · exact unison<\/small>/);
  assert.doesNotMatch(html, /id="generationPreset"[\s>]|pitchDetailHelp/);
  assert.doesNotMatch(html, /Stop audio to change Pitch Detail\. Economy uses Graph Delay/);
  assert.doesNotMatch(html, /Starting topology|id="presetButtons"|data-preset=/);
  assert.doesNotMatch(html, /id="stateMetric"|id="depthMetric"|id="outputMetric"/);
  assert.doesNotMatch(html, /The interval is inherited and multiplied once per generation/);
  assert.doesNotMatch(html, /The original voice starts muted|class="control-note"/);
  assert.doesNotMatch(html, /generation-shape-preview|generationShape/);
  for (const title of ["Branching", "Timing", "Pitch", "Variation"]) {
    assert.match(html, new RegExp(`class="parameter-cluster-title"[^>]*>${title}<`));
  }
  const recursionMarkup = html.slice(
    html.indexOf('id="recursionSection"'),
    html.indexOf('id="mixSection"'),
  );
  const groupedControlOrder = [
    "generations", "pruningBias", "depth",
    "interval", "timeRatio",
    "pitchDetail", "generationAngle", "generationPitchScale",
    "generationAsymmetry", "mutation",
  ];
  let previousControlPosition = -1;
  for (const id of groupedControlOrder) {
    const position = recursionMarkup.indexOf(`id="${id}"`);
    assert.ok(position > previousControlPosition, `#${id} should follow its parameter group`);
    previousControlPosition = position;
  }
  for (const id of ["generationCountReadout", "generationTimingReadout", "generationPitchReadout"]) {
    assert.doesNotMatch(recursionMarkup, new RegExp(`id="${id}"`));
  }
  const settingsMarkup = html.slice(
    html.indexOf('id="settingsSection"'),
    html.indexOf("</aside>"),
  );
  assert.ok(
    html.indexOf('class="reset-all-row"') < html.indexOf('id="settingsSection"'),
    "Current settings boxes should be the final panel section",
  );
  assert.match(settingsMarkup, /<h2 class="group-title">Current settings<\/h2>/);
  assert.match(settingsMarkup, /<dl class="current-settings-readout">/);
  assert.ok(
    settingsMarkup.indexOf('id="generationCountReadout"')
      < settingsMarkup.indexOf('id="generationTimingReadout"')
      && settingsMarkup.indexOf('id="generationTimingReadout"')
      < settingsMarkup.indexOf('id="generationPitchReadout"'),
  );
  assert.match(settingsMarkup, /Pitch turns · octave percentage/);
  assert.match(settingsMarkup, /−45° → −25% octave · \+45° → \+25% octave/);
  assert.doesNotMatch(settingsMarkup, /\b(?:Hz|st)\b/);
  assert.match(html, /Angle → octave span/);
  assert.match(html, /id="generationPitchScaleOut"[^>]*>100% \/ 180°<\/output>/);

  assert.match(app, /getUserMedia/);
  assert.match(app, /echoCancellation:\s*\{ ideal: false \}/);
  assert.match(app, /createDelay\(6\)/);
  assert.match(app, /micmic-generation-processor/);
  assert.match(app, /generationVoiceSpecs/);
  assert.match(app, /feedbackAA/);
  assert.match(app, /feedbackAB/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /makeSoftClipCurve/);
  assert.match(app, /makeCeilingCurve/);
  assert.doesNotMatch(app, /MediaRecorder|createMediaStreamDestination|recorderDestination/);
  assert.match(app, /function panic/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /function drawVibratingBranch/);
  assert.match(app, /branchEnvelopeAt\(delayedTime\)/);
  assert.match(app, /function stageGenerationLayout/);
  assert.match(app, /ENVELOPE_HISTORY_SECONDS = 40/);
  assert.match(app, /Math\.exp\(-elapsed \/ 0\.16\)/);
  assert.match(app, /function stageGeometry/);
  assert.match(app, /globalThis\.Path2D/);
  assert.doesNotMatch(app, /MAX_ENVELOPE_SAMPLES|envelopeHistory\.splice/);
  assert.doesNotMatch(app, /capsulePath|drawCapsule|generationShape/);
  assert.doesNotMatch(app, /localStorage|sessionStorage/);

  assert.match(css, /\.micmic-page\s*\{/);
  assert.match(css, /\.fracta-seed-control/);
  assert.match(css, /#seedMicButton/);
  assert.match(css, /\.fracta-panic/);
  assert.match(css, /\.recursion-parameter-cluster/);
  assert.match(css, /\.parameter-cluster-title/);
  assert.match(css, /\.growth-preset-description/);
  assert.match(css, /\.micmic-preset-grid/);
  assert.match(css, /\.micmic-headphone-warning/);
  for (const band of ["robotic", "rhythmic", "spacious", "smooth"]) {
    assert.match(css, new RegExp(`data-preset-band="${band}"`));
  }
  assert.match(css, /\.current-settings-readout/);
  assert.doesNotMatch(css, /\.fracta-record-button|\.fracta-recording-badge|\.fracta-take/);
  assert.doesNotMatch(css, /\.branch-renderer-toggle|\.branch-toggle-track/);
  assert.doesNotMatch(css, /\.generation-shape-preview|#generationShape/);
  assert.match(css, /@media \(max-width: 650px\)/);
});

test("L-system Delay markup has unique ids and labelled controls", async () => {
  const html = await readFile(new URL("l-mic.html", root), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["level", "inputTrim", "generations", "pruningBias", "depth", "interval", "timeRatio", "generationAngle", "generationAsymmetry", "generationPitchScale", "mutation", "wet", "dry", "spread"]) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`));
    assert.match(html, new RegExp(`<input id="${id}"`));
  }
  assert.match(html, /<label[^>]*for="pitchDetail"/);
  assert.match(html, /<select id="pitchDetail"/);
  assert.match(html, /id="stage"[\s\S]*?role="img"[\s\S]*?aria-describedby="treeDescription liveStatus"/);
  assert.doesNotMatch(html, /id="stage"[^>]*tabindex=/);
  assert.match(html, /data-reset-all>Reset all parameters<\/button>/);
});
