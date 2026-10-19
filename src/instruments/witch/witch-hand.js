import * as THREE from '../../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../../vendor/three/loaders/GLTFLoader.js';
import { createHandRig } from '../gesticulating-hand/hand-rig.js';

// Runtime adaptation of Elena FF's "Rigged hand", the same skinned source used
// by Gesticules. Model/derived model appearance: CC BY-SA 4.0. Original source:
// https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e
// This separately authored viewer/controller implementation is MIT.
const MODEL = new URL('../../../assets/gesticulating-hand/hand.glb', import.meta.url);
const REPORT = new URL('../../../assets/gesticulating-hand/rig-report.json', import.meta.url);
const WIDTH = 1000, HEIGHT = 720;
const DIGIT_COLORS = [0xe7a574,0xdfcf83,0x83c6b4,0x87aadb,0xc3a0d1];
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

/** The caller owns the animation clock and draws the returned transparent
 * canvas into its world. All returned points use canonical 1000×720 pixels. */
export function createWitchHand({onStatus = () => {}} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const abort = new AbortController();
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-500,500,360,-360,.1,4000);
  camera.position.set(0,0,1000); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
  const placement = new THREE.Group(); scene.add(placement);
  const ambient = new THREE.HemisphereLight(0xe3e8cc,0x292434,1.7); scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffedd2,3.2); key.position.set(-350,550,600); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fbbce,1.35); fill.position.set(350,100,400); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xc6e5a1,2.1); rim.position.set(100,350,-450); scene.add(rim);
  const projected = new THREE.Vector3(), temporary = new THREE.Vector3();
  let renderer = null, rig = null, loaded = false, disposed = false, lost = false;
  let renderSignature='',lastRender=0;
  let latestState = {}, projectedTips = [], projectedWrist = {x:590,y:590};
  let vertices = 0, triangles = 0, sourceRoot = null;
  const claws = [], anchors = [];

  function status(message) { if (!disposed) onStatus(message); }
  function project(object, index) {
    object.getWorldPosition(projected).project(camera);
    return {x:(projected.x+1)*WIDTH/2,y:(1-projected.y)*HEIGHT/2,...(index===undefined?{}:{index})};
  }
  function pose(state) {
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
  function update(state) {
    rig.setPose(pose(state));
    for (let index = 0; index < claws.length; index++) {
      const level = clamp(state.fingerLevels?.[index]);
      claws[index].material.emissiveIntensity = level*.7;
      claws[index].material.roughness = .38-level*.15;
    }
    placement.updateMatrixWorld(true);
    for (const mesh of rig.meshes) mesh.skeleton?.update();
    projectedTips = anchors.map((anchor,index)=>project(anchor,index));
    projectedWrist = project(rig.wrist);
  }
  function frame() {
    placement.rotation.set(.08,Math.PI-.18,-.035);
    rig.setPose(pose({fingers:[0,0,0,0,0]}));
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
    placement.updateMatrixWorld(true);
  }
  function render(state = {}) {
    latestState = state;
    if (!loaded || disposed || lost || !renderer) return canvas;
    const signature=JSON.stringify([state.fingers,state.fingerLevels?.map(v=>Math.round(v*24))]);
    const now=performance.now();
    if(signature===renderSignature || (now-lastRender<32 && renderSignature)) return canvas;
    update(state);
    renderer.render(scene,camera);
    renderSignature=signature;lastRender=now;
    return canvas;
  }
  function getTips() { return loaded && !lost && !disposed ? projectedTips.map(point=>({...point})) : []; }
  function getWrist() { return {...projectedWrist}; }
  function pick(x,y,radius=46) {
    if (!loaded || lost || disposed || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    let hit = null, distance = clamp(radius,8,160);
    for (const point of projectedTips) {
      const d = Math.hypot(x-point.x,y-point.y);
      if (d <= distance) { hit={type:'finger',index:point.index}; distance=d; }
    }
    return hit;
  }
  function getMetadata() {
    return {
      loaded:loaded && !disposed && !lost,
      source:'assets/gesticulating-hand/hand.glb',
      modelUrl:MODEL.href,
      author:'Elena FF', title:'Rigged hand', license:'CC BY-SA 4.0',
      vertices,triangles,deformBones:rig?.deformMap.size??0,
      runtimeAdapted:true,claws:claws.length,
    };
  }
  function dispose() {
    if (disposed) return;
    disposed=true; loaded=false; abort.abort();
    rig?.dispose(); disposeTree(sourceRoot); sourceRoot=null;
    placement.clear(); projectedTips=[];
    renderer?.dispose(); renderer?.forceContextLoss(); renderer=null;
  }
  const ready = (async () => {
    try {
      renderer = new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});
      renderer.setPixelRatio(1); renderer.setSize(WIDTH,HEIGHT,false);
      renderer.setClearColor(0x000000,0); renderer.outputColorSpace=THREE.SRGBColorSpace;
      renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.12;
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;status('The hand view was interrupted. Finger controls remain available.');},{signal:abort.signal});
      canvas.addEventListener('webglcontextrestored',()=>{lost=false;renderSignature='';render(latestState);status('');},{signal:abort.signal});
      status('Loading her Gesticules hand…');
      const [modelResponse,reportResponse] = await Promise.all([
        fetch(MODEL,{signal:abort.signal}),fetch(REPORT,{signal:abort.signal}),
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
          // Keep the source skin, nails, pores, and normal maps under a witch tint.
          material.color.set(0xffffff); material.roughness=.76; material.metalness=0;
          material.onBeforeCompile=shader=>{
            shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
              '#include <map_fragment>\nfloat witchSkinLight=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));\ndiffuseColor.rgb=vec3(0.38,0.54,0.29)*(0.5+witchSkinLight*0.9);');
          };
          material.customProgramCacheKey=()=> 'witch-source-skin-v1';
          if (material.map) material.map.anisotropy=Math.min(2,renderer.capabilities.getMaxAnisotropy());
        }
      });
      for (const object of imports) object.removeFromParent();
      rig=createHandRig(gltf,report); placement.add(rig.group);
      const geometry=clawGeometry();
      for (let index=0;index<5;index++) {
        const digit=rig.digits[index];
        // Joint scales change the real weighted skin, retaining its original
        // topology and creases. The first scale lengthens the whole chain;
        // later joints taper it, with slight unequal phalanx elongation.
        digit[0].bone.scale.set(index===0?.95:.9,[1.52,1.88,2.08,1.97,1.83][index],.86);
        digit[1].bone.scale.set(.96,1.04,.96);
        digit[2].bone.scale.set(.9,1.07,.92);
        const material=new THREE.MeshStandardMaterial({color:0x251b2f,roughness:.38,metalness:.16,emissive:DIGIT_COLORS[index],emissiveIntensity:0});
        const claw=new THREE.Mesh(geometry,material); claw.frustumCulled=false;
        const tip=rig.tips[index]; tip.add(claw); claws.push(claw);
        const anchor=new THREE.Object3D(); anchor.position.set(-.062,.253,0); tip.add(anchor); anchors.push(anchor);
      }
      frame(); loaded=true; render(latestState); status('');
      return true;
    } catch (error) {
      loaded=false;
      if (!disposed) { status(`Her hand could not load: ${error.message}`); rig?.dispose(); disposeTree(sourceRoot); sourceRoot=null; placement.clear(); }
      return false;
    }
  })();
  return {ready,render,getTips,getWrist,pick,getMetadata,dispose};
}
