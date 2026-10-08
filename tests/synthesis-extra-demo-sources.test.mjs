import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EXTRA_DEMO_SOURCES } from '../src/instruments/synthesis/extra-demo-sources.js';
import { PROCESSING_INPUT_OPTIONS, loadProcessingDemo } from '../src/instruments/synthesis/demo-sources.js';

const root = new URL('../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originalIds = ['sample-drums', 'music-bass', 'music-keys', 'music-plucks', 'music-arp', 'voice-bdl', 'voice-slt', 'speech', 'birdsong'];

function audioBuffer(channels, length, sampleRate) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: c => data[c] };
}
function decodeWav(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt16LE(20), 1);
  assert.equal(bytes.readUInt16LE(34), 16);
  const channels = bytes.readUInt16LE(22), rate = bytes.readUInt32LE(24);
  const result = audioBuffer(channels, bytes.readUInt32LE(40) / (channels * 2), rate);
  for (let i = 0; i < result.length; i++) for (let c = 0; c < channels; c++) {
    result.getChannelData(c)[i] = bytes.readInt16LE(44 + (i * channels + c) * 2) / 32768;
  }
  return result;
}
function stats(buffer) {
  let peak = 0, energy = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) for (const value of buffer.getChannelData(c)) {
    assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); energy += value ** 2;
  }
  return { peak, rms: Math.sqrt(energy / (buffer.length * buffer.numberOfChannels)) };
}

test('24 additional demos preserve existing choices and include the requested sound families', () => {
  const demos = PROCESSING_INPUT_OPTIONS.filter(option => option.kind === 'demo');
  assert.equal(EXTRA_DEMO_SOURCES.length, 24);
  assert.equal(demos.length, originalIds.length + 24 + 1);
  assert.deepEqual(demos.slice(0, originalIds.length).map(option => option.id), originalIds);
  for (const id of ['speech-curling', 'nature-coyote-howl', 'fx-sad-trombone', 'fx-record-scratch', 'music-unicorn-sparkles',
    'music-tabla', 'music-toy-gamelan', 'music-clockwork-chamber', 'music-rockabilly-drive', 'music-country-front-porch', 'music-neon-synth-pop']) {
    assert.ok(demos.some(option => option.id === id), id);
  }
  for (const demo of EXTRA_DEMO_SOURCES) {
    assert.ok(Object.isFrozen(demo) && Object.isFrozen(demo.paths));
    assert.ok(demo.credit && demo.creditPath);
    assert.ok(!/^https?:/.test(demo.paths[0]), 'playback uses bundled assets');
  }
});

test('every additional asset is small, unique, credited and declared for both release targets', () => {
  const inventory = readFileSync(new URL('scripts/site/runtime-files.tsv', root), 'utf8').split('\n');
  const nature = json('assets/input-samples/nature/sources.json').recordings;
  const recorded = json('assets/input-samples/recorded/provenance.json').samples;
  const rendered = json('assets/synthesis/extra-loops/renders.json').loops;
  const signatures = new Set();
  let bytesTotal = 0;
  for (const demo of EXTRA_DEMO_SOURCES) {
    const path = `assets/${demo.paths[0]}`, bytes = readFileSync(new URL(path, root));
    assert.ok(bytes.length > 1000 && bytes.length < 2 * 1024 * 1024, `${demo.id}: bounded download`);
    signatures.add(hash(bytes)); bytesTotal += bytes.length;
    for (const declared of [path, `assets/${demo.creditPath}`]) {
      assert.equal(inventory.filter(line => line === `copy+require\t${declared}`).length, 1, declared);
      assert.ok(statSync(new URL(declared, root)).size > 0);
    }
    const provenance = demo.id.startsWith('nature-') ? nature.find(entry => `nature-${entry.id}` === demo.id)
      : demo.paths[0].startsWith('input-samples/recorded/') ? recorded.find(entry => entry.id === demo.id)
      : rendered.find(entry => entry.publicId === demo.id);
    assert.ok(provenance, `${demo.id}: provenance`);
    assert.equal(hash(bytes), provenance.sha256);
    if (demo.id.startsWith('nature-')) {
      assert.equal(hash(readFileSync(new URL(provenance.sourcePath, root))), provenance.sourceSha256);
      assert.match(provenance.licenseUrl, /^https:\/\/creativecommons.org\//);
      assert.ok(provenance.author && provenance.modifications);
    } else if (demo.paths[0].endsWith('.mp3')) {
      assert.equal(provenance.license, 'CC0-1.0');
      assert.ok(provenance.sources.length >= 1 && provenance.modifications.length >= 1);
      for (const source of provenance.sources) {
        assert.ok(source.creator && source.title && source.downloadSha256);
        assert.match(source.licenseEvidenceUrl, /^https:\/\/freesound.org\//);
        assert.equal(source.license, 'CC0-1.0');
      }
    }
  }
  assert.equal(signatures.size, 24, 'different labels contain different audio');
  assert.ok(bytesTotal < 18 * 1024 * 1024, 'the entire added bank stays compact and loads lazily');
});

test('prepared original loops retain musical duration and short natural clips have a release gap', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, arrayBuffer: async () => readFileSync(url) });
  t.after(() => { globalThis.fetch = originalFetch; });
  const context = { sampleRate: 44100, createBuffer: audioBuffer, decodeAudioData: async bytes => decodeWav(bytes) };
  const manifest = json('assets/synthesis/extra-loops/renders.json');
  assert.equal(manifest.wasmSha256, hash(readFileSync(new URL('assets/wasm/synthesis.wasm', root))));
  assert.equal(manifest.scriptSha256, hash(readFileSync(new URL('scripts/render-synthesis-extra-loops.mjs', root))));
  for (const demo of EXTRA_DEMO_SOURCES.filter(demo => demo.paths[0].endsWith('.wav'))) {
    const original = decodeWav(readFileSync(new URL(`assets/${demo.paths[0]}`, root)));
    const before = hash(Buffer.from(original.getChannelData(0).buffer));
    context.decodeAudioData = async () => original;
    const { buffer, credit, creditUrl } = await loadProcessingDemo(context, demo.id);
    assert.equal(hash(Buffer.from(original.getChannelData(0).buffer)), before, 'loader preserves original PCM');
    assert.equal(credit, demo.credit); assert.match(creditUrl, /CREDITS\.md$/);
    const { peak, rms } = stats(buffer);
    assert.ok(peak <= .82001 && peak > .1, `${demo.id}: bounded audible signal`);
    assert.ok(rms > .01 && rms <= .16001, `${demo.id}: useful average level`);
    assert.equal(buffer.numberOfChannels, original.numberOfChannels);
    if (demo.loop) {
      const recipe = manifest.loops.find(entry => entry.publicId === demo.id);
      assert.equal(buffer.length, recipe.frames, 'no pause is inserted into a musical bar');
      assert.ok(Math.abs(buffer.duration - recipe.beats * 60 / recipe.bpm) <= 1 / buffer.sampleRate);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        assert.ok(Math.abs(data[0] - data.at(-1)) < .012, `${demo.id}: continuous join`);
      }
    } else {
      assert.equal(buffer.length, original.length + Math.round(original.sampleRate * .35));
      assert.ok(buffer.getChannelData(0).subarray(original.length).every(value => value === 0));
    }
  }
});
