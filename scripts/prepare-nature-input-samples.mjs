#!/usr/bin/env node
// Short, credited excerpts of recordings already bundled in Morphazoid.
// Development-time ffmpeg is used only to decode; the browser fetches local WAVs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(process.argv[2] ?? resolve(root, 'assets/input-samples/nature'));
const rate = 44100;
const sources = [
  { id: 'coyote-howl', source: 'coyote-chorus.ogg', start: 0, seconds: 12,
    title: 'Pack of coyotes howling', author: 'Rybkovich', license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Pack_of_coyotes_howling.ogg' },
  { id: 'frog-chorus', source: 'frog-soundscape.ogg', start: 0, seconds: 8,
    title: 'Frog sounds', author: 'Hughesdarren', license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Frog_sounds.ogg' },
  { id: 'humpback-song', source: 'humpback-whale-song.ogg', start: 1, seconds: 10,
    title: 'Humpbackwhale2', author: 'Spyrogumas', license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Humpbackwhale2.ogg' },
  { id: 'cricket-night', source: 'house-cricket.ogg', start: 0, seconds: 2.5,
    title: 'Acheta-domesticus-Stridulation', author: 'Morray', license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Acheta-domesticus-Stridulation.ogg' },
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
mkdirSync(directory, { recursive: true });
const recordings = sources.map(source => {
  const path = resolve(root, 'assets/bioacoustics', source.source);
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-ss', String(source.start),
    '-t', String(source.seconds), '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 16 * 1024 * 1024 });
  if (decoded.status !== 0) throw new Error(decoded.stderr.toString() || 'ffmpeg could not decode recording');
  const raw = decoded.stdout;
  const samples = Float32Array.from({ length: raw.length / 4 }, (_, i) => raw.readFloatLE(i * 4));
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const fadeFrames = Math.round(rate * .01);
  let peak = 0, energy = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (samples[i] - mean) * Math.min(1, i / fadeFrames, (samples.length - 1 - i) / fadeFrames);
    if (!Number.isFinite(samples[i])) throw new Error(`${source.id}: nonfinite audio`);
    peak = Math.max(peak, Math.abs(samples[i])); energy += samples[i] ** 2;
  }
  if (!(energy > 0)) throw new Error(`${source.id}: empty recording`);
  const gain = Math.min(.16 / Math.sqrt(energy / samples.length), .78 / peak);
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) bytes.writeInt16LE(Math.round(samples[i] * gain * 32767), 44 + i * 2);
  const filename = `${source.id}.wav`;
  writeFileSync(resolve(directory, filename), bytes);
  return { ...source, file: filename, sourcePath: `assets/bioacoustics/${source.source}`,
    sourceSha256: sha256(readFileSync(path)), sha256: sha256(bytes), sampleRate: rate,
    duration: samples.length / rate, gainDb: 20 * Math.log10(gain),
    modifications: 'Excerpt, mono downmix, resample to 44.1 kHz, DC removal, 10 ms edge fades and one static gain; no compression.' };
});
writeFileSync(resolve(directory, 'sources.json'), JSON.stringify({ recordings }, null, 2) + '\n');
console.log(`Prepared ${recordings.length} short nature recordings in ${directory}`);
