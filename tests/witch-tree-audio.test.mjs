import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchTreePhrase, WitchSceneDSP, WITCH_TREE_PHRASE_SECONDS } from '../src/instruments/witch/witch-scene-audio.js';
import { L_SYSTEM_PRESETS, traceLSystem } from '../src/instruments/l-system/l-system.js';

test('tree notes use native branch distances and share fork power across one finite traversal', () => {
  const tree = new WitchTreePhrase(12000);
  const native = traceLSystem({ ...L_SYSTEM_PRESETS.find(preset => preset.id === 'pythagorean'), iterations: 3 });
  assert.equal(tree.voices.length, 15);
  assert.deepEqual(tree.trace, native);
  for (const voice of tree.voices) {
    const parent = tree.voices[voice.segment.parentIndex];
    if (parent) assert.equal(voice.startFrame, parent.releaseFrame, 'each fork begins when its parent reaches the junction');
    assert.ok(voice.releaseFrame - voice.startFrame > voice.attackFrames + voice.decayFrames + 100,
      'each branch keeps an audible sustained body after attack and decay');
    const children = voice.segment.children.map(index => tree.voices[index]);
    if (children.length) assert.equal(children.reduce((power, child) => power + child.segment.powerShare, 0), voice.segment.powerShare);
  }
  assert.equal(tree.trigger(), true);
  let sawAttack = false, sawSustain = false, sawRelease = false, peak = 0;
  const root = tree.voices[0];
  for (let i = 0; i < Math.ceil((WITCH_TREE_PHRASE_SECONDS + .1) * tree.rate); i++) {
    tree.next(true);
    if (i === Math.floor(root.attackFrames / 2)) sawAttack = root.envelope > .4 && root.envelope < .6;
    if (i === root.attackFrames + root.decayFrames + 10) sawSustain = root.envelope === root.sustain;
    if (i === root.releaseFrame + Math.floor(root.releaseFrames / 2)) sawRelease = root.envelope > .2 && root.envelope < .4;
    peak = Math.max(peak, Math.abs(tree.left), Math.abs(tree.right));
  }
  assert.ok(sawAttack && sawSustain && sawRelease, 'the sound has separate attack, sustained body and release');
  assert.equal(tree.onsets, 15); assert.equal(tree.progress, 1); assert.equal(tree.age, -1);
  assert.equal(tree.envelope, 0); assert.equal(tree.left, 0); assert.equal(tree.right, 0);
  assert.ok(peak > .02 && peak < .22);
  for (let i = 0; i < 12000; i++) tree.next(true);
  assert.equal(tree.onsets, 15, 'the finished traversal cannot loop');
});

test('busy clicks cannot queue, restart or prolong the one-shot tree phrase', () => {
  const single = new WitchTreePhrase(8000), repeated = new WitchTreePhrase(8000);
  single.trigger(); repeated.trigger();
  const pool = repeated.voices.slice();
  for (let i = 0; i < Math.round(WITCH_TREE_PHRASE_SECONDS * 8000); i++) {
    if (i % 137 === 0) assert.equal(repeated.trigger(), false);
    single.next(true); repeated.next(true);
    assert.equal(repeated.left, single.left); assert.equal(repeated.right, single.right);
    assert.equal(repeated.frame, single.frame); assert.equal(repeated.progress, single.progress);
  }
  repeated.next(true); assert.equal(repeated.age, -1);
  assert.equal(repeated.trigger(), true, 'a new click after completion reuses the same voice bank');
  assert.ok(repeated.voices.every((voice, index) => voice === pool[index]));
  for (let i = 0; i < 1000; i++) repeated.next(true);
  const onsets = repeated.onsets;
  repeated.release();
  for (let i = 0; i < 8000; i++) repeated.next(true);
  assert.equal(repeated.onsets, onsets, 'release cancels forks that have not started');
  assert.equal(repeated.age, -1); assert.equal(repeated.left, 0);
});

test('the full PM depth range stays finite at low and normal rates and remains balanced with scene accents', () => {
  for (const rate of [8000, 48000]) for (const spread of [0, 1]) for (const curl of [0, 1]) {
    const tree = new WitchTreePhrase(rate); tree.setControls(spread, curl); tree.trigger();
    assert.equal(tree.modulationIndex, spread ? 8 : 3);
    let energy = 0, peak = 0;
    for (let i = 0; i < Math.ceil((WITCH_TREE_PHRASE_SECONDS + .1) * rate); i++) {
      tree.next(true);
      assert.ok(Number.isFinite(tree.left) && Number.isFinite(tree.right));
      peak = Math.max(peak, Math.abs(tree.left), Math.abs(tree.right));
      energy += (tree.left ** 2 + tree.right ** 2) * .5;
    }
    assert.ok(Math.sqrt(energy / (rate * 2.5)) > .008 && peak < .22);
    assert.equal(tree.age, -1); assert.equal(tree.envelope, 0);
  }
  const levels = ['tree-l-system', 'web-4', 'spider-groan'].map(kind => {
    const scene = new WitchSceneDSP(12000); scene.trigger(kind);
    let energy = 0;
    for (let i = 0; i < 28800; i++) { scene.next(true); energy += (scene.left ** 2 + scene.right ** 2) * .5; }
    return Math.sqrt(energy / 28800);
  });
  assert.ok(levels[0] > levels[1] && levels[0] < levels[2] * 1.5, 'the tree sits above the quiet web without overpowering foreground accents');
});
