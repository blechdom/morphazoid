import test from 'node:test';
import assert from 'node:assert/strict';
import {blendWitchSpell,witchAccentEnvelope,witchWebCrossings} from '../src/instruments/witch/witch-scene-model.js';
import {WITCH_PRESETS,normalizeWitchPreset} from '../src/instruments/witch/witch-presets.js';
import {getWitchWeb} from '../src/instruments/witch/witch-renderer.js';

test('ingredient flights interpolate whole spells while leaving clocks and output outside their state',()=>{
  const from=WITCH_PRESETS.find(p=>p.id==='beautiful').snapshot,to=WITCH_PRESETS.find(p=>p.id==='shelf-synthesis').snapshot;
  const original=structuredClone(from);
  assert.deepEqual(blendWitchSpell(from,to,-1),from);
  assert.deepEqual(blendWitchSpell(from,to,2),{...to,scene:from.scene});
  let previous=from;
  for(let i=1;i<=100;i++) {
    const current=blendWitchSpell(from,to,i/100);
    assert.equal(current.scene,from.scene);
    for(const key of ['speed','flightSpeed','nose','hat','hair','handRate','spellBalance','fabricX','trailPull','trailFeedback','trailSpace','treeSpread','treeCurl']) {
      assert.ok(Number.isFinite(current[key]));
      assert.ok(current[key]>=Math.min(from[key],to[key])&&current[key]<=Math.max(from[key],to[key]));
      assert.ok(Math.abs(current[key]-previous[key])<=Math.abs(to[key]-from[key])*.016+1e-10);
    }
    for(const key of ['volume','gate','audioOn','handTime','performanceTime','catCaptured'])assert.equal(key in current,false,key);
    assert.equal(current.fingers.length,5);previous=current;
  }
  assert.deepEqual(from,original);
  const interrupted=blendWitchSpell(from,to,.37),next=WITCH_PRESETS[3].snapshot;
  assert.deepEqual(blendWitchSpell(interrupted,next,0),normalizeWitchPreset(interrupted));
});

test('ingredient transitions never launch, land or change the player-selected hand focus',()=>{
  for(const scene of ['brew','fingers','flight'])for(const targetScene of ['brew','fingers','flight']) {
    const from={...WITCH_PRESETS[0].snapshot,scene,stirAuto:false,handAuto:true},to={...WITCH_PRESETS[1].snapshot,scene:targetScene,stirAuto:true,handAuto:false};
    for(const progress of [0,.25,.5,.75,1,2]) {
      const current=blendWitchSpell(from,to,progress);
      assert.equal(current.scene,scene);
      assert.equal(current.stirAuto,progress>=.5);
      assert.equal(current.handAuto,progress<.5);
    }
    assert.deepEqual(blendWitchSpell(from,to,1),{...to,scene});
  }
});

test('eye and spider accents start gently and end at their fixed duration',()=>{
  for(const duration of [1.3,1.5]) {
    assert.equal(witchAccentEnvelope(-1,duration),0);assert.equal(witchAccentEnvelope(0,duration),0);
    assert.ok(witchAccentEnvelope(.1,duration)>.8);
    assert.equal(witchAccentEnvelope(duration,duration),0);assert.equal(witchAccentEnvelope(Infinity,duration),0);
    for(let i=0;i<200;i++)assert.ok(witchAccentEnvelope(i/100,duration)<=1);
  }
});

test('a radial web strum catches consecutive silk rings in the same note sector',()=>{
  const web=getWitchWeb(),from={x:942.5,y:270},to={x:925,y:200};
  const forward=witchWebCrossings(web,from,to,56),backward=witchWebCrossings(web,to,from,56);
  assert.ok(forward.length>=4,'one fast swipe plays several threads even without changing note sector');
  assert.equal(new Set(forward.map(pluck=>pluck.index)).size,1);
  assert.equal(backward.length,forward.length,'reversing across the same silk plucks it again');
  assert.ok(forward.every((pluck,i)=>!i||pluck.t>forward[i-1].t),'attacks follow the direction of travel');
  const slow=[];
  for(let i=0;i<10;i++)slow.push(...witchWebCrossings(web,
    {x:from.x+(to.x-from.x)*i/10,y:from.y+(to.y-from.y)*i/10},
    {x:from.x+(to.x-from.x)*(i+1)/10,y:from.y+(to.y-from.y)*(i+1)/10},56));
  assert.equal(slow.length,forward.length,'sparse pointer events do not lose strings');
});

test('web strums ignore a held pointer, the spider body and duplicate silk junctions',()=>{
  const web=getWitchWeb(),p={x:930,y:220};
  assert.deepEqual(witchWebCrossings(web,p,p),[]);
  assert.deepEqual(witchWebCrossings(web,p,{x:NaN,y:220}),[]);
  const from={x:922.5,y:190},to={x:915,y:160};
  assert.deepEqual(witchWebCrossings(web,from,to,56),[]);
  assert.ok(witchWebCrossings(web,from,to,0).length>0,'capturing the spider exposes the silk behind it');
  const junction={center:{x:100,y:100},strands:[[{x:-10,y:0},{x:0,y:0}],[{x:0,y:0},{x:10,y:0}],[{x:0,y:-10},{x:0,y:10}]]};
  assert.equal(witchWebCrossings(junction,{x:-5,y:-5},{x:5,y:5}).length,1);
  assert.ok(witchWebCrossings(web,{x:700,y:20},{x:990,y:370}).length<=8,'one coarse input event has a bounded strum');
});
