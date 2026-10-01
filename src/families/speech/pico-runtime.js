// Independent browser bridge for SVOX Pico's public C API.
import initialize from '../../../vendor/pico/svoxpico.js';
export const PICO_LANGUAGES=Object.freeze({
 'en-US':{text:'en-US_ta.bin',signal:'en-US_lh0_sg.bin'},
 'en-GB':{text:'en-GB_ta.bin',signal:'en-GB_kh0_sg.bin'},
});
const encoder=new TextEncoder();
const escapeMarkup=text=>String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function nativePercent(value,name){if(!Number.isFinite(value))throw new TypeError(`${name} must be finite.`);const percent=Math.round(value*100);if(!Number.isSafeInteger(percent))throw new TypeError(`${name} cannot be represented as a native integer percentage.`);return percent;}
export async function createPico({language='en-US',resources,locateFile}={}){
 const files=PICO_LANGUAGES[language];if(!files)throw new RangeError('Pico supports en-US and en-GB in this bundle.');
 const module=await initialize({locateFile:locateFile??(name=>{const u=new URL('../../../vendor/pico/'+name,import.meta.url);return u.protocol==='file:'?u.pathname:u.href;}),print:()=>{},printErr:()=>{}});
 const m=module,allocations=[];
 const alloc=size=>{const p=m._malloc(size);if(!p)throw Error('Pico allocation failed.');m.HEAPU8.fill(0,p,p+size);allocations.push(p);return p;};
 const string=value=>{const data=encoder.encode(value+'\0'),p=alloc(data.length);m.HEAPU8.set(data,p);return p;};
 const view=()=>new DataView(m.HEAPU8.buffer);
 let system=0,engine=0,disposed=false;
 const systemRef=alloc(4),engineRef=alloc(4),voice=string('VoicesaurusPico');
 const loaded=[];
 function check(code,action){if(code!==0)throw Error(`Pico ${action} failed (${code}).`);}
 function dispose(){if(disposed)return;disposed=true;if(engine)m._pico_disposeEngine(system,engineRef);if(system){m._pico_releaseVoiceDefinition(system,voice);for(const p of loaded)m._pico_unloadResource(system,p);m._pico_terminate(systemRef);}for(const p of allocations)m._free(p);for(const n of [files.text,files.signal])try{m.FS.unlink('/'+n);}catch{}}
 try{
  const arena=alloc(2500000);check(m._pico_initialize(arena,2500000,systemRef),'initialize');system=view().getUint32(systemRef,true);
  for(const [kind,name]of Object.entries({text:files.text,signal:files.signal})){
   let bytes=resources?.[kind];
   if(!bytes){const response=await fetch(new URL('../../../vendor/pico/'+name,import.meta.url));if(!response.ok)throw Error(`Could not load Pico ${name}.`);bytes=new Uint8Array(await response.arrayBuffer());}
   bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
   if(bytes.length<1000||bytes.length>4*1024*1024)throw Error('Invalid Pico resource size.');
   m.FS.writeFile('/'+name,bytes);
   const resourceRef=alloc(4);check(m._pico_loadResource(system,string('/'+name),resourceRef),'resource load');loaded.push(resourceRef);
  }
  check(m._pico_createVoiceDefinition(system,voice),'voice creation');
  for(const resourceRef of loaded){const name=alloc(256);check(m._pico_getResourceName(system,view().getUint32(resourceRef,true),name),'resource name');check(m._pico_addResourceToVoiceDefinition(system,voice,name),'voice resource');}
  check(m._pico_newEngine(system,voice,engineRef),'engine creation');engine=view().getUint32(engineRef,true);
  return{module,language,engine,dispose,get disposed(){return disposed;}};
 }catch(error){dispose();throw error;}
}
/** Full native text/phoneme rendering. Call in a disposable worker for cancellation. */
export function synthesizePico(state,{text='',phones=null,pitch=1,speed=1,volume=.7}={}){
 if(state.disposed)throw Error('Pico has been disposed.');
 const pitchPercent=nativePercent(pitch,'pitch'),speedPercent=nativePercent(speed,'speed'),volumePercent=nativePercent(volume,'volume');
 const input=phones??String(text);
 if(!input.trim()||input.length>2048||input.includes('\0'))throw new RangeError('Pico input must contain 1–2048 characters.');
 const content=phones==null?escapeMarkup(input):`<phoneme alphabet="xsampa" ph="${escapeMarkup(input.replace(/\\/g,'\\\\'))}"/>`;
 const markup=`<pitch level="${pitchPercent}"><speed level="${speedPercent}"><volume level="${volumePercent}">${content}</volume></speed></pitch>\0`;
 const bytes=encoder.encode(markup);if(bytes.length>8192)throw new RangeError('Pico input is too long in UTF-8.');
 const m=state.module,pointers=[];
 const alloc=n=>{const p=m._malloc(n);if(!p)throw Error('Pico allocation failed.');pointers.push(p);return p;};
 const i16=p=>new DataView(m.HEAPU8.buffer).getInt16(p,true);
 let putRef,countRef,typeRef,out,textPtr;
 const chunks=[];let count=0,steps=0;
 function drain(){for(;;){if(++steps>200000)throw Error('Pico synthesis exceeded the work limit.');
   const code=m._pico_getData(state.engine,out,16384,countRef,typeRef);
   if(code!==200&&code!==201)throw Error(`Pico audio generation failed (${code}).`);
   const length=i16(countRef),type=i16(typeRef);
   if(length<0||length>16384||length%2||(length&&type!==1))throw Error('Pico returned invalid audio.');
   if(length){count+=length/2;if(count>16000*120)throw Error('Pico output exceeded two minutes.');const dv=new DataView(m.HEAPU8.buffer,out,length),samples=new Float32Array(length/2);for(let i=0;i<samples.length;i++)samples[i]=dv.getInt16(i*2,true)/32768;chunks.push(samples);}
   if(code===200)break;
 }}
 try{
  putRef=alloc(2);countRef=alloc(2);typeRef=alloc(2);out=alloc(16384);textPtr=alloc(bytes.length);
  m.HEAPU8.set(bytes,textPtr);
  const reset=m._pico_resetEngine(state.engine,0);if(reset!==0)throw Error(`Pico reset failed (${reset}).`);
  for(let pos=0;pos<bytes.length;){const code=m._pico_putTextUtf8(state.engine,textPtr+pos,bytes.length-pos,putRef);if(code!==0)throw Error(`Pico text input failed (${code}).`);const put=i16(putRef);if(put<=0||put>bytes.length-pos)throw Error('Pico made no input progress.');pos+=put;drain();}
  const samples=new Float32Array(count);let offset=0;for(const chunk of chunks){samples.set(chunk,offset);offset+=chunk.length;}
  if(!samples.length)throw Error('Pico returned no speech.');
  return{samples,sampleRate:16000};
 }finally{for(const p of pointers)m._free(p);}
}
