import { normalizeWitchPreset } from './witch-presets.js';
import { witchVoiceAtHeight } from './witch-model.js';

const discrete = new Set(['scene','voice','spoonAuto','direction','palette','trip','visualMode','treeShape','handMotion','handSound','catGait']);

/** A potion flight morphs musical parameters without replacing clocks/devices. */
export function blendWitchSpell(from, to, progress) {
  const a=normalizeWitchPreset(from),b=normalizeWitchPreset(to);
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
