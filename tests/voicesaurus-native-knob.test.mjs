import assert from 'node:assert/strict';
import test from 'node:test';
import { enhanceNativeKnob } from '../src/instruments/voicesaurus/native-knob.js';

class Node extends EventTarget {
  constructor(doc) {
    super(); this.ownerDocument=doc;this.children=[];this.attributes=new Map();this.dataset={};this.classes=new Set();
    this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),toggle:(name,yes)=>yes?this.classes.add(name):this.classes.delete(name)};
    this._value='';
  }
  set value(value){let next=String(value);if(this.type==='range'&&Number.isFinite(Number(next)))next=String(Math.max(Number(this.min),Math.min(Number(this.max),Number(next))));this._value=next;}
  get value(){return this._value;}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  after(node){node.parentNode=this.parentNode;this.parentNode.children.splice(this.parentNode.children.indexOf(this)+1,0,node);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  focus(){this.ownerDocument.activeElement=this;}
  select(){}
  setCustomValidity(message){this.validityMessage=message;}
  reportValidity(){return !this.validityMessage;}
  setPointerCapture(id){this.capture=id;}
  hasPointerCapture(id){return this.capture===id;}
  releasePointerCapture(){this.capture=null;}
}

function fixture({min=0,max=100,value=40,step=1,nativeStep}={}) {
  const doc={defaultView:{Event},createElement(){return new Node(doc);}};
  const label=doc.createElement(),field=doc.createElement(),input=doc.createElement(),output=doc.createElement();
  Object.assign(input,{type:'range',min:String(Math.min(min,value)),max:String(Math.max(max,value)),step:'any',value:String(value),disabled:false});
  field.append(input);label.append(field,output);
  const rule={label:'Native pitch',min,max,step,nativeStep};
  const events=[];
  input.addEventListener('input',event=>events.push({type:'input',value:Number(input.value),exact:!!event.nativeExact}));
  input.addEventListener('change',event=>events.push({type:'change',value:Number(input.value),exact:!!event.nativeExact}));
  const knob=enhanceNativeKnob(input,output,rule);
  const pointer=(type,options={})=>input.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{pointerId:1,button:0,isPrimary:true,clientY:100,...options}));
  const key=(name,options={})=>input.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{key:name,...options}));
  const open=()=>{output.dispatchEvent(new Event('click'));return label.children.find(node=>node.className==='native-exact-value');};
  const enter=value=>{const editor=open();editor.value=String(value);editor.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{key:'Enter'}));return editor;};
  return {doc,label,field,input,output,rule,events,knob,pointer,key,open,enter};
}

test('normal drag range remains fixed at both endpoints through repeated motion',()=>{
  const f=fixture();f.pointer('pointerdown');f.pointer('pointermove',{clientY:-10000});
  assert.equal(Number(f.input.value),100);assert.deepEqual([f.input.min,f.input.max],['0','100']);
  f.pointer('pointermove',{clientY:-20000});assert.equal(Number(f.input.value),100);
  f.pointer('pointermove',{clientY:10000});assert.equal(Number(f.input.value),0);
  f.pointer('pointermove',{clientY:20000});assert.equal(Number(f.input.value),0);f.pointer('pointerup');
  assert.equal(f.input.dataset.dragMin,'0');assert.equal(f.input.dataset.dragMax,'100');
});

test('typed finite values beyond both endpoints reach owner callbacks unchanged',()=>{
  const f=fixture();
  for(const value of [12345.678901,-33.25,1e308,-1e308]){
    f.enter(value);assert.equal(Number(f.input.value),value);
    assert.deepEqual(f.events.at(-2),{type:'input',value,exact:true});assert.deepEqual(f.events.at(-1),{type:'change',value,exact:true});
    assert.deepEqual([f.input.dataset.dragMin,f.input.dataset.dragMax],['0','100']);
  }
});

test('pointer clicks and horizontal moves preserve an exact value until vertical drag',()=>{
  const f=fixture();f.enter(10000.125);f.events.length=0;
  f.pointer('pointerdown');f.pointer('pointermove',{clientY:100,clientX:200});f.pointer('pointerup');
  assert.equal(Number(f.input.value),10000.125);assert.deepEqual(f.events,[]);
  f.pointer('pointerdown');f.pointer('pointermove',{clientY:112});f.pointer('pointerup');
  assert.equal(Number(f.input.value),90);assert.deepEqual([f.input.min,f.input.max],['0','100']);
  assert.equal(f.events[0].exact,false);
});

test('initial and remounted exact values do not become the normal drag endpoint',()=>{
  const f=fixture({value:500});assert.equal(Number(f.input.value),500);assert.deepEqual(f.events,[]);
  assert.match(f.field.children[1].children[0].attributes.get('style'),/135deg/);
  f.knob.destroy();const remounted=enhanceNativeKnob(f.input,f.output,f.rule);
  assert.equal(Number(f.input.value),500);assert.equal(f.input.dataset.dragMax,'100');
  f.key('End');assert.equal(Number(f.input.value),100);remounted.destroy();
});

test('normal and fine drag sensitivity is independent of earlier exact excursions',()=>{
  const f=fixture();f.enter(1e6);f.pointer('pointerdown');f.pointer('pointermove',{clientY:112,shiftKey:true});f.pointer('pointerup');
  assert.equal(Number(f.input.value),99);
  f.pointer('pointerdown');f.pointer('pointermove',{clientY:112});f.pointer('pointerup');assert.equal(Number(f.input.value),89);
});

test('Home, End, arrows and page keys stay inside normal endpoints',()=>{
  const f=fixture();f.enter(1000);f.key('End');assert.equal(Number(f.input.value),100);
  f.key('ArrowRight');assert.equal(Number(f.input.value),100);f.key('ArrowDown');assert.equal(Number(f.input.value),99);
  f.key('PageDown');assert.equal(Number(f.input.value),89);
  f.enter(-1000);f.key('Home');assert.equal(Number(f.input.value),0);f.key('ArrowLeft');assert.equal(Number(f.input.value),0);
  f.key('ArrowUp');assert.equal(Number(f.input.value),1);f.key('PageUp');assert.equal(Number(f.input.value),11);
  f.enter(1000);f.key('ArrowDown');assert.equal(Number(f.input.value),99);
  f.enter(-1000);f.key('ArrowRight');assert.equal(Number(f.input.value),1);
});

test('native integer keyboard increments retain exact fractional entry',()=>{
  const f=fixture({min:0,max:510,step:.1,nativeStep:2});f.enter(513.125);assert.equal(Number(f.input.value),513.125);
  f.key('End');assert.equal(Number(f.input.value),510);f.key('ArrowDown');assert.equal(Number(f.input.value),508);
  f.enter(21.375);assert.equal(Number(f.input.value),21.375);assert.equal(f.events.at(-2).exact,true);
});

test('nonfinite or empty exact entry stays editable and does not emit a request',()=>{
  for(const invalid of ['','Infinity','-Infinity','not a number']){
    const f=fixture(),editor=f.enter(invalid);
    assert.equal(f.label.children.includes(editor),true);assert.match(editor.validityMessage,/finite/);
    assert.equal(Number(f.input.value),40);assert.deepEqual(f.events,[]);assert.equal(f.doc.activeElement,editor);
    editor.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape'}));assert.equal(Number(f.input.value),40);
  }
});

test('external value reflection preserves the request but cannot enlarge normal gestures',()=>{
  const f=fixture();f.input.min='-100';f.input.value='-100';f.knob.update();
  assert.equal(Number(f.input.value),-100);assert.equal(f.input.dataset.dragMin,'0');
  assert.match(f.field.children[1].children[0].attributes.get('style'),/-135deg/);
  f.key('Home');assert.equal(Number(f.input.value),0);assert.equal(f.input.min,'0');
});

test('cancelled pointer capture stops movement and teardown removes only owned behavior',()=>{
  const f=fixture();f.pointer('pointerdown');f.pointer('pointermove',{clientY:88});f.pointer('lostpointercapture');const value=f.input.value;
  f.pointer('pointermove',{clientY:-1000});assert.equal(f.input.value,value);
  const editor=f.open();f.knob.destroy();assert.equal(f.output.hidden,false);assert.equal(editor.parentNode,null);assert.equal(f.input.dataset.dragMin,undefined);
  f.key('End');assert.equal(f.input.value,value);f.output.dispatchEvent(new Event('click'));assert.equal(f.label.children.length,2);
});

test('disabled knobs and exact readouts cannot mutate native state',()=>{
  const f=fixture();f.input.disabled=true;f.key('End');f.pointer('pointerdown');f.pointer('pointermove',{clientY:-1000});
  assert.equal(f.open(),undefined);assert.equal(Number(f.input.value),40);assert.deepEqual(f.events,[]);
});

test('fixed range supports signed values and metadata endpoints with fractional steps',()=>{
  const f=fixture({min:-.999,max:.999,value:0,step:.001});f.enter(-2.3);f.key('Home');assert.equal(Number(f.input.value),-.999);
  f.key('ArrowRight');assert.equal(Number(f.input.value),-.998);f.key('End');assert.equal(Number(f.input.value),.999);
  f.pointer('pointerdown');f.pointer('pointermove',{clientY:-10000});assert.equal(Number(f.input.value),.999);f.pointer('pointerup');
});
