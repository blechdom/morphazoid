import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ANIMALS } from "../src/syrinx.js";

const root = new URL("../", import.meta.url);

function openingTag(html, id) {
  const tag = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] ?? "";
  assert.ok(tag, `Syrinx markup is missing #${id}`);
  return tag;
}

function optionValues(html, selectId) {
  const select = html.match(
    new RegExp(`<select\\b[^>]*\\bid="${selectId}"[^>]*>([\\s\\S]*?)<\\/select>`),
  )?.[1] ?? "";
  assert.ok(select, `Syrinx markup is missing the #${selectId} options`);
  return [...select.matchAll(/<option\b[^>]*\bvalue="([^"]+)"[^>]*>/g)]
    .map((match) => match[1]);
}

test("Syrinx exposes a complete, accessible animal-voice instrument page", async () => {
  const [html, css, app, core, processor, sourceModels] = await Promise.all([
    readFile(new URL("syrinx.html", root), "utf8"),
    readFile(new URL("syrinx.css", root), "utf8"),
    readFile(new URL("syrinx-app.js", root), "utf8"),
    readFile(new URL("src/syrinx.js", root), "utf8"),
    readFile(new URL("src/syrinx-processor.js", root), "utf8"),
    readFile(new URL("src/syrinx-source-models.js", root), "utf8"),
  ]);

  assert.match(html, /<title>[^<]*Syrinx[^<]*<\/title>/i);
  assert.match(html, /<body\b[^>]*class="[^"]*syrinx-page[^"]*"/);
  assert.match(html, /<main\b[^>]*\bid="syrinx"[^>]*>/);
  assert.match(html, /href="style\.css"/);
  assert.match(html, /href="syrinx\.css\?v=syrinx-ui-[^"]+"/);
  assert.match(html, /<script\s+type="module"\s+src="nav\.js\?v=syrinx-ui-[^"]+"><\/script>/);
  assert.match(html, /<script\s+type="module"\s+src="syrinx-app\.js\?v=syrinx-ui-[^"]+"><\/script>/);
  assert.match(html, /<a class="wordmark" href="\.\/" aria-label="Morphazoid home">/);

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "every Syrinx id must be unique");

  for (const id of [
    "audioButton",
    "audioState",
    "level",
    "levelOut",
    "animalSelect",
    "callSelect",
    "modelReadout",
    "stageWrap",
    "stage",
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
    "loopButton",
    "audioError",
    "liveStatus",
  ]) openingTag(html, id);

  const transportId = html.includes('id="playButton"')
    ? "playButton"
    : html.includes('id="transportButton"')
      ? "transportButton"
      : "triggerButton";
  const transport = openingTag(html, transportId);
  assert.match(transport, /\bdata-primary-transport(?:\s|=|>)/);
  assert.match(transport, /\baria-pressed="false"/);
  assert.match(transport, /\btype="button"/);
  if (transportId === "triggerButton") {
    assert.match(
      app,
      /morphazoid:midi-input/,
      "a nonstandard trigger id needs an explicit generic-MIDI event handler",
    );
  }

  assert.match(openingTag(html, "audioButton"), /\baria-pressed="false"/);
  assert.match(openingTag(html, "level"), /\btype="range"/);
  assert.match(openingTag(html, "animalSelect"), /\baria-label=|\baria-labelledby=/);
  assert.match(openingTag(html, "callSelect"), /\baria-label=|\baria-labelledby=/);
  assert.deepEqual(optionValues(html, "animalSelect"), Object.keys(ANIMALS));
  assert.deepEqual(optionValues(html, "callSelect"), ANIMALS.raven.callIds);
  assert.equal(
    new Set(optionValues(html, "animalSelect")).size,
    optionValues(html, "animalSelect").length,
    "animal options must be unique",
  );

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
  ]) {
    assert.match(openingTag(html, id), /\btype="range"/);
  }

  assert.match(app, /from\s+["']\.\/src\/syrinx\.js\?v=syrinx-ui-[^"']+["']/);
  assert.match(app, /src\/syrinx-processor\.js/);
  assert.match(app, /new\s+AudioWorkletNode\s*\(/);
  assert.match(app, /connectAudioOutput/);
  assert.match(app, /unlockAudioContext/);
  assert.match(app, /animalSelect[\s\S]*addEventListener\s*\(\s*["']change["']/);
  assert.match(app, /callSelect[\s\S]*addEventListener\s*\(\s*["']change["']/);

  assert.match(core, /ANIMALS/);
  assert.match(core, /CALL_GESTURES/);
  assert.match(core, /sanitizeSyrinxState/);
  assert.match(sourceModels, /SyrinxSourceEngine/);
  assert.match(processor, /registerProcessor\s*\(/);
  assert.match(processor, /syrinx/i);

  assert.match(css, /\.syrinx-page/);
  assert.match(css, /@media\s*\(/);
  assert.match(css, /prefers-reduced-motion/);
});

test("Syrinx is discoverable through Morphazoid navigation and catalogue data", async () => {
  const [navigation, catalogue, buildScript] = await Promise.all([
    readFile(new URL("nav.js", root), "utf8"),
    readFile(new URL("src/instrument-catalog.js", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
  ]);

  assert.match(
    navigation,
    /id:\s*["']syrinx["'][\s\S]*?label:\s*["']Syrinx["'][\s\S]*?href:\s*["']syrinx\.html["']/,
  );
  assert.match(catalogue, /\bsyrinx:\s*define\s*\(/);
  for (const runtimeFile of [
    "syrinx.html",
    "syrinx.css",
    "syrinx-app.js",
    "src/syrinx.js",
    "src/syrinx-processor.js",
    "src/syrinx-source-models.js",
  ]) {
    assert.match(
      buildScript,
      new RegExp(runtimeFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${runtimeFile} must enter uncommitted release builds`,
    );
  }
});
