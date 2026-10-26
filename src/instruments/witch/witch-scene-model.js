import { normalizeWitchPreset } from './witch-presets.js';
import { witchVoiceAtHeight } from './witch-model.js';

const discrete = new Set(['scene','voice','spoonAuto','stirAuto','handAuto','direction','palette','trip','visualMode','treeShape','handMotion','handSound','catGait']);

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
 * silent preview own the clock; this function never schedules or advances it. */
export function getWitchBlechFlyby(time) {
  if (!Number.isFinite(time) || time < 0) return [];
  const cycle = Math.floor(time / WITCH_BLECH_FLYBY_CYCLE);
  const phase = time - cycle * WITCH_BLECH_FLYBY_CYCLE;
  const visitors = [];
  for (let i = 0; i < WITCH_BLECH_FLYBY_EVENTS.length; i++) {
    const event = WITCH_BLECH_FLYBY_EVENTS[i], age = phase - event.at;
    if (age < 0 || age >= WITCH_BLECH_FLYBY_DURATION) continue;
    const progress = age / WITCH_BLECH_FLYBY_DURATION;
    visitors.push({ id: cycle * WITCH_BLECH_FLYBY_EVENTS.length + i, age, progress,
      direction: event.direction, x: event.direction > 0 ? -60 + progress * 1120 : 1060 - progress * 1120,
      y: event.y + Math.sin(progress * Math.PI * 2) * 16, scale: event.scale,
      opacity: Math.min(1, age / .2, (WITCH_BLECH_FLYBY_DURATION - age) / .3),
      angle: event.direction * (.12 + Math.sin(progress * Math.PI * 2) * .2) });
  }
  return visitors;
}
