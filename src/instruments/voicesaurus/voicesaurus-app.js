import { randomize } from './full-presets.js';
import { NATIVE_METHODS, defaultScene, defaultsFor, validateScene, voiceModeForEngine, methodsForVoiceMode, presetsForVoiceMode } from './native-model.js';
import { playbackOffsetForBeat } from './playback-offset.js';
import { setGlobalVoiceParameter, setNoteVoiceParameter, setNoteVoiceInheritance, noteVoiceOverrideKeys, materializeVoiceNote } from './voice-settings.js';
import { textPresetsForEngine, singingSceneFromTextPreset } from './text-presets.js';
import { sampleBankRequest } from './sample-bank-model.js';
import { mountSampleBankSources, mountSampleBankNote } from './sample-bank-ui.js';
import { NativeVoiceAudio } from './native-audio.js';
import { mountParameters, noteVowelControls } from './native-parameters.js';
import { mountVoiceDisplays } from './native-display.js';
import { mountSingingTimeline } from './native-timeline.js';
import { isSingingEngine, editableNote, singingNoteDescriptors, setNoteSyllable, auditionScene } from './native-singing-model.js';
import { createChoiceSwitch } from '../../ui/primitives/choice-switch.js';
import { enhanceChooseSelect } from '../../ui/patterns/choose-select.js';
import { registerHeaderPresets } from '../../site/header-presets.js';

const $=id=>document.getElementById(id);
let scene=defaultScene('espeak'),text=$('nativeText').value,playing=false,previewing=false,busy=false,active=true,renderSerial=0,timer=0,cleanupParameters=()=>{},timeline=null,selectedNote=0,phraseTimings=[],phonePicker;
let sampleRenderer,pendingSeek=null,renderedRequestKey=null,renderedResult=null,renderedBank=null;
const audio=new NativeVoiceAudio({renderSampleBank:async(request,{signal})=>{
 const bank=bankSources.getBank();
 if(!sampleRenderer){const {createSampleBankRenderer}=await import('../../families/speech/sample-bank-renderer.js');sampleRenderer=createSampleBankRenderer();}
 return sampleRenderer.render(sampleBankRequest(request,bank),{signal});
},onEnded:()=>{playing=false;updateTransport();},onAuditionEnded:updateTransport});
let voiceMode=voiceModeForEngine(scene.engine),presetController=null;
const modeSessions=new Map(),modeButtons=[...document.querySelectorAll('[data-voice-mode]')];
const singingDrafts=new Map();let singingTextSerial=0;
const textPresetPicker=enhanceChooseSelect($('textPreset'),{label:'Text preset'});
const bankSources=mountSampleBankSources($('sampleBankControls'),{getScene:()=>scene,change:()=>{timeline?.refresh();scheduleRender();},error:showError});
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
const encodingSwitch=createChoiceSwitch({label:'Input mode',compact:true,className:'native-param is-toggle native-input-mode',choices:[{value:'text',label:'Letter mapping'},{value:'phones',label:'Phonetic symbols'}],value:'text',onChange:value=>{$('nativeEncoding').value=value;$('nativeEncoding').dispatchEvent(new Event('change'));}});
$('nativeEncodingField').append(encodingSwitch);
const encodingPicker={refresh:()=>encodingSwitch.setValue($('nativeEncoding').value),destroy:()=>encodingSwitch.destroy()};
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
 const spec=NATIVE_METHODS[scene.engine];
 $('nativeSelectionLabel').hidden=!isSingingEngine(scene);
 $('nativeSelectionLabel').textContent=scene.engine==='sinsy'?'Global voice · whole score':'Global voice · notes can override';
 if(spec.phones){$('nativePhone').value=scene.input.phone;phonePicker?.refresh();}
 const controls=Object.fromEntries(Object.entries(spec.controls).filter(([key])=>!(isSingingEngine(scene)&&['pitch','duration'].includes(key))));
 cleanupParameters();cleanupParameters=mountParameters($('nativeParameters'),controls,scene.values,changeVoiceParameter);
}
function changeVoiceParameter(key,value){
  setGlobalVoiceParameter(scene,key,value);
  timeline?.refresh();scheduleRender();
}
function changeNoteParameter(index,key,value){setNoteVoiceParameter(scene,index,key,value);timeline?.refresh();scheduleRender();}
function refreshTextPresets(){
 const singing=isSingingEngine(scene),bank=textPresetsForEngine(scene.engine,{textCapable:singing||NATIVE_METHODS[scene.engine].mode==='text'});
 $('textPresetField').hidden=!bank.length;$('textPreset').replaceChildren();
 const custom=document.createElement('option');custom.value='';custom.textContent='Choose text';$('textPreset').append(custom);
 for(const preset of bank){const option=document.createElement('option');option.value=preset.id;option.textContent=preset.label;$('textPreset').append(option);}
 $('textPreset').value=bank.find(preset=>preset.text===(singing?$('singingText').value:$('nativeText').value))?.id??'';textPresetPicker.refresh();
}
function updateUi(){
 const spec=NATIVE_METHODS[scene.engine];bankSources.refresh();
 singingTextSerial++;$('applySingingText').disabled=false;$('singingTextStatus').textContent='';
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
 $('singingTextField').hidden=!isSingingEngine(scene);
 if(isSingingEngine(scene)){
  $('singingText').value=scene.input.singingText??singingDrafts.get(scene.engine)??'';
  $('singingText').placeholder=scene.engine==='sinsy'?'sakura sakura · さくら さくら':'Daisy, Daisy, give me your answer';
  $('singingTextLabel').textContent=scene.engine==='sinsy'?'Japanese lyrics · kana or romaji':scene.engine.startsWith('csound-')?'Text → vowel formants':'Text → vocal sounds';
 }
 timeline?.destroy();timeline=null;$('nativeScore').hidden=!isSingingEngine(scene);
 phonePicker?.destroy();phonePicker=null;$('nativePhone').replaceChildren();
 if(spec.phones){for(const phone of spec.phones){const option=document.createElement('option');option.value=phone;option.textContent=phone;$('nativePhone').append(option);}$('nativePhone').value=scene.input.phone;phonePicker=enhanceChooseSelect($('nativePhone'),{label:spec.phoneLabel||'Vocal shape'});}
 if(isSingingEngine(scene)){
  $('nativeScore').setAttribute('aria-label',scene.engine==='sinsy'?'Japanese singing score':'Native singing score');
  selectedNote=Math.min(selectedNote,singingNoteDescriptors(scene).length-1);
  timeline=mountSingingTimeline($('nativeScore'),scene,{spec,initialSelection:selectedNote,error:showError,
    mountNoteSound:(host,index)=>scene.engine==='sample-bank'?mountSampleBankNote(host,editableNote(scene,index),{getNote:()=>materializeVoiceNote(scene,index),aliases:bankSources.aliases(),change:()=>{timeline?.refresh();scheduleRender();}}):()=>{},
    mountNoteParameters:(host,index)=>{
     const note=editableNote(scene,index),vowels=noteVowelControls(scene.engine,spec.controls);
     const controls=Object.fromEntries(Object.entries(spec.controls).filter(([key])=>!['pitch','duration'].includes(key)).map(([key,rule])=>[key,vowels[key]??rule]));
     const cleanup=mountParameters(host,controls,note.values,(key,value)=>changeNoteParameter(index,key,value),{
      idPrefix:'note-param',getValues:()=>editableNote(scene,index).values,
      inheritance:{overridden:key=>noteVoiceOverrideKeys(scene,index).includes(key),set:(key,inherit)=>{setNoteVoiceInheritance(scene,index,key,inherit);timeline?.refresh();scheduleRender();}},
     });
     return cleanup;
    },
    select:index=>{selectedNote=index;mountVoiceParameters();},change:scheduleRender,seek:beat=>{void seekFromBeat(beat).catch(()=>{});},audition:index=>{void auditionNote(index).catch(()=>{});}});
  $('nativeInputNote').textContent=scene.engine==='sinsy'?'Sinsy · Japanese score and syllables · CC BY 3.0. Voice settings apply to the whole score.':'Voice settings are global. Select a note to override its sound.';
 }
 mountVoiceParameters();
 refreshTextPresets();
 $('nativeAudition').textContent=spec.mode==='text'?'Speak':spec.mode==='score'?'Sing':'Trigger';
 updateTransport();
}
function requestFor(next=scene){return {engine:next.engine,input:structuredClone(next.input),values:structuredClone(next.values),text};}
async function renderCurrent({audition=false,restart=false}={}){
 if(!audio.enabled||!active)return;
 const serial=++renderSerial;previewing=false;busy=true;clearError();updateTransport();
 try{const request=requestFor(),bank=bankSources.getBank(),result=await audio.render(request);if(!active||serial!==renderSerial)return;
  renderedRequestKey=JSON.stringify(request);renderedResult=result;renderedBank=bank;
  if(scene.engine==='sample-bank')bankSources.report(result);
  phraseTimings=result.noteTimings??(isSingingEngine(scene)?singingNoteDescriptors(request).map(note=>({index:note.index,start:(result.scoreOffsetSeconds??0)+note.startSeconds,end:(result.scoreOffsetSeconds??0)+note.startSeconds+note.seconds})):[]);
  if(playing||audition){playing=true;if(pendingSeek!==null){const offset=playbackOffsetForBeat(pendingSeek,singingNoteDescriptors(request),result);pendingSeek=null;playing=audio.play({offset});}else if(!audio.playing||restart)playing=audio.play({restart});}}
 catch(error){if(error.name!=='AbortError'&&serial===renderSerial){pendingSeek=null;playing=audio.playing;showError(error);}throw error;}
 finally{if(serial===renderSerial){busy=false;updateTransport();}}
}
function scheduleRender(){
 bankSources.refresh();clearTimeout(timer);renderSerial++;audio.cancelRender();busy=false;const preview=previewing||audio.auditioning;
 if(preview){renderSerial++;previewing=false;busy=false;audio.stopAudition();updateTransport();}
 timer=setTimeout(()=>{void (preview?auditionNote(selectedNote):renderCurrent({audition:playing})).catch(()=>{});},300);
}
async function apply(next,{audition=true}={}){
 clearTimeout(timer);pendingSeek=null;previewing=false;audio.stopAudition();const previous=structuredClone(scene);scene=validateScene(next);selectedNote=0;updateUi();
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
$('nativeText').addEventListener('input',()=>{if(NATIVE_METHODS[scene.engine].mode==='native-letters'){const mode=$('nativeEncoding').value;scene.input={mode,[mode==='phones'?'phones':'text']:$('nativeText').value};}else text=$('nativeText').value;refreshTextPresets();scheduleRender();});
async function applySingingText(preset){
 if(!isSingingEngine(scene))return;
 const serial=++singingTextSerial,original=scene,before=JSON.stringify(scene),lyrics=$('singingText').value;
 singingDrafts.set(scene.engine,lyrics);$('applySingingText').disabled=true;$('singingTextStatus').textContent='Preparing note sounds…';clearError();
 try{
  const {singingSceneFromText}=await import('./singing-text.js');
  const result=preset?await singingSceneFromTextPreset(original,preset):await singingSceneFromText(original,lyrics);
  if(!active||serial!==singingTextSerial||scene!==original)return;
  if(JSON.stringify(scene)!==before){$('singingTextStatus').textContent='The score changed. Apply the text again to keep those edits.';return;}
  scene=result.scene;selectedNote=0;updateUi();
  $('singingTextStatus').textContent=[`${result.syllables.length} syllables · ${result.notes.length} editable notes.`,...result.warnings].join(' ');
  scheduleRender();
 }catch(error){if(serial===singingTextSerial&&active){$('singingTextStatus').textContent=error.message||String(error);}}
 finally{if(active&&scene===original&&serial===singingTextSerial)$('applySingingText').disabled=false;}
}
$('applySingingText').addEventListener('click',()=>{void applySingingText();});
$('singingText').addEventListener('input',()=>{singingDrafts.set(scene.engine,$('singingText').value);singingTextSerial++;$('applySingingText').disabled=false;$('singingTextStatus').textContent='';refreshTextPresets();});
$('textPreset').addEventListener('change',()=>{
 const preset=textPresetsForEngine(scene.engine).find(item=>item.id===$('textPreset').value);if(!preset)return;
 if(isSingingEngine(scene)){$('singingText').value=preset.text;$('singingText').dispatchEvent(new Event('input'));void applySingingText(preset);}
 else{$('nativeText').value=preset.text;$('nativeText').dispatchEvent(new Event('input'));}
});
$('singingText').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();void applySingingText();}});
$('nativeEncoding').addEventListener('change',()=>{$('nativeText').dispatchEvent(new Event('input'));});
$('audioButton').addEventListener('click',async()=>{
 clearTimeout(timer);
 if(audio.enabled){pendingSeek=null;renderSerial++;busy=false;previewing=false;playing=false;await audio.disable();updateTransport();return;}
 try{const starting=audio.enable();updateTransport();await starting;updateTransport();if(playing)await renderCurrent({restart:true});}
 catch(error){if(error.name!=='AbortError'){await audio.disable();showError(error);}updateTransport();}
});
$('level').addEventListener('input',()=>{audio.setLevel(Number($('level').value));$('levelOut').textContent=`${Math.round(audio.level/.82*100)}%`;});
async function play(restart=false){
 pendingSeek=null;clearTimeout(timer);
 if((playing||previewing||audio.auditioning)&&!restart){clearTimeout(timer);renderSerial++;busy=false;previewing=false;playing=false;audio.cancelRender();audio.pause();updateTransport();return;}
 previewing=false;
 playing=true;updateTransport();if(audio.enabled)await renderCurrent({restart});
}
async function seekFromBeat(beat){
 if(!active||!isSingingEngine(scene))return;
 clearTimeout(timer);renderSerial++;audio.cancelRender();previewing=false;audio.pause();busy=false;pendingSeek=beat;playing=true;clearError();updateTransport();
 if(!audio.enabled)return;
 if(renderedRequestKey===JSON.stringify(requestFor())&&renderedResult?.buffer===audio.buffer&&renderedBank===bankSources.getBank()){
  try{const offset=playbackOffsetForBeat(beat,singingNoteDescriptors(scene),renderedResult);pendingSeek=null;playing=audio.play({offset});}catch(error){pendingSeek=null;playing=audio.playing;showError(error);}updateTransport();
 }else await renderCurrent();
}
async function auditionNote(index){
 if(!active||!audio.enabled||!isSingingEngine(scene)||singingNoteDescriptors(scene)[index]?.rest)return;
 pendingSeek=null;clearTimeout(timer);const serial=++renderSerial;playing=false;audio.pause();previewing=true;busy=true;clearError();updateTransport();
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
 presetController?.destroy();pendingSeek=null;clearTimeout(timer);renderSerial++;busy=false;previewing=false;
 audio.cancelRender();audio.pause();phraseTimings=[];
 const session=modeSessions.get(nextMode)??{scene:defaultScene(nextMode==='singing'?'singer':'espeak'),selectedNote:0};
 voiceMode=nextMode;scene=structuredClone(session.scene);selectedNote=session.selectedNote??0;
 clearError();updateUi();mountModePresets(session);
 // Preserve Audio, output level, Loop, prose, and primary playback intention.
 // Restoring an experimental scene never rewrites it through validation.
 if(audio.enabled)void renderCurrent({audition:playing,restart:true}).catch(()=>{});
}
for(const button of modeButtons)button.addEventListener('click',()=>switchVoiceMode(button.dataset.voiceMode));
if(new URLSearchParams(location.search).get('voice')==='sample-bank'){voiceMode='singing';scene=defaultScene('sample-bank');}
mountModePresets();
updateUi();
addEventListener('pagehide',event=>{active=false;clearTimeout(timer);playing=false;previewing=false;audio.cancelRender();if(event.persisted)void audio.disable();else{stopDisplays();cleanupParameters();bankSources.destroy();sampleRenderer?.close();timeline?.destroy();choose.destroy();textPresetPicker.destroy();encodingPicker.destroy();phonePicker?.destroy();void audio.close();}});
addEventListener('pageshow',event=>{if(event.persisted){active=true;playing=false;updateTransport();}});
