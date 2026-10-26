import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { catalogueItemById, instrumentById } from '../src/site/instrument-catalog.js';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';

test('Rig-a-Jig is a browseable WIP lab with one page and no registered instruments', () => {
  const item = catalogueItemById('rig-a-jig');
  assert.ok(item, 'catalogue entry');
  assert.equal(item.entryType, 'lab');
  assert.equal(item.status, 'Work in Progress');
  assert.equal(item.href, 'rig-a-jig.html');
  assert.ok(instrumentById('rig-a-jig') === null, 'not a registered instrument');
  assert.ok(CANONICAL_PAGE_ROUTES.includes('rig-a-jig.html'));
});

test('the rig zoo is entirely downloaded mocap rigs (no hand-authored procedural rigs)', async () => {
  const app = await readFile('src/instruments/rig-a-jig/rig-a-jig-app.js', 'utf8');
  // Every rig is a GLB-backed mocap entry with bones + clips.
  const urls = [...app.matchAll(/url: '(assets\/rig-a-jig\/[^']+\.glb)'/g)].map((m) => m[1]);
  assert.ok(urls.length >= 14, 'a real mocap zoo, not a handful');
  // No procedural rig factory module is imported anymore.
  assert.ok(!app.includes('rig-a-jig-rigs.js'), 'no procedural rig module import');
  assert.ok(!app.includes('createRandom'), 'no random body-plan generator');
  // Skin (ghost body) variants exist for the creatures.
  const skins = [...app.matchAll(/skinUrl: '(assets\/rig-a-jig\/[^']+\.glb)'/g)].map((m) => m[1]);
  assert.ok(skins.length >= 12, 'creatures have skinned ghost bodies');
});

test('page and runtime inventory ship the rig-a-jig modules', async () => {
  const inventory = await readFile('scripts/site/runtime-files.tsv', 'utf8');
  for (const path of [
    'rig-a-jig.html',
    'src/instruments/rig-a-jig/rig-a-jig-app.js',
    'src/instruments/rig-a-jig/rig-a-jig-viewer.js',
    'src/instruments/rig-a-jig/rig-a-jig-audio.js',
    'src/instruments/rig-a-jig/rig-a-jig.css',
  ]) {
    assert.ok(inventory.split('\n').includes(`copy+require\t${path}`), path);
  }
  const html = await readFile('src/pages/rig-a-jig.html', 'utf8');
  assert.match(html, /rig-a-jig-app\.js/);
  assert.match(html, /id="zooTitle"/);
});
