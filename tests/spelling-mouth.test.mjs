import assert from 'node:assert/strict';
import test from 'node:test';
import { REST_MOUTH, spellingMouthPose, blendMouthPose, spellingMouthPaths } from '../src/instruments/spelling-synthesizer/spelling-mouth.js';
import { spellingArticulation } from '../src/instruments/spelling-synthesizer/spelling-synthesizer.js';
import { presets } from '../src/instruments/spelling-synthesizer/full-presets.js';

test('frontal mouth differentiates lip seals, vowels, roundness, teeth and tongue', () => {
  const pose = articulation => spellingMouthPose({articulation});
  assert.ok(pose('a').open > pose('m').open + .5);
  assert.deepEqual(pose('p'),pose('b'));
  assert.ok(pose('uw').round > pose('iy').round + .8);
  assert.ok(pose('iy').width > pose('uw').width);
  assert.ok(pose('th').tongue > pose('s').tongue);
  assert.ok(pose('f').teeth > pose('a').teeth);
  assert.deepEqual(spellingMouthPose(null), REST_MOUTH);
});

test('wireframe geometry stays finite and bounded for every letter and articulation', () => {
  const poses = [...'abcdefghijklmnopqrstuvwxyz'].map(letter => spellingMouthPose({articulation:spellingArticulation(letter)}));
  poses.push(REST_MOUTH,spellingMouthPose({articulation:'th'}),spellingMouthPose({articulation:'uw'}),
    {open:Infinity,width:Infinity,round:-Infinity,tongue:NaN,teeth:Infinity});
  for(const pose of poses) {
    const paths=spellingMouthPaths(pose);
    for(const path of Object.values(paths)) {
      assert.doesNotMatch(path,/NaN|Infinity|undefined/);
      const numbers=path.match(/-?\d+(?:\.\d+)?/g).map(Number);
      for(let i=0;i<numbers.length;i+=2) {
        assert.ok(numbers[i]>=0 && numbers[i]<=1000);
        assert.ok(numbers[i+1]>=0 && numbers[i+1]<=520);
      }
    }
    assert.ok(paths.lips.length<22000, 'fixed mesh budget');
  }
});

test('mouth interpolation changes display only and has stable endpoints', () => {
  const from=spellingMouthPose({articulation:'a'}), to=spellingMouthPose({articulation:'uw'});
  assert.deepEqual(blendMouthPose(from,to,0),from);
  assert.deepEqual(blendMouthPose(from,to,1),to);
  assert.ok(blendMouthPose(from,to,.5).round>from.round);
  assert.notEqual(spellingMouthPaths(from).lips,spellingMouthPaths(to).lips);
});

test('Speak & Spell-ish is an additive full vocoder scene, not a new engine or master preset', () => {
  const preset=presets.find(p=>p.id==='speak-spell');
  assert.ok(preset);
  assert.deepEqual(preset.snapshot,{engine:"vocoder",personality:"reed",rhythmAmount:0,diphthongDelay:0,pairGlides:false});
  assert.equal(presets.length,22);
  // Other factory IDs and parameter values remain available.
  assert.ok(presets.find(p=>p.id==='tube'));
  assert.ok(presets.find(p=>p.id==='soft'));
});
