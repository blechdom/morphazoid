import test from 'node:test';
import assert from 'node:assert/strict';
import { HandDSP } from '../src/instruments/gesticulating-hand/hand-dsp.js';
import { HAND_DEFAULTS, HAND_PRESETS, VOICE_SOURCES, normalizeHandConfig, evaluateHandVoices, evaluateHandPose, handJointKeys } from '../src/instruments/gesticulating-hand/hand-model.js';

const copy = structuredClone;
const rms = a => Math.sqrt(a.reduce((sum, v) => sum + v * v, 0) / a.length);
const difference = (a, b) => rms(a.map((v, i) => v - b[i]));
const scene = (pitchSpread = 1, source = 'wire', form = 'hand') => normalizeHandConfig({ form, motion: { id: 'still' },
  sound: { pitchSpread, rootHz: 180, space: 0, rotationFx: 0, attack: .004, release: .08 },
  voices: Array.from({length:5}, () => ({source,level:.65})) });
function engine(config, rate = 24000) {
  const dsp = new HandDSP(rate); dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(true); return dsp;
}
function render(dsp, seconds = .18) {
  const left = new Float32Array(Math.round(dsp.sampleRate * seconds)), right = new Float32Array(left.length);
  for (let start = 0; start < left.length; start += 128) dsp.process(left.subarray(start,start+128),right.subarray(start,start+128));
  assert.ok(left.every(v => Number.isFinite(v) && Math.abs(v) < .82));
  assert.ok(right.every(v => Number.isFinite(v) && Math.abs(v) < .82));
  return left;
}

test('pitch spread migrates legacy scenes to 100 percent and stays bounded', () => {
  assert.equal(HAND_DEFAULTS.sound.pitchSpread,1);
  const legacy=scene();delete legacy.sound.pitchSpread;
  assert.equal(normalizeHandConfig(legacy).sound.pitchSpread,1);
  assert.deepEqual(evaluateHandVoices(legacy,.31),evaluateHandVoices(scene(1),.31));
  assert.deepEqual(render(engine(legacy)),render(engine(scene(1))));
  for(const value of [undefined,null,NaN,Infinity,Symbol(),{}]) assert.equal(normalizeHandConfig({sound:{pitchSpread:value}}).sound.pitchSpread,1);
  assert.equal(normalizeHandConfig({sound:{pitchSpread:-1}}).sound.pitchSpread,0);
  assert.equal(normalizeHandConfig({sound:{pitchSpread:9}}).sound.pitchSpread,4);
  assert.equal(normalizeHandConfig({sound:{pitchSpread:'2.37'}}).sound.pitchSpread,2.37);
  for(const preset of HAND_PRESETS) assert.deepEqual(normalizeHandConfig(preset.snapshot),preset.snapshot);
  assert.equal(HAND_PRESETS[0].snapshot.sound.pitchSpread,1);
  for(const form of ['hand','foot']) {
    const values=HAND_PRESETS.filter(p=>p.snapshot.form===form).map(p=>p.snapshot.sound.pitchSpread);
    assert.ok(Math.min(...values)<.7 && Math.max(...values)>2);
  }
});

test('spread widens continuous voice intervals independently of Register and visible pose', () => {
  for(const form of ['hand','foot']) {
    const config=scene(0,'glass',form),pose=evaluateHandPose(config,.3);
    const frequencies=[];
    for(const spread of [0,.01,.5,1,2,4]) {
      config.sound.pitchSpread=spread;
      frequencies.push(evaluateHandVoices(config,0).map(v=>v.frequency));
      assert.deepEqual(evaluateHandPose(config,.3),pose);
    }
    assert.ok(frequencies[0].every(f=>Math.abs(f-180)<1e-10));
    for(let step=1;step<frequencies.length;step++) {
      assert.ok(frequencies[step][0]<frequencies[step-1][0]);
      assert.ok(frequencies[step][4]>frequencies[step-1][4]);
      assert.equal(frequencies[step][2],frequencies[0][2]);
    }
    const span=a=>Math.log2(Math.max(...a)/Math.min(...a));
    assert.ok(Math.abs(span(frequencies[5])-4*span(frequencies[3]))<1e-10);
    config.sound.pitchSpread=2;const original=evaluateHandVoices(config,0);config.sound.rootHz=270;
    const shifted=evaluateHandVoices(config,0);
    for(let i=0;i<5;i++)assert.ok(Math.abs(shifted[i].frequency/original[i].frequency-1.5)<1e-10);
  }
});

test('zero pitch spread retains every joint pitch or timbre destination and body gestures', () => {
  for(const form of ['hand','foot']) {
    const base=scene(0,'wire',form),before=evaluateHandVoices(base,0);
    for(let i=0;i<5;i++)for(const joint of handJointKeys(form,i)){
      const changed=copy(base);changed.pose.fingers[i][joint]=joint==='spread'?5:12;
      const after=evaluateHandVoices(changed,0);
      assert.ok(after[i].frequency!==before[i].frequency || after[i].brightness!==before[i].brightness,`${form}/${i}/${joint}`);
    }
    for(const key of ['flex','side','twist']){
      const changed=copy(base);changed.pose.wrist[key]=7;
      assert.notDeepEqual(evaluateHandVoices(changed,0),before);
    }
    if(form==='foot')for(const [key,value]of [['arch',20],['twist',15],['stretch',.4]]){
      const changed=copy(base);changed.pose.foot[key]=value;
      assert.notDeepEqual(evaluateHandVoices(changed,0),before);
    }
  }
});

test('pitch spread changes all ten engines with bounded low/high-register output', () => {
  for(const source of VOICE_SOURCES)for(const form of ['hand','foot']){
    const baseline=render(engine(scene(1,source,form)));
    for(const spread of [0,4])assert.ok(difference(baseline,render(engine(scene(spread,source,form))))>rms(baseline)*.1,`${source}/${form}/${spread}`);
    for(const rate of [8000,48000])for(const rootHz of [35,1600])for(const pitchSpread of [0,4]){
      const config=scene(pitchSpread,source,form);config.sound.rootHz=rootHz;
      const dsp=engine(config,rate);render(dsp,.08);
      assert.ok(dsp.targets.every(v=>v.frequency>=25&&v.frequency<=Math.min(4200,rate*.17)));
    }
  }
});

test('live pitch-spread sweeps preserve clock and gates and enter through pitch smoothing', () => {
  for(const source of ['pulse','choir','marimba'])for(const spread of [0,2.37,4]){
    // Identical warm-up per transition isolates its first sample; carrying a
    // one-sample pitch lag into later comparisons would measure phase drift.
    const config=scene(1,source),dsp=engine(config),reference=engine(config);
    dsp.setTransport({time:.31,playing:true});reference.setTransport({time:.31,playing:true});
    render(dsp);render(reference);
    const time=dsp.getMotionTime();config.sound.pitchSpread=spread;dsp.setConfig(config);
    assert.equal(dsp.getMotionTime(),time);assert.equal(dsp.playing,true);assert.equal(dsp.soundPlaying,true);assert.equal(dsp.enabled,true);
    const changed=new Float32Array(1),unchanged=new Float32Array(1);dsp.process(changed);reference.process(unchanged);
    assert.ok(Math.abs(changed[0]-unchanged[0])<.001,`${source}/${spread}: discontinuous first sample ${changed[0]-unchanged[0]}`);
    render(dsp,.12);
    const targets=dsp.targets.map(v=>v.frequency);
    for(let i=0;i<5;i++)assert.ok(Math.abs(dsp.voices[i].frequency/targets[i]-1)<.001,'pitch smoothing reaches the requested spread');
  }
});
