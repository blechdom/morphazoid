/** Musical overrides shared by files, voices and one-shot drawings.
 * Empty objects follow the file. Null removes an override, never means zero.
 * Values are plain data and safe to save; no audio resources live here. */
const field = (id, label, group, min, max, step, value, unit = '', description = '') => Object.freeze({ id, label, group, min, max, step, default: value, unit, appliesTo: 'deck channel sample', ...(description ? { description } : {}) });
export const MIDI_PARAMETER_FIELDS = Object.freeze([
  field('gain', 'Voice gain', 'Mix', 0, 2, .01, 1, '×'),
  field('pan', 'Stereo position', 'Mix', -1, 1, .01, 0),
  field('transpose', 'Voice pitch', 'Pitch', -48, 48, 1, 0, 'semitones', 'Additional pitch shift, including drum-note selection when applied to a drum voice. Notes shifted outside 0–127 are silent.'),
  field('fineTune', 'Fine tuning', 'Pitch', -1200, 1200, 1, 0, 'cents'),
  field('velocityScale', 'Velocity multiplier', 'Notes', 0, 4, .01, 1, '×', 'Changes new note attacks. A zero result silences the note.'),
  field('velocityOffset', 'Velocity offset', 'Notes', -127, 127, 1, 0, '', 'Added after the multiplier; resulting velocities stay within MIDI range.'),
  field('program', 'Instrument program', 'Instrument', 0, 127, 1, 0, '', 'Zero-based General MIDI program; actual patches depend on the loaded SoundFont.'),
  field('bankMSB', 'Bank MSB', 'Instrument', 0, 127, 1, 0),
  field('bankLSB', 'Bank LSB', 'Instrument', 0, 127, 1, 0),
  field('drums', 'Drum bank', 'Instrument', 0, 1, 1, 0, '', '0 selects melodic patches; 1 selects drum patches. Patch availability depends on the SoundFont.'),
  field('bend', 'Pitch wheel', 'Expression', 0, 16383, 1, 8192, '', '8192 is centered. Holds the wheel against embedded pitch automation.'),
  field('bendRange', 'Pitch-wheel range', 'Expression', 0, 24, .01, 2, 'semitones'),
  field('pressure', 'Channel pressure', 'Expression', 0, 127, 1, 0, '', 'Audible response depends on the SoundFont modulators.'),
  field('polyPressure', 'Pressure for each note', 'Expression', 0, 127, 1, 0, '', 'Overrides polyphonic pressure on sounding and new notes; SoundFont dependent.'),
  field('modulationDepth', 'Mod-wheel depth', 'Expression', 0, 1200, 1, 50, 'cents'),
  field('mono', 'Monophonic voice', 'Notes', 0, 1, 1, 0, '', '0 allows chords; 1 lets the latest note take over.')
]);
const ccNames = { 0:'Bank select MSB',1:'Modulation',2:'Breath',4:'Foot',5:'Portamento time',6:'Data entry MSB',7:'Channel volume',8:'Balance',10:'Pan',11:'Expression',12:'Effect control 1',13:'Effect control 2',16:'General purpose 1',17:'General purpose 2',18:'General purpose 3',19:'General purpose 4',32:'Bank select LSB',64:'Sustain pedal',65:'Portamento on',66:'Sostenuto pedal',67:'Soft pedal',68:'Legato pedal',69:'Hold 2',70:'Sound variation',71:'Resonance',72:'Release',73:'Attack',74:'Brightness',75:'Decay',76:'Vibrato rate',77:'Vibrato depth',78:'Vibrato delay',79:'Sound control 10',80:'General purpose 5',81:'General purpose 6',82:'General purpose 7',83:'General purpose 8',84:'Portamento note',88:'Velocity prefix',91:'Reverb send',92:'Tremolo depth',93:'Chorus send',94:'Delay / variation send',95:'Phaser depth',96:'Data increment',97:'Data decrement',98:'NRPN LSB',99:'NRPN MSB',100:'RPN LSB',101:'RPN MSB',120:'All sound off',121:'Reset controllers',122:'Local control',123:'All notes off',124:'Omni off',125:'Omni on',126:'Mono mode',127:'Poly mode' };
export const MIDI_PROCEDURAL_CONTROLLERS = Object.freeze([6,38,96,97,98,99,100,101]);
const procedural = new Set(MIDI_PROCEDURAL_CONTROLLERS);
const defaults = { 7:100,8:64,10:64,11:127,71:64,72:64,73:64,74:64,75:64,76:64,77:64,78:64,81:64,83:64,100:127,101:127 };
export const MIDI_CC_PARAMETERS = Object.freeze(Array.from({ length:120 }, (_, id) => Object.freeze({ ...field(id, `CC ${id} · ${ccNames[id] ?? (id >= 33 && id <= 63 ? `${ccNames[id - 32] ?? `Controller ${id - 32}`} LSB` : 'Undefined / SoundFont mapping')}`, 'MIDI controllers', 0, 127, 1, defaults[id] ?? 0, '', procedural.has(id) ? 'Procedural controller: use a one-time Send action or a complete RPN/NRPN transaction. It is not a persistent override.' : 'Standard MIDI controller value. Undefined and timbre controls only sound when the SoundFont implements their mapping. A held MSB also holds its LSB.'), procedural: procedural.has(id) })));
// SF2 generator numbers and units are taken from the bundled SpessaSynth core.
// Address offsets, sample IDs, sample topology and allocator internals are not musical controls.
export const MIDI_GENERATOR_PARAMETERS = Object.freeze([
  field(5,'Mod LFO → pitch','Modulation',-12000,12000,1,0,'cents'), field(6,'Vibrato LFO → pitch','Modulation',-12000,12000,1,0,'cents'),field(7,'Mod envelope → pitch','Modulation',-12000,12000,1,0,'cents'),
  field(8,'Filter cutoff','Filter',1500,13500,1,13500,'cents', 'Absolute pitch units: 6900 cents = 440 Hz. SoundFont filter, independent of the master filter.'),field(9,'Filter resonance','Filter',0,960,1,0,'cB'),field(10,'Mod LFO → filter','Modulation',-12000,12000,1,0,'cents'),field(11,'Mod envelope → filter','Modulation',-12000,12000,1,0,'cents'),field(13,'Mod LFO → volume','Modulation',-960,960,1,0,'cB'),
  field(15,'SoundFont chorus send','SoundFont sends',0,1000,1,0,'‰'),field(16,'SoundFont reverb send','SoundFont sends',0,1000,1,0,'‰'),field(17,'SoundFont pan','Mix',-500,500,1,0),
  field(21,'Mod LFO delay','Modulation',-12000,5000,1,-12000,'timecents'),field(22,'Mod LFO frequency','Modulation',-16000,4500,1,0,'cents'),field(23,'Vibrato delay','Modulation',-12000,5000,1,-12000,'timecents'),field(24,'Vibrato frequency','Modulation',-16000,4500,1,0,'cents'),
  ...[[25,'Delay',-32768,5000,-32768],[26,'Attack',-32768,8000,-32768],[27,'Hold',-12000,5000,-12000],[28,'Decay',-12000,8000,-12000],[30,'Release',-12000,8000,-12000]].map(([id,name,min,max,value])=>field(id,`${name} · modulation envelope`,'Modulation envelope',min,max,1,value,'timecents','Applies to new note envelopes. 0 timecents = 1 second; 1200 doubles the time.')),
  field(29,'Sustain · modulation envelope','Modulation envelope',0,1000,1,0,'‰ attenuation'),field(31,'Key → modulation hold','Modulation envelope',-1200,1200,1,0,'timecents/key'),field(32,'Key → modulation decay','Modulation envelope',-1200,1200,1,0,'timecents/key'),
  ...[[33,'Delay',5000],[34,'Attack',8000],[35,'Hold',5000],[36,'Decay',8000],[38,'Release',8000]].map(([id,name,max])=>field(id,`${name} · volume envelope`,'Volume envelope',-12000,max,1,-12000,'timecents','Applies to new note envelopes. 0 timecents = 1 second; 1200 doubles the time.')),
  field(37,'Sustain · volume envelope','Volume envelope',0,1440,1,0,'cB attenuation'),field(39,'Key → volume hold','Volume envelope',-1200,1200,1,0,'timecents/key'),field(40,'Key → volume decay','Volume envelope',-1200,1200,1,0,'timecents/key'),
  field(48,'SoundFont attenuation','Mix',0,1440,1,0,'cB'),field(51,'Sample coarse tuning','Sample voice',-120,120,1,0,'semitones'),field(52,'Sample fine tuning','Sample voice',-12700,12700,1,0,'cents'),field(56,'Sample key tracking','Sample voice',0,1200,1,100,'cents/key'),
  field(61,'Sample amplitude adjustment','Mix',-1000,1000,1,0,'‰'),field(62,'Vibrato rate adjustment','Modulation',-1000,1000,1,0,'‰'),field(63,'Vibrato amplitude depth','Modulation',0,1000,1,0,'‰'),field(64,'Vibrato → filter','Modulation',-12000,12000,1,0,'cents'),field(65,'Mod LFO rate adjustment','Modulation',-1000,1000,1,0,'‰'),field(66,'Mod LFO amplitude depth','Modulation',0,1000,1,0,'‰')
]);
const effect = (section,id,label,min,max,value) => field(`${section}.${id}`,label,`SoundFont ${section}`,min,max,1,value,'','Global SoundFont effect. A channel must send signal to this effect to hear it.');
export const MIDI_SYNTH_EFFECT_PARAMETERS = Object.freeze([
  effect('reverb','character','Reverb character',0,7,4),effect('reverb','level','Reverb level',0,127,64),effect('reverb','time','Reverb time',0,127,64),effect('reverb','preLowpass','Reverb input lowpass',0,7,0),effect('reverb','delayFeedback','Reverb delay feedback',0,127,0),effect('reverb','preDelayTime','Reverb predelay · ms',0,127,0),
  effect('chorus','level','Chorus level',0,127,64),effect('chorus','rate','Chorus rate',0,127,3),effect('chorus','depth','Chorus depth',0,127,19),effect('chorus','delay','Chorus delay',0,127,80),effect('chorus','feedback','Chorus feedback',0,120,8),effect('chorus','preLowpass','Chorus input lowpass',0,7,0),effect('chorus','sendLevelToReverb','Chorus → reverb',0,127,0),effect('chorus','sendLevelToDelay','Chorus → delay',0,127,0),
  effect('delay','level','SoundFont delay level',0,127,64),effect('delay','timeCenter','Delay time',0,127,97),effect('delay','timeRatioLeft','Left delay ratio',1,24,1),effect('delay','timeRatioRight','Right delay ratio',1,24,1),effect('delay','levelCenter','Center delay level',0,127,127),effect('delay','levelLeft','Left delay level',0,127,0),effect('delay','levelRight','Right delay level',0,127,0),effect('delay','feedback','SoundFont delay feedback',4,124,80),effect('delay','preLowpass','Delay input lowpass',0,7,0),effect('delay','sendLevelToReverb','Delay → reverb',0,127,0)
]);
const lookup = values => new Map(values.map(value => [String(value.id), value]));
const scalarFields=lookup(MIDI_PARAMETER_FIELDS), ccFields=lookup(MIDI_CC_PARAMETERS.filter(item=>!item.procedural)), generatorFields=lookup(MIDI_GENERATOR_PARAMETERS), effectFields=lookup(MIDI_SYNTH_EFFECT_PARAMETERS);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
function normalized(value, descriptor) { if (!Number.isFinite(Number(value))) return undefined; const bounded=Math.max(descriptor.min,Math.min(descriptor.max,Number(value))); return descriptor.step===1 ? Math.round(bounded) : bounded; }
function sanitizeMap(input, previous, fields) {
  const result={};
  for(const source of [previous,input]) if(plain(source)) for(const [key,value] of Object.entries(source)) {
    const descriptor=fields.get(key); if(!descriptor) continue;
    if(value===null) delete result[key]; else { const next=normalized(value,descriptor); if(next!==undefined) result[key]=next; }
  }
  return result;
}
export function sanitizeMidiParameters(input={},previous={}) {
  if(input===null) return {};
  const result=sanitizeMap(input,previous,scalarFields);
  for(const [key,fields] of [['controllers',ccFields],['generators',generatorFields]]) {
    const map=input?.[key]===null ? {} : sanitizeMap(input?.[key],previous?.[key],fields);
    if(Object.keys(map).length) result[key]=map;
  }
  return result;
}
export function mergeMidiParameters(...layers) { return layers.reduce((result,layer)=>sanitizeMidiParameters(layer??{},result),{}); }
export function sanitizeMidiSynthEffects(input={},previous={}) { return input===null ? {} : sanitizeMap(input,previous,effectFields); }
export const sanitizeSynthEffects=sanitizeMidiSynthEffects;
export function transformMidiNote(note,midi={}) {
  const pitch=(note.note??note.a??60)+(midi.transpose??0);
  return { ...note, note:Math.max(0,Math.min(127,pitch)), velocity:pitch<0 || pitch>127 ? 0 : Math.max(0,Math.min(127,Math.round((note.velocity??note.b??100)*(midi.velocityScale??1)+(midi.velocityOffset??0)))) };
}

export function midiParametersNeedResync(previous = {}, next = {}) {
  return previous?.transpose !== next?.transpose || previous?.drums !== next?.drums || Object.keys(previous?.generators ?? {}).some(key => next?.generators?.[key] === undefined);
}
