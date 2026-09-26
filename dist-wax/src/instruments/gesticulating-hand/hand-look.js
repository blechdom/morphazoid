import { Color } from '../../../vendor/three/three.module.min.js';
import { normalizeHandAppearance } from './hand-model.js';

// Saturated tints multiply the source skin/nail textures. The wheel deliberately
// contains no untinted or pale finish; material detail and surface maps remain.
const COLOR_STOPS = [
  [0,0xb96836],[.17,0xc19a2f],[.38,0x36a87c],[.55,0x368fb8],
  [.76,0x8750bd],[.9,0xc44f88],[1,0xb96836],
].map(([position,hex])=>({position,color:new Color(hex)}));
const LIGHTING = Object.freeze({
  warm: {
    ambient: [0xffe5bb, 0x432326, 1.6],
    key: [0xffbd80, 3.8, -3, 5, 5],
    fill: [0xffd5bc, 1.1, 4, 1, -3],
    rim: [0xff9457, 2.2, -2, 3, -4],
  },
  cool: {
    ambient: [0xc6e3ff, 0x172842, 1.8],
    key: [0xd6f0ff, 3.4, -3, 5, 5],
    fill: [0x668fff, 1.7, 4, 1, -3],
    rim: [0x96f5ff, 2.4, -2, 3, -4],
  },
  noir: {
    ambient: [0xb8c2d0, 0x10121c, .48],
    key: [0xf1e9dd, 4.6, -5, 4, 3],
    fill: [0x6981a1, .28, 4, 1, -3],
    rim: [0xe0edff, 3.4, 3, 4, -4],
  },
  neon: {
    ambient: [0xb4b3ec, 0x261530, 1.0],
    key: [0xff71c8, 3.2, -4, 3, 4],
    fill: [0x56e3ff, 3.2, 4, 1, 3],
    rim: [0x8e6bff, 3.0, -1, 4, -4],
  },
  soft: {
    ambient: [0xf0eced, 0x4d4447, 2.9],
    key: [0xfff0df, 1.6, -3, 5, 5],
    fill: [0xdce6ff, 1.3, 4, 2, 3],
    rim: [0xffffff, .8, -2, 3, -4],
  },
});

export function createHandLook({ meshes, ambient, keyLight, fill, rim }) {
  const materials=[],knownMaterials=new Set(),lights=[ambient,keyLight,fill,rim];
  const originalLights=lights.map(light=>({color:light.color.clone(),groundColor:light.groundColor?.clone(),
    intensity:light.intensity,position:light.position.clone()}));
  const lightStops=[originalLights,...Object.values(LIGHTING).map(rig=>[
    {color:new Color(rig.ambient[0]),groundColor:new Color(rig.ambient[1]),intensity:rig.ambient[2],position:originalLights[0].position},
    ...[rig.key,rig.fill,rig.rim].map((values,index)=>({color:new Color(values[0]),intensity:values[1],
      position:originalLights[index+1].position.clone().set(values[2],values[3],values[4])})),
  ])];
  const tint=new Color();
  let skin=0,lighting=0,disposed=false;
  function updateTint(){
    const upper=COLOR_STOPS.findIndex(stop=>stop.position>=skin),b=COLOR_STOPS[Math.max(1,upper)],a=COLOR_STOPS[Math.max(0,upper-1)];
    if(skin===b.position)tint.copy(b.color);else tint.copy(a.color).lerp(b.color,(skin-a.position)/(b.position-a.position));
  }
  updateTint();
  function addMeshes(nextMeshes){
    if(disposed)return;
    for(const mesh of nextMeshes)for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
      if(!material?.color||knownMaterials.has(material))continue;
      knownMaterials.add(material);const original={material,color:material.color.clone()};materials.push(original);
      material.color.copy(original.color).multiply(tint);
    }
  }
  addMeshes(meshes);
  function apply(value={}){
    if(disposed)return false;
    const next=normalizeHandAppearance(value);let changed=false;
    if(next.skin!==skin){skin=next.skin;updateTint();for(const {material,color} of materials)material.color.copy(color).multiply(tint);changed=true;}
    if(next.lighting!==lighting){
      lighting=next.lighting;const position=lighting*(lightStops.length-1),index=Math.min(lightStops.length-2,Math.floor(position)),mix=position-index;
      lights.forEach((light,i)=>{
        const a=lightStops[index][i],b=lightStops[index+1][i];light.color.copy(a.color).lerp(b.color,mix);
        if(a.groundColor)light.groundColor.copy(a.groundColor).lerp(b.groundColor,mix);
        light.intensity=a.intensity+(b.intensity-a.intensity)*mix;light.position.copy(a.position).lerp(b.position,mix);
      });changed=true;
    }
    return changed;
  }
  function dispose(){
    if(disposed)return;
    for(const {material,color} of materials)material.color.copy(color);
    lights.forEach((light,i)=>{const original=originalLights[i];light.color.copy(original.color);
      if(original.groundColor)light.groundColor.copy(original.groundColor);light.intensity=original.intensity;light.position.copy(original.position);});
    disposed=true;
  }
  return {apply,addMeshes,dispose};
}
