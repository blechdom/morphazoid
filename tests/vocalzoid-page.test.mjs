import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { VOCALZOID_OPEN_BANKS } from "../src/vocalzoid-open-banks.js";
import { SPELLING_PRONUNCIATION_PHONE_CATALOG } from "../src/spelling-pronunciation.js";

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
    "rollInstructions",
    "addNoteButton",
    "randomizeButton",
    "splitNoteButton",
    "deleteNoteButton",
    "phonemeRibbon",
    "spectrumCanvas",
    "notePitch",
    "noteDuration",
    "phoneEditor",
    "notePhoneLabel",
    "notePhoneMenus",
    "phoneMenuHelp",
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

test("the piano roll exposes complete note editing for pointer, touch, and keyboard", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("vocalzoid.html", ROOT), "utf8"),
    readFile(new URL("vocalzoid-app.js", ROOT), "utf8"),
    readFile(new URL("vocalzoid.css", ROOT), "utf8"),
  ]);
  for (const id of ["addNoteButton", "randomizeButton", "splitNoteButton", "deleteNoteButton"]) {
    assert.match(html, new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*\\btype="button"`));
  }
  const randomize = html.match(/<button\b[^>]*\bid="randomizeButton"[^>]*>/)?.[0] ?? "";
  assert.match(attribute(randomize, "aria-label"), /Randomize phones, notes, and performance parameters/i);
  assert.match(html, /drag its right edge to resize/i);
  assert.match(html, /double-click a note to cut/i);
  const duration = html.match(/<input\b[^>]*\bid="noteDuration"[^>]*>/)?.[0] ?? "";
  assert.equal(attribute(duration, "min"), "0.25");
  assert.equal(attribute(duration, "max"), "16");

  const notes = sourceSection(app, "function renderNotes(totalBeats)", "function renderPitchCurve()");
  assert.match(notes, /note-resize-handle/);
  assert.match(notes, /button\.addEventListener\("dblclick"/);
  assert.match(notes, /event\.key === "Delete" \|\| event\.key === "Backspace"/);
  const dragStart = sourceSection(app, "function startNoteDrag(event, noteId)", "function renderNotes(totalBeats)");
  assert.match(dragStart, /"resize"\s*:\s*"move"/);
  const events = sourceSection(app, "function installEvents()", "renderPitchLabels();");
  assert.match(events, /\$\("pianoGrid"\)\.addEventListener\("dblclick"/);
  assert.match(events, /drag\.kind === "resize"/);
  assert.match(events, /duration:\s*clampVocalzoid/);

  assert.match(css, /\.vocal-note \.note-resize-handle\s*\{/);
  assert.match(css, /\.note-resize-handle[\s\S]*?width:\s*16px/);
  assert.doesNotMatch(css, /\.vocal-note\s*\{[^}]*min-width:\s*31px/);
  assert.match(css, /\.vocal-note:focus-visible/);
});

test("each MIDI note exposes editable, role-safe phoneme pull-downs", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("vocalzoid.html", ROOT), "utf8"),
    readFile(new URL("vocalzoid-app.js", ROOT), "utf8"),
    readFile(new URL("vocalzoid.css", ROOT), "utf8"),
  ]);
  assert.equal(SPELLING_PRONUNCIATION_PHONE_CATALOG.length, 39);
  assert.equal(SPELLING_PRONUNCIATION_PHONE_CATALOG.filter(({ vowel }) => vowel).length, 15);
  assert.equal(SPELLING_PRONUNCIATION_PHONE_CATALOG.filter(({ vowel }) => !vowel).length, 24);
  assert.match(html, /id="notePhoneLabel">Phonemes \/ diphones/);
  assert.match(html, /39 renderable ARPAbet sounds/);
  assert.match(html, /Each pull-down changes one sound/);
  assert.match(html, /Adjacent sounds form diphone joins/);

  const notes = sourceSection(app, "function renderNotes(totalBeats)", "function renderPitchCurve()");
  assert.match(notes, /phoneJoinText\(note\.phones\)/);
  assert.match(notes, /phones \$\{note\.phones\.join\(", "\)\}/);
  const menus = sourceSection(app, "function renderNotePhoneMenus(note)", "function changeNotePhone(");
  assert.match(menus, /SPELLING_PRONUNCIATION_PHONE_CATALOG/);
  assert.match(app, /Diphthongs \+ R-colored vowels/);
  assert.match(menus, /vowelSlot \? groupId === "consonant" : groupId !== "consonant"/);
  assert.match(menus, /select\.addEventListener\("change"/);
  const change = sourceSection(app, "function changeNotePhone(", "function renderSelectedNote()");
  assert.match(change, /replaceVocalzoidNotePhone/);
  assert.match(change, /haltPlayback\(\)/);
  assert.match(change, /data-phone-index/);

  assert.match(css, /\.note-phone-menus\s*\{/);
  assert.match(css, /\.note-phone-picker select\s*\{/);
  assert.match(css, /\.note-phone-picker\.is-vowel select\s*\{/);
  assert.match(css, /\.note-phone-picker select:focus-visible/);
});

test("Randomize replaces the score and synchronizes musical parameters without autoplay", async () => {
  const app = await readFile(new URL("vocalzoid-app.js", ROOT), "utf8");
  const randomize = sourceSection(app, "function randomizeScore()", "async function buildScore()");
  assertOrdered(
    randomize,
    "state.scoreRequest += 1;",
    "haltPlayback();",
    "const randomized = createRandomVocalzoidScore();",
    "Object.assign(state, {",
    "notes: randomized.notes,",
    'selectedId: randomized.notes[0]?.id ?? "",',
    "style: randomized.style,",
    "bpm: randomized.bpm,",
    "vibrato: randomized.vibrato,",
    "glide: randomized.glide,",
    "scoreBeats: randomized.scoreBeats,",
    "randomScore: true,",
    "audio.setStyle(state.style);",
    "updateControlUi();",
    "updateSourceUi();",
    "renderScore();",
    "announce(",
  );
  assert.doesNotMatch(randomize, /audio\.play|playSequence|selectNote/);
  assert.match(randomize, /Randomized \$\{state\.notes\.length\} notes/);
  const events = sourceSection(app, "function installEvents()", "renderPitchLabels();");
  assert.match(events, /\$\("randomizeButton"\)\.addEventListener\("click", randomizeScore\)/);
  const build = sourceSection(app, "async function buildScore()", "function chooseKalStyle(");
  assert.match(build, /state\.randomScore = false;/);
});

test("Vocalzoid exposes local import, source terms, and accessible status", async () => {
  const html = await readFile(new URL("vocalzoid.html", ROOT), "utf8");
  assertOrdered(html, "id=\"libraryTitle\"", "id=\"importTitle\"");
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
  assert.deepEqual(openBankIds, ["air", "cicada", "quake", "bdl", "clb", "jmk", "ksp", "slt"]);
  assert.equal((html.match(/data-style="/g) ?? []).length, 3);
  assert.equal((html.match(/data-melody="/g) ?? []).length, 3);

  const sourceUrls = [
    "https://github.com/festvox/flite",
    "https://github.com/openutau/OpenUtau/wiki/Getting-Started",
    "https://gitlab.com/oddvoices/oddvoices/-/tree/develop/voices",
    "https://www.cs.cmu.edu/~awb/papers/ssw5/arctic.pdf",
    "https://kasaneteto.jp/utau/",
    "https://www.isca-archive.org/interspeech_2007/kenmochi07_interspeech.pdf",
    "https://mtg.upf.edu/files/publications/SMAC2003-aloscos.pdf",
    "https://github.com/openutau/OpenUtau/wiki/Voicebank-Development",
    "https://github.com/openutau/OpenUtau/wiki/Phonemizers",
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
  const [html, app, css] = await Promise.all([
    readFile(new URL("vocalzoid.html", ROOT), "utf8"),
    readFile(new URL("vocalzoid-app.js", ROOT), "utf8"),
    readFile(new URL("vocalzoid.css", ROOT), "utf8"),
  ]);
  assert.match(css, /\.piano-roll\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.vocalzoid-workspace\s*\{[^}]*padding:\s*clamp\(8px,\s*1vw,\s*14px\)/);
  assert.match(css, /\.phrase-console\s*\{[^}]*margin-top:\s*0/);
  assert.match(
    css,
    /@media \(max-width:\s*820px\)[\s\S]*?\.vocalzoid-workspace\s*\{[^}]*padding:\s*8px 18px 48px[\s\S]*?\.phrase-console\s*\{[^}]*margin-top:\s*0/,
  );
  assert.match(css, /\.phoneme-lane\s*\{[\s\S]*?position:\s*relative/);
  assert.match(css, /\.phoneme-cell\s*\{[\s\S]*?position:\s*absolute/);
  const ribbon = sourceSection(app, "function renderPhonemeRibbon()", "function renderSelectedNote()");
  assert.match(ribbon, /vocalzoidRenderPlan\(state\.notes, state\.bpm\)/);
  assert.match(ribbon, /cell\.style\.left\s*=/);
  assert.match(ribbon, /cell\.style\.width\s*=/);
  assert.doesNotMatch(ribbon, /flexGrow/);
  const currentEvent = sourceSection(app, "function updateCurrentEvent(progressSeconds)", "function resizeSpectrum()");
  assert.match(currentEvent, /entry\.start >= event\.start/);
  assert.doesNotMatch(currentEvent, /plan\.find\(/);
  const events = sourceSection(app, "function installEvents()", "installEvents();");
  assert.match(
    events,
    /\$\("bpm"\)\.addEventListener\("input",[\s\S]*?renderPhonemeRibbon\(\);/,
  );
  const openChoice = sourceSection(app, "function chooseOpenBank(bankId)", "function chooseLocalBank()");
  assert.match(openChoice, /bank\.license/);
  assert.doesNotMatch(app, /CC0 bank|CC0 diphones/);
  assert.match(html, /<table>[\s\S]*?<th>Vocalzoid<\/th>[\s\S]*?<th>OpenUtau<\/th>[\s\S]*?<th>Vocaloid V1–V2<\/th>/);
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

test("bundled open banks point to licensed, complete RIFF/WAVE assets with in-bounds clips", async () => {
  const oddIds = new Set(["air", "cicada", "quake"]);
  const arcticIds = new Set(["bdl", "clb", "jmk", "ksp", "slt"]);
  assert.deepEqual(Object.keys(VOCALZOID_OPEN_BANKS), [...oddIds, ...arcticIds]);
  const oddVoicesLicense = await readFile(new URL("vendor/oddvoices/LICENSE", ROOT), "utf8");
  const [arcticLicense2003, arcticLicense2005] = await Promise.all([
    readFile(new URL("vendor/cmu-arctic/COPYING", ROOT), "utf8"),
    readFile(new URL("vendor/cmu-arctic/COPYING-2005", ROOT), "utf8"),
  ]);
  assert.match(oddVoicesLicense, /CC0 1\.0/i);
  assert.match(arcticLicense2003, /Copyright \(c\) 2003/);
  assert.match(arcticLicense2005, /Copyright \(c\) 2005/);
  for (const arcticLicense of [arcticLicense2003, arcticLicense2005]) {
    assert.match(arcticLicense, /Permission to use, copy, modify,\s+and licence/);
  }

  for (const [id, bank] of Object.entries(VOCALZOID_OPEN_BANKS)) {
    assert.equal(bank.id, id);
    assert.equal(bank.url.protocol, "file:");
    if (oddIds.has(id)) {
      assert.equal(bank.license, "CC0 1.0");
      assert.match(bank.url.pathname, new RegExp(`/vocalzoid-oddvoices-${id}\\.wav$`));
      assert.equal(
        bank.sourceHref,
        `https://gitlab.com/oddvoices/oddvoices/-/tree/${ODDVOICES_REVISION}/voices/${id}`,
      );
    } else {
      assert.equal(bank.license, "CMU ARCTIC permissive");
      assert.match(bank.url.pathname, new RegExp(`/vocalzoid-cmu-arctic-${id}\\.wav$`));
      assert.equal(
        bank.sourceHref,
        `http://festvox.org/cmu_arctic/cmu_arctic/cmu_us_${id}_arctic/`,
      );
    }
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
