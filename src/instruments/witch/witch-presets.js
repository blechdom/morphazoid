export const WITCH_DEFAULTS = Object.freeze({ scene: 'brew', voice: 'mutter', speed: .4, radius: .55, direction: 1, fingers: Object.freeze([.5,.5,.3,.25,.25]), glass: 0, hair: 0, altitude: .5, flightX: .5, tone: .5, nose: .5, hat: .5, spoonHeight: .5, spoonAuto: true });
const scene = (id, label, values) => ({ id, label, snapshot: { ...WITCH_DEFAULTS, fingers: [...WITCH_DEFAULTS.fingers], ...values, spoonAuto: values.voice ? false : WITCH_DEFAULTS.spoonAuto } });
export const WITCH_PRESETS = [
  scene('small-spell', 'A small, suspicious spell', {}),
  scene('secret', 'A secret in the steam', { voice:'whisper', speed:.2, radius:.22, fingers:[.3,.22,.15,.15,.88] }),
  scene('old-door', 'Older than the door', { voice:'creak', speed:.22, radius:.37, fingers:[.12,.2,.88,.62,.12], hair:.3 }),
  scene('wicked', 'Something wicked', { voice:'cackle', speed:.77, radius:.7, fingers:[.72,.65,.7,.58,.17] }),
  scene('beautiful', 'She remembers a song', { voice:'sing', speed:.2, radius:.88, fingers:[.62,.7,.05,.33,.12], glass:.12 }),
  scene('unspell', 'Unspell the spell', { direction:-1, speed:.7, radius:.34, fingers:[.35,.17,.6,.18,.4], hair:.4 }),
  scene('glass', 'A throat full of glass', { voice:'sing', speed:.35, radius:.72, glass:.9, fingers:[.7,.82,.1,.25,.12] }),
  scene('hair', 'A very tangled incantation', { voice:'creak', speed:.65, radius:.42, hair:.95, fingers:[.4,.28,.78,.85,.2] }),
  scene('fingertips', 'At her fingertips', { scene:'fingers', tone:.68, fingers:[.4,.75,.08,.4,.23] }),
  scene('claws', 'Five crooked little instruments', { scene:'fingers', tone:.25, fingers:[.2,.85,.9,.72,.5] }),
  scene('broom', 'The broom knows the way', { scene:'flight', speed:.65, altitude:.4, flightX:.3, tone:.65 }),
  scene('moon', 'Bells beneath the full moon', { scene:'flight', speed:.25, altitude:.85, flightX:.72, tone:.3 }),
];
const unit = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
export function normalizeWitchPreset(input = {}) {
  const d = WITCH_DEFAULTS;
  return {
    scene: ['brew','fingers','flight'].includes(input.scene) ? input.scene : d.scene,
    voice: ['mutter','whisper','creak','cackle','sing'].includes(input.voice) ? input.voice : d.voice,
    speed: Math.max(.02, unit(input.speed,d.speed)), radius: Math.max(.08,unit(input.radius,d.radius)),
    direction: input.direction === -1 ? -1 : 1,
    fingers: d.fingers.map((value,i) => unit(input.fingers?.[i],value)),
    glass: unit(input.glass,d.glass), hair: unit(input.hair,d.hair), altitude: unit(input.altitude,d.altitude),
    nose: unit(input.nose,d.nose), hat: unit(input.hat,d.hat), spoonHeight: unit(input.spoonHeight,d.spoonHeight), spoonAuto: typeof input.spoonAuto==='boolean'?input.spoonAuto:d.spoonAuto,
    flightX: Math.max(.12,Math.min(.88,unit(input.flightX,d.flightX))), tone: unit(input.tone,d.tone),
  };
}
export function randomizeWitchPreset(_previous, random = Math.random) {
  const r = () => unit(random(), .5);
  return normalizeWitchPreset({ scene:['brew','fingers','flight'][Math.min(2,Math.floor(r()*3))], voice:['mutter','whisper','creak','cackle','sing'][Math.min(4,Math.floor(r()*5))], speed:.08+r()*.9, radius:.1+r()*.9, direction:r()<.5?-1:1, fingers:Array.from({length:5},r), glass:r(), hair:r(), altitude:r(), flightX:.12+r()*.76, tone:r(), nose:r(), hat:r(), spoonHeight:r(), spoonAuto:r()<.5 });
}
