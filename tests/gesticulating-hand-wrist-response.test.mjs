import test from 'node:test';
import assert from 'node:assert/strict';
import { HAND_PRESETS, normalizeHandConfig, handMotionPeriod, handWristLimits, evaluateHandPose, evaluateHandVoices } from '../src/instruments/gesticulating-hand/hand-model.js';

const axes=['flex','side','twist'];

test('every wrist and ankle slider keeps a useful response through preset motion and tremor',()=>{
  for(const preset of HAND_PRESETS){
    const config=structuredClone(preset.snapshot),limits=handWristLimits(config.form);
    for(let phase=0;phase<12;phase++){
      const time=handMotionPeriod(config.motion)*phase/12;
      for(const key of axes){
        const original=config.pose.wrist[key],[min,max]=limits[key],step=(max-min)/20;
        let previous;
        for(let i=0;i<=20;i++){
          config.pose.wrist[key]=min+i*step;
          const value=evaluateHandPose(config,time).wrist[key];
          assert.ok(Number.isFinite(value)&&value>=min-1e-9&&value<=max+1e-9,`${preset.id}/${key}: bounds`);
          if(i)assert.ok(value-previous>=step*.149999,`${preset.id}/${key}/${phase}: manual movement stalls`);
          previous=value;
        }
        config.pose.wrist[key]=original;
      }
    }
  }
});

test('wrist end positions keep inward animation and still poses keep their exact angles',()=>{
  for(const form of ['hand','foot']){
    const config=normalizeHandConfig({form,motion:{id:'still',amount:0},tremor:{amount:0}}),limits=handWristLimits(form);
    for(const key of axes)for(const value of [limits[key][0],0,limits[key][1]]){
      config.pose.wrist[key]=value;
      assert.equal(evaluateHandPose(config,.4).wrist[key],value);
    }
    config.motion.id='wrist-nod';config.motion.amount=1;
    const period=handMotionPeriod(config.motion);
    config.pose.wrist.flex=limits.flex[0];
    assert.ok(evaluateHandPose(config,period/4).wrist.flex>limits.flex[0]+5);
    config.pose.wrist.flex=limits.flex[1];
    assert.ok(evaluateHandPose(config,period*3/4).wrist.flex<limits.flex[1]-5);
  }
});

test('bend controls move pose and pitch through the former clipped animation ranges',()=>{
  for(const [label,time,values] of [
    ['Paper waltz',1.242236025,[47,53,59,65]],
    ['Cello figure eight',5.228758170,[46,52,58,65]],
    ['Bowed waltz',1.034482759,[34,38,42,45]],
    ['Ankle choir',6.382978723,[35,38,42,45]],
  ]){
    const scene=HAND_PRESETS.find(p=>p.label===label);assert.ok(scene,label);
    const config=structuredClone(scene.snapshot);let previous;
    for(const value of values){
      config.pose.wrist.flex=value;
      const pose=evaluateHandPose(config,time),voices=evaluateHandVoices(config,time);
      if(previous){
        assert.ok(pose.wrist.flex>previous.pose.wrist.flex+.4,`${label}: visible bend`);
        assert.ok(voices.every((voice,i)=>voice.frequency>previous.voices[i].frequency),`${label}: pitch follows bend`);
        assert.deepEqual(pose.fingers,previous.pose.fingers);
      }
      previous={pose,voices};
    }
  }
});
