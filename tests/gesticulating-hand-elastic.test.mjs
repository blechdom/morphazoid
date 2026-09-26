import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOT_LIMITS, HAND_DEFAULTS, HAND_MOTIONS, VOICE_SOURCES, createHandPose,
  normalizeHandConfig, evaluateHandPose, evaluateHandVoices, handMotionPeriod, randomizeHandConfig } from '../src/instruments/gesticulating-hand/hand-model.js';
import { HandDSP } from '../src/instruments/gesticulating-hand/hand-dsp.js';
const clone = value => structuredClone(value);
const neutral = () => normalizeHandConfig({form:'foot',motion:{id:'still'},sound:{space:0,rotationFx:0,attack:.01,release:.08}});
const rms = values => Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
const peak = values => values.reduce((maximum,value)=>Math.max(maximum,Math.abs(value)),0);
function render(dsp,seconds=.15) {
  const left = new Float32Array(Math.round(dsp.sampleRate*seconds)),right=new Float32Array(left.length);
  for(let i=0;i<left.length;i+=128)dsp.process(left.subarray(i,i+128),right.subarray(i,i+128));
  assert.ok(left.every(Number.isFinite)&&right.every(Number.isFinite));assert.ok(peak(left)<.82&&peak(right)<.82);
  return left;
}
function engine(config,rate=24000){const dsp=new HandDSP(rate);dsp.setConfig(config);dsp.setEnabled(true);dsp.setSoundPlaying(true);return dsp;}
function within(shape){for(const [key,[min,max]] of Object.entries(FOOT_LIMITS.shape))assert.ok(Number.isFinite(shape[key])&&shape[key]>=min&&shape[key]<=max,`${key}: ${shape[key]}`);}

test('elastic state is additive, bounded and neutral for old configurations',()=>{
  assert.equal(HAND_DEFAULTS.motion.elasticity,0);assert.equal(HAND_DEFAULTS.pose.foot,undefined);
  const legacy=neutral();delete legacy.pose.foot;delete legacy.motion.elasticity;
  const normalized=normalizeHandConfig(legacy);assert.deepEqual(normalized.pose.foot,{arch:0,twist:0,stretch:0});assert.equal(normalized.motion.elasticity,0);
  assert.deepEqual(evaluateHandPose(normalized,.3).foot,{arch:0,twist:0,stretch:0});
  const wild=normalizeHandConfig({form:'foot',pose:{foot:{arch:1000,twist:-1000,stretch:-5}},motion:{elasticity:7}});
  assert.deepEqual(wild.pose.foot,{arch:85,twist:-55,stretch:-.4});assert.equal(wild.motion.elasticity,1);
  for(const input of [undefined,null,NaN,Infinity,Symbol(),{},'not a number']){
    const c=normalizeHandConfig({form:'foot',pose:{foot:{arch:input,twist:input,stretch:input}},motion:{elasticity:input}});
    assert.deepEqual(c.pose.foot,{arch:0,twist:0,stretch:0});assert.equal(c.motion.elasticity,0);
  }
  const hand=normalizeHandConfig({...wild,form:'hand'});assert.equal(hand.pose.foot,undefined);
  const storage=createHandPose();evaluateHandPose(wild,.2,storage);assert.ok(storage.foot);evaluateHandPose(hand,.2,storage);assert.equal(storage.foot,undefined);
  const copy=normalizeHandConfig(wild);copy.pose.foot.arch=0;assert.equal(wild.pose.foot.arch,85);
});

test('elastic choreography has bounded periodic deformation on the shared tempo/speed timeline',()=>{
  const out=createHandPose();
  for(const motion of HAND_MOTIONS){
    const c=normalizeHandConfig({form:'foot',pose:{foot:{arch:12,twist:-9,stretch:.17}},motion:{id:motion.id,elasticity:1,amount:1,tempo:1100,speed:4}});
    const period=handMotionPeriod(c.motion);evaluateHandPose(c,.123,out);const storage=out.foot;
    const samples=[];
    for(let step=0;step<=128;step++){evaluateHandPose(c,period*step/128,out);within(out.foot);assert.equal(out.foot,storage);samples.push(clone(out.foot));}
    if(motion.id==='still')assert.ok(samples.every(shape=>JSON.stringify(shape)===JSON.stringify(c.pose.foot)));
    else for(const key of ['arch','twist','stretch'])assert.ok(new Set(samples.map(shape=>shape[key])).size>20,`${motion.id} ${key} moves`);
    const a=evaluateHandPose(c,period*.371).foot,b=evaluateHandPose(c,period*1.371).foot;
    for(const key of Object.keys(a))assert.ok(Math.abs(a[key]-b[key])<1e-9);
    const faster=normalizeHandConfig({...c,motion:{...c.motion,tempo:601,speed:1.7}});
    const rebased=evaluateHandPose(faster,period*.371*handMotionPeriod(faster.motion)/period).foot;
    for(const key of Object.keys(a))assert.ok(Math.abs(a[key]-rebased[key])<1e-9);
    c.motion.amount=0;assert.deepEqual(evaluateHandPose(c,.417).foot,c.pose.foot);
  }
});

test('arch, stretch and twist each make the declared continuous sound change',()=>{
  const c=neutral(),plain=evaluateHandVoices(c,0);
  const arch=clone(c);arch.pose.foot.arch=40;const raised=evaluateHandVoices(arch,0);
  const stretch=clone(c);stretch.pose.foot.stretch=.8;const longer=evaluateHandVoices(stretch,0);
  const twist=clone(c);twist.pose.foot.twist=35;const turned=evaluateHandVoices(twist,0);
  for(let i=0;i<5;i++){
    assert.ok(raised[i].frequency>plain[i].frequency);assert.ok(raised[i].brightness>plain[i].brightness);
    assert.ok(longer[i].frequency<plain[i].frequency);assert.ok(turned[i].pan>plain[i].pan);assert.ok(turned[i].roughness>plain[i].roughness);
  }
  const base=render(engine(c));
  for(const variant of [arch,stretch,twist]){const signal=render(engine(variant));assert.ok(rms(signal.map((value,i)=>value-base[i]))>.001);}
  const moving=normalizeHandConfig({...c,motion:{id:'wave',elasticity:.8,amount:1}});
  const voices=evaluateHandVoices(moving,.21);assert.ok(voices.every(voice=>voice.excitation>0));
});

test('extreme elastic shapes stay finite across engines and preserve live players through edits',()=>{
  for(const rate of [8000,48000,192000])for(const source of VOICE_SOURCES){
    const c=neutral();c.voices.forEach(voice=>{voice.source=source;voice.level=.7;});c.motion={id:'frantic-orbit',tempo:1100,speed:4,amount:1,elasticity:1};
    Object.assign(c.sound,{rotationFx:1,space:1,brightness:1,roughness:1});
    const dsp=engine(c,rate);dsp.setTransport({playing:true,time:.3});
    for(const shape of [{arch:-70,twist:-55,stretch:-.4},{arch:85,twist:55,stretch:1},{arch:0,twist:0,stretch:0}]){
      c.pose.foot=shape;const time=dsp.getMotionTime();dsp.setConfig(c);assert.equal(dsp.getMotionTime(),time);assert.equal(dsp.playing,true);assert.equal(dsp.soundPlaying,true);
      assert.ok(rms(render(dsp,.08))>.001);within(dsp.pose.foot);
    }
    dsp.setSoundPlaying(false);dsp.setTransport({playing:false});render(dsp,.6);assert.ok(peak(render(dsp,.05))<.01);
  }
});

test('full randomization explores arch, torsion, compression, stretch and elastic movement',()=>{
  let seed=701;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const shapes=[],amounts=[];
  for(let i=0;i<200;i++){const c=randomizeHandConfig(HAND_DEFAULTS,random);if(c.form==='foot'){within(c.pose.foot);shapes.push(c.pose.foot);amounts.push(c.motion.elasticity);}}
  assert.ok(shapes.length>60);
  for(const [key,[min,max]] of Object.entries(FOOT_LIMITS.shape)){
    assert.ok(Math.min(...shapes.map(shape=>shape[key]))<min+(max-min)*.15);assert.ok(Math.max(...shapes.map(shape=>shape[key]))>max-(max-min)*.15);
  }
  assert.ok(Math.min(...amounts)<.1&&Math.max(...amounts)>.9);
});
