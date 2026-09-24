import test from 'node:test';
import assert from 'node:assert/strict';
import { ERA_POSTER_BILLS, eraPosterLayout, drawEraPosters } from '../src/instruments/puggler/puggler-era-posters.js';
test('original historical/future bills are distinct, reproducible, bounded and do not replace punk posters',()=>{
  for(const skin of ['history','future']){
    assert.equal(ERA_POSTER_BILLS[skin].length,20);assert.equal(new Set(ERA_POSTER_BILLS[skin].map(lines=>lines.join(' '))).size,20);
    for(const [w,h] of [[1100,619],[390,219],[320,210]]){
      const bills=eraPosterLayout(1234,w,h,skin);assert.ok(bills.length>=3&&bills.length<=4);
      assert.deepEqual(bills,eraPosterLayout(1234,w,h,skin));assert.notDeepEqual(bills,eraPosterLayout(1235,w,h,skin));
      for(const bill of bills){assert.equal(bill.text.length,2);assert.ok(bill.x-bill.width/2>0&&bill.x+bill.width/2<w);assert.ok(bill.y-bill.height/2>0&&bill.y+bill.height/2<h);}
    }
  }
  assert.deepEqual(eraPosterLayout(1,390,219,'punk'),[]);
});
test('poster drawing emits the actual selected text and balances canvas saves',()=>{
  let depth=0;const lines=[];const c=new Proxy({}, {get:(t,k)=>k==='save'?()=>depth++:k==='restore'?()=>depth--:k==='fillText'?line=>lines.push(line):()=>{},set:()=>true});
  assert.equal(drawEraPosters(c,390,219,2,'history'),3);assert.equal(depth,0);assert.ok(lines.includes('OUD &'));
});
