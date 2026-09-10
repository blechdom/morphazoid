import test from 'node:test';
import assert from 'node:assert/strict';
import { PugglerCrowd, CROWD_MEMBERS } from '../src/puggler-crowd.js';
import { futureCrowdMember, futureHeadwear, drawFutureCrowdHead, drawFutureCrowdHand } from '../src/puggler-future-crowd.js';

function context() {
  const calls=[],stack=[],state={fillStyle:'#123456',strokeStyle:'#654321',lineWidth:7,lineCap:'butt',lineJoin:'miter',shadowBlur:5,shadowOffsetX:4,shadowOffsetY:3,shadowColor:'#f00',globalAlpha:.7};
  const initial={...state};
  const methods={save(){stack.push({...state});},restore(){assert.ok(stack.length);Object.assign(state,stack.pop());}};
  const c=new Proxy(state,{get:(target,key)=>methods[key]??target[key]??((...args)=>calls.push([key,...args])),set:(target,key,value)=>{calls.push(['set',key,value]);target[key]=value;return true;}});
  return {c,calls,stack,initial,state};
}

test('future costumes leave independent drum reactions, fixed IDs and baby motion untouched',()=>{
  const crowd=new PugglerCrowd();
  crowd.react([{kind:'catch',drum:'kick',time:0},{kind:'catch',drum:'snare',time:.2}],.2);
  const members=crowd.snapshot(.35).members,before=structuredClone(members),dressed=members.map(futureCrowdMember);
  assert.deepEqual(members,before);
  for(const [i,pose] of dressed.entries())for(const key of Object.keys(pose)) {
    if(!['bodyColor','skinColor'].includes(key))assert.deepEqual(pose[key],members[i][key]);
    else assert.match(pose[key],/^#[a-f0-9]{6}$/);
  }
  assert.ok(new Set(dressed.map(pose=>pose.jump)).size>4);
  const baby=dressed.find(pose=>pose.head==='baby');assert.ok(baby.jump<=3);assert.equal(baby.hand,null);
  crowd.dispose();
});

test('photo routes use only future crowd sprites and preserve the physical placement',()=>{
  const {c,calls}=context(),photos=[],collage={draw(...args){photos.push(args);return true;}};
  for(const member of CROWD_MEMBERS)drawFutureCrowdHead(c,collage,member.head,37,91,62,.25);
  const hands={lighter:'plasma',phone:'holo',palm:'robot',peace:'alien',horns:'alien'};
  for(const id of Object.keys(hands))drawFutureCrowdHand(c,collage,id,37,91,54,-.15,2);
  assert.equal(calls.length,0,'successful photos need no extra vector overlay');
  assert.deepEqual(photos.slice(0,8).map(call=>call.slice(1)),CROWD_MEMBERS.map(member=>['futureCrowd',member.head,37,91,62,62,.25,0]));
  assert.deepEqual(photos.slice(8).map(call=>call.slice(1)),Object.values(hands).map(id=>['futureCrowd',id,37,91,54,54,-.15,0]));
});

test('all failed-atlas and distant-silhouette paths stay finite, bounded and restore canvas state',()=>{
  const headSignatures=new Set(),handSignatures=new Set();
  for(const head of CROWD_MEMBERS.map(member=>member.head))for(const size of [28,62,90]) {
    const {c,calls,stack,initial,state}=context(),routes=[];
    drawFutureCrowdHead(c,{draw(...args){routes.push(args[1]);return false;}},head,100,200,size,.23);
    futureHeadwear(c,head,30,40,.75,'#14121c');
    assert.deepEqual(routes,['futureCrowd']);assert.deepEqual(state,initial);assert.equal(stack.length,0);
    assert.ok(calls.filter(call=>call[0]!=='set').length<160);assert.ok(calls.flat().filter(value=>typeof value==='number').every(Number.isFinite));
    assert.ok(!calls.some(call=>call[0]==='set'&&call[1]==='shadowBlur'&&call[2]!==0));
    if(size===62)headSignatures.add(JSON.stringify(calls));
  }
  for(const hand of ['plasma','holo','robot','alien'])for(const ink of [null,'#14121c']) {
    const {c,calls,stack,initial,state}=context(),routes=[];
    drawFutureCrowdHand(c,{draw(...args){routes.push(args[1]);return false;}},hand,100,200,54,-.28,7,ink);
    assert.deepEqual(routes,ink?[]:['futureCrowd']);assert.deepEqual(state,initial);assert.equal(stack.length,0);
    assert.ok(calls.filter(call=>call[0]!=='set').length<100);assert.ok(calls.flat().filter(value=>typeof value==='number').every(Number.isFinite));
    assert.ok(!calls.some(call=>call[0]==='set'&&call[1]==='shadowBlur'&&call[2]!==0));
    if(!ink)handSignatures.add(JSON.stringify(calls));
  }
  assert.equal(headSignatures.size,8);assert.equal(handSignatures.size,4);
});
