import { randomize } from './full-presets.js';
import { NATIVE_METHODS, defaultScene, defaultsFor, validateScene, voiceModeForEngine, methodsForVoiceMode, presetsForVoiceMode } from './native-model.js';
import { NativeVoiceAudio } from './native-audio.js';
import { mountParameters, noteVowelControls } from './native-parameters.js';
import { mountVoiceDisplays } from './native-display.js';
import { mountSingingTimeline } from './native-timeline.js';
import { isSingingEngine, editableNote, singingNoteDescriptors, setNoteSyllable, auditionScene } from './native-singing-model.js';
import { enhanceChooseSelect } from '../../ui/patterns/choose-select.js';
import { registerHeaderPresets } from '../../site/header-presets.js';

const $=id=>document.getElementById(id);
let scene=defaultScene('espeak'),text=$('nativeText').value,playing=false,previewing=false,busy=false,active=true,renderSerial=0,timer=0,cleanupParameters=()=>{},timeline=null,selectedNote=0,phraseTimings=[],phonePicker;
const audio=new NativeVoiceAudio({onEnded:()=>{playing=false;updateTransport();},onAuditionEnded:updateTransport});
let voiceMode=voiceModeForEngine(scene.engine),presetController=null;
const modeSessions=new Map(),modeButtons=[...document.querySelectorAll('[data-voice-mode]')];
const methodPicker=$('voiceMethod');
function populateVoiceMethods(){
 methodPicker.replaceChildren();
 for(const [id,spec] of Object.entries(methodsForVoiceMode(voiceMode))){
  const option=document.createElement('option');option.value=id;option.textContent=`${spec.year} · ${spec.name}`;methodPicker.append(option);
 }
 methodPicker.dataset.mode=voiceMode;methodPicker.value=scene.engine;
}
populateVoiceMethods();
const choose=enhanceChooseSelect(methodPicker,{label:'Choose voice method'});
const encodingPicker=enhanceChooseSelect($('nativeEncoding'),{label:'Input mode'});
function showError(error){$('audioError').textContent=error.message||String(error);$('audioError').hidden=false;}
function clearError(){$('audioError').hidden=true;}
function updateTransport(){
 $('audioButton').setAttribute('aria-pressed',String(audio.enabled));$('audioState').textContent=audio.enabled?'on':'off';
 const sounding=playing||previewing||audio.auditioning;
 $('nativePlay').setAttribute('aria-pressed',String(sounding));$('nativePlay').textContent=sounding?'Ⅱ':'▶';$('nativePlay').setAttribute('aria-label',sounding?'Pause voice':'Play voice');
 $('nativeLoop').setAttribute('aria-pressed',String(audio.loop));
 $('nativeStatus').textContent=busy?'Rendering voice…':!audio.enabled?'Audio off':audio.auditioning?'Auditioning note':playing?'Playing':'Ready';
}
function mountVoiceParameters(){
 const spec=NATIVE_METHODS[scene.engine],note=isSingingEngine(scene)?editableNote(scene,selectedNote):scene,values=note.values;
 $('nativeSelectionLabel').hidden=!isSingingEngine(scene)||scene.engine==='sinsy';
 $('nativeSelectionLabel').textContent=`Note ${selectedNote+1} · native voice parameters`;
 if(spec.phones){$('nativePhone').value=note.input.phone;phonePicker?.refresh();}
 const onTimeline=noteVowelControls(scene.engine,spec.controls);
 const controls=Object.fromEntries(Object.entries(spec.controls).filter(([key])=>!Object.hasOwn(onTimeline,key)));
 cleanupParameters();cleanupParameters=mountParameters($('nativeParameters'),controls,values,changeVoiceParameter);
}
function changeVoiceParameter(key,value){
  const values=isSingingEngine(scene)?editableNote(scene,selectedNote).values:scene.values;
  values[key]=value;
  if(scene.engine==='singer'&&/^(radius\d|glottalReflection|lipReflection|frication|velum)/.test(key))values.customShape=true;
  if(scene.engine==='singer'&&/^glottis(Harmonics|A|B)$/.test(key))values.customGlottis=true;
  if(scene.engine==='stk-voicform'&&/^(formant\d|radius\d|gain\d|sweep\d)/.test(key))values.customFormants=true;
  for(const flag of ['customShape','customGlottis','customFormants']){const field=$(`param-${flag}`);if(field){field.value=String(values[flag]);field.dispatchEvent(new Event('native-parameter-reflect'));}}
  timeline?.refresh();scheduleRender();
}
function updateUi(){
 const spec=NATIVE_METHODS[scene.engine];
 if(methodPicker.dataset.mode!==voiceMode)populateVoiceMethods();
 methodPicker.value=scene.engine;choose.refresh();
 for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.voiceMode===voiceMode));
 document.body.classList.toggle('is-singing',isSingingEngine(scene));
 $('voiceTechnique').textContent=spec.detail||spec.inputDescription||spec.family;
 $('voiceHistory').textContent=`${spec.date}. ${spec.history}`;$('voiceReference').href=spec.source;
 $('nativeInputLabel').hidden=['note','score'].includes(spec.mode);$('nativeInputLabel').textContent=spec.mode==='native-letters'?'Native phonetic symbols':'Text';
 $('nativeText').hidden=['note','score'].includes(spec.mode);if(spec.mode==='native-letters')$('nativeText').removeAttribute('maxlength');else $('nativeText').maxLength=1000;
 $('nativeText').value=spec.mode==='native-letters'?(scene.input.phones||scene.input.text||spec.defaultInput.text):text;
 $('nativeEncodingField').hidden=spec.mode!=='native-letters';$('nativeEncoding').value=scene.input.mode||'text';encodingPicker.refresh();
 $('nativeInputNote').textContent=spec.mode==='text'?'Uses this engine’s native text frontend and phrase prosody.':spec.mode==='native-letters'?spec.inputDescription:spec.phoneLabel?'Play an original vocal shape. Destination and timing controls move the model during the note.':spec.inputDescription||'Play the model directly with its native synthesis parameters.';
 $('nativePhoneField').hidden=!spec.phones||isSingingEngine(scene);
 timeline?.destroy();timeline=null;$('nativeScore').hidden=!isSingingEngine(scene);
 phonePicker?.destroy();phonePicker=null;$('nativePhone').replaceChildren();
 if(spec.phones){for(const phone of spec.phones){const option=document.createElement('option');option.value=phone;option.textContent=phone;$('nativePhone').append(option);}$('nativePhone').value=scene.input.phone;phonePicker=enhanceChooseSelect($('nativePhone'),{label:spec.phoneLabel||'Vocal shape'});}
 if(isSingingEngine(scene)){
  $('nativeScore').setAttribute('aria-label',scene.engine==='sinsy'?'Japanese singing score':'Native singing score');
  selectedNote=Math.min(selectedNote,singingNoteDescriptors(scene).length-1);
  timeline=mountSingingTimeline($('nativeScore'),scene,{spec,initialSelection:selectedNote,error:showError,
    mountNoteParameters:(host,index)=>mountParameters(host,noteVowelControls(scene.engine,spec.controls),editableNote(scene,index).values,changeVoiceParameter),
    select:index=>{selectedNote=index;mountVoiceParameters();},change:scheduleRender,audition:index=>{void auditionNote(index).catch(()=>{});}});
  $('nativeInputNote').textContent=scene.engine==='sinsy'?'Sinsy · Japanese score and syllables · CC BY 3.0. Playhead shows score timing.':'Select a note to edit its native voice parameters. Each note keeps its own sound.';
 }
 mountVoiceParameters();
 $('nativeAudition').textContent=spec.mode==='text'?'Speak':spec.mode==='score'?'Sing':'Trigger';
 updateTransport();
}
function requestFor(next=scene){return {engine:next.engine,input:structuredClone(next.input),values:structuredClone(next.values),text};}
async function renderCurrent({audition=false,restart=false}={}){
 if(!audio.enabled||!active)return;
 const serial=++renderSerial;previewing=false;busy=true;clearError();updateTransport();
 try{const request=requestFor(),result=await audio.render(request);if(!active||serial!==renderSerial)return;
  phraseTimings=result.noteTimings??(isSingingEngine(scene)?[{index:0,start:0,end:result.noteOffTime??request.values.duration,releaseEnd:result.duration}]:[]);
  if(playing||audition){playing=true;if(!audio.playing||restart)audio.play({restart});}}
 catch(error){if(error.name!=='AbortError')showError(error);throw error;}
 finally{if(serial===renderSerial){busy=false;updateTransport();}}
}
function scheduleRender(){
 clearTimeout(timer);const preview=previewing||audio.auditioning;
 if(preview){renderSerial++;previewing=false;busy=false;audio.stopAudition();updateTransport();}
 timer=setTimeout(()=>{void (preview?auditionNote(selectedNote):renderCurrent({audition:playing})).catch(()=>{});},300);
}
async function apply(next,{audition=true}={}){
 clearTimeout(timer);previewing=false;audio.stopAudition();const previous=structuredClone(scene);scene=validateScene(next);selectedNote=0;updateUi();
 try{if(audio.enabled)await renderCurrent({audition,restart:true});}
 catch(error){if(error.name==='AbortError')return;scene=previous;updateUi();throw error;}
}
methodPicker.addEventListener('change',()=>{void apply(defaultScene(methodPicker.value)).catch(showError);});
$('nativePhone').addEventListener('change',()=>{
 if(isSingingEngine(scene)){setNoteSyllable(scene,selectedNote,$('nativePhone').value);updateUi();scheduleRender();return;}
 const previous=scene.values;scene.input.phone=$('nativePhone').value;
 const original=defaultsFor(scene.engine,scene.input);
 for(const key of Object.keys(previous))if(/^(radius\d|glottalReflection|lipReflection|frication|velum|formant\d|gain\d|voiced|noise|tilt)/.test(key))previous[key]=original[key];
 updateUi();scheduleRender();
});
$('nativeText').addEventListener('input',()=>{if(NATIVE_METHODS[scene.engine].mode==='native-letters'){const mode=$('nativeEncoding').value;scene.input={mode,[mode==='phones'?'phones':'text']:$('nativeText').value};}else text=$('nativeText').value;scheduleRender();});
$('nativeEncoding').addEventListener('change',()=>{$('nativeText').dispatchEvent(new Event('input'));});
$('audioButton').addEventListener('click',async()=>{
 clearTimeout(timer);
 if(audio.enabled){renderSerial++;busy=false;previewing=false;playing=false;await audio.disable();updateTransport();return;}
 try{const starting=audio.enable();updateTransport();await starting;updateTransport();if(playing)await renderCurrent({restart:true});}
 catch(error){if(error.name!=='AbortError'){await audio.disable();showError(error);}updateTransport();}
});
$('level').addEventListener('input',()=>{audio.setLevel(Number($('level').value));$('levelOut').textContent=`${Math.round(audio.level/.82*100)}%`;});
async function play(restart=false){
 clearTimeout(timer);
 if((playing||previewing||audio.auditioning)&&!restart){clearTimeout(timer);renderSerial++;busy=false;previewing=false;playing=false;audio.cancelRender();audio.pause();updateTransport();return;}
 previewing=false;
 playing=true;updateTransport();if(audio.enabled)await renderCurrent({restart});
}
async function auditionNote(index){
 if(!active||!audio.enabled||!isSingingEngine(scene)||singingNoteDescriptors(scene)[index]?.rest)return;
 clearTimeout(timer);const serial=++renderSerial;playing=false;audio.pause();previewing=true;busy=true;clearError();updateTransport();
 try{const result=await audio.render(requestFor(auditionScene(scene,index)),{store:false});if(active&&serial===renderSerial&&audio.enabled)audio.audition(result);}
 catch(error){if(error.name!=='AbortError')showError(error);throw error;}
 finally{if(serial===renderSerial){previewing=false;busy=false;updateTransport();}}
}
$('nativePlay').addEventListener('click',()=>{void play().catch(()=>{});});
$('nativeRestart').addEventListener('click',()=>{void play(true).catch(()=>{});});
$('nativeAudition').addEventListener('click',()=>{void play(true).catch(()=>{});});
$('nativeLoop').addEventListener('click',()=>{audio.setLoop(!audio.loop);updateTransport();});
$('resetButton').addEventListener('click',()=>{void apply(defaultScene(scene.engine)).catch(showError);});
addEventListener('keydown',event=>{if(event.code==='Space'&&!event.defaultPrevented&&!event.repeat&&!event.target.closest('input,textarea,select,button,summary,[role=button],[contenteditable]')){event.preventDefault();void play().catch(()=>{});}});
addEventListener('morphazoid:midi-input',event=>{
 const message=event.detail?.message;if(message?.type!=='noteOn'||NATIVE_METHODS[scene.engine].mode!=='note')return;
 event.preventDefault();if(!audio.enabled)return;
 const values=isSingingEngine(scene)?editableNote(scene,selectedNote).values:scene.values;
 const key=Object.hasOwn(values,'pitch')?'pitch':'pitchHz',rule=NATIVE_METHODS[scene.engine].controls[key];
 if(rule)values[key]=440*2**((message.note-69)/12);
 updateUi();void play(true).catch(()=>{});
});
const stopDisplays=mountVoiceDisplays(audio,{wave:$('voiceWave'),spectrum:$('voiceSpectrum'),spectrogram:$('voiceSpectrogram'),onFrame:()=>timeline?.progress(audio.currentPosition(),phraseTimings,audio.playing)});
// Capturing an experimental request must not trap the performer in a scene the
// native engine rejects. Preset recall and render boundaries still validate it.
function mountModePresets(session={}){
 const mode=voiceMode,label=mode==='singing'?'Singing':'Speaking';
 presetController=registerHeaderPresets({id:'voicesaurus',presets:presetsForVoiceMode(mode),
  randomize:(previous,random)=>randomize(previous,random,{mode}),
  capture:()=>structuredClone(scene),apply:next=>apply(next),onApplied:updateUi});
 presetController.lastPresetId=session.lastPresetId??null;
 presetController.hasPresetInteraction=Boolean(session.hasPresetInteraction);
 presetController.refresh();
 const host=document.querySelector('[data-instrument-preset-host]');
 for(const [selector,title]of [['.header-preset-next',`Next ${mode} preset`],['.header-preset-random',`Randomize ${mode} method and settings`]]){
  const button=host.querySelector(selector);button.title=title;button.setAttribute('aria-label',title);
 }
 for(const selector of ['.header-preset-controls','.header-preset-picker summary','.instrument-picker-list'])host.querySelector(selector)?.setAttribute('aria-label',`${label} presets`);
 host.querySelector('#header-preset-panel input').placeholder=`Search ${mode} presets`;
}
function switchVoiceMode(nextMode){
 if(nextMode===voiceMode)return;
 methodsForVoiceMode(nextMode);
 modeSessions.set(voiceMode,{scene:structuredClone(scene),selectedNote,
  lastPresetId:presetController?.lastPresetId,hasPresetInteraction:presetController?.hasPresetInteraction});
 // Retire the old preset transaction before replacing its captured scene.
 presetController?.destroy();clearTimeout(timer);renderSerial++;busy=false;previewing=false;
 audio.cancelRender();audio.pause();phraseTimings=[];
 const session=modeSessions.get(nextMode)??{scene:defaultScene(nextMode==='singing'?'singer':'espeak'),selectedNote:0};
 voiceMode=nextMode;scene=structuredClone(session.scene);selectedNote=session.selectedNote??0;
 clearError();updateUi();mountModePresets(session);
 // Preserve Audio, output level, Loop, prose, and primary playback intention.
 // Restoring an experimental scene never rewrites it through validation.
 if(audio.enabled)void renderCurrent({audition:playing,restart:true}).catch(()=>{});
}
for(const button of modeButtons)button.addEventListener('click',()=>switchVoiceMode(button.dataset.voiceMode));
mountModePresets();
updateUi();
addEventListener('pagehide',event=>{active=false;clearTimeout(timer);playing=false;previewing=false;audio.cancelRender();if(event.persisted)void audio.disable();else{stopDisplays();cleanupParameters();timeline?.destroy();choose.destroy();encodingPicker.destroy();phonePicker?.destroy();void audio.close();}});
addEventListener('pageshow',event=>{if(event.persisted){active=true;playing=false;updateTransport();}});
