import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchTreePhrase, WitchSceneDSP, WITCH_TREE_PHRASE_SECONDS } from '../src/instruments/witch/witch-scene-audio.js';
import { traceWitchTree, witchTreeSettings, WITCH_TREE_TRAVERSAL_SECONDS } from '../src/instruments/witch/witch-tree-model.js';
import { branchingSnapshotAtPhase, branchAngleFrequency } from '../src/instruments/l-system/l-system.js';
import { normalizeWitchControls } from '../src/instruments/witch/witch-model.js';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';

const notes = tree => tree.voices.slice(0, tree.branchCount);
function render(tree, seconds) {
  for (let i = 0; i < Math.ceil(seconds * tree.rate); i++) tree.next(true);
}

test('all six visible trees sound every branch at its native fork time and follow the same playhead', () => {
  const tree = new WitchTreePhrase(12000), voices = tree.voices.slice(), indices = tree.activeIndices;
  const counts = [63, 84, 512, 127, 84, 512];
  assert.equal(tree.voices.length, 512, 'the single pool is bounded by the densest visible tree');
  for (let shape = 0; shape < 6; shape++) {
    tree.setControls(.5, .5, shape);
    const native = traceWitchTree({ treeShape: shape });
    assert.equal(tree.branchCount, counts[shape]); assert.deepEqual(tree.trace, native);
    for (const voice of notes(tree)) {
      const parent = voice.segment.parentIndex === null ? null : tree.voices[voice.segment.parentIndex];
      if (parent) assert.equal(voice.startFrame, parent.releaseFrame, 'children start exactly at the parent junction');
      assert.equal(voice.startFrame, Math.round(voice.segment.startDistance / native.duration * WITCH_TREE_TRAVERSAL_SECONDS * tree.rate));
      assert.equal(voice.releaseFrame, Math.round(voice.segment.endDistance / native.duration * WITCH_TREE_TRAVERSAL_SECONDS * tree.rate));
      assert.ok(voice.releaseFrame - voice.startFrame > voice.attackFrames + voice.decayFrames + tree.rate * .01,
        'even a short outer twig retains sustain after its attack and decay');
      const children = voice.segment.children.map(index => tree.voices[index]);
      if (children.length) assert.ok(Math.abs(children.reduce((power, child) => power + child.segment.powerShare, 0) - voice.segment.powerShare) < 1e-12);
    }
    assert.equal(tree.trigger(), true);
    let maxActive = 0;
    for (const phase of [.127, .431, .731, .923]) {
      const frame = Math.round(phase * WITCH_TREE_TRAVERSAL_SECONDS * tree.rate);
      while (tree.frame <= frame) { tree.next(true); maxActive = Math.max(maxActive, tree.activeCount); }
      const audioHeads = notes(tree).filter(voice => voice.started && voice.startFrame <= frame && voice.releaseFrame > frame)
        .map(voice => voice.segment.index).sort((a, b) => a - b);
      const visualHeads = branchingSnapshotAtPhase(native, frame / tree.rate / WITCH_TREE_TRAVERSAL_SECONDS).heads
        .map(head => head.index).sort((a, b) => a - b);
      assert.deepEqual(audioHeads, visualHeads, `shape ${shape} has matching note and playhead branches`);
    }
    render(tree, 1);
    assert.equal(tree.onsets, counts[shape]); assert.equal(tree.progress, 1); assert.equal(tree.age, -1);
    assert.equal(tree.envelope, 0); assert.equal(tree.left, 0); assert.equal(tree.right, 0); assert.equal(tree.activeCount, 0);
    assert.ok(maxActive < tree.voices.length, 'per-sample processing only visits the active frontier and release tails');
    render(tree, .2); assert.equal(tree.onsets, counts[shape], 'a completed traversal never loops');
    assert.equal(tree.activeIndices, indices); assert.ok(tree.voices.every((voice, index) => voice === voices[index]));
  }
});

test('the higher root and live PM controls use each grammar’s exact inherited heading', () => {
  const tree = new WitchTreePhrase(48000), scores = tree.scores;
  for (let shape = 0; shape < 6; shape++) for (const [spread, curl] of [[0, 0], [1, 1], [.37, .81]]) {
    tree.setControls(spread, curl, shape);
    const state = { treeShape: shape, treeSpread: spread, treeCurl: curl };
    const native = traceWitchTree(state), settings = witchTreeSettings(state);
    assert.equal(tree.targetAngle, settings.angle); assert.equal(tree.targetAsymmetry, settings.turnAsymmetry);
    assert.equal(tree.targetIndex, 1 + 2 * spread); assert.equal(tree.scores, scores);
    for (const voice of notes(tree)) {
      assert.ok(Math.abs(voice.targetHeading - native.segments[voice.segment.index].heading) < 1e-12);
      assert.equal(voice.targetFrequency, Math.min(branchAngleFrequency(voice.targetHeading, 588, 2.6),
        tree.rate * .4 / (1 + 5 * voice.targetRatio)));
    }
  }
  tree.setControls(.5, .5, 0); assert.equal(tree.voices[0].targetFrequency, 588);
  tree.trigger(); render(tree, .4);
  const before = { frame: tree.frame, onsets: tree.onsets, phase: tree.voices[0].phase,
    frequency: tree.voices[1].targetFrequency, start: tree.voices[1].startFrame };
  tree.setControls(1, 0, 0);
  assert.equal(tree.frame, before.frame); assert.equal(tree.onsets, before.onsets);
  assert.equal(tree.voices[0].phase, before.phase); assert.equal(tree.voices[1].startFrame, before.start);
  assert.notEqual(tree.voices[1].targetFrequency, before.frequency);
});

test('each branch retains distinct attack, sustain and release stages', () => {
  const tree = new WitchTreePhrase(12000); tree.trigger();
  const root = tree.voices[0]; let attack = false, sustain = false, release = false;
  for (let frame = 0; frame < root.releaseFrame + root.releaseFrames + 1; frame++) {
    tree.next(true);
    if (frame === Math.floor(root.attackFrames / 2)) attack = root.envelope > .4 && root.envelope < .6;
    if (frame === root.attackFrames + root.decayFrames + 10) sustain = root.envelope === root.sustain;
    if (frame === root.releaseFrame + Math.floor(root.releaseFrames / 2)) release = root.envelope > .2 && root.envelope < .4;
  }
  assert.ok(attack && sustain && release);
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
  assert.equal(repeated.trigger(), true, 'a new click after completion reuses the voice bank');
  assert.ok(repeated.voices.every((voice, index) => voice === pool[index]));
  render(repeated, .125);
  const onsets = repeated.onsets;
  repeated.release(); render(repeated, 1);
  assert.equal(repeated.onsets, onsets, 'release cancels forks that have not started');
  assert.equal(repeated.age, -1); assert.equal(repeated.left, 0);
});

test('shape changes fade old notes without replay, and the next click uses the new tree', () => {
  const tree = new WitchTreePhrase(12000); tree.trigger(); render(tree, .4);
  const onsets = tree.onsets, frame = tree.frame;
  tree.setControls(.8, .2, 2);
  assert.equal(tree.shape, 0, 'telemetry retains the sounding geometry while it releases');
  assert.equal(tree.frame, frame); assert.equal(tree.trigger(), false);
  render(tree, .04);
  assert.equal(tree.age, -1); assert.equal(tree.envelope, 0); assert.equal(tree.onsets, onsets);
  render(tree, .5); assert.equal(tree.onsets, onsets);
  assert.equal(tree.trigger(), true); assert.equal(tree.shape, 2); assert.equal(tree.branchCount, 512);
  assert.equal(tree.onsets, 0); assert.equal(tree.frame, 0);
  render(tree, .15); const started = tree.onsets;
  for (let i = 0; i < 1000; i++) tree.next(false);
  assert.equal(tree.onsets, started); assert.equal(tree.age, -1); assert.equal(tree.left, 0);
});

test('the gentler PM depth range stays finite at low and normal rates and remains balanced with scene accents', () => {
  for (const rate of [8000, 48000]) for (const shape of [0, 2, 5]) for (const spread of [0, 1]) for (const curl of [0, 1]) {
    const tree = new WitchTreePhrase(rate); tree.setControls(spread, curl, shape); tree.trigger();
    assert.equal(tree.modulationIndex, spread ? 3 : 1);
    let energy = 0, peak = 0;
    for (let i = 0; i < Math.ceil((WITCH_TREE_PHRASE_SECONDS + .1) * rate); i++) {
      tree.next(true);
      assert.ok(Number.isFinite(tree.left) && Number.isFinite(tree.right));
      peak = Math.max(peak, Math.abs(tree.left), Math.abs(tree.right));
      energy += (tree.left ** 2 + tree.right ** 2) * .5;
    }
    assert.ok(Math.sqrt(energy / (rate * WITCH_TREE_PHRASE_SECONDS)) > .008 && peak < .22);
    assert.equal(tree.age, -1); assert.equal(tree.envelope, 0);
  }
  const levels = ['tree-l-system', 'web-4', 'spider-groan'].map(kind => {
    const scene = new WitchSceneDSP(12000); scene.trigger(kind);
    let energy = 0;
    for (let i = 0; i < 28800; i++) { scene.next(true); energy += (scene.left ** 2 + scene.right ** 2) * .5; }
    return Math.sqrt(energy / 28800);
  });
  assert.ok(levels[0] > levels[1] && levels[0] < levels[2] * 1.5, 'tree level stays balanced against existing picture sounds');
});

test('worklet controls preserve the chosen tree and expose its sounding shape and onset count', () => {
  for (const [input, expected] of [[-9, 0], [9, 5], [3.4, 3], [NaN, 0]]) {
    assert.equal(normalizeWitchControls({ treeShape: input }).treeShape, expected);
  }
  const dsp = new WitchDSP(8000), block = new Float32Array(128);
  dsp.setControls({ treeShape: 5, gate: false, brewEnabled: false, handEnabled: false, backingEnabled: false });
  assert.equal(dsp.scene.tree.shape, 5); assert.equal(dsp.scene.tree.branchCount, 512);
  assert.equal(dsp.trigger('tree-l-system'), false);
  dsp.setEnabled(true); assert.equal(dsp.trigger('tree-l-system'), true); dsp.process(block);
  assert.equal(dsp.visual.treeShape, 5); assert.equal(dsp.visual.treeBranchCount, 512); assert.equal(dsp.visual.treeOnsets, 1);
  assert.ok(dsp.visual.treeEnvelope > 0); assert.ok(dsp.visual.treeProgress > 0);
  assert.equal(dsp.visual.brewLevel, 0); assert.equal(dsp.visual.handLevel, 0);
  dsp.setControls({ treeShape: 1 });
  for (let i = 0; i < 4; i++) dsp.process(block);
  assert.equal(dsp.visual.treeEnvelope, 0); assert.equal(dsp.visual.treeOnsets, 1);
  assert.equal(dsp.trigger('tree-l-system'), true); dsp.process(block);
  assert.equal(dsp.visual.treeShape, 1); assert.equal(dsp.visual.treeBranchCount, 84);
});
