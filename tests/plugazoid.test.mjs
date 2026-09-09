import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PLUGAZOID_DEFAULTS,
  PLUGAZOID_STARTER_WAMS,
  PLUGAZOID_WAM_ENDPOINTS,
  classifyPluginArtifact,
  decibelsToGain,
  meterPercentage,
  outputLevelToGain,
  prepareWamCatalog,
  resolveWamModuleUrl,
  sanitizePlugazoidSettings,
} from "../src/plugazoid.js";

const PAGE_URL = new URL("../plugazoid.html", import.meta.url);
const ENTRY_URL = new URL("../plugazoid-app.js", import.meta.url);
const HOST_URL = new URL("../src/plugazoid-host.js", import.meta.url);
const BUILD_SCRIPT_URL = new URL("../scripts/build-site.sh", import.meta.url);

test("Plugazoid pins the official WAM2 endpoints and three useful starter effects", () => {
  assert.match(PLUGAZOID_WAM_ENDPOINTS.catalog, /^https:\/\/www\.webaudiomodules\.com\//);
  assert.match(PLUGAZOID_WAM_ENDPOINTS.plugins, /^https:\/\/www\.webaudiomodules\.com\//);
  assert.match(PLUGAZOID_WAM_ENDPOINTS.sdk, /2\.0\.0-alpha\.6\/src\/initializeWamHost\.js$/);
  assert.deepEqual(
    PLUGAZOID_STARTER_WAMS.map(({ identifier }) => identifier),
    [
      "com.sequencerParty.simpleDistortion",
      "com.sequencerParty.simpleDelay",
      "com.sequencerParty.simpleEQ",
    ],
  );
});

test("catalog preparation keeps same-base effects, deduplicates IDs, and prioritizes starters", () => {
  const prepared = prepareWamCatalog([
    {
      identifier: "org.example.instrument",
      name: "Instrument",
      vendor: "Example",
      category: ["Instrument"],
      path: "example/instrument/index.js",
    },
    {
      identifier: "org.example.videoEffect",
      name: "Video Effect",
      vendor: "Example",
      category: ["Video", "Effect"],
      path: "example/video/index.js",
    },
    PLUGAZOID_STARTER_WAMS[1],
    PLUGAZOID_STARTER_WAMS[0],
    {
      ...PLUGAZOID_STARTER_WAMS[0],
      name: "Duplicate",
    },
    {
      identifier: "org.evil.escape",
      name: "Escape",
      vendor: "Unknown",
      category: ["Effect"],
      path: "https://evil.example/plugin.js",
    },
  ]);

  assert.equal(prepared.totalCount, 4);
  assert.equal(prepared.effectCount, 2);
  assert.deepEqual(
    prepared.effects.map(({ identifier }) => identifier),
    ["com.sequencerParty.simpleDistortion", "com.sequencerParty.simpleDelay"],
  );
  assert.equal(prepared.effects[0].moduleUrl, PLUGAZOID_WAM_ENDPOINTS.plugins + "burns-audio/distortion/index.js");
  assert.ok(Object.isFrozen(prepared));
  assert.ok(Object.isFrozen(prepared.effects));
  assert.ok(Object.isFrozen(prepared.effects[0]));
});

test("WAM URL resolution supports a self-hosted base but rejects escapes and foreign origins", () => {
  assert.equal(
    resolveWamModuleUrl("gain/index.js", "http://127.0.0.1:3435/wams/"),
    "http://127.0.0.1:3435/wams/gain/index.js",
  );
  assert.equal(resolveWamModuleUrl("../escape.js"), null);
  assert.equal(resolveWamModuleUrl("https://evil.example/plugin.js"), null);
  assert.equal(resolveWamModuleUrl("gain/index.js#mutable"), null);
  assert.equal(resolveWamModuleUrl("", "file:///tmp/wams/"), null);
});

test("settings reject hostile values and stay within finite output limits", () => {
  const safe = sanitizePlugazoidSettings({
    inputTrimDb: -999,
    outputLevel: Infinity,
    bypassed: "yes",
  });
  assert.deepEqual(safe, {
    ...PLUGAZOID_DEFAULTS,
    inputTrimDb: -18,
    bypassed: true,
  });
  assert.ok(Object.isFrozen(safe));
  assert.ok(Number.isFinite(decibelsToGain(Number.NaN)));
  assert.equal(outputLevelToGain(0), 0);
  assert.ok(outputLevelToGain(0.82) < 1);
  assert.equal(meterPercentage(0), 0);
  assert.ok(meterPercentage(0.1) > meterPercentage(0.01));
});

test("packaging inspection never mistakes native bundles or raw WASM for WAM2 modules", () => {
  for (const [filename, format] of [
    ["glue.vst3", "VST3"],
    ["voices.CLAP", "CLAP"],
    ["chorus.component", "Audio Unit"],
  ]) {
    const result = classifyPluginArtifact(filename);
    assert.equal(result.kind, "native-bundle");
    assert.equal(result.format, format);
    assert.equal(result.browserRunnable, false);
  }
  assert.equal(classifyPluginArtifact("processor.wasm").kind, "wasm-module");
  assert.equal(classifyPluginArtifact("mystery.exe").kind, "unknown");
});

test("the page exposes a truthful remote WAM2 flow and keeps Audio explicit", async () => {
  const page = await readFile(PAGE_URL, "utf8");
  assert.match(page, /id="audioButton"/);
  assert.match(page, /id="micButton"/);
  assert.match(page, /id="testToneButton"/);
  assert.match(page, /Use headphones/);
  assert.match(page, /WAM2 catalogue/);
  assert.match(page, /id="wamSelect"/);
  assert.match(page, /id="loadWamButton"/);
  assert.match(page, /id="wamGuiHost"/);
  assert.match(page, /id="bypassButton"[^>]*disabled/);
  assert.match(page, /What this proves/);
  assert.match(page, /real third-party WAM2 module/);
  assert.match(page, /does not load installed VST3, CLAP, or Audio Unit binaries/);
  assert.match(page, /production rack should pin versions and self-host/);
  assert.match(page, /remote WAM is executable JavaScript\/WebAssembly/);
  assert.doesNotMatch(page, /data-format="vst3"/);
  assert.doesNotMatch(page, /Port Drive/);
  assert.match(page, /src="plugazoid-app\.js"/);
});

test("the controller initializes a WAM host, imports a selected module, mounts its GUI, and owns teardown", async () => {
  const entry = await readFile(ENTRY_URL, "utf8");
  const host = await readFile(HOST_URL, "utf8");
  const buildScript = await readFile(BUILD_SCRIPT_URL, "utf8");
  assert.match(entry, /src\/plugazoid-host\.js/);
  assert.match(host, /import\(PLUGAZOID_WAM_ENDPOINTS\.sdk\)/);
  assert.match(host, /import\(entry\.moduleUrl\)/);
  assert.match(host, /WamConstructor\.createInstance\(groupId, context\)/);
  assert.match(host, /descriptor\.hasAudioInput/);
  assert.match(host, /descriptor\.hasAudioOutput/);
  assert.match(host, /instance\.createGui/);
  assert.match(host, /audio\.inputAnalyser\.connect\(node\)/);
  assert.match(host, /node\.connect\(audio\.wetGain\)/);
  assert.match(host, /record\.node\?\.destroy/);
  assert.match(host, /track\.stop\(\)/);
  assert.doesNotMatch(host, /plugazoid-processor/);
  assert.equal(
    buildScript.match(/src\/plugazoid-host\.js/g)?.length,
    2,
    "the WAM host must be copied and required in release builds",
  );
});
