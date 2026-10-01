import {STK_PHONE_DATA,SINGER_SHAPE_DATA,SINGER_GLOTTIS_DATA} from '../../../vendor/musical-voices/native-data.js';

const knob=(label,min,value,max,unit='',group='Native',step)=>({label,min,max,default:value,unit,group,...(step?{step}:{})});
const choice=(label,choices,value,group='Native')=>({label,choices,default:value,group});
const common={
 pitch:knob('Pitch',.01,220,11025,'Hz'),duration:knob('Note duration',.01,2,24,'s'),
 amplitude:knob('Note amplitude',0,1,4),attack:knob('Attack',0,.01,12,'s'),decay:knob('Decay',0,.1,12,'s'),sustain:knob('Sustain',0,.8,1),release:knob('Release',0,.15,5,'s'),
 voiced:knob('Voiced excitation',0,.8,4),noise:knob('Noise excitation',0,1,16),
 vibrato:knob('Vibrato depth',0,.01,4),vibratoRate:knob('Vibrato rate',0,6,11025,'Hz'),jitter:knob('Pitch randomness',0,.02,4),
};
export const SINGER_PARAMETER_KEYS=Object.freeze(['radius1','radius2','radius3','radius4','radius5','radius6','radius7','radius8','glottalReflection','lipReflection','fricationPosition','fricationGain','fricationFrequency1','fricationRadius1','fricationFrequency2','fricationRadius2','velum']);
const tractControls={
 ...Object.fromEntries(Array.from({length:8},(_,i)=>[`radius${i+1}`,knob(`Tract radius ${i+1}`,0,1,8,'','Experimental')])),
 glottalReflection:knob('Glottal reflection',-1,.7,1,'','Experimental'),lipReflection:knob('Lip reflection',-1,-.45,1,'','Experimental'),
 fricationPosition:knob('Frication injection position',0,1,8,'section','Experimental',1),fricationGain:knob('Frication gain',0,0,16,'','Experimental'),
 fricationFrequency1:knob('Frication filter 1 frequency',0,0,11025,'Hz','Experimental'),fricationRadius1:knob('Frication filter 1 pole radius',0,0,1.1,'','Experimental'),
 fricationFrequency2:knob('Frication filter 2 frequency',0,0,11025,'Hz','Experimental'),
 // The original rr2 fixture contains32.000004 here with zero frication gain.
 // Preserve it in source selection. Activating such an unstable pole is rejected.
 fricationRadius2:knob('Frication filter 2 pole radius',0,0,32.000004,'','Experimental'),velum:knob('Velum opening',0,0,8,'','Experimental'),
};
const formantControls={};
for(let n=1;n<=4;n++)Object.assign(formantControls,{
 [`formant${n}`]:knob(`Formant ${n} frequency`,0,1000*n,11025,'Hz','Experimental'),
 [`radius${n}`]:knob(`Formant ${n} pole radius`,0,.9,.99999,'','Experimental'),
 [`gain${n}`]:knob(`Formant ${n} gain`,0,1,32,'×','Experimental'),
 [`sweep${n}`]:knob(`Formant ${n} sweep rate`,0,.001,1,'/sample','Experimental'),
});
export const NATIVE_MUSICAL_ENGINES=Object.freeze({
 singer:{
  input:{type:'phone',label:'Original tract shape',choices:Object.keys(SINGER_SHAPE_DATA),default:'ahh'},
  controls:{...common,destination:choice('Destination shape',['hold',...Object.keys(SINGER_SHAPE_DATA)],'hold'),changeTime:knob('Shape/pitch change time',0,.6,24,'s'),pitchSweep:choice('Change pitch during note',[false,true],false),destinationPitch:knob('Destination pitch',.01,330,11025,'Hz'),glottis:choice('Glottal configuration',Object.keys(SINGER_GLOTTIS_DATA),'greekdefault'),
   transition:knob('Tract smoothing pole',0,.998,1),tongueHumpPole:knob('Tongue hump smoothing pole',0,.998,1),tongueTipPole:knob('Tongue tip smoothing pole',0,.998,1),
   jitterRate:knob('Random pitch update rate',0,10,22050,'Hz','Experimental'),tractScale:knob('Tract radius multiplier',0,1,8,'×','Experimental'),
   customShape:choice('Edit original tract parameters',[false,true],false,'Experimental'),...tractControls,
   customGlottis:choice('Edit glottal coefficients',[false,true],false,'Experimental'),glottisHarmonics:{...knob('Glottal harmonics',0,20,199,'partials','Experimental',1),nativeMax:200,nativeMaxExclusive:true,description:'The native algorithm floors the count and uses200 coefficient slots; values below1 create an empty excitation table.'},glottisA:knob('Glottal coefficient A',0,.65,1,'cycle','Experimental'),glottisB:knob('Glottal coefficient B',0,.672472,1,'cycle','Experimental'),glottisTransition:knob('Glottal table crossfade',0,.02,5,'s','Experimental'),
  },
  presets:[
   {id:'native-ahh',label:'Cook ahh',input:{phone:'ahh'},values:{}},
   {id:'nasal-tract',label:'Original nasal tract',input:{phone:'nng'},values:{pitch:160}},
   {id:'pipe',label:'Pipe tract',input:{phone:'pipe1'},values:{pitch:220}},
   {id:'big',label:'Original big fixture',input:{phone:'big'},values:{pitch:100}},
   {id:'whisper',label:'Whisper tract',input:{phone:'wsp'},values:{voiced:0,noise:1.6}},
   {id:'noise-tract',label:'Frication tract',input:{phone:'tt+'},values:{voiced:0,noise:2}},
   {id:'lowbass',label:'Low bass glottis',input:{phone:'ahh'},values:{pitch:75,glottis:'lowbass'}},
   {id:'soprano',label:'Wide glottis',input:{phone:'eee'},values:{pitch:440,glottis:'wide4',vibrato:.035}},
   {id:'rolledr',label:'Rolled-r fixture',input:{phone:'rolledr'},values:{pitch:180}},
   {id:'slow-tongue',label:'Slow tongue trajectory',input:{phone:'euu'},values:{destination:'eee',changeTime:.5,transition:.9998,tongueHumpPole:.9998,tongueTipPole:.9999}},
   {id:'unsteady',label:'Unsteady tract',input:{phone:'aah'},values:{pitch:130,jitter:.05,jitterRate:28}},
   {id:'custom-glottis',label:'Few glottal partials',input:{phone:'ooo'},values:{customGlottis:true,glottisHarmonics:3,glottisA:.48,glottisB:.7}},
  ],
 },
 'stk-voicform':{
  input:{type:'phone',label:'Original STK phoneme',choices:Object.keys(STK_PHONE_DATA),default:'aaa'},
  controls:{...common,destination:choice('Destination phoneme',['hold',...Object.keys(STK_PHONE_DATA)],'hold'),changeTime:knob('Formant/pitch change time',0,.6,24,'s'),pitchSweep:choice('Change pitch during note',[false,true],false),destinationPitch:knob('Destination pitch',.01,330,11025,'Hz'),voiced:knob('Voiced excitation',0,1,4),noise:knob('Noise excitation',0,0,16),vibrato:knob('Vibrato depth',0,.04,4),jitter:knob('Pitch randomness',0,.005,4),
   glide:knob('Pitch sweep rate',0,.001,1,'/sample'),transition:knob('Formant sweep rate',0,.001,1,'/sample'),formantScale:{...knob('Formant frequency multiplier',0,1,8,'×'),description:'Native STK frequencies must remain at or below Nyquist (11025 Hz). Out-of-range combinations are rejected, not silently clipped.'},tilt:knob('Source one-pole tilt',-.99999,.77,.99999),
   voiceGainRate:knob('Voiced gain slew',0,.001,1,'/sample','Experimental'),noiseGainRate:knob('Noise gain slew',0,.001,1,'/sample','Experimental'),sourceZero:knob('Source one-zero coefficient',-4,-.9,4,'','Experimental'),
   customFormants:choice('Edit original formants',[false,true],false,'Experimental'),...formantControls,
  },
  presets:[
   {id:'native-aaa',label:'Original aaa formants',input:{phone:'aaa'},values:{}},
   {id:'ee',label:'Original eee formants',input:{phone:'eee'},values:{}},
   {id:'oo',label:'Original ooo formants',input:{phone:'ooo'},values:{}},
   {id:'sh',label:'Noise through shh',input:{phone:'shh'},values:{}},
   {id:'voiced-noise',label:'Voiced/noise zzz',input:{phone:'zzz'},values:{}},
   {id:'bass',label:'Bass formants',input:{phone:'aww'},values:{pitch:70,formantScale:.7}},
   {id:'high',label:'High singing formants',input:{phone:'eee'},values:{pitch:600,formantScale:1.4}},
   {id:'wide-vibrato',label:'Wide vibrato',input:{phone:'ahh'},values:{vibrato:.15,vibratoRate:4}},
   {id:'slow-glide',label:'Slow pitch glide',input:{phone:'aaa'},values:{pitch:110,pitchSweep:true,destinationPitch:440,changeTime:.5,glide:.0001}},
   {id:'narrow-poles',label:'Long ringing poles',input:{phone:'aaa'},values:{customFormants:true,radius1:.999,radius2:.999,radius3:.999,radius4:.999}},
   {id:'dark',label:'Dark excitation',input:{phone:'ihh'},values:{tilt:.99}},
   {id:'breath',label:'Voiced breath',input:{phone:'hah'},values:{voiced:.4,noise:1.5}},
  ],
 },
});

const stkNative=NATIVE_MUSICAL_ENGINES['stk-voicform'].controls;
Object.assign(stkNative.tilt,{nativeMin:-1,nativeMax:1,nativeMinExclusive:true,nativeMaxExclusive:true});
Object.assign(stkNative.transition,{nativeMin:0,nativeMax:1});
for(const key of ['voiceGainRate','noiseGainRate'])Object.assign(stkNative[key],{nativeMin:0});
for(let n=1;n<=4;n++){Object.assign(stkNative[`formant${n}`],{nativeMin:0,nativeMax:11025});Object.assign(stkNative[`radius${n}`],{nativeMin:0,nativeMax:1,nativeMaxExclusive:true});Object.assign(stkNative[`sweep${n}`],{nativeMin:0,nativeMax:1});}

// Practical dial travel is separate from native limits and exact-value entry.
// In particular a 0–11025 Hz vibrato dial cannot usefully adjust a singing vibrato.
const dragSpans={pitch:[20,2000],destinationPitch:[20,2000],duration:[.01,8],attack:[0,3],decay:[0,3],
 vibrato:[0,.5],vibratoRate:[0,20],jitter:[0,.5],jitterRate:[0,100],noise:[0,4],fricationGain:[0,4],fricationRadius2:[0,1.1]};
for(const spec of Object.values(NATIVE_MUSICAL_ENGINES))for(const [key,[dragMin,dragMax]]of Object.entries(dragSpans))if(spec.controls[key])Object.assign(spec.controls[key],{dragMin,dragMax});
for(const key of ['glide','transition','voiceGainRate','noiseGainRate','sweep1','sweep2','sweep3','sweep4'])Object.assign(stkNative[key],{dragMin:0,dragMax:.01});

export function nativeMusicalDefaults(engine,input={}) {
 const spec=NATIVE_MUSICAL_ENGINES[engine];if(!spec)throw new Error('Unknown native musical voice.');
 const phone=input.phone??spec.input.default;if(!spec.input.choices.includes(phone))throw new Error('Unknown original phone/shape.');
 const p=Object.fromEntries(Object.entries(spec.controls).map(([key,rule])=>[key,rule.default]));
 if(engine==='singer'){
  SINGER_PARAMETER_KEYS.forEach((key,i)=>p[key]=SINGER_SHAPE_DATA[phone][i]);
  p.voiced=new Set(['fff','sss','thh','shh','xxx','wsp','breath','hhh','hoo','kk+','pp+','tt+']).has(phone)?0:.8;
 }else{
  const original=STK_PHONE_DATA[phone];p.voiced=original.voiced;p.noise=original.noise;p.tilt=.97-original.voiced*.2;
  original.formants.forEach(([f,r,g],i)=>{p[`formant${i+1}`]=f;p[`radius${i+1}`]=r;p[`gain${i+1}`]=10**(g/20);});
 }
 return p;
}
