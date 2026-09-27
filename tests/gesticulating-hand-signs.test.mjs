import test from 'node:test';
import assert from 'node:assert/strict';
import { HAND_POSES,HAND_PRESETS,HAND_MOTIONS,normalizeHandConfig,evaluateHandPose,evaluateHandVoices,handPoseForForm,handMotionPeriod,handJointKeys,handDigitLimits,handWristLimits } from '../src/instruments/gesticulating-hand/hand-model.js';

const signs=[
  ['middle-finger',[false,false,true,false,false]],
  ['hang-loose',[true,false,false,false,true]],
  ['i-love-you',[true,true,false,false,true]],
  ['rock-and-roll',[false,true,false,false,true]],
  ['vulcan-salute',[true,true,true,true,true]],
];
const vector=pose=>[...pose.fingers.flatMap(f=>[f.mcp,f.pip,f.dip,f.spread]),...Object.values(pose.wrist)];
function assertSign(pose,extended,label){
  for(let i=0;i<5;i++){
    const f=pose.fingers[i],bend=f.mcp+f.pip+f.dip;
    assert.ok(extended[i]?bend<30:bend>110,`${label}: ${i} should be ${extended[i]?'extended':'folded'} (bend ${bend})`);
  }
}

test('five static hand signs have the requested finger and thumb silhouettes',()=>{
  for(const [id,extended]of signs){
    const pose=HAND_POSES.find(p=>p.id===id);assert.ok(pose,id);
    assertSign(pose.pose,extended,id);
    assert.deepEqual(handPoseForForm(id),pose.pose);
    assert.ok(HAND_MOTIONS.some(m=>m.id===id));
  }
  const love=handPoseForForm('i-love-you'),horns=handPoseForForm('rock-and-roll');
  assert.deepEqual(love.fingers.slice(1),horns.fingers.slice(1));
  assert.notDeepEqual(love.fingers[0],horns.fingers[0]);
});

test('complete gesture scenes keep their signs throughout distinct continuous motion loops',()=>{
  for(const [id,extended]of signs){
    const preset=HAND_PRESETS.find(p=>p.id==='gesture-'+id);assert.ok(preset,id);
    const config=structuredClone(preset.snapshot);config.tremor.amount=0;
    assert.equal(config.form,'hand');assert.equal(config.motion.id,id);
    assert.deepEqual(evaluateHandPose(config,0).fingers,handPoseForForm(id).fingers);
    const period=handMotionPeriod(config.motion),first=vector(evaluateHandPose(config,0));let movement=0;
    for(let i=0;i<=64;i++){
      const pose=evaluateHandPose(config,period*i/64);assertSign(pose,extended,id);
      movement=Math.max(movement,...vector(pose).map((v,j)=>Math.abs(v-first[j])));
      assert.deepEqual(pose.fingers.map(f=>f.spread),handPoseForForm(id).fingers.map(f=>f.spread));
    }
    assert.ok(movement>9,id+' animates visibly');
    const before=vector(evaluateHandPose(config,period*(1-1e-7))),after=vector(evaluateHandPose(config,period*1e-7));
    assert.ok(Math.max(...before.map((v,i)=>Math.abs(v-after[i])))<.001,id+' loop seam');
  }
});

test('gesture scenes retain editable joints and real sonic destinations',()=>{
  for(const [id]of signs){
    const config=HAND_PRESETS.find(p=>p.id==='gesture-'+id).snapshot,pose=evaluateHandPose(config,.37),voices=evaluateHandVoices(config,.37);
    for(let finger=0;finger<5;finger++)for(const key of handJointKeys('hand',finger)){
      const changed=structuredClone(config),value=pose.fingers[finger][key];
      changed.pose.fingers[finger][key]+=key==='spread'&&value>20?-3:3;
      assert.notEqual(evaluateHandPose(changed,.37).fingers[finger][key],value,`${id}/${finger}/${key}: manual edit`);
      assert.notDeepEqual(evaluateHandVoices(changed,.37)[finger],voices[finger],`${id}/${finger}/${key}: sound`);
      assert.deepEqual(changed.motion,config.motion);
    }
  }
});

test('sign joint controls cover the full pose range without fixed-offset dead travel',()=>{
  for(const [id]of signs)for(const form of ['hand','foot']){
    const config=normalizeHandConfig({...HAND_PRESETS.find(p=>p.id==='gesture-'+id).snapshot,form,pose:handPoseForForm(id,form)});
    config.tremor.amount=0;
    for(let finger=0;finger<5;finger++)for(const key of handJointKeys(form,finger)){
      const [min,max]=handDigitLimits(form,finger)[key];
      for(let step=0;step<=10;step++){
        const value=min+(max-min)*step/10,changed=structuredClone(config);
        changed.pose.fingers[finger][key]=value;
        assert.ok(Math.abs(evaluateHandPose(changed,0).fingers[finger][key]-value)<1e-8,`${id}/${form}/${finger}/${key}: ${value}`);
      }
    }
  }
});

test('the five signs adapt to bounded toe shapes and preserve the foot topology',()=>{
  for(const [id]of signs){
    const config=normalizeHandConfig({form:'foot',pose:handPoseForForm(id,'foot'),motion:{id,amount:1}}),period=handMotionPeriod(config.motion);
    for(let i=0;i<=32;i++){
      const pose=evaluateHandPose(config,period*i/32);assert.equal(pose.source,null);assert.equal(pose.fingers[0].pip,0);
      for(let finger=0;finger<5;finger++)for(const [key,[min,max]]of Object.entries(handDigitLimits('foot',finger)))assert.ok(pose.fingers[finger][key]>=min&&pose.fingers[finger][key]<=max);
      for(const [key,[min,max]]of Object.entries(handWristLimits('foot')))assert.ok(pose.wrist[key]>=min&&pose.wrist[key]<=max);
    }
  }
});
