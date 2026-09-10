import test from 'node:test';
import assert from 'node:assert/strict';
import { PugglerCollage, COLLAGE_ATLASES } from '../src/puggler-collage.js';
import { drawProp } from '../src/puggler-renderer.js';
import { presentProp } from '../src/puggler-skins.js';
import { PROPS } from '../src/puggler.js';
import { ERA_PROP_OVERRIDES } from '../src/puggler-era-props.js';

const TEST_ATLASES = Object.fromEntries(Object.entries(COLLAGE_ATLASES).map(([id, atlas]) => [id, { ...atlas, rects: undefined }]));

const ATLAS_COUNT = Object.keys(TEST_ATLASES).length;

const makeImages = () => {
  const images = [];
  const imageFactory = () => {
    const image = { naturalWidth: 1400, naturalHeight: 600, decodeCalls: 0, removed: [],
      decode() { this.decodeCalls++; return Promise.resolve(); },
      removeAttribute(name) { this.removed.push(name); },
    };
    images.push(image);
    return image;
  };
  return { images, imageFactory };
};
const drawingContext = () => {
  const calls = [];
  const c = new Proxy({}, { get: (_target, key) => (...args) => calls.push([key, ...args]), set: () => true });
  return { c, calls };
};

test('pending or unavailable collage assets preserve vector props without retries', t => {
  const { images, imageFactory } = makeImages();
  const collage = new PugglerCollage({ imageFactory, atlases: TEST_ATLASES });
  t.after(() => collage.dispose());
  const { c, calls } = drawingContext();
  for (let i = 0; i < 40; i++) drawProp(c, { id: 'ball', color: '#f00', radius: 30 }, 7, 9, 0, 1, collage);
  assert.deepEqual(collage.status, { ready: false, failed: 0, loaded: 0, total: ATLAS_COUNT });
  assert.equal(images.length, ATLAS_COUNT);
  assert.equal(images.reduce((total, image) => total + image.decodeCalls, 0), 0);
  assert.equal(calls.filter(call => call[0] === 'drawImage').length, 0);
  assert.ok(calls.some(call => call[0] === 'ellipse'));
  images.forEach(image => image.onerror());
  assert.deepEqual(collage.status, { ready: false, failed: ATLAS_COUNT, loaded: 0, total: ATLAS_COUNT });
  assert.equal(collage.drawProp(c, { id: 'ball' }, 0, 0), false);
  assert.ok(images.every(image => image.onload === null && image.onerror === null));
});

test('atlases decode once, and photographs keep their source aspect around the physics point', async t => {
  const { images, imageFactory } = makeImages();
  const collage = new PugglerCollage({ imageFactory, atlases: TEST_ATLASES });
  t.after(() => collage.dispose());
  let finishDecode;
  images[0].decode = function () { this.decodeCalls++; return new Promise(resolve => { finishDecode = resolve; }); };
  const onload = images[0].onload;
  const pending = onload();
  await onload();
  assert.equal(images[0].decodeCalls, 1);
  assert.equal(collage.status.loaded, 0);
  finishDecode(); await pending;
  await Promise.all(images.slice(1).map(image => image.onload()));
  assert.deepEqual(collage.status, { ready: true, failed: 0, loaded: ATLAS_COUNT, total: ATLAS_COUNT });
  const { c, calls } = drawingContext();
  assert.equal(collage.draw(c, 'props', 'ball', 47, 91, 160, 80, .7), true);
  const draw = calls.find(call => call[0] === 'drawImage');
  assert.deepEqual(draw.slice(2), [0, 0, 200, 200, -40, -40, 80, 80]);
  assert.ok(calls.some(call => call[0] === 'translate' && call[1] === 47 && call[2] === 91));
  assert.ok(calls.some(call => call[0] === 'rotate' && call[1] === .7));
  calls.length = 0;
  assert.equal(collage.draw(c, 'venue', 'hand2', 0, 0, 60, 120), true);
  const venue = calls.find(call => call[0] === 'drawImage');
  assert.deepEqual(venue.slice(2, 6), [1050, 300, 350, 300]);
  assert.ok(Math.abs(venue.at(-2) / venue.at(-1) - 350 / 300) < 1e-12);
  assert.equal(collage.draw(c, 'props', 'unknown', 0, 0, 10), false);
  for (const id of COLLAGE_ATLASES.extra.ids) {
    calls.length = 0;
    assert.equal(collage.drawProp(c, { id, radius: 28 }, 19, 23, .5), true);
    assert.equal(calls.find(call => call[0] === 'drawImage')[1], images[Object.keys(TEST_ATLASES).indexOf('extra')]);
  }
  assert.equal(collage.drawProp(c, { id: 'mushroom' }, 0, 0), false);
});

test('decode failure is contained to its own atlas', async t => {
  const { images, imageFactory } = makeImages();
  const collage = new PugglerCollage({ imageFactory, atlases: TEST_ATLASES });
  t.after(() => collage.dispose());
  images[0].decode = () => Promise.reject(new Error('corrupt image'));
  await Promise.all(images.map(image => image.onload()));
  assert.deepEqual(collage.status, { ready: false, failed: 1, loaded: ATLAS_COUNT - 1, total: ATLAS_COUNT });
  const { c } = drawingContext();
  assert.equal(collage.drawProp(c, { id: 'ball' }, 0, 0), false);
  assert.equal(collage.draw(c, 'venue', 'amp', 0, 0, 100), true);
  assert.equal(collage.drawProp(c, { id: 'icecream' }, 0, 0), true);
});

test('each skin draws only its own photo bank and a failed themed atlas cannot fall back to a punk photo',async t=>{
  const {images,imageFactory}=makeImages();
  const collage=new PugglerCollage({imageFactory,atlases:TEST_ATLASES});
  t.after(()=>collage.dispose());
  await Promise.all(images.map(image=>image.onload()));
  const {c,calls}=drawingContext();
  for(const skin of ['history','future']){
    const atlasIndex=Object.keys(TEST_ATLASES).indexOf(skin);
    for(const id of COLLAGE_ATLASES[skin].ids){
      calls.length=0;
      assert.equal(collage.drawProp(c,{id,skin,radius:26},10,20),true);
      assert.equal(calls.find(call=>call[0]==='drawImage')[1],images[atlasIndex]);
    }
  }
  collage.entries.get('future').state='failed';calls.length=0;
  assert.equal(collage.drawProp(c,{id:'ball',skin:'future',radius:26},10,20),false);
  assert.equal(calls.some(call=>call[0]==='drawImage'),false);
  assert.equal(collage.drawProp(c,{id:'ball',radius:26},10,20),true);
});

test('dispose releases images and late decodes cannot repopulate the cache', async () => {
  const { images, imageFactory } = makeImages();
  const collage = new PugglerCollage({ imageFactory, atlases: TEST_ATLASES });
  let finishDecode;
  images[0].decode = () => new Promise(resolve => { finishDecode = resolve; });
  const pending = images[0].onload();
  collage.dispose(); collage.dispose();
  finishDecode(); await pending;
  assert.deepEqual(collage.status, { ready: false, failed: 0, loaded: 0, total: ATLAS_COUNT });
  assert.ok(images.every(image => image.onload === null && image.onerror === null));
  assert.ok(images.every(image => image.removed.includes('src')));
  assert.ok([...collage.entries.values()].every(entry => entry.image === null && entry.sprites.size === 0 && entry.timer === null));
  const { c } = drawingContext();
  assert.equal(collage.drawProp(c, { id: 'ball' }, 0, 0), false);
});

test('new historical objects and octopus select their actual cutouts across live skin changes',async t=>{
  const {images,imageFactory}=makeImages();
  const collage=new PugglerCollage({imageFactory,atlases:TEST_ATLASES});
  t.after(()=>collage.dispose());
  await Promise.all(images.map(image=>image.onload()));
  const {c,calls}=drawingContext(),atlasIndex=Object.keys(TEST_ATLASES).indexOf('eraProps');
  for(const [skin,overrides] of Object.entries(ERA_PROP_OVERRIDES))for(const id of Object.keys(overrides)){
    const base=PROPS.find(prop=>prop.id===id),themed=presentProp(base,skin);
    calls.length=0;
    assert.equal(collage.drawProp(c,themed,10,20),true);
    assert.equal(calls.find(call=>call[0]==='drawImage')[1],images[atlasIndex]);
    assert.equal(presentProp(themed,'punk'),base);
    const other=presentProp(themed,skin==='history'?'future':'history');
    assert.equal(other.sprite,undefined,'switching era must clear the prior override');
  }
  collage.entries.get('eraProps').state='failed';calls.length=0;
  const octopus=presentProp(PROPS.find(prop=>prop.id==='fish'),'future');
  assert.equal(collage.drawProp(c,octopus,10,20),false);
  assert.equal(calls.some(call=>call[0]==='drawImage'),false,'a failed override cannot draw the old photo');
});

test('corrected rectangular crops retain photo aspect, and invalid crops fail safely', async t => {
  const { images, imageFactory } = makeImages();
  const atlas = { ...COLLAGE_ATLASES.props, ids: ['ball'], rects: { ball: [100, 20, 300, 150] } };
  const collage = new PugglerCollage({ imageFactory, atlases: { props: atlas } });
  t.after(() => collage.dispose());
  await images[0].onload();
  const { c, calls } = drawingContext();
  collage.draw(c, 'props', 'ball', 0, 0, 80, 80);
  assert.deepEqual(calls.find(call => call[0] === 'drawImage').slice(2), [100, 20, 300, 150, -40, -20, 80, 40]);
  const broken = new PugglerCollage({ imageFactory, atlases: { props: { ...atlas, rects: { ball: [1390, 0, 40, 100] } } } });
  t.after(() => broken.dispose());
  await images[1].onload();
  assert.equal(broken.status.failed, 1);
  assert.equal(broken.drawProp(c, { id: 'ball' }, 0, 0), false);
});

test('nonbrowser renderers report a complete fallback without throwing', () => {
  const collage = new PugglerCollage({ imageFactory: () => { throw new Error('Image unavailable'); } });
  assert.equal(collage.status.failed, ATLAS_COUNT);
  collage.dispose();
});
