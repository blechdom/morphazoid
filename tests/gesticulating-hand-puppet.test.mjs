import test from 'node:test';
import assert from 'node:assert/strict';
import {HAND_PRESETS,HAND_MOTIONS,handPoseForForm,normalizeHandConfig,evaluateHandPose,evaluateHandVoices,handMotionPeriod,handJointKeys,handDigitLimits,handWristLimits} from '../src/instruments/gesticulating-hand/hand-model.js';
const scene=HAND_PRESETS.find(p=>p.id==='gesture-puppet-mouth');
const vector=p=>[...p.fingers.flatMap(f=>[f.mcp,f.pip,f.dip,f.spread]),...Object.values(p.wrist)];

test('puppet mouth starts at its editable midpoint and moves the fingers together against the thumb',()=>{
  assert.ok(scene);const c=scene.snapshot,period=handMotionPeriod(c.motion);
  assert.equal(HAND_MOTIONS.find(m=>m.id==='puppet-mouth').beats,2);
  assert.deepEqual(c.pose,handPoseForForm('puppet-mouth'));
  assert.deepEqual(evaluateHandPose(c,0).fingers,c.pose.fingers);
  const open=evaluateHandPose(c,period/4),closed=evaluateHandPose(c,period*3/4);
  for(let i=1;i<5;i++){
    assert.ok(closed.fingers[i].mcp-open.fingers[i].mcp>30,'upper jaw opens together');
    assert.ok(closed.fingers[i].pip-open.fingers[i].pip>30,'fingertips uncurl together');
    for(const key of ['mcp','pip','dip'])assert.equal(open.fingers[i][key],open.fingers[1][key]);
  }
  assert.ok(open.fingers[0].pip-closed.fingers[0].pip>15,'thumb counter-moves at the knuckle');
  for(let i=0;i<5;i++)assert.equal(open.fingers[i].spread,closed.fingers[i].spread);
  const before=vector(evaluateHandPose(c,period*(1-1e-7))),after=vector(evaluateHandPose(c,period*1e-7));
  assert.ok(Math.max(...before.map((v,i)=>Math.abs(v-after[i])))<.001,'continuous loop seam');
  const a=evaluateHandVoices(c,period/4),b=evaluateHandVoices(c,period*3/4);
  for(let i=0;i<5;i++)assert.notDeepEqual(a[i],b[i],`jaw motion changes voice ${i}`);
});

test('puppet motion is bounded on both rigs and leaves the entire base joint range editable',()=>{
  for(const form of ['hand','foot']){
    const c=normalizeHandConfig({...scene.snapshot,form,pose:handPoseForForm('puppet-mouth',form)}),period=handMotionPeriod(c.motion);
    for(let step=0;step<=64;step++){
      const pose=evaluateHandPose(c,period*step/64);
      for(let finger=0;finger<5;finger++)for(const [key,[min,max]]of Object.entries(handDigitLimits(form,finger)))assert.ok(pose.fingers[finger][key]>=min&&pose.fingers[finger][key]<=max);
      for(const [key,[min,max]]of Object.entries(handWristLimits(form)))assert.ok(pose.wrist[key]>=min&&pose.wrist[key]<=max);
      if(form==='foot'){assert.equal(pose.source,null);assert.equal(pose.fingers[0].pip,0);}
    }
    for(let finger=0;finger<5;finger++)for(const key of handJointKeys(form,finger)){
      const [min,max]=handDigitLimits(form,finger)[key];
      for(let step=0;step<=10;step++){
        const value=min+(max-min)*step/10,changed=structuredClone(c);changed.pose.fingers[finger][key]=value;
        assert.equal(evaluateHandPose(changed,0).fingers[finger][key],value,`${form}/${finger}/${key}`);
      }
    }
    const still=structuredClone(c);still.motion.amount=0;
    assert.deepEqual(evaluateHandPose(still,period/4).fingers,c.pose.fingers);
  }
});
