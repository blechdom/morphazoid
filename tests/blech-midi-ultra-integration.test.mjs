import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { pageRouteForSourcePath } from '../src/pages/manifest.js';
import { FAVE_TOOL_IDS, TOOL_GROUPS } from '../src/site/instrument-registry.js';
import { catalogueItemById } from '../src/site/instrument-catalog.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { TAP_TEMPO_TARGETS } from '../src/site/tap-tempo-targets.js';
import { readRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { BLACK_MIDI_PALETTES, blackMidiColor } from '../src/instruments/blech-midi-ultra/blech-midi-black-renderer.js';
import { BLACK_MIDI_PALETTES as ORIGINAL_PALETTES } from '../src/instruments/blech-midi/blech-midi-black-renderer.js';
import { blechMidiUltraSiteChanges, restoreBlechMidiUltraSite } from './helpers/blech-midi-ultra-site-reference.mjs';

const ultra = 'blech-midi-ultra';
const page = `${ultra}.html`;
const owned = `src/instruments/${ultra}/`;

test('BLECH-MIDI-ULTRA has its own browse route, MIDI policy and tempo controls', () => {
  const group = TOOL_GROUPS.find(item => item.id === 'graphic-ui');
  const tool = group.tools.find(item => item.id === ultra);
  assert.equal(tool.label, 'BLECH MIDI ULTRA');
  assert.equal(tool.href, page);
  assert.equal(tool.imageHref, `assets/instruments/${ultra}.webp`);
  assert.equal(tool.catalogue, false);
  assert.equal(tool.browse, true);
  assert.equal(tool.entryType, 'lab');
  assert.equal(catalogueItemById(ultra).href, page);
  assert.deepEqual(
    FAVE_TOOL_IDS.slice(FAVE_TOOL_IDS.indexOf('blech-midi'), FAVE_TOOL_IDS.indexOf('blech-midi') + 2),
    ['blech-midi', ultra],
  );
  assert.equal(FAVE_TOOL_IDS.filter(id => id === ultra).length, 1);
  assert.ok(catalogueItemById(ultra).tags.some(tag => tag.id === 'faves'));
  assert.equal(pageRouteForSourcePath(`src/pages/${page}`), page);
  assert.deepEqual(instrumentMidiCapabilityForId(ultra), {
    ...instrumentMidiCapabilityForId('blech-midi'), id: ultra,
  });
  assert.deepEqual(
    TAP_TEMPO_TARGETS.filter(target => target.route === page).map(({ selector }) => selector),
    ['#creativeTempo', '#blackFileTempo', '#blackPlaybackRate'],
  );
});

test('the saved page mounts only its own BLECH source and links back to the original', async () => {
  const html = await readFile(new URL(`../src/pages/${page}`, import.meta.url), 'utf8');
  const original = await readFile(new URL('../src/pages/blech-midi.html', import.meta.url), 'utf8');
  assert.match(html, /<title>BLECH MIDI ULTRA — Morphazoid<\/title>/);
  assert.match(html, /<h1 id="blechMidiTitle">.*BLECH MIDI ULTRA<\/h1>/);
  assert.match(html, /<button class="audio-button" id="audioButton" type="button" aria-pressed="false">/);
  assert.match(html, /<section id="blechDropControls"/);
  assert.match(await readFile(new URL(`../${owned}blech-midi-drop-stage.js`, import.meta.url), 'utf8'), /<button id="blechDropSend"/);
  assert.match(html, /href="blech-midi\.html">BLECH MIDI<\/a>/);
  assert.match(original, /src\/instruments\/blech-midi\/blech-midi-app\.js/);
  assert.doesNotMatch(original, /blech-midi-ultra/);
  for (const path of [
    `${owned}blech-midi-app.js`,
    `${owned}blech-midi.css`,
    `${owned}blech-midi-generators.css`,
    `${owned}blech-midi-spigots.css`,
    'assets/blech-midi-ultra/blech-mark.svg',
    'docs/blech-midi-ultra.md',
  ]) assert.ok(html.includes(path), `${path} is referenced by the new page`);
  assert.doesNotMatch(html, /(?:src\/instruments|assets)\/blech-midi\//);
});

test('the saved BLECH-owned modules and assets enter the uncommitted release build', async () => {
  const entries = (await readRuntimeManifest()).entries;
  const modules = (await readdir(new URL(`../${owned}`, import.meta.url)))
    .filter(filename => /\.(?:js|css)$/.test(filename));
  assert.ok(modules.includes('blech-midi-black-worker.js'));
  assert.ok(modules.includes('blech-midi-spigot-engine.js'));
  for (const filename of modules) {
    const path = `${owned}${filename}`;
    assert.deepEqual(entries.filter(row => row.path === path).map(row => row.policy), ['copy+require'], path);
    const content = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(content, /(?:src\/instruments\/blech-midi\/|\.\.\/blech-midi\/)/, `${path} imports the original`);
  }
  for (const path of [
    'assets/blech-midi-ultra/blech-mark.svg',
    `assets/instruments/${ultra}.webp`,
    'docs/blech-midi-ultra.md',
  ]) assert.deepEqual(entries.filter(row => row.path === path).map(row => row.policy), ['copy+require'], path);
  assert.equal(entries.some(row => row.path === page), false, 'canonical HTML comes from the page manifest');
  const icon = await readFile(new URL(`../assets/instruments/${ultra}.webp`, import.meta.url));
  const originalIcon = await readFile(new URL('../assets/instruments/blech-midi.webp', import.meta.url));
  assert.ok(icon.length > 512);
  assert.ok(!icon.equals(originalIcon), 'Ultra has its own recolored catalogue logo');
  assert.equal(icon.toString('ascii', 0, 4), 'RIFF');
  assert.equal(icon.toString('ascii', 8, 12), 'WEBP');
  const mark = await readFile(new URL('../assets/blech-midi-ultra/blech-mark.svg', import.meta.url), 'utf8');
  const originalMark = await readFile(new URL('../assets/blech-midi/blech-mark.svg', import.meta.url), 'utf8');
  assert.match(mark, /fill="#c7ff2a"/);
  assert.match(originalMark, /fill="#ff2532"/);
  assert.doesNotMatch(mark, /fill="#ff2532"/);
});

test('ULTRA ink follows its logo, with separate pink edits and opt-in classic palettes', async () => {
  const css = await readFile(new URL(`../${owned}blech-midi.css`, import.meta.url), 'utf8');
  const rail = await readFile(new URL(`../${owned}blech-midi-spigots.css`, import.meta.url), 'utf8');
  const html = await readFile(new URL(`../src/pages/${page}`, import.meta.url), 'utf8');
  assert.match(css, /--blech-acid: #c7ff2a;/);
  assert.match(css, /--blech-red: #ff2532;/);
  assert.match(css, /\.blech-midi-heading h1 \{[^\n]*color: var\(--blech-red\)/);
  assert.match(css, /--violet: var\(--blech-red\);/);
  assert.match(css, /--blech-hot: #ff4f92;/);
  assert.match(css, /--accent-glow: var\(--mz-color-accent-glow\);/);
  assert.match(css, /#drawingErase\[aria-pressed="true"\][^\n]+var\(--blech-hot\)/);
  assert.match(rail, /blech-note-rail-marker::before[^\n]+var\(--blech-acid\)/);
  assert.match(html, /<meta name="theme-color" content="#090b0a"/);
  for (const sheet of [css, rail, await readFile(new URL(`../${owned}blech-midi-generators.css`, import.meta.url), 'utf8')]) {
    assert.doesNotMatch(sheet, /#96f4cc|#c94420|#ff8752/);
    assert.doesNotMatch(sheet, /#bda6ff|#221722|#512b3a/);
  }
  for (const name of ['blech-midi-app.js', 'blech-midi-art-controls.js', 'blech-midi-generator-preview.js']) {
    const source = await readFile(new URL(`../${owned}${name}`, import.meta.url), 'utf8');
    assert.match(source, /#ff2532/, name);
    assert.doesNotMatch(source, /#bda6ff/, name);
  }

  assert.equal(BLACK_MIDI_PALETTES[0], 'ultra');
  assert.ok(BLACK_MIDI_PALETTES.includes('rainbow'));
  assert.ok(!ORIGINAL_PALETTES.includes('ultra'), 'the original renderer keeps its own palettes');
  const note = { track: 0, channel: 0, pitch: 60, velocity: 127 };
  assert.deepEqual(blackMidiColor(note, { palette: 'ultra' }), [199, 255, 42].map(value => value / 255));
  assert.deepEqual(blackMidiColor({ ...note, track: 1 }, { palette: 'ultra' }), [255, 79, 146].map(value => value / 255));
  assert.deepEqual(blackMidiColor({ ...note, track: 3 }, { palette: 'ultra' }), [255, 37, 50].map(value => value / 255));
  assert.notDeepEqual(blackMidiColor(note, { palette: 'rainbow' }), blackMidiColor(note, { palette: 'ultra' }));
  assert.deepEqual(blackMidiColor(note, { palette: 'ultra', trackColors: { 0: '#ff0080' } }), [1, 0, 128 / 255]);
});

test('Ultra additions can be removed exactly for older frozen site references', async () => {
  for (const file of new Set(blechMidiUltraSiteChanges.map(change => change.file))) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const restored = restoreBlechMidiUltraSite(source, file);
    assert.notEqual(restored, source, file);
    assert.equal(restoreBlechMidiUltraSite(restored, file, { allowRestored: true }), restored);
    assert.throws(() => restoreBlechMidiUltraSite(restored, file), /exact BLECH-MIDI-ULTRA site addition/);
    const drift = '\n# unrelated work stays visible\n';
    assert.ok(restoreBlechMidiUltraSite(source + drift, file).endsWith(drift));
    for (const change of blechMidiUltraSiteChanges.filter(change => change.file === file)) {
      assert.ok(restored.includes(change.before), file);
      assert.throws(
        () => restoreBlechMidiUltraSite(source.replace(change.after, change.before), file),
        /exact BLECH-MIDI-ULTRA site addition/,
      );
      assert.throws(
        () => restoreBlechMidiUltraSite(source + change.after, file),
        /exact BLECH-MIDI-ULTRA site addition/,
      );
    }
  }
});
