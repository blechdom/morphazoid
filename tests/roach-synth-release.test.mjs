import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fingerprintRoachSynth } from '../scripts/fingerprint-roach-synth.mjs';

test('Roach releases carry shared motion and worklet changes through the cached page module graph', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'roach-release-'));
  try {
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'assets/roach-synth'), { recursive: true });
    const modelPath = path.join(root, 'assets/roach-synth/cockroach-mobile.glb');
    await writeFile(modelPath, new Uint8Array([1, 2, 3, 4]));
    const fixture = {
      'roach-synth.html': '<link href="roach-synth.css"><script src="roach-synth-app.js"></script>',
      'roach-synth.css': 'body { color: green; }',
      'roach-synth-app.js': "import './src/roach-synth-audio.js'; import './src/roach-synth-motion.js'; new URL('./assets/roach-synth/cockroach-mobile.glb', import.meta.url);",
      'src/roach-synth-audio.js': "new URL('./roach-synth-processor.js', import.meta.url); new URL('../assets/roach-synth/cockroach.glb', import.meta.url);",
      'src/roach-synth-processor.js': "import './roach-synth-dsp.js';",
      'src/roach-synth-dsp.js': "import './roach-synth-motion.js'; export const gain = 1;",
      'src/roach-synth-motion.js': 'export const beat = 1;',
    };
    for (const [name, source] of Object.entries(fixture)) await writeFile(path.join(root, name), source);
    const first = await fingerprintRoachSynth(root);
    assert.equal((await fingerprintRoachSynth(root)).version, first.version, 'repeated build is deterministic');
    await writeFile(path.join(root, 'src/roach-synth-motion.js'), 'export const beat = 2;');
    const next = await fingerprintRoachSynth(root);
    assert.notEqual(next.version, first.version, 'motion change invalidates both renderer and audio consumers');
    assert.equal(next.modelVersion, first.modelVersion, 'sound changes keep the large model cached');
    for (const name of Object.keys(fixture).filter(name => name.endsWith('.html') || /app|audio|processor|dsp/.test(name))) {
      const source = await readFile(path.join(root, name), 'utf8');
      assert.ok(source.includes(`?v=${next.version}`), `${name} uses the new release`);
      assert.ok(!source.includes(`?v=${first.version}`), `${name} does not mix cached releases`);
    }
    assert.ok((await readFile(path.join(root, 'src/roach-synth-audio.js'), 'utf8')).includes("'../assets/roach-synth/cockroach.glb'"));
    assert.ok((await readFile(path.join(root, 'roach-synth-app.js'), 'utf8')).includes(`cockroach-mobile.glb?v=${next.modelVersion}`));
    await writeFile(modelPath, new Uint8Array([1, 2, 3, 5]));
    const modelRelease = await fingerprintRoachSynth(root);
    assert.notEqual(modelRelease.version, next.version, 'a model-only release cannot reuse the old browser cache entry');
    assert.notEqual(modelRelease.modelVersion, next.modelVersion);
    assert.ok((await readFile(path.join(root, 'roach-synth-app.js'), 'utf8')).includes(`cockroach-mobile.glb?v=${modelRelease.modelVersion}`));
  } finally { await rm(root, { recursive: true, force: true }); }
});
