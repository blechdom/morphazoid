/** Native Sinsy score construction. No audio playback or phoneme-atlas adapter. */
const STEPS = ['C','C','D','D','E','F','F','G','G','A','A','B'];
const SHARPS = new Set([1,3,6,8,10]);
const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

export function sinsyScoreToMusicXml({notes, tempo=100}={}) {
  if (!Array.isArray(notes) || notes.length<1 || notes.length>62) throw new Error('A render supports up to 62 authored notes plus boundary rests.');
  if (!Number.isFinite(tempo)) throw new TypeError('Singing tempo must be finite.');
  let totalTicks=0, pitched=0;
  const parts=notes.map(note=>{
    // Sinsy's native score clock is 480 ticks per quarter note. Convert musical
    // beat units to that integer clock; no musical minimum/maximum is imposed.
    const beats=note.beats??1, ticks=Math.round(beats*480);
    if (!Number.isFinite(beats)||!Number.isSafeInteger(ticks)||ticks<0||ticks>0xffffffff) throw new TypeError('Note duration must fit Sinsy’s native unsigned score-tick type.');
    totalTicks+=ticks;
    if (note.rest || note.midi===null) return `<note><rest/><duration>${ticks}</duration></note>`;
    const octave=Math.floor(note.midi/12)-1;
    if (!Number.isSafeInteger(note.midi)||octave< -2147483648||octave>2147483647) throw new TypeError('Singing pitch must fit Sinsy’s native integer octave type.');
    // Let the native Japanese dictionary decide how to interpret the lyric.
    if (typeof note.lyric!=='string') throw new TypeError('A sung lyric must be text.');
    pitched++;
    const pitchClass=((note.midi%12)+12)%12;
    const articulation=[note.staccato?'<staccato/>':'',note.breath?'<breath-mark/>':''].join('');
    return `<note><pitch><step>${STEPS[pitchClass]}</step>${SHARPS.has(pitchClass)?'<alter>1</alter>':''}<octave>${octave}</octave></pitch><duration>${ticks}</duration>${articulation?`<notations><articulations>${articulation}</articulations></notations>`:''}<lyric><syllabic>single</syllabic><text>${escapeXml(note.lyric)}</text></lyric></note>`;
  });
  if (!pitched) throw new Error('Add at least one sung note.');
  // Sinsy's labeler otherwise inserts an entire silent measure at each end.
  // Short explicit 1/4-beat boundary rests retain natural consonant lead-ins
  // and releases without changing any authored note's pitch or duration.
  if(!notes[0].rest&&notes[0].midi!==null){parts.unshift('<note><rest/><duration>120</duration></note>');totalTicks+=120;}
  if(!notes.at(-1).rest&&notes.at(-1).midi!==null){parts.push('<note><rest/><duration>120</duration></note>');totalTicks+=120;}
  if(!Number.isSafeInteger(totalTicks)||totalTicks>0xffffffff)throw new TypeError('Score duration exceeds the native unsigned tick representation.');
  const gcd=(a,b)=>b?gcd(b,a%b):a,common=gcd(totalTicks,1920)||1;
  // Sinsy normalizes each measure to its time signature. A single measure with
  // the exact phrase length avoids changing the performer's note durations.
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="2.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>480</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>${totalTicks/common}</beats><beat-type>${1920/common}</beat-type></time></attributes><direction><sound tempo="${tempo}"/></direction>${parts.join('')}</measure></part></score-partwise>`;
}

export function validateSinsyMusicXml(xml) {
  if (typeof xml!=='string'||xml.length>65536||!xml.includes('<score-partwise')||/<!|<\s*(?:backup|forward|chord)\b/i.test(xml)) throw new Error('Use a bounded, single-voice MusicXML score without a DTD.');
  const measures=[...xml.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)];
  const notes=[...xml.matchAll(/<note\b[^>]*>([\s\S]*?)<\/note>/g)];
  if (!measures.length||measures.length>16||!notes.length||notes.length>64) throw new Error('Score input exceeds this renderer’s 16-measure/64-note resource budget.');
  if(!/<rest\b/.test(notes[0][1])||!/<rest\b/.test(notes.at(-1)[1]))throw new Error('Add short rests at both ends of the Sinsy score.');
  let beats=4, beatType=4, tempo=100, seconds=0;
  for (const tag of ['divisions','duration','beats','beat-type','octave']) {
    for (const match of xml.matchAll(new RegExp(`<${tag}>([^<]+)</${tag}>`,'g'))) {
      const value=Number(match[1]),signed=tag==='octave';
      if(!Number.isInteger(value)||value<(signed?-2147483648:0)||value>(signed?2147483647:0xffffffff))throw new TypeError(`Sinsy ${tag} must fit its native ${signed?'signed':'unsigned'} 32-bit type.`);
    }
  }
  for (const match of xml.matchAll(/tempo\s*=\s*["']([^"']+)["']/g))if(!Number.isFinite(Number(match[1])))throw new TypeError('Singing tempo must be finite.');
  for (const [,content] of measures) {
    const nextBeats=content.match(/<beats>(\d+)<\/beats>/),nextType=content.match(/<beat-type>(\d+)<\/beat-type>/);
    if(nextBeats)beats=Number(nextBeats[1]);if(nextType)beatType=Number(nextType[1]);
    const tempi=[...content.matchAll(/tempo\s*=\s*["']([^"']+)["']/g)].map(m=>Number(m[1]));
    if(tempi.length)tempo=tempi.at(-1);
    const positiveTempi=[tempo,...tempi].filter(t=>t>0),slowest=Math.min(...positiveTempi);
    if(beatType>0&&Number.isFinite(slowest))seconds+=beats*4/beatType*60/slowest;
  }
  if(seconds>50)throw new Error('Shorten the score or raise its tempo: singing phrases are limited to 50 seconds.');
  return xml;
}

export const SINSY_CONTROLS=Object.freeze({
  alpha:{nativeMin:0,nativeMax:1,label:'Vocal tract / alpha',min:0,max:.999,step:.001,default:.55,group:'Native'},
  semitones:{label:'Pitch shift',min:-96,max:96,step:.1,default:0,unit:'st',group:'Native'},
  speed:{label:'Vocoder frame density',min:.1,max:10,step:.01,default:1,unit:'×',group:'Experimental'},
  volumeDb:{label:'Engine gain',min:-80,max:24,step:.5,default:0,unit:'dB',group:'Native'},
  beta:{nativeMin:0,nativeMax:1,label:'Spectral postfilter',min:0,max:1,step:.01,default:0,group:'Experimental'},
  voicingThreshold:{nativeMin:0,nativeMax:1,label:'Voicing threshold',min:0,max:1,step:.01,default:.5,group:'Experimental'},
  gvWeight:{nativeMin:0,label:'Spectral variation',min:0,max:10,step:.01,default:1,group:'Experimental'},
});
export const SINSY_DEFAULTS=Object.freeze(Object.fromEntries(Object.entries(SINSY_CONTROLS).map(([key,control])=>[key,control.default])));
export function validateSinsyValues(values={}) {
  const out={...SINSY_DEFAULTS,...values};
  for(const key of Object.keys(SINSY_CONTROLS))if(!Number.isFinite(out[key]))throw new TypeError('Sinsy control must be finite: '+key);
  for(const key of Object.keys(values))if(!Object.hasOwn(SINSY_CONTROLS,key))throw new Error('Unknown Sinsy control: '+key);
  return out;
}
