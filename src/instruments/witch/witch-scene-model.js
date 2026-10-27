import { normalizeWitchPreset } from './witch-presets.js';
import { witchVoiceAtHeight } from './witch-model.js';

const discrete = new Set(['scene','voice','spoonAuto','stirAuto','handAuto','direction','palette','trip','visualMode','treeShape','handMotion','handSound','catGait']);

// The original Hiccup Head rush remains the default for existing callers.
export const WITCH_GHOST_SCARE_DURATION = 1.25;
// One bounded voice varies its reach, throat and level on successive visits.
// The renderer shares the selected duration with the sample-clock scream.
export const WITCH_GHOST_SCREAMS = Object.freeze([
  { id: 'rush', duration: WITCH_GHOST_SCARE_DURATION, gain: .15,
    pitchStart: 1.1, pitchRise: 2.8, riseSeconds: .12, wobble: .012,
    rasp: .3, noise: 1, formantScale: 1, bandwidthScale: 1, attack: .018, tail: .24 },
  { id: 'wail', duration: 2.35, gain: .17,
    pitchStart: .85, pitchRise: 2.6, riseSeconds: .38, wobble: .045,
    rasp: .18, noise: .65, formantScale: .84, bandwidthScale: .8, attack: .028, tail: .4 },
  { id: 'shriek', duration: 1.8, gain: .205,
    pitchStart: 1.5, pitchRise: 3.15, riseSeconds: .075, wobble: .026,
    rasp: .58, noise: 1.35, formantScale: 1.18, bandwidthScale: 1.15, attack: .018, tail: .28 },
  { id: 'rasp', duration: 2.6, gain: .185,
    pitchStart: .5, pitchRise: 1.05, riseSeconds: .24, wobble: .033,
    rasp: .82, noise: 2.1, formantScale: .68, bandwidthScale: 1.4, attack: .025, tail: .42 },
].map((scream, index) => Object.freeze({ index, ...scream })));

export function getWitchGhostScream(variant = 0) {
  const index = Number.isFinite(variant) ? Math.max(0, Math.min(WITCH_GHOST_SCREAMS.length - 1, Math.floor(variant))) : 0;
  return WITCH_GHOST_SCREAMS[index];
}

/** A potion flight morphs musical parameters without replacing clocks/devices. */
export function blendWitchSpell(from, to, progress) {
  const a=normalizeWitchPreset(from),b=normalizeWitchPreset(to);
  // Ingredients change the spell; only the player chooses when to fly or land.
  b.scene=a.scene;
  const t=Math.max(0,Math.min(1,Number(progress)||0)),mix=t*t*(3-2*t);
  if(t===0)return a;
  if(t===1)return b;
  const result={};
  for(const key of Object.keys(b)) {
    if(key==='fingers')result[key]=a[key].map((value,i)=>value+(b[key][i]-value)*mix);
    else if(discrete.has(key))result[key]=mix<.5?a[key]:b[key];
    else result[key]=a[key]+(b[key]-a[key])*mix;
  }
  if(!result.spoonAuto)result.voice=witchVoiceAtHeight(result.spoonHeight);
  return result;
}

export function witchAccentEnvelope(age,duration=1.5) {
  if(!Number.isFinite(age)||age<0||age>=duration)return 0;
  return Math.min(1,age/.035)*Math.pow(1-age/duration,.75);
}

/** Intersect the swept pointer with real silk, including catching rings within
 * one note sector. Shared vertices count once; a still pointer never plucks. */
export function witchWebCrossings(web,from,to,occludedRadius=0) {
  if(!web?.strands||![from?.x,from?.y,to?.x,to?.y].every(Number.isFinite))return [];
  const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
  if(length<2)return [];
  const crossings=[];
  for(const strand of web.strands)for(let i=1;i<strand.length;i++) {
    const a=strand[i-1],b=strand[i],sx=b.x-a.x,sy=b.y-a.y,cross=dx*sy-dy*sx;
    if(Math.abs(cross)<1e-8)continue;
    const ax=a.x-from.x,ay=a.y-from.y,t=(ax*sy-ay*sx)/cross,u=(ax*dy-ay*dx)/cross;
    if(t<=1e-6||t>1||u<0||u>1)continue;
    const x=from.x+dx*t,y=from.y+dy*t;
    if(Math.hypot(x-web.center.x,y-web.center.y)<occludedRadius)continue;
    const angle=(Math.atan2(y-web.center.y,x-web.center.x)+Math.PI*2)%(Math.PI*2);
    crossings.push({x,y,t,index:Math.min(6,Math.floor(angle/(Math.PI*2)*7))});
  }
  crossings.sort((a,b)=>a.t-b.t);
  const distinct=[];
  for(const crossing of crossings)if(!distinct.length||(crossing.t-distinct.at(-1).t)*length>=3)distinct.push(crossing);
  // Sparse/coalesced input still traverses the whole swipe with bounded work.
  return distinct.length<=8?distinct:Array.from({length:8},(_,i)=>distinct[Math.round(i*(distinct.length-1)/7)]);
}

// The same sparse flight score drives the icons and the native BLECH phrase.
// Its five-second passes need at most two voices, even at a cycle boundary.
export const WITCH_BLECH_FLYBY_CYCLE = 26;
export const WITCH_BLECH_FLYBY_DURATION = 5;
export const WITCH_BLECH_FLYBY_EVENTS = Object.freeze([
  Object.freeze({ at: 5, direction: 1, y: 142, scale: .74 }),
  Object.freeze({ at: 16, direction: -1, y: 198, scale: .65 }),
  Object.freeze({ at: 18.2, direction: -1, y: 112, scale: .56 }),
]);

/** Flight elapsed seconds -> zero, one or two background visitors. Audio and
 * silent preview own the clock; optional scene bounds only project the path. */
export function getWitchBlechFlyby(time,{left=0,top=0,width=1000,height=720}={}) {
  if (!Number.isFinite(time) || time < 0) return [];
  const skyHeight=height>width?height*.55:height;
  const cycle = Math.floor(time / WITCH_BLECH_FLYBY_CYCLE);
  const phase = time - cycle * WITCH_BLECH_FLYBY_CYCLE;
  const visitors = [];
  for (let i = 0; i < WITCH_BLECH_FLYBY_EVENTS.length; i++) {
    const event = WITCH_BLECH_FLYBY_EVENTS[i], age = phase - event.at;
    if (age < 0 || age >= WITCH_BLECH_FLYBY_DURATION) continue;
    const progress = age / WITCH_BLECH_FLYBY_DURATION;
    visitors.push({ id: cycle * WITCH_BLECH_FLYBY_EVENTS.length + i, slotIndex: i === 2 ? 1 : 0, age, progress,
      direction: event.direction, x: left + (event.direction > 0 ? -60 + progress * 1120 : 1060 - progress * 1120) * width / 1000,
      y: top + (event.y + Math.sin(progress * Math.PI * 2) * 16) * skyHeight / 720, scale: event.scale,
      opacity: Math.min(1, age / .2, (WITCH_BLECH_FLYBY_DURATION - age) / .3),
      angle: event.direction * (.12 + Math.sin(progress * Math.PI * 2) * .2) });
  }
  return visitors;
}
