import * as THREE from '../../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../../vendor/three/loaders/GLTFLoader.js';
import { createHandRig } from '../gesticulating-hand/hand-rig.js';
import { evaluateWitchHandPose } from './witch-model.js';
import { createHandPose } from '../gesticulating-hand/hand-model.js';
import { handTransform } from './witch-renderer.js';
import { witchHandQuality, witchHandSurfaceSize, createWitchHandPaintCache, sizeWitchModelTextures } from './witch-model-display.js';

// Runtime adaptation of Elena FF's "Rigged hand", the same skinned source used
// by Gesticules. Model/derived model appearance: CC BY-SA 4.0. Original source:
// https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e
// This separately authored viewer/controller implementation is MIT.
const MODEL = new URL('../../../assets/witch/hand-1024.glb', import.meta.url);
const PHONE_MODEL = new URL('../../../assets/witch/hand-512.glb', import.meta.url);
const REPORT = new URL('../../../assets/gesticulating-hand/rig-report.json', import.meta.url);
const WIDTH = 1000, HEIGHT = 720;
const DIGIT_COLORS = [0xff9868,0xe7dc66,0x50ebba,0x5d9bff,0xd77bff];
const clamp = (value, low = 0, high = 1) => Math.max(low,Math.min(high,Number.isFinite(value)?value:low));

function disposeTree(root) {
  if (!root) return;
  const geometry = new Set(), material = new Set(), texture = new Set(), skeleton = new Set();
  root.traverse(object => {
    if (object.geometry) geometry.add(object.geometry);
    if (object.skeleton) skeleton.add(object.skeleton);
    for (const entry of object.material ? (Array.isArray(object.material)?object.material:[object.material]) : []) {
      material.add(entry);
      for (const value of Object.values(entry)) if (value?.isTexture) texture.add(value);
    }
  });
  for (const value of skeleton) value.dispose();
  for (const value of texture) { value.source?.data?.close?.(); value.dispose(); }
  for (const value of material) value.dispose();
  for (const value of geometry) value.dispose();
}

// A curved, elliptical claw grown along the final bone's local +Y axis.
function clawGeometry() {
  const positions = [], indices = [], rings = 12, sides = 10;
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring/rings, radius = .046*Math.pow(1-t,.72)+.00035;
    const y = -.032+t*.285, curve = -.062*t*t;
    for (let side = 0; side < sides; side++) {
      const a = side/sides*Math.PI*2;
      positions.push(curve+Math.cos(a)*radius,y,Math.sin(a)*radius*.52);
    }
  }
  for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
    const a = ring*sides+side, b = ring*sides+(side+1)%sides;
    indices.push(a,b,a+sides,b,b+sides,a+sides);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

/** One source rig and WebGL context serve both hands. A batched atlas takes one
 * GPU snapshot before cropping each independently posed hand into its own 2D
 * canvas. The second pose cannot change the first hand's pixels or picking
 * coordinates. The caller owns time and placement; points are 1000×720 pixels. */
export function createWitchHand({onStatus = () => {},quality:initialQuality={}} = {}) {
  let quality=witchHandQuality(initialQuality);
  const modelURL=quality.textureSize<=512?PHONE_MODEL:MODEL;
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 92;
  const atlas=document.createElement('canvas'),atlasContext=atlas.getContext('2d');
  atlas.width=128;atlas.height=184;
  const hands = Array.from({length:2},(_,index)=>{
    const surface=document.createElement('canvas'); surface.width=index===0?360:320; surface.height=Math.round(surface.width*HEIGHT/WIDTH);
    return {surface,context:surface.getContext('2d'),paint:createWitchHandPaintCache(),pose:createHandPose(),lastRender:0,renderCount:0,state:{},tips:[],wrist:{x:590,y:590},palm:{x:590,y:510}};
  });
  const handSlot = index => hands[index===1?1:0];
  const abort = new AbortController();
  const scene = new THREE.Scene();
  // Rig poses explicitly update their hierarchy. Avoid updating every bone
  // again in renderer.render(), and during each fingertip projection.
  scene.matrixWorldAutoUpdate=false;
  const camera = new THREE.OrthographicCamera(-500,500,360,-360,.1,4000);
  camera.position.set(0,0,1000); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
  const placement = new THREE.Group(); scene.add(placement);
  const ambient = new THREE.HemisphereLight(0xd9efdc,0x381847,1.5); scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffcf9d,3.0); key.position.set(-350,550,600); scene.add(key);
  const fill = new THREE.DirectionalLight(0x7b91ff,1.8); fill.position.set(350,100,400); scene.add(fill);
  const rim = new THREE.DirectionalLight(0x76ffd2,2.4); rim.position.set(100,350,-450); scene.add(rim);
  const skinColor={value:new THREE.Color()},skinAccent={value:new THREE.Color()};
  const skinPalettes=[
    [new THREE.Color(0x239e88),new THREE.Color(0xb858bd)],
    [new THREE.Color(0x8061c5),new THREE.Color(0xb5be4c)],
  ];
  const projected = new THREE.Vector3(), temporary = new THREE.Vector3();
  let renderer = null, rig = null, loaded = false, disposed = false, lost = false;
  let vertices = 0, triangles = 0, sourceRoot = null,texturePixels=0,sourceTexturePixels=0,atlasCopies=0;
  const claws = [], anchors = [], manualThumb = [];

  function status(message) { if (!disposed) onStatus(message); }
  function project(object, index) {
    projected.setFromMatrixPosition(object.matrixWorld).project(camera);
    return {x:(projected.x+1)*WIDTH/2,y:(1-projected.y)*HEIGHT/2,...(index===undefined?{}:{index})};
  }
  function restingPose(state) {
    const values = state.fingers || [.35,.35,.25,.3,.3];
    return {
      fingers: Array.from({length:5},(_,index) => {
        const curl = clamp(values[index]);
        return {
          mcp:(index===0?22:28)*curl,
          pip:(index===0?41:70)*curl,
          dip:(index===0?28:48)*curl,
          spread:[-7,-9,-1,8,17][index],
        };
      }),
      wrist:{flex:-5,side:0,twist:0},
    };
  }
  function update(state,handIndex,pose) {
    const slot=handSlot(handIndex),palette=skinPalettes[handIndex];
    // Turn the ladle hand around its own three-dimensional wrist axis. This
    // exposes the opposite palm without flipping its screen-space heading.
    const wristTwist=pose.wrist.twist+(handIndex===1?180:0);
    const rigPose=handIndex===1?{...pose,wrist:{...pose.wrist,twist:wristTwist}}:pose;
    const heldThumb=handIndex===0 && pose.source && (state.manualFingerMask & 1);
    if(heldThumb) {
      // The imported grasp also rotates the thumb's base. Preserve a held
      // thumb's full extension while the other digits keep that choreography.
      rig.setPose({...rigPose,source:null});
      for(const joint of manualThumb)joint.rotation.copy(joint.bone.quaternion);
    }
    rig.setPose(rigPose);
    if(heldThumb){
      for(const joint of manualThumb)joint.bone.quaternion.copy(joint.rotation);
      rig.group.updateMatrixWorld(true);
    }
    slot.wristTwist=wristTwist;
    skinColor.value.copy(palette[0]); skinAccent.value.copy(palette[1]);
    for (let index = 0; index < claws.length; index++) {
      const level = clamp(state.handFingerLevels?.[handIndex]?.[index]??state.fingerLevels?.[index]);
      claws[index].material.emissiveIntensity = .08+level*.55;
      claws[index].material.roughness = .32-level*.13;
    }
    slot.tips = anchors.map((anchor,index)=>project(anchor,index));
    slot.wrist = project(rig.wrist);
    // A grip belongs inside the actual posed palm, between the wrist and the
    // central metacarpals. Project it with the same camera as skin and tips.
    const knuckles=rig.digits.slice(1,4).map(digit=>project(digit[0].bone));
    slot.palm={x:slot.wrist.x+(knuckles.reduce((sum,p)=>sum+p.x,0)/3-slot.wrist.x)*.58,
      y:slot.wrist.y+(knuckles.reduce((sum,p)=>sum+p.y,0)/3-slot.wrist.y)*.58};
  }
  function frame() {
    placement.rotation.set(.08,Math.PI-.18,-.035);
    rig.setPose(restingPose({fingers:[0,0,0,0,0]}));
    placement.updateMatrixWorld(true);
    const wrist = rig.wrist.getWorldPosition(new THREE.Vector3());
    let left = wrist.x, right = wrist.x, top = wrist.y;
    for (const anchor of anchors) {
      anchor.getWorldPosition(temporary);
      left = Math.min(left,temporary.x); right = Math.max(right,temporary.x); top = Math.max(top,temporary.y);
    }
    // Stable framing is measured once from the actual elongated, open rig.
    const scale = Math.min(190/Math.max(.05,wrist.x-left),150/Math.max(.05,right-wrist.x),430/Math.max(.05,top-wrist.y));
    placement.scale.setScalar(scale);
    placement.updateMatrixWorld(true);
    rig.wrist.getWorldPosition(temporary);
    placement.position.set(90-temporary.x,-230-temporary.y,-temporary.z);
    scene.updateMatrixWorld(true);
  }
  function paintHands(indices) {
    if (!loaded || disposed || lost || !renderer) return;
    const sizes=hands.map((slot,index)=>witchHandSurfaceSize(handTransform(slot.state,index).scale,slot.state.renderScale,quality.maxWidth));
    const now=performance.now(),pending=[];
    for(const handIndex of indices) {
      const slot=hands[handIndex],state=slot.state,{width,height}=sizes[handIndex];
      const interval=state.manualFingerMask?Math.min(quality.frameInterval,1000/30):quality.frameInterval;
      if(now-slot.lastRender<interval && slot.paint.valid && slot.surface.width===width)continue;
      const pose=state.handPoses?.[handIndex]??evaluateWitchHandPose(state,
        state.handTime??state.incantationPhase??state.motionTime??0,handIndex,slot.pose);
      const levels=state.handFingerLevels?.[handIndex]??state.fingerLevels;
      if(slot.paint.update(pose,levels,width,state.manualFingerMask))pending.push({handIndex,slot,state,pose,width,height});
    }
    if(!pending.length)return;
    const bufferWidth=Math.max(...sizes.map(size=>size.width)),bufferHeight=sizes[0].height+sizes[1].height;
    if(canvas.width!==bufferWidth||canvas.height!==bufferHeight)renderer.setSize(bufferWidth,bufferHeight,false);
    renderer.setScissorTest(true);
    for(const frame of pending) {
      const {handIndex,state,pose,width,height}=frame;
      frame.top=handIndex===0?0:sizes[0].height;
      const bottom=bufferHeight-frame.top-height;
      update(state,handIndex,pose);
      renderer.setViewport(0,bottom,width,height);renderer.setScissor(0,bottom,width,height);
      renderer.render(scene,camera);
    }
    if(atlas.width!==bufferWidth||atlas.height!==bufferHeight) {atlas.width=bufferWidth;atlas.height=bufferHeight;}
    else atlasContext.clearRect(0,0,bufferWidth,bufferHeight);
    // Finish all GPU drawing before the only WebGL→2D copy. The individual
    // crops below read this ordinary 2D atlas, avoiding a second GPU flush.
    atlasContext.drawImage(canvas,0,0);atlasCopies++;
    for(const {slot,width,height,top} of pending) {
      if(slot.surface.width!==width||slot.surface.height!==height) {slot.surface.width=width;slot.surface.height=height;}
      else slot.context.clearRect(0,0,width,height);
      slot.context.drawImage(atlas,0,top,width,height,0,0,width,height);
      slot.lastRender=now;slot.renderCount++;
    }
  }
  function renderPair(state={}) {
    for(const slot of hands)slot.state=state;
    paintHands([0,1]);
    return hands.map(slot=>slot.surface);
  }
  function render(state = {},handIndex=0) {
    handIndex=handIndex===1?1:0;
    const slot=hands[handIndex];slot.state=state;
    paintHands([handIndex]);return slot.surface;
  }
  function setQuality(value={}) {
    quality=witchHandQuality({...quality,...value});
    if(sourceRoot)texturePixels=sizeWitchModelTextures(sourceRoot,quality.textureSize).texturePixels;
    hands.forEach(slot=>slot.paint.invalidate());
  }
  function getTips(handIndex=0) { return loaded && !lost && !disposed ? handSlot(handIndex).tips.map(point=>({...point})) : []; }
  function getWrist(handIndex=0) { return {...handSlot(handIndex).wrist}; }
  function getPalm(handIndex=0) { return {...handSlot(handIndex).palm}; }
  function pick(x,y,radius=46,handIndex=0) {
    if (!loaded || lost || disposed || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    let hit = null, distance = clamp(radius,8,160);
    for (const point of handSlot(handIndex).tips) {
      const d = Math.hypot(x-point.x,y-point.y);
      if (d <= distance) { hit={type:'finger',index:point.index}; distance=d; }
    }
    return hit;
  }
  function getMetadata() {
    return {
      loaded:loaded && !disposed && !lost,
      source:'assets/gesticulating-hand/hand.glb',
      modelUrl:modelURL.href,
      author:'Elena FF', title:'Rigged hand', license:'CC BY-SA 4.0',
      vertices,triangles,deformBones:rig?.deformMap.size??0,
      runtimeAdapted:true,claws:claws.length,
      modelInstances:hands.length,webglContexts:renderer?1:0,wristTwists:hands.map(slot=>slot.wristTwist??0),
      quality:{...quality},bufferSize:[canvas.width,canvas.height],atlasCopies,atlasSize:[atlas.width,atlas.height],surfaceSizes:hands.map(slot=>[slot.surface.width,slot.surface.height]),
      renderCounts:hands.map(slot=>slot.renderCount),sourceTexturePixels,texturePixels,
    };
  }
  function dispose() {
    if (disposed) return;
    disposed=true; loaded=false; abort.abort();
    rig?.dispose(); disposeTree(sourceRoot); sourceRoot=null;rig=null;
    placement.clear();
    for (const slot of hands) { slot.tips=[];slot.state={};slot.surface.width=slot.surface.height=1; }
    renderer?.dispose(); renderer?.forceContextLoss(); renderer=null;
    canvas.width=canvas.height=atlas.width=atlas.height=1;
  }
  const ready = (async () => {
    try {
      renderer = new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
      renderer.setPixelRatio(1); renderer.setSize(128,92,false);
      renderer.setClearColor(0x000000,0); renderer.outputColorSpace=THREE.SRGBColorSpace;
      renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.12;
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;status('The hand view was interrupted. Finger controls remain available.');},{signal:abort.signal});
      canvas.addEventListener('webglcontextrestored',()=>{
        lost=false;
        hands.forEach(slot=>slot.paint.invalidate());paintHands([0,1]);status('');
      },{signal:abort.signal});
      status('Loading her Gesticules hands…');
      const [modelResponse,reportResponse] = await Promise.all([
        fetch(modelURL,{signal:abort.signal}),fetch(REPORT,{signal:abort.signal}),
      ]);
      if (!modelResponse.ok || !reportResponse.ok) throw new Error('The hand model or calibration could not be loaded.');
      const [buffer,report] = await Promise.all([modelResponse.arrayBuffer(),reportResponse.json()]);
      if (disposed) return false;
      const gltf = await new GLTFLoader().parseAsync(buffer,new URL('./',MODEL).href);
      sourceRoot=gltf.scene;
      if (disposed) { disposeTree(sourceRoot); sourceRoot=null; return false; }
      const imports=[];
      sourceRoot.traverse(object=>{
        if (object.isLight || object.isCamera) imports.push(object);
        if (!object.isMesh) return;
        vertices += object.geometry.attributes.position?.count??0;
        triangles += (object.geometry.index?.count??object.geometry.attributes.position?.count??0)/3;
        for (const material of Array.isArray(object.material)?object.material:[object.material]) {
          // Preserve source pores, nails and creases beneath mottled jewel tones.
          material.color.set(0xffffff); material.roughness=.66; material.metalness=.06;
          material.onBeforeCompile=shader=>{
            shader.uniforms.witchSkinColor=skinColor; shader.uniforms.witchSkinAccent=skinAccent;
            shader.fragmentShader='uniform vec3 witchSkinColor;\nuniform vec3 witchSkinAccent;\n'+shader.fragmentShader;
            shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
              '#include <map_fragment>\nfloat witchSkinLight=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));\nfloat witchMottle=0.35;\n#ifdef USE_MAP\nwitchMottle=0.5+0.5*sin(vMapUv.x*13.0+sin(vMapUv.y*17.0)*2.2);\n#endif\ndiffuseColor.rgb=mix(witchSkinColor,witchSkinAccent,witchMottle*0.64)*(0.62+witchSkinLight*1.1);');
          };
          material.customProgramCacheKey=()=> 'witch-source-skin-v2';
          if (material.map) material.map.anisotropy=Math.min(2,renderer.capabilities.getMaxAnisotropy());
        }
      });
      const textureBudget=sizeWitchModelTextures(sourceRoot,quality.textureSize);
      texturePixels=textureBudget.texturePixels;sourceTexturePixels=textureBudget.sourcePixels;
      for (const object of imports) object.removeFromParent();
      rig=createHandRig(gltf,report); placement.add(rig.group);
      for(const bone of rig.deformMap.values())if(bone.name.startsWith('thumb_'))manualThumb.push({bone,rotation:new THREE.Quaternion()});
      const geometry=clawGeometry();
      for (let index=0;index<5;index++) {
        const digit=rig.digits[index];
        // Joint scales change the real weighted skin, retaining its original
        // topology and creases. The first scale lengthens the whole chain;
        // later joints taper it, with slight unequal phalanx elongation.
        digit[0].bone.scale.set(index===0?.95:.9,[1.52,1.88,2.08,1.97,1.83][index],.86);
        digit[1].bone.scale.set(.96,1.04,.96);
        digit[2].bone.scale.set(.9,1.07,.92);
        const material=new THREE.MeshPhysicalMaterial({color:DIGIT_COLORS[index],roughness:.32,metalness:.7,
          iridescence:1,iridescenceIOR:1.45,iridescenceThicknessRange:[120,470],
          emissive:DIGIT_COLORS[index],emissiveIntensity:.08});
        const claw=new THREE.Mesh(geometry,material); claw.frustumCulled=false;
        const tip=rig.tips[index]; tip.add(claw); claws.push(claw);
        const anchor=new THREE.Object3D(); anchor.position.set(-.062,.253,0); tip.add(anchor); anchors.push(anchor);
      }
      frame(); loaded=true;
      paintHands([0,1]);status('');
      return true;
    } catch (error) {
      loaded=false;
      if (!disposed) {
        status(`Her hand could not load: ${error.message}`);rig?.dispose();disposeTree(sourceRoot);sourceRoot=null;rig=null;placement.clear();
        renderer?.dispose();renderer?.forceContextLoss();renderer=null;
      }
      return false;
    }
  })();
  return {ready,render,renderPair,setQuality,getTips,getWrist,getPalm,pick,getMetadata,dispose};
}
