import {test,expect} from '@playwright/test';

test('sample-bank PCM preserves sources, OTO timing, fallback and note controls without arming Audio',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {createSampleBankRenderer}=await import('/src/families/speech/sample-bank-renderer.js');
  const {createVocalzoidSequence}=await import('/src/instruments/vocalzoid/vocalzoid.js');
  const {loadUtauBankFiles}=await import('/src/instruments/vocalzoid/vocalzoid-bank.js');
  const {VocalzoidAudio}=await import('/src/instruments/vocalzoid/vocalzoid-audio.js');
  let liveContexts=0;
  const runtime={OfflineAudioContext,fetch:fetch.bind(globalThis),AudioContext:class {constructor(){liveContexts++;throw Error('Live audio was incorrectly armed');}}};
  const renderer=createSampleBankRenderer({runtime}),results=[];
  const insist=(truth,label)=>{if(!truth)throw Error(label);};
  const stats=(result,label)=>{
   let squares=0,peak=0;for(const value of result.samples){insist(Number.isFinite(value),label+' finite');squares+=value*value;peak=Math.max(peak,Math.abs(value));}
   const rms=Math.sqrt(squares/result.samples.length);insist(rms>.001,label+' audible');insist(peak<=.950001,label+' bounded');
   results.push({label,rms,peak,duration:result.duration,scoreOffsetSeconds:result.scoreOffsetSeconds,customNotes:result.customNotes,openNotes:result.openNotes,kalNotes:result.fallbackNotes,warnings:result.warnings});return result;
  };
  const notes=createVocalzoidSequence('vocalzoid'),request={notes,bpm:120,vibratoCents:0,glideMs:0};
  const kal=stats(await renderer.render(request),'kal');
  insist(kal.fallbackNotes===3,'selected KAL count');
  for(const openBankId of ['air','cicada','quake','bdl','clb','jmk','ksp','slt']){
   const output=stats(await renderer.render({...request,source:'open',openBankId}),openBankId);
   insist(output.openNotes===3&&output.fallbackNotes===0,openBankId+' complete demo coverage');
  }
  // Every partial recipe is disconnected before complete KAL fallback.
  const schedule=VocalzoidAudio.prototype.scheduleOpenNote;
  VocalzoidAudio.prototype.scheduleOpenNote=function(...args){schedule.apply(this,args);return false;};
  const fallback=stats(await renderer.render({...request,source:'open',openBankId:'air'}),'partial-recipe-fallback');
  VocalzoidAudio.prototype.scheduleOpenNote=function(){return false;};
  const cleanFallback=await renderer.render({...request,source:'open',openBankId:'air'});
  VocalzoidAudio.prototype.scheduleOpenNote=schedule;
  insist(fallback.fallbackNotes===3&&fallback.openNotes===0,'forced fallback count');
  let error=0,count=0;
  for(let i=0;i<Math.min(cleanFallback.samples.length,fallback.samples.length);i++){error+=(cleanFallback.samples[i]-fallback.samples[i])**2;count++;}
  const fallbackDifference=Math.sqrt(error/count);
  insist(fallbackDifference<.00001,'partial sources must not double fallback audio: '+fallbackDifference);
  const wav=new ArrayBuffer(44+48000*2),view=new DataView(wav),ascii=(offset,text)=>[...text].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
  ascii(0,'RIFF');view.setUint32(4,wav.byteLength-8,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,48000,true);view.setUint32(28,96000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,96000,true);
  for(let i=0;i<48000;i++)view.setInt16(44+i*2,Math.round(Math.sin(i*220/48000*Math.PI*2)*16000),true);
  const file=(name,data)=>{const value=new File([data],name);Object.defineProperty(value,'webkitRelativePath',{value:'Test/'+name});return value;};
  const bank=await loadUtauBankFiles([file('a.wav',wav),file('oto.ini','a.wav=あ,0,150,-900,80,25\n'),file('character.txt','name=Test sine bank\nauthor=Numerical fixture\n')]);
  const localNote={id:'local',start:0,duration:1,midi:60,lyric:'あ',alias:'あ',phones:[]};
  const local=stats(await renderer.render({notes:[localNote],source:'local',bank,bpm:120,vibratoCents:0,glideMs:0}),'local-kana-oto');
  insist(local.customNotes===1&&local.fallbackNotes===0,'local exact alias used');
  const missing=stats(await renderer.render({notes:[{...localNote,lyric:'missing',alias:'missing'}],source:'local',bank,bpm:120,vibratoCents:0,glideMs:0}),'missing-alias-ah-fallback');
  insist(missing.fallbackNotes===1&&missing.warnings.some(w=>w.includes('uses AH')),'AH fallback explicitly reported');
  const lower=stats(await renderer.render({notes:[{...localNote,rootMidi:72}],source:'local',bank,bpm:120,vibratoCents:0,glideMs:0}),'per-note-root-pitch');
  const frequency=output=>{let crossings=0;const start=Math.round((output.scoreOffsetSeconds+.15)*48000),end=start+12000;for(let i=start+1;i<end;i++)if(output.samples[i-1]<=0&&output.samples[i]>0)crossings++;return crossings*4;};
  const pitchA=frequency(local),pitchB=frequency(lower);insist(Math.abs(pitchA-220)<12&&Math.abs(pitchB-110)<12,'per-note source pitch must retune sample');
  insist(bank.rootMidi===60&&bank.files.size===1,'cached bank is a detached resource copy');
  const frq=new ArrayBuffer(20),frqView=new DataView(frq);[...'FREQ0003'].forEach((c,i)=>frqView.setUint8(i,c.charCodeAt(0)));frqView.setInt32(8,256,true);frqView.setFloat64(12,220,true);
  const pitchedBank=await loadUtauBankFiles([file('a.wav',wav),file('a_wav.frq',frq),file('oto.ini','a.wav=あ,0,150,-900,80,25\n')]);
  const frqA=stats(await renderer.render({notes:[{...localNote,rootMidi:24}],source:'local',bank:pitchedBank,bpm:120,vibratoCents:0,glideMs:0}),'native-frq-pitch');
  const frqB=await renderer.render({notes:[{...localNote,rootMidi:96}],source:'local',bank:pitchedBank,bpm:120,vibratoCents:0,glideMs:0});
  const frqPitch=frequency(frqA);insist(Math.abs(frqPitch-261.6)<12&&Math.abs(frequency(frqB)-frqPitch)<8,'native FRQ pitch takes precedence over fallback root');
  const variants={style:'glass',vibratoCents:65,vibratoRate:7,glideMs:220};
  for(const [parameter,value]of Object.entries(variants)){
   const changed=stats(await renderer.render({...request,vibratoCents:parameter==='vibratoRate'?30:0,notes:notes.map((note,i)=>i===1?{...note,[parameter]:value}:note)}),'per-note-'+parameter);
   const baseline=parameter==='vibratoRate'?await renderer.render({...request,vibratoCents:30}):kal;
   let delta=0;for(let i=0;i<Math.min(changed.samples.length,baseline.samples.length);i++)delta+=Math.abs(changed.samples[i]-baseline.samples[i]);
   insist(delta>1,parameter+' must change audio');
  }
  const trailing=await renderer.render({...request,scoreBeats:9});insist(trailing.scoreDuration===4.5,'trailing rests duration');
  const silence=await renderer.render({notes:[],scoreBeats:3.25,bpm:120,source:'local'});insist(silence.samples.length===78000&&silence.samples.every(x=>x===0),'all-rest PCM');
  renderer.close();insist(liveContexts===0,'no live AudioContext');
  return {results,liveContexts,fallbackDifference,pitchA,pitchB,humanListening:false};
 });
 expect(result.liveContexts).toBe(0);
 expect(result.results.length).toBeGreaterThanOrEqual(18);
 expect(result.fallbackDifference).toBeLessThan(.00001);
});
