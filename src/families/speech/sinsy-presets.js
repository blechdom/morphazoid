import {SINSY_DEFAULTS} from './sinsy-score.js';
const notes=(lyrics,pitches,beats=1,extra={})=>lyrics.map((lyric,index)=>({lyric,midi:pitches[index%pitches.length],beats:Array.isArray(beats)?beats[index]:beats,...extra}));
const make=(id,label,score,values={})=>({id:'sinsy-'+id,label,values:{...SINSY_DEFAULTS,...values},score});
export const SINSY_PRESETS=Object.freeze([
  make('solfege','Solfege rise',{tempo:112,notes:notes(['ど','れ','み','ふぁ','そ','ら','し','ど'],[60,62,64,65,67,69,71,72])}),
  make('sakura','Sakura · cherry blossom',{tempo:90,notes:notes(['さ','く','ら'],[69,69,71],[1,1,2])}),
  make('vowels','Five Japanese vowels',{tempo:96,notes:notes(['あ','い','う','え','お'],[65],1.5)}),
  make('sustain','Long vowel',{tempo:80,notes:notes(['あ'],[69],6)},{volumeDb:-12,gvWeight:.5}),
  make('staccato','Staccato syllables',{tempo:150,notes:notes(['た','か','た','か','た','か','た','か'],[65,67,69,72],.5,{staccato:true})}),
  make('breath','Breathing phrases',{tempo:90,notes:notes(['は','な','ら','ら'],[64,67,71,67],1.5,{breath:true})}),
  make('alto','Low register',{tempo:100,notes:notes(['ら','ら','る','ら'],[55,60,59,55],[1,1,1,2])},{alpha:.58,semitones:-3}),
  make('glass','Glass soprano',{tempo:120,notes:notes(['り','ら','り','る','ら','り'],[72,76,79,76,74,72],.75)},{alpha:.45,beta:.3,gvWeight:1.25}),
  make('whisper','Unvoiced score',{tempo:100,notes:notes(['さ','し','す','せ','そ'],[64,65,67,69,72],1)},{voicingThreshold:1,gvWeight:1.25}),
  make('contour','Wide leaps',{tempo:100,notes:notes(['あ','お','あ','お'],[60,72,64,76],[1,1,1,2])},{gvWeight:.5,volumeDb:-12}),
]);
