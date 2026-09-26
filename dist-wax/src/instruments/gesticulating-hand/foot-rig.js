import * as THREE from '../../../vendor/three/three.module.min.js';

const RAD=Math.PI/180;
const vector=value=>new THREE.Vector3().fromArray(value);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** Add a short weighted arch without changing the source surface or discarding
 * any of its toe/leg influences. The transition ends before four-weight toe
 * vertices, so its two adjacent arch weights always fit the glTF's four slots. */
function createArchRig(meshes,wrist,digits,report){
  const skinned=meshes.filter(mesh=>mesh.isSkinnedMesh),skeletons=[...new Set(skinned.map(mesh=>mesh.skeleton))];
  const inverse=wrist.matrixWorld.clone().invert(),point=new THREE.Vector3(),bindToAnkle=new THREE.Matrix4();
  const center=new THREE.Vector3();
  for(const digit of digits)center.add(digit[0].bone.getWorldPosition(point));
  center.multiplyScalar(1/digits.length).applyMatrix4(inverse);
  const ankleTail=vector(report.ankle.tail).applyMatrix4(inverse);
  let transitionEnd=center.z*.6;
  for(const mesh of skinned){
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes,footIndex=mesh.skeleton.bones.indexOf(wrist);
    if(footIndex<0)throw new Error('The foot skin is missing its ankle weight');
    bindToAnkle.multiplyMatrices(inverse,mesh.bindMatrix);
    for(let vertex=0;vertex<position.count;vertex++){
      let count=0,hasFoot=false;
      for(let slot=0;slot<4;slot++)if(skinWeight.getComponent(vertex,slot)>0){count++;if(skinIndex.getComponent(vertex,slot)===footIndex)hasFoot=true;}
      if(hasFoot&&count===4){point.fromBufferAttribute(position,vertex).applyMatrix4(bindToAnkle);transitionEnd=Math.min(transitionEnd,point.z-.015);}
    }
  }
  if(!(transitionEnd>0))throw new Error('The foot skin has no room for a weighted arch');
  const archBones=Array.from({length:3},(_,index)=>{
    const bone=new THREE.Bone();bone.name=`gesticules_arch_${index+1}`;
    bone.position.set(index===0?center.x:0,index===0?(center.y+ankleTail.y)*.5:0,index===0?0:transitionEnd/3);
    return bone;
  });
  wrist.add(archBones[0]);archBones[0].add(archBones[1]);archBones[1].add(archBones[2]);
  wrist.updateWorldMatrix(true,true);
  // attach() preserves the imported toe origins and rotations in the bind pose.
  for(const digit of digits)archBones[2].attach(digit[0].bone);
  const inverseBinds=archBones.map(bone=>bone.matrixWorld.clone().invert()),indices=new Map();
  for(const skeleton of skeletons){
    indices.set(skeleton,[skeleton.bones.indexOf(wrist),...archBones.map((_,index)=>skeleton.bones.length+index)]);
    skeleton.bones.push(...archBones);skeleton.boneInverses.push(...inverseBinds.map(matrix=>matrix.clone()));
    // Preserve skeleton sharing between primitives; its enlarged bone palette
    // remains owned and disposed by the viewer with the imported skeleton.
    skeleton.dispose();skeleton.init();
  }
  const copies=new Map(),processed=new Set();
  for(const mesh of skinned){
    if(processed.has(mesh.geometry))continue;processed.add(mesh.geometry);
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes,palette=indices.get(mesh.skeleton);
    let copy=copies.get(skinWeight);
    if(!copy){
      copy={skinIndex:skinIndex.clone(),skinWeight:skinWeight.clone()};copies.set(skinWeight,copy);
      bindToAnkle.multiplyMatrices(inverse,mesh.bindMatrix);
      for(let vertex=0;vertex<position.count;vertex++)for(let slot=0;slot<4;slot++){
        const weight=skinWeight.getComponent(vertex,slot);
        if(weight<=0||skinIndex.getComponent(vertex,slot)!==palette[0])continue;
        point.fromBufferAttribute(position,vertex).applyMatrix4(bindToAnkle);
        const along=clamp(point.z/transitionEnd*3,0,3),lower=Math.min(2,Math.floor(along));
        const fraction=along-lower,mix=fraction*fraction*(3-2*fraction);
        copy.skinIndex.setComponent(vertex,slot,palette[mix===1?lower+1:lower]);
        if(mix===0||mix===1)continue;
        const spare=[0,1,2,3].find(index=>skinWeight.getComponent(vertex,index)===0);
        if(spare===undefined)throw new Error('The foot arch would discard an existing skin weight');
        copy.skinWeight.setComponent(vertex,slot,weight*(1-mix));
        copy.skinIndex.setComponent(vertex,spare,palette[lower+1]);copy.skinWeight.setComponent(vertex,spare,weight*mix);
      }
    }
    mesh.geometry.setAttribute('skinIndex',copy.skinIndex);mesh.geometry.setAttribute('skinWeight',copy.skinWeight);
  }
  const rotation=new THREE.Quaternion(),bend=new THREE.Vector3(1,0,0),twist=new THREE.Vector3(0,0,1);
  function setShape(shape){
    const arch=clamp(Number.isFinite(shape?.arch)?shape.arch:0,-70,85)*RAD/3;
    const torsion=clamp(Number.isFinite(shape?.twist)?shape.twist:0,-55,55)*RAD/3;
    const stretch=clamp(Number.isFinite(shape?.stretch)?shape.stretch:0,-.4,1);
    for(const bone of archBones)bone.quaternion.setFromAxisAngle(bend,-arch).multiply(rotation.setFromAxisAngle(twist,torsion));
    archBones[0].scale.z=1+stretch;
  }
  return {bones:archBones,extras:[{key:'arch',bone:archBones[1]}],setShape};
}


/** MakeHuman's weighted toes retain their bind transforms. The two-joint big
 * toe uses base/tip controls; the four smaller toes use base/middle/tip. */
export function createFootRig(gltf,report) {
  const group=new THREE.Group(),orientation=new THREE.Group(),model=gltf.scene;
  group.add(orientation);orientation.add(model);
  const meshes=[],bones=[],deformMap=new Map(),calibration=new Map();
  model.traverse(object=>{if(object.isMesh)meshes.push(object);if(object.isBone)bones.push(object);});
  if(!meshes.some(mesh=>mesh.isSkinnedMesh))throw new Error('The foot is missing its weighted rig');
  const byName=new Map(bones.map(bone=>[bone.name,bone]));
  for(const bone of bones){deformMap.set(bone.name,bone);calibration.set(bone.name,bone.quaternion.clone());}
  model.updateMatrixWorld(true);for(const mesh of meshes)mesh.skeleton?.update();
  const tips=[];
  const digits=report.digits.map((digit,index)=>{
    const keys=index===0?['mcp','dip']:['mcp','pip','dip'];
    const entries=keys.map(key=>{
      const bone=byName.get(digit.bones[key]);if(!bone)throw new Error(`Missing toe joint: ${digit.bones[key]}`);
      const joint=digit.joints?.[key]??{};
      return {key,bone,bendAxis:vector(joint.bendAxis??[1,0,0]),spreadAxis:vector(joint.spreadAxis??[0,1,0])};
    });
    const last=entries.at(-1).bone,tip=new THREE.Object3D();tip.name=`toe${index+1}_tip`;
    tip.position.copy(last.worldToLocal(vector(digit.tip)));last.add(tip);tips.push(tip);
    entries.forEach((entry,i)=>{entry.end=entries[i+1]?.bone??tip;});return entries;
  });
  if(digits.length!==5)throw new Error('The foot must contain five toe chains');
  const wrist=byName.get(report.ankle.bone);if(!wrist)throw new Error('The foot is missing its ankle joint');
  const ankleAxes={flex:vector(report.ankle.bendAxis??[1,0,0]),side:vector(report.ankle.sideAxis??[0,0,1]),twist:vector(report.ankle.twistAxis??[0,1,0])};
  const arch=createArchRig(meshes,wrist,digits,report);
  for(const bone of arch.bones){bones.push(bone);deformMap.set(bone.name,bone);calibration.set(bone.name,bone.quaternion.clone());}
  // Source frame is X-right, Y-up, Z-toward-toes. Present the toes upward and
  // dorsal skin/toenails forward; the reverse view exposes the sole.
  orientation.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,1,0))).invert();
  group.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(model,true),bounds=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const scale=2.85/bounds.y;group.scale.setScalar(scale);group.position.copy(center).multiplyScalar(-scale);bounds.multiplyScalar(scale);group.updateMatrixWorld(true);
  const rotation=new THREE.Quaternion();
  function setPose(pose){
    for(const bone of bones)bone.quaternion.copy(calibration.get(bone.name));
    for(let i=0;i<5;i++)for(const entry of digits[i]){
      entry.bone.quaternion.multiply(rotation.setFromAxisAngle(entry.bendAxis,pose.fingers[i][entry.key]*RAD));
      if(entry.key==='mcp')entry.bone.quaternion.multiply(rotation.setFromAxisAngle(entry.spreadAxis,pose.fingers[i].spread*RAD));
    }
    for(const key of ['flex','side','twist'])wrist.quaternion.multiply(rotation.setFromAxisAngle(ankleAxes[key],pose.wrist[key]*RAD));
    arch.setShape(pose.foot);
    group.updateMatrixWorld(true);
  }
  return {group,meshes,bones,deformMap,bounds,wrist,digits,tips,extras:arch.extras,setPose};
}
