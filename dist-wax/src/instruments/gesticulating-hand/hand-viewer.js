import * as THREE from '../../../vendor/three/three.module.min.js';
import { sampleSourceGrasp, SOURCE_BONE_NAMES, SOURCE_ANCESTOR_NAMES,
  SOURCE_OPEN_ROTATIONS, SOURCE_OPEN_ANCESTOR_ROTATIONS } from './hand-source-motion.js';
import { GLTFLoader } from '../../../vendor/three/loaders/GLTFLoader.js';
import { createHandLook } from './hand-look.js';

export const FINGER_COLORS = Object.freeze(['#e7a574','#dfcf83','#83c6b4','#87aadb','#c3a0d1']);
const RAD = Math.PI/180;
const DIGITS = ['thumb','index','middle','ring','pinky'];
const KEYS = ['mcp','pip','dip'];
const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
const vector = value => new THREE.Vector3().fromArray(value);
const quat = value => new THREE.Quaternion().fromArray(value);

/** Skinning uses the artist's weighted deform bones, calibrated against her
 * original Open/Close animation. Unweighted Blender control bones are not IK. */
export function createHandViewer(canvas,{onSelect=()=>{},onGesture=()=>{},onChange=()=>{},onStatus=()=>{},onReady=()=>{},onViewChange=()=>{}}={}) {
  const renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.setClearColor(0x141418,1); renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35,1,.01,100);
  const ambient = new THREE.HemisphereLight(0xe7efff,0x29202b,2.0);scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffe5ce,3.6);keyLight.position.set(-3,5,5);scene.add(keyLight);
  const fill = new THREE.DirectionalLight(0xc7d8ff,2);fill.position.set(4,1,-3);scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff,1.6);rim.position.set(-2,3,-4);scene.add(rim);
  const modelGroup = new THREE.Group(), orientation = new THREE.Group();
  scene.add(modelGroup);modelGroup.add(orientation);
  const markerGroup=new THREE.Group();scene.add(markerGroup);
  const abort=new AbortController(), signal=abort.signal;
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  const temporary=new THREE.Vector3(), worldNormal=new THREE.Vector3(), inverse=new THREE.Quaternion();
  const fingertips=[],markers=[],bones=[],meshes=[],deformMap=new Map(),calibration=new Map();
  const markerGeometry=new THREE.SphereGeometry(.022,12,8);
  let loaded=false,disposed=false,selected=1,selectedJoint='mcp',showJoints=true,drag=null;
  let distance=5.8,yaw=.12,pitch=.03,zoomFactor=1,width=0,height=0,baseDistance=5.8;
  let bounds=new THREE.Vector3(2,3,1),model,mixer,wrist,wristRest,palm,restNormal=new THREE.Vector3(0,0,1);
  let latestPose=null, sourceSample, palmRest, pickBoundsDirty=true, look;
  let appearance={skin:'natural',lighting:'studio'};
  const rotation=new THREE.Quaternion(), sourceRotation=new THREE.Quaternion();

  const listen=(type,callback,opts={})=>canvas.addEventListener(type,callback,{...opts,signal});
  function resize() {
    const box=canvas.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);
    const ratio=Math.min(devicePixelRatio||1,1.6,Math.sqrt(1450000/(width*height)));
    renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);
    camera.aspect=width/height;camera.updateProjectionMatrix();
    // Wrist sweeps extend sideways beyond the open hand's rest bounds. Fit
    // each axis independently so shorter pinned stages retain that clearance.
    const verticalFit=bounds.y/(2*Math.tan(camera.fov*RAD/2));
    const horizontalFit=bounds.x/(2*Math.tan(camera.fov*RAD/2)*camera.aspect);
    baseDistance=Math.max(verticalFit*1.5,horizontalFit*2.5);
    updateCamera();
  }
  function updateCamera() {
    distance=baseDistance*zoomFactor;
    const target=new THREE.Vector3(0,-.04,0);
    camera.position.set(distance*Math.sin(yaw)*Math.cos(pitch),distance*Math.sin(pitch),distance*Math.cos(yaw)*Math.cos(pitch)).add(target);
    camera.lookAt(target);camera.updateMatrixWorld();onChange();
  }
  function getCameraView() { return {yaw:((yaw+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI,pitch,zoom:zoomFactor}; }
  function setCameraView(view={}) {
    yaw=Number.isFinite(view.yaw)?clamp(view.yaw,-Math.PI,Math.PI):.12;
    pitch=Number.isFinite(view.pitch)?clamp(view.pitch,-1.15,1.15):.035;
    zoomFactor=Number.isFinite(view.zoom)?clamp(view.zoom,.62,2):1;
    updateCamera();
  }
  function setView(view) {yaw={palm:.12,back:Math.PI+.12,side:Math.PI/2}[view]??.12;pitch=.035;zoomFactor=1;updateCamera();onViewChange(getCameraView());}
  function zoom(factor) {zoomFactor=clamp(zoomFactor*factor,.62,2);updateCamera();onViewChange(getCameraView());}
  function setAppearance(value={}) {appearance={...value};look?.apply(appearance);onChange();}
  function marker(finger,joint,bone) {
    const color=finger===5?0xe7dfd4:FINGER_COLORS[finger];
    const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.73,depthTest:false,depthWrite:false});
    const node=new THREE.Mesh(markerGeometry,material);node.renderOrder=10;node.userData={finger,joint,bone};markerGroup.add(node);markers.push(node);
    return node;
  }
  function findBone(prefix) {return bones.find(bone=>bone.name.startsWith(prefix)&&!bone.name.includes('Ctrl')&&!bone.name.includes('_end'));}
  function refreshMarkers() {
    if(!loaded)return;
    for(const dot of markers){dot.position.copy(dot.userData.bone.getWorldPosition(temporary));
      const active=dot.userData.finger===selected;dot.scale.setScalar(active?(dot.userData.joint===selectedJoint?1.5:1.12):.75);
      dot.material.opacity=active?.86:.3;dot.visible=showJoints;
    }
  }
  function selectFinger(finger,joint='mcp') {selected=finger;selectedJoint=joint;refreshMarkers();}
  function setShowJoints(show) {showJoints=Boolean(show);refreshMarkers();}
  function setPose(pose) {
    latestPose=pose;if(!loaded||!pose)return;
    // Preserve the original open bind transforms and change only joint rotations.
    for(const [name,entry] of calibration) {
      const bone=deformMap.get(name);if(bone)bone.quaternion.copy(entry.open);
    }
    if(palm&&palmRest)palm.quaternion.copy(palmRest);
    if(pose.source){
      sourceSample=sampleSourceGrasp(pose.source.phase,sourceSample);
      for(let i=0;i<SOURCE_BONE_NAMES.length;i++){
        const bone=deformMap.get(SOURCE_BONE_NAMES[i]);
        if(bone)bone.quaternion.fromArray(SOURCE_OPEN_ROTATIONS[i]).slerp(sourceRotation.fromArray(sourceSample.rotations[i]),pose.source.amount);
      }
      for(let i=0;i<SOURCE_ANCESTOR_NAMES.length;i++){
        const bone=bones.find(b=>b.name===SOURCE_ANCESTOR_NAMES[i]);
        if(bone)bone.quaternion.fromArray(SOURCE_OPEN_ANCESTOR_ROTATIONS[i]).slerp(sourceRotation.fromArray(sourceSample.ancestorRotations[i]),pose.source.amount);
      }
    }
    for(let f=0;f<5;f++) {
      const digit=pose.fingers[f];
      for(let j=0;j<3;j++) {
        const bone=findBone(`${DIGITS[f]}_0${j+1}`), entry=bone&&calibration.get(bone.name);
        if(!entry)continue;
        if(!pose.source)bone.quaternion.copy(entry.open);
        const offset=pose.source?.offsets[f][KEYS[j]]??0;
        bone.quaternion.multiply(rotation.setFromAxisAngle(entry.axis,(digit[KEYS[j]]-offset)*RAD));
        if(j===0) {
          // Splay is around the palm normal expressed in this joint's local frame.
          const spreadAxis=entry.spreadAxis;
          bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(spreadAxis,digit.spread*RAD));
        }
      }
      const base=findBone(`${DIGITS[f]}_base`), baseEntry=base&&calibration.get(base.name);
      if(baseEntry&&!pose.source) {
        const close=clamp((digit.mcp+digit.pip+digit.dip)/220,0,1);
        base.quaternion.copy(baseEntry.open).multiply(new THREE.Quaternion().setFromAxisAngle(baseEntry.axis,baseEntry.closeAngle*close));
      }
    }
    if(wrist&&wristRest) {
      wrist.quaternion.copy(wristRest)
        .multiply(new THREE.Quaternion().setFromAxisAngle(wrist.userData.flexAxis,pose.wrist.flex*RAD))
        .multiply(new THREE.Quaternion().setFromAxisAngle(wrist.userData.sideAxis,pose.wrist.side*RAD))
        .multiply(new THREE.Quaternion().setFromAxisAngle(wrist.userData.twistAxis,pose.wrist.twist*RAD));
    }
    modelGroup.updateMatrixWorld(true);pickBoundsDirty=true;refreshMarkers();
  }
  function render(){if(!disposed)renderer.render(scene,camera);}
  function pick(event) {
    const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    // Screen-space hit zones stay easy to touch at every camera angle.
    let closest=null,nearest=Infinity;
    for(const dot of markers) {
      temporary.copy(dot.position).project(camera);
      const x=(temporary.x*.5+.5)*rect.width,y=(-temporary.y*.5+.5)*rect.height;
      const d=Math.hypot(event.clientX-rect.left-x,event.clientY-rect.top-y);
      if(temporary.z<1&&d<nearest&&d<(event.pointerType==='touch'?24:14)){nearest=d;closest=dot.userData;}
    }
    if(closest)return closest;
    if(pickBoundsDirty){
      for(const mesh of meshes)if(mesh.isSkinnedMesh){
        mesh.computeBoundingSphere();if(mesh.boundingBox)mesh.computeBoundingBox();
      }
      pickBoundsDirty=false;
    }
    const hits=raycaster.intersectObjects(meshes,false);
    if(!hits.length)return null;
    const point=hits[0].point;
    let finger=5,joint='mcp',minDistance=.23;
    const segment=new THREE.Line3(),nearestPoint=new THREE.Vector3();
    for(let f=0;f<5;f++)for(let j=0;j<3;j++){
      const a=findBone(DIGITS[f]+'_0'+(j+1));
      const b=j<2?findBone(DIGITS[f]+'_0'+(j+2)):bones.find(n=>n.name.startsWith(DIGITS[f]+'_03R_end'));
      if(!a||!b)continue;
      a.getWorldPosition(segment.start);b.getWorldPosition(segment.end);
      segment.closestPointToPoint(point,true,nearestPoint);
      const d=point.distanceTo(nearestPoint);
      if(d<minDistance){minDistance=d;finger=f;joint=KEYS[j];}
    }
    return {finger,joint};
  }
  listen('pointerdown',event=>{
    if(!loaded||drag||event.button>0)return;
    const hit=pick(event);drag={id:event.pointerId,x:event.clientX,y:event.clientY,hit};
    canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});
    if(hit){if(hit.finger<5)onSelect(hit.finger,hit.joint);onGesture({...hit,bend:0,spread:0,start:true});}
    event.preventDefault();
  });
  listen('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id){if(loaded)canvas.style.cursor=pick(event)?'grab':'move';return;}
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.x=event.clientX;drag.y=event.clientY;
    if(drag.hit)onGesture({...drag.hit,bend:dy*.48,spread:dx*.24});
    else{yaw-=dx*.008;pitch=clamp(pitch+dy*.008,-1.15,1.15);updateCamera();onViewChange(getCameraView());}
    onChange();
  });
  function release(event){if(!drag||(event&&event.pointerId!==drag.id))return;const prior=drag;drag=null;if(prior.hit)onGesture({...prior.hit,bend:0,spread:0,end:true});if(canvas.hasPointerCapture(prior.id))canvas.releasePointerCapture(prior.id);onChange();}
  listen('pointerup',release);listen('pointercancel',release);listen('lostpointercapture',release);
  listen('wheel',event=>{event.preventDefault();zoom(Math.exp(clamp(event.deltaY,-100,100)*.002));},{passive:false});
  listen('contextmenu',event=>event.preventDefault());
  listen('webglcontextlost',event=>{event.preventDefault();onStatus('The 3D view was interrupted. Sound and joint controls remain available. Reload to restore the view.');});
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas.parentElement);resize();

  async function load() {
    const loader=new GLTFLoader();
    const [gltf,report]=await Promise.all([
      loader.loadAsync(new URL('../../../assets/gesticulating-hand/hand.glb',import.meta.url).href),
      fetch(new URL('../../../assets/gesticulating-hand/rig-report.json',import.meta.url),{signal}).then(r=>{if(!r.ok)throw new Error('Hand rig calibration is unavailable.');return r.json();}),
    ]);
    if(disposed){gltf.scene.traverse(disposeObject);return;}
    model=gltf.scene;orientation.add(model);
    model.traverse(object=>{
      if(object.isBone)bones.push(object);
      if(object.isMesh){meshes.push(object);object.frustumCulled=false;
        for(const material of Array.isArray(object.material)?object.material:[object.material]){
          material.roughness=Math.max(.45,material.roughness??.65);material.metalness=0;
          if(material.map)material.map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
        }
      }
    });
    look=createHandLook({meshes,ambient,keyLight,fill,rim});look.apply(appearance);
    const importedLights=[];model.traverse(o=>{if(o.isLight||o.isCamera)importedLights.push(o);});for(const o of importedLights)o.removeFromParent();
    if(!meshes.some(m=>m.isSkinnedMesh)||bones.length<20)throw new Error('The hand is missing its skinning rig.');
    mixer=new THREE.AnimationMixer(model);if(gltf.animations[0]){mixer.clipAction(gltf.animations[0]).play();mixer.setTime(0);}
    model.updateMatrixWorld(true);for(const mesh of meshes)mesh.skeleton?.update();
    for(const entry of report.deformBones){
      const bone=bones.find(b=>b.name===entry.threeName);if(!bone)continue;deformMap.set(bone.name,bone);
      const axis=vector(entry.openToClosed.axis);if(axis.lengthSq()<.01)axis.set(0,0,1);
      calibration.set(bone.name,{open:quat(entry.sampledLocal.open.rotation),axis,closeAngle:entry.openToClosed.angleRadians,spreadAxis:new THREE.Vector3(1,0,0)});
    }
    wrist=findBone('handR_02');palm=findBone('handR001')??wrist;
    const wristPoint=wrist.getWorldPosition(new THREE.Vector3());
    const middle=findBone('middle_01').getWorldPosition(new THREE.Vector3());
    const across=findBone('index_01').getWorldPosition(new THREE.Vector3()).sub(findBone('pinky_01').getWorldPosition(new THREE.Vector3())).normalize();
    const up=middle.sub(wristPoint).normalize(),normal=new THREE.Vector3().crossVectors(across,up).normalize();
    const right=new THREE.Vector3().crossVectors(up,normal).normalize();
    orientation.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,normal)).invert();
    modelGroup.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(model,true);const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    const scale=2.85/size.y;modelGroup.scale.setScalar(scale);modelGroup.position.copy(center).multiplyScalar(-scale);
    modelGroup.updateMatrixWorld(true);bounds=size.multiplyScalar(scale);
    for(const [name,entry] of calibration){const bone=deformMap.get(name);bone.getWorldQuaternion(inverse).invert();entry.spreadAxis.copy(restNormal).applyQuaternion(inverse).normalize();}
    palmRest=palm.quaternion.clone();wristRest=wrist.quaternion.clone();wrist.getWorldQuaternion(inverse).invert();
    wrist.userData.flexAxis=new THREE.Vector3(1,0,0).applyQuaternion(inverse).normalize();
    wrist.userData.sideAxis=new THREE.Vector3(0,0,1).applyQuaternion(inverse).normalize();
    wrist.userData.twistAxis=new THREE.Vector3(0,1,0).applyQuaternion(inverse).normalize();
    for(let f=0;f<5;f++)for(let j=0;j<3;j++)marker(f,KEYS[j],findBone(`${DIGITS[f]}_0${j+1}`));
    marker(5,'mcp',wrist);
    for(const digit of DIGITS){const tip=bones.find(b=>b.name.startsWith(digit+'_03R_end'));if(tip)fingertips.push(tip);}
    loaded=true;resize();if(latestPose)setPose(latestPose);refreshMarkers();render();onStatus('');onReady();onChange();
  }
  function disposeObject(object){object.geometry?.dispose();for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[]){for(const value of Object.values(material))if(value?.isTexture)value.dispose();material.dispose();}}
  function dispose(){if(disposed)return;disposed=true;release();abort.abort();resizeObserver.disconnect();mixer?.stopAllAction();if(model)mixer?.uncacheRoot(model);look?.dispose();scene.traverse(disposeObject);markerGeometry.dispose();renderer.dispose();}
  load().catch(error=>{if(!disposed)onStatus(`The hand could not load: ${error.message}. Reload to try again.`);});
  return {setPose,render,resize,setView,setCameraView,setAppearance,zoom,selectFinger,setShowJoints,dispose,
    getState:()=>({loaded,boneCount:deformMap.size,vertices:meshes.reduce((n,m)=>n+(m.geometry.attributes.position?.count??0),0),
      triangles:meshes.reduce((n,m)=>n+((m.geometry.index?.count??m.geometry.attributes.position?.count??0)/3),0),
      selected,selectedJoint,showJoints,markers:markers.map(m=>({finger:m.userData.finger,joint:m.userData.joint,position:m.position.toArray(),screen:m.position.clone().project(camera).toArray()})),
      fingertips:fingertips.map(b=>b.getWorldPosition(new THREE.Vector3()).project(camera).toArray()),
      view:getCameraView(),appearance:{...appearance},size:[width,height],pixelRatio:renderer.getPixelRatio(),camera:camera.position.toArray()}),
  };
}
