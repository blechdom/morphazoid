// Display budgets belong to the model snapshots, never the musical clock or
// canonical 1000×720 projection used by fingers, palm, wrist and hit testing.
const clamp=(value,low,high,fallback=low)=>Math.max(low,Math.min(high,Number.isFinite(value)?value:fallback));
const FINGER_KEYS=['mcp','pip','dip','spread'],JOINT_KEYS=FINGER_KEYS.slice(0,3),WRIST_KEYS=['flex','side','twist'];
export function witchHandQuality(value={}) {
  return {maxWidth:Math.round(clamp(value.maxWidth,128,800,800)),
    frameInterval:clamp(value.frameInterval,0,100,50),
    textureSize:Math.round(clamp(value.textureSize,256,2048,1024))};
}
export function witchSpiderQuality(value={}) {
  return {size:Math.round(clamp(value.size,96,224,224)),frameInterval:clamp(value.frameInterval,0,100,50)};
}
export function witchHandSurfaceSize(scale,renderScale=1,maxWidth=800) {
  // A little oversampling retains the original nails/creases. Quantized sizes
  // avoid reallocating the shared buffer on every flight-transition frame.
  const width=Math.min(maxWidth,Math.max(128,Math.ceil(1000*clamp(scale,.05,2,1)*clamp(renderScale,.25,2,1)*1.1/32)*32));
  return {width,height:Math.round(width*.72)};
}

/** Compare actual rig inputs without allocating/serializing whole poses. */
export function createWitchHandPaintCache() {
  const previous=new Float64Array(48);let valid=false;
  return {
    invalidate(){valid=false;},
    get valid(){return valid;},
    update(pose,levels,width,manualMask=0){
      let at=0,changed=!valid;
      const take=value=>{const next=Number.isFinite(value)?value:0;if(previous[at]!==next)changed=true;previous[at++]=next;};
      take(width);take(manualMask);
      for(let i=0;i<5;i++)for(const key of FINGER_KEYS)take(pose.fingers[i][key]);
      for(const key of WRIST_KEYS)take(pose.wrist[key]);
      take(pose.source?1:0);take(pose.source?.phase);take(pose.source?.amount);
      for(let i=0;i<5;i++)for(const key of JOINT_KEYS)take(pose.source?.offsets?.[i]?.[key]);
      for(let i=0;i<5;i++)take(Math.round(clamp(levels?.[i],0,1)*24));
      valid=true;return changed;
    },
  };
}

/** Keep the native skin/materials but upload only useful texture detail. Shared
 * sources (e.g. roughness/metalness) are resized once and stay shared. */
export function sizeWitchModelTextures(root,maxSize,doc=document) {
  const textures=new Set(),sources=new Map();
  root?.traverse(node=>{
    for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[])
      for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
  });
  for(const texture of textures)if(texture.source?.data&&!sources.has(texture.source))sources.set(texture.source,texture.source.data);
  let sourcePixels=0,texturePixels=0;const resized=new Map();
  for(const [source,image] of sources) {
    const width=image.width??image.naturalWidth,height=image.height??image.naturalHeight;
    if(!(width>0&&height>0))continue;
    sourcePixels+=width*height;
    if(Math.max(width,height)>maxSize) {
      let surface=resized.get(image);
      if(!surface){
        const scale=maxSize/Math.max(width,height);surface=doc.createElement('canvas');
        surface.width=Math.max(1,Math.round(width*scale));surface.height=Math.max(1,Math.round(height*scale));
        const context=surface.getContext('2d');
        if(context){context.drawImage(image,0,0,surface.width,surface.height);resized.set(image,surface);}
        else surface=null;
      }
      if(surface)source.data=surface;
    }
    texturePixels+=source.data.width*source.data.height;
  }
  for(const image of resized.keys())image.close?.();
  for(const texture of textures)if(texture.source?.data!==sources.get(texture.source))texture.needsUpdate=true;
  return {sourcePixels,texturePixels};
}
