import { WITCH_VOICES, witchVoiceAtHeight, WITCH_HAND_MOTIONS, WITCH_HAND_SOUNDS, WITCH_CAT_GAITS, WITCH_INGREDIENTS } from './witch-model.js';
export const WITCH_PALETTES = Object.freeze(['Foxfire', 'Ember and ash', 'Poison gold', 'Spectral green', 'Drowned blue', 'Bruised violet', 'Blood moon', 'Nightshade']);
export const WITCH_VISUAL_MODES = Object.freeze(['Night air','Rippling spell','Crooked glass','Wonkywonk','VHS haunting','Static storm','Pixel rot','Angular hex']);
export const WITCH_DEFAULTS = Object.freeze({ scene: 'brew', voice: 'mutter', stirAuto: true, handAuto: true, speed: .4, flightSpeed: .4, radius: .55, direction: 1, fingers: Object.freeze([.5,.5,.3,.25,.25]), glass: 0, hair: 0, altitude: .5, flightX: .5, tone: .5, nose: .5, hat: .5, spoonHeight: .5, spoonAuto: true, ghostTempo: 72, palette: 0, trip: 0, visualMode: 0, treeShape: 0, handMotion: 'finger-roll', handRate: 1, handDepth: .66, handSound: 'glass-and-wire', spellBalance: .5, catSpeed: 1, catGait: 'cat-prowl', fabricX: .5, fabricY: .5, trailPull: .5, trailTwist: .5, trailFeedback: .55, trailSpace: .5 });
const voices = WITCH_VOICES;
// Most spells keep the picture steady; glitches belong to a few authored scenes.
const ingredientVisualModes = Object.freeze({ hair:2, roach:1, rubix:6, hiccup:1, marimba:1, puggler:7, fractal:3, blech:5 });
const visualTrip = [0,1,2,3,1,2,2,3];
function randomVisualMode(value) {
  if(value<.6)return 0;
  if(value<.7)return 1;
  if(value<.8)return 2;
  if(value<.85)return 3;
  return Math.min(7,4+Math.floor((value-.85)/.0375));
}
let presetOrdinal=0;
const scene = (id, label, values) => {
  const index=presetOrdinal++;
  const visualMode=values.visualMode??values.trip??0;
  return { id, label, snapshot: {
    ...WITCH_DEFAULTS, fingers: [...WITCH_DEFAULTS.fingers],
    handMotion: WITCH_HAND_MOTIONS[index%WITCH_HAND_MOTIONS.length],
    handSound: WITCH_HAND_SOUNDS[index%WITCH_HAND_SOUNDS.length].id,
    handRate: index ? [.55,1.3,2.4,4.8,.8,3.7,5.6,1.7][index%8] : 1,
    handDepth: index ? .55+(index%5)*.1 : .66,
    spellBalance: values.scene==='fingers' ? [.46,.6,.52,.4][index%4] : [.5,.2,.72,.84,.16,.88,.32,.66][index%8],
    catSpeed: index ? Math.min(2,Number((.52+index*.0279).toFixed(4))) : 1,
    catGait: WITCH_CAT_GAITS[index%WITCH_CAT_GAITS.length],
    treeShape:index%6,
    trailFeedback:index?.38+(index%7)*.08:.55, trailSpace:index?.22+(index%6)*.14:.5,
    flightSpeed:values.speed??WITCH_DEFAULTS.flightSpeed,
    ...values,
    visualMode, trip:visualTrip[visualMode],
    spoonAuto: values.spoonAuto ?? !values.voice,
    spoonHeight: values.spoonHeight ?? (values.voice ? (voices.indexOf(values.voice)+.5)/voices.length : WITCH_DEFAULTS.spoonHeight),
  } };
};
export const WITCH_PRESETS = [
  scene('small-spell', 'A small, suspicious spell', {}),
  scene('secret', 'A secret in the steam', { stirAuto:false, spoonAuto:false, voice:'whisper', palette:4, ghostTempo:54, speed:.2, radius:.22, fingers:[.3,.22,.15,.15,.88] }),
  scene('old-door', 'Older than the door', { stirAuto:false, spoonAuto:false, voice:'creak', palette:1, ghostTempo:45, speed:.22, radius:.37, fingers:[.12,.2,.88,.62,.12], hair:.3 }),
  scene('wicked', 'Something wicked', { voice:'cackle', palette:6, ghostTempo:126, speed:.77, radius:.7, fingers:[.72,.65,.7,.58,.17] }),
  scene('beautiful', 'She remembers a song', { voice:'sing', spellBalance:.12, palette:5, ghostTempo:66, speed:.2, radius:.88, fingers:[.62,.7,.05,.33,.12], glass:.12 }),
  scene('unspell', 'Unspell the spell', { palette:7, trip:1, direction:-1, speed:.7, radius:.34, fingers:[.35,.17,.6,.18,.4], hair:.4 }),
  scene('glass', 'A throat full of glass', { voice:'sing', palette:4, speed:.35, radius:.72, glass:.9, fingers:[.7,.82,.1,.25,.12] }),
  scene('hair', 'A very tangled incantation', { voice:'creak', palette:3, trip:2, speed:.65, radius:.42, hair:.95, fingers:[.4,.28,.78,.85,.2] }),
  scene('fingertips', 'At her fingertips', { handAuto:false, scene:'fingers', spellBalance:.5, palette:2, tone:.68, fingers:[.4,.75,.08,.4,.23] }),
  scene('claws', 'Five crooked little instruments', { handAuto:false, scene:'fingers', palette:7, tone:.25, fingers:[.2,.85,.9,.72,.5] }),
  scene('broom', 'The broom knows the way', { flightSpeed:.65, scene:'flight', spellBalance:.86, palette:6, ghostTempo:108, speed:.65, altitude:.4, flightX:.3, tone:.65 }),
  scene('moon', 'Bells beneath the full moon', { flightSpeed:.02, scene:'flight', spellBalance:.3, palette:4, ghostTempo:48, speed:.25, altitude:.85, flightX:.72, tone:.3 }),
  scene('poison-gold', 'Poison in a golden cup', { voice:'whisper', palette:2, ghostTempo:84, speed:.32, radius:.16, nose:.88, hat:.24, glass:.38, fingers:[.15,.83,.35,.62,.21] }),
  scene('foxglove', 'Foxglove finger dance', { scene:'fingers', palette:3, trip:1, ghostTempo:112, speed:.46, radius:.72, tone:.82, fingers:[.88,.24,.73,.12,.58], nose:.3, hat:.76 }),
  scene('cinder', 'Cinders between her teeth', { voice:'creak', palette:1, ghostTempo:60, speed:.28, radius:.22, tone:.18, hair:.63, nose:.17, hat:.87, fingers:[.21,.41,.86,.72,.14] }),
  scene('cat-shadow', 'Something under the floor', { voice:'mutter', palette:7, ghostTempo:42, speed:.16, radius:.33, tone:.2, nose:.72, hat:.19, fingers:[.43,.16,.62,.3,.76] }),
  scene('violet-thread', 'A violet thread of song', { voice:'sing', palette:5, ghostTempo:78, speed:.26, radius:.96, glass:.27, tone:.64, nose:.41, hat:.32, fingers:[.79,.52,.13,.35,.23] }),
  scene('drowned-bells', 'Bells from a drowned room', { handAuto:false, scene:'fingers', voice:'whisper', palette:4, ghostTempo:57, speed:.21, radius:.47, glass:.56, tone:.38, fingers:[.9,.1,.27,.69,.61], hat:.61 }),
  scene('toad-waltz', 'The toads know a secret', { palette:3, trip:1, ghostTempo:93, speed:.38, radius:.61, hair:.26, nose:.91, hat:.37, fingers:[.12,.64,.49,.8,.34] }),
  scene('mushroom-fever', 'Mushroom fever', { voice:'chatter', spellBalance:.35, palette:2, visualMode:5, ghostTempo:156, speed:.91, radius:.84, hair:.58, glass:.31, tone:.78, nose:.8, hat:.67, fingers:[.76,.32,.91,.59,.87] }),
  scene('silver-nails', 'Silver nails on the window', { scene:'fingers', voice:'creak', palette:4, visualMode:4, ghostTempo:138, speed:.6, radius:.2, tone:.94, glass:.71, fingers:[.33,.18,.67,.96,.46], nose:.22, hat:.69 }),
  scene('backward-lullaby', 'A lullaby said backward', { voice:'sing', palette:7, direction:-1, ghostTempo:51, speed:.23, radius:.81, tone:.43, hair:.19, nose:.64, hat:.22, fingers:[.72,.48,.23,.11,.64] }),
  scene('blood-moon', 'A broom through the blood moon', { flightSpeed:.96, scene:'flight', voice:'wail', spellBalance:.28, palette:6, trip:1, ghostTempo:144, speed:.83, altitude:.91, flightX:.7, tone:.71, nose:.68, hat:.89, fingers:[.82,.53,.67,.91,.28] }),
  scene('low-fog', 'Skimming the low fog', { flightSpeed:.06, scene:'flight', voice:'whisper', spellBalance:.8, palette:4, ghostTempo:63, speed:.32, altitude:.13, flightX:.24, tone:.29, radius:.3, fingers:[.38,.65,.2,.54,.86], nose:.38, hat:.51 }),
  scene('candy-coil', 'Down the candy coil', { trailFeedback:.92, trailSpace:1, trailPull:.84, trailTwist:.54, flightSpeed:1, scene:'flight', palette:5, trip:2, ghostTempo:132, speed:.94, altitude:.28, flightX:.82, radius:.76, glass:.44, hair:.37, fingers:[.7,.9,.18,.46,.67], hat:.78 }),
  scene('green-lightning', 'Green lightning in her sleeves', { scene:'fingers', voice:'chatter', spellBalance:.3, palette:3, visualMode:7, ghostTempo:168, speed:.79, tone:.91, radius:.68, fingers:[.94,.48,.84,.27,.73], nose:.85, hat:.66 }),
  scene('wax-moon', 'The moon melts like wax', { voice:'mutter', palette:1, trip:2, ghostTempo:69, speed:.4, radius:.9, tone:.48, hair:.46, nose:.56, hat:.13, fingers:[.24,.77,.51,.19,.93] }),
  scene('crooked-choir', 'The crooked choir arrives', { voice:'wail', spellBalance:.22, palette:6, trip:1, ghostTempo:105, speed:.5, radius:.93, glass:.6, hair:.22, tone:.58, nose:.76, hat:.74, fingers:[.63,.84,.41,.56,.18] }),
  scene('bone-orchard', 'A wind through the bone orchard', { voice:'wail', spellBalance:.84, palette:2, ghostTempo:39, speed:.12, radius:.58, hair:.78, tone:.17, nose:.12, hat:.92, fingers:[.39,.22,.95,.81,.53] }),
  scene('falling-stars', 'Catch the falling stars', { flightSpeed:.45, scene:'flight', voice:'sing', palette:5, ghostTempo:90, speed:.56, altitude:.76, flightX:.43, glass:.82, radius:.86, tone:.76, fingers:[.91,.67,.24,.42,.78], hat:.46 }),
  scene('night-knots', 'Tie the night in knots', { scene:'fingers', voice:'chatter', spellBalance:.3, palette:7, trip:3, direction:-1, ghostTempo:120, speed:.68, radius:.44, hair:.66, tone:.56, fingers:[.16,.92,.75,.39,.84], nose:.62, hat:.83 }),
  scene('last-spell', 'One last spell before dawn', { stirAuto:false, spoonAuto:false, voice:'sing', palette:0, ghostTempo:36, speed:.14, radius:1, glass:.18, tone:.32, nose:.46, hat:.28, fingers:[.58,.37,.16,.28,.69] }),
  ...WITCH_INGREDIENTS.map((item,index)=>scene(item.presetId,`${item.name} in the brew`,{
    scene:index%3===0?'fingers':'brew', voice:voices[index%voices.length],
    palette:(index*3+1)%8, visualMode:ingredientVisualModes[item.id]??0,
    speed:[.27,.64,.88,.4,.16,.73][index%6], radius:[.91,.26,.6,.44,.78][index%5],
    handMotion:WITCH_HAND_MOTIONS[(index*3+5)%WITCH_HAND_MOTIONS.length],
    handSound:WITCH_HAND_SOUNDS[(index*3+2)%WITCH_HAND_SOUNDS.length].id,
    handRate:[3.1,1.7,4.6,2.3,.64,6,5.6,4.2,3.8,2.7,1.4,5.2,.8,1.1,2.1,3.4,.52,4.9,5.8][index%19],
    handDepth:.65+(index%4)*.1, spellBalance:index%3===0?(voices[index%voices.length]==='chatter'?.3:.52):[.86,.24,.72,.92,.4,.16,.8][index%7], ghostTempo:48+(index%9)*14,
    fingers:Array.from({length:5},(_,finger)=>.12+((index*7+finger*11)%17)/20),
    nose:.15+((index*7)%11)*.07, hat:.18+((index*3)%9)*.08,
    tone:.2+((index*5)%9)*.08, glass:(index%5)*.13, hair:((index+2)%6)*.12,
    fabricX:.22+(index%5)*.14, fabricY:.3+(index%4)*.13,
    trailPull:.2+(index%6)*.13, trailTwist:.17+(index%5)*.16,
    ...(item.id==='puggler'?{handMotion:'frantic-orbit',handSound:'iron-claws',palette:6,ghostTempo:156}:{}),
    ...(item.id==='candy-coil'?{trailFeedback:.94,trailSpace:1,trailPull:.85,trailTwist:.54,flightSpeed:.55}:{}),
    ...(item.id==='hyper-rubix'?{handMotion:'polyrhythmic-tangle',handSound:'bone-glass',handRate:4.4,palette:5,ghostTempo:118}:{}),
  })),
];
const unit = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
export function normalizeWitchPreset(input = {}) {
  if(!input || typeof input!=='object') input={};
  const d = WITCH_DEFAULTS;
  const voice=voices.includes(input.voice)?input.voice:d.voice;
  const spoonAuto=typeof input.spoonAuto==='boolean'?input.spoonAuto:d.spoonAuto;
  let spoonHeight=unit(input.spoonHeight,d.spoonHeight);
  // Saved five-character scenes keep their chosen voice when the spoon gains
  // new zones. Preserve exact heights that still belong to the chosen voice.
  if(!spoonAuto && witchVoiceAtHeight(spoonHeight)!==voice) spoonHeight=(voices.indexOf(voice)+.5)/voices.length;
  return {
    scene: ['brew','fingers','flight'].includes(input.scene) ? input.scene : d.scene,
    voice,
    stirAuto: typeof input.stirAuto==='boolean' ? input.stirAuto : d.stirAuto,
    handAuto: typeof input.handAuto==='boolean' ? input.handAuto : d.handAuto,
    handMotion: WITCH_HAND_MOTIONS.includes(input.handMotion) ? input.handMotion : d.handMotion,
    handSound: WITCH_HAND_SOUNDS.some(sound=>sound.id===input.handSound) ? input.handSound : d.handSound,
    handRate: Number.isFinite(Number(input.handRate)) ? Math.max(.25,Math.min(6,Number(input.handRate))) : d.handRate,
    handDepth: unit(input.handDepth,d.handDepth),
    spellBalance: unit(input.spellBalance,d.spellBalance),
    catGait: WITCH_CAT_GAITS.includes(input.catGait) ? input.catGait : d.catGait,
    catSpeed: Number.isFinite(Number(input.catSpeed)) ? Math.max(.5,Math.min(2,Number(input.catSpeed))) : d.catSpeed,
    fabricX: unit(input.fabricX,d.fabricX), fabricY: unit(input.fabricY,d.fabricY),
    trailPull: unit(input.trailPull,d.trailPull), trailTwist: unit(input.trailTwist,d.trailTwist),
    trailFeedback: unit(input.trailFeedback,d.trailFeedback), trailSpace: unit(input.trailSpace,d.trailSpace),
    // Old saves inherit their former shared pace once; ladle gestures then stay independent.
    flightSpeed: unit(input.flightSpeed,unit(input.speed,d.flightSpeed)),
    speed: Math.max(.02, unit(input.speed,d.speed)), radius: Math.max(.08,unit(input.radius,d.radius)),
    direction: input.direction === -1 ? -1 : 1,
    ghostTempo: Number.isFinite(Number(input.ghostTempo)) ? Math.max(36,Math.min(180,Number(input.ghostTempo))) : d.ghostTempo,
    palette: Number.isFinite(Number(input.palette)) ? Math.round(Math.max(0,Math.min(7,Number(input.palette)))) : d.palette,
    visualMode: Number.isFinite(Number(input.visualMode)) ? Math.round(Math.max(0,Math.min(7,Number(input.visualMode)))) : Number.isFinite(Number(input.trip)) ? Math.round(Math.max(0,Math.min(3,Number(input.trip)))) : d.visualMode,
    treeShape: Number.isFinite(Number(input.treeShape)) ? Math.round(Math.max(0,Math.min(5,Number(input.treeShape)))) : d.treeShape,
    trip: Number.isFinite(Number(input.trip)) ? Math.round(Math.max(0,Math.min(3,Number(input.trip)))) : d.trip,
    fingers: d.fingers.map((value,i) => unit(input.fingers?.[i],value)),
    glass: unit(input.glass,d.glass), hair: unit(input.hair,d.hair), altitude: unit(input.altitude,d.altitude),
    nose: unit(input.nose,d.nose), hat: unit(input.hat,d.hat), spoonHeight, spoonAuto,
    flightX: Math.max(.12,Math.min(.88,unit(input.flightX,d.flightX))), tone: unit(input.tone,d.tone),
  };
}
/** Musical and visual settings exclude the user's stirring/flight choice.
 * Normalize legacy scene-bearing snapshots before capturing their settings. */
export function witchPresetSettings(input = {}) {
  const { scene: _scene, ...settings } = normalizeWitchPreset(input);
  return settings;
}
export const WITCH_SETTING_PRESETS = WITCH_PRESETS.map(preset => ({
  ...preset, snapshot: witchPresetSettings(preset.snapshot),
}));

export function randomizeWitchPreset(previous, random = Math.random) {
  const r = () => unit(random(), .5);
  const snapshot = { handMotion:WITCH_HAND_MOTIONS[Math.min(WITCH_HAND_MOTIONS.length-1,Math.floor(r()*WITCH_HAND_MOTIONS.length))],handSound:WITCH_HAND_SOUNDS[Math.min(WITCH_HAND_SOUNDS.length-1,Math.floor(r()*WITCH_HAND_SOUNDS.length))].id,handRate:.25+r()*5.75,handDepth:r(),spellBalance:r(),catGait:WITCH_CAT_GAITS[Math.min(3,Math.floor(r()*4))],catSpeed:.5+r()*1.5,fabricX:r(),fabricY:r(),trailPull:r(),trailTwist:r(),scene:normalizeWitchPreset(previous).scene, voice:voices[Math.min(voices.length-1,Math.floor(r()*voices.length))], ghostTempo:36+r()*144, palette:Math.min(7,Math.floor(r()*8)), visualMode:randomVisualMode(r()), treeShape:Math.min(5,Math.floor(r()*6)), trip:Math.min(3,Math.floor(r()*4)), speed:.08+r()*.9, radius:.1+r()*.9, direction:r()<.5?-1:1, fingers:Array.from({length:5},r), glass:r(), hair:r(), altitude:r(), flightX:.12+r()*.76, tone:r(), nose:r(), hat:r(), spoonHeight:r(), spoonAuto:r()<.5 };
  snapshot.stirAuto=r()>=.1; snapshot.handAuto=r()>=.1; snapshot.flightSpeed=r(); snapshot.trailFeedback=r(); snapshot.trailSpace=r();
  if(!snapshot.stirAuto) snapshot.spoonAuto=false;
  if(!snapshot.spoonAuto) snapshot.voice=witchVoiceAtHeight(snapshot.spoonHeight);
  return normalizeWitchPreset(snapshot);
}
