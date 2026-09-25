import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { rewriteModulePaths } from '../scripts/architecture/module-paths.mjs';
import { readRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';

const root = new URL('../', import.meta.url);
const proof = JSON.parse(await readFile(new URL('tests/fixtures/rubixoids-owned-runtime.json', root), 'utf8'));
const ownedPrefix = 'src/instruments/rubixoids/';
const inverse = Object.fromEntries(Object.entries(proof.moves).map(([before, after]) => [after, before]));
const sha256 = value => createHash('sha256').update(value).digest('hex');

// This is an inverse of recorded path changes, not a donor lookup. Shared
// resource namespaces remain recognizable even if every standalone donor is
// edited or removed. Runtime availability is checked by the release manifest.
const knownResource = target => target.startsWith(ownedPrefix)
  || (!target.startsWith('src/instruments/') && /^(?:src|assets|vendor|scripts)\//.test(target));

test('owned Rubixoids runtime reverses exactly to frozen migration bytes without reading standalone sources', async () => {
  assert.equal(proof.version, 1);
  assert.equal(proof.files.length, Object.keys(proof.moves).length);
  assert.equal(new Set(proof.files.map(record => record.before)).size, proof.files.length);
  assert.equal(new Set(proof.files.map(record => record.after)).size, proof.files.length);
  for (const record of proof.files) {
    assert.equal(proof.moves[record.before], record.after);
    assert.ok(record.after.startsWith(ownedPrefix), record.after);
    assert.notEqual(record.before, record.after);
    assert.match(record.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(record.copySha256, /^[a-f0-9]{64}$/);
    let copied = await readFile(new URL(record.after, root), 'utf8');
    for (const amendment of [...(record.amendments ?? [])].reverse()) {
      assert.equal(typeof amendment.before, 'string');
      assert.equal(typeof amendment.after, 'string');
      assert.ok(amendment.after.length > 0, `${record.after}: amendment must identify exact nonempty bytes`);
      assert.equal(copied.split(amendment.after).length - 1, 1, `${record.after}: exactly one reviewed amendment`);
      copied = copied.replace(amendment.after, amendment.before);
    }
    assert.equal(Buffer.byteLength(copied), record.copyBytes, `${record.after}: frozen copy size`);
    assert.equal(sha256(copied), record.copySha256, `${record.after}: frozen copy hash after reviewed amendments`);
    const restored = rewriteModulePaths(copied, record.after, inverse, { exists: knownResource });
    assert.equal(Buffer.byteLength(restored), record.sourceBytes, `${record.after}: restored donor size`);
    assert.equal(sha256(restored), record.sourceSha256, `${record.after}: exact inverse-import byte preservation`);
  }
});

async function runtimeFiles(directory, prefix) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await runtimeFiles(new URL(`${entry.name}/`, directory), `${relative}/`));
    else if (/\.(?:m?js|css|json|wasm|svg|webp|png|woff2?|wav|mp3|ogg)$/.test(entry.name)) files.push(relative);
  }
  return files;
}

test('every Rubixoids-owned runtime file has explicit copy and required release inclusion', async () => {
  const manifest = await readRuntimeManifest(new URL('scripts/site/runtime-files.tsv', root));
  const entries = new Map(manifest.entries.map(entry => [entry.path, entry]));
  const files = await runtimeFiles(new URL(ownedPrefix, root), ownedPrefix);
  for (const file of new Set([...files, ...proof.files.map(record => record.after)])) {
    assert.equal(entries.get(file)?.copy, true, `${file}: copied into release builds`);
    assert.equal(entries.get(file)?.required, true, `${file}: required in release builds`);
  }
});
