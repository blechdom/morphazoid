import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const SYSTEM_IDS = [
  "ouroboros-tape",
  "spectral-mobius",
  "filter-hydra",
  "cantor-delay",
  "convolution-maw",
  "phase-labyrinth",
];

test("recursion exposes exactly six structural systems and finite local seed sources", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("recursion.html", root), "utf8"),
    readFile(new URL("recursion.css", root), "utf8"),
  ]);

  assert.match(html, /<body class="recursion-page">/);
  assert.match(
    html,
    /class="tab recursion-tab active"[^>]*aria-current="page">recursion<\/a>/,
  );
  assert.match(html, /<option value="recursion\.html" selected>recursion<\/option>/);
  assert.match(html, /src="recursion-app\.js"/);
  assert.match(html, /href="recursion\.css"/);

  const systemButtons = [...html.matchAll(
    /<button\b[^>]*\bdata-study="([^"]+)"[^>]*>/g,
  )].map((match) => match[1]);
  const systemOptions = [...html.matchAll(
    /<option\b[^>]*\bvalue="([^"]+)"[^>]*>[^<]*(?:Ouroboros|Spectral|Hydra|Cantor|Convolution|Phase)[^<]*<\/option>/g,
  )].map((match) => match[1]);
  assert.deepEqual(systemButtons, SYSTEM_IDS);
  assert.deepEqual(systemOptions, SYSTEM_IDS);
  assert.equal(new Set(systemButtons).size, 6);
  assert.match(html, /id="stageIndex">SYSTEM 01 \/ 06</);
  assert.match(html, /id="studyCount">01 \/ 06</);
  assert.match(html, /aria-label="Six recursion systems"/);

  const sourceButtons = [...html.matchAll(
    /<button\b[^>]*\bdata-source="([^"]+)"[^>]*>/g,
  )].map((match) => match[1]);
  assert.deepEqual(sourceButtons, ["noise", "impulse", "mic", "file"]);
  assert.match(html, /id="captureLabel">Capture four seconds</);
  assert.match(html, /id="captureHint">captured · never live-monitored</);
  assert.match(html, /id="fileHint">decoded locally · never uploaded</);
  assert.match(html, /Uploaded audio is decoded only in this browser and is never sent anywhere/i);
  assert.match(html, /finite graph · RMS normalized · local only/i);

  for (const id of [
    "listenButton",
    "stepButton",
    "restartButton",
    "intensity",
    "intensityOut",
    "accumulateButton",
    "overwhelmButton",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`), `missing #${id}`);
  }
  assert.match(html, /<small>Step<\/small>/);
  assert.match(html, /<b>Structural pressure<\/b>/);
  assert.match(html, /<b>Ancestors remain<\/b>/);
  assert.match(html, /<b>Open event horizon<\/b>/);
  assert.match(html, /maximum structure, bounded level/i);
  assert.match(html, /Pressure changes density[\s\S]*not master loudness/i);

  const details = [...html.matchAll(/<details\b([^>]*)>/g)];
  assert.equal(details.length, 2);
  assert.deepEqual(
    details.map((match) => match[1].match(/\bid="([^"]+)"/)?.[1]),
    ["howSection", "safetySection"],
  );
  assert.ok(
    details.every((match) => !/\bopen(?:\s|=|$)/.test(match[1])),
    "explanatory details should initialize collapsed",
  );

  assert.match(css, /@media\s*\(max-width:\s*520px\)\s*\{[\s\S]*?\.recursion-study-list\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)\s*\{[\s\S]*?\.recursion-study-select\s*\{[\s\S]*?display:\s*block/);
  assert.match(css, /\.recursion-density-actions\s*\{/);
});

test("recursion markup keeps ids unique and range controls labelled", async () => {
  const html = await readFile(new URL("recursion.html", root), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);

  for (const id of ["level", "depth", "pace", "transform", "intensity"]) {
    assert.match(html, new RegExp(`<label[^>]*\\bfor="${id}"`));
    assert.match(html, new RegExp(`<input[^>]*\\bid="${id}"`));
  }
  assert.match(html, /id="stage"[\s\S]*aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /id="liveStatus" aria-live="polite"/);
});
