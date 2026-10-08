import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHash } from "node:crypto";
import { midiphoriaSiteAdditions, restoreMidiphoriaSite } from "./helpers/midiphoria-site-reference.mjs";

import { TOOL_GROUPS } from "../src/site/instrument-registry.js";
import { catalogueItemById, instrumentById } from "../src/site/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/site/instrument-midi-capabilities.js";
import { waxSupportForId } from "../src/instruments/wax/wax-instrument-roles.js";
import { CANONICAL_PAGE_ROUTES } from "../src/pages/manifest.js";

test("Midiphoria adds only its own metadata and preserves previous catalogue bytes", async () => {
  for (const change of midiphoriaSiteAdditions) {
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), "utf8");
    const digest = value => createHash("sha256").update(restoreMidiphoriaSite(value, change.file)).digest("hex");
    assert.equal(digest(source), change.sha256);
    const restored = restoreMidiphoriaSite(source, change.file);
    assert.equal(restoreMidiphoriaSite(restored, change.file, { allowRestored: true }), restored);
    assert.notEqual(digest(source + "\n// unrelated change\n"), change.sha256);
    for (const addition of change.additions) {
      assert.throws(() => restoreMidiphoriaSite(source + addition, change.file), /exact Midiphoria addition/);
      assert.throws(() => restoreMidiphoriaSite(source.replace(addition, ""), change.file), /exact Midiphoria addition/);
    }
  }
});

test("Midiphoria is a browseable visual lab with one native MIDI client and optional file audio", () => {
  const group = TOOL_GROUPS.find(({ tools }) => tools.some(({ id }) => id === "midiphoria"));
  assert.equal(group.id, "graphic-ui");
  const item = catalogueItemById("midiphoria");
  assert.equal(item.label, "Midiphoria");
  assert.equal(item.entryType, "lab");
  assert.equal(item.href, "midiphoria.html");
  assert.equal(item.imageHref, "assets/instruments/midiphoria.webp");
  assert.deepEqual(item.tags.map(({ id }) => id), ["graphic-ui", "2d"]);
  assert.ok(item.features.includes("MIDI"));
  assert.ok(item.features.includes("Computer keys"));
  assert.match(item.description, /SoundFont audio/);
  assert.equal(instrumentById("midiphoria"), null);
  assert.equal(waxSupportForId("midiphoria"), null);
  assert.deepEqual(instrumentMidiCapabilityForId("midiphoria"), {
    id: "midiphoria",
    midiInput: true,
    midiInputMode: "native",
    noteMode: "processor",
    audioInput: false,
    midiOutput: false,
    startsAudio: false,
    computerKeyboardMode: "midi",
  });
  assert.ok(CANONICAL_PAGE_ROUTES.includes("midiphoria.html"));
});

test("Midiphoria publishes the accessible visual page and complete runtime assets", async () => {
  const page = await readFile(new URL("../src/pages/midiphoria.html", import.meta.url), "utf8");
  assert.doesNotMatch(page, /id="genreSelect"/);
  assert.match(page, /id="songSearch"/);
  assert.match(page, /data-instrument-preset-host/);
  assert.match(page, /<canvas\b[^>]*\baria-label=/);
  assert.match(page, /href="midiphoria\.html"/);
  assert.match(page, /src="nav\.js"/);
  assert.match(page, /src="src\/instruments\/midiphoria\/midiphoria-app\.js"/);
  assert.match(page, /class="[^\"]*\baudio-button\b/);
  const inventory = await readFile(new URL("../scripts/site/runtime-files.tsv", import.meta.url), "utf8");
  for (const path of [
    "src/instruments/midiphoria/midiphoria-app.js",
    "src/instruments/midiphoria/midiphoria-model.js",
    "src/instruments/midiphoria/midiphoria-renderer.js",
    "src/instruments/midiphoria/midiphoria-player.js",
    "src/instruments/midiphoria/midiphoria-presets.js",
    "src/instruments/midiphoria/vendor/spessasynth.js",
    "src/instruments/midiphoria/vendor/spessasynth_processor.min.js",
    "assets/midiphoria/collection.json",
    "assets/midiphoria/soundfont/TimGM6mb.sf2",
    "src/instruments/midiphoria/midiphoria.css",
    "assets/instruments/midiphoria.webp",
  ]) assert.ok(inventory.split("\n").includes(`copy+require\t${path}`), path);
  const icon = await readFile(new URL("../assets/instruments/midiphoria.webp", import.meta.url));
  assert.equal(icon.toString("ascii", 0, 4), "RIFF");
  assert.equal(icon.toString("ascii", 8, 12), "WEBP");
});

test("the grouped library ships complete attributed arrangements and all nine geometric patterns", async () => {
  const base = new URL('../assets/midiphoria/', import.meta.url);
  const songs = JSON.parse(await readFile(new URL('collection.json', base), 'utf8'));
  const inventory = await readFile(new URL('../scripts/site/runtime-files.tsv', import.meta.url), 'utf8');
  assert.equal(new Set(songs.map(song => song.id)).size, songs.length);
  assert.ok(songs.filter(song => song.webArrangement).length >= 40);
  assert.equal(songs.filter(song => song.collection === 'Geometric patterns').length, 9);
  assert.equal(songs.filter(song => song.collection === 'Black MIDI').length, 16);
  assert.equal(songs.filter(song => song.collection === 'Orchestral excursions').length, 9);
  assert.ok(!songs.some(song => ['fur-elise', 'bach-prelude-c', 'turkish-march', 'moonlight', 'chopin-nocturne', 'entertainer'].includes(song.id)));
  for (const song of songs) {
    if (song.webArrangement) {
      assert.ok(song.durationSeconds >= 90, song.id);
      assert.ok(song.channelCount >= 4, song.id);
      assert.ok(song.noteOnCount >= 1000, song.id);
      assert.ok(song.hasDrums, song.id);
      assert.match(song.downloadUrl, /^https:\/\//);
    }
    assert.match(song.file, /^midi\/[a-z0-9-]+\.mid$/);
    assert.ok(song.title && song.attribution && song.license && song.sourceUrl);
    assert.ok(song.collection, song.id);
    const midi = await readFile(new URL(song.file, base));
    assert.equal(midi.toString('ascii', 0, 4), 'MThd', song.id);
    assert.equal(createHash('sha256').update(midi).digest('hex'), song.sha256, song.id);
    assert.ok(inventory.split('\n').includes(`copy+require\tassets/midiphoria/${song.file}`), song.id);
    if (song.demo) assert.match(song.composer, /original/i);
  }
  const font = await readFile(new URL('soundfont/TimGM6mb.sf2', base));
  assert.equal(font.toString('ascii', 0, 4), 'RIFF');
  assert.equal(font.toString('ascii', 8, 12), 'sfbk');
  const archiveInfo = JSON.parse(await readFile(new URL('archives/black-midi-archive-2026.json', base), 'utf8'));
  const archive = await readFile(new URL(`archives/${archiveInfo.file}`, base));
  assert.equal(archiveInfo.midiCount, 35);
  assert.equal(archiveInfo.uniqueWorks, 19);
  assert.equal(archive.length, archiveInfo.bytes);
  assert.equal(createHash('sha256').update(archive).digest('hex'), archiveInfo.sha256);
});
