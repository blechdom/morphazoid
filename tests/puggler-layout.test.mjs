import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/instruments/puggler/puggler-layout.js',import.meta.url),'utf8');

test('layout tracks wrapped header/stage sizes and cleans up without touching audio',()=>{
  let headerHeight=115,stageHeight=253,resize,disconnected=false;
  const styles=new Map(),listeners=new Map(),observed=[];
  const header={getBoundingClientRect:()=>({height:headerHeight})};
  const stage={getBoundingClientRect:()=>({height:stageHeight})};
  const style={setProperty:(key,value)=>styles.set(key,value)};
  vm.runInNewContext(source,{
    document:{querySelector:selector=>selector.includes('masthead')?header:stage,body:{style},documentElement:{style}},
    window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}},
    ResizeObserver:class{constructor(fn){resize=fn;}observe(node){observed.push(node);}disconnect(){disconnected=true;}},
  });
  assert.deepEqual(observed,[header,stage]);
  assert.equal(styles.get('--puggler-header-height'),'115px');
  assert.equal(styles.get('--puggler-sticky-offset'),'376px');
  headerHeight=50;stageHeight=244;resize();
  assert.equal(styles.get('--puggler-header-height'),'50px');
  assert.equal(styles.get('--puggler-sticky-offset'),'302px');
  listeners.get('pagehide')();assert.equal(disconnected,true);assert.equal(listeners.has('resize'),false);
  assert.doesNotMatch(source,/AudioContext|\.resume\(|\.suspend\(|setInterval/);
});

test('the performance column wraps the graphic and its controls independently of the sidebar',async()=>{
  const html=await readFile(new URL('../puggler.html',import.meta.url),'utf8');
  assert.match(html,/class="puggler-performance"/);
  assert.match(html,/<main class="puggler-shell" aria-labelledby="pageTitle">/);
  assert.match(html,/puggler-layout\.js/);
});
