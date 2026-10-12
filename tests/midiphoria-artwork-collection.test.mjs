import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import { createGunzip } from 'node:zlib';

const base = new URL('../assets/midiphoria/', import.meta.url);
const collection = JSON.parse(await readFile(new URL('collection.json', base), 'utf8'));
const validation = JSON.parse(await readFile(new URL('archives/decorative-validation-20261012.json', base), 'utf8'));
const artwork = collection.filter(item => item.compression === 'gzip');

// Counts independently obtained from every original with inspect-midi.py,
// excluding velocity-zero Note On releases. Raw SHA-256 checks below bind the
// validation record to actual unchanged MIDI bytes without parsing millions of notes
// or allocating note objects in the ordinary repository test suite.
const verifiedAttacks = {
  'black-bleed-chasing-wind-full': 775128,
  'black-bleed-looking-to-the-moon-full': 346781,
  'black-bleed-seven-red-suns-full': 849536,
  'black-bleed-sliver-of-straw-full': 3000000,
  'black-bleed-unparalleled-innocence-full': 1596265,
  'black-bleed-dnca-full': 2299967,
  'black-bleed-fmk30tp-full': 1033135,
  'black-bleed-jbsmg-full': 3824595,
  'black-bleed-swmg-full': 3074790,
  'black-bleed-a-soul-of-steel-full': 9388159,
  'black-bleed-judgement-day-full': 6654566,
  'black-bleed-lightstorm-full': 22866471,
  'black-bleed-mournful-camaraderie-full': 1349347,
  'black-bleed-twin-nemesis-full': 6120386,
  'black-bleed-uvb-76-the-buzzer-full': 1030149,
  'black-bleed-winter-s-rage-full': 1677777,
  'black-bleed-five-pebbles-full': 4065202,
  'black-bleed-update-full': 455179,
  'black-bleed-winter-s-pain-full': 872471,
  'black-hans-stereo-madness': 1138915,
  'black-hans-yiay-final2': 930184,
  'black-hans-yiay-one-million': 1000000,
};

test('the full artwork collection retains exact compressed and original MIDI bytes', async () => {
  assert.equal(artwork.length, 22);
  assert.deepEqual(artwork.map(item => item.id).sort(), Object.keys(verifiedAttacks).sort());
  assert.equal(artwork.reduce((total, item) => total + item.bytes, 0), 57110489);
  for (const item of artwork) {
    const compressedHash = createHash('sha256');
    const rawHash = createHash('sha256');
    let compressedBytes = 0;
    let rawBytes = 0;
    let header = Buffer.alloc(0);
    await pipeline(
      createReadStream(new URL(item.file, base)),
      new Transform({ transform(chunk, encoding, callback) {
        compressedBytes += chunk.length;
        compressedHash.update(chunk);
        callback(null, chunk);
      } }),
      createGunzip(),
      new Writable({ write(chunk, encoding, callback) {
        rawBytes += chunk.length;
        rawHash.update(chunk);
        if (header.length < 14) header = Buffer.concat([header, chunk.subarray(0, 14 - header.length)]);
        callback();
      } }),
    );
    assert.equal(compressedBytes, item.bytes, `${item.id}: compressed bytes`);
    assert.equal(rawBytes, item.uncompressedBytes, `${item.id}: original bytes`);
    assert.equal(compressedHash.digest('hex'), item.sha256, `${item.id}: compressed hash`);
    assert.equal(rawHash.digest('hex'), item.uncompressedSha256, `${item.id}: original hash`);
    assert.equal(header.toString('ascii', 0, 4), 'MThd', item.id);
    assert.equal(header.readUInt16BE(8), item.midiFormat, `${item.id}: format`);
    assert.equal(header.readUInt16BE(10), item.tracks, `${item.id}: tracks`);
    assert.equal(header.readUInt16BE(12), item.ticksPerBeat, `${item.id}: PPQ`);
  }
});

test('published artwork counters match the independently inspected originals', () => {
  assert.match(validation.noteCountDefinition, /Positive-velocity Note On/);
  assert.equal(validation.files.length, 22);
  for (const item of artwork) {
    const recorded = validation.files.find(file => file.id === item.id);
    assert.ok(recorded, item.id);
    assert.equal(item.noteOnCount, verifiedAttacks[item.id], item.id);
    assert.equal(item.noteCount, verifiedAttacks[item.id], item.id);
    assert.equal(item.noteOnCount, recorded.noteOnCount, item.id);
    assert.equal(item.uncompressedSha256, recorded.uncompressedSha256, item.id);
    assert.equal(item.uncompressedBytes, recorded.uncompressedBytes, item.id);
    assert.equal(Object.values(item.channelNoteCounts).reduce((total, count) => total + count, 0), item.noteOnCount, item.id);
    assert.equal(item.channelCount, Object.keys(item.channelNoteCounts).length, item.id);
    assert.ok(item.firstNoteSeconds >= 0 && item.firstNoteSeconds < item.durationSeconds, item.id);
    assert.ok(item.durationSeconds <= item.fileDurationSeconds, item.id);
  }
});

test('creator audio pairings resolve to the same work and keep the ordinary import limit', () => {
  const paired = artwork.filter(item => item.pairedAudioId);
  assert.equal(paired.length, 16);
  for (const item of paired) {
    const audio = collection.find(file => file.id === item.pairedAudioId);
    assert.ok(audio, item.id);
    assert.equal(audio.compression, undefined, item.id);
    assert.equal(audio.visualOnly, undefined, item.id);
    assert.equal(audio.arrangementType, 'creator-audio-variant', item.id);
    assert.equal(audio.artist, item.artist, item.id);
    assert.equal(audio.originalArchivePath, item.archivePath, item.id);
    assert.equal(audio.originalBytes, item.uncompressedBytes, item.id);
    assert.ok(audio.bytes <= 10 * 1024 * 1024, item.id);
    assert.equal(item.pairedAudioId + '-full', item.id, item.id);
  }
  assert.deepEqual(artwork.filter(item => !item.pairedAudioId).map(item => item.id).sort(), [
    'black-bleed-five-pebbles-full', 'black-bleed-update-full', 'black-bleed-winter-s-pain-full',
    'black-hans-stereo-madness', 'black-hans-yiay-final2', 'black-hans-yiay-one-million',
  ]);
});

test('bundled artist credits link the actual source and retained license', async () => {
  const licenses = {
    'CC0-1.0': { file: 'licenses/BLACK-MIDI-ARCHIVE-CC0.txt', title: /CC0 1\.0 Universal/,
      url: 'https://creativecommons.org/publicdomain/zero/1.0/', artist: 'BLEEDING EDGE MONOTONE',
      source: 'https://github.com/BLEEDING-EDGE-MONOTONE/Black-MIDI-Archive' },
    'CC-BY-4.0': { file: 'licenses/HANS5958-CC-BY-4.0.md', title: /Attribution 4\.0 International/,
      url: 'https://creativecommons.org/licenses/by/4.0/', artist: 'Hans5958',
      source: 'https://github.com/Hans5958/Personal-Black-MIDI-Projects' },
  };
  for (const [id, license] of Object.entries(licenses)) {
    assert.match(await readFile(new URL(license.file, base), 'utf8'), license.title, id);
  }
  for (const item of artwork) {
    const license = licenses[item.licenseId];
    assert.ok(license, item.id);
    assert.equal(item.licenseUrl, license.url, item.id);
    assert.equal(item.sourceUrl, license.source, item.id);
    assert.equal(item.artist, license.artist, item.id);
    assert.ok(item.attribution.includes(license.artist), item.id);
    assert.ok(item.attribution && item.license, item.id);
    assert.equal(new URL(item.downloadUrl).protocol, 'https:', item.id);
    if (item.artist === 'Hans5958') {
      assert.match(item.downloadUrl, /^https:\/\/raw\.githubusercontent\.com\/Hans5958\/Personal-Black-MIDI-Projects\/e5881e4e1a53a83360056ab166eb2505bf8b91a6\//);
      assert.ok(decodeURIComponent(new URL(item.downloadUrl).pathname).endsWith('/' + item.sourcePath), item.id);
    }
  }
  assert.ok(!artwork.some(item => /Nancarrow|HDSQ|Convergence|Zekar/.test(item.artist)), 'source-only findings must not become invented local scores');
});
