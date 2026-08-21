import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { VOCALZOID_OPEN_BANKS } from "../src/vocalzoid-open-banks.js";

const ROOT = new URL("../", import.meta.url);
const ODDVOICES_REVISION = "33a248af8df88edf5166593bf36b7e24e7bc1f94";

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? "";
}

function idsIn(markup) {
  return [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertOrdered(source, ...needles) {
  let cursor = 0;
  for (const needle of needles) {
    const index = source.indexOf(needle, cursor);
    assert.notEqual(index, -1, `expected ${JSON.stringify(needle)} after offset ${cursor}`);
    cursor = index + needle.length;
  }
}

function riffWaveDuration(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE");

  let byteRate = 0;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunk = bytes.toString("ascii", offset, offset + 4);
    const chunkBytes = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8;
    assert.ok(payload + chunkBytes <= bytes.length, `${chunk} chunk exceeds the WAV file`);
    if (chunk === "fmt ") {
      assert.ok(chunkBytes >= 16, "WAV fmt chunk must contain a byte rate");
      byteRate = bytes.readUInt32LE(payload + 8);
    } else if (chunk === "data") {
      dataBytes += chunkBytes;
    }
    offset = payload + chunkBytes + (chunkBytes % 2);
  }

  assert.ok(byteRate > 0, "WAV byte rate must be positive");
  assert.ok(dataBytes > 0, "WAV must contain audio data");
  return dataBytes / byteRate;
}

test("Vocalzoid page wires every control, module, and local asset", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("vocalzoid.html", ROOT), "utf8"),
    readFile(new URL("vocalzoid-app.js", ROOT), "utf8"),
  ]);

  assert.match(html, /<body\b[^>]*class="[^"]*\bvocalzoid-page\b[^"]*"/);
  assert.match(html, /href="vocalzoid\.html" aria-current="page"/);
  assert.match(html, /<option value="vocalzoid\.html" selected>vocalzoid<\/option>/);
  assert.match(html, /<link rel="stylesheet" href="style\.css"\s*\/>/);
  assert.match(html, /<link rel="stylesheet" href="vocalzoid\.css"\s*\/>/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="vocalzoid-app\.js"><\/script>/);

  const ids = idsIn(html);
  assert.equal(new Set(ids).size, ids.length, "page IDs must be unique");
  const idSet = new Set(ids);
  const requiredIds = [
    "audioButton",
    "audioState",
    "level",
    "wordInput",
    "buildScore",
    "playButton",
    "stopButton",
    "loopButton",
    "pianoGrid",
    "noteLayer",
    "pitchCurve",
    "rollPlayhead",
    "phonemeRibbon",
    "spectrumCanvas",
    "notePitch",
    "noteDuration",
    "aliasInput",
    "styleButtons",
    "melodyPresets",
    "bpm",
    "vibrato",
    "glide",
    "bankInput",
    "bankDrop",
    "bankStatus",
    "loadedBank",
    "bankAliases",
    "bankRoot",
    "openBankButtons",
    "useKalButton",
    "useLocalBank",
    "removeBank",
    "resetButton",
    "audioError",
    "liveStatus",
  ];
  for (const id of requiredIds) assert.ok(idSet.has(id), `missing #${id}`);

  const appIdReferences = new Set(
    [...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]),
  );
  for (const id of appIdReferences) {
    assert.ok(idSet.has(id), `vocalzoid-app.js references missing #${id}`);
  }

  for (const match of html.matchAll(/\b(?:for|aria-labelledby|aria-describedby)="([^"]+)"/g)) {
    for (const id of match[1].trim().split(/\s+/)) {
      assert.ok(idSet.has(id), `markup references missing #${id}`);
    }
  }

  for (const input of html.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const [, id] = input;
    const labelled = new RegExp(`<label\\b[^>]*\\bfor="${id}"`, "i").test(html)
      || /\baria-label="[^"]+"/i.test(input[0]);
    assert.ok(labelled, `#${id} must have an accessible label`);
  }

  for (const button of html.matchAll(/<button\b[^>]*>/g)) {
    assert.equal(attribute(button[0], "type"), "button", `${button[0]} needs type=button`);
  }

  const localAssets = [
    ...html.matchAll(/<(?:link|script)\b[^>]*(?:href|src)="([^"]+)"[^>]*>/g),
  ].map((match) => match[1]).filter((path) => !/^(?:https?:|data:|#)/.test(path));
  for (const path of localAssets) {
    const info = await stat(new URL(path, ROOT));
    assert.ok(info.isFile(), `${path} must be a local file`);
  }

  const modulePaths = [
    ...app.matchAll(/\bfrom\s+"(\.[^"]+)"/g),
  ].map((match) => match[1]);
  for (const path of modulePaths) {
    const info = await stat(new URL(path, new URL("vocalzoid-app.js", ROOT)));
    assert.ok(info.isFile(), `${path} must resolve from vocalzoid-app.js`);
  }
});

test("Vocalzoid exposes local import, source terms, and accessible status", async () => {
  const html = await readFile(new URL("vocalzoid.html", ROOT), "utf8");
  const fileInput = html.match(/<input\b[^>]*\bid="bankInput"[^>]*>/)?.[0] ?? "";
  assert.match(fileInput, /\bmultiple\b/);
  assert.match(fileInput, /\bwebkitdirectory\b/);
  assert.match(attribute(fileInput, "accept"), /\.wav/);
  assert.match(attribute(fileInput, "accept"), /\.ini/);
  assert.match(html, /Nothing is uploaded\./);
  assert.match(html, /Import only a bank you have permission to use\./);
  assert.match(html, /“Free to download” does not mean open source\./);
  assert.match(html, /Vocaloid voicebanks are proprietary and\s+are not imported by this page/);
  assert.match(html, /id="bankStatus" role="status"/);
  assert.match(html, /id="audioError" role="alert"/);
  assert.match(html, /id="liveStatus" aria-live="polite"/);

  const openBankIds = [...html.matchAll(/data-open-bank="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(openBankIds, ["air", "cicada", "quake"]);
  assert.equal((html.match(/data-style="/g) ?? []).length, 3);
  assert.equal((html.match(/data-melody="/g) ?? []).length, 3);

  const sourceUrls = [
    "https://github.com/festvox/flite",
    "https://github.com/openutau/OpenUtau/wiki/Getting-Started",
    "https://gitlab.com/oddvoices/oddvoices/-/tree/develop/voices",
    "https://kasaneteto.jp/utau/",
    "https://www.isca-archive.org/interspeech_2007/kenmochi07_interspeech.pdf",
    "https://mtg.upf.edu/files/publications/SMAC2003-aloscos.pdf",
    "https://github.com/openutau/OpenUtau/wiki/Voicebank-Development",
    "https://github.com/openutau/OpenUtau/wiki/Resamplers-and-Wavtools",
  ];
  for (const url of sourceUrls) {
    assert.ok(html.includes(`href="${url}"`), `missing source link ${url}`);
  }

  for (const link of html.matchAll(/<a\b[^>]*\btarget="_blank"[^>]*>/g)) {
    assert.match(attribute(link[0], "rel"), /\bnoreferrer\b/);
  }
});

test("Vocalzoid keeps a usable responsive piano roll and reduced-motion mode", async () => {
  const css = await readFile(new URL("vocalzoid.css", ROOT), "utf8");
  assert.match(css, /\.piano-roll\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(
    css,
    /@media \(max-width:\s*820px\)[\s\S]*?\.vocalzoid-page\s*\{[\s\S]*?overflow:\s*auto[\s\S]*?\.vocalzoid-shell\s*\{[\s\S]*?display:\s*block/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*560px\)[\s\S]*?\.phrase-transport\s*\{[\s\S]*?width:\s*100%[\s\S]*?\.note-editor-controls\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
  );
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test("audio power transitions remain separate from cancellable playback preparation", async () => {
  const app = await readFile(new URL("vocalzoid-app.js", ROOT), "utf8");
  assert.match(app, /\bstarting:\s*false,/);
  assert.match(app, /\baudioTransition:\s*"",/);

  const audioUi = sourceSection(app, "function updateAudioUi()", "function updateControlUi()");
  assert.match(
    audioUi,
    /const busy = Boolean\(state\.audioTransition\) \|\| state\.starting;/,
  );
  assert.match(audioUi, /\$\("audioButton"\)\.disabled = busy;/);
  assert.match(audioUi, /\$\("playButton"\)\.disabled = busy;/);
  assertOrdered(
    audioUi,
    '$("audioState").textContent = state.audioTransition',
    "state.starting",
    'state.playing ? "singing" : "ready"',
  );

  const playback = sourceSection(app, "async function playSequence()", "async function toggleAudio()");
  assert.match(playback, /const request = \+\+state\.playRequest;/);
  assert.match(playback, /state\.starting = true;/);
  assert.doesNotMatch(playback, /state\.audioTransition\s*=/);
  assertOrdered(
    playback,
    "const request = ++state.playRequest;",
    "state.starting = true;",
    "await audio.play(state.notes,",
    "if (request !== state.playRequest || !result) return;",
    "state.playResult = result;",
    "if (request === state.playRequest) {",
    "state.starting = false;",
  );

  const power = sourceSection(app, "async function toggleAudio()", "async function pronunciationFor(");
  assert.match(power, /if \(state\.starting \|\| state\.audioTransition\) return;/);
  assert.doesNotMatch(power, /state\.starting\s*=/);
  assert.deepEqual(
    [...power.matchAll(/state\.audioTransition = "([^"]*)";/g)].map((match) => match[1]),
    ["stopping", "", "starting", ""],
  );
  const disableBranch = power.slice(0, power.indexOf("return;", power.indexOf("await audio.disable()")));
  assertOrdered(
    disableBranch,
    'state.audioTransition = "stopping";',
    "updateAudioUi();",
    "await audio.disable();",
    "state.audioOn = false;",
    'state.audioTransition = "";',
  );
  const enableBranch = power.slice(power.indexOf('state.audioTransition = "starting";'));
  assertOrdered(
    enableBranch,
    'state.audioTransition = "starting";',
    "updateAudioUi();",
    "await audio.enable();",
    "state.audioOn = true;",
    'state.audioTransition = "";',
  );

  const halt = sourceSection(app, "function haltPlayback(", "async function playSequence()");
  assertOrdered(
    halt,
    "state.playRequest += 1;",
    "state.starting = false;",
    "audio.stop();",
  );
});

test("score and voicebank requests ignore stale async completions", async () => {
  const app = await readFile(new URL("vocalzoid-app.js", ROOT), "utf8");
  for (const field of ["scoreRequest", "importRequest", "sourceRevision"]) {
    assert.match(app, new RegExp(`\\b${field}:\\s*0,`));
  }

  const score = sourceSection(app, "async function buildScore()", "function chooseKalStyle(");
  assertOrdered(
    score,
    "const request = ++state.scoreRequest;",
    '$("buildScore").disabled = true;',
    "const phones = await pronunciationFor(word);",
    "if (request !== state.scoreRequest) return;",
    "state.word = word;",
    "renderScore();",
    "if (request === state.scoreRequest) {",
    '$("buildScore").disabled = false;',
  );

  const imported = sourceSection(app, "async function importBank(files)", "function removeLocalBank()");
  assertOrdered(
    imported,
    "const request = ++state.importRequest;",
    "const sourceRevision = state.sourceRevision;",
    "const bank = await loadUtauBankFiles(files);",
    "if (request !== state.importRequest) return;",
    "state.localBank = bank;",
  );
  assert.match(
    imported,
    /catch \(error\) \{\s*if \(request !== state\.importRequest\) return;/,
  );
  assert.match(
    imported,
    /finally \{\s*if \(request === state\.importRequest\) \{[\s\S]*?classList\.remove\("is-loading"\)[\s\S]*?\$\("bankInput"\)\.value = "";/,
  );

  const remove = sourceSection(app, "function removeLocalBank()", "function resetVocalzoid()");
  assert.match(remove, /state\.importRequest \+= 1;/);
  const reset = sourceSection(app, "function resetVocalzoid()", "function installEvents()");
  assertOrdered(
    reset,
    "state.scoreRequest += 1;",
    "state.importRequest += 1;",
    "state.sourceRevision += 1;",
    "haltPlayback();",
  );
  assert.match(reset, /\$\("buildScore"\)\.disabled = false;/);
  assert.match(reset, /\$\("bankDrop"\)\.classList\.remove\("is-loading"\);/);
});

test("a completed import preserves a voice source chosen after that import began", async () => {
  const app = await readFile(new URL("vocalzoid-app.js", ROOT), "utf8");
  const selectors = [
    sourceSection(app, "function chooseKalStyle(", "function chooseOpenBank("),
    sourceSection(app, "function chooseOpenBank(", "function chooseLocalBank()"),
    sourceSection(app, "function chooseLocalBank()", "async function importBank(files)"),
  ];
  for (const selector of selectors) {
    assertOrdered(selector, "state.sourceRevision += 1;", "state.source =");
  }

  const imported = sourceSection(app, "async function importBank(files)", "function removeLocalBank()");
  assert.doesNotMatch(imported, /state\.source\s*=/);
  assertOrdered(
    imported,
    "const sourceRevision = state.sourceRevision;",
    "const bank = await loadUtauBankFiles(files);",
    "const canAutoSelect = sourceRevision === state.sourceRevision;",
    "if (canAutoSelect) chooseLocalBank();",
    "else updateSourceUi();",
    '"It is ready; your newer voice choice is unchanged."',
  );
});

test("bundled CC0 banks point to complete RIFF/WAVE assets with in-bounds clips", async () => {
  assert.deepEqual(Object.keys(VOCALZOID_OPEN_BANKS), ["air", "cicada", "quake"]);
  const oddVoicesLicense = await readFile(new URL("vendor/oddvoices/LICENSE", ROOT), "utf8");
  assert.match(oddVoicesLicense, /CC0 1\.0/i);

  for (const [id, bank] of Object.entries(VOCALZOID_OPEN_BANKS)) {
    assert.equal(bank.id, id);
    assert.equal(bank.license, "CC0 1.0");
    assert.equal(bank.url.protocol, "file:");
    assert.match(bank.url.pathname, new RegExp(`/vocalzoid-oddvoices-${id}\\.wav$`));
    assert.equal(
      bank.sourceHref,
      `https://gitlab.com/oddvoices/oddvoices/-/tree/${ODDVOICES_REVISION}/voices/${id}`,
    );
    assert.ok(Number.isFinite(bank.rootMidi));

    const bytes = await readFile(bank.url);
    assert.ok(bytes.length > 32_000, `${bank.name} must contain a nontrivial sample bank`);
    const audioDuration = riffWaveDuration(bytes);
    assert.ok(audioDuration > 1, `${bank.name} must contain more than one second of audio`);
    assert.ok(Object.keys(bank.clips).length >= 8, `${bank.name} must expose the lyric diphones`);

    for (const [alias, clip] of Object.entries(bank.clips)) {
      assert.ok(clip.offset >= 0, `${bank.name} ${alias} offset must be nonnegative`);
      assert.ok(clip.duration > 0, `${bank.name} ${alias} duration must be positive`);
      assert.ok(
        clip.offset + clip.duration <= audioDuration + 1 / 48_000,
        `${bank.name} ${alias} extends past its WAV data`,
      );
      assert.ok(clip.loopStart >= 0 && clip.loopEnd >= 0);
      assert.ok(!clip.loopEnd || clip.loopEnd <= clip.duration);
      assert.ok(!clip.loopEnd || clip.loopStart < clip.loopEnd);
    }
  }
});
