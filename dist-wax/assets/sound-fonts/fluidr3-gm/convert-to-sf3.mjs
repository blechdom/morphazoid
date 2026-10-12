// Offline asset conversion; not imported by the browser application.
// Usage: node convert-to-sf3.mjs input.sf2 output.sf3 /path/to/spessasynth_core/dist/index.js
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [input, output, coreModule] = process.argv.slice(2);
if (!input || !output || !coreModule) throw new Error('Provide input.sf2, output.sf3 and pinned SpessaSynth Core module path.');
const bytes = await readFile(input);
const expected = '74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0';
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Input does not match the original FluidR3 GM 3.1.');
const { SoundBankLoader } = await import(pathToFileURL(resolve(coreModule)).href);
const bank = SoundBankLoader.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

function encode(audio, sampleRate) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0', '-map_metadata', '-1', '-c:a', 'libvorbis', '-q:a', '5', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-f', 'ogg', 'pipe:1']);
    const chunks = [];
    const errors = [];
    child.stdout.on('data', data => chunks.push(data));
    child.stderr.on('data', data => errors.push(data));
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', code => code === 0 ? resolvePromise(new Uint8Array(Buffer.concat(chunks))) : reject(new Error(`FFmpeg exited ${code}: ${Buffer.concat(errors)}`)));
    child.stdin.end(Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength));
  });
}

// Bound concurrent encoder processes and decoded sample memory.
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < bank.samples.length) {
    const sample = bank.samples[cursor++];
    await sample.compressSample(encode);
    if (!sample.isCompressed) throw new Error(`Compression failed: ${sample.name}`);
  }
}));
bank.soundBankInfo.version = { major: 3, minor: 0 };
const converted = bank.writeSF2({ software: 'SpessaSynth Core 4.3.22 / FFmpeg 6.1.1 libvorbis q5', writeDefaultModulators: false, writeExtendedLimits: false });
await writeFile(output, new Uint8Array(converted));
console.log(JSON.stringify({ presets: bank.presets.length, samples: bank.samples.length, bytes: converted.byteLength, sha256: createHash('sha256').update(new Uint8Array(converted)).digest('hex') }));
