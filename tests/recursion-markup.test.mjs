import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
test("recursion exposes one label-only Fuzzy Donut instrument and finite local seeds", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("recursion.html", root), "utf8"),
    readFile(new URL("recursion.css", root), "utf8"),
  ]);

  assert.match(html, /<body class="recursion-page">/);
  assert.match(
    html,
    /class="tab recursion-tab active"[^>]*aria-current="page">(?:recursion|fuzzy donut)<\/a>/,
  );
  assert.match(html, /<option value="recursion\.html" selected>(?:recursion|fuzzy donut)<\/option>/);
  assert.match(html, /src="recursion-app\.js"/);
  assert.match(html, /href="recursion\.css"/);

  assert.match(html, /<h1[^>]*\bid="stageTitle"[^>]*>Fuzzy Donut<\/h1>/);
  assert.match(html, /<section[^>]*\baria-label="Fuzzy Donut"/);
  assert.match(html, /<aside[^>]*\baria-label="Fuzzy Donut controls"/);
  assert.doesNotMatch(html, /\bdata-study=/);
  assert.doesNotMatch(html, /\bid="studyButtons"/);
  assert.doesNotMatch(html, /\bid="studySelect"/);
  assert.doesNotMatch(html, /\bid="studyCount"/);
  assert.doesNotMatch(html, /\brole="tablist"/);
  assert.doesNotMatch(html, /(?:SYSTEM\s+)?0?1\s*\/\s*0?6/i);
  assert.doesNotMatch(html, /six structural systems/i);
  assert.doesNotMatch(html, /choose (?:one of )?six recursion systems/i);

  const sourceButtons = [...html.matchAll(
    /<button\b[^>]*\bdata-source="([^"]+)"[^>]*>/g,
  )].map((match) => match[1]);
  assert.deepEqual(sourceButtons, ["noise", "impulse", "mic", "file"]);
  assert.match(html, /id="captureLabel">Capture</);
  assert.match(html, /id="captureHint">4 S · NO MONITOR</);
  assert.match(html, /id="fileHint">LOCAL · NO UPLOAD</);

  for (const id of [
    "listenButton",
    "stepButton",
    "restartButton",
    "intensity",
    "intensityOut",
    "accumulateButton",
    "overwhelmButton",
    "liveTreeControls",
    "renderedControls",
    "liveTimbre",
    "livePitch",
    "liveRhythm",
    "livePhrase",
    "liveTwist",
    "liveMemory",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`), `missing #${id}`);
  }
  assert.match(html, /<small>Turn<\/small>/);
  assert.match(html, /<b id="listenLabel">Play<\/b>/);
  assert.match(html, /class="recursion-timeline" aria-label="Cycle"/);

  const liveTree = html.match(
    /<fieldset\b[^>]*\bid="liveTreeControls"[^>]*>([\s\S]*?)<\/fieldset>/,
  );
  assert.ok(liveTree, "missing the live Fuzzy Donut parameter field");
  assert.deepEqual(
    [...liveTree[1].matchAll(/<input\b[^>]*\bid="(live[^"]+)"[^>]*>/g)]
      .map((match) => match[1]),
    [
      "liveTimbre",
      "livePitch",
      "liveRhythm",
      "livePhrase",
      "liveTwist",
      "liveMemory",
    ],
  );
  for (const axis of ["Timbre", "Pitch", "Rhythm", "Phrase", "Twist", "Memory"]) {
    assert.match(
      liveTree[1],
      new RegExp(`<b[^>]*>${axis}</b>`),
      `missing visible ${axis} label`,
    );
  }

  assert.match(
    html,
    /<details class="recursion-rendered-controls" id="renderedControls">[\s\S]*?<summary>[\s\S]*?Structure[\s\S]*?<\/summary>[\s\S]*?class="recursion-rendered-body"/,
  );
  assert.match(html, /<b>Pressure<\/b>/);
  assert.match(html, /<b>Ancestors<\/b>/);
  assert.match(html, /<b>Maximum<\/b>/);
  assert.match(css, /\.recursion-live-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2/);
  assert.match(css, /\.recursion-live-grid b\s*\{[\s\S]*font-size:\s*9px/);
  assert.match(css, /\.recursion-live-grid input\[type="range"\]\s*\{[\s\S]*height:\s*40px/);

  const details = [...html.matchAll(/<details\b([^>]*)>/g)];
  assert.equal(details.length, 1);
  assert.deepEqual(
    details.map((match) => match[1].match(/\bid="([^"]+)"/)?.[1]),
    ["renderedControls"],
  );
  assert.ok(
    details.every((match) => !/\bopen(?:\s|=|$)/.test(match[1])),
    "structural controls should initialize collapsed",
  );

  assert.match(css, /\.recursion-density-actions\s*\{/);
});

test("recursion markup keeps ids unique and range controls labelled", async () => {
  const html = await readFile(new URL("recursion.html", root), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);

  for (const id of [
    "level",
    "depth",
    "pace",
    "transform",
    "intensity",
    "liveTimbre",
    "livePitch",
    "liveRhythm",
    "livePhrase",
    "liveTwist",
    "liveMemory",
  ]) {
    assert.match(html, new RegExp(`<label[^>]*\\bfor="${id}"`));
    assert.match(html, new RegExp(`<input[^>]*\\bid="${id}"`));
  }
  assert.match(html, /id="stage"[\s\S]*aria-describedby="liveStatus"/);
  assert.match(html, /id="liveStatus" aria-live="polite"/);
  assert.doesNotMatch(html, /\bid="canvasInstructions"/);
});

test("recursion offers three labelled geometry projections beside the canvas", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("recursion.html", root), "utf8"),
    readFile(new URL("recursion-app.js", root), "utf8"),
  ]);
  const group = html.match(
    /<[^>]+\bid="geometryViews"[^>]*>([\s\S]*?)<\/(?:div|nav|section)>/,
  );
  assert.ok(group, "missing #geometryViews");
  assert.match(group[0], /\brole="group"/);
  assert.match(group[0], /\baria-label="Geometry (?:view|projection)"/i);

  const buttons = [...group[1].matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .map((match) => ({
      attributes: match[1],
      label: match[2].replace(/<[^>]*>/g, "").trim(),
    }));
  assert.deepEqual(
    buttons.map(({ attributes }) => attributes.match(/\bid="([^"]+)"/)?.[1]),
    ["geometryOrbit", "geometryStack", "geometryCausality"],
  );
  assert.deepEqual(
    buttons.map(({ attributes }) => (
      attributes.match(/\bdata-geometry(?:-view)?="([^"]+)"/)?.[1]
    )),
    ["orbit", "stack", "causality"],
  );
  assert.deepEqual(
    buttons.slice(0, 2).map(({ label }) => label.toLowerCase()),
    ["orbit", "stack"],
  );
  assert.match(buttons[2].label, /^causal(?:ity)?$/i);
  assert.ok(buttons.every(({ attributes }) => /\btype="button"/.test(attributes)));
  assert.match(buttons[0].attributes, /\baria-pressed="true"/);
  assert.ok(buttons.slice(1).every(({ attributes }) => (
    /\baria-pressed="false"/.test(attributes)
  )));
  for (const geometryFunction of [
    "geometryTrace",
    "torusPoint",
    "stackPoint",
    "causalCurve",
  ]) {
    const calls = [...app.matchAll(new RegExp(`\\b${geometryFunction}\\s*\\(`, "g"))];
    assert.ok(calls.length > 0, `${geometryFunction} must drive the canvas, not just be imported`);
  }
  assert.match(
    app,
    /\$\(\s*["']geometryViews["']\s*\)\.addEventListener\s*\(\s*["']click["']/,
  );
});
