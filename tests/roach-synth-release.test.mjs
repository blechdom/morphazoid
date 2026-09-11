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
    const fixture = {
      'roach-synth.html': '<link href="roach-synth.css"><script src="roach-synth-app.js"></script>',
      'roach-synth.css': 'body { color: green; }',
      'roach-synth-app.js': "import './src/roach-synth-audio.js'; import './src/roach-synth-motion.js';",
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
    for (const name of Object.keys(fixture).filter(name => name.endsWith('.html') || /app|audio|processor|dsp/.test(name))) {
      const source = await readFile(path.join(root, name), 'utf8');
      assert.ok(source.includes(`?v=${next.version}`), `${name} uses the new release`);
      assert.ok(!source.includes(`?v=${first.version}`), `${name} does not mix cached releases`);
    }
    assert.ok((await readFile(path.join(root, 'src/roach-synth-audio.js'), 'utf8')).includes("'../assets/roach-synth/cockroach.glb'"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
