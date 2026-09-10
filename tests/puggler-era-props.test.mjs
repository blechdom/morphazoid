import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ERA_PROP_ATLAS, ERA_PROP_OVERRIDES } from '../src/puggler-era-props.js';
import { drawEraProp } from '../src/puggler-era-prop-renderer.js';

function atlasHeader() {
  const bytes = readFileSync(ERA_PROP_ATLAS.url);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
  const chunks = new Map();
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + length <= bytes.length, `Complete ${id} chunk`);
    chunks.set(id, bytes.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length + (length & 1);
  }
  const extended = chunks.get('VP8X');
  assert.equal(extended?.length, 10);
  assert.ok(extended[0] & 0x10, 'actual WebP header declares alpha');
  assert.ok(chunks.get('ALPH')?.length > 0, 'actual alpha payload is present');
  assert.ok(chunks.get('VP8 ')?.length > 0, 'actual image payload is present');
  return { width: extended.readUIntLE(4, 3) + 1, height: extended.readUIntLE(7, 3) + 1 };
}

test('the bundled era atlas is a complete WebP with alpha and seven isolated in-bounds crops', () => {
  const { width, height } = atlasHeader(), atlas = ERA_PROP_ATLAS;
  assert.ok(width > 0 && height > 0);
  assert.equal(atlas.columns, 4);
  assert.equal(atlas.rows, 2);
  assert.equal(atlas.ids.length, 7);
  assert.equal(new Set(atlas.ids).size, 7);
  assert.deepEqual(Object.keys(atlas.rects).sort(), [...atlas.ids].sort());
  for (const [index, id] of atlas.ids.entries()) {
    const rect = atlas.rects[id];
    assert.equal(rect.length, 4);
    assert.ok(rect.every(Number.isInteger));
    const [x, y, w, h] = rect;
    assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height, id);
    for (const other of atlas.ids.slice(index + 1)) {
      const [ox, oy, ow, oh] = atlas.rects[other];
      assert.ok(x + w <= ox || ox + ow <= x || y + h <= oy || oy + oh <= y, `${id}/${other} crops do not overlap`);
    }
  }
});
test('the seven requested appearance overrides each resolve exactly one atlas sprite', () => {
  assert.deepEqual(Object.keys(ERA_PROP_OVERRIDES).sort(), ['future', 'history']);
  const expected = {
    history: { mic: 'history-bones', banana: 'history-hamhock', plushrat: 'history-baby',
      skateboard: 'history-harpsichord', bowling: 'history-boulder', club: 'history-club' },
    future: { fish: 'future-octopus' },
  };
  const used = [];
  for (const [skin, mappings] of Object.entries(expected)) {
    const overrides = ERA_PROP_OVERRIDES[skin];
    assert.deepEqual(Object.keys(overrides).sort(), Object.keys(mappings).sort());
    for (const [id, sprite] of Object.entries(mappings)) {
      const entry = overrides[id];
      assert.equal(entry.sprite, sprite);
      assert.equal(entry.atlas, 'eraProps');
      assert.ok(entry.name.trim());
      assert.match(entry.color, /^#[0-9a-f]{6}$/i);
      assert.ok(ERA_PROP_ATLAS.ids.includes(entry.sprite));
      assert.deepEqual(Object.keys(entry).sort(), ['atlas', 'color', 'name', 'sprite'], 'appearance metadata contains no physics or sound mutations');
      used.push(entry.sprite);
    }
  }
  assert.deepEqual(used.sort(), [...ERA_PROP_ATLAS.ids].sort());
});

test('atlas metadata and every override resist accidental renderer mutation', () => {
  assert.ok(Object.isFrozen(ERA_PROP_ATLAS));
  assert.ok(Object.isFrozen(ERA_PROP_ATLAS.ids));
  assert.ok(Object.isFrozen(ERA_PROP_ATLAS.rects));
  assert.throws(() => { ERA_PROP_ATLAS.columns = 5; }, TypeError);
  assert.throws(() => ERA_PROP_ATLAS.ids.push('unrelated'), TypeError);
  for (const rect of Object.values(ERA_PROP_ATLAS.rects)) {
    assert.ok(Object.isFrozen(rect));
    assert.throws(() => { rect[0] = -1; }, TypeError);
  }
  assert.ok(Object.isFrozen(ERA_PROP_OVERRIDES));
  for (const entries of Object.values(ERA_PROP_OVERRIDES)) {
    assert.ok(Object.isFrozen(entries));
    assert.throws(() => { entries.unrelated = {}; }, TypeError);
    for (const entry of Object.values(entries)) {
      assert.ok(Object.isFrozen(entry));
      assert.throws(() => { entry.name = 'Changed'; }, TypeError);
    }
  }
});

class RecordingCanvas {
  constructor() {
    this.operations = [];
    this.stack = [];
    this.state = { fillStyle: '#123456', strokeStyle: '#654321', lineWidth: 3,
      lineCap: 'butt', lineJoin: 'miter', globalAlpha: .4, shadowBlur: 7,
      shadowColor: '#112233', shadowOffsetX: 2, shadowOffsetY: 3 };
    for (const key of Object.keys(this.state)) Object.defineProperty(this, key, {
      get: () => this.state[key], set: value => { this.state[key] = value; },
    });
  }
  save() { this.stack.push({ ...this.state }); this.operations.push(['save']); }
  restore() { assert.ok(this.stack.length); this.state = this.stack.pop(); this.operations.push(['restore']); }
}
for (const method of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'ellipse', 'bezierCurveTo', 'fill', 'stroke', 'fillRect']) {
  RecordingCanvas.prototype[method] = function (...args) {
    assert.ok(args.every(Number.isFinite), `${method} uses finite geometry`);
    assert.ok(args.every(value => Math.abs(value) <= 50), `${method} stays within a small local silhouette`);
    this.operations.push([method, ...args]);
  };
}

test('seven fallbacks draw distinct bounded silhouettes and preserve the caller Canvas state', () => {
  const signatures = new Set();
  for (const sprite of ERA_PROP_ATLAS.ids) {
    const c = new RecordingCanvas(), before = { ...c.state };
    assert.equal(drawEraProp(c, { sprite, color: '#88bbcc' }), true);
    assert.deepEqual(c.state, before, `${sprite} preserves styles, alpha and inherited shadow`);
    assert.equal(c.stack.length, 0);
    assert.deepEqual(c.operations[0], ['save']);
    assert.deepEqual(c.operations.at(-1), ['restore']);
    assert.ok(c.operations.length < 180, `${sprite} has bounded drawing work`);
    assert.ok(c.operations.some(([method]) => method === 'fill' || method === 'stroke'));
    // Colors are excluded: changing a generic shape's label cannot pass.
    signatures.add(JSON.stringify(c.operations));
  }
  assert.equal(signatures.size, 7);
});

test('recognizable fallback mechanisms include eight curled octopus arms and harpsichord keys', () => {
  const octopus = new RecordingCanvas();
  drawEraProp(octopus, { sprite: 'future-octopus' });
  const armStarts = octopus.operations.filter(([method]) => method === 'moveTo');
  assert.equal(armStarts.length, 8);
  assert.equal(new Set(armStarts.map(([, x, y]) => `${x}:${y}`)).size, 8);
  assert.equal(octopus.operations.filter(([method]) => method === 'bezierCurveTo').length, 16, 'each of eight arms has a curled end');
  const instrument = new RecordingCanvas();
  drawEraProp(instrument, { sprite: 'history-harpsichord' });
  assert.ok(instrument.operations.filter(([method]) => method === 'fillRect').length >= 5, 'the keyboard has distinct dark keys');
});

test('unknown fallback sprites leave the context untouched and drawing errors restore state', () => {
  for (const prop of [null, undefined, {}, { sprite: '__proto__' }, { sprite: 'unrelated' }]) {
    const c = new RecordingCanvas(), before = { ...c.state };
    assert.equal(drawEraProp(c, prop), false);
    assert.deepEqual(c.operations, []);
    assert.deepEqual(c.state, before);
  }
  const c = new RecordingCanvas(), before = { ...c.state };
  c.fill = () => { throw new Error('Canvas failure'); };
  assert.throws(() => drawEraProp(c, { sprite: 'history-boulder' }), /Canvas failure/);
  assert.deepEqual(c.state, before);
  assert.equal(c.stack.length, 0);
});
