import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readRustResonatorSiteReference as readFile } from './helpers/simd-resonator-rust-site-reference.mjs';
import test from 'node:test';
import { fractalImpulseRuntimeChanges, restoreFractalImpulseRuntime } from './helpers/fractal-delay-impulse-runtime-reference.mjs';
const digest = source => createHash('sha256').update(source).digest('hex');

test('impulse additions reverse to captured main; historical guards keep their hashes', async () => {
  assert.equal(fractalImpulseRuntimeChanges.baseCommit, '1bc6b61c428ff6a77ae9120bb71131a59bbd63dc');
  assert.deepEqual(fractalImpulseRuntimeChanges.changes.map(change => change.file),
    ['scripts/site/runtime-files.tsv', 'src/site/tap-tempo-targets.js']);
  for (const { file, addition, sha256 } of fractalImpulseRuntimeChanges.changes) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const restored = restoreFractalImpulseRuntime(source, file);
    assert.equal(digest(restored), sha256);
    assert.equal(restoreFractalImpulseRuntime(restored, file, { allowRestored: true }), restored);
    for (const value of ['', addition.replace('fractal-delay', 'unknown'), addition.slice(0, -2)]) {
      const changed = source.replace(addition, value);
      assert.throws(() => restoreFractalImpulseRuntime(changed, file), /exact Fractal Delay impulse/);
      if(value) assert.notEqual(digest(restoreFractalImpulseRuntime(changed, file, {allowRestored:true})), sha256);
    }
    for(const options of [{},{allowRestored:true}])
      assert.throws(() => restoreFractalImpulseRuntime(source + addition, file, options), /exact Fractal Delay impulse/);
    const drift='\n// unrelated drift\n';
    assert.equal(restoreFractalImpulseRuntime(source+drift, file),restored+drift);
    assert.notEqual(digest(restored+drift),sha256);
    assert.equal(restoreFractalImpulseRuntime(source, 'unknown.js'), source);
    const binary=Buffer.from(source);
    assert.equal(restoreFractalImpulseRuntime(binary,file),binary);
  }
});
