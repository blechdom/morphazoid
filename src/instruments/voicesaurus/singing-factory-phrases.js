import { nativeMusicalDefaults } from '../../families/speech/native-musical-controls.js';

// Authored demonstrations, not a pitch quantizer or a historical score. Ratios
// retain each sound's original register; every frequency remains editable.
const contours={
 call:[[1,1],[9/8,1],[4/3,1],[7/6,1],[9/8,1],[1,3]],
 low:[[1,1.5],[6/7,.5],[3/4,1],[1,1],[9/8,1],[1,3]],
 turn:[[1,1],[8/7,.5],[7/6,.5],[4/3,1],[8/7,1],[1,2]],
 float:[[1,1],[7/6,1],[4/3,1.5],[8/7,.5],[9/8,1],[1,3]],
 steps:[[1,.5],[9/8,.5],[1,1],[7/6,.5],[4/3,.5],[1,3]],
 leap:[[1,1],[3/2,1],[8/7,1],[7/4,1],[4/3,1],[1,3]],
 slow:[[1,1.5],[8/7,1.5],[4/3,1.5],[1,3.5]],
 falling:[[1,1],[8/9,1],[3/4,1],[6/7,1],[8/9,1],[1,3]],
};
// Repeated fixtures demonstrate pitch/rhythm; changing shapes use only the
// original Singer/STK tables. The first note retains the named preset sound.
const shapes={
 'singer-native-ahh':['call',112,'ahh ooo ehh eee ooo ahh'],
 'singer-nasal-tract':['low',104,'nng mmm ooo nng mmm ahh'],
 'singer-pipe':['turn',120,'pipe1'],
 'singer-big':['low',96,'big'],
 'singer-whisper':['float',104,'wsp ahh hoo ooo wsp ahh'],
 'singer-noise-tract':['steps',120,'tt+ ahh tt+ eee shh ooo'],
 'singer-lowbass':['low',100,'ahh ooo aww ahh ooo ahh'],
 'singer-soprano':['leap',108,'eee ehh ahh eee ooo eee'],
 'singer-rolledr':['turn',116,'rolledr ahh rolledro ooo rolledr ahh'],
 'singer-slow-tongue':['slow',96,'euu'],
 'singer-unsteady':['falling',108,'aah ooo ehh aah ooo aah'],
 'singer-custom-glottis':['float',112,'ooo ahh eee ooo ehh ooo'],
 'stk-voicform-native-aaa':['call',112,'aaa ooo ehh eee ooo aaa'],
 'stk-voicform-ee':['turn',112,'eee ihh ehh eee ooo eee'],
 'stk-voicform-oo':['float',108,'ooo uuu aww ooo uhh ooo'],
 'stk-voicform-sh':['steps',120,'shh aaa shh eee shh ooo'],
 'stk-voicform-voiced-noise':['steps',112,'zzz aaa zhh eee zzz ooo'],
 'stk-voicform-bass':['low',100,'aww ooo uhh aww ooo aww'],
 'stk-voicform-high':['leap',112,'ahh eee aaa ahh ooo ahh'],
 'stk-voicform-wide-vibrato':['float',96,'ahh ooo eee ahh ehh ahh'],
 'stk-voicform-slow-glide':['slow',96,'aaa ooo eee aaa'],
 'stk-voicform-narrow-poles':['falling',108,'aaa'],
 'stk-voicform-dark':['low',112,'ihh ooo uhh ihh aww ihh'],
 'stk-voicform-breath':['float',104,'hah ahh hoo ooo hee eee'],
};
const vowelContours=['call','turn','float','low','leap','steps','slow','falling'];
const vowelTempos=[112,120,108,100,108,120,96,112];

/** Expand main factory scenes only. The root remains the calibrated sound used
 * by the focused note menu; auditions and user-authored scenes are untouched.
 */
export function withFactorySingingPhrase(scene,id,overrides={}) {
 if(scene.input.phrase)return scene;
 const native=shapes[id],csound=scene.engine.startsWith('csound-');
 if(!native&&!csound)return scene;
 const variant=csound?Number(id.split('-').at(-1))-1:0;
 const [contour,tempo,phones]=native??[vowelContours[variant],vowelTempos[variant],''];
 if(!contours[contour])throw new Error(`Missing factory singing phrase: ${id}`);
 const sequence=phones.split(' '),notes=contours[contour].map(([ratio,beats],index)=>{
  const phone=native?sequence[index%sequence.length]:undefined;
  const input=native?{phone}:{};
  const values=native?{...nativeMusicalDefaults(scene.engine,input),...overrides}:{...scene.values};
  values.pitch=scene.values.pitch*ratio;values.duration=beats*60/tempo;
  // Transpose an authored within-note sweep along with the melody.
  if(values.pitchSweep)values.destinationPitch=scene.values.destinationPitch*ratio;
  // Breath/consonant presets keep their original unvoiced attacks and answer
  // with voiced vowel anchors: voiced:0 on these Singer vowels would be silent.
  if(['singer-whisper','singer-noise-tract'].includes(id)&&['ahh','eee','ooo'].includes(phone))values.voiced=id==='singer-whisper'?.3:.8;
  if(csound&&index>0){
   // Vowel-like movement around the named spectrum, including metal/whistle
   // extremes. These are formant controls, not an invented phoneme frontend.
   const motion=[[.8,1.12,.97],[1.15,.88,1.03],[.72,1.25,1.06],[.9,1.08,.98],[1,1,1]][(index-1)%5];
   motion.forEach((scale,n)=>values[`formant${n+1}`]=scene.values[`formant${n+1}`]*scale);
   // This whistle contour concentrates FOF grains on strong harmonics. Fixed
   // authored note gains keep its second/third vowels near the phrase's level.
   if(id==='csound-fof-8')values.amplitude*=[1,.25,.6,1,1,1][index];
  }
  return {rest:false,input,values};
 });
 return {...scene,input:{...scene.input,phrase:{tempo,notes}}};
}
