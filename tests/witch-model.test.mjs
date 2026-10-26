import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWitchControls, evaluateWitchHandPose, witchSpoonHeight, witchVoiceAtHeight, createStirState, updateStir, releaseStir, advanceStir, sampleChant, WITCH_TAU, WITCH_VOICES } from '../src/instruments/witch/witch-model.js';
import { WITCH_HAND_MOTIONS, WITCH_HAND_SOUNDS, witchHandConfig } from '../src/instruments/witch/witch-model.js';
import { HAND_MOTIONS, VOICE_SOURCES, handMotionPeriod } from '../src/instruments/gesticulating-hand/hand-model.js';

test('witch controls reject malformed values without changing the safe startup', () => {
  const defaults = normalizeWitchControls();
  assert.equal(defaults.gate, false); assert.equal(defaults.speed, 0);
  assert.equal(defaults.fingerMask, 0); assert.equal(defaults.tone, .5); assert.equal(defaults.flightX, .5);
  const value = normalizeWitchControls({ speed: Infinity, radius: 90, direction: -22, gate: 'true',
    fingers: [NaN, -2, 5], voice: 'invalid', mode: 'invalid', volume: -9 });
  assert.equal(value.speed, 0); assert.equal(value.radius, 1); assert.equal(value.direction, -1);
  assert.equal(value.gate, false); assert.equal(value.voice, 'mutter'); assert.equal(value.mode, 'brew');
  assert.deepEqual(value.fingers, [.5, 0, 1, .5, .5]); assert.equal(value.volume, 0);
  value.fingers[0] = 0;
  assert.equal(normalizeWitchControls().fingers[0], .5);
});

test('instrumental control fields and five-finger masks stay bounded', () => {
  const a = normalizeWitchControls({ fingerMask: 7.7, manualFingerMask: 4.8, flightX: -3, tone: 3 });
  assert.equal(a.fingerMask, 8); assert.equal(a.flightX, 0); assert.equal(a.tone, 1);
  assert.equal(a.manualFingerMask, 5);
  const b = normalizeWitchControls({ fingerMask: 1000, manualFingerMask: Infinity, flightX: NaN, tone: Infinity });
  assert.equal(b.fingerMask, 31); assert.equal(b.flightX, .5); assert.equal(b.tone, .5);
  assert.equal(b.manualFingerMask, 0);
  assert.equal(normalizeWitchControls({ mode: 'fingers' }).handFocus, 1);
  assert.equal(normalizeWitchControls({ mode: 'flight', handFocus: 1 }).handFocus, 1);
  const anatomy = normalizeWitchControls({ nose: Infinity, hat: -2, spoonHeight: 7, spoonAuto: 'true' });
  assert.equal(anatomy.nose, .5); assert.equal(anatomy.hat, 0); assert.equal(anatomy.spoonHeight, 1); assert.equal(anatomy.spoonAuto, false);
});

test('spoon height spans five characters with a bounded continuous automatic target', () => {
  for (let i = 0; i < 5; i++) assert.equal(witchVoiceAtHeight((i + .5) / 5), WITCH_VOICES[i]);
  assert.equal(witchVoiceAtHeight(-9), 'mutter'); assert.equal(witchVoiceAtHeight(1), 'sing');
  let low = 1, high = 0;
  for (let i = 0; i < 110; i++) { const value = witchSpoonHeight(i / 10); low = Math.min(low, value); high = Math.max(high, value); }
  assert.ok(low < .05 && high > .95); assert.equal(witchSpoonHeight(NaN), .5);
});

test('two Gesticules hands move with distinct choreography and retain a readable open silhouette', () => {
  const first = evaluateWitchHandPose({}, 0), later = evaluateWitchHandPose({}, .9);
  assert.notDeepEqual(first.fingers, later.fingers);
  assert.notDeepEqual(first, evaluateWitchHandPose({}, 0, 1));
  assert.deepEqual(first, evaluateWitchHandPose({}, 0), 'paused time retains the pose');
  for (let i = 0; i < 40; i++) for (const index of [0, 1]) {
    const pose = evaluateWitchHandPose({}, i * .2, index);
    for (const digit of pose.fingers) {
      assert.ok(digit.mcp < 50 && digit.pip < 70, 'automatic movement does not close a tight fist');
      for (const joint of Object.values(digit)) assert.ok(Number.isFinite(joint));
    }
  }
});

test('manual fingers hold their own bend while neighbours keep gesticulating; reduced motion keeps causal curls', () => {
  const state = { fingers: [.3, .8, .4, .2, .7], manualFingerMask: 0b00010 };
  const a = evaluateWitchHandPose(state, .1), b = evaluateWitchHandPose(state, 1.1);
  assert.deepEqual(a.fingers[1], { mcp: 56, pip: 68, dip: 48, spread: 0 });
  assert.deepEqual(a.fingers[1], b.fingers[1]);
  assert.notDeepEqual(a.fingers[2], b.fingers[2]);
  const ordinary = evaluateWitchHandPose(state, 1.1, 1);
  const reduced = evaluateWitchHandPose({ ...state, reducedMotion: true }, 1.1, 1);
  assert.deepEqual(ordinary.fingers, reduced.fingers);
  assert.deepEqual(reduced.wrist, { flex: 0, side: 0, twist: 0 });
  assert.notDeepEqual(ordinary.wrist, reduced.wrist);
});

test('authored fast hand animations remain finite, distinct and responsive to their own rate and sound',()=>{
  const configurations=new Set();
  for(const [index,motion] of WITCH_HAND_MOTIONS.entries()) {
    assert.ok(HAND_MOTIONS.some(item=>item.id===motion));
    const state=normalizeWitchControls({handMotion:motion,handRate:6,handDepth:1,handSound:WITCH_HAND_SOUNDS[index%WITCH_HAND_SOUNDS.length].id});
    const config=witchHandConfig(state);
    assert.ok(config.voices.every(voice=>VOICE_SOURCES.includes(voice.source)));
    configurations.add(JSON.stringify(config));
    const poses=Array.from({length:20},(_,i)=>evaluateWitchHandPose(state,i*.017));
    assert.ok(poses.every(pose=>pose.fingers.every(finger=>Object.values(finger).every(Number.isFinite))));
    assert.ok(new Set(poses.map(pose=>JSON.stringify(pose.fingers))).size>10,motion);
  }
  assert.equal(configurations.size,WITCH_HAND_MOTIONS.length);
  for(const motion of WITCH_HAND_MOTIONS)for(const rate of [.25,.5,1,4,5,6]) {
    const normal=handMotionPeriod(witchHandConfig({handMotion:motion,handRate:1}).motion);
    const changed=handMotionPeriod(witchHandConfig({handMotion:motion,handRate:rate}).motion);
    assert.ok(Math.abs(normal/changed-rate)<1e-10,'the native choreography preserves the full selected rate');
  }
  const distance=(a,b)=>a.fingers.reduce((sum,finger,i)=>sum+Math.abs(finger.pip-b.fingers[i].pip),0);
  const travel=rate=>Array.from({length:60},(_,i)=>distance(evaluateWitchHandPose({handRate:rate},i/60),evaluateWitchHandPose({handRate:rate},(i+1)/60))).reduce((a,b)=>a+b,0);
  assert.ok(travel(5)>travel(.5)*3,'fast animation has substantially more finger motion');
  const bounded=normalizeWitchControls({handRate:999,handDepth:-2,handSound:'invented',catSpeed:100,catGait:'invented',fabricX:-1,fabricY:2,trailPull:Infinity,trailTwist:NaN});
  assert.equal(bounded.handRate,6);assert.equal(bounded.handDepth,0);assert.equal(bounded.handSound,'glass-and-wire');
  assert.equal(bounded.catSpeed,2);assert.equal(bounded.catGait,'cat-prowl');assert.equal(bounded.fabricX,0);assert.equal(bounded.fabricY,1);
  assert.equal(bounded.trailPull,.5);assert.equal(bounded.trailTwist,.5);
});

test('stir angle wraps, speed responds, and a reversal is immediate', () => {
  const first = updateStir(createStirState(), { angle: 3.1, radius: .2, time: 1 });
  const moving = updateStir(first, { angle: -3.1, radius: .8, time: 1.02 });
  assert.equal(moving.direction, 1); assert.ok(moving.speed > 0); assert.equal(moving.radius, .8);
  assert.ok(moving.velocity < 5, 'crossing π is a short movement');
  const reversed = updateStir(moving, { angle: 3, radius: .8, time: 1.04 });
  assert.equal(reversed.direction, -1); assert.ok(reversed.speed > moving.speed);
  assert.equal(first.velocity, 0, 'updates do not mutate the previous state');
});

test('released vortex coasts identically at different display rates', () => {
  const initial = releaseStir({ ...createStirState(), velocity: 8, speed: 8 / 12, direction: -1, phase: 2 });
  const once = advanceStir(initial, 1);
  let many = initial;
  for (let i = 0; i < 120; i++) many = advanceStir(many, 1 / 120);
  assert.ok(Math.abs(once.velocity - many.velocity) < 1e-12);
  assert.ok(Math.abs(once.phase - many.phase) < 1e-11);
  assert.ok(once.speed > 0 && once.speed < initial.speed);
  assert.ok(once.phase >= 0 && once.phase < WITCH_TAU);
  assert.equal(initial.gate, false); assert.equal(initial.time, null);
});

test('chant traverses the same asymmetric vowel path in reverse and opens with radius', () => {
  for (const phase of [.1, 1.75, 3.4, 9.1]) {
    assert.deepEqual(sampleChant(phase, -1, .6), sampleChant(-phase, 1, .6));
  }
  assert.notEqual(sampleChant(1.2, 1).f1, sampleChant(1.2, -1).f1);
  const pinched = sampleChant(2.4, 1, 0), open = sampleChant(2.4, 1, 1);
  assert.ok(open.mouth > pinched.mouth * 2); assert.ok(open.f1 > pinched.f1 * 2);
  const target = {}; assert.equal(sampleChant(3, 1, .5, target), target);
});
