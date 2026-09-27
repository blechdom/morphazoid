import * as THREE from '../../../vendor/three/three.module.min.js';

const clampAmount=value=>Math.max(0,Math.min(1,Number(value)||0));
const ALPHA_FLOOR=1/256;

export function handTrailTiming(value) {
  const amount=clampAmount(value),halfLifeMs=60+440*amount*amount;
  return {amount,halfLifeMs,maxTailMs:amount?halfLifeMs*8:0,strength:.72*amount};
}

export function handTrailSize(width,height,compact=false) {
  const w=Math.max(1,Math.floor(Number(width)||1)),h=Math.max(1,Math.floor(Number(height)||1));
  const scale=Math.min(1,960/Math.max(w,h),Math.sqrt((compact?180000:300000)/(w*h)));
  return [Math.max(1,Math.floor(w*scale)),Math.max(1,Math.floor(h*scale))];
}

const vertexShader=`
  varying vec2 vUv;
  void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}
`;

/** Bounded, linear-light history beneath the ordinary full-resolution model.
 * The two small targets contain anatomy only; selectable markers stay live.
 * Wall time owns decay, independently of the motion/audio transport clock.
 */
export function createHandTrails(renderer) {
  const camera=new THREE.Camera(),scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2);
  const copy=new THREE.ShaderMaterial({vertexShader,depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:{history:{value:null},decay:{value:0}},
    fragmentShader:`
      uniform sampler2D history;
      uniform float decay;
      varying vec2 vUv;
      void main(){
        vec4 old=texture2D(history,vUv);
        float alpha=old.a*decay;
        gl_FragColor=vec4(old.rgb,alpha<${ALPHA_FLOOR}?0.0:alpha);
      }
    `,
  });
  const display=new THREE.ShaderMaterial({vertexShader,depthTest:false,depthWrite:false,transparent:true,
    uniforms:{history:{value:null},strength:{value:0}},
    fragmentShader:`
      uniform sampler2D history;
      uniform float strength;
      varying vec2 vUv;
      void main(){
        vec4 old=texture2D(history,vUv);
        gl_FragColor=vec4(old.rgb,old.a*strength);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const quad=new THREE.Mesh(geometry,copy);quad.frustumCulled=false;scene.add(quad);
  const bufferSize=new THREE.Vector2(),clearColor=new THREE.Color();
  const type=renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType;
  let timing=handTrailTiming(0),targets=[],size=[0,0],history=false,pending=false,disposed=false;
  let lastMotion=-Infinity,lastFrame=-Infinity;

  function clear() {history=false;pending=false;lastMotion=lastFrame=-Infinity;}
  function release() {for(const target of targets)target.dispose();targets=[];size=[0,0];clear();}
  function setAmount(value) {
    const next=handTrailTiming(value),enabled=!timing.amount&&next.amount;timing=next;
    if(!timing.amount)release();else if(enabled)pending=true;
  }
  function changed(){if(timing.amount&&!disposed)pending=true;}
  function hasTail(now=performance.now()){return !disposed&&timing.amount>0&&(pending||now-lastMotion<timing.maxTailMs);}
  function allocate() {
    renderer.getDrawingBufferSize(bufferSize);
    const canvas=renderer.domElement,next=handTrailSize(bufferSize.x,bufferSize.y,Math.min(canvas.clientWidth,canvas.clientHeight)<400);
    if(size[0]===next[0]&&size[1]===next[1])return;
    for(const target of targets)target.dispose();size=next;history=false;
    targets=Array.from({length:2},()=>new THREE.WebGLRenderTarget(...size,{type,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
      depthBuffer:true,stencilBuffer:false,generateMipmaps:false}));
  }
  function render(modelScene,modelCamera,markers,now=performance.now()) {
    if(disposed||!timing.amount)return false;
    if(now-lastFrame>timing.maxTailMs)history=false;
    if(pending){lastMotion=now;pending=false;}
    if(!hasTail(now)){clear();return false;}
    allocate();
    const decay=history?Math.pow(.5,Math.max(0,now-lastFrame)/timing.halfLifeMs):0;
    const [read,write]=targets,priorTarget=renderer.getRenderTarget(),autoClear=renderer.autoClear;
    const clearAlpha=renderer.getClearAlpha(),markersVisible=markers.visible;renderer.getClearColor(clearColor);
    try {
      // Reuse the previous color but decay its coverage. Fresh anatomy replaces
      // older poses where they overlap, keeping each afterimage legible.
      renderer.setRenderTarget(write);renderer.setClearColor(0,0);renderer.clear();renderer.autoClear=false;
      if(history){quad.material=copy;copy.uniforms.history.value=read.texture;copy.uniforms.decay.value=decay;renderer.render(scene,camera);}
      renderer.clearDepth();markers.visible=false;renderer.render(modelScene,modelCamera);markers.visible=markersVisible;

      renderer.setRenderTarget(priorTarget);renderer.setClearColor(clearColor,clearAlpha);renderer.clear();
      quad.material=display;display.uniforms.history.value=write.texture;display.uniforms.strength.value=timing.strength;
      renderer.render(scene,camera);renderer.clearDepth();renderer.render(modelScene,modelCamera);
      targets=[write,read];history=true;lastFrame=now;
    } finally {
      markers.visible=markersVisible;renderer.setRenderTarget(priorTarget);renderer.setClearColor(clearColor,clearAlpha);renderer.autoClear=autoClear;
    }
    return true;
  }
  function dispose(){if(disposed)return;release();disposed=true;copy.dispose();display.dispose();geometry.dispose();}
  return {setAmount,changed,hasTail,clear,render,dispose,
    getState:()=>({amount:timing.amount,history,tail:hasTail(),resources:targets.length,size:[...size],maxTailMs:timing.maxTailMs})};
}
