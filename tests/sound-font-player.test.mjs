import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeSoundFont, generateSample, parseSoundFont } from '../src/site/sound-fonts/soundfont.js';

let Processor;
globalThis.sampleRate = 44100;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; } };
globalThis.registerProcessor = (_name, Type) => { Processor = Type; };
await import('../src/sound-fonts/player-processor.js');

const buffer = data => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
function render(processor, seconds) {
  let peak = 0, energy = 0;
  const channels = [new Float32Array(128), new Float32Array(128)];
  for (let i = 0; i < Math.ceil(seconds * sampleRate / 128); i++) {
    channels.forEach(channel => channel.fill(0));
    assert.equal(processor.process([], [channels]), true);
    for (const channel of channels) for (const value of channel) {
      assert.ok(Number.isFinite(value), 'finite output');
      peak = Math.max(peak, Math.abs(value)); energy += value * value;
    }
  }
  assert.ok(peak <= 0.981, 'bounded output');
  return { peak, energy };
}

test('reusable processor renders a created SF2, releases notes, and tears down', async () => {
  const processor = new Processor();
  const bytes = encodeSoundFont({ name: 'Shared glass', samples: [{ data: generateSample({ kind: 'glass', duration: .3 }) }] });
  await processor.command({ type: 'load', bytes });
  assert.ok(processor.messages.some(message => message.type === 'ready'));
  assert.equal(render(processor, .03).peak, 0, 'loading does not start a note');
  await processor.command({ type: 'on', note: 60, velocity: 96 });
  assert.ok(render(processor, .2).peak > .02, 'actual engine produces a signal');
  await processor.command({ type: 'off', note: 60 });
  render(processor, 2);
  await processor.command({ type: 'stop' });
  render(processor, 3);
  assert.ok(render(processor, .1).peak < .001, 'tails decay after stop');
  await processor.command({ type: 'dispose' });
  assert.equal(processor.process([], [[new Float32Array(128), new Float32Array(128)]]), false);
});

test('full player selects GM piano and channel-10-style drum presets by bank/program', async () => {
  const processor = new Processor();
  const bytes = buffer(await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url)));
  await processor.command({ type: 'load', bytes });
  await processor.command({ type: 'preset', bank: 0, program: 0 });
  await processor.command({ type: 'on', note: 60, velocity: 100 });
  const piano = render(processor, .2);
  await processor.command({ type: 'stop' });
  render(processor, 2);
  await processor.command({ type: 'preset', bank: 128, program: 0 });
  await processor.command({ type: 'on', note: 38, velocity: 100 });
  const drum = render(processor, .2);
  assert.ok(piano.peak > .005 && drum.peak > .005, 'both presets are audible');
  assert.notEqual(piano.energy, drum.energy, 'the two selected presets render different signals');
  await processor.command({ type: 'dispose' });
});

test('metadata reads preserve all GM presets without allocating the decoded sample pool', async () => {
  const bytes = buffer(await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url)));
  const metadata = parseSoundFont(bytes, { metadataOnly: true });
  assert.equal(metadata.format, 'sf2');
  assert.equal(metadata.presets.filter(preset => preset.bank === 0).length, 128);
  assert.ok(metadata.presets.some(preset => preset.bank === 128));
  assert.ok(metadata.samples.every(sample => sample.data.length <= 4096), 'waveforms are bounded');
  assert.deepEqual(metadata.warnings, [], 'the full renderer does not use PCM preview limitations');
});

test('switching from drums preserves GS variation banks and extended bank LSB addresses', async () => {
  const original = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
  const firstPreset = original.indexOf(Buffer.from('phdr')) + 8;
  for (const bank of [1, 256]) {
    const bytes = buffer(original), header = new DataView(bytes);
    // Give the real flute sample its own piano-program variation while retaining
    // TimGM's acoustic piano at 0:0 and standard drum kit at 128:0.
    header.setUint16(firstPreset + 20, 0, true); header.setUint16(firstPreset + 22, bank, true);
    const processor = new Processor();
    try {
      await processor.command({ type: 'load', bytes });
      for (const priorBank of [0, 128]) {
        await processor.command({ type: 'preset', bank: priorBank, program: 0 });
        await processor.command({ type: 'preset', bank, program: 0 });
        const channel = processor.synth.midiChannels[0];
        assert.equal(channel.preset.name, 'Flute TB', `bank ${bank} must not fall back to bank-zero piano after ${priorBank}`);
        assert.equal(channel.preset.isDrum, false);
        assert.equal(channel.patch.bankMSB, bank === 1 ? 1 : 0);
        assert.equal(channel.patch.bankLSB, bank === 256 ? 1 : 0);
      }
    } finally { await processor.command({ type: 'dispose' }); }
  }
});

test('GeneralUser XG bank-120 aliases select their exact percussion patch after GM drums', async () => {
  const catalog = JSON.parse(await readFile(new URL('../assets/sound-fonts/catalog.json', import.meta.url)));
  const asset = catalog.find(bank => bank.id === 'generaluser-gs');
  assert.ok(asset, 'the bundled GeneralUser bank is registered');
  const processor = new Processor();
  try {
    await processor.command({ type: 'load', bytes: buffer(await readFile(new URL(`../${asset.file}`, import.meta.url))) });
    await processor.command({ type: 'preset', bank: 128, program: 0 });
    await processor.command({ type: 'preset', bank: 120, program: 25 });
    const channel = processor.synth.midiChannels[0];
    assert.equal(channel.preset.name, '808/909 Kit');
    assert.equal(channel.preset.bankMSB, 120);
    assert.equal(channel.preset.isGMGSDrum, false);
    assert.equal(channel.preset.isDrum, true);
    assert.equal(channel.getSnapshot().drumChannel, true, 'XG alias retains drum performance semantics');
    await processor.command({ type: 'on', note: 38, velocity: 100 });
    assert.ok(render(processor, .2).peak > .005);
  } finally { await processor.command({ type: 'dispose' }); }
});
