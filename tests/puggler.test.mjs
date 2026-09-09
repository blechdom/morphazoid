import test from 'node:test';
import assert from 'node:assert/strict';
import { PugglerModel, PATTERNS, PROPS, WORLD, PHRASE_CHUNKS, DEFAULTS, MAX_OBJECTS, parseNotation, initialSlots, launchFlight, flightPosition, soundMapping } from '../src/puggler.js';

const advance = (m, seconds, steer = 0) => { const events=[]; for(let i=0;i<seconds*120;i++)events.push(...m.step(1/120, typeof steer==='function'?steer(i/120):steer)); return events; };
test('every pattern has the correct distinct future reservations and catches every stationary material',()=>{
  for(const p of PATTERNS){
    const slots=initialSlots(p);assert.equal(slots.length,p.count,p.id);assert.equal(new Set(slots.map(s=>`${s.due}:${s.hand}`)).size,p.count);
    for(const prop of PROPS){
      const m=new PugglerModel({count:p.count,pattern:p.id,propIds:Array(4).fill(prop.id),assist:20});
      advance(m,15);assert.equal(m.drops,0,`${p.id}/${prop.id}`);assert.ok(m.catches>8,`${p.id}/${prop.id}`);assert.equal(m.objects.length,p.count);
    }
  }
});
test('linear-drag flight lands at its solved destination and mass never changes vacuum acceleration',()=>{
  for(const prop of PROPS){const f=launchFlight({x:20,y:208,targetX:120,duration:1.2,mass:prop.mass,drag:prop.drag,g:2200});const p=flightPosition(f,1.2);assert.ok(Math.abs(p.x-120)<1e-7);assert.ok(Math.abs(p.y-208)<1e-7);}
  const config={x:20,y:208,targetX:120,duration:1.2,drag:0,g:2200};
  assert.deepEqual(flightPosition(launchFlight({...config,mass:.02}),.5),flightPosition(launchFlight({...config,mass:3}),.5));
  assert.notDeepEqual(flightPosition(launchFlight({...config,drag:.05,mass:.02}),.5),flightPosition(launchFlight({...config,drag:.05,mass:3}),.5));
});
test('steering leaves released trajectories in world space and causes observable floor impacts and audience replacements',()=>{
  const m=new PugglerModel({assist:20});advance(m,.5);
  const o=m.objects.find(o=>o.phase==='air'),flight={...o.flight};advance(m,.05,1);assert.deepEqual(o.flight,flight);
  const events=advance(m,12,t=>Math.sin(t*2)>0?1:-1);
  assert.ok(events.some(e=>e.kind==='drop'&&e.y<35));assert.ok(events.some(e=>e.kind==='replacement'&&e.y===32&&e.vy>0));
  assert.equal(m.objects.length,3);assert.ok(m.debris.length<=10);
});
test('speed changes preserve airborne objects without inventing a drop or cancelling a rescue',()=>{
  for(const p of PATTERNS){const m=new PugglerModel({count:p.count,pattern:p.id,tempo:100});advance(m,5);m.apply({tempo:260});advance(m,12);assert.equal(m.drops,0,p.id);assert.ok(m.catches>8,p.id);}
  const m=new PugglerModel();advance(m,.8);
  const o=m.objects[0];o.phase='air';o.x=m.x+25;o.y=30;m.kick();const start=o.start;advance(m,.1);
  assert.equal(o.start,start);assert.equal(o.phase,'air');
});
test('rescue kicks reach the current hat stack and collect bonus balloons',()=>{
  for(const height of [0,3,7]){
    const m=new PugglerModel({mode:'kick'});m.stack=Array(height).fill('#f00');m.nextBalloon=99;
    const o={id:100,phase:'air',x:500,y:90,vx:0,vy:-90,prop:PROPS.find(p=>p.id==='balloon'),color:'#f00'};
    m.balloons=[o];m.kick();const events=advance(m,4);assert.ok(events.some(e=>e.kind==='hat'),String(height));assert.ok(!m.balloons.includes(o));
    assert.equal(m.stack.length,height===7?0:height+1);
  }
});
test('state resets reproduce the same act, parameter limits and long sessions remain finite and bounded',()=>{
  const a=new PugglerModel({mode:'kick'}),b=new PugglerModel({mode:'kick'});advance(a,6);a.reset();advance(a,5);advance(b,5);assert.deepEqual(a,b);
  a.apply({count:400,tempo:Infinity,gravity:-200,wind:900,assist:NaN});assert.equal(a.objects.length,MAX_OBJECTS);assert.ok(a.config.tempo>=100);assert.ok(a.config.gravity>=.45);
  advance(a,120,t=>Math.sin(t*3));assert.ok(a.balloons.length<=5);assert.ok(a.stack.length<8);
  for(const o of a.objects){assert.ok([o.x,o.y,o.vx,o.vy].every(Number.isFinite));assert.ok(o.trail.length<=55);}
});
test('height, x, velocity, and material mass have independent sound destinations',()=>{
  const prop=PROPS[0],body={x:250,y:WORLD.handY,vx:100,vy:100},base=soundMapping(prop,body);
  assert.ok(soundMapping(prop,{...body,y:500}).frequency>base.frequency);
  assert.ok(soundMapping(prop,{...body,x:750}).pan>base.pan);
  assert.ok(soundMapping(prop,{...body,vy:400}).brightness>base.brightness);
  assert.ok(soundMapping({...prop,mass:1.6},body).energy>base.energy);
  assert.equal(soundMapping(prop,{...body,y:700},{height:0}).frequency,prop.hz);
  assert.equal(Math.abs(soundMapping(prop,body,{stereo:0}).pan),0);
});
test('very high supported showers preserve their trajectory instead of hitting an artificial ceiling',()=>{
  const m=new PugglerModel({count:4,pattern:'four-shower',tempo:600,gravity:1.65,loft:3,propIds:Array(4).fill('bowling')});
  let peak=0;
  for(let i=0;i<1200;i++){
    m.step(1/120);
    for(const o of m.objects)if(o.phase==='air'){
      peak=Math.max(peak,o.y);
      assert.ok(Math.abs(o.y-flightPosition(o.flight,m.time-o.start).y)<1e-5);
    }
  }
  assert.ok(peak>6800);assert.equal(m.drops,0);
});

test('cadenced and evolving phrases maintain legal reservations for one to ten props at both tempo limits',()=>{
  for(const count of Array.from({length:10},(_,i)=>i+1))for(const chunk of PHRASE_CHUNKS[count]){
    // A ground-state phrase maps the count occupied future slots back to itself.
    const occupied=new Set(Array.from({length:count},(_,i)=>i));
    for(let beat=0;beat<chunk.length;beat++){
      const value=parseInt(chunk[beat],36);assert.equal(occupied.has(beat),value>0,chunk);
      if(value){occupied.delete(beat);assert.ok(!occupied.has(beat+value),chunk);occupied.add(beat+value);}
    }
    assert.deepEqual([...occupied].sort((a,b)=>a-b),Array.from({length:count},(_,i)=>chunk.length+i),chunk);
  }
  for(const count of Array.from({length:10},(_,i)=>i+1))for(const phrase of ['verse','evolve'])for(const partner of ['solo','manual','trio-auto','trio-manual'])for(const tempo of [100,1200]){
    const m=new PugglerModel({count,phrase,partner,tempo,assist:20,loft:3}),sections=new Set();
    for(let i=0;i<1800;i++){
      m.step(1/120);sections.add(m.currentPhrase);
      assert.equal(new Set(m.objects.map(o=>`${o.due}:${o.hand}`)).size,count);
    }
    assert.equal(m.drops,0,`${count}/${phrase}/${partner}/${tempo}`);assert.ok(m.catches>5);
    assert.ok(sections.size>=3);assert.ok(m.phraseValues.length<=12);
    if(partner!=='solo')assert.ok(m.passes>3);
  }
});
test('a dropped part retains its drum and riff but the audience must physically lob a new prop into its owner’s hand',()=>{
  for(const owner of [0,1]){
    const m=new PugglerModel({count:2,partner:'manual',assist:120}),o=m.objects[owner];
    const previous=o.prop.id,role={drum:o.drum,riff:o.riff};m.miss(o);
    advance(m,.2);assert.equal(o.phase,'waiting');assert.equal(m.catches,0);
    advance(m,.1);assert.equal(o.phase,'replacement');assert.notEqual(o.prop.id,previous);
    assert.deepEqual({drum:o.drum,riff:o.riff},role);assert.equal(o.owner,owner);
    assert.ok(o.flight.y<50);const start=o.y;advance(m,.2);assert.ok(o.y>start);assert.equal(o.phase,'replacement');
    const events=advance(m,3);assert.ok(events.some(e=>e.kind==='catch'&&e.id===o.id&&e.replacement));
    assert.equal(m.drops,1);assert.ok(m.catches>1);
  }
});
test('audience throws missed by either rider drop again instead of teleporting into a hand',()=>{
  for(const owner of [0,1]){
    const m=new PugglerModel({count:2,partner:'manual',assist:20}),o=m.objects[owner];m.miss(o);advance(m,.3);
    m.players[owner].x=owner?865:135;o.x=owner?560:440;o.flight.x=o.x;o.targetX=o.x;
    const events=advance(m,2);
    assert.ok(events.some(e=>e.kind==='drop'&&e.id===o.id));
    assert.ok(!events.some(e=>e.kind==='catch'&&e.id===o.id&&e.replacement));
  }
});
test('manual friend input and automatic/manual switching preserve independent riders and released flights',()=>{
  const m=new PugglerModel({partner:'auto'});advance(m,.4);
  const object=m.objects.find(o=>o.phase==='air'),flight=object.flight,start=object.start;
  m.apply({partner:'manual'});assert.ok(m.objects.includes(object));assert.equal(object.flight,flight);assert.equal(object.start,start);
  const x=m.x,friend=m.players[1].x;for(let i=0;i<90;i++)m.step(1/120,0,null,1);
  assert.equal(m.x,x);assert.ok(m.players[1].x>friend+80);
});
test('fast passes catch at the swept hand crossing and held props immediately follow their hand',()=>{
  const m=new PugglerModel({count:2,pattern:'columns',phrase:'verse',partner:'manual',tempo:600,assist:20});
  for(let i=0;i<600;i++){
    const events=m.step(1/60);
    for(const e of events.filter(e=>e.kind==='catch')){
      assert.ok(e.distance<1,'stationary pass lands at the hand');
      const o=m.objects[e.id];if(o.phase==='held')assert.equal(o.x,m.handPosition(o.hand,o.owner).x);
    }
  }
  assert.equal(m.drops,0);assert.ok(m.passes>30);
});
test('replacement selection cannot mutate caller configuration or shared defaults',()=>{
  const ids=[...DEFAULTS.propIds],before=[...ids],m=new PugglerModel();m.apply({propIds:ids});m.miss(m.objects[0]);advance(m,.3);
  assert.deepEqual(ids,before);assert.deepEqual(DEFAULTS.propIds,before);
});

test('ten-object high showers remain exact above the old sky ceiling at1200BPM',()=>{
  const m=new PugglerModel({count:10,pattern:'shower-10',partner:'trio-manual',tempo:1200,gravity:1.65,loft:3,assist:20});
  m.players.forEach(p=>m.setRiderLoft(p.id,2.2));let peak=0;
  for(let i=0;i<1800;i++){
    m.step(1/120);
    for(const o of m.objects)if(o.phase==='air'){
      peak=Math.max(peak,o.y);assert.ok(Math.abs(o.y-flightPosition(o.flight,m.time-o.start).y)<1e-5);
    }
  }
  assert.ok(peak>100000);assert.equal(m.drops,0);assert.ok(m.passes>50);
  assert.equal(parseNotation('aaccccccccc20bb8').length,16);
});
test('each of three riders throws to a crowd hand and receives a catchable replacement',()=>{
  for(const owner of [0,1,2]){
    const m=new PugglerModel({count:6,partner:'trio-manual',phrase:'verse',tempo:360,assist:80});
    m.throwToAudience(owner);const o=m.objects.find(o=>o.phase==='audience'),role={drum:o.drum,riff:o.riff};
    assert.equal(o.owner,owner);assert.ok(m.events.some(e=>e.kind==='crowd-throw'));
    const events=advance(m,5);assert.ok(events.some(e=>e.kind==='crowd-catch'&&e.id===o.id));
    const incoming=events.find(e=>e.kind==='replacement'&&e.id===o.id);assert.ok(incoming&&incoming.y===32&&incoming.vy>0);
    assert.ok(events.some(e=>e.kind==='catch'&&e.id===o.id&&e.replacement));
    assert.deepEqual({drum:o.drum,riff:o.riff},role);assert.equal(m.crowdCatches,1);assert.equal(m.drops,0);
  }
});
test('a crowd throw requested with empty hands waits for the next throw and then rejoins',()=>{
  const m=new PugglerModel({count:1,pattern:'single',partner:'solo',tempo:180,assist:100});advance(m,.1);
  assert.equal(m.objects[0].phase,'air');m.throwToAudience(0);assert.equal(m.players[0].crowdQueued,true);
  const events=advance(m,6);assert.ok(events.some(e=>e.kind==='crowd-throw'));assert.ok(events.some(e=>e.kind==='crowd-catch'));
  assert.equal(m.players[0].crowdQueued,false);assert.equal(m.drops,0);
});
test('throw wildness causes real missed trajectories; zero keeps a precise act',()=>{
  const config={count:6,partner:'trio-auto',phrase:'verse',tempo:360,assist:42};
  const precise=new PugglerModel({...config,chaos:0}),wild=new PugglerModel({...config,chaos:40});
  advance(precise,25);const events=advance(wild,25);
  assert.equal(precise.drops,0);assert.ok(wild.drops>1);
  assert.ok(events.filter(e=>e.kind==='drop').every(e=>e.y<e.prop.radius));
  assert.ok(events.some(e=>e.kind==='replacement'));assert.ok(wild.catches>20);
});
test('independent gaming speed and height controls override automatic friends',()=>{
  const m=new PugglerModel({count:6,partner:'trio-auto'}),initial=m.players.map(p=>({x:p.x,loft:p.loft}));
  for(let i=0;i<48;i++)m.step(1/120,[{steer:-.34,height:1},{steer:.34,height:-1},{steer:1,height:1}]);
  assert.ok(m.players[0].x<initial[0].x);assert.ok(m.players[1].x>initial[1].x);assert.ok(m.players[2].x>initial[2].x);
  assert.ok(m.players[0].loft>1);assert.ok(m.players[1].loft<1);assert.ok(m.players[2].loft>1);
  assert.ok(m.players[2].x-initial[2].x>m.players[1].x-initial[1].x);
});
