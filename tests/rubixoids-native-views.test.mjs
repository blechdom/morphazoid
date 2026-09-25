import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { RUBIXOIDS_VIEWS } from '../src/instruments/rubixoids/native-views.js';

const root = new URL('../', import.meta.url);
const migration = JSON.parse(await readFile(new URL('tests/fixtures/rubixoids-migration-inventory.json', root), 'utf8'));
const ownedRoot = new URL('src/instruments/rubixoids/', root);
const sharedMidiRouting = new URL('src/instruments/wax/wax-midi-routing.js', root).pathname;

function ids(markup) {
  const result = new Map();
  for (const [, tag, attributes] of markup.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const id = attributes.match(/(?:^|\s)id="([^"]+)"/)?.[1];
    if (!id) continue;
    assert.ok(!result.has(id), `duplicate control or status ID: ${id}`);
    result.set(id, tag.toLowerCase());
  }
  return result;
}

for (const [dimension, original] of Object.entries(migration.dimensions)) {
  test(`${dimension} preserves its migration inventory while owning its view and styles`, () => {
    assert.equal(migration.version, 1);
    const view = RUBIXOIDS_VIEWS[dimension];
    assert.equal(view.id, original.id);
    assert.equal(view.pageClass, original.pageClass);
    const controls = ids(view.markup);
    // The frozen inventory records the migration boundary. It protects retained
    // capabilities while allowing new controls and independent UI development.
    for (const [id, tag] of Object.entries(original.ids)) {
      assert.equal(controls.get(id), tag, `${dimension} retains ${id}`);
    }
    for (const [id, tag] of Object.entries({
      audioButton: 'button', audioState: 'small', output: 'input', outputOut: 'output',
      playButton: 'button', tempo: 'input', liveStatus: 'p',
    })) assert.equal(controls.get(id), tag, `${dimension} retains ${id}`);
    assert.match(view.markup, /<div class="rubixoids-native-controls" hidden aria-hidden="true">/);
    assert.doesNotMatch(view.markup, /<(?:iframe|script)\b|\bclass="[^"]*\bmasthead\b/i);
    assert.ok(view.styles.includes(`/src/instruments/rubixoids/${original.id}/${original.id}.css`));
    for (const path of view.styles) {
      assert.doesNotMatch(path, /^\/src\/instruments\/(?!rubixoids\/)/, 'the app must own instrument styles');
    }
  });
}

async function runtimeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await runtimeFiles(path));
    else if (/\.(?:m?js|css)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function referencedPaths(source) {
  const paths = [];
  // Static/dynamic imports, re-exports, worklet URLs and stylesheet references.
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\bnew\s+URL\s*\(\s*|@import\s*)["']([^"']+)["']/g)) paths.push(match[1]);
  for (const match of source.matchAll(/url\(\s*["']?([^\s)'";]+)["']?\s*\)/g)) paths.push(match[1]);
  return paths;
}

test('Rubixoids runtime owns its instrument dependencies and may use shared site/audio infrastructure', async () => {
  for (const file of await runtimeFiles(ownedRoot)) {
    const source = await readFile(file, 'utf8');
    for (const reference of referencedPaths(source)) {
      if (!reference.startsWith('.') && !reference.startsWith('/')) continue;
      const resolved = reference.startsWith('/')
        ? new URL(reference.slice(1), root)
        : new URL(reference, file);
      const instrumentRoot = new URL('src/instruments/', root).pathname;
      if (!resolved.pathname.startsWith(instrumentRoot) || resolved.pathname === sharedMidiRouting) continue;
      assert.ok(resolved.pathname.startsWith(ownedRoot.pathname), `${file.pathname} depends on standalone instrument ${reference}`);
    }
  }
});
