import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, LAYOUTS, PRESETS, MAX_DOMINOES, MAX_COMPILED_PUSHES,
  MIN_DOMINO_HEIGHT, MAX_DOMINO_HEIGHT, sanitizeParams, randomizeParams, dominoHeight,
  applyRunTransform, buildRun, compileRun, createRunSimulation } from '../src/instruments/domino-run/domino-run-model.js';
const close = (a,b,e=1e-7) => assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const advance = (sim,t) => { let batches=0; while(!sim.advance(t).complete)assert.ok(++batches<100); };
const closed = new Set(['henge','polygon','flower','figure-eight']);
const assertBounded = run => {
  assert.equal(run.dominoes.length,run.params.count);
  assert.equal(new Set(run.dominoes.map(d=>d.id)).size,run.params.count);
  assert.ok(run.links.length<=run.dominoes.length);
  const out = new Map();
  for(const link of run.links){assert.ok(run.dominoes.some(d=>d.id===link.from));assert.ok(run.dominoes.some(d=>d.id===link.to));out.set(link.from,(out.get(link.from)||0)+1);}
  assert.ok([...out.values()].every(n=>n<=2));
  assert.ok(run.roots.length>0 && run.roots.every(id=>run.dominoes.some(d=>d.id===id)));
  for(const d of run.dominoes){
    for(const key of ['x','z','elevation','angle','height','width','depth'])assert.ok(Number.isFinite(d[key]),key);
    assert.ok(d.height>=MIN_DOMINO_HEIGHT && d.height<=MAX_DOMINO_HEIGHT);
    close(d.width/d.height,.5);close(d.depth/d.height,.16);
  }
  assert.ok(Object.values(run.bounds).every(Number.isFinite));
};

test('expanded parameters retain the whole requested range and moderate defaults',()=>{
  assert.deepEqual(sanitizeParams({}),DEFAULT_PARAMS);
  const low=sanitizeParams({count:-1,size:-1,spacing:-1,sizeVariation:-1,growth:-9,stairRise:-9,speed:0,standDelay:0,brightness:-1,pitch:-100,rotation:-999,stretch:0,curvature:0});
  assert.deepEqual([low.count,low.size,low.spacing,low.sizeVariation,low.growth,low.stairRise,low.speed,low.standDelay,low.brightness,low.pitch,low.rotation,low.stretch,low.curvature],[4,.1,.12,0,-2,-1,.05,.05,0,-36,-180,.2,.2]);
  const high=sanitizeParams({count:9999,size:99,spacing:99,sizeVariation:99,growth:99,stairRise:99,speed:99,standDelay:99,brightness:99,pitch:99,rotation:999,stretch:99,curvature:99,direction:'reverse'});
  assert.deepEqual([high.count,high.size,high.spacing,high.sizeVariation,high.growth,high.stairRise,high.speed,high.standDelay,high.brightness,high.pitch,high.rotation,high.stretch,high.curvature,high.direction],[1024,6,2.5,1,2,1,12,60,1,36,180,5,3,'reverse']);
  assert.equal(MAX_COMPILED_PUSHES,MAX_DOMINOES);
});

test('shared height modulation opens large positive ratios and keeps zero exactly uniform',()=>{
  for(const wave of [-1,-.5,0,.5,1])assert.equal(dominoHeight(1.2,.2,wave,{growth:0,sizeVariation:0}),1.2);
  const grow=buildRun({layout:'serpentine',count:128,size:6,sizeVariation:0,growth:2});
  assert.ok(grow.dominoes.at(-1).height>50);
  assert.ok(grow.dominoes.at(-1).height/grow.dominoes[0].height>50);
  const moderate=dominoHeight(1.2,.5,.8,{growth:0,sizeVariation:.1});close(moderate,1.2*1.08);
  assert.ok(dominoHeight(1.2,.5,1,{growth:0,sizeVariation:1})/dominoHeight(1.2,.5,-1,{growth:0,sizeVariation:1})>500);
  assert.equal(dominoHeight(7.2,1,1,{growth:2,sizeVariation:1}),64);
  assert.equal(dominoHeight(.12,0,-1,{growth:2,sizeVariation:1}),.03);
});

test('existing factory presets remain complete propagating scenes',()=>{
  for(const preset of PRESETS){const run=buildRun(preset.params),score=compileRun(run);assert.equal(score.reachableCount,run.dominoes.length,preset.id);}
});

test('all layouts make bounded four-piece extremes and full moderate 40/1024 runs',()=>{
  for(const {id} of LAYOUTS)for(const count of [4,40,1024]){
    const run=buildRun({layout:id,count}),score=compileRun(run);assertBounded(run);
    assert.equal(run.links.length,closed.has(id)?count:count-1,id);
    assert.ok(Number.isFinite(score.duration));assert.ok(score.events.length<=count*2);
    if(count>=40)assert.equal(score.reachableCount,count,`${id}/${count}`);
  }
});

test('reversing all layouts reverses links, uses terminal roots, and propagates through converging branches',()=>{
  for(const {id} of LAYOUTS){
    const forward=buildRun({layout:id,count:64}),reverse=buildRun({layout:id,count:64,direction:'reverse'});
    assert.deepEqual(reverse.links,forward.links.map(({from,to})=>({from:to,to:from})));
    assert.equal(compileRun(reverse).reachableCount,64,id);
    if(closed.has(id))assert.deepEqual(reverse.roots,[0]);
    else {const targets=new Set(reverse.links.map(l=>l.to));assert.deepEqual([...reverse.roots].sort((a,b)=>a-b),reverse.dominoes.filter(d=>!targets.has(d.id)).map(d=>d.id));}
    if(['fork','tapestry'].includes(id))assert.ok(reverse.roots.length>1);
  }
});

test('rotation preserves timing and energy; stretch preserves path-facing angles and changes geometry',()=>{
  const base=buildRun({layout:'serpentine',count:40}),rotated=buildRun({layout:'serpentine',count:40,rotation:137});
  const a=compileRun(base),b=compileRun(rotated);assert.equal(a.events.length,b.events.length);
  for(let i=0;i<a.events.length;i++){close(a.events[i].time,b.events[i].time);close(a.events[i].energy,b.events[i].energy);}
  const stretched=buildRun({layout:'henge',count:40,stretch:3,rotation:40});
  for(const link of stretched.links){const from=stretched.dominoes[link.from],to=stretched.dominoes[link.to];close(Math.sin(from.angle-Math.atan2(to.z-from.z,to.x-from.x)),0);}
  assert.notEqual(stretched.bounds.width,base.bounds.width);
});

test('drawing transform can retain authored origin and reverse separate open/closed components',()=>{
  const d=(id,x,z=0)=>({id,x,z,elevation:0,height:1,width:.5,depth:.16,angle:0});
  const run={params:{rotation:90,stretch:2,direction:'reverse'},dominoes:[d(0,10),d(1,11),d(2,20),d(3,21),d(4,20,1)],links:[{from:0,to:1},{from:2,to:3},{from:3,to:4},{from:4,to:2}],roots:[0,2]};
  const transformed=applyRunTransform(run,{recenter:false});
  close(transformed.dominoes[0].x,0);close(transformed.dominoes[0].z,20);
  assert.deepEqual(transformed.roots,[1,2]);
  const empty=applyRunTransform({params:{},dominoes:[],links:[],roots:[]});assert.ok(Object.values(empty.bounds).every(n=>n===0));
});

test('negative stairs reverse elevations and curvature changes generated paths',()=>{
  const up=buildRun({layout:'stairs-up',stairRise:.4}),down=buildRun({layout:'stairs-up',stairRise:-.4});
  for(let i=0;i<up.dominoes.length;i++)close(up.dominoes[i].elevation,-down.dominoes[i].elevation);
  for(const {id} of LAYOUTS){const a=buildRun({layout:id,curvature:.2}),b=buildRun({layout:id,curvature:3});assert.notDeepEqual(a.dominoes.map(d=>[d.x,d.z,d.angle]),b.dominoes.map(d=>[d.x,d.z,d.angle]),id);}
});

test('extreme speed scales actual falls while finite model offsets remain unchanged',()=>{
  const run=buildRun({layout:'serpentine',count:4,sizeVariation:0});
  const slow=createRunSimulation(run,{speed:.05,autoStand:true,standDelay:60}),fast=createRunSimulation(run,{speed:12,autoStand:true,standDelay:.05});
  advance(slow,0);advance(fast,0);
  close(slow.falls[0].duration/fast.falls[0].duration,240);
  close(slow.falls[0].standStart-slow.falls[0].duration,60);close(fast.falls[0].standStart-fast.falls[0].duration,.05);
  assert.deepEqual(compileRun(buildRun({...run.params,speed:.05})),compileRun(buildRun({...run.params,speed:12})));
});

test('1024th tile accepts finite manual pushes and forked predictions retain IDs at extreme speed',()=>{
  const run=buildRun({layout:'serpentine',count:1024,sizeVariation:0});
  const score=compileRun(run,{pushes:[{id:1023,time:.01}]});
  assert.equal(score.falls.find(f=>f.id===1023).start,.01);assert.equal(score.falls.length,1024);
  const sim=createRunSimulation(run,{speed:12,autoStand:false});advance(sim,.1);const fork=sim.fork();
  assert.equal(sim.trigger([1023],.1),1);const pushed=sim.fork();advance(sim,100);advance(pushed,100);advance(fork,100);
  assert.deepEqual(pushed.events,sim.events);assert.deepEqual(pushed.falls,sim.falls);
  assert.notEqual(fork.falls.find(f=>f.id===1023).start,sim.falls.find(f=>f.id===1023).start);
});

test('randomizer explores all state, reaches broad extremes, and mostly yields useful runs without repairs',()=>{
  const keys=Object.keys(DEFAULT_PARAMS),observed=new Map(keys.map(k=>[k,new Set()]));let useful=0;
  for(let seed=0;seed<128;seed++){
    const p=randomizeParams(seed);assert.deepEqual(p,sanitizeParams(p));assert.deepEqual(p,randomizeParams(seed));
    for(const key of keys)observed.get(key).add(p[key]);
    const run=buildRun(p),score=compileRun(run);assertBounded(run);useful+=score.reachableCount>=p.count*.8;
  }
  assert.ok(useful>=128*2/3,`${useful}/128 useful`);
  for(const [key,values] of observed)assert.ok(values.size>1,key);
  assert.equal(observed.get('layout').size,LAYOUTS.length);
  const min=k=>Math.min(...observed.get(k)),max=k=>Math.max(...observed.get(k));
  assert.ok(min('count')<16&&max('count')>512);assert.ok(min('size')<.2&&max('size')>4);
  assert.ok(min('speed')<.1&&max('speed')>8);assert.ok(min('pitch')<-30&&max('pitch')>30);
  assert.ok(max('sizeVariation')>.9&&max('growth')>1.5&&min('growth')<-1.5);
  assert.ok(max('spacing')>1.5&&min('spacing')<.24);
});

test('combined extreme geometry stays finite and causally bounded',()=>{
  const extremes=[{size:.1,sizeVariation:1,growth:-2,spacing:.12,stairRise:-1,curvature:3,stretch:.2},{size:6,sizeVariation:1,growth:2,spacing:2.5,stairRise:1,curvature:.2,stretch:5,direction:'reverse',rotation:180}];
  for(const {id} of LAYOUTS)for(const e of extremes){const run=buildRun({...e,layout:id,count:1024}),score=compileRun(run);assertBounded(run);assert.ok(Number.isFinite(score.duration));assert.ok(score.events.length<=2048);assert.ok(score.events.every(e=>Number.isFinite(e.time)&&Number.isFinite(e.energy)));}
});
