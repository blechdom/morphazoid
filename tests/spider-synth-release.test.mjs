import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fingerprintSpiderSynth } from '../scripts/fingerprint-spider-synth.mjs';

test('Spider releases keep worklet, motion, scan and rig metadata cache versions coherent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spider-release-'));
  try {
    await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'assets/spider-synth'), { recursive: true });
    const model = path.join(root, 'assets/spider-synth/spider-mobile.glb'), rig = path.join(root, 'assets/spider-synth/rig-manifest.json');
    await writeFile(model, new Uint8Array([1,2,3,4])); await writeFile(rig, '{"version":1}');
    const fixture = {
      'spider-synth.html': '<link href="spider-synth.css"><script src="spider-synth-app.js"></script>',
      'spider-synth.css': 'body { color: gold; }',
      'spider-synth-app.js': "import './src/spider-synth-audio.js'; import './src/spider-synth-model.js'; import './src/spider-synth-viewer.js';",
      'src/spider-synth-viewer.js': "new URL('../assets/spider-synth/spider-mobile.glb', import.meta.url); new URL('../assets/spider-synth/rig-manifest.json', import.meta.url);",
      'src/spider-synth-audio.js': "new URL('./spider-synth-processor.js', import.meta.url);",
      'src/spider-synth-processor.js': "import './spider-synth-dsp.js';",
      'src/spider-synth-dsp.js': "import './spider-synth-model.js'; export const gain = 1;",
      'src/spider-synth-model.js': 'export const beat = 1;',
      'src/spider-synth-specimen-data.js': 'export const skins = ["../assets/spider-synth/skins/golden/spider-mobile.glb", "../assets/spider-synth/skins/golden/rig-manifest.json"];',
      'src/spider-synth-recordings.js': 'export const recording = "../assets/audio/spider-synth/peacock-rumble.wav";',
    };
    const skinDirectory = path.join(root, 'assets/spider-synth/skins/golden');
    const recordingDirectory = path.join(root, 'assets/audio/spider-synth');
    await mkdir(skinDirectory, { recursive: true }); await mkdir(recordingDirectory, { recursive: true });
    await writeFile(path.join(skinDirectory, 'spider-mobile.glb'), new Uint8Array([8,9,10]));
    await writeFile(path.join(skinDirectory, 'rig-manifest.json'), '{"species":"golden"}');
    await writeFile(path.join(recordingDirectory, 'peacock-rumble.wav'), new Uint8Array([11,12,13]));
    for (const [name, source] of Object.entries(fixture)) await writeFile(path.join(root, name), source);
    const first = await fingerprintSpiderSynth(root); assert.deepEqual(await fingerprintSpiderSynth(root), first);
    await writeFile(path.join(root, 'src/spider-synth-model.js'), 'export const beat = 2;');
    const next = await fingerprintSpiderSynth(root); assert.notEqual(next.version, first.version); assert.equal(next.modelVersion, first.modelVersion); assert.equal(next.rigVersion, first.rigVersion);
    for (const name of ['spider-synth.html', 'spider-synth-app.js', 'src/spider-synth-audio.js', 'src/spider-synth-dsp.js']) {
      const source = await readFile(path.join(root, name), 'utf8'); assert.ok(source.includes(`?v=${next.version}`)); assert.ok(!source.includes(`?v=${first.version}`));
    }
    await writeFile(rig, '{"version":2}'); const rigRelease = await fingerprintSpiderSynth(root);
    assert.notEqual(rigRelease.version, next.version); assert.notEqual(rigRelease.rigVersion, next.rigVersion); assert.equal(rigRelease.modelVersion, next.modelVersion);
    const viewer = await readFile(path.join(root, 'src/spider-synth-viewer.js'), 'utf8');
    assert.ok(viewer.includes(`rig-manifest.json?v=${rigRelease.rigVersion}`));
    await writeFile(model, new Uint8Array([1,2,3,5])); const changed = await fingerprintSpiderSynth(root);
    assert.notEqual(changed.modelVersion, rigRelease.modelVersion); assert.notEqual(changed.version, rigRelease.version);
    assert.equal(changed.rigVersion, rigRelease.rigVersion);
    const skinBefore = await readFile(path.join(root, 'src/spider-synth-specimen-data.js'), 'utf8');
    const sampleBefore = await readFile(path.join(root, 'src/spider-synth-recordings.js'), 'utf8');
    assert.ok(!skinBefore.includes(`spider-mobile.glb?v=${changed.modelVersion}`), 'each scan has its own cache identity');
    await writeFile(path.join(recordingDirectory, 'peacock-rumble.wav'), new Uint8Array([11,12,14]));
    const sampleRelease = await fingerprintSpiderSynth(root);
    assert.notEqual(sampleRelease.version, changed.version);
    assert.equal(sampleRelease.modelVersion, changed.modelVersion);
    assert.equal(await readFile(path.join(root, 'src/spider-synth-specimen-data.js'), 'utf8'), skinBefore);
    assert.notEqual(await readFile(path.join(root, 'src/spider-synth-recordings.js'), 'utf8'), sampleBefore);
    assert.deepEqual(await fingerprintSpiderSynth(root), sampleRelease);
  } finally { await rm(root, { recursive: true, force: true }); }
});
