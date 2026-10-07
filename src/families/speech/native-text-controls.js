// Native units throughout. Defaults retain the upstream voice's phrase prosody.
const knob=(label,min,defaultValue,max,unit='',step=.01,group='Native')=>({label,min,max,default:defaultValue,unit,step,group});
const choice=(label,choices,defaultValue,group='Native')=>({label,choices,default:defaultValue,group});
const toggle=(label,value=true)=>choice(label,[false,true],value);
export const ESPEAK_FORMANT_VARIANTS=["default", "Alex", "Alicia", "Andrea", "Andy", "Annie", "AnxiousAndy", "Demonic", "Denis", "Diogo", "Gene", "Gene2", "Henrique", "Hugo", "Jacky", "Lee", "Marco", "Mario", "Michael", "Mike", "Mr serious", "Nguyen", "RicishayMax", "RicishayMax2", "RicishayMax3", "Storm", "Tweaky", "anika", "anikaRobot", "antonio", "aunty", "belinda", "boris", "croak", "ed", "f1", "f2", "f3", "f4", "f5", "fast", "grandma", "grandpa", "gustave", "ian", "iven", "iven2", "iven3", "iven4", "john", "kaukovalta", "linda", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "marcelo", "max", "michel", "miguel", "norbert", "pablo", "paul", "pedro", "quincy", "rob", "robert", "robosoft4", "robosoft5", "robosoft6", "robosoft7", "robosoft8", "sandro", "shelby", "steph", "steph2", "steph3", "travis", "victor", "whisper", "whisperf", "zac"];
export const ESPEAK_KLATT_VARIANTS=["Reed", "UniRobot", "adam", "announcer", "benjamin", "caleb", "david", "edward", "edward2", "klatt", "klatt2", "klatt3", "klatt4", "klatt5", "klatt6", "mike2", "robosoft", "robosoft2", "robosoft3"];
const espeakControls={
 language:choice('English pronunciation',['en-us','en-gb'],'en-us'),
 rate:knob('Speaking rate',80,175,450,'words/min',1),
 pitch:knob('Pitch',0,50,99,'',1),range:knob('Pitch range',0,50,99,'',1),
 volume:knob('Engine amplitude',0,100,400,'%',1,'Experimental'),
 wordGap:knob('Word gap',0,0,1000,'10 ms units',1),
 punctuation:choice('Speak punctuation',['none','all','some'],'none'),
 punctuationSet:choice('Punctuation set',['.,;:!?','.,;:!?()[]{}','+-=*/@#%&'],'.,;:!?'),
 capitals:{...knob('Capital cues',0,0,200,'',1),description:'0: off; 1: sound icon; 2: spell capitals; 3 and above: raise pitch by this many Hz.'},
 intonation:choice('Intonation group',[0,1,2,3,4],0,'Experimental'),
 emphasizeAllCaps:toggle('Emphasize ALL CAPS',false),
 emphasizePenultimate:toggle('Emphasize penultimate stress',false),
 emphasis:choice('Phrase emphasis',['none','reduced','moderate','strong','x-strong'],'none'),
 interpretation:choice('Text interpretation',['text','characters'],'text'),
};
const fliteControls=(pitch,spread)=>({
 rate:knob('Speaking rate',.1,1,10,'×'),
 pitch:knob('Mean pitch',50,pitch,700,'Hz',1),
 pitchRange:knob('Pitch deviation',0,spread,350,'Hz',1),
});
const gnuControls={
 voice:choice('Physical voice',['male','female','large_child','small_child','baby'],'male'),
 tempo:knob('Speaking tempo',.1,1,10,'×'),pitchSemitones:knob('Pitch offset',-24,-4,24,'st'),
 tractLength:knob('Vocal tract length',7,17.5,22,'cm'),tractOffset:knob('Length offset',-3,0,3,'cm',.01,'Experimental'),
 breathiness:knob('Breathiness',0,.5,100,'%'),pulseRise:knob('Glottal opening',10,40,60,'%',.1),
 pulseFallMin:knob('Glottal closing minimum',5,24,35,'%',.1),pulseFallMax:knob('Glottal closing maximum',5,24,35,'%',.1),waveform:choice('Glottal waveform',['pulse','sine'],'pulse'),
 referencePitch:knob('Reference glottal pitch',-48,-12,24,'st',.1,'Experimental'),volumeDb:knob('Engine level',0,60,60,'dB',.1,'Experimental'),
 radius:knob('Global tract radius',.1,1,4,'×'),nasalRadius:knob('Global nasal radius',.1,1,4,'×'),
 ...Object.fromEntries(Array.from({length:8},(_,i)=>['region'+(i+1),knob('Tract region '+(i+1),.1,1,4,'×',.01,'Experimental')])),
 ...Object.fromEntries([1.35,1.96,1.91,1.3,.73].map((value,i)=>['nose'+(i+1),knob('Nasal section '+(i+1),.05,value,4,'cm',.01,'Experimental')])),
 loss:knob('Tube loss',0,.8,100,'%',.01,'Experimental'),temperature:knob('Air temperature',25,32,40,'°C',.1,'Experimental'),
 aperture:knob('Mouth aperture radius',3.05,3.05,8,'cm',.01,'Experimental'),
 mouthCutoff:knob('Mouth radiation cutoff',1000,5000,10000,'Hz',10),noseCutoff:knob('Nose radiation cutoff',1000,5000,10000,'Hz',10),
 throatCutoff:knob('Throat cutoff',100,1500,5000,'Hz',10),throatVolume:knob('Throat level',0,6,60,'dB',.1),
 mixOffset:knob('Noise mix offset',30,48,60,'dB',.1),noiseModulation:toggle('Modulate breath noise'),
 microIntonation:toggle('Micro intonation'),macroIntonation:toggle('Phrase intonation'),randomIntonation:toggle('Random intonation'),drift:toggle('Pitch drift'),
 driftDeviation:knob('Drift amount',0,.5,3,'st'),driftCutoff:knob('Drift cutoff',.1,.5,5,'Hz'),
 controlRate:knob('Articulation control rate',50,250,1000,'Hz',1,'Experimental'),
 notionalPitch:knob('Notional pitch',-24,2,24,'st'),pretonicRange:knob('Pretonic range',-24,-2,24,'st'),
 pretonicLift:knob('Pretonic lift',-24,4,24,'st'),tonicRange:knob('Tonic range',-48,-8,48,'st'),tonicMovement:knob('Tonic movement',-24,4,24,'st'),
};
export const NATIVE_TEXT_ENGINES=Object.freeze({
 espeak:{name:'eSpeak NG',family:'Rule-based formant speech',controls:{...espeakControls,variant:choice('Voice variant',ESPEAK_FORMANT_VARIANTS,'default')}},
 'espeak-klatt':{name:'eSpeak NG Klatt',family:'Klatt formant speech',controls:{...espeakControls,variant:choice('Klatt variant',ESPEAK_KLATT_VARIANTS,'klatt')}},
 'flite-slt':{name:'Flite SLT',family:'Clustergen statistical speech',controls:fliteControls(172,27)},
 'flite-awb':{name:'Flite AWB',family:'Clustergen statistical speech',controls:fliteControls(132,25)},
 'flite-rms':{name:'Flite RMS',family:'Clustergen statistical speech',controls:fliteControls(98,24)},
 'flite-kal':{name:'Flite KAL',family:'LPC-residual diphone speech',controls:fliteControls(95,11)},
 'flite-kal16':{name:'Flite KAL16',family:'LPC-residual diphone speech',controls:fliteControls(95,11)},
 gnuspeech:{name:'Gnuspeech',family:'Articulatory text-to-speech',controls:gnuControls},
 pico:{name:'SVOX Pico',family:'Compact parametric speech',controls:{language:choice('English model',['en-US','en-GB'],'en-US'),pitch:knob('Pitch',.5,1,2,'×'),speed:knob('Speaking rate',.2,1,5,'×'),volume:knob('Engine amplitude',0,.4,5,'×')}},
 hts:{name:'HTS HMM voice',family:'Hidden Markov model speech',controls:{speed:knob('Speaking rate',.1,1,10,'×'),semitones:knob('Pitch offset',-96,0,96,'st'),beta:knob('Spectral postfilter',0,0,1),voicingThreshold:knob('Voicing threshold',0,.5,1),gvWeight:knob('Spectral global variance',0,1,10),f0GvWeight:knob('Pitch global variance',0,1,10),alpha:knob('Vocoder spectral warping',0,.55,.999,'',.001,'Experimental'),framePeriod:knob('Vocoder frame period',16,240,2048,'samples',1,'Experimental'),sampleRate:choice('Vocoder sample rate',[8000,16000,22050,32000,44100,48000,96000],48000,'Experimental'),volumeDb:knob('Engine level',-80,0,24,'dB',.1,'Experimental')}},
});
// These describe upstream clamping, not adapter validation. Exact user values
// are still sent to native code. min/max above are only initial view intervals.
const clamps={
 espeak:{pitch:[0,99],range:[null,99]},
 'espeak-klatt':{pitch:[0,99],range:[null,99]},
 pico:{pitch:[.5,2],speed:[.2,5],volume:[0,5]},
 gnuspeech:{volumeDb:[0,60],throatVolume:[0,60]},
 hts:{alpha:[0,1],beta:[0,1],voicingThreshold:[0,1],gvWeight:[0,null],f0GvWeight:[0,null],speed:[.000001,null],framePeriod:[1,null],sampleRate:[1,null]},
};
// These are numeric native setters, not finite menus of permitted values.
NATIVE_TEXT_ENGINES.hts.controls.sampleRate={label:'Vocoder sample rate',min:8000,max:96000,default:48000,step:1,nativeStep:1,unit:'Hz',group:'Experimental'};
NATIVE_TEXT_ENGINES.hts.controls.framePeriod.nativeStep=1;
for(const engine of ['espeak','espeak-klatt']){
 NATIVE_TEXT_ENGINES[engine].controls.intonation={label:'Intonation group',min:0,max:4,default:0,step:1,nativeStep:1,group:'Experimental'};
 for(const key of ['rate','pitch','range','volume','wordGap','capitals'])NATIVE_TEXT_ENGINES[engine].controls[key].nativeStep=1;
 NATIVE_TEXT_ENGINES[engine].controls.punctuationSet.freeText=true;
}
for(const [engine,controls]of Object.entries(clamps))for(const [key,[min,max]]of Object.entries(controls)){
 const spec=NATIVE_TEXT_ENGINES[engine].controls[key];
 if(min!==null)spec.nativeMin=min;if(max!==null)spec.nativeMax=max;
 spec.nativeLimitBehavior='The native library applies its own clamp or markup range behavior; input is forwarded unchanged.';
}
export function nativeTextDefaults(engine){
 const spec=NATIVE_TEXT_ENGINES[engine];if(!spec)throw new RangeError('Unknown native text engine: '+engine);
 return Object.fromEntries(Object.entries(spec.controls).map(([key,rule])=>[key,rule.default]));
}
export function validateNativeTextValues(engine,values={}){
 if(!values||typeof values!=='object'||Array.isArray(values))throw new TypeError('Native controls must be an object.');
 const result=nativeTextDefaults(engine),controls=NATIVE_TEXT_ENGINES[engine].controls;
 for(const [key,value]of Object.entries(values)){
  const rule=controls[key];if(!rule)throw new RangeError('Unknown '+engine+' control: '+key);
  // min/max are initial knob display intervals, never adapter clamps. Numeric
  // values go to the native library, which accepts, rejects or clamps them.
  if(typeof rule.default==='number'?!Number.isFinite(value):typeof value!==typeof rule.default)throw new TypeError('Invalid '+engine+' control type: '+key);
  if(typeof rule.default==='string'&&key!=='punctuationSet'&&rule.choices&&!rule.choices.includes(value))throw new RangeError('Unknown native '+key+': '+value);
  result[key]=value;
 }
 return result;
}
