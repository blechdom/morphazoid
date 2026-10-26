export const WITCH_PALETTES = Object.freeze(['Foxfire', 'Ember and ash', 'Poison gold', 'Spectral green', 'Drowned blue', 'Bruised violet', 'Blood moon', 'Nightshade']);
export const WITCH_DEFAULTS = Object.freeze({ scene: 'brew', voice: 'mutter', speed: .4, radius: .55, direction: 1, fingers: Object.freeze([.5,.5,.3,.25,.25]), glass: 0, hair: 0, altitude: .5, flightX: .5, tone: .5, nose: .5, hat: .5, spoonHeight: .5, spoonAuto: true, ghostTempo: 72, palette: 0, trip: 0 });
const voices = ['mutter','whisper','creak','cackle','sing'];
const scene = (id, label, values) => ({ id, label, snapshot: {
  ...WITCH_DEFAULTS, fingers: [...WITCH_DEFAULTS.fingers], ...values,
  spoonAuto: values.spoonAuto ?? !values.voice,
  spoonHeight: values.spoonHeight ?? (values.voice ? (voices.indexOf(values.voice)+.5)/5 : WITCH_DEFAULTS.spoonHeight),
} });
export const WITCH_PRESETS = [
  scene('small-spell', 'A small, suspicious spell', {}),
  scene('secret', 'A secret in the steam', { voice:'whisper', palette:4, ghostTempo:54, speed:.2, radius:.22, fingers:[.3,.22,.15,.15,.88] }),
  scene('old-door', 'Older than the door', { voice:'creak', palette:1, ghostTempo:45, speed:.22, radius:.37, fingers:[.12,.2,.88,.62,.12], hair:.3 }),
  scene('wicked', 'Something wicked', { voice:'cackle', palette:6, ghostTempo:126, speed:.77, radius:.7, fingers:[.72,.65,.7,.58,.17] }),
  scene('beautiful', 'She remembers a song', { voice:'sing', palette:5, ghostTempo:66, speed:.2, radius:.88, fingers:[.62,.7,.05,.33,.12], glass:.12 }),
  scene('unspell', 'Unspell the spell', { palette:7, trip:1, direction:-1, speed:.7, radius:.34, fingers:[.35,.17,.6,.18,.4], hair:.4 }),
  scene('glass', 'A throat full of glass', { voice:'sing', palette:4, speed:.35, radius:.72, glass:.9, fingers:[.7,.82,.1,.25,.12] }),
  scene('hair', 'A very tangled incantation', { voice:'creak', palette:3, trip:2, speed:.65, radius:.42, hair:.95, fingers:[.4,.28,.78,.85,.2] }),
  scene('fingertips', 'At her fingertips', { scene:'fingers', palette:2, tone:.68, fingers:[.4,.75,.08,.4,.23] }),
  scene('claws', 'Five crooked little instruments', { scene:'fingers', palette:7, tone:.25, fingers:[.2,.85,.9,.72,.5] }),
  scene('broom', 'The broom knows the way', { scene:'flight', palette:6, ghostTempo:108, speed:.65, altitude:.4, flightX:.3, tone:.65 }),
  scene('moon', 'Bells beneath the full moon', { scene:'flight', palette:4, ghostTempo:48, speed:.25, altitude:.85, flightX:.72, tone:.3 }),
  scene('poison-gold', 'Poison in a golden cup', { voice:'whisper', palette:2, ghostTempo:84, speed:.32, radius:.16, nose:.88, hat:.24, glass:.38, fingers:[.15,.83,.35,.62,.21] }),
  scene('foxglove', 'Foxglove finger dance', { scene:'fingers', palette:3, trip:1, ghostTempo:112, speed:.46, radius:.72, tone:.82, fingers:[.88,.24,.73,.12,.58], nose:.3, hat:.76 }),
  scene('cinder', 'Cinders between her teeth', { voice:'creak', palette:1, ghostTempo:60, speed:.28, radius:.22, tone:.18, hair:.63, nose:.17, hat:.87, fingers:[.21,.41,.86,.72,.14] }),
  scene('cat-shadow', 'Something under the floor', { voice:'mutter', palette:7, ghostTempo:42, speed:.16, radius:.33, tone:.2, nose:.72, hat:.19, fingers:[.43,.16,.62,.3,.76] }),
  scene('violet-thread', 'A violet thread of song', { voice:'sing', palette:5, ghostTempo:78, speed:.26, radius:.96, glass:.27, tone:.64, nose:.41, hat:.32, fingers:[.79,.52,.13,.35,.23] }),
  scene('drowned-bells', 'Bells from a drowned room', { scene:'fingers', voice:'whisper', palette:4, ghostTempo:57, speed:.21, radius:.47, glass:.56, tone:.38, fingers:[.9,.1,.27,.69,.61], hat:.61 }),
  scene('toad-waltz', 'The toads know a secret', { palette:3, trip:1, ghostTempo:93, speed:.38, radius:.61, hair:.26, nose:.91, hat:.37, fingers:[.12,.64,.49,.8,.34] }),
  scene('mushroom-fever', 'Mushroom fever', { voice:'cackle', palette:2, trip:3, ghostTempo:156, speed:.91, radius:.84, hair:.58, glass:.31, tone:.78, nose:.8, hat:.67, fingers:[.76,.32,.91,.59,.87] }),
  scene('silver-nails', 'Silver nails on the window', { scene:'fingers', voice:'creak', palette:4, ghostTempo:138, speed:.6, radius:.2, tone:.94, glass:.71, fingers:[.33,.18,.67,.96,.46], nose:.22, hat:.69 }),
  scene('backward-lullaby', 'A lullaby said backward', { voice:'sing', palette:7, direction:-1, ghostTempo:51, speed:.23, radius:.81, tone:.43, hair:.19, nose:.64, hat:.22, fingers:[.72,.48,.23,.11,.64] }),
  scene('blood-moon', 'A broom through the blood moon', { scene:'flight', voice:'cackle', palette:6, trip:1, ghostTempo:144, speed:.83, altitude:.91, flightX:.7, tone:.71, nose:.68, hat:.89, fingers:[.82,.53,.67,.91,.28] }),
  scene('low-fog', 'Skimming the low fog', { scene:'flight', voice:'whisper', palette:4, ghostTempo:63, speed:.32, altitude:.13, flightX:.24, tone:.29, radius:.3, fingers:[.38,.65,.2,.54,.86], nose:.38, hat:.51 }),
  scene('candy-coil', 'Down the candy coil', { scene:'flight', palette:5, trip:2, ghostTempo:132, speed:.94, altitude:.28, flightX:.82, radius:.76, glass:.44, hair:.37, fingers:[.7,.9,.18,.46,.67], hat:.78 }),
  scene('green-lightning', 'Green lightning in her sleeves', { scene:'fingers', voice:'cackle', palette:3, trip:2, ghostTempo:168, speed:.79, tone:.91, radius:.68, fingers:[.94,.48,.84,.27,.73], nose:.85, hat:.66 }),
  scene('wax-moon', 'The moon melts like wax', { voice:'mutter', palette:1, trip:2, ghostTempo:69, speed:.4, radius:.9, tone:.48, hair:.46, nose:.56, hat:.13, fingers:[.24,.77,.51,.19,.93] }),
  scene('crooked-choir', 'The crooked choir arrives', { voice:'sing', palette:6, trip:1, ghostTempo:105, speed:.5, radius:.93, glass:.6, hair:.22, tone:.58, nose:.76, hat:.74, fingers:[.63,.84,.41,.56,.18] }),
  scene('bone-orchard', 'A wind through the bone orchard', { voice:'creak', palette:2, ghostTempo:39, speed:.12, radius:.58, hair:.78, tone:.17, nose:.12, hat:.92, fingers:[.39,.22,.95,.81,.53] }),
  scene('falling-stars', 'Catch the falling stars', { scene:'flight', voice:'sing', palette:5, ghostTempo:90, speed:.56, altitude:.76, flightX:.43, glass:.82, radius:.86, tone:.76, fingers:[.91,.67,.24,.42,.78], hat:.46 }),
  scene('night-knots', 'Tie the night in knots', { scene:'fingers', palette:7, trip:3, direction:-1, ghostTempo:120, speed:.68, radius:.44, hair:.66, tone:.56, fingers:[.16,.92,.75,.39,.84], nose:.62, hat:.83 }),
  scene('last-spell', 'One last spell before dawn', { voice:'sing', palette:0, ghostTempo:36, speed:.14, radius:1, glass:.18, tone:.32, nose:.46, hat:.28, fingers:[.58,.37,.16,.28,.69] }),
];
const unit = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
export function normalizeWitchPreset(input = {}) {
  if(!input || typeof input!=='object') input={};
  const d = WITCH_DEFAULTS;
  return {
    scene: ['brew','fingers','flight'].includes(input.scene) ? input.scene : d.scene,
    voice: voices.includes(input.voice) ? input.voice : d.voice,
    speed: Math.max(.02, unit(input.speed,d.speed)), radius: Math.max(.08,unit(input.radius,d.radius)),
    direction: input.direction === -1 ? -1 : 1,
    ghostTempo: Number.isFinite(Number(input.ghostTempo)) ? Math.max(36,Math.min(180,Number(input.ghostTempo))) : d.ghostTempo,
    palette: Number.isFinite(Number(input.palette)) ? Math.round(Math.max(0,Math.min(7,Number(input.palette)))) : d.palette,
    trip: Number.isFinite(Number(input.trip)) ? Math.round(Math.max(0,Math.min(3,Number(input.trip)))) : d.trip,
    fingers: d.fingers.map((value,i) => unit(input.fingers?.[i],value)),
    glass: unit(input.glass,d.glass), hair: unit(input.hair,d.hair), altitude: unit(input.altitude,d.altitude),
    nose: unit(input.nose,d.nose), hat: unit(input.hat,d.hat), spoonHeight: unit(input.spoonHeight,d.spoonHeight), spoonAuto: typeof input.spoonAuto==='boolean'?input.spoonAuto:d.spoonAuto,
    flightX: Math.max(.12,Math.min(.88,unit(input.flightX,d.flightX))), tone: unit(input.tone,d.tone),
  };
}
export function randomizeWitchPreset(_previous, random = Math.random) {
  const r = () => unit(random(), .5);
  return normalizeWitchPreset({ scene:['brew','fingers','flight'][Math.min(2,Math.floor(r()*3))], voice:voices[Math.min(4,Math.floor(r()*5))], ghostTempo:36+r()*144, palette:Math.min(7,Math.floor(r()*8)), trip:Math.min(3,Math.floor(r()*4)), speed:.08+r()*.9, radius:.1+r()*.9, direction:r()<.5?-1:1, fingers:Array.from({length:5},r), glass:r(), hair:r(), altitude:r(), flightX:.12+r()*.76, tone:r(), nose:r(), hat:r(), spoonHeight:r(), spoonAuto:r()<.5 });
}
