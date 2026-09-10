import test from 'node:test';
import assert from 'node:assert/strict';
import { PugglerModel, PROPS, propFor, launchFlight, flightPosition, soundMapping } from '../src/puggler.js';
import { PAGE_DEFAULTS, PRESETS } from '../src/puggler-presets.js';

const additions=['icecream','axe','deadcat','hydrant','pickle','violin','skull','banana','snake','plant','plunger','cd','vhs'];

test('the 33-object bank exposes every requested addition, excludes the mushroom, and uses bounded existing material mappings',()=>{
  const ids=new Set(PROPS.map(p=>p.id));
  assert.equal(PROPS.length,33);assert.equal(ids.size,33);
  for(const id of additions)assert.ok(ids.has(id),id);
  assert.ok(!ids.has('mushroom'));assert.notEqual(propFor('mushroom').id,'mushroom');
  assert.equal(propFor('deadcat').name,'Dead cat');
  assert.ok(PROPS.every(p=>['rubber','metal','wood','glass','reed','air'].includes(p.voice)));
  for(const prop of PROPS){
    assert.ok([prop.mass,prop.drag,prop.bounce,prop.hz,prop.decay,prop.radius].every(Number.isFinite),prop.id);
    assert.ok(prop.mass>0&&prop.mass<=6.8);assert.ok(prop.drag>0&&prop.drag<=.2);
    assert.ok(prop.bounce>=0&&prop.bounce<=1);assert.ok(prop.radius>=20&&prop.radius<=35);
    const sound=soundMapping(prop,{x:1500,y:200000,vx:18000,vy:-30000});
    assert.ok(Object.values(sound).every(Number.isFinite));
    assert.ok(sound.frequency>=35&&sound.frequency<=5000);assert.ok(sound.energy>=.02&&sound.energy<=1);
  }
});

test('new material contrasts drive actual throw spin, hand recoil and world-space wind response',()=>{
  const light=propFor('cd'),heavy=propFor('hydrant');
  assert.equal(heavy.mass,Math.max(...PROPS.map(p=>p.mass)));
  assert.equal(light.mass,Math.min(...PROPS.map(p=>p.mass)));
  assert.ok(propFor('pickle').mass<propFor('ball').mass);
  const throwOne=prop=>{
    const model=new PugglerModel({count:1,pattern:'single',propIds:[prop.id],rideSpeed:0});
    model.step(1/120);return {object:model.objects[0],rider:model.players[0]};
  };
  const disc=throwOne(light),hydrant=throwOne(heavy);
  assert.ok(Math.abs(disc.object.spinRate)>Math.abs(hydrant.object.spinRate)*4);
  assert.ok(Math.abs(hydrant.rider.recoil)>Math.abs(disc.rider.recoil)*4);
  for(const shot of [disc,hydrant])assert.ok(Math.abs(shot.object.spinRate)>=3&&Math.abs(shot.object.spinRate)<=22);
  const windDrift=prop=>{
    const flight=launchFlight({x:0,y:270,targetX:120,duration:1,mass:prop.mass,drag:prop.drag,g:2200,wind:5});
    return flightPosition(flight,1).x-120;
  };
  assert.ok(windDrift(light)>windDrift(heavy)*10);
  assert.ok(propFor('plunger').bounce>propFor('deadcat').bounce*10);
});

test('seeded audience replacement reaches the full new bank while preserving each object’s sound roles',()=>{
  const model=new PugglerModel({count:1,rideSpeed:0}),object=model.objects[0],seen=new Set();
  const roles={drum:object.drum,riff:object.riff};
  for(let i=0;i<1024;i++){
    const previous=object.prop.id;model.events=[];model.replace(object);
    assert.notEqual(object.prop.id,previous);assert.ok(object.vy>0);assert.equal(object.phase,'replacement');
    assert.deepEqual({drum:object.drum,riff:object.riff},roles);seen.add(object.prop.id);
  }
  assert.deepEqual([...seen].sort(),PROPS.map(p=>p.id).sort());assert.ok(!seen.has('mushroom'));
});

test('new acts showcase all additions and preserve the original opening lineup and valid preset selections',()=>{
  const newActs=PRESETS.filter(p=>['gutter-buffet','curbside-requiem','plumbing-riot','bootleg-bin'].includes(p.id));
  assert.equal(newActs.length,4);
  const shown=new Set(newActs.flatMap(p=>p.config.propIds.slice(0,p.config.count)));
  for(const id of additions)assert.ok(shown.has(id),id);
  const opening=new PugglerModel(PAGE_DEFAULTS);
  assert.equal(PRESETS[0].id,'ballet');assert.equal(opening.config.cast,'trio');assert.equal(opening.objects.length,6);
  assert.deepEqual(opening.objects.map(o=>o.prop.id),['guitar','can','boot','vinyl','cassette','plushrat']);
  for(const preset of PRESETS)for(const id of preset.config.propIds)assert.ok(PROPS.some(p=>p.id===id),`${preset.id}/${id}`);
});
