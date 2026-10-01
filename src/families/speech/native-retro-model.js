import {VIZSN_NATIVE_PHONES} from './native-retro.js';
const knob = (label,min,max,value,step=1,unit='') => ({label,min,max,default:value,step,unit,group:'Native'});
const choice = (label,choices,value,unit='') => ({label,choices,default:value,unit,group:'Native'});
const f1=[150,162,174,188,202,217,233,250,267,286,305,325,346,368,391,415,440,466,494,523,554,587,622,659,698,740,784,830,880,932,988,1047];
const f2=[440,466,494,523,554,587,622,659,698,740,784,830,880,932,988,1047,1100,1179,1254,1337,1428,1528,1639,1761,1897,2047,2214,2400,2609,2842,3105,3400];
const f3=[1179,1337,1528,1761,2047,2400,2842,3400];
const bandwidth=[50,125,309,726];
const amplitude=[0,.008,.011,.016,.022,.031,.044,.062,.088,.125,.177,.25,.354,.5,.707,1];
const vizsnDefaults={voiceType:6,pitchHz:98,rate:1,seed:1};
const meaDefaults={formant1:698,formant2:1179,formant3:2400,bandwidth1:125,bandwidth2:125,bandwidth3:125,bandwidth4:125,amplitude:.5,frameMs:32,pitchDelta:0,noise:false,pitchHz:120,seed:1};
const preset=(engine,id,label,values,input)=>({id:`${engine}-${id}`,label,values:{...(engine==='vizsn'?vizsnDefaults:meaDefaults),...values},input});
export const NATIVE_RETRO_MODELS = Object.freeze({
 vizsn:{
  name:'Vizsn', inputMode:'native-letters', defaultInput:{mode:'text',text:'a ä e ö o i y u'},
  nativePhones:VIZSN_NATIVE_PHONES,
  inputDescription:'Vizsn’s original letter mapping or its 20 native sounds. This is not English text-to-speech. Use H before a vowel to hear aspiration.',
  controls:{
   voiceType:choice('Excitation',[0,1,2,3,4,5,6,7,8,9],6),
   pitchHz:{...knob('Phase pitch',35,450,98,1,'Hz'),description:'Original signed phase increment, expressed as Hz. Zero, reverse and aliased pitches are available; the only numeric bound is the native signed 32-bit increment.'},
   rate:{...knob('Phone timing',.4,3,1,.01,'×'),group:'Host',description:'Host extension: scales original phone hold and transition times. Any positive native-float rate; very fast timing can produce zero samples.'},
   seed:{...knob('Noise seed',0,65535,1),nativeStep:1,nativeMin:0,nativeMax:4294967295,description:'Deterministic host seed for the native pseudorandom excitation.'},
  },
  presets:[
   preset('vizsn','vowels','Viznut’s vowel bank',{}, {mode:'text',text:'a ä e ö o i y u'}),
   preset('vizsn','bits','Bit-pattern voice',{voiceType:0,pitchHz:70},{mode:'phones',phones:'m a n e ng o r u'}),
   preset('vizsn','airy','Air circuit',{voiceType:1,pitchHz:150},{mode:'phones',phones:'h a h e h i h o h u'}),
   preset('vizsn','burble','Burbling resonances',{voiceType:2,pitchHz:85,rate:.7},{mode:'phones',phones:'r a r oe l u j i'}),
   preset('vizsn','squared','Squared phase whisper',{voiceType:4,pitchHz:180},{mode:'text',text:'a ä e ö o i y u'}),
   preset('vizsn','moving','Moving pulse',{voiceType:5,pitchHz:240,rate:1.4},{mode:'phones',phones:'k a t e p i k o t u'}),
   preset('vizsn','robot','Robot pulse',{voiceType:7,pitchHz:80,rate:1.2},{mode:'text',text:'ta ka pa na ma ra'}),
   preset('vizsn','noise','Noise through formants',{voiceType:9,pitchHz:140,rate:.8},{mode:'phones',phones:'s a v e s i l o m u'}),
  ],
 },
 mea8000:{
  name:'MEA8000',inputMode:'frame-note',defaultInput:{durationMs:512},
  inputDescription:'A note made from actual quantized chip frames. The fourth formant is fixed at 3500 Hz. No text or speech ROM is implied.',
  noteDuration:{label:'Note length',min:64,max:2000,default:512,step:8,unit:'ms'},
  controls:{
   pitchHz:{...knob('Initial pitch',0,510,120,2,'Hz'),nativeStep:2,nativeMin:0,nativeMax:510,description:'Native 8-bit initial pitch register, in 2 Hz steps. Frame increments then accumulate in the emulator’s unsigned 16-bit pitch register.'},
   formant1:choice('Formant 1',f1,698,'Hz'),formant2:choice('Formant 2',f2,1179,'Hz'),formant3:choice('Formant 3',f3,2400,'Hz'),
   bandwidth1:choice('Bandwidth 1',bandwidth,125,'Hz'),bandwidth2:choice('Bandwidth 2',bandwidth,125,'Hz'),bandwidth3:choice('Bandwidth 3',bandwidth,125,'Hz'),bandwidth4:choice('Bandwidth 4',bandwidth,125,'Hz'),
   amplitude:choice('Amplitude',amplitude,.5),frameMs:choice('Frame length',[8,16,32,64],32,'ms'),
   pitchDelta:{...knob('Pitch increment',-15,15,0,1,'code'),nativeMin:-15,nativeMax:15,description:'Signed native increment. One step is 1/2/4/8 Hz at 8/16/32/64 ms per frame.'},
   noise:choice('Noise excitation',[false,true],false),
   seed:{...knob('Noise seed',0,65535,1),nativeStep:1,nativeMin:0,nativeMax:4294967295,description:'Deterministic host seed for the native noise table.'},
  },
  presets:[
   preset('mea8000','open','Open chip vowel',{}, {durationMs:512}),
   preset('mea8000','closed','Closed back vowel',{pitchHz:90,amplitude:.088,formant1:346,formant2:740,formant3:2400},{durationMs:640}),
   preset('mea8000','front','Bright front vowel',{pitchHz:180,formant1:305,formant2:2214,formant3:2842},{durationMs:512}),
   preset('mea8000','narrow','Narrow resonances',{bandwidth1:50,bandwidth2:50,bandwidth3:50,bandwidth4:50,amplitude:.354},{durationMs:640}),
   preset('mea8000','noise','Unvoiced chip hiss',{noise:true,formant1:932,formant2:2609,formant3:3400,bandwidth1:309,bandwidth2:309,bandwidth3:309,bandwidth4:309,amplitude:.088},{durationMs:384}),
   preset('mea8000','rising','Rising pitch frames',{pitchHz:80,pitchDelta:1,frameMs:32},{durationMs:768}),
   preset('mea8000','falling','Falling pitch frames',{pitchHz:300,amplitude:.707,pitchDelta:-1,frameMs:32,formant1:830,formant2:1639},{durationMs:768}),
   preset('mea8000','coarse','Coarse 64 ms frames',{pitchHz:80,amplitude:.707,pitchDelta:1,frameMs:64,formant1:880,formant2:1897,formant3:2842},{durationMs:768}),
  ],
 },
});
