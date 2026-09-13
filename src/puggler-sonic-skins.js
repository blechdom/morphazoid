// Stable role IDs keep presets and object controls compatible across eras.
// The labels name theatrical synthesis colors, not historical reconstructions.
const skins={
  punk:{
    names:{guitar:'Guitar',bass:'Bass',oi:'Oi chant',woo:'Woooo',kick:'Kick',snare:'Snare',crash:'Crash',tom:'Tom',hat:'Hi-hat'},
    grit:'Amp filth',gains:{guitar:.38,bass:.53,oi:.8,woo:.75},impact:1,
  },
  history:{
    names:{guitar:'Harpsichord',bass:'Bowed cello',oi:'Opera call',woo:'Opera aria',kick:'Timpani',snare:'Cello pizz.',crash:'Balinese gong',tom:'Hand drum',hat:'Bronze cymbals'},
    grit:'Rosin + quill',gains:{guitar:.65,bass:.78,oi:.8,woo:.8},impact:.85,
  },
  future:{
    names:{guitar:'SIMD goo',bass:'Buzzy sub',oi:'Vocoder call',woo:'Slippery aria',kick:'Volt pulse',snare:'Vector zap',crash:'Plasma bloom',tom:'Goo cell',hat:'Bit swarm'},
    grit:'Filter goo',gains:{guitar:.55,bass:.7,oi:.8,woo:.8},impact:1,
  },
};
export const SONIC_SKINS=Object.freeze(Object.fromEntries(Object.entries(skins).map(([id,skin])=>[
  id,Object.freeze({...skin,id,names:Object.freeze(skin.names),gains:Object.freeze(skin.gains)}),
])));
export function sonicSkin(id='punk') {
  return Object.hasOwn(SONIC_SKINS,id)?SONIC_SKINS[id]:SONIC_SKINS.punk;
}
export function eraPhraseKey(skin,role,owner=0) {
  const id=sonicSkin(skin).id,performer=Number.isInteger(owner)&&owner>=0&&owner<3?owner:0;
  return id==='punk'?role:`${id}:${performer}:${role}`;
}
