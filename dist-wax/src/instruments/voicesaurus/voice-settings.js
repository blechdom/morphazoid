const musical=new Set(['singer','stk-voicform','csound-fof','csound-vosim','sample-bank']);
const geometry=new Set(['pitch','duration']);
const clone=value=>structuredClone(value);
export const hasNoteVoiceSettings=scene=>musical.has(scene.engine);
const voiceKeys=scene=>Object.keys(scene.values).filter(key=>!geometry.has(key));

function requireNote(scene,index){
 if(!hasNoteVoiceSettings(scene))throw new TypeError('This engine uses whole-score voice settings.');
 const notes=scene.input.phrase?.notes;
 if(!Number.isInteger(index)||index<0||index>=(notes?.length??1))throw new RangeError('Select an existing note.');
 return notes?.[index]??{rest:false,input:scene.input,values:scene.values};
}
export function validateVoiceOverrides(note,controls){
 if(note.voiceOverrides===undefined)return;
 const keys=note.voiceOverrides;
 if(!Array.isArray(keys)||new Set(keys).size!==keys.length||keys.some(key=>typeof key!=='string'||!Object.hasOwn(controls,key)||geometry.has(key)))throw new TypeError('Note voice overrides must name distinct native voice parameters.');
}
/** Legacy snapshots retain their authored differences; opening an editor never
 * mutates or migrates a preset. Explicit pins can equal the global value.
 */
export function noteVoiceOverrideKeys(scene,index){
 const note=requireNote(scene,index);
 return note.voiceOverrides?[...note.voiceOverrides]:voiceKeys(scene).filter(key=>!Object.is(note.values[key],scene.values[key]));
}
export function materializeVoiceNote(scene,index){
 requireNote(scene,index);
 if(!scene.input.phrase){
  const input=clone(scene.input);delete input.singingText;
  scene.input.phrase={tempo:120,notes:[{rest:false,input,values:clone(scene.values)}]};
 }
 return scene.input.phrase.notes[index];
}
function checkPatch(scene,patch){
 for(const [key,value]of Object.entries(patch)){
  if(!Object.hasOwn(scene.values,key)||hasNoteVoiceSettings(scene)&&geometry.has(key))throw new TypeError('Pitch and length belong to the note timeline.');
  if(typeof value!==typeof scene.values[key]||typeof value==='number'&&!Number.isFinite(value))throw new TypeError(`Invalid native voice parameter: ${key}.`);
 }
}
export function nativeVoiceParameterPatch(engine,key,value){
 const patch={[key]:value};
 if(engine==='singer'&&/^(radius\d|glottalReflection|lipReflection|frication|velum)/.test(key))patch.customShape=true;
 if(engine==='singer'&&/^glottis(Harmonics|A|B)$/.test(key))patch.customGlottis=true;
 if(engine==='stk-voicform'&&/^(formant\d|radius\d|gain\d|sweep\d)/.test(key))patch.customFormants=true;
 return patch;
}
export function setGlobalVoiceParameter(scene,key,value){
 const patch=nativeVoiceParameterPatch(scene.engine,key,value);checkPatch(scene,patch);
 // Infer against the old globals, before changing them.
 const inherited=hasNoteVoiceSettings(scene)?scene.input.phrase?.notes.map((note,index)=>({note,keys:noteVoiceOverrideKeys(scene,index)})):null;
 Object.assign(scene.values,patch);
 for(const {note,keys}of inherited??[]){
  note.voiceOverrides=keys;
  for(const [name,next]of Object.entries(patch))if(!keys.includes(name))note.values[name]=next;
 }
 return value;
}
export function setNoteVoicePatch(scene,index,patch){
 checkPatch(scene,patch);
 const keys=new Set(noteVoiceOverrideKeys(scene,index)),note=materializeVoiceNote(scene,index);
 Object.assign(note.values,clone(patch));Object.keys(patch).forEach(key=>keys.add(key));
 note.voiceOverrides=[...keys];return note;
}
export function setNoteVoiceParameter(scene,index,key,value){
 return setNoteVoicePatch(scene,index,nativeVoiceParameterPatch(scene.engine,key,value));
}
export function setNoteVoiceInheritance(scene,index,key,inherit){
 checkPatch(scene,{[key]:scene.values[key]});
 const keys=new Set(noteVoiceOverrideKeys(scene,index)),note=materializeVoiceNote(scene,index);
 if(inherit){keys.delete(key);note.values[key]=clone(scene.values[key]);}else keys.add(key);
 note.voiceOverrides=[...keys];return note;
}
export function inheritGlobalVoice(scene,index){
 const note=materializeVoiceNote(scene,index);
 for(const key of voiceKeys(scene))note.values[key]=clone(scene.values[key]);
 note.voiceOverrides=[];return note;
}
