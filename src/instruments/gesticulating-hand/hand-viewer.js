import * as THREE from '../../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../../vendor/three/loaders/GLTFLoader.js';
import { createHandRig } from './hand-rig.js';
import { createFootRig } from './foot-rig.js';
import { createHandLook } from './hand-look.js';

export const FINGER_COLORS = Object.freeze(['#e7a574','#dfcf83','#83c6b4','#87aadb','#c3a0d1']);
const RAD=Math.PI/180;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const ASSETS={
  hand:{model:'../../../assets/gesticulating-hand/hand.glb',report:'../../../assets/gesticulating-hand/rig-report.json',create:createHandRig},
  foot:{model:'../../../assets/gesticulating-foot/foot.glb',report:'../../../assets/gesticulating-foot/rig-report.json',create:createFootRig},
};

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
  const markerGeometry=new THREE.SphereGeometry(.022,12,8),markers=[];
  const abort=new AbortController(),signal=abort.signal,cache=new Map(),loadedRigs=new Set();
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),temporary=new THREE.Vector3();
  let rig=null,form='hand',requestedForm='hand',loaded=false,disposed=false,selected=1,selectedJoint='mcp',showJoints=true,drag=null;
  let yaw=.12,pitch=.03,zoomFactor=1,width=0,height=0,baseDistance=5.8,latestPose=null,pickBoundsDirty=true,loadGeneration=0;
  let appearance={skin:'natural',lighting:'studio'};
  const listen=(type,callback,options={})=>canvas.addEventListener(type,callback,{...options,signal});

  function resize() {
    const box=canvas.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6,Math.sqrt(1450000/(width*height))));renderer.setSize(width,height,false);
    camera.aspect=width/height;camera.updateProjectionMatrix();
    const bounds=rig?.bounds??new THREE.Vector3(2,3,1);
    const verticalFit=bounds.y/(2*Math.tan(camera.fov*RAD/2));
    const horizontalFit=bounds.x/(2*Math.tan(camera.fov*RAD/2)*camera.aspect);
    // Reserve room for the view controls on the shortest portrait stages.
    // Projection framing is separate from preset zoom and musical rotation.
    const compactFoot=form==='foot'&&width<480&&height<340;
    baseDistance=Math.max(verticalFit*1.5,horizontalFit*2.5)*(compactFoot?1.3:1);
    if(compactFoot)camera.setViewOffset(width,height,0,height*.075,width,height);else camera.clearViewOffset();
    updateCamera();
  }
  function updateCamera() {
    const distance=baseDistance*zoomFactor,target=new THREE.Vector3(0,-.04,0);
    camera.position.set(distance*Math.sin(yaw)*Math.cos(pitch),distance*Math.sin(pitch),distance*Math.cos(yaw)*Math.cos(pitch)).add(target);
    camera.lookAt(target);camera.updateMatrixWorld();onChange();
  }
  function getCameraView(){return {yaw:((yaw+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI,pitch,zoom:zoomFactor};}
  function setCameraView(view={}) {
    yaw=Number.isFinite(view.yaw)?clamp(view.yaw,-Math.PI,Math.PI):.12;
    pitch=Number.isFinite(view.pitch)?clamp(view.pitch,-1.15,1.15):.035;
    zoomFactor=Number.isFinite(view.zoom)?clamp(view.zoom,.62,2):1;updateCamera();
  }
  function setView(view){yaw={palm:.12,back:Math.PI+.12,side:Math.PI/2}[view]??.12;pitch=.035;zoomFactor=1;updateCamera();onViewChange(getCameraView());}
  function zoom(factor){zoomFactor=clamp(zoomFactor*factor,.62,2);updateCamera();onViewChange(getCameraView());}
  function setAppearance(value={}){appearance={...value};look.apply(appearance);onChange();}
  function clearMarkers(){for(const dot of markers){markerGroup.remove(dot);dot.material.dispose();}markers.length=0;}
  function addMarker(finger,joint,bone){
    const material=new THREE.MeshBasicMaterial({color:finger===5?0xe7dfd4:FINGER_COLORS[finger],transparent:true,opacity:.73,depthTest:false,depthWrite:false});
    const dot=new THREE.Mesh(markerGeometry,material);dot.renderOrder=10;dot.userData={finger,joint,bone};markerGroup.add(dot);markers.push(dot);
  }
  function refreshMarkers(){
    if(!loaded)return;
    for(const dot of markers){dot.position.copy(dot.userData.bone.getWorldPosition(temporary));
      const active=dot.userData.finger===selected;dot.scale.setScalar(active?(dot.userData.joint===selectedJoint?1.5:1.12):.75);dot.material.opacity=active?.86:.3;dot.visible=showJoints;}
  }
  function selectFinger(finger,joint='mcp'){selected=finger;selectedJoint=joint;refreshMarkers();}
  function setShowJoints(show){showJoints=Boolean(show);refreshMarkers();}
  function setPose(pose){latestPose=pose;if(!loaded)return;rig.setPose(pose);pickBoundsDirty=true;refreshMarkers();}
  function render(){if(!disposed)renderer.render(scene,camera);}
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
    const generation=++loadGeneration;requestedForm=next;loaded=false;release();if(rig)rig.group.visible=false;markerGroup.visible=false;
    onLoading(next);onStatus(`Loading the ${next}…`);onChange();
    if(!cache.has(next))cache.set(next,loadRig(next).catch(error=>{cache.delete(next);throw error;}));
    try{
      const nextRig=await cache.get(next);if(disposed||generation!==loadGeneration)return false;
      rig=nextRig;form=next;rig.group.visible=true;clearMarkers();
      rig.digits.forEach((digit,index)=>digit.forEach(entry=>addMarker(index,entry.key,entry.bone)));addMarker(5,'mcp',rig.wrist);
      loaded=true;markerGroup.visible=true;resize();if(latestPose)setPose(latestPose);refreshMarkers();render();onStatus('');onReady(form);onChange();return true;
    }catch(error){if(!disposed&&generation===loadGeneration){onStatus(`The ${next} could not load: ${error.message}. Choose another model or reload.`);onChange();}return false;}
  }
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas.parentElement);resize();
  function dispose(){if(disposed)return;disposed=true;loaded=false;loadGeneration++;release();abort.abort();resizeObserver.disconnect();look.dispose();
    clearMarkers();for(const loadedRig of loadedRigs)loadedRig.dispose?.();loadedRigs.clear();for(const child of scene.children)if(child!==markerGroup)disposeTree(child);markerGeometry.dispose();cache.clear();renderer.dispose();}
  setForm('hand');
  return {setForm,setPose,render,resize,setView,setCameraView,setAppearance,zoom,selectFinger,setShowJoints,dispose,
    getState:()=>({loaded,form,requestedForm,rigCount:cache.size,boneCount:rig?.deformMap.size??0,
      vertices:rig?.meshes.reduce((n,m)=>n+(m.geometry.attributes.position?.count??0),0)??0,
      triangles:rig?.meshes.reduce((n,m)=>n+((m.geometry.index?.count??m.geometry.attributes.position?.count??0)/3),0)??0,
      selected,selectedJoint,showJoints,markers:loaded?markers.map(m=>({finger:m.userData.finger,joint:m.userData.joint,position:m.position.toArray(),screen:m.position.clone().project(camera).toArray()})):[],
      fingertips:loaded?rig.tips.map(b=>b.getWorldPosition(new THREE.Vector3()).project(camera).toArray()):[],
      view:getCameraView(),appearance:{...appearance},size:[width,height],pixelRatio:renderer.getPixelRatio(),camera:camera.position.toArray()}),
  };
}
