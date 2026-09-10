import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HISTORY_CROWD_ATLAS, historicalCrowdMember } from '../src/puggler-history-crowd.js';
import { FUTURE_CROWD_ATLAS } from '../src/puggler-future-crowd-atlas.js';
import { PugglerCrowd } from '../src/puggler-crowd.js';

for(const atlas of [HISTORY_CROWD_ATLAS,FUTURE_CROWD_ATLAS])test(`${atlas.url.pathname.split('/').at(-1)} retains alpha and has isolated, published in-bounds crops`,()=>{
  const bytes=fs.readFileSync(atlas.url);
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
  assert.equal(bytes.toString('ascii',12,16),'VP8X');
  assert.ok(bytes[20]&0x10);
  const width=bytes.readUIntLE(24,3)+1,height=bytes.readUIntLE(27,3)+1;
  const rectangles=Object.values(atlas.rects);
  for(const [i,[x,y,w,h]] of rectangles.entries()){
    assert.ok([x,y,w,h].every(Number.isInteger));
    assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=width&&y+h<=height);
    for(const [a,b,c,d] of rectangles.slice(i+1))assert.ok(x+w<=a||a+c<=x||y+h<=b||b+d<=y);
  }
});

test('costume presentation preserves each listener’s independent reaction and gentle baby motion',()=>{
  const crowd=new PugglerCrowd();
  crowd.react([{kind:'catch',drum:'kick',time:0},{kind:'catch',drum:'snare',time:.2}],.2);
  const members=crowd.snapshot(.35).members,before=structuredClone(members);
  const dressed=members.map(historicalCrowdMember);
  assert.deepEqual(members,before);
  for(const [i,pose] of dressed.entries()){
    for(const key of Object.keys(members[i]))if(!['bodyColor','skinColor'].includes(key))assert.deepEqual(pose[key],members[i][key]);
  }
  assert.ok(new Set(dressed.map(pose=>pose.jump)).size>4);
  const baby=dressed.find(pose=>pose.head==='baby');
  assert.ok(baby.jump<=3);assert.equal(baby.hand,null);
  crowd.dispose();
});
