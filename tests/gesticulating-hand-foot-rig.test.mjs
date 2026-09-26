import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { createFootRig } from '../src/instruments/gesticulating-hand/foot-rig.js';

const report=JSON.parse(await readFile(new URL('../assets/gesticulating-foot/rig-report.json',import.meta.url)));
const asset=await readFile(new URL('../assets/gesticulating-foot/foot.glb',import.meta.url));
const neutral=()=>({fingers:Array.from({length:5},()=>({mcp:0,pip:0,dip:0,spread:0})),wrist:{flex:0,side:0,twist:0}});
async function load(){
  // Exercise the shipped skeleton, inverse bind matrices, shared attributes and
  // topology under Node. Only image decoding is replaced with real empty maps.
  const loader=new GLTFLoader();loader.register(()=>({name:'node_test_textures',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
  return loader.parseAsync(asset.buffer.slice(asset.byteOffset,asset.byteOffset+asset.byteLength),'');
}
function snapshot(mesh){
  const result=new Float64Array(mesh.geometry.attributes.position.count*3),point=new THREE.Vector3();
  for(let i=0;i<result.length/3;i++)mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).toArray(result,i*3);
  return result;
}
function difference(a,b){let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));return max;}
function pointPositions(points){return points.flatMap(point=>point.getWorldPosition(new THREE.Vector3()).toArray());}
async function fixture(){const gltf=await load();return {gltf,rig:createFootRig(gltf,report)};}
function preserveTransform(reference,rig){
  const group=new THREE.Group(),orientation=new THREE.Group();
  orientation.quaternion.copy(rig.group.children[0].quaternion);orientation.add(reference.scene);group.add(orientation);
  group.position.copy(rig.group.position);group.scale.copy(rig.group.scale);group.updateMatrixWorld(true);return group;
}
function skinNormal(mesh,index){
  const {skinIndex,skinWeight,normal}=mesh.geometry.attributes,matrix=new THREE.Matrix4(),skin=new THREE.Matrix4();skin.elements.fill(0);
  for(let slot=0;slot<4;slot++){
    const boneIndex=skinIndex.getComponent(index,slot),weight=skinWeight.getComponent(index,slot);
    matrix.multiplyMatrices(mesh.skeleton.bones[boneIndex].matrixWorld,mesh.skeleton.boneInverses[boneIndex]);
    for(let component=0;component<16;component++)skin.elements[component]+=matrix.elements[component]*weight;
  }
  skin.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
  return new THREE.Vector3().fromBufferAttribute(normal,index).applyMatrix3(new THREE.Matrix3().setFromMatrix4(skin))
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
}

test('the actual foot surface, normals and toe origins retain their neutral bind pose',async()=>{
  const reference=await load(),{rig}=await fixture();preserveTransform(reference,rig);
  const originals=[];reference.scene.traverse(object=>{if(object.isSkinnedMesh)originals.push(object);});
  rig.setPose(neutral());
  for(let primitive=0;primitive<originals.length;primitive++){
    assert.ok(difference(snapshot(originals[primitive]),snapshot(rig.meshes[primitive]))<8e-7);
    for(let vertex=0;vertex<originals[primitive].geometry.attributes.position.count;vertex+=97)
      assert.ok(skinNormal(originals[primitive],vertex).distanceTo(skinNormal(rig.meshes[primitive],vertex))<1e-6);
  }
  const originalBones=new Map();reference.scene.traverse(object=>{if(object.isBone)originalBones.set(object.name,object);});
  for(const digit of rig.digits)for(const entry of digit)
    assert.ok(entry.bone.getWorldPosition(new THREE.Vector3()).distanceTo(originalBones.get(entry.bone.name).getWorldPosition(new THREE.Vector3()))<1e-9);
  const original=snapshot(rig.meshes[0]);rig.setPose({...neutral(),foot:{arch:0,twist:0,stretch:0}});
  assert.equal(difference(original,snapshot(rig.meshes[0])),0);
});

test('arch augmentation preserves every original toe/leg weight and surface attribute',async()=>{
  const gltf=await load(),meshes=[];gltf.scene.traverse(object=>{if(object.isSkinnedMesh)meshes.push(object);});
  const saved=meshes.map(mesh=>({attributes:{...mesh.geometry.attributes},index:mesh.geometry.index,material:mesh.material,
    map:mesh.material.map,skeleton:mesh.skeleton,weights:Array.from(mesh.geometry.attributes.skinWeight.array),indices:Array.from(mesh.geometry.attributes.skinIndex.array)}));
  const rig=createFootRig(gltf,report);
  assert.equal(new Set(rig.meshes.map(mesh=>mesh.skeleton)).size,1);
  assert.equal(rig.meshes[0].geometry.attributes.skinWeight,rig.meshes[1].geometry.attributes.skinWeight);
  for(let primitive=0;primitive<meshes.length;primitive++){
    const mesh=meshes[primitive],before=saved[primitive],{skinIndex,skinWeight}=mesh.geometry.attributes;
    assert.equal(mesh.skeleton,before.skeleton);assert.equal(mesh.skeleton.bones.length,20);assert.equal(mesh.skeleton.boneMatrices.length,320);
    assert.equal(mesh.material,before.material);assert.equal(mesh.material.map,before.map);assert.equal(mesh.geometry.index,before.index);
    for(const [name,attribute] of Object.entries(before.attributes))if(!['skinIndex','skinWeight'].includes(name))assert.equal(mesh.geometry.attributes[name],attribute);
    assert.deepEqual(Array.from(before.attributes.skinWeight.array),before.weights);assert.deepEqual(Array.from(before.attributes.skinIndex.array),before.indices);
    for(let vertex=0;vertex<skinWeight.count;vertex++){
      let oldFoot=0,newFoot=0,oldSum=0,newSum=0;
      for(let slot=0;slot<4;slot++){
        const originalIndex=before.indices[vertex*4+slot],originalWeight=before.weights[vertex*4+slot];oldSum+=originalWeight;
        if(originalIndex===2)oldFoot+=originalWeight;
        else if(originalWeight>0){
          let retained=0;for(let j=0;j<4;j++)if(skinIndex.getComponent(vertex,j)===originalIndex)retained+=skinWeight.getComponent(vertex,j);
          assert.equal(retained,originalWeight,`retained bone ${originalIndex} at vertex ${vertex}`);
        }
        const index=skinIndex.getComponent(vertex,slot),weight=skinWeight.getComponent(vertex,slot);newSum+=weight;
        if(index===2||index>=17)newFoot+=weight;
      }
      assert.ok(Math.abs(newFoot-oldFoot)<8e-8);assert.ok(Math.abs(newSum-oldSum)<8e-8);
    }
  }
});

test('arch and torsion deform the weighted midfoot, toe tips and the attached handle',async()=>{
  const {rig}=await fixture(),mesh=rig.meshes[0],base=snapshot(mesh),tips=pointPositions(rig.tips),handle=pointPositions(rig.extras.map(entry=>entry.bone));
  assert.deepEqual(rig.extras.map(entry=>entry.key),['arch']);
  for(const foot of [{arch:60},{twist:50},{stretch:.8}]){
    rig.setPose({...neutral(),foot});const moved=snapshot(mesh);
    assert.ok(difference(pointPositions(rig.tips),tips)>.08,JSON.stringify(foot));
    let maximum=0;
    for(let vertex=0;vertex<mesh.geometry.attributes.position.count;vertex++){
      const z=mesh.geometry.attributes.position.getZ(vertex);
      if(z>.25&&z<.65)for(let axis=0;axis<3;axis++)maximum=Math.max(maximum,Math.abs(moved[vertex*3+axis]-base[vertex*3+axis]));
    }
    assert.ok(maximum>.025,`midfoot changed for ${JSON.stringify(foot)}`);
    // A twist about the length axis leaves a centerline handle in place, while
    // its orientation and the off-axis skin/toes still follow that twist.
    if(!foot.twist)assert.ok(difference(pointPositions(rig.extras.map(entry=>entry.bone)),handle)>.025);
  }
});

test('forefoot stretch is anchored at the heel and keeps continuous, pickable skin',async()=>{
  const {rig}=await fixture(),mesh=rig.meshes[0],base=snapshot(mesh),tip=rig.tips[1],inverse=rig.wrist.matrixWorld.clone().invert();
  const rest=tip.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse),source=mesh.geometry.attributes.position;
  for(const stretch of [-.4,1]){
    rig.setPose({...neutral(),foot:{stretch}});
    const moved=tip.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
    assert.ok(Math.abs(moved.z/rest.z-(1+stretch))<1e-10);
    const positions=snapshot(mesh);
    for(let vertex=0;vertex<source.count;vertex++)if(source.getZ(vertex)<-.1)
      for(let axis=0;axis<3;axis++)assert.ok(Math.abs(positions[vertex*3+axis]-base[vertex*3+axis])<1e-8);
    mesh.computeBoundingSphere();mesh.computeBoundingBox();
    for(let vertex=0;vertex<source.count;vertex+=41){
      const point=mesh.getVertexPosition(vertex,new THREE.Vector3());
      assert.ok(mesh.boundingSphere.containsPoint(point));assert.ok(mesh.boundingBox.containsPoint(point));
    }
  }
  rig.setPose({...neutral(),foot:{arch:45,twist:20,stretch:.3}});const before=snapshot(mesh);
  rig.setPose({...neutral(),foot:{arch:45.001,twist:20.001,stretch:.30001}});
  assert.ok(difference(before,snapshot(mesh))<.0002);
});

test('individual toes remain articulated within extreme shape poses and reset without accumulation',async()=>{
  const {rig}=await fixture(),mesh=rig.meshes[0],original=snapshot(mesh);
  for(const foot of [{arch:-70,twist:-55,stretch:-.4},{arch:85,twist:55,stretch:1}]){
    const pose={...neutral(),foot};rig.setPose(pose);const before=snapshot(mesh),tips=pointPositions(rig.tips);
    assert.ok(before.every(value=>Number.isFinite(value)&&Math.abs(value)<8));
    pose.fingers[1].mcp=50;pose.fingers[1].pip=60;pose.fingers[1].dip=50;rig.setPose(pose);
    assert.ok(difference(tips.slice(3,6),pointPositions(rig.tips).slice(3,6))>.1);
    assert.ok(difference(before,snapshot(mesh))>.05);
    const once=snapshot(mesh);for(let i=0;i<100;i++)rig.setPose(pose);assert.equal(difference(once,snapshot(mesh)),0);
  }
  rig.setPose(neutral());assert.equal(difference(original,snapshot(mesh)),0);
  rig.setPose({...neutral(),foot:{arch:NaN,twist:Infinity,stretch:Symbol()}});assert.equal(difference(original,snapshot(mesh)),0);
});
