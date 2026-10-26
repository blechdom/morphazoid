import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShapesScene } from '../src/instruments/shapes/shapes-scene.js';
import { createWitchShapeSceneState, createWitchShapeState, getWitchShapeForm, getWitchShapeGeometry,
  getWitchShapeFrame, retargetWitchShapeCharm, WITCH_SHAPE_FORMS, WITCH_SHAPE_MORPH_SECONDS,
  WITCH_SHAPE_MAX_EDGES, WITCH_SHAPE_MAX_FACES } from '../src/instruments/witch/witch-shape-model.js';
import { drawWitchShapeCharm } from '../src/instruments/witch/witch-shape.js';

test('every charm is an actual native Shapes mesh and perspective projection',()=>{
  assert.equal(WITCH_SHAPE_FORMS.length,8);
  for(const form of WITCH_SHAPE_FORMS) {
    assert.equal(getWitchShapeForm(form.id),form);
    const plain=createWitchShapeSceneState(form.index),scene=buildShapesScene(plain),mesh=getWitchShapeGeometry(form.index);
    assert.equal(createWitchShapeState(form.index).selection.dimension,form.dimension);
    assert.equal(mesh.vertices.length,scene.vertices.length);assert.equal(mesh.edges.length,scene.edges.length);
    assert.equal(mesh.edges.length<=WITCH_SHAPE_MAX_EDGES,true);assert.equal(mesh.faces.length<=WITCH_SHAPE_MAX_FACES,true);
    assert.ok(mesh.faces.length>0,'native triangular/square cycles retain translucent surfaces');
    const radius=Math.max(...scene.vertices.map(point=>Math.hypot(point.x,point.y)));
    scene.vertices.forEach((point,index)=>{
      assert.equal(mesh.vertices[index].x,point.x/radius);assert.equal(mesh.vertices[index].y,-point.y/radius);
    });
    scene.geometry.edges.forEach(({a,b},index)=>{
      assert.equal(mesh.edges[index].a,mesh.vertices[a]);assert.equal(mesh.edges[index].b,mesh.vertices[b]);
    });
    assert.equal(getWitchShapeGeometry(form.id),mesh,'only the fixed catalogue is cached');
  }
  const tesseract=getWitchShapeGeometry('tesseract');
  assert.equal(tesseract.vertices.length,16);assert.equal(tesseract.edges.length,32);
  assert.equal(tesseract.edges.filter(edge=>edge.hyper===1).length,8,'the actual fourth-axis connectors expose its inner cage');
  assert.ok(new Set(tesseract.edges.map(edge=>edge.depth.toFixed(3))).size>5,'native projected depth survives the floor fitting');
});

test('the worklet scene-state path needs no structuredClone or browser runtime',()=>{
  const previous=globalThis.structuredClone;
  globalThis.structuredClone=undefined;
  try {
    for(const form of WITCH_SHAPE_FORMS)assert.ok(buildShapesScene(createWitchShapeSceneState(form.id)).contacts.length>0);
  } finally {globalThis.structuredClone=previous;}
});

test('clocked shape morphs settle, freeze, and retarget from the current geometry without history growth',()=>{
  const initial={from:0,to:0,startedAt:-Infinity};
  assert.equal(getWitchShapeFrame({shapeCharm:initial,performanceTime:0}).morphing,false);
  let charm=retargetWitchShapeCharm(initial,1,10);
  const before=getWitchShapeFrame({shapeCharm:charm,performanceTime:10.37});
  assert.ok(before.progress>0&&before.progress<1);
  assert.deepEqual(getWitchShapeFrame({shapeCharm:charm,performanceTime:10.37,time:1e8,audioOn:true,scene:'flight'}),before);
  const next=retargetWitchShapeCharm(charm,2,10.37);
  const after=getWitchShapeFrame({shapeCharm:next,performanceTime:10.37});
  assert.deepEqual(after.geometry.edges,before.geometry.edges);assert.deepEqual(after.geometry.faces,before.geometry.faces);
  assert.deepEqual(after.weights,before.weights);
  const settled=getWitchShapeFrame({shapeCharm:next,performanceTime:10.37+WITCH_SHAPE_MORPH_SECONDS+.001});
  assert.equal(settled.geometry,getWitchShapeGeometry(2));assert.equal(settled.progress,1);
  charm=next;
  for(let index=0;index<200;index++) {
    charm=retargetWitchShapeCharm(charm,index%8,11+index*.025);
    assert.ok(charm.from.edges.length<=WITCH_SHAPE_MAX_EDGES);assert.ok(charm.from.faces.length<=WITCH_SHAPE_MAX_FACES);
    assert.equal(charm.from.weights.length,8);assert.equal(Object.hasOwn(charm.from,'from'),false);
    assert.ok(Math.abs(charm.from.weights.reduce((sum,weight)=>sum+weight,0)-1)<1e-12);
    for(const edge of charm.from.edges)for(const point of [edge.a,edge.b]) {
      assert.ok(Object.values(point).every(Number.isFinite));assert.ok(Math.hypot(point.x,point.y)<=1+1e-12);
    }
  }
});

test('reduced motion crossfades stationary native forms, including repeated rapid clicks',()=>{
  let charm=retargetWitchShapeCharm({from:0,to:0,startedAt:-Infinity},1,0);
  for(let index=1;index<20;index++)charm=retargetWitchShapeCharm(charm,index%8,index*.04);
  for(const performanceTime of [.8,.9,1.1,2]) {
    const frame=getWitchShapeFrame({shapeCharm:charm,performanceTime,reducedMotion:true});
    assert.ok(frame.layers.length<=8);
    for(const {geometry,alpha} of frame.layers) {
      assert.equal(geometry,getWitchShapeGeometry(geometry.form));assert.ok(alpha>0&&alpha<=1);
    }
    assert.ok(Math.abs(frame.layers.reduce((sum,layer)=>sum+layer.alpha,0)-1)<.001);
  }
});

function drawingProbe() {
  const calls=[],texts=[];
  const context=new Proxy({globalAlpha:1},{get(target,key){
    if(key in target)return target[key];
    return (...values)=>{calls.push(values);if(key==='fillText')texts.push(values);};
  }});
  return {context,calls,texts};
}

test('floor charm draws finite, bounded, text-free geometry in brew and flight',()=>{
  for(const form of WITCH_SHAPE_FORMS)for(const scene of ['brew','flight'])for(const reducedMotion of [false,true]) {
    const probe=drawingProbe(),state={scene,flightLift:scene==='flight'?1:0,reducedMotion,
      performanceTime:1,shapeCharm:{from:form.index,to:form.index,startedAt:0}};
    const frame=drawWitchShapeCharm(probe.context,state);
    assert.equal(frame.form,form.index);assert.equal(probe.texts.length,0);
    assert.ok(probe.calls.length>30&&probe.calls.length<3000,`${form.id} bounded drawing`);
    assert.ok(probe.calls.flat().filter(value=>typeof value==='number').every(Number.isFinite));
    assert.ok(probe.calls.some(values=>values[0]===344&&values[1]===657),'the familiar floor control position is retained');
  }
});
