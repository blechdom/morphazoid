import test from 'node:test';
import assert from 'node:assert/strict';
import { PugglerModel } from '../src/puggler.js';
import { drawSkinPerformer, drawSkinStage, skinPerformerPose } from '../src/puggler-skin-renderer.js';

function context(){
  const calls=[],ellipses=[],stack=[];let m=[1,0,0,1,0,0];
  const transform=(x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
  const methods={
    save(){stack.push([...m]);},restore(){assert.ok(stack.length);m=stack.pop();},
    translate(x,y){[m[4],m[5]]=transform(x,y);},
    rotate(a){const [a0,b,c,d]=m,co=Math.cos(a),si=Math.sin(a);m[0]=a0*co+c*si;m[1]=b*co+d*si;m[2]=-a0*si+c*co;m[3]=-b*si+d*co;},
    scale(x,y){m[0]*=x;m[1]*=x;m[2]*=y;m[3]*=y;},
    ellipse(x,y,rx,ry){ellipses.push({p:transform(x,y),rx,ry});calls.push(['ellipse',x,y,rx,ry]);},
    createLinearGradient(...args){calls.push(['gradient',...args]);return {addColorStop(){}};},
  };
  const c=new Proxy({}, {get:(target,key)=>methods[key]??target[key]??((...args)=>calls.push([key,...args])),set:(target,key,value)=>(target[key]=value,true)});
  return {c,calls,ellipses,stack};
}
function activeModel(){const model=new PugglerModel({count:4,pattern:'fountain',cast:'trio'});model.time=3.2;for(const p of model.players){p.vx=(p.id-1)*420;p.lean=.22-p.id*.2;p.recoil=.3;p.wheel=.7+p.id;p.lastCatch=3.12;p.lastDrop=3.02;p.flash=[3.3,3.3];}return model;}

test('all six alternate performers keep actual palm centers on the simulation hands through lean and recoil',()=>{
  const model=activeModel(),before=JSON.stringify(model);
  for(const skin of ['history','future'])for(const ratio of [.74,1,1.8])for(const owner of [0,1,2]){
    const {c,ellipses,stack}=context();
    assert.equal(drawSkinPerformer(c,model,owner,ratio,skin),true);
    const palms=ellipses.filter(p=>p.rx===14&&p.ry===9);
    assert.equal(palms.length,2);
    for(let hand=0;hand<2;hand++){
      const actual=model.handPosition(hand,owner);
      assert.ok(Math.abs(palms[hand].p[0]-actual.x*ratio)<1e-9);
      assert.ok(Math.abs(palms[hand].p[1]-actual.y)<1e-9);
    }
    assert.equal(stack.length,0);
  }
  assert.equal(JSON.stringify(model),before);
});

test('fixed rider IDs select distinct costumes and changing physical movement changes the pose',()=>{
  const model=activeModel(),signatures=[];
  for(const skin of ['history','future'])for(const owner of [0,1,2]){
    const {c,calls}=context();drawSkinPerformer(c,model,owner,1,skin);signatures.push(JSON.stringify(calls));
  }
  assert.equal(new Set(signatures).size,6);
  const before=skinPerformerPose(model,2,1);
  model.players[2].wheel+=.8;model.players[2].vx=-330;model.players[2].lean=-.2;
  const after=skinPerformerPose(model,2,1);
  assert.notEqual(before.wheel,after.wheel);assert.notEqual(before.bob,after.bob);assert.notEqual(before.lean,after.lean);
  assert.notDeepEqual(before.arms[0].shoulder,after.arms[0].shoulder);
});

test('unsupported skins leave the original renderer in charge without touching the canvas',()=>{
  const {c,calls}=context();
  assert.equal(drawSkinPerformer(c,{},0,1,'punk'),false);
  assert.equal(drawSkinStage(c,1000,600,{}, {},null,'punk'),false);
  assert.equal(drawSkinPerformer(c,{},0,1,'missing'),false);
  assert.equal(calls.length,0);
});

test('both stages stay finite and bounded on desktop/mobile and use matching skin collage backlines',()=>{
  const model=activeModel(),signatures=[];
  for(const skin of ['history','future'])for(const [w,h] of [[1030,612],[370,480],[510,400]]){
    const {c,calls,stack}=context(),photos=[];
    const collage={draw(_c,...args){photos.push(args);return false;}};
    assert.equal(drawSkinStage(c,w,h,model,{oy:h-56,scaleY:.55},collage,skin),true);
    assert.ok(photos.length>=2&&photos.every(args=>args[0]===skin));
    assert.ok(calls.length<1900);
    assert.ok(calls.every(call=>call.slice(1).filter(value=>typeof value==='number').every(Number.isFinite)));
    assert.equal(stack.length,0);
    if(w===1030)signatures.push(JSON.stringify(calls));
  }
  assert.notEqual(signatures[0],signatures[1]);
});
