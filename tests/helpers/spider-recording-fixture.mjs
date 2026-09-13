import { readFileSync } from 'node:fs';
import { SPIDER_RECORDINGS } from '../../src/spider-synth-recordings.js';

// The authored assets are small PCM WAVs. Keep the real samples in DSP tests;
// an invented sine wave cannot establish that the licensed sources play.
export const spiderRecordingFixture = SPIDER_RECORDINGS.map(record => {
  const bytes = readFileSync(new URL(`../../assets/audio/spider-synth/${record.id}.wav`, import.meta.url));
  const data = new Float32Array((bytes.length - 44) / 2);
  for (let i = 0; i < data.length; i++) data[i] = bytes.readInt16LE(44 + i * 2) / 32768;
  return { id: record.id, data, sampleRate: bytes.readUInt32LE(24) };
});
