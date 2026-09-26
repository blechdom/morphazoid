import * as THREE from '../../../vendor/three/three.module.min.js';

const RAD=Math.PI/180;
const vector=value=>new THREE.Vector3().fromArray(value);

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
    group.updateMatrixWorld(true);
  }
  return {group,meshes,bones,deformMap,bounds,wrist,digits,tips,setPose};
}
