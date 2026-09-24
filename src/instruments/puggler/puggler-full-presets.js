import { PugglerModel, PROPS, PATTERNS, CASTS, DRUMS, RIFFS, RIDE_PATTERNS, OBJECT_SOUND_CHOICES } from './puggler.js';
import { PAGE_DEFAULTS, PRESETS } from './puggler-presets.js';
import { LIGHTING_SCENES } from './puggler-lighting.js';
import { presetStateKey } from '../../site/header-presets.js';
import { clonePresetData, presetRandom } from '../../site/preset-random.js';

// Scene level is expressive attenuation after the ceiling, not the user's Output.
// Audio, transport, flash consent, reduced motion and clocks are never recalled.
export const SOUND_DEFAULTS=Object.freeze({height:.65,stereo:1,motion:6,flight:.8,impacts:1.25,grit:.82,decay:1,boo:.28,drops:.7,trails:true,skin:'punk',lighting:'house',lightIntensity:.8,lightSpeed:1,sceneGain:.8});
export const MODEL_KEYS=Object.freeze(['count','pattern','tempo','gravity','wind','assist','propIds','drums','riffs','loft','cast','autoRide','phrase','passMode','chaos','posterSeed','ridePattern','rideSpeed','rideRange']);
export const SOUND_KEYS=Object.freeze(Object.keys(SOUND_DEFAULTS));
const bounds={height:[0,1.5],stereo:[0,1],motion:[0,12],flight:[0,1],impacts:[0,2],grit:[0,1],decay:[.2,1],boo:[0,3],drops:[0,1],lightIntensity:[0,1],lightSpeed:[.2,2.5],sceneGain:[0,1]};
export function capturePugglerPreset(model,params){
  return clonePresetData({version:2,model:Object.fromEntries(MODEL_KEYS.map(k=>[k,model.config[k]])),sound:Object.fromEntries(SOUND_KEYS.map(k=>[k,params[k]]))});
}
export function validatePugglerPreset(snapshot){
  const fail=()=>{throw new TypeError('Invalid complete Puggler scene');};
  presetStateKey(snapshot);
  // Migrate only the old exact sound shape; unknown/incomplete state still fails.
  if(snapshot.version===1&&snapshot.sound&&!Object.hasOwn(snapshot.sound,'drops')){
    snapshot=clonePresetData(snapshot);snapshot.version=2;snapshot.sound.drops=SOUND_DEFAULTS.drops;
  }
  if(snapshot.version!==2||Object.keys(snapshot).sort().join()!=='model,sound,version')fail();
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
  snapshot=validatePugglerPreset(snapshot);
  model.apply(clonePresetData(snapshot.model));
  Object.assign(params,snapshot.sound);
  params.tempo=model.config.tempo;
}
const scene=(skin,id,label,actId,sound={},config={})=>{
  const act=PRESETS.find(p=>p.id===actId);
  if(config.pattern&&!PATTERNS.some(p=>p.id===config.pattern&&p.count===(config.count??act.config.count)))throw new TypeError(`Invalid scene pattern: ${id}`);
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
const SCENES=[
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
  scene('punk','suspended','Punk · Ebow tightrope / still wheels','bell',{lighting:'aurora',grit:.58,height:0,motion:0,decay:.9,stereo:.3},{cast:'puggler',count:1,pattern:'single',phrase:'loop',tempo:110,loft:3,gravity:.65,rideSpeed:0,chaos:0,propIds:['cassette']}),
  scene('history','gongspace','History · Two detuned gongs / long breaths','bell',{lighting:'prism',grit:0,height:0,motion:.8,decay:1,stereo:1},{cast:'roxy-moss',count:2,pattern:'two-shower',phrase:'loop',tempo:130,loft:2.9,gravity:.65,rideSpeed:.15,rideRange:80,chaos:0,propIds:['ball','bell']}),
  scene('future','pindrop','Future · One underwater beacon','bell',{lighting:'blacklight',grit:.2,height:1.4,motion:9,decay:1},{cast:'moss',count:1,pattern:'single',phrase:'evolve',tempo:100,loft:3,rideSpeed:.12,ridePattern:'sweep',chaos:0,propIds:['fish']}),
  scene('punk','lowrider','Punk · Lowrider bass / fast wheels','roxy',{lighting:'footlights',grit:.72,height:.05,decay:.35,stereo:.25},{count:3,pattern:'cascade',phrase:'loop',tempo:160,loft:.6,rideSpeed:2.5,ridePattern:'double-step',rideRange:75,chaos:0,propIds:['ball','can','boot']}),
  scene('history','cak','History · Cak call / tabla answer','rats',{lighting:'sweep',grit:.08,height:.15,decay:.35},{cast:'puggler-moss',count:4,pattern:'fountain',phrase:'loop',passMode:'three',tempo:480,loft:1.1,rideSpeed:.65,ridePattern:'double-step',propIds:['axe','can','mic','skull'],chaos:2}),
  scene('future','counterflow','Future · Slow notes / racing satellites','columns',{lighting:'lasers',height:1.5,motion:12,grit:.7,decay:.35},{count:4,pattern:'sync-fountain',phrase:'loop',tempo:170,loft:.75,wind:9,rideSpeed:2.4,ridePattern:'surge',rideRange:85,chaos:2}),
  scene('punk','pocket','Punk · Kick / snare / bass pocket','ballet',{lighting:'disco',height:0,motion:2,grit:.8,decay:.5},{count:4,pattern:'fountain',phrase:'loop',tempo:420,loft:1.05,cast:'trio',passMode:'three',rideSpeed:1,ridePattern:'double-step',chaos:0,propIds:['ball','can','club','boot']}),
  scene('history','salon','History · Harpsichord salon / Alberti & trills','cassettes',{lighting:'house',height:0,motion:1,grit:0,stereo:.35,decay:.6},{cast:'roxy',count:3,pattern:'cascade',phrase:'evolve',tempo:380,loft:1.2,rideSpeed:.3,rideRange:25,chaos:0,propIds:['skateboard','apple','cassette']}),
  scene('future','radar','Future · Doppler radar / four-way ping','columns',{lighting:'prism',height:1.5,motion:12,grit:.45,stereo:1,decay:.2},{cast:'puggler-moss',count:4,pattern:'sync-fountain',phrase:'loop',passMode:'every',tempo:440,loft:2.8,rideSpeed:1.5,ridePattern:'sweep',wind:-8,chaos:1}),
  scene('punk','choke','Punk · Choked guitars / doubled fists','columns',{lighting:'party',grit:1,height:.1,motion:9,decay:.2,stereo:.6},{cast:'puggler-roxy',count:4,pattern:'sync-fountain',phrase:'loop',tempo:700,loft:.6,rideSpeed:.45,ridePattern:'lurch',propIds:['guitar','axe','can','bottle'],chaos:0}),
  scene('history','chamber','History · Bow, harp & oboe chamber','ballet',{lighting:'aurora',grit:0,height:.2,motion:3,decay:1,stereo:.8},{count:5,pattern:'many-5',phrase:'loop',passMode:'phrase',tempo:240,loft:2.3,gravity:.6,rideSpeed:.35,ridePattern:'sweep',propIds:['violin','snake','balloon','boot','bottle'],chaos:0}),
  scene('future','stutter','Future · Packet hiccups / reverse scatter','bootleg-bin',{lighting:'party',grit:.85,height:.6,motion:12,decay:.2},{count:5,pattern:'many-5',phrase:'evolve',tempo:820,loft:.65,gravity:1.6,rideSpeed:1.6,ridePattern:'lurch',propIds:['vhs','cd','vinyl','pickle','mic'],chaos:7}),
  scene('punk','hecklers','Punk · Whoops / hecklers at the bar','gutter-buffet',{lighting:'footlights',grit:.68,height:.3,boo:.28,drops:.85,decay:.55},{count:6,pattern:'many-6',phrase:'verse',tempo:340,loft:2.7,assist:25,wind:-10,chaos:70,rideSpeed:1.7,ridePattern:'lurch',propIds:['bottle','plunger','mic','brick','boot','cone']}),
  scene('history','march','History · Timpani / low brass procession','heavy',{lighting:'footlights',grit:.12,height:.05,motion:8,decay:.5},{count:6,pattern:'many-6',phrase:'verse',tempo:510,loft:1.1,rideSpeed:.75,ridePattern:'surge',passMode:'three',propIds:['bowling','boot','hydrant','bell','balloon','can'],chaos:2}),
  scene('future','zero','Future · Zero-gravity aerial choir','moss',{lighting:'aurora',lightSpeed:.2,grit:.3,height:1.5,motion:.5,decay:1},{cast:'trio',count:6,pattern:'many-6',phrase:'loop',tempo:200,loft:3,gravity:.45,wind:0,rideSpeed:.18,ridePattern:'sweep',propIds:['fish','balloon','violin','snake','deadcat','skull'],chaos:0}),
  scene('punk','staticwheels','Punk · Shred relay / frozen wheels','eight',{lighting:'lasers',grit:1,height:.1,motion:10,decay:.65},{count:8,pattern:'many-8',phrase:'loop',tempo:1000,rideSpeed:0,loft:1.7,gravity:1.3,propIds:['guitar','axe','guitar','cassette','can','boot','bottle','hydrant'],chaos:0}),
  scene('history','monkeyopera','History · Opera vs cave / call and response','rats',{lighting:'disco',height:.4,motion:4,grit:.12,decay:.9},{cast:'roxy-moss',count:8,pattern:'many-8',phrase:'verse',tempo:650,loft:2.6,rideSpeed:1.15,ridePattern:'rock',passMode:'phrase',propIds:['deadcat','skull','plushrat','axe','mic','cone','deadcat','skull'],chaos:4}),
  scene('future','asymmetric','Future · Asymmetric targeting swarm','nine',{lighting:'chaos',grit:.95,height:1.2,motion:11,decay:.35},{count:8,pattern:'many-8',phrase:'evolve',tempo:950,loft:1.15,rideSpeed:2.1,ridePattern:'double-step',wind:10,passMode:'three',chaos:10}),
  scene('punk','tinyclub','Punk · Mono basement / ten-body pileup','metal',{lighting:'strobe',lightIntensity:.95,grit:1,height:0,stereo:0,decay:.25},{count:10,pattern:'many-10',phrase:'verse',tempo:1200,loft:.65,rideSpeed:2.5,ridePattern:'surge',rideRange:100,propIds:['guitar','axe','boot','can','bottle','brick','hydrant','cone','mic','cassette'],chaos:6}),
  scene('history','worldrelay','History · Zither / sitar / bronze relay','eight',{lighting:'party',grit:.08,height:0,motion:6,decay:.7},{cast:'trio',count:10,pattern:'many-10',phrase:'loop',tempo:960,loft:2.6,rideSpeed:1.8,ridePattern:'double-step',propIds:['fish','guitar','ball','bell','can','plant','violin','snake','apple','vhs'],chaos:0}),
  scene('future','hyperpop','Future · Hyper-wave ten-object overload','metal',{lighting:'strobe',lightSpeed:2.5,grit:1,height:1.4,motion:12,decay:.3},{count:10,pattern:'many-10',phrase:'evolve',tempo:1200,loft:3,gravity:1.65,rideSpeed:2.5,ridePattern:'surge',rideRange:100,chaos:7}),
  scene('punk','feedback','Punk · Whammy / feedback pendulum','cassettes',{lighting:'blacklight',grit:1,height:1.2,motion:12,decay:1},{cast:'puggler-moss',count:2,pattern:'two-shower',phrase:'loop',tempo:230,loft:3,rideSpeed:.65,ridePattern:'sweep',rideRange:100,propIds:['vhs','cassette'],chaos:0}),
  scene('history','whistle','History · Whistle duet / bright little trills','bell',{lighting:'sweep',grit:0,height:.12,motion:2,decay:.35},{cast:'puggler-roxy',count:2,pattern:'two-shower',phrase:'evolve',tempo:310,loft:.65,rideSpeed:1.4,ridePattern:'rock',propIds:['vhs','glowstick'],chaos:0}),
  scene('future','darkroom','Future · Backwards whispers / dark room','bell',{lighting:'blacklight',lightIntensity:.4,grit:.55,height:1.1,motion:7,decay:1},{cast:'moss',count:3,pattern:'cascade',phrase:'evolve',tempo:130,loft:2.6,rideSpeed:0,propIds:['mic','vhs','skull'],chaos:0}),
];
// Alternate eras AND densities rather than walking through three blocks of skin.
const sceneOrder=[0,12,3,8,7,10,1,15,4,13,6,9,2,14,5,11];
const bySkin=['punk','history','future'].map(skin=>SCENES.filter(p=>p.snapshot.sound.skin===skin));
export const PUGGLER_FULL_PRESETS=Object.freeze(sceneOrder.flatMap((index,round)=>
  [0,1,2].map(offset=>bySkin[(offset+round)%3][index])));


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
  // Normalize Audience back to its original dice range despite the new 300% max.
  sound.sceneGain=.77+.06*sound.sceneGain;sound.lightIntensity=.35+.65*sound.lightIntensity;
  sound.flight=.7+.2*sound.flight;sound.impacts=.8+.16*sound.impacts;sound.boo=.12+.18*(sound.boo/bounds.boo[1]);
  sound.drops=.6+.25*sound.drops;
  sound.grit=sound.skin==='history'?.08+.27*sound.grit:sound.skin==='punk'?.55+.4*sound.grit:.3+.7*sound.grit;
  return validatePugglerPreset(capturePugglerPreset(new PugglerModel(config),sound));
}
