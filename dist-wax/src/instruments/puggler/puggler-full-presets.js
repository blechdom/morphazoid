import { PugglerModel, PROPS, PATTERNS, CASTS, DRUMS, RIFFS, RIDE_PATTERNS, OBJECT_SOUND_CHOICES } from './puggler.js';
import { PAGE_DEFAULTS, PRESETS } from './puggler-presets.js';
import { LIGHTING_SCENES } from './puggler-lighting.js';
import { presetStateKey } from '../../site/header-presets.js';
import { clonePresetData, presetRandom } from '../../site/preset-random.js';

// Scene level is expressive attenuation after the ceiling, not the user's Output.
// Audio, transport, flash consent, reduced motion and clocks are never recalled.
export const SOUND_DEFAULTS=Object.freeze({height:.65,stereo:1,motion:6,flight:.8,impacts:1.25,grit:.82,decay:1,boo:.28,trails:true,skin:'punk',lighting:'house',lightIntensity:.8,lightSpeed:1,sceneGain:.8});
export const MODEL_KEYS=Object.freeze(['count','pattern','tempo','gravity','wind','assist','propIds','drums','riffs','loft','cast','autoRide','phrase','passMode','chaos','posterSeed','ridePattern','rideSpeed','rideRange']);
export const SOUND_KEYS=Object.freeze(Object.keys(SOUND_DEFAULTS));
const bounds={height:[0,1.5],stereo:[0,1],motion:[0,12],flight:[0,1],impacts:[0,2],grit:[0,1],decay:[.2,1],boo:[0,1],lightIntensity:[0,1],lightSpeed:[.2,2.5],sceneGain:[0,1]};
export function capturePugglerPreset(model,params){
  return clonePresetData({version:1,model:Object.fromEntries(MODEL_KEYS.map(k=>[k,model.config[k]])),sound:Object.fromEntries(SOUND_KEYS.map(k=>[k,params[k]]))});
}
export function validatePugglerPreset(snapshot){
  const fail=()=>{throw new TypeError('Invalid complete Puggler scene');};
  presetStateKey(snapshot);
  if(snapshot.version!==1||Object.keys(snapshot).sort().join()!=='model,sound,version')fail();
  for(const [state,keys] of [[snapshot.model,MODEL_KEYS],[snapshot.sound,SOUND_KEYS]]){
    if(!state||Object.keys(state).length!==keys.length||keys.some(k=>!Object.hasOwn(state,k)))fail();
  }
  const m=snapshot.model,s=snapshot.sound;
  for(const [key,choices] of [['propIds',PROPS.map(p=>p.id)],['drums',[...OBJECT_SOUND_CHOICES,...DRUMS]],['riffs',[...OBJECT_SOUND_CHOICES,...RIFFS]]]){
    if(!Array.isArray(m[key])||m[key].length!==10||m[key].some(v=>!choices.includes(v)))fail();
  }
  if(!['punk','history','future'].includes(s.skin)||!LIGHTING_SCENES.some(l=>l.id===s.lighting)||typeof s.trails!=='boolean')fail();
  for(const [key,[min,max]] of Object.entries(bounds))if(typeof s[key]!=='number'||s[key]<min||s[key]>max)fail();
  const canonical=capturePugglerPreset(new PugglerModel(m),s);
  if(presetStateKey(canonical)!==presetStateKey(snapshot))fail();
  return snapshot;
}
export function applyPugglerPreset(model,params,snapshot){
  validatePugglerPreset(snapshot);
  model.apply(clonePresetData(snapshot.model));
  Object.assign(params,snapshot.sound);
  params.tempo=model.config.tempo;
}
const scene=(skin,id,label,actId,sound={},config={})=>{
  const act=PRESETS.find(p=>p.id===actId);
  const m=new PugglerModel({...act.config,...config});
  const s={...SOUND_DEFAULTS,skin,...sound};
  // A soft articulation is not a hidden output-volume cut. Curated scenes
  // share a narrow nominal mix; density is handled in the audio ensemble gain.
  s.sceneGain=.8;s.flight=Math.max(.68,Math.min(.92,s.flight));
  s.impacts=Math.max(.78,Math.min(1.12,s.impacts));s.boo=Math.min(.28,s.boo);
  // Full scenes feature the new prop voices; focused body acts still preserve
  // their authored legacy choir assignments.
  m.apply({riffs:Array(10).fill('object'),drums:Array(10).fill('object')});
  return {id:`${skin}-${id}`,label,description:`${skin} · ${m.config.count} objects · ${m.config.tempo} BPM · ${s.lighting}. Full juggling, sound and lighting scene; Audio, Play and Output are preserved.`,snapshot:validatePugglerPreset(capturePugglerPreset(m,s))};
};
export const PUGGLER_FULL_PRESETS=Object.freeze([
  scene('punk','soundcheck','Punk · Soundcheck / one two three four','bell',{flight:.45,impacts:.6,boo:.1,grit:.25,lighting:'house'}, {count:3,pattern:'cascade',tempo:160,propIds:['cone','club','bowling']}),
  scene('punk','boot','Punk · Boot-stomp solo','roxy',{lighting:'footlights',impacts:1.8,flight:.4}),
  scene('punk','tapes','Punk · Ebow and whammy disco','cassettes',{lighting:'disco',lightSpeed:1.35,grit:1}),
  scene('punk','rats','Punk · Rat-choir blacklight','rats',{lighting:'blacklight',flight:1,impacts:.45,grit:.65}),
  scene('punk','skate','Punk · Skatepark party','skate',{lighting:'party',lightIntensity:1,lightSpeed:1.6,sceneGain:.95}),
  scene('punk','brick','Punk · Slow power-chord wall','heavy',{lighting:'prism',motion:10,height:.2,sceneGain:.7},{tempo:180}),
  scene('punk','nine','Punk · Nine lives / light riot','nine',{lighting:'chaos',lightSpeed:2,lightIntensity:1,grit:1,sceneGain:.9}),
  scene('punk','riot','Punk · 1,200 BPM freakout','metal',{lighting:'strobe',lightIntensity:1,lightSpeed:2.4,impacts:1.8,flight:1}),
  scene('history','bell','History · Bronze after midnight','bell',{lighting:'house',grit:0,impacts:.5,boo:0,height:.2},{tempo:100,propIds:['bell']}),
  scene('history','oud','History · Sitar strings','roxy',{lighting:'sweep',lightSpeed:.35,grit:.1,boo:.1},{propIds:['guitar'],tempo:190}),
  scene('history','quills','History · Alberti bass & trills','cassettes',{lighting:'prism',grit:.2,height:.35},{propIds:['skateboard','cassette','apple'],tempo:420}),
  scene('history','wood','History · Tuba / oboe courtyard','columns',{lighting:'footlights',flight:.4,impacts:1.6,boo:.2},{propIds:['boot','balloon'],tempo:280}),
  scene('history','choir','History · Opera, cak & chamber laughter','rats',{lighting:'aurora',lightSpeed:.4,impacts:.3,boo:.1},{count:5,pattern:'many-5',propIds:['deadcat','axe','plushrat','skull','mic']}),
  scene('history','world','History · Sitar / tabla / plucked zither','gutter-buffet',{lighting:'disco',grit:.2,height:.3},{propIds:['guitar','can','fish','plant'],tempo:530}),
  scene('history','strings','History · Bowed procession','curbside-requiem',{lighting:'blacklight',impacts:.4,flight:1,grit:0},{propIds:['violin','skull','snake','deadcat'],tempo:220}),
  scene('history','rave','History · Detuned bronze & cave rave','eight',{lighting:'party',lightIntensity:1,impacts:1.7,grit:.4},{propIds:['ball','can','skull','bell','bowling','guitar','plant','violin']}),
  scene('future','drift','Future · Octopus aether','moss',{lighting:'aurora',lightSpeed:.25,impacts:.2,boo:0,grit:.1,height:1.2},{count:3,pattern:'cascade',propIds:['fish','violin','balloon'],tempo:110}),
  scene('future','laser','Future · Photon punks','cassettes',{lighting:'lasers',lightIntensity:1,grit:.9,height:1.1},{propIds:['guitar','axe','glowstick'],tempo:600}),
  scene('future','radio','Future · Alien pirate radio','rats',{lighting:'blacklight',flight:1,impacts:.3,sceneGain:.6},{propIds:['mic','duck','skull']}),
  scene('future','vacuum','Future · Dark-matter duet','puggler-moss',{lighting:'prism',lightSpeed:.45,height:.1,grit:.5},{propIds:['bowling','plunger','ball'],tempo:170}),
  scene('future','disco','Future · Orbital disco','seven',{lighting:'disco',lightSpeed:1.7,grit:.6},{propIds:['vinyl','cd','bell','banana','club','skull','fish']}),
  scene('future','packets','Future · Packet storm','bootleg-bin',{lighting:'party',lightSpeed:2.1,height:.9,grit:.85},{tempo:720}),
  scene('future','strobe','Future · Do not reboot','nine',{lighting:'strobe',lightIntensity:1,flight:1,grit:.95},{tempo:1000}),
  scene('future','warp','Future · Ten-object wormhole','metal',{lighting:'chaos',lightSpeed:2.5,lightIntensity:1,height:1.4,impacts:1.9}),
]);

export function randomizePugglerPreset(current,random=Math.random){
  validatePugglerPreset(current);
  const r=presetRandom(random),count=r.unit()<.7?r.integer(5,10):r.integer(2,4),pattern=r.pick(PATTERNS.filter(p=>p.count===count));
  const ownOrAssigned=()=>r.unit()<.8?'object':r.pick(OBJECT_SOUND_CHOICES.slice(1));
  const config={...PAGE_DEFAULTS,count,pattern:pattern.id,tempo:r.integer(140,1000),gravity:r.between(.45,1.65),wind:r.between(-12,12),assist:r.integer(70,120),
    propIds:Array.from({length:10},()=>r.pick(PROPS).id),drums:Array.from({length:10},()=>ownOrAssigned()),riffs:Array.from({length:10},()=>ownOrAssigned()),
    loft:r.between(.6,3),cast:r.pick(CASTS).id,autoRide:r.unit()<.8,phrase:r.pick(['loop','verse','evolve']),passMode:r.pick(['every','three','phrase']),chaos:r.integer(0,28),
    posterSeed:r.integer(0,0xffffffff),ridePattern:r.pick(RIDE_PATTERNS),rideSpeed:r.between(0,2.5),rideRange:r.between(0,100)};
  const sound={...SOUND_DEFAULTS,skin:r.pick(['punk','history','future']),lighting:r.pick(LIGHTING_SCENES).id,trails:r.unit()<.7};
  for(const [key,[min,max]] of Object.entries(bounds))sound[key]=r.between(min,max);
  // Keep dice playable but leave the entire range available to manual controls.
  sound.sceneGain=.77+.06*sound.sceneGain;sound.lightIntensity=.35+.65*sound.lightIntensity;
  sound.flight=.7+.2*sound.flight;sound.impacts=.8+.16*sound.impacts;sound.boo=.12+.18*sound.boo;
  sound.grit=sound.skin==='history'?.08+.27*sound.grit:sound.skin==='punk'?.55+.4*sound.grit:.3+.7*sound.grit;
  return validatePugglerPreset(capturePugglerPreset(new PugglerModel(config),sound));
}
