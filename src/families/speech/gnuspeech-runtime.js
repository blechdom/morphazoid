// Morphazoid GnuspeechSA WASM bridge. GPL-3.0-or-later; see vendor notices.
import createModule from '../../../vendor/gnuspeech/gnuspeech.js';

export const GNUSPEECH_VOICES = Object.freeze(['male','female','large_child','small_child','baby']);
export const GNUSPEECH_PARAMETER_RANGES = Object.freeze({
  tempo:[.1,10], pitchSemitones:[-24,24], tractLength:[7,22], tractOffset:[-3,3],
  breathiness:[0,100], pulseRise:[10,60], pulseFall:[5,35], radius:[.1,4], nasalRadius:[.1,4],
  controlRate:[50,1000], volumeDb:[0,60], referencePitch:[-48,24], pulseFallMin:[5,35], pulseFallMax:[5,35],
  notionalPitch:[-24,24], pretonicRange:[-24,24], pretonicLift:[-24,24], tonicRange:[-48,48], tonicMovement:[-24,24],
  nose1:[.05,4], nose2:[.05,4], nose3:[.05,4], nose4:[.05,4], nose5:[.05,4],
  loss:[0,100], temperature:[25,40], aperture:[3.05,8], mouthCutoff:[1000,10000], noseCutoff:[1000,10000],
  throatCutoff:[100,5000], throatVolume:[0,60], mixOffset:[30,60], driftDeviation:[0,3], driftCutoff:[.1,5],
});
function bounded(name,value) {
  if(!Number.isFinite(value))throw new TypeError(`${name} must be a finite number.`);
  return value;
}
function replaceSetting(text,key,value) {
  const pattern=new RegExp(`^${key}\\s*=.*$`,'m');
  if(!pattern.test(text))throw new Error(`Missing Gnuspeech configuration: ${key}`);
  return text.replace(pattern,`${key} = ${value}`);
}
export async function createGnuspeech({locateFile,print=()=>{},printErr=()=>{}}={}) {
  const module=await createModule({locateFile:locateFile??(name=>{
    const url=new URL('../../../vendor/gnuspeech/'+name,import.meta.url);
    return url.protocol==='file:'?url.pathname:url.href;
  }),print,printErr});
  const files={};
  for(const name of ['trm.txt','trm_control_model.txt',...GNUSPEECH_VOICES.map(v=>`voice_${v}.txt`)])
    files[name]=module.FS.readFile('/voice/en/'+name,{encoding:'utf8'});
  return {module,files};
}
function configure(engine,options) {
  const voice=options.voice??'male';
  if(!GNUSPEECH_VOICES.includes(voice))throw new RangeError('Unknown Gnuspeech voice.');
  let control=engine.files['trm_control_model.txt'];
  let tract=engine.files['trm.txt'];
  let shape=engine.files[`voice_${voice}.txt`];
  control=replaceSetting(control,'voice_name',voice);
  const mappings={controlRate:['control','control_rate'],volumeDb:['tract','volume'],referencePitch:['shape','reference_glottal_pitch'],
    pulseFallMin:['shape','glottal_pulse_tn_min'],pulseFallMax:['shape','glottal_pulse_tn_max'],
    notionalPitch:['control','notional_pitch'],pretonicRange:['control','pretonic_range'],pretonicLift:['control','pretonic_lift'],tonicRange:['control','tonic_range'],tonicMovement:['control','tonic_movement'],
    nose1:['shape','nose_radius_1'],nose2:['shape','nose_radius_2'],nose3:['shape','nose_radius_3'],nose4:['shape','nose_radius_4'],nose5:['shape','nose_radius_5'],tempo:['control','tempo'],pitchSemitones:['control','pitch_offset'],
    driftDeviation:['control','drift_deviation'],driftCutoff:['control','drift_lowpass_cutoff'],
    tractLength:['shape','vocal_tract_length'],breathiness:['shape','breathiness'],pulseRise:['shape','glottal_pulse_tp'],
    radius:['shape','global_radius_coef'],nasalRadius:['shape','global_nose_radius_coef'],aperture:['shape','aperture_radius'],
    tractOffset:['tract','vocal_tract_length_offset'],loss:['tract','loss_factor'],temperature:['tract','temperature'],
    mouthCutoff:['tract','mouth_coefficient'],noseCutoff:['tract','nose_coefficient'],
    throatCutoff:['tract','throat_cutoff'],throatVolume:['tract','throat_volume'],mixOffset:['tract','mix_offset']};
  for(const [name,[target,key]] of Object.entries(mappings))if(options[name]!=null){
    const value=bounded(name,options[name]);
    if(target==='control')control=replaceSetting(control,key,value);
    else if(target==='shape')shape=replaceSetting(shape,key,value);
    else tract=replaceSetting(tract,key,value);
  }
  if(options.pulseFall!=null){
    const value=bounded('pulseFall',options.pulseFall);
    shape=replaceSetting(replaceSetting(shape,'glottal_pulse_tn_min',value),'glottal_pulse_tn_max',value);
  }
  if(options.regions!=null){
    if(!Array.isArray(options.regions)||options.regions.length!==8)throw new RangeError('regions must contain eight radius multipliers.');
    options.regions.forEach((n,i)=>{shape=replaceSetting(shape,`radius_${i+1}_coef`,bounded('radius',n));});
  }
  for(const [option,key] of Object.entries({drift:'intonation_drift',microIntonation:'micro_intonation',macroIntonation:'macro_intonation',randomIntonation:'random_intonation'}))
    if(options[option]!=null)control=replaceSetting(control,key,options[option]?1:0);
  if(options.waveform!=null){if(!['pulse','sine'].includes(options.waveform))throw new RangeError('waveform must be pulse or sine.');tract=replaceSetting(tract,'waveform',options.waveform==='sine'?1:0);}
  if(options.noiseModulation!=null)tract=replaceSetting(tract,'noise_modulation',options.noiseModulation?1:0);
  if(options.sampleRate!=null){if(!Number.isFinite(options.sampleRate))throw new TypeError('sampleRate must be finite.');tract=replaceSetting(tract,'output_rate',options.sampleRate);}
  engine.module.FS.writeFile('/voice/en/trm_control_model.txt',control);
  engine.module.FS.writeFile('/voice/en/trm.txt',tract);
  engine.module.FS.writeFile(`/voice/en/voice_${voice}.txt`,shape);
}
export function decodeGnuspeechWav(wav) {
  const view=new DataView(wav.buffer,wav.byteOffset,wav.byteLength);
  const tag=i=>String.fromCharCode(...wav.subarray(i,i+4));
  if(wav.length<44||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw new Error('Invalid Gnuspeech WAV.');
  let rate=0,channels=0,bits=0,format=0,offset=0,size=0;
  for(let i=12;i+8<=wav.length;){const len=view.getUint32(i+4,true);if(i+8+len>wav.length)throw new Error('Truncated Gnuspeech WAV.');
    if(tag(i)==='fmt '){format=view.getUint16(i+8,true);channels=view.getUint16(i+10,true);rate=view.getUint32(i+12,true);bits=view.getUint16(i+22,true);}
    if(tag(i)==='data'){offset=i+8;size=len;}i+=8+len+(len&1);
  }
  if(format!==1||channels!==1||bits!==16||!offset||size%2||rate<1)throw new Error('Unsupported Gnuspeech WAV.');
  const samples=new Float32Array(size/2);
  for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(offset+2*i,true)/32768;
  return {samples,sampleRate:rate};
}
/** Synchronous worker API. Full text uses native rhythm/prosody. `phones` is internal Gnuspeech markup. */
export function synthesizeGnuspeech(engine,{text='',phones=null,...options}={}) {
  const input=phones??String(text);
  if(!input.trim()||input.length>2048||/[^\x20-\x7e\n\r\t]/.test(input))throw new RangeError('Gnuspeech expects 1–2048 ASCII characters of English text or phonetic markup.');
  if(input.split(/\s+/).some(token=>token.length>80))throw new RangeError('A Gnuspeech input token is too long.');
  configure(engine,options);
  const m=engine.module;
  try {
    const result=m.ccall('gs_synthesize','number',['string','number'],[input,phones==null?0:1]);
    if(result)throw new Error(m.UTF8ToString(m._gs_error()));
    const wav=m.FS.readFile('/output.wav');
    if(wav.length>16*1024*1024)throw new Error('Gnuspeech output exceeded the limit.');
    const phoneticText=m.FS.readFile('/output.phones',{encoding:'utf8'});
    // These are articulatory posture onsets for the FINAL chunk only, not phone boundaries.
    const postureOnsets=m.FS.readFile('/output.events',{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(line=>{
      const [posture,time]=line.split('\t');return {posture,time:Number(time)/1000};
    });
    return {...decodeGnuspeechWav(wav),phoneticText,postureOnsets,wav};
  } finally {for(const file of ['/output.wav','/output.trm','/output.phones','/output.events'])try{m.FS.unlink(file);}catch{}}
}
