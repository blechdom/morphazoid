import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CATALOGUE_GROUPS, catalogueItemById, instrumentById } from '../src/site/instrument-catalog.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';

const root = new URL('../', import.meta.url);

test('Rig Lab is one browseable Work in Progress lab, not seven registered instruments', () => {
  const item = catalogueItemById('rig-lab');
  assert.ok(item);
  assert.equal(item.entryType, 'lab');
  assert.equal(item.status, 'Work in Progress');
  assert.equal(item.href, 'rig-lab.html');
  assert.deepEqual(item.tags.map(tag => tag.id), ['wip', '3d', 'geometric']);
  assert.ok(CATALOGUE_GROUPS.find(group => group.id === 'wip')?.tools.includes(item));
  assert.equal(instrumentById('rig-lab'), null);
  assert.equal(instrumentMidiCapabilityForId('rig-lab'), null);
  assert.ok(CANONICAL_PAGE_ROUTES.includes('rig-lab.html'));
});

test('Rig Lab models, licenses and runtime modules are explicitly required in the release', async () => {
  const inventory = await readFile(new URL('scripts/site/runtime-files.tsv', root), 'utf8');
  for (const path of [
    'assets/rig-lab/SOURCE.LICENSE.txt',
    'assets/rig-lab/ant-vfx.glb', 'assets/rig-lab/worker-ant.glb',
    'assets/rig-lab/mosquito-rig.glb', 'assets/rig-lab/peacock-moth.glb',
    'assets/rig-lab/octopus-rig.glb', 'assets/rig-lab/pancake-stack.glb',
    'assets/rig-lab/spatula.glb', 'assets/rig-lab/butter.glb',
    'src/families/rig-lab/demo-app.js',
    'src/families/rig-lab/procedural-models.js',
    'src/instruments/octopus/demo-skins.js',
    'src/instruments/voronoi-foam/demo-model.js',
    'src/instruments/polyhedral-lattice/demo-model.js',
  ]) {
    assert.ok(inventory.split('\n').includes(`copy+require\t${path}`), path);
  }
  const html = await readFile(new URL('src/pages/rig-lab.html', root), 'utf8');
  assert.match(html, /assets\/rig-lab\/SOURCE\.LICENSE\.txt/);
  assert.match(html, /src\/families\/rig-lab\/demo-app\.js/);
});
