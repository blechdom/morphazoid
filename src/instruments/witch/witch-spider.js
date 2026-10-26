/** The actual Spider Synth specimen, rendered once at rest and on touch only. */
export function createWitchSpider(doc=document) {
  const canvas=doc.createElement('canvas');canvas.width=canvas.height=224;
  let renderer,scene,camera,model,bones=[],disposed=false,lastPulse=-1;
  const ready=(async()=>{
    try {
      const [THREE,{GLTFLoader},{MeshoptDecoder}]=await Promise.all([
        import('../../../vendor/three/three.module.min.js'),
        import('../../../vendor/three/loaders/GLTFLoader.js'),
        import('../../../vendor/meshoptimizer/meshopt_decoder.module.js'),
      ]);
      if(disposed)return false;
      renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
      renderer.setSize(224,224,false);renderer.setClearColor(0,0);
      renderer.outputColorSpace=THREE.SRGBColorSpace;
      scene=new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xd6ddff,0x23112d,2));
      const light=new THREE.DirectionalLight(0xffc7a1,3);light.position.set(-2,3,2);scene.add(light);
      const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(new URL('../../../assets/spider-synth/spider-phone.glb',import.meta.url).href);
      model=gltf.scene;
      if(disposed){releaseModel();return false;}
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
    geometries.forEach(value=>value.dispose());skeletons.forEach(value=>value.dispose());model=null;bones=[];
  }
  function render(pulse,time) {
    if(disposed||!model||!renderer)return null;
    if(pulse===0&&lastPulse===0)return canvas;
    for(let i=0;i<bones.length;i++){const {node,base}=bones[i];node.quaternion.copy(base);if(i>5)node.rotateZ(Math.sin(time*23+i*1.9)*pulse*.065);}
    renderer.render(scene,camera);lastPulse=pulse;return canvas;
  }
  return {ready,render,dispose(){disposed=true;releaseModel();renderer?.dispose();renderer?.forceContextLoss();renderer=null;}};
}
