import test from 'node:test';
import assert from 'node:assert/strict';
import { PugglerModel, CASTS, RIDE_PATTERNS, WORLD } from '../src/puggler.js';
import { PAGE_DEFAULTS, PRESETS } from '../src/puggler-presets.js';

function advance(model,seconds,controls=[],juggling=false,observe=()=>{}) {
  const events=[];
  for(let i=0;i<seconds*120;i++){
    events.push(...model.step(1/120,controls,null,0,null,juggling));
    observe(model);
  }
  return events;
}

test('every cast balances through real wheel travel, body response and moving held hands even while paused',()=>{
  for(const cast of CASTS){
    const model=new PugglerModel({cast:cast.id,count:3});
    const traces=model.players.map(player=>({x:player.x,wheel:player.wheel,min:player.x,max:player.x,left:false,right:false,lean:0}));
    const inactive=model.players.filter(p=>!cast.riders.includes(p.id)).map(p=>({...p}));
    advance(model,7,[],false,m=>{
      for(const player of m.activePlayers){
        const trace=traces[player.id];trace.min=Math.min(trace.min,player.x);trace.max=Math.max(trace.max,player.x);
        trace.left ||= player.vx < -8;trace.right ||= player.vx > 8;trace.lean=Math.max(trace.lean,Math.abs(player.lean));
        assert.ok(Math.abs((player.wheel-trace.wheel)*49-(player.x-trace.x))<1e-8,'wheel angle follows travelled distance');
        for(const object of m.objects.filter(o=>o.owner===player.id&&o.phase==='held'))assert.equal(object.x,m.handPosition(object.hand,player.id).x);
      }
    });
    for(const id of cast.riders){const trace=traces[id];assert.ok(trace.max-trace.min>25,`${cast.id}/${id} visibly rocks`);assert.ok(trace.left&&trace.right);assert.ok(trace.lean>.018);assert.equal(model.players[id].rideMotion,'balance');}
    assert.equal(model.beat,0);assert.equal(model.catches,0);
    assert.deepEqual(model.players.filter(p=>!cast.riders.includes(p.id)),inactive,'inactive identities do not ride');
  }
});

test('automatic paths include the first rider and anticipate catch positions in sparse casts',()=>{
  for(const cast of ['puggler','roxy','moss','puggler-moss','roxy-moss','trio']){
    const model=new PugglerModel({cast,count:6,autoRide:true,ridePattern:'rock',rideRange:44,assist:65});
    const x=model.players.map(p=>p.x),range=model.players.map(p=>[p.x,p.x]);
    advance(model,12,[],true,m=>{
      for(const player of m.activePlayers){range[player.id][0]=Math.min(range[player.id][0],player.x);range[player.id][1]=Math.max(range[player.id][1],player.x);}
      assert.equal(new Set(m.objects.map(o=>`${o.due}:${o.hand}`)).size,6);
    });
    for(const id of model.activeIds){assert.ok(range[id][1]-range[id][0]>80,`${cast}/${id}`);assert.notEqual(model.players[id].x,x[id]);}
    assert.equal(model.drops,0,cast);assert.ok(model.catches>25);
  }
});

test('keyboard and held pointer targets override patterns and release into a local balance without a snap',()=>{
  const model=new PugglerModel({cast:'roxy-moss',autoRide:true,ridePattern:'surge',rideRange:75,rideSpeed:2});
  const initial=model.players[2].x;
  advance(model,.35,[{},{},{steer:-1}]);
  const player=model.players[2],heldX=player.x;
  assert.ok(heldX<initial-80);assert.equal(player.rideMotion,'manual');
  advance(model,.6,[{},{},{target:heldX}]);
  assert.ok(Math.abs(player.x-heldX)<8,'pointer holds its target against the riding score');
  assert.equal(player.rideMotion,'manual');
  const release=player.x;
  let previous=release;
  advance(model,3,[],false,()=>{assert.ok(Math.abs(player.x-previous)<=480/120+1e-8);previous=player.x;});
  assert.equal(player.rideMotion,'pattern');
  assert.ok(player.rideAnchor<initial-40,'manual travel relocates the pattern anchor');
  assert.ok(Math.abs(player.x-release)<170,'release resumes a local bounded path');
});

test('changing only riding fields preserves airborne objects, velocity and phase',()=>{
  const model=new PugglerModel({count:3,autoRide:true});advance(model,.25,[],true);
  const airborne=model.objects.filter(o=>o.phase==='air').map(o=>({object:o,flight:o.flight,start:o.start}));
  const before=model.players.map(p=>({x:p.x,vx:p.vx,phase:p.ridePhase})),beat=model.beat;
  model.apply({ridePattern:'lurch',rideSpeed:1.7,rideRange:80});
  assert.equal(model.beat,beat);
  assert.deepEqual(model.players.map(p=>({x:p.x,vx:p.vx,phase:p.ridePhase})),before);
  for(const {object,flight,start} of airborne){assert.ok(model.objects.includes(object));assert.equal(object.flight,flight);assert.equal(object.start,start);}
});

test('releasing the default rider at either edge resumes full back-and-forth balancing across phases',()=>{
  for(const direction of [-1,1])for(const delay of [0,.37,1.13]){
    const model=new PugglerModel();advance(model,delay);
    // The original right-edge failure used exactly 132 driven steps, then 90
    // released steps, and stayed within .001 pixels for the following 20 s.
    advance(model,1.1,[{steer:direction}]);advance(model,.75);
    const player=model.players[0],[low,high]=model.playerBounds(0);
    assert.ok(player.rideAnchor>=low+15&&player.rideAnchor<=high-15);
    let min=player.x,max=player.x,left=false,right=false,previous=player.x;
    advance(model,20,[],false,()=>{
      min=Math.min(min,player.x);max=Math.max(max,player.x);
      left ||= player.vx < -8;right ||= player.vx > 8;
      assert.ok(Math.abs(player.x-previous)<=480/120+1e-8,'no position snap');previous=player.x;
    });
    assert.ok(max-min>25,`edge ${direction}, phase ${delay} retains full rocking`);
    assert.ok(left&&right);assert.equal(player.rideMotion,'balance');
  }
});

test('preset paths resume from both bounds for sparse rider identities and different release phases',()=>{
  for(const pattern of RIDE_PATTERNS)for(const direction of [-1,1])for(const delay of [0,.61]){
    const model=new PugglerModel({cast:'roxy-moss',autoRide:true,ridePattern:pattern,rideRange:75,rideSpeed:1});
    const owner=direction===1?2:1,controls=[{},{},{}];controls[owner]={steer:direction};
    advance(model,delay);advance(model,1.1,controls);
    const player=model.players[owner],[low,high]=model.playerBounds(owner),edge=player.x;
    assert.equal(edge,direction===1?high:low);
    model.step(0,[],null,0,null,false);assert.equal(player.x,edge,'release does not teleport');
    let min=edge,max=edge,left=false,right=false,previous=edge;
    advance(model,12,[],false,()=>{
      min=Math.min(min,player.x);max=Math.max(max,player.x);
      left ||= player.vx < -8;right ||= player.vx > 8;
      assert.ok(player.rideAnchor>=low+83&&player.rideAnchor<=high-83);
      assert.ok(Math.abs(player.x-previous)<=480/120+1e-8);previous=player.x;
    });
    assert.ok(max-min>70,`${pattern}/${owner}/${delay} keeps riding`);assert.ok(left&&right);
  }
});

test('riding controls remain bounded across patterns, extreme parameters, sparse cast swaps and manual edges',()=>{
  const model=new PugglerModel({autoRide:true,count:10,tempo:1200});
  for(const pattern of RIDE_PATTERNS)for(const cast of ['puggler','roxy-moss','puggler-moss','trio']){
    model.apply({cast,ridePattern:pattern,rideSpeed:99,rideRange:999});
    advance(model,2,[],true,m=>{
      for(const player of m.activePlayers){const [low,high]=m.playerBounds(player.id);assert.ok(player.x>=low&&player.x<=high);assert.ok([player.x,player.vx,player.wheel,player.lean,player.ridePhase,player.rideAnchor].every(Number.isFinite));assert.ok(Math.abs(player.vx)<=480);}
    });
  }
  model.apply({ridePattern:'unknown',rideSpeed:NaN,rideRange:-8});
  assert.equal(model.config.ridePattern,'rock');assert.equal(model.config.rideSpeed,0);assert.equal(model.config.rideRange,0);
  const player=model.players[2],wheel=player.wheel,x=player.x;
  advance(model,3,[{},{},{steer:1}]);
  assert.equal(player.x,model.playerBounds(2)[1]);assert.ok(Math.abs((player.wheel-wheel)*49-(player.x-x))<1e-8);
});

test('presets carry distinct reproducible riding scores and flyer seeds without mutating defaults',()=>{
  assert.equal(PAGE_DEFAULTS.posterSeed,PRESETS[0].config.posterSeed);
  assert.equal(new Set(PRESETS.map(p=>p.config.posterSeed)).size,PRESETS.length);
  assert.equal(new Set(PRESETS.map(p=>`${p.config.ridePattern}/${p.config.rideSpeed}/${p.config.rideRange}`)).size,PRESETS.length);
  const before=JSON.stringify(PRESETS),signatures=[];
  for(const preset of PRESETS){
    const a=new PugglerModel(preset.config),b=new PugglerModel(preset.config),trace=[];
    advance(a,7,[],false,m=>{if(Math.round(m.time*120)%60===0)trace.push(Math.round(m.activePlayers[0].x));});
    advance(b,7);
    assert.deepEqual(a,b,preset.id);assert.ok(Math.max(...trace)-Math.min(...trace)>15,preset.id);signatures.push(trace.join(','));
    assert.equal(a.posterSeed,preset.config.posterSeed);assert.ok(a.posterSeed>=0&&a.posterSeed<=0xffffffff);
  }
  assert.equal(new Set(signatures).size,PRESETS.length);assert.equal(JSON.stringify(PRESETS),before);
});

test('paused riding keeps audience exchanges active and trail poses share the physics timestamp',()=>{
  const model=new PugglerModel({cast:'moss',autoRide:true,assist:120,count:1,pattern:'single'});
  model.throwToAudience(2);
  const events=advance(model,5,[],false,m=>{
    for(const object of m.objects)if(['audience','air','replacement'].includes(object.phase)&&object.trail.length){
      const [x,y,spin,time]=object.trail.at(-1);assert.deepEqual([x,y,spin,time],[object.x,object.y,object.spin,m.time]);
    }
  });
  assert.ok(events.some(e=>e.kind==='crowd-catch'));assert.ok(events.some(e=>e.kind==='catch'&&e.replacement));
  assert.ok(events.some(e=>e.kind.startsWith('crowd-')));assert.equal(model.beat,0);assert.ok(!events.some(e=>e.kind==='throw'));
  assert.equal(model.objects[0].y,WORLD.handY);
});
