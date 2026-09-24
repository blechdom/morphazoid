import { PROPS } from './puggler.js';
import { TAU, mode, noiseBurst, pluckedString, acousticVoice, copyClip, cabinet, finishVoice, noiseFor } from './puggler-voice-dsp.js';
// Identity is attached to the physical prop, not its current juggler. Acoustic
// labels describe stylized colors, not authentic traditional performances.
const palettes={
  punk:[
    ['Palm-muted guitar','guitar',82],['Trash-can snare','snare',180],['Electric guitar stabs','guitar',110],['Picked bass guitar','bass',55],
    ['Broken-glass clatter','glass',700],['Boot stomps','stomp',70],['Oi! Shout back','shout',160],['Pick-scrape guitar','scrape',147],
    ['Rotten power chords','guitar',98],['Tambourine shake','tambourine',600],['Basement kick drum','kick',65],['Amp feedback squeal','feedback',440],
    ['Shredding guitar','shred',165],['Ebow guitar swell','ebow',110],['Thrash drum kit','kit',120],['Ride and crash cymbals','cymbal',500],
    ['Check check · is this thing on?','speech',160],['One two three four!','count-in',160],['Whammy-bar guitar','whammy',147],['Gang shouts','shout',190],
    ['Bass-guitar slides','bass-slide',73],['More guitar shredding','shred',220],['Crowd screams','scream',210],['Knocked-over drum kit','kit',150],
    ['Choked guitar chops','guitar',123],['Sustained ebow harmonics','ebow',196],['Floor-tom breakdown','tom',95],['Dive-bomb whammy','whammy',196],
    ['Cable-and-amp feedback','feedback',330],['Knocking things over','clatter',280],['Dirty picked bass','bass',65],['Speed-picked guitar','shred',247],['Basement drum break','kit',170],
  ],
  history:[
    ['Detuned bronze pair · stylized gamelan','gamelan',188],['Tabla bols · modal color','tabla',174],['Woodblock interlock','wood',320],['Orchestral timpani','timpani',65],
    ['Breathy concert flute','flute',523],['Tuba oom-pah','tuba',82],['Penny whistle','whistle',660],['Chinese plucked-zither color','zither',261],
    ['Piano scales','piano',261],['Beating Balinese-gong color','gong',188],['Hand-drum responses','hand-drum',135],['Oboe answers','oboe',349],
    ['Sitar · jawari and sympathetic strings','sitar',196],['Harpsichord trills','harpsichord',392],['Harpsichord Alberti bass','harpsichord',131],['Low bronze gong','gong',94],
    ['Call-and-response chant · theatrical','chant',150],['Trombone slides','trombone',130],['Harp arpeggios','harp',330],['Polite chamber laughter','laughter',220],
    ['Piano cadences','piano',196],['Cak interlock · syllable proxy','cak',170],['Operatic arpeggios','opera',261],['Bronze ensemble','gamelan',230],
    ['Flute ornaments','flute',440],['Violin with vibrato','violin',294],['Caveman grunts and growls','grunt',95],['Pizzicato strings','pizzicato',165],
    ['Bowed viola with vibrato','violin',196],['Plucked harp reply','harp',247],['Low tabla response · modal color','tabla',116],['Piano running ornaments','piano',330],['Oboe and bassoon color','oboe',220],
  ],
  future:[
    ['Gravipod tractor-beam pulse','sub',65],['Doppler-targeting laser','laser',330],['Asymmetric photon arpeggio','ring',261],['Dark-matter implosion','sub',48],
    ['Psycho-filter plasma','gizzle',247],['Jet-boot pulse spray','packet',147],['Beep-beep quantum duck','beep',660],['Backwards underwater alien','alien',174],
    ['Antimatter glitch pop','packet',392],['Event-horizon bell','ring',330],['Gizzle-git memory fracture','gizzle',220],['Vacuum hyper-wave','ether',196],
    ['Solar-string targeting beam','laser',440],['Data-tape reverse scatter','alien',147],['Maglev laser scream','laser',523],['Orbital hyper-pop resonator','ring',294],
    ['Alien scatter gibberish','alien',220],['Singularity beep-beep','beep',330],['Neutrino light sword','laser',587],['Cyber-rat telepathy','alien',261],
    ['Cryogenic backwards cloud','ether',165],['Phase-axe gizzle rupture','gizzle',349],['Ghost-cat delayed babble','alien',196],['Fusion pulse generator','packet',130],
    ['Bioelectric asymmetric arp','gizzle',311],['Tachyon psycho-filter strings','ether',392],['Skull-probe broadcast','alien',247],['Banana time-warp scatter','ring',440],
    ['Wormhole Doppler serpent','laser',392],['Spore-network hyper-wave','ether',220],['Vacuum-pump wobble','sub',73],['Holographic rhythmic spray','packet',466],['Lost-future gibberish','alien',185],
  ],
};
export const OBJECT_SOUND_RATE=22050;
export const OBJECT_SOUND_PROFILES=Object.freeze(Object.fromEntries(Object.entries(palettes).map(([skin,entries])=>{
  if(entries.length!==PROPS.length)throw new Error('Every prop needs a voice');
  return [skin,Object.freeze(Object.fromEntries(PROPS.map((prop,index)=>[prop.id,Object.freeze({skin,propId:prop.id,name:entries[index][0],family:entries[index][1],frequency:entries[index][2],index,color:.25+(index*11%23)/32,ratio:1.17+(index*7%19)*.137, speech:['speech','count-in'].includes(entries[index][1])})])))];
})));
export function objectSoundProfile(skin,id){const bank=OBJECT_SOUND_PROFILES[skin]??OBJECT_SOUND_PROFILES.punk;return bank[id]??bank.ball;}
export function objectSoundId(choice,propId){const id=choice==='object'?propId:typeof choice==='string'&&choice.startsWith('object:')?choice.slice(7):null;return id&&Object.hasOwn(OBJECT_SOUND_PROFILES.punk,id)?id:null;}
export const objectSoundKey=(skin,propId,kind='air')=>`object:${skin}:${propId}:${kind}`;
export function objectSoundLabel(skin,choice,propId,kind='air'){const id=objectSoundId(choice,propId);return id?`${choice==='object'?'Own · ':''}${objectSoundProfile(skin,id).name}${kind==='catch'?' hit':''}`:null;}
function vocal(out,rate,p,clips){
  const family=p.family,source=clips[family==='scream'||family==='laughter'||family==='opera'?'woo':'oi'];
  const speed=family==='grunt'?.73:family==='laughter'?1.2:family==='opera'?1.05:.93+(p.index%7)*.035;
  copyClip(out,rate,source,{speed,gain:1});
  if(!source) { // Pure-helper fallback only; the browser requires its licensed clips.
    noiseBurst(out,rate,p.index+332,.2,.12,.1);mode(out,rate,p.frequency,.3,.23);
  }
  if(family==='laughter'||family==='cak')for(let i=0;i<out.length;i++){
    const t=i/rate,phase=t*(family==='cak'?7:5.5)%1;out[i]*=Math.sin(Math.PI*phase)**2;
  }
  if(family==='chant'||family==='opera'){
    const dry=out.slice();copyClip(out,rate,{data:dry,rate},{speed:1.012,at:.011,gain:.2});
  }
  if(p.skin==='punk')cabinet(out,rate,family==='scream'?2:1.25,5400);
}
function punk(out,rate,p,clips){
  const f=p.family;
  if(['guitar','shred','scrape','ebow','whammy','bass','bass-slide'].includes(f)){
    pluckedString(out,rate,p,{bass:f.startsWith('bass'),muted:f==='guitar',sustain:f==='ebow',whammy:f==='whammy'||f==='bass-slide'});
    if(f==='scrape')noiseBurst(out,rate,p.index*41,.12,.11,.65);
  }else if(f==='feedback'){
    for(const [k,a] of [[1,.4],[2,.22],[3,.12]])mode(out,rate,p.frequency*k,a,2.5,k,.35);
    for(let i=0;i<out.length;i++)out[i]*=Math.min(1,i/(rate*.11));cabinet(out,rate,2,4500);
  }else if(['shout','scream'].includes(f))vocal(out,rate,p,clips);
  else if(p.speech)copyClip(out,rate,clips[f==='speech'?'mic-check':'count-in']);
  else{
    const ids={snare:'snare',stomp:'kick',kick:'kick',kit:p.index%2?'snare':'tom',cymbal:'crash',tom:'tom',tambourine:'hat',glass:'hat',clatter:'tom'};
    const source=clips[ids[f]],speed=(f==='stomp'?.79:f==='tom'?.9:1)+(p.index%5)*.014;
    copyClip(out,rate,source,{speed});
    if(!source)noiseBurst(out,rate,91+p.index,.7,.09,.6);
    if(f==='kit')copyClip(out,rate,clips.hat,{gain:.24,at:.012});
    if(f==='stomp')mode(out,rate,92,.18,.07);
    if(['tambourine','glass','clatter'].includes(f)){
      const frequencies=f==='clatter'?[180,311,487,923]:[1830,2437,3121,4573,6289];
      frequencies.forEach((hz,i)=>mode(out,rate,hz*(1+p.index*.001),.15/(1+i*.3),f==='glass'?.14:.07,i*.31));
      noiseBurst(out,rate,p.index+13,.3,.025,.7);
    }
  }
}
function future(out,rate,p,clips){
  let phase=0,mod=0,low=0,band=0;const noise=noiseFor(p.index+901),family=p.family;
  const dryVoice=clips.woo;
  for(let i=0;i<out.length;i++){
    const t=i/rate,u=i/out.length;
    const glide=family==='laser'?Math.exp(-t*9)*4+.5:family==='sub'?1+1.8*Math.exp(-t*30):1;
    phase+=TAU*p.frequency*glide/rate;mod+=TAU*p.frequency*p.ratio/rate;
    const pulse=.6+.4*Math.sin(TAU*(family==='packet'?13:4)*t)**3;
    let x=family==='beep'?Math.sin(phase):Math.sin(phase+(family==='gizzle'?7:3)*Math.sin(mod+Math.sin(phase*.197)*2));
    if(family==='ring')x*=Math.sin(mod*.257);
    if(family==='ether')x=(Math.sin(phase)+Math.sin(phase*1.009)+Math.sin(mod*.501))*.4;
    if(family==='packet')x=x*.7+noise()*.2;
    if(family==='alien'&&dryVoice){const j=dryVoice.data.length-1-Math.floor(t*dryVoice.rate*(.8+p.color*.4))%dryVoice.data.length;x=x*.25+dryVoice.data[j]*1.8;}
    const cutoff=family==='beep'?.25:Math.min(.5,.035+.3*(.5+.5*Math.sin(TAU*t*(2+p.color)+p.index)));
    low+=cutoff*band;const high=x-low-1.1*band;band+=cutoff*high;
    out[i]=(family==='beep'?x:low)*pulse*Math.exp(-u*(family==='ether'?1:4));
  }
  // Two finite, beat-independent timbral echoes, not an unbounded delay network.
  const dry=out.slice();for(const [at,gain] of [[.093,.23],[.173,.12]])copyClip(out,rate,{data:dry,rate},{at,gain,reverse:family==='alien'});
}
export function renderObjectSound(skin,id,kind='air',requestedRate=OBJECT_SOUND_RATE,clips={}){
  const p=objectSoundProfile(skin,id),rate=Math.round(Math.max(8000,Math.min(48000,Number(requestedRate)||OBJECT_SOUND_RATE))),hit=kind==='catch';
  const speechClip=clips[p.family==='speech'?'mic-check':'count-in'];
  const duration=p.speech&&!hit?(speechClip?.data.length/speechClip?.rate||2.4):hit?.48:['gong','gamelan','ebow','feedback','violin','opera'].includes(p.family)?1.6:.85;
  const out=new Float32Array(Math.ceil(duration*rate));
  if(p.skin==='punk')punk(out,rate,p,clips);
  else if(p.skin==='future')future(out,rate,p,clips);
  else if(['chant','laughter','cak','grunt','opera'].includes(p.family))vocal(out,rate,p,clips);
  else acousticVoice(out,rate,p);
  if(p.speech&&!speechClip)vocal(out,rate,p,clips);
  return finishVoice(out,rate,hit?.17:p.speech?.16:.15);
}
const caches=new WeakMap();const emptyClips={};
export function prepareObjectSoundData(clips=emptyClips){
  if(!caches.has(clips))caches.set(clips,(async()=>{
    const bank={};let count=0;
    for(const skin of Object.keys(OBJECT_SOUND_PROFILES))for(const prop of PROPS){
      for(const kind of ['air','catch'])bank[objectSoundKey(skin,prop.id,kind)]=renderObjectSound(skin,prop.id,kind,OBJECT_SOUND_RATE,clips);
      if(++count%4===0&&typeof document!=='undefined')await new Promise(resolve=>setTimeout(resolve,0));
    }
    return Object.freeze(bank);
  })().catch(error=>{caches.delete(clips);throw error;}));
  return caches.get(clips);
}
