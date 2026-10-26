import { witchSpiderQuality, sizeWitchModelTextures } from './witch-model-display.js';

/** Spider Synth's King Baboon tarantula, rendered once at rest and on touch only.
 * Auckland Museum, CC BY 4.0; model credits and modifications in docs/witch.md. */
export function createWitchSpider(doc=document,{quality:initialQuality={},onInvalidate=()=>{}}={}) {
  let quality=witchSpiderQuality(initialQuality);
  const canvas=doc.createElement('canvas'),surface=doc.createElement('canvas'),context=surface.getContext('2d');
  canvas.width=canvas.height=surface.width=surface.height=quality.size;
  const abort=new AbortController();
  let renderer,scene,camera,model,bones=[],disposed=false,lost=false,dirty=true,lastPulse=-1,lastTime=-1,lastRender=0,renderCount=0,texturePixels=0;
  const ready=(async()=>{
    try {
      const [THREE,{GLTFLoader},{MeshoptDecoder}]=await Promise.all([
        import('../../../vendor/three/three.module.min.js'),
        import('../../../vendor/three/loaders/GLTFLoader.js'),
        import('../../../vendor/meshoptimizer/meshopt_decoder.module.js'),
      ]);
      if(disposed)return false;
      // The picture keeps a small 2D snapshot, so the GPU need not preserve a
      // second drawing buffer for a spider that is usually completely still.
      renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
      renderer.setPixelRatio(1);renderer.setSize(quality.size,quality.size,false);renderer.setClearColor(0,0);
      renderer.outputColorSpace=THREE.SRGBColorSpace;
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;},{signal:abort.signal});
      canvas.addEventListener('webglcontextrestored',()=>{lost=false;dirty=true;render(lastPulse,lastTime);onInvalidate();},{signal:abort.signal});
      scene=new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xd6ddff,0x23112d,2));
      const light=new THREE.DirectionalLight(0xffc7a1,3);light.position.set(-2,3,2);scene.add(light);
      const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(new URL('../../../assets/witch/tarantula-512.glb',import.meta.url).href);
      model=gltf.scene;
      if(disposed){releaseModel();return false;}
      texturePixels=sizeWitchModelTextures(model,512,doc).texturePixels;
      scene.add(model);model.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(model),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
      const radius=Math.max(size.x,size.z,size.y)*.62;
      camera=new THREE.OrthographicCamera(-radius,radius,radius,-radius,.001,radius*10);
      camera.position.set(center.x,center.y+radius*3,center.z+radius*.5);camera.lookAt(center);
      model.traverse(node=>{if(node.isBone)bones.push({node,base:node.quaternion.clone()});});
      render(0,0);return true;
    }catch {releaseModel();renderer?.dispose();renderer?.forceContextLoss();renderer=null;return false;}
  })();
  function releaseModel() {
    const textures=new Set(),materials=new Set(),geometries=new Set(),skeletons=new Set();
    model?.traverse(node=>{if(node.geometry)geometries.add(node.geometry);if(node.skeleton)skeletons.add(node.skeleton);
      for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
    textures.forEach(texture=>{texture.source?.data?.close?.();texture.dispose();});materials.forEach(value=>value.dispose());
    geometries.forEach(value=>value.dispose());skeletons.forEach(value=>value.dispose());model?.removeFromParent();model=null;bones=[];
  }
  function setQuality(value={}) {quality=witchSpiderQuality({...quality,...value});dirty=true;}
  function render(pulse=0,time=0) {
    if(disposed||!model||!renderer)return null;
    if(lost)return surface;
    const now=performance.now();
    if(!dirty&&((pulse===0&&lastPulse===0)||(pulse===lastPulse&&time===lastTime)))return surface;
    // Never throttle the first touch or the return to rest; duplicate state
    // reads and moving snapshots within one display frame are coalesced.
    if(!dirty&&pulse>0&&lastPulse>0&&now-lastRender<quality.frameInterval)return surface;
    if(canvas.width!==quality.size)renderer.setSize(quality.size,quality.size,false);
    if(surface.width!==quality.size)surface.width=surface.height=quality.size;
    for(let i=0;i<bones.length;i++){const {node,base}=bones[i];node.quaternion.copy(base);if(i>5)node.rotateZ(Math.sin(time*23+i*1.9)*pulse*.065);}
    renderer.render(scene,camera);
    context.clearRect(0,0,surface.width,surface.height);context.drawImage(canvas,0,0);
    lastPulse=pulse;lastTime=time;lastRender=now;renderCount++;dirty=false;return surface;
  }
  function getMetadata(){return {loaded:Boolean(model&&!disposed&&!lost),quality:{...quality},renderCount,texturePixels,
    bufferSize:[canvas.width,canvas.height],preserveDrawingBuffer:false,webglContexts:renderer?1:0};}
  return {ready,render,setQuality,getMetadata,dispose(){
    if(disposed)return;disposed=true;abort.abort();releaseModel();renderer?.dispose();renderer?.forceContextLoss();renderer=null;
    canvas.width=canvas.height=surface.width=surface.height=1;
  }};
}
