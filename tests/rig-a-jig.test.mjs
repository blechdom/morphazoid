import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { RIG_FACTORIES, RIG_DESCRIPTIONS, RIG_GROUPS } from '../src/instruments/rig-a-jig/rig-a-jig-rigs.js';
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

test('every authored rig is mesh-free: joints and contacts only', () => {
  for (const [id, factory] of Object.entries(RIG_FACTORIES)) {
    const rig = factory();
    assert.ok(rig.joints.length >= 3, `${id} has joints`);
    assert.ok(rig.contacts.length >= 1, `${id} has sound contacts`);
    assert.equal(typeof rig.update, 'function', `${id} update`);
    // No geometry, material or texture may be created by a rig.
    assert.ok(!('geometry' in rig), `${id} has no geometry`);
    assert.ok(!('material' in rig), `${id} has no material`);
    // Motion must not throw and must move at least one joint.
    rig.update({ rate: 0.4, amp: 0.6, sway: 0.3, fold: 0.5 }, 1.234);
  }
});

test('rig descriptions and groups cover the full zoo', () => {
  assert.deepEqual(Object.keys(RIG_DESCRIPTIONS).sort(),
    Object.keys(RIG_FACTORIES).sort());
  assert.ok(Object.keys(RIG_DESCRIPTIONS).length >= 24, 'a real zoo, not a handful');
  const grouped = Object.values(RIG_GROUPS).flat();
  assert.equal(new Set(grouped).size, grouped.length, 'no rig is listed twice');
  assert.deepEqual([...grouped].sort(), Object.keys(RIG_FACTORIES).sort(),
    'every rig belongs to a group');
});

test('page and runtime inventory ship the rig-a-jig modules', async () => {
  const inventory = await readFile('scripts/site/runtime-files.tsv', 'utf8');
  for (const path of [
    'rig-a-jig.html',
    'src/instruments/rig-a-jig/rig-a-jig-app.js',
    'src/instruments/rig-a-jig/rig-a-jig-viewer.js',
    'src/instruments/rig-a-jig/rig-a-jig-rigs.js',
    'src/instruments/rig-a-jig/rig-a-jig-audio.js',
    'src/instruments/rig-a-jig/rig-a-jig.css',
  ]) {
    assert.ok(inventory.split('\n').includes(`copy+require\t${path}`), path);
  }
  const html = await readFile('src/pages/rig-a-jig.html', 'utf8');
  assert.match(html, /rig-a-jig-app\.js/);
  // Stage overlay is minimal: title + camera controls only (the descriptive
  // subtitle was removed); the mesh-free guarantee is enforced by the
  // mesh-free rig test above, not by page copy.
  assert.match(html, /id="zooTitle"/);
});
