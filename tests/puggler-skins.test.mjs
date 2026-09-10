import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PROPS, PugglerModel, soundMapping } from '../src/puggler.js';
import { SKINS, SKIN_ATLASES, skinFor, presentProp } from '../src/puggler-skins.js';

test('skin choices have stable cast identities and canonical fallback', () => {
  assert.deepEqual(SKINS.map(skin => skin.id), ['punk', 'history', 'future']);
  assert.deepEqual(skinFor('history').riders, ['Cavewoman', 'Dame Roxy', 'Maestro Moss']);
  assert.deepEqual(skinFor('future').riders, ['Futureman', 'Cyberwoman', 'Quor']);
  for (const id of [undefined, '', 'missing', '__proto__']) assert.equal(skinFor(id), SKINS[0]);
  assert.ok(Object.isFrozen(SKINS));
  for (const skin of SKINS) {
    assert.ok(Object.isFrozen(skin));
    assert.ok(Object.isFrozen(skin.riders));
  }
});

test('every prop has distinct themed presentation with unchanged physics and sound', () => {
  const before = structuredClone(PROPS);
  for (const skin of ['history', 'future']) {
    const names = new Set();
    for (const prop of PROPS) {
      const themed = presentProp(prop, skin);
      assert.equal(themed.id, prop.id);
      assert.equal(themed.skin, skin);
      assert.notEqual(themed.name, prop.name);
      assert.match(themed.color, /^#[0-9a-f]{6}$/i);
      assert.ok(Object.isFrozen(themed));
      for (const key of Object.keys(prop)) if (!['name', 'color'].includes(key)) {
        assert.deepEqual(themed[key], prop[key], `${skin}/${prop.id}/${key}`);
      }
      const body = { x: 420, y: 675, vx: 220, vy: -510 };
      assert.deepEqual(soundMapping(themed, body), soundMapping(prop, body));
      names.add(themed.name);
    }
    assert.equal(names.size, PROPS.length);
  }
  assert.deepEqual(PROPS, before);
});

test('cached presentations preserve transient supplied fields and invalidate on source changes', () => {
  const base = PROPS[0];
  const history = presentProp(base, 'history');
  const future = presentProp(base, 'future');
  assert.equal(presentProp(base, 'history'), history);
  assert.equal(presentProp(base, 'future'), future);
  assert.notEqual(history, future);
  assert.equal(presentProp(history, 'future'), future);
  assert.equal(presentProp(future, 'punk'), base);
  assert.equal(presentProp(base, 'missing'), base);

  const live = { ...base, mass: .72, drum: 'hat', riff: 'woo', radius: 41, custom: 'first' };
  const first = presentProp(live, 'history');
  assert.equal(first.mass, .72);
  assert.equal(first.drum, 'hat');
  assert.equal(first.riff, 'woo');
  assert.equal(first.radius, 41);
  assert.equal(first.custom, 'first');
  assert.equal(presentProp(live, 'history'), first);
  live.mass = .93;
  const second = presentProp(live, 'history');
  assert.notEqual(second, first);
  assert.equal(second.mass, .93);
  assert.equal(first.mass, .72);
  live.extra = 5;
  assert.equal(presentProp(live, 'history').extra, 5);
  delete live.custom;
  assert.equal(Object.hasOwn(presentProp(live, 'history'), 'custom'), false);
  const unknown = { ...live, id: '__proto__', name: 'Custom object' };
  assert.equal(presentProp(unknown, 'future').name, 'Custom object');
});

test('changing presentation while ten objects move leaves simulation and sound events identical', () => {
  const config = { count: 10, tempo: 1200, cast: 'trio', chaos: 20, phrase: 'evolve' };
  const observed = new PugglerModel(config), control = new PugglerModel(config);
  for (let frame = 0; frame < 720; frame++) {
    const steer = Math.sin(frame / 31) * .8;
    assert.deepEqual(observed.step(1 / 120, steer), control.step(1 / 120, steer));
    for (const body of [...observed.objects, ...observed.debris]) {
      const prop = body.prop;
      const presentation = presentProp(prop, SKINS[frame % SKINS.length].id);
      assert.equal(body.prop, prop);
      assert.equal(presentation.mass, prop.mass);
      assert.equal(presentation.id, prop.id);
    }
  }
  assert.deepEqual(observed, control);
});

test('both published atlases have alpha and an in-bounds rectangle for every base prop', () => {
  const ids = PROPS.map(prop => prop.id);
  for (const skin of ['history', 'future']) {
    const atlas = SKIN_ATLASES[skin];
    assert.deepEqual(atlas.ids, ids);
    assert.deepEqual(Object.keys(atlas.rects).sort(), [...ids].sort());
    assert.equal(atlas.columns, 7);
    assert.equal(atlas.rows, 5);
    const bytes = fs.readFileSync(atlas.url);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.equal(bytes.toString('ascii', 12, 16), 'VP8X');
    assert.ok(bytes[20] & 0x10, 'WebP must retain its alpha channel');
    const width = bytes.readUIntLE(24, 3) + 1, height = bytes.readUIntLE(27, 3) + 1;
    for (const id of ids) {
      const [x, y, w, h] = atlas.rects[id];
      assert.ok([x, y, w, h].every(Number.isInteger), `${skin}/${id}`);
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height, `${skin}/${id}`);
      assert.ok(Object.isFrozen(atlas.rects[id]));
    }
    assert.ok(Object.isFrozen(atlas));
    assert.ok(Object.isFrozen(atlas.ids));
    assert.ok(Object.isFrozen(atlas.rects));
  }
});
