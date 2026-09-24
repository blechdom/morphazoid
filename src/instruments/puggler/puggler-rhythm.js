// Notes follow the simulation's beat, not a playback-speed-scaled audio loop.
// At extreme juggling tempos, power-of-two divisions retain the relationship
// to catches while bounding each prop to <= 12 attacks/second.
export const MAX_PROP_NOTE_RATE=12;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
export function propRhythm(profile){
  const f=profile.family;
  if(profile.skin==='history'){
    if(f==='harpsichord')return {division:4,ratios:profile.propId==='skateboard'?[1,1.5,1.25,1.5]:[1,1.125,1,1.125,1,1.125,1.25,1.125],gate:.8};
    if(f==='piano')return {division:4,ratios:profile.propId==='icecream'?[1,1.25,1.5,2,1.5,1.25,1.125,1]:[1,1.125,1.25,4/3,1.5,5/3,1.875,2],gate:.88};
    if(f==='harp'||f==='opera')return {division:f==='opera'?1:2,ratios:[1,1.25,1.5,2,1.5,1.25],gate:.95};
    if(f==='gong'||f==='gamelan')return {division:.5,ratios:[1,1.013,1,.997],gate:1};
    if(f==='tabla'||f==='wood'||f==='cak')return {division:2,ratios:[1,1.06,.86,1,.94,1.12],gate:.7};
    if(f==='tuba'||f==='trombone')return {division:1,ratios:[1,1.5,1,1.25],gate:.8};
    if(f==='violin')return {division:1,ratios:[1,1.125,1.25,1.5,1.25,1.125],gate:1};
    return {division:2,ratios:[1,1.125,1.25,1,1.5,1.25],gate:.85};
  }
  if(profile.skin==='punk'){
    if(['shred','whammy','scrape'].includes(f))return {division:4,ratios:[1,1.2,4/3,1.5,2,1.5,4/3,1.2],gate:.94};
    if(['ebow','feedback'].includes(f))return {division:.5,ratios:[1,1.5,1,1.2],gate:1};
    if(['bass','bass-slide','guitar'].includes(f))return {division:2,ratios:[1,1,1,1.5,1,1.2,4/3,1],gate:.88};
    return {division:2,ratios:[1,1,.98,1.02,1,1,.97,1],gate:.7};
  }
  return {division:profile.family==='beep'?2:4,ratios:Array.from({length:7},(_,i)=>1+.38*Math.sin((i+profile.index)*profile.ratio)+.17*Math.cos(i*1.7)),gate:.82};
}
export function propNoteAt(profile,beat,tempo,slot=0){
  const rhythm=propRhythm(profile),bpm=clamp(tempo,100,1200);
  const divisor=2**Math.max(0,Math.ceil(Math.log2(bpm*rhythm.division/(60*MAX_PROP_NOTE_RATE))));
  const phase=(slot%4)*.25,position=(Math.max(0,beat)/divisor+phase)*rhythm.division;
  const step=Math.floor(position+1e-7),index=((step%rhythm.ratios.length)+rhythm.ratios.length)%rhythm.ratios.length;
  const stepBeats=divisor/rhythm.division,atBeat=(step/rhythm.division-phase)*divisor;
  return {token:`${divisor}:${step}`,step,atBeat,ratio:rhythm.ratios[index],accent:index%4===0?1:index%2===0?.9:.8,gateSeconds:stepBeats*60/bpm*rhythm.gate,stepBeats,ratePerSecond:bpm/(60*stepBeats)};
}
export function objectPitchRate(object,parameters={}){
  const height=clamp((object.y-170)/480,-.65,1.8),amount=clamp(parameters.height??.65,0,1.5);
  const bend=clamp(object.vx/500,-1.5,1.5);
  return clamp(2**((height*amount*(parameters.skin==='future'?8:3)+bend)/12),.6,2.6);
}
export function ensembleGain(count,tempo){
  // Configuration-based, never signal-detecting AGC: silence/rests stay silent,
  // and a lone airborne object is not suddenly boosted when its partners land.
  return clamp(Math.sqrt(6/clamp(count,1,10))*(clamp(tempo,100,1200)/360)**.28,.62,2.2);
}

// Fixed timbral trims complement window RMS: breathy/reversed voices and low
// bass read softer than driven strings at equal PCM energy. No live detector.
export function propTimbreGain(profile){
  if(['chant','cak','opera','laughter','grunt','shout','scream'].includes(profile.family))return 1.8;
  if(profile.skin==='future'&&['ether','alien'].includes(profile.family))return 1.65;
  if(profile.skin==='future'&&profile.family==='sub')return 1.45;
  if(profile.family==='violin')return 1.2;
  return 1;
}
