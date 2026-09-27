import * as THREE from '../../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../../vendor/three/loaders/GLTFLoader.js';
import { createHandRig } from './hand-rig.js';
import { createFootRig } from './foot-rig.js';
import { createHandLook } from './hand-look.js';
import { createHandTrails } from './hand-trails.js';
import { evaluateHandPose, handMotionPeriod, handTremorRate } from './hand-model.js';

export const FINGER_COLORS = Object.freeze(['#e7a574','#dfcf83','#83c6b4','#87aadb','#c3a0d1']);
const RAD=Math.PI/180;
const FRAME_MARGIN=1.14;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const ASSETS={
  hand:{model:'../../../assets/gesticulating-hand/hand.glb',report:'../../../assets/gesticulating-hand/rig-report.json',create:createHandRig},
  foot:{model:'../../../assets/gesticulating-foot/foot.glb',report:'../../../assets/gesticulating-foot/rig-report.json',create:createFootRig},
};

/** A skinned vertex is a convex blend of its bone-space positions. Bounding
 * every influence therefore contains the whole surface, including palm/heel
 * vertices that are not represented by joint markers or fingertips. */
function createSkinBounds(rig) {
  const entries=[],point=new THREE.Vector3(),local=new THREE.Vector3();
  for(const mesh of rig.meshes){
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
    if(!mesh.isSkinnedMesh){mesh.geometry.computeBoundingSphere();entries.push({object:mesh,sphere:mesh.geometry.boundingSphere.clone()});continue;}
    const boxes=new Map();
    for(let vertex=0;vertex<position.count;vertex++){
      point.fromBufferAttribute(position,vertex).applyMatrix4(mesh.bindMatrix);
      for(let slot=0;slot<4;slot++)if(skinWeight.getComponent(vertex,slot)>0){
        const index=skinIndex.getComponent(vertex,slot);
        if(!boxes.has(index))boxes.set(index,new THREE.Box3());
        boxes.get(index).expandByPoint(local.copy(point).applyMatrix4(mesh.skeleton.boneInverses[index]));
      }
    }
    for(const [index,box] of boxes)entries.push({object:mesh.skeleton.bones[index],sphere:box.getBoundingSphere(new THREE.Sphere())});
  }
  const sphere=new THREE.Sphere();
  return callback=>{
    for(const entry of entries){
      const matrix=entry.object.matrixWorld,e=matrix.elements;
      // Rotated descendants of a stretched arch can shear. The maximum row
      // sum of AᵀA bounds its largest eigenvalue even for those transforms;
      // maximum column length alone would underestimate some foot surfaces.
      const xx=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],yy=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],zz=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];
      const xy=Math.abs(e[0]*e[4]+e[1]*e[5]+e[2]*e[6]),xz=Math.abs(e[0]*e[8]+e[1]*e[9]+e[2]*e[10]),yz=Math.abs(e[4]*e[8]+e[5]*e[9]+e[6]*e[10]);
      sphere.center.copy(entry.sphere.center).applyMatrix4(matrix);
      sphere.radius=entry.sphere.radius*Math.sqrt(Math.max(xx+xy+xz,yy+xy+yz,zz+xz+yz));callback(sphere);
    }
  };
}

/** One renderer, light rig and camera serve both weighted anatomy models. */
export function createHandViewer(canvas,{onSelect=()=>{},onGesture=()=>{},onChange=()=>{},onStatus=()=>{},onReady=()=>{},onLoading=()=>{},onViewChange=()=>{}}={}) {
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.setClearColor(0x141418,1);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.01,100);
  const ambient=new THREE.HemisphereLight(0xe7efff,0x29202b,2);scene.add(ambient);
  const keyLight=new THREE.DirectionalLight(0xffe5ce,3.6);keyLight.position.set(-3,5,5);scene.add(keyLight);
  const fill=new THREE.DirectionalLight(0xc7d8ff,2);fill.position.set(4,1,-3);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffffff,1.6);rim.position.set(-2,3,-4);scene.add(rim);
  const look=createHandLook({meshes:[],ambient,keyLight,fill,rim});
  const markerGroup=new THREE.Group();scene.add(markerGroup);
  const trails=createHandTrails(renderer);
  const markerGeometry=new THREE.SphereGeometry(.022,12,8),markers=[];
  const abort=new AbortController(),signal=abort.signal,cache=new Map(),loadedRigs=new Set();
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),temporary=new THREE.Vector3();
  let rig=null,form='hand',requestedForm='hand',loaded=false,disposed=false,selected=1,selectedJoint='mcp',showJoints=true,drag=null;
  let yaw=.12,pitch=.03,zoomFactor=1,width=0,height=0,baseDistance=5.8,latestPose=null,pickBoundsDirty=true,loadGeneration=0;
  let appearance={skin:0,lighting:0},framingConfig=null,framingSignature='',skinBounds=null,frameRadius=1.8;
  const frameCenter=new THREE.Vector3(),frameBox=new THREE.Box3(),frameSpheres=[],frameScratch=new THREE.Vector3();
  let poseSignature='',cameraSignature='';
  const listen=(type,callback,options={})=>canvas.addEventListener(type,callback,{...options,signal});

  function resize() {
    clearTrails();
    const box=canvas.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6,Math.sqrt(1450000/(width*height))));renderer.setSize(width,height,false);
    camera.aspect=width/height;camera.updateProjectionMatrix();
    // Keep an unobstructed strip above the controls on compact stages.
    const bottomInset=Math.min(height*.28,width<480?76:height<230?42:20);
    camera.setViewOffset(width,height,0,bottomInset/2,width,height);
    updateCamera();
  }
  function updateCamera() {
    const bottomInset=camera.view?.offsetY*2||0;
    const halfVertical=Math.atan(Math.tan(camera.fov*RAD/2)*(1-bottomInset/height));
    const halfHorizontal=Math.atan(Math.tan(camera.fov*RAD/2)*camera.aspect);
    const fittedDistance=frameRadius/Math.sin(Math.min(halfVertical,halfHorizontal));
    baseDistance=fittedDistance*FRAME_MARGIN;
    // Explicit zoom still works, but cannot move through the reserved envelope.
    const distance=Math.max(fittedDistance,baseDistance*zoomFactor);
    camera.position.set(distance*Math.sin(yaw)*Math.cos(pitch),distance*Math.sin(pitch),distance*Math.cos(yaw)*Math.cos(pitch)).add(frameCenter);
    camera.lookAt(frameCenter);camera.updateMatrixWorld();onChange();
    const signature=camera.matrixWorld.elements.join(',');if(signature!==cameraSignature){cameraSignature=signature;trails.changed();}
  }
  // Sample a complete choreography before displaying it, using the real rig's
  // skin bounds. This fixes one centered envelope for the performance instead of
  // zooming in and out as fingers curl. The live guard below covers manual/MIDI
  // edits and independent tremor phases between these samples.
  function prepareFraming() {
    if(!loaded||!framingConfig||framingConfig.form!==form)return;
    const config=framingConfig,period=handMotionPeriod(config.motion),rate=handTremorRate(config);
    frameBox.makeEmpty();frameSpheres.length=0;
    let pose;
    const samples=64;
    for(let i=0;i<samples;i++){
      pose=evaluateHandPose(config,period*i/samples,pose,rate>0?i*.61803398875/rate:0);rig.setPose(pose);
      skinBounds(sphere=>{frameSpheres.push(sphere.clone());frameBox.expandByPoint(frameScratch.copy(sphere.center).addScalar(sphere.radius));frameBox.expandByPoint(frameScratch.copy(sphere.center).addScalar(-sphere.radius));});
    }
    frameBox.getCenter(frameCenter);frameRadius=0;
    for(const sphere of frameSpheres)frameRadius=Math.max(frameRadius,frameCenter.distanceTo(sphere.center)+sphere.radius);
    frameRadius*=1.07;frameSpheres.length=0;
    if(latestPose)rig.setPose(latestPose);
    updateCamera();
  }
  function guardFraming(){
    let required=frameRadius;
    skinBounds(sphere=>{required=Math.max(required,frameCenter.distanceTo(sphere.center)+sphere.radius);});
    // Never contract during playback: even an unanticipated extreme remains
    // contained without repeatedly pumping the camera as the gesture relaxes.
    if(required>frameRadius+1e-6){frameRadius=required*1.025;updateCamera();}
  }
  function setFraming(config={}) {
    framingConfig=config;
    const motion=config.motion??{},tremor=config.tremor??{};
    const signature=JSON.stringify([config.form,config.pose,{...motion,tempo:undefined,speed:undefined},
      {...tremor,rate:undefined,referenceTempo:undefined}]);
    if(signature!==framingSignature){framingSignature=signature;prepareFraming();}
  }
  function getCameraView(){return {yaw:((yaw+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI,pitch,zoom:zoomFactor};}
  function setCameraView(view={}) {
    yaw=Number.isFinite(view.yaw)?clamp(view.yaw,-Math.PI,Math.PI):.12;
    pitch=Number.isFinite(view.pitch)?clamp(view.pitch,-1.15,1.15):.035;
    zoomFactor=Number.isFinite(view.zoom)?clamp(view.zoom,.62,2):1;updateCamera();
  }
  function setView(view){yaw={palm:.12,back:Math.PI+.12,side:Math.PI/2}[view]??.12;pitch=.035;zoomFactor=1;updateCamera();onViewChange(getCameraView());}
  function zoom(factor){zoomFactor=clamp(Math.max(zoomFactor,1/FRAME_MARGIN)*factor,1/FRAME_MARGIN,2);updateCamera();onViewChange(getCameraView());}
  function setAppearance(value={}){if(value.skin!==appearance.skin||value.lighting!==appearance.lighting)clearTrails();appearance={...value};look.apply(appearance);onChange();}
  function clearMarkers(){for(const dot of markers){markerGroup.remove(dot);dot.material.dispose();}markers.length=0;}
  function addMarker(finger,joint,bone){
    const material=new THREE.MeshBasicMaterial({color:finger>=5?0xe7dfd4:FINGER_COLORS[finger],transparent:true,opacity:.73,depthTest:false,depthWrite:false});
    const dot=new THREE.Mesh(markerGeometry,material);dot.renderOrder=10;dot.userData={finger,joint,bone};markerGroup.add(dot);markers.push(dot);
  }
  function refreshMarkers(){
    if(!loaded)return;
    for(const dot of markers){dot.position.copy(dot.userData.bone.getWorldPosition(temporary));
      const active=dot.userData.finger===selected;dot.scale.setScalar(active?(dot.userData.joint===selectedJoint?1.5:1.12):.75);dot.material.opacity=active?.86:.3;dot.visible=showJoints;}
  }
  function selectFinger(finger,joint='mcp'){selected=finger;selectedJoint=joint;refreshMarkers();}
  function setShowJoints(show){showJoints=Boolean(show);refreshMarkers();}
  function setPose(pose){latestPose=pose;if(!loaded)return;rig.setPose(pose);guardFraming();pickBoundsDirty=true;refreshMarkers();
    const signature=JSON.stringify([pose.fingers,pose.wrist,form==='foot'?pose.foot:pose.source]);
    if(signature!==poseSignature){poseSignature=signature;trails.changed();}
  }
  function setTrails(amount){if(disposed)return;trails.setAmount(amount);onChange();}
  function clearTrails(){trails.clear();poseSignature=cameraSignature='';}
  function hasTrailTail(now){return trails.hasTail(now);}
  function render(now){if(!disposed&&(!loaded||!trails.render(scene,camera,markerGroup,now)))renderer.render(scene,camera);}
  function pick(event){
    const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    let closest=null,nearest=Infinity;
    for(const dot of markers){
      temporary.copy(dot.position).project(camera);
      const x=(temporary.x*.5+.5)*rect.width,y=(-temporary.y*.5+.5)*rect.height,d=Math.hypot(event.clientX-rect.left-x,event.clientY-rect.top-y);
      if(temporary.z<1&&d<nearest&&d<(event.pointerType==='touch'?24:14)){nearest=d;closest=dot.userData;}
    }
    if(closest)return closest;
    if(pickBoundsDirty){for(const mesh of rig.meshes)if(mesh.isSkinnedMesh){mesh.computeBoundingSphere();if(mesh.boundingBox)mesh.computeBoundingBox();}pickBoundsDirty=false;}
    const hits=raycaster.intersectObjects(rig.meshes,false);if(!hits.length)return null;
    const point=hits[0].point,segment=new THREE.Line3(),nearestPoint=new THREE.Vector3();let finger=5,joint='mcp',minDistance=.23;
    for(let f=0;f<5;f++)for(const entry of rig.digits[f]){
      entry.bone.getWorldPosition(segment.start);entry.end.getWorldPosition(segment.end);segment.closestPointToPoint(point,true,nearestPoint);
      const distance=point.distanceTo(nearestPoint);if(distance<minDistance){minDistance=distance;finger=f;joint=entry.key;}
    }
    return {finger,joint};
  }
  function release(event){if(!drag||(event&&event.pointerId!==drag.id))return;const prior=drag;drag=null;if(prior.hit)onGesture({...prior.hit,bend:0,spread:0,end:true});if(canvas.hasPointerCapture(prior.id))canvas.releasePointerCapture(prior.id);onChange();}
  listen('pointerdown',event=>{
    if(!loaded||drag||event.button>0)return;const hit=pick(event);drag={id:event.pointerId,x:event.clientX,y:event.clientY,hit};
    canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});if(hit){if(hit.finger<5)onSelect(hit.finger,hit.joint);onGesture({...hit,bend:0,spread:0,start:true});}event.preventDefault();
  });
  listen('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id){if(loaded)canvas.style.cursor=pick(event)?'grab':'move';return;}
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.x=event.clientX;drag.y=event.clientY;
    if(drag.hit)onGesture({...drag.hit,bend:dy*.48,spread:dx*.24});
    else{yaw-=dx*.008;pitch=clamp(pitch+dy*.008,-1.15,1.15);updateCamera();onViewChange(getCameraView());}onChange();
  });
  listen('pointerup',release);listen('pointercancel',release);listen('lostpointercapture',release);
  listen('wheel',event=>{event.preventDefault();zoom(Math.exp(clamp(event.deltaY,-100,100)*.002));},{passive:false});
  listen('contextmenu',event=>event.preventDefault());
  listen('webglcontextlost',event=>{event.preventDefault();onStatus('The 3D view was interrupted. Sound and joint controls remain available. Reload to restore the view.');});

  function disposeTree(root){
    const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();
    root.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.skeleton)skeletons.add(object.skeleton);
      for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
    for(const skeleton of skeletons)skeleton.dispose();for(const texture of textures)texture.dispose();for(const material of materials)material.dispose();for(const geometry of geometries)geometry.dispose();
  }
  async function loadRig(next){
    const asset=ASSETS[next],loader=new GLTFLoader();let gltf,failed=false;
    try{
      const [loadedModel,report]=await Promise.all([
        loader.loadAsync(new URL(asset.model,import.meta.url).href).then(value=>{gltf=value;if(disposed||failed){disposeTree(value.scene);gltf=null;throw new Error('Model load cancelled');}return value;}),
        fetch(new URL(asset.report,import.meta.url),{signal}).then(response=>{if(!response.ok)throw new Error('Rig calibration is unavailable');return response.json();}),
      ]);
      if(disposed)throw new Error('Viewer disposed');
      const imported=[];loadedModel.scene.traverse(object=>{
        if(object.isLight||object.isCamera)imported.push(object);
        if(object.isMesh){object.frustumCulled=false;for(const material of Array.isArray(object.material)?object.material:[object.material]){
          material.roughness=Math.max(.45,material.roughness??.65);material.metalness=0;
          if(material.map)material.map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
        }}
      });
      for(const object of imported)object.removeFromParent();
      const result=asset.create(loadedModel,report);result.group.visible=false;scene.add(result.group);look.addMeshes(result.meshes);loadedRigs.add(result);return result;
    }catch(error){failed=true;if(gltf)disposeTree(gltf.scene);gltf=null;throw error;}
  }
  async function setForm(value='hand'){
    if(disposed)return false;
    const next=value==='foot'?'foot':'hand';if(next===requestedForm&&loaded)return true;
    const generation=++loadGeneration;requestedForm=next;loaded=false;release();clearTrails();if(rig)rig.group.visible=false;markerGroup.visible=false;
    onLoading(next);onStatus(`Loading the ${next}…`);onChange();
    if(!cache.has(next))cache.set(next,loadRig(next).catch(error=>{cache.delete(next);throw error;}));
    try{
      const nextRig=await cache.get(next);if(disposed||generation!==loadGeneration)return false;
      rig=nextRig;form=next;rig.group.visible=true;skinBounds=rig.skinBounds??=createSkinBounds(rig);clearMarkers();
      rig.digits.forEach((digit,index)=>digit.forEach(entry=>addMarker(index,entry.key,entry.bone)));addMarker(5,'mcp',rig.wrist);
      for(const entry of rig.extras??[])addMarker(6,entry.key,entry.bone);
      loaded=true;markerGroup.visible=true;prepareFraming();resize();if(latestPose)setPose(latestPose);refreshMarkers();render();onStatus('');onReady(form);onChange();return true;
    }catch(error){if(!disposed&&generation===loadGeneration){onStatus(`The ${next} could not load: ${error.message}. Choose another model or reload.`);onChange();}return false;}
  }
  function measureSurfaceBounds(){
    if(!loaded)return null;
    const box=new THREE.Box3(),point=new THREE.Vector3();let vertices=0;
    for(const mesh of rig.meshes)for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).project(camera);box.expandByPoint(point);vertices++;
    }
    return {min:box.min.toArray(),max:box.max.toArray(),vertices};
  }
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas.parentElement);resize();
  function dispose(){if(disposed)return;disposed=true;loaded=false;loadGeneration++;release();abort.abort();resizeObserver.disconnect();trails.dispose();look.dispose();
    clearMarkers();for(const loadedRig of loadedRigs)loadedRig.dispose?.();loadedRigs.clear();for(const child of scene.children)if(child!==markerGroup)disposeTree(child);markerGeometry.dispose();cache.clear();renderer.dispose();}
  setForm('hand');
  return {setForm,setPose,render,resize,setView,setCameraView,setFraming,setAppearance,setTrails,clearTrails,hasTrailTail,zoom,selectFinger,setShowJoints,dispose,
    getState:({includeSurfaceBounds=false}={})=>({loaded,form,requestedForm,rigCount:cache.size,boneCount:rig?.deformMap.size??0,
      vertices:rig?.meshes.reduce((n,m)=>n+(m.geometry.attributes.position?.count??0),0)??0,
      triangles:rig?.meshes.reduce((n,m)=>n+((m.geometry.index?.count??m.geometry.attributes.position?.count??0)/3),0)??0,
      selected,selectedJoint,showJoints,markers:loaded?markers.map(m=>({finger:m.userData.finger,joint:m.userData.joint,position:m.position.toArray(),screen:m.position.clone().project(camera).toArray()})):[],
      fingertips:loaded?rig.tips.map(b=>b.getWorldPosition(new THREE.Vector3()).project(camera).toArray()):[],
      surfaceBounds:includeSurfaceBounds?measureSurfaceBounds():undefined,
      framing:{center:frameCenter.toArray(),radius:frameRadius,distance:camera.position.distanceTo(frameCenter)},
      view:getCameraView(),appearance:{...appearance},trails:trails.getState(),size:[width,height],pixelRatio:renderer.getPixelRatio(),camera:camera.position.toArray()}),
  };
}
