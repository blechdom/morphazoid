// Stable role IDs keep presets and object controls compatible across eras.
// The labels name theatrical synthesis colors, not historical reconstructions.
const skins={
  punk:{
    names:{guitar:'Guitar',bass:'Bass',oi:'Oi chant',woo:'Woooo',kick:'Kick',snare:'Snare',crash:'Crash',tom:'Tom',hat:'Hi-hat'},
    grit:'Amp filth',gains:{guitar:.38,bass:.53,oi:.8,woo:.75},impact:1,
  },
  history:{
    names:{guitar:'Twang / keys',bass:'Acoustic bass',oi:'Earth chant',woo:'Chamber voice',kick:'Frame drum',snare:'Tabor',crash:'Bronze gong',tom:'Log drum',hat:'Finger cymbals'},
    grit:'String bite',gains:{guitar:.65,bass:.78,oi:.8,woo:.8},impact:.85,
  },
  future:{
    names:{guitar:'Liquid lead',bass:'Cyber bass',oi:'Cyber call',woo:'Octopus opera',kick:'Sub kick',snare:'Laser clap',crash:'Splash crash',tom:'Water tom',hat:'Glitch hat'},
    grit:'Cyber grit',gains:{guitar:.55,bass:.7,oi:.8,woo:.8},impact:1,
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
