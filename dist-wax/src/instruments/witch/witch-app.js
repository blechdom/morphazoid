import { WitchAudio } from './witch-audio.js';
import { WITCH_VOICES, WITCH_INGREDIENTS, WITCH_HAND_MOTIONS, WITCH_HAND_SOUNDS, WITCH_CAT_GAITS, witchSpoonHeight, witchVoiceAtHeight, witchGhostFrame } from './witch-model.js';
import { blendWitchSpell, witchAccentEnvelope, getWitchBlechFlyby } from './witch-scene-model.js';
import { createWitchSpider } from './witch-spider.js';
import { getWitchVisitors, getWitchVisitorTargets } from './witch-visitors.js';
import { createWitchHand } from './witch-hand.js';
import { getWitchCatFrame, getWitchCatTargets } from './witch-cat.js';
import { createWitchCatClock, advanceWitchCatClock, snapshotWitchCatClock, witchCatMeowEnvelope } from './witch-cat-model.js';
import { renderWitch, hitTestWitch, getFingerTips, handTransform, transformHandPoint, getWitchObjectPosition, getWitchGhostPosition, getWitchTargets, getWitchLadle, getWitchHair, getWitchHat, getWitchTree, getWitchWeb, getWitchSpellArm, warpWitchPoint, WITCH_LAYOUT } from './witch-renderer.js';
import { WITCH_DEFAULTS, WITCH_PRESETS, normalizeWitchPreset, randomizeWitchPreset, WITCH_VISUAL_MODES } from './witch-presets.js';
import { registerHeaderPresets } from '../../site/header-presets.js';

const $ = id => document.getElementById(id);
const canvas = $('witchCanvas');
const ctx = canvas.getContext('2d', { alpha:false });
const audio = new WitchAudio();
const abort = new AbortController();
const listen = (target,type,fn) => target.addEventListener(type,fn,{signal:abort.signal});
const clamp = (v,min=0,max=1) => Math.max(min,Math.min(max,Number(v)||0));
const TAU = Math.PI * 2;
let config = normalizeWitchPreset(WITCH_DEFAULTS);
let playing = true, audioOn = false, starting = false, disposed = false, request = 0;
let selectedIngredient = -1, mushroomPresetId=null;
let performanceTime=0,lastPerformanceTick=performance.now();
const catClock=createWitchCatClock(0,config);
let catMeowAt=-Infinity, eyeShockAt=-Infinity, spiderAt=-Infinity, webAt=-Infinity, webIndex=0, fabricWindAt=-Infinity;
let spellTransition=null,lastCatCaptured=false;
const capturedAnimals={};
const spider=createWitchSpider(document);
let spiderReady=false;spider.ready.then(ready=>{if(disposed)return;spiderReady=ready;canvas.dataset.spiderReady=String(ready);});
let selectedFinger = 1, frame = 0, lastPaint=0, last = performance.now(), silentPhase = 0, silentSpeed = 0;
let pointer = null, keyboardGate = false, event = null, ladleOffset = 0, motionTime = 0, silentHandTime = 0, silentFlightPhase = 0, silentGhostPhase = 0, silentFlybyTime = 0;
const ghostFrames=Array.from({length:3},()=>({}));
const fingerPointers = new Map(), fingerKeys = new Set(), sliderKeys = new Set(), sliderPointers = new Map(), arrowKeys = new Set();
let instrumentLabels = ['Thumb · glass','Index · reed','Middle · wire','Ring · metal','Little · marimba'];
for(const [id,items] of [['handMotion',WITCH_HAND_MOTIONS.map(id=>({id,label:id.replaceAll('-',' ')}))],['handSound',WITCH_HAND_SOUNDS],['catGait',WITCH_CAT_GAITS.map(id=>({id,label:id.replaceAll('-',' ')}))]]) {
  for(const item of items) {const option=document.createElement('option');option.value=item.id;option.textContent=item.label;$(id).append(option);}
}
for(const item of WITCH_INGREDIENTS) {const button=document.createElement('button');button.type='button';button.dataset.drop=item.id;button.textContent=item.name;$('potionShelfControls').append(button);}
for(const [value,label] of WITCH_VISUAL_MODES.entries()){const option=document.createElement('option');option.value=value;option.textContent=label;$('visualMode').append(option);}
let width = 1000, height = 720, presets;
const world={handReach:1,handOpen:false,flightLift:0,trip:0,hatPullX:0,hatPullY:0};
const objects=WITCH_LAYOUT.objects.map(object=>({...object,dragging:false,dropped:false,dropAge:0}));
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
let handReady=false,handSurface=null,handSurfaces=[],pageSuspended=false,audioMotionReady=false;
const hand=createWitchHand({onStatus:message=>{$('liveStatus').textContent=message;}});
hand.ready.then(ready=>{if(disposed)return;handReady=ready;canvas.dataset.handReady=String(ready);});
audio.onError=error => { audioMotionReady=false;audioOn=false; starting=false; $('liveStatus').textContent=error.message; sync(); };
const sceneCopy = {
  brew: ['She brews her own voice.', 'Stir the pot. Pull her hair for noise. Touch her right hand, the moon, or the mushrooms.', 'Stir for me', 'stirring'],
  fingers: ['An instrument in every finger.', 'Pull her fingertips. Touch the pot to return, the moon to fly, or mushrooms for trouble.', 'Play the hand', 'hand'],
  flight: ['Music for a midnight ride.', 'Pull the sky noodles to bend the delay. Her streaming hair adds noise. Click the moon or broom again to land.', 'Take flight', 'flight'],
};
function fingerMask() {
  let mask=0;
  for(const held of fingerPointers.values()) mask |= 1 << held.index;
  for(const index of fingerKeys) mask |= 1 << index;
  for(const index of sliderKeys) mask |= 1 << index;
  for(const index of sliderPointers.values()) mask |= 1 << index;
  if(keyboardGate && world.handOpen) mask |= 1 << selectedFinger;
  return mask;
}
function advancePerformanceTime(now=performance.now()) {
  const elapsed=Math.max(0,now-lastPerformanceTick)/1000;
  if(audioMotionReady&&audio.node) silentFlybyTime=audio.visual.flybyTime??silentFlybyTime;
  else if(playing&&config.scene==='flight') silentFlybyTime+=elapsed;
  if(audioMotionReady&&audio.node&&audio.visual.catClock) {performanceTime=audio.visual.catClock.time;Object.assign(catClock,audio.visual.catClock);}
  else {if(playing)performanceTime+=elapsed;advanceWitchCatClock(catClock,performanceTime,config);}
  lastPerformanceTick=now;
}
function setPlaying(value) { advancePerformanceTime();playing=value;if(!playing)catMeowAt=-Infinity; }
function gate() { return playing || Boolean(pointer && pointer.type!=='ghost') || keyboardGate || fingerMask()!==0; }
function send() { const cat=getWitchCatFrame({ ...config,performanceTime,catFrame:catClock,capturedAnimals }); lastCatCaptured=Boolean(cat.captured);audio.update({ ...config,catCaptured:lastCatCaptured, mode:config.scene, gate:gate(), ghostGate:playing, fingerMask:playing?0:fingerMask(), manualFingerMask:fingerMask(), handFocus:world.handOpen?1:0, spoonAuto:config.spoonAuto && pointer?.type!=='spoon', volume:Number($('outputLevel').value) }); }
function sync() {
  const [caption,hint,playLabel,action] = sceneCopy[config.scene];
  $('sceneLabel').textContent = caption; $('gestureHint').textContent = hint;
  $('playLabel').textContent = playing ? 'Release' : 'Keep brewing';
  $('playGlyph').textContent = playing ? '■' : '▶';
  $('playButton').setAttribute('aria-pressed',String(playing));
  $('playButton').setAttribute('aria-label',`${playing?'Stop':'Play'} ${action}`);
  $('audioButton').setAttribute('aria-pressed',String(audioOn));
  $('audioState').textContent = starting ? 'starting' : audioOn ? 'on' : 'off';
  $('audioButton').disabled = starting;
  canvas.dataset.scene=config.scene;canvas.dataset.trip=String(world.trip);
  $('voice').value = config.voice; $('spoonAuto').checked=config.spoonAuto;
  for(const key of ['handMotion','handSound','catGait'])$(key).value=config[key];
  for(const key of ['handRate','catSpeed']) {$(key).value=config[key];$(`${key}Out`).value=`${config[key].toFixed(2)}×`;}
  for(const key of ['handDepth','fabricX','fabricY','trailPull','trailTwist','spellBalance']) {$(key).value=config[key];$(`${key}Out`).value=`${Math.round(config[key]*100)}%`;}
  const handBank=WITCH_HAND_SOUNDS.find(bank=>bank.id===config.handSound)||WITCH_HAND_SOUNDS[0];
  instrumentLabels=handBank.sources.map((source,i)=>`${['Thumb','Index','Middle','Ring','Little'][i]} · ${source}`);
  for(const button of document.querySelectorAll('[data-drop]'))button.disabled=objects.some(object=>object.id===button.dataset.drop&&object.dropped);
  $('visualMode').value=config.visualMode;$('treeShape').value=config.treeShape;
  $('palette').value=config.palette; $('lineBend').value=config.trip; $('lineBendOut').value=['Still','A ripple','Bent','Wonkywonk'][config.trip];
  $('ghostTempo').value=config.ghostTempo; $('ghostTempoOut').value=`${Math.round(config.ghostTempo)} BPM`;
  for (const key of ['speed','radius','altitude','tone','flightX','nose','hat','hair','spoonHeight']) { $(key).value=config[key]; $(`${key}Out`).value=`${Math.round(config[key]*100)}%`; }
  config.fingers.forEach((value,i) => { $(`finger${i}`).value=value; $(`finger${i}Out`).value=`${Math.round(value*100)}%`; });
  $('glassOut').value=`${Math.round(config.glass*100)}%`;
  $('reverseButton').setAttribute('aria-pressed',String(config.direction<0));
  $('reverseButton').textContent = config.direction<0 ? '↶ Backward spell' : '↻ Forward spell';
  for(const id of ['nightControls','fingerControls','ingredientControls','voiceControl','radiusControl','reverseButton','speedControl','toneControl']) $(id).hidden=false;
  $('flightSpeed').value=config.speed; $('flightSpeedOut').value=`${Math.round(config.speed*100)}%`;
  $('speedLabel').textContent='Stirring motion';
  $('voiceHeading').textContent='Her singing'; $('fingerHeading').textContent='Spell-casting fingers';
  instrumentLabels.forEach((label,i)=>{ $(`finger${i}Label`).textContent=label; });
  canvas.setAttribute('aria-label',`${caption} ${hint}`);
  presets?.refresh();
}
function stopGesture() {
  const held=pointer;
  if(held?.type==='stir') ladleOffset=held.ladleAngle-(audioMotionReady&&audio.node?audio.visual.phase:silentPhase);
  pointer=null; keyboardGate=false;
  const captured=[...fingerPointers.keys()]; fingerPointers.clear(); fingerKeys.clear(); sliderKeys.clear(); sliderPointers.clear(); arrowKeys.clear();
  for(const id of captured) if(canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  if (held && canvas.hasPointerCapture(held.id)) canvas.releasePointerCapture(held.id);
  send();
}
function setScene(scene) { advancePerformanceTime();spellTransition=null;stopGesture(); config.scene=scene; if(scene!=='flight') world.handOpen=scene==='fingers'; sync(); send(); }
function worldAction(action) {
  if(action==='hand') {
    if(config.scene==='flight') { stopGesture();world.handOpen=!world.handOpen;sync();send(); }
    else setScene(world.handOpen?'brew':'fingers');
  }
  else if(action==='moon'||action==='broom') {
    if(config.scene!=='flight') { setScene('flight'); setPlaying(true); send();sync();trigger('launch'); }
    else setScene(world.handOpen?'fingers':'brew');
  } else if(action==='mushrooms') {
    const current=Math.max(0,WITCH_PRESETS.findIndex(preset=>preset.id===(mushroomPresetId??presets?.selectedId??presets?.lastPresetId)));
    const next=WITCH_PRESETS[(current+1)%WITCH_PRESETS.length];
    if(config.scene==='flight') {applySpell(next.snapshot,{preserveFlight:true});mushroomPresetId=next.id;}
    else if(presets?.view)presets.view.select(next.id);else applySpell(next.snapshot);
    $('gestureReadout').value=next.label;
  } else if(action==='fabric') {
    if(config.scene==='flight')windFabric();
  } else if(action==='mouth') {
    spellTransition=null;const current=visualState().activeVoice;config.voice=WITCH_VOICES[(WITCH_VOICES.indexOf(current)+1)%WITCH_VOICES.length];config.spoonAuto=false;config.spoonHeight=(WITCH_VOICES.indexOf(config.voice)+.5)/WITCH_VOICES.length;send();sync();
  } else if(action==='eyes') {advancePerformanceTime();eyeShockAt=performance.now()/1000;audio.trigger('eye-shock');}
  else if(action==='tree') {spellTransition=null;config.treeShape=(config.treeShape+1)%6;sync();audio.trigger('tree-l-system');}
  else if(action==='spider') {advancePerformanceTime();spiderAt=performance.now()/1000;audio.trigger('spider-groan');}
  else if(action==='brew') setScene('brew');
}
function trigger(kind) {
  if(kind==='meow') {
    if(!playing||!getWitchCatTargets(visualState()))return;
    catMeowAt=performance.now();
  }
  const character={bat:'cackle',moon:'sing',gust:'creak',spark:'mutter'}[kind];
  if(character) { config.voice=character;config.spoonAuto=false;config.spoonHeight=(WITCH_VOICES.indexOf(character)+.5)/WITCH_VOICES.length;send();sync(); }
  if(kind!=='meow')event={kind,age:0};
  audio.trigger(kind);
  $('gestureReadout').value = {meow:'Meow!',launch:'Bwa bwa ha ha hah ha!',moon:'A silver moon bell.',bat:'A flutter of ticking wings.',spark:'A star plucks a string.',gust:'Wind through the broom.'}[kind] || kind;
}
function returnObject(object) {
  if(!object || object.dropped) return;
  const home=WITCH_LAYOUT.objects.find(item=>item.id===object.id);
  Object.assign(object,{x:home.x,y:home.y,dragging:false,dropAge:0});
}
function refillShelf() {
  for(const object of objects) {object.dropped=false;returnObject(object);}
  selectedIngredient=-1;
}
function applySpell(snapshot,{refill=true,preserveFlight=false}={}) {
  mushroomPresetId=null;spellTransition=null;advancePerformanceTime();
  const flying=preserveFlight&&config.scene==='flight';
  stopGesture();config=normalizeWitchPreset(snapshot);
  if(flying)config.scene='flight';
  world.trip=config.trip;world.handOpen=config.scene==='fingers';world.hatPullX=world.hatPullY=0;
  if(refill)refillShelf();
  send();sync();
}
function dropObject(id) {
  const object=objects.find(item=>item.id===id);
  if(!object || object.dropped)return;
  advancePerformanceTime();
  const origin=getWitchObjectPosition(object,visualState());
  const spell=WITCH_PRESETS.find(preset=>preset.id===object.presetId);
  if(spell) {
    mushroomPresetId=null;
    const target=normalizeWitchPreset(spell.snapshot);
    if(config.scene==='flight')target.scene='flight';
    spellTransition={from:structuredClone(config),to:target,start:performanceTime+(object.phraseDuration||0),duration:object.flightDuration||1.5,mix:0};
  }
  Object.assign(object,{x:origin.x,y:origin.y,dragging:false,dropped:true,dropAge:0,droppedAt:performanceTime});
  trigger(object.kind);sync();$('gestureReadout').value=`${object.name} joins the brew. Choose a preset to refill the shelf.`;
}
function advanceSpell() {
  if(!spellTransition)return;
  const progress=clamp((performanceTime-spellTransition.start)/spellTransition.duration);
  spellTransition.mix=progress;
  config=blendWitchSpell(spellTransition.from,spellTransition.to,progress);
  world.trip=config.trip;world.handOpen=config.scene==='fingers';
  if(progress===1)spellTransition=null;
  send();sync();
}
function captureAnimal(id) {
  advancePerformanceTime();
  const state=visualState(),animal=id==='cat'?getWitchCatFrame(state):getWitchVisitors(state).find(frame=>frame.id===id||frame.animalId===id);
  if(!animal||!animal.active||animal.captured||state.flightLift>.1)return;
  capturedAnimals[id]={startedAt:performanceTime,from:{x:animal.x,y:animal.y}};
  if(id==='cat')catMeowAt=performance.now();
  send();audio.trigger(`drop-${id}`);$('gestureReadout').value=`${id==='cat'?'Meow! ':''}The ${id} dives into the potion.`;
}
function windFabric() {
  if(config.scene!=='flight')return;
  fabricWindAt=performance.now();audio.trigger('fabric-wind');
}
function pluckWeb(index) {
  advancePerformanceTime();webIndex=Math.round(clamp(index,0,6));webAt=performance.now()/1000;audio.trigger(`web-${webIndex}`);
}
function setSpoonHeight(value) {
  spellTransition=null;
  config.spoonHeight=clamp(value);config.voice=witchVoiceAtHeight(config.spoonHeight);
}
async function toggleAudio() {
  const generation=++request;
  if(audioOn) { audioOn=false; audio.setAudible(false); sync(); return; }
  starting=true; $('liveStatus').textContent=''; sync();
  try {
    const hadNode=Boolean(audio.node);
    await audio.start();
    if(disposed || generation!==request) return;
    if(!hadNode) {advancePerformanceTime();audio.syncPhase(silentPhase,silentSpeed,silentHandTime,undefined,silentFlightPhase,silentGhostPhase,snapshotWitchCatClock(catClock),silentFlybyTime);}
    audioMotionReady=true;
    audioOn=true; send(); audio.setAudible(!document.hidden);
  } catch(error) { audioOn=false; $('liveStatus').textContent=`Sound could not start: ${error.message}. Try Audio again.`; }
  finally { if(generation===request && !disposed) { starting=false; sync(); } }
}
listen($('audioButton'),'click',toggleAudio);
listen($('playButton'),'click',() => { stopGesture(); setPlaying(!playing); send(); sync(); });
listen($('resetButton'),'click',() => { stopGesture(); setPlaying(false); audio.releaseAccents(); performanceTime=0; catMeowAt=eyeShockAt=spiderAt=webAt=fabricWindAt=-Infinity;world.hatPullX=world.hatPullY=0;spellTransition=null;for(const id of Object.keys(capturedAnimals))delete capturedAnimals[id]; config=normalizeWitchPreset(WITCH_DEFAULTS); Object.assign(catClock,createWitchCatClock(0,config)); silentPhase=0; silentSpeed=0; audio.syncPhase(0,0,0,undefined,0,0,snapshotWitchCatClock(catClock),0); ladleOffset=0; motionTime=0; silentHandTime=0; silentFlightPhase=0; silentGhostPhase=0; silentFlybyTime=0;mushroomPresetId=null; event=null;selectedIngredient=-1; world.trip=0;world.handOpen=false;for(const object of objects){object.dropped=false;returnObject(object);} send(); sync(); $('gestureReadout').value='The pot is listening.'; });
for(const button of document.querySelectorAll('[data-world-action]')) listen(button,'click',() => worldAction(button.dataset.worldAction));
listen($('voice'),'change',() => { spellTransition=null; config.voice=$('voice').value;config.spoonAuto=false;config.spoonHeight=(WITCH_VOICES.indexOf(config.voice)+.5)/WITCH_VOICES.length; send(); sync(); });
for(const key of ['speed','radius','altitude','tone','flightX','nose','hat','hair','spoonHeight']) listen($(key),'input',() => { config[key]=Number($(key).value);if(key==='spoonHeight'){config.spoonAuto=false;setSpoonHeight(config[key]);} send(); sync(); });
listen($('ghostTempo'),'input',()=>{config.ghostTempo=clamp($('ghostTempo').value,36,180);send();sync();});
listen($('visualMode'),'change',()=>{config.visualMode=Number($('visualMode').value);sync();});
listen($('treeShape'),'input',()=>{config.treeShape=Number($('treeShape').value);sync();});
for(const button of document.querySelectorAll('[data-web]'))listen(button,'click',()=>pluckWeb(Number(button.dataset.web)));
for(const button of document.querySelectorAll('[data-animal]'))listen(button,'click',()=>captureAnimal(button.dataset.animal));
listen($('witchParameters'),'input',()=>{spellTransition=null;});
listen($('witchParameters'),'change',()=>{spellTransition=null;});
listen($('palette'),'change',()=>{config.palette=Math.round(clamp($('palette').value,0,7));sync();});
listen($('lineBend'),'input',()=>{config.trip=Math.round(clamp($('lineBend').value,0,3));config.visualMode=config.trip;world.trip=config.trip;sync();});
listen($('spoonAuto'),'change',()=>{config.spoonAuto=$('spoonAuto').checked;send();sync();});
for(const button of document.querySelectorAll('[data-drop]')) listen(button,'click',()=>dropObject(button.dataset.drop));
for(const key of ['handMotion','handSound','catGait'])listen($(key),'change',()=>{advancePerformanceTime();config[key]=$(key).value;send();sync();});
for(const key of ['handRate','handDepth','catSpeed','fabricX','fabricY','trailPull','trailTwist','spellBalance'])listen($(key),'input',()=>{advancePerformanceTime();config[key]=Number($(key).value);send();sync();});
listen($('flightSpeed'),'input',()=>{ config.speed=Number($('flightSpeed').value); send(); sync(); });
for(let i=0;i<5;i++) {
  const slider=$(`finger${i}`);
  const release=()=>{ sliderKeys.delete(i); send(); };
  listen(slider,'input',() => { config.fingers[i]=Number(slider.value); selectedFinger=i; send(); sync(); });
  listen(slider,'pointerdown',e=>{
    slider.focus({preventScroll:true}); sliderPointers.set(e.pointerId,i); selectedFinger=i; send();
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture']) listen(slider,type,e=>{ if(sliderPointers.delete(e.pointerId)) send(); });
  listen(slider,'blur',release);
  listen(slider,'keydown',e=>{ if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(e.key)) { sliderKeys.add(i); selectedFinger=i; send(); } });
  listen(slider,'keyup',release);
}
for(const type of ['pointerup','pointercancel']) listen(window,type,e=>{ if(sliderPointers.delete(e.pointerId)) send(); });
listen($('reverseButton'),'click',() => { config.direction*=-1; send(); sync(); });
listen($('outputLevel'),'input',() => { $('outputLevelOut').value=`${Math.round(Number($('outputLevel').value)*100)}%`; send(); });
for(const button of document.querySelectorAll('[data-effect]')) listen(button,'click',() => trigger(button.dataset.effect));
listen($('glassButton'),'click',() => { config.glass=clamp(config.glass+.25); event={kind:'glass',age:0}; send(); sync(); });
listen($('clearIngredients'),'click',() => { config.glass=0; config.hair=0; send(); sync(); });
function canonical(e, logical=false, warpState) {
  const rect=canvas.getBoundingClientRect(); const scale=Math.min(rect.width/1000,rect.height/720);
  const p={x:(e.clientX-rect.left-(rect.width-1000*scale)/2)/scale,y:(e.clientY-rect.top-(rect.height-720*scale)/2)/scale};
  return logical?warpWitchPoint(p,warpState??visualState(),true):p;
}
function stirLocation(point) {
  const pot=WITCH_LAYOUT.cauldron;
  const x=(point.x-pot.x)/pot.rx, y=(point.y-pot.y)/pot.ry;
  return { angle:Math.atan2(y,x),radius:clamp(Math.hypot(x,y),.08,1) };
}
function visualState() {
  const v=audioMotionReady&&audio.node ? audio.visual : null;
  const phase=v?.phase??silentPhase, speed=v?.speed??silentSpeed;
  const mask=playing?31:fingerMask();
  const handTime=v?.handTime??silentHandTime;
  const spoonHeight=v?.spoonHeight??(config.spoonAuto && pointer?.type!=='spoon'?witchSpoonHeight(handTime):config.spoonHeight);
  const activeVoice=v?.activeVoice??(config.spoonAuto?witchVoiceAtHeight(spoonHeight):config.voice);
  const fingerLevels=audioOn&&v?.fingerLevels?v.fingerLevels:Array.from({length:5},(_,i)=>mask&(1<<i)?1:0);
  const ghostPhase=v?.ghostPhase??silentGhostPhase;
  ghostFrames.forEach((out,i)=>witchGhostFrame(ghostPhase,i,out));
  return { ...config, ...world, playing, performanceTime, capturedAnimals,flybyTime:v?.flybyTime??silentFlybyTime,
    paletteFrom:spellTransition?.from.palette??config.palette,paletteTo:spellTransition?.to.palette??config.palette,paletteMix:spellTransition?.mix??1,
    eyeShock:audioOn?(v?.shockEnvelope??0):witchAccentEnvelope(performance.now()/1000-eyeShockAt),spiderPulse:witchAccentEnvelope(performance.now()/1000-spiderAt),webPulse:witchAccentEnvelope(performance.now()/1000-webAt,1.3),webIndex,
    spiderSurface:spiderReady?spider.render(witchAccentEnvelope(performance.now()/1000-spiderAt),performanceTime):null, catFrame:catClock, catMeow:audioOn?(v?.catMeow??0):(playing?witchCatMeowEnvelope((performance.now()-catMeowAt)/1000):0), handPalms:handReady?[hand.getPalm(0),hand.getPalm(1)]:[], ghostPhase, ghostPresence:ghostFrames.map(frame=>frame.presence), ghostPulses:ghostFrames.map(frame=>playing?frame.pulse:0), flightPhase:v?.flightPhase??silentFlightPhase, objects, selectedIngredient:objects[selectedIngredient]?.id??null, spoonHeight, activeVoice, voice:activeVoice, gate:gate(), manualFingerMask:fingerMask(), reducedMotion:reducedMotion.matches, handTime, handSurface, handSurfaces, handsTips:handReady?[hand.getTips(0),hand.getTips(1)]:[], handWrists:handReady?[hand.getWrist(0),hand.getWrist(1)]:[], handTips:handReady?hand.getTips():[],handWrist:handReady?hand.getWrist():null,pickHand:handReady?hand.pick:null,warpTime:reducedMotion.matches?0:performance.now()/1000,time:performance.now()/1000, motionTime, phase, speed, energy:audioOn?(v?.energy??speed):speed, launchEnvelope:audioOn?(v?.launchEnvelope??0):(event?.kind==='launch'&&event.age<1.86?1:0), mouth:audioOn?(v?.mouth??0):(speed*(.35+.65*Math.abs(Math.sin(phase*3)))*(world.handOpen?.55:1)), fingerLevels, flightPulse:audioOn?(v?.flightPulse??0):speed*Math.max(0,Math.sin(phase*2)), direction:config.direction, event:event??(v?.effect ? {kind:v.effect,age:1-(v.effectEnvelope??0)} : null), selectedFinger, ladleAngle:pointer?.type==='stir'?pointer.ladleAngle:phase+ladleOffset, hitRadius:Math.max(46,24/Math.max(.1,Math.min(width/1000,height/720))) };
}
listen(canvas,'pointerdown',e => {
  if(pointer || e.button!==0) return;
  const initial=visualState(),raw=canonical(e),hit=hitTestWitch(raw.x,raw.y,initial),p=canonical(e,true,initial);
  if(!hit) return;
  canvas.focus({preventScroll:true});
  if(hit.type!=='object')spellTransition=null;
  if(['hand','moon','broom','mushrooms','mouth','eyes','tree','spider'].includes(hit.type)) { worldAction(hit.type);e.preventDefault(); return; }
  if(hit.type==='cat'||hit.type==='animal'){captureAnimal(hit.type==='cat'?'cat':hit.id);e.preventDefault();return;}
  if(hit.type==='web'){pluckWeb(hit.index??0);pointer={id:e.pointerId,type:'web',lastWeb:hit.index??0};canvas.setPointerCapture(e.pointerId);e.preventDefault();return;}
  if(['bat','spark','gust'].includes(hit.type)) { trigger(hit.type); return; }
  if(hit.type==='ghost') {
    pointer={id:e.pointerId,type:'ghost',index:hit.index,start:p,ghostTempo:config.ghostTempo};
    canvas.setPointerCapture(e.pointerId);e.preventDefault();return;
  }
  if(hit.type==='object') {dropObject(hit.id);e.preventDefault();return;}
  if(hit.type==='stir' && config.scene==='fingers') setScene('brew');
  if(hit.type==='finger') {
    selectedFinger=hit.index; fingerPointers.set(e.pointerId,{index:hit.index,start:p,transform:handTransform(visualState()),value:config.fingers[hit.index]});
    canvas.setPointerCapture(e.pointerId); send(); sync(); e.preventDefault(); return;
  }
  keyboardGate=false;
  const visual=visualState(), start=stirLocation(p), pot=WITCH_LAYOUT.cauldron;
  const hair=hit.type==='hair'?getWitchHair(initial):null;
  const hat=hit.type==='hat'?getWitchHat(initial):null;
  const onHandle=((p.x-pot.x)/pot.rx)**2+((p.y-pot.y)/pot.ry)**2>1;
  pointer={id:e.pointerId,type:hit.type,index:hit.index??0,start:p,value:config.fingers[hit.index??0],time:performance.now(),spoonHeight:visual.spoonHeight,nose:config.nose,hat:config.hat,hatTransform:hat?.transform,hatPullX:world.hatPullX,hatPullY:world.hatPullY,hair:config.hair,hairAxis:hair?.axis,hairDistance:hair?.pullDistance,hairWarp:(hair||hat)?{trip:initial.trip,visualMode:initial.visualMode,eyeShock:initial.eyeShock,reducedMotion:initial.reducedMotion,warpTime:initial.warpTime}:null,fabricX:config.fabricX,fabricY:config.fabricY,trailPull:config.trailPull,trailTwist:config.trailTwist,...start,ladleAngle:onHandle?visual.ladleAngle:start.angle,radiusOffset:onHandle?config.radius-start.radius:0};
  canvas.setPointerCapture(e.pointerId);
  if(hit.type==='spoon') setSpoonHeight(visual.spoonHeight);
  if(hit.type==='fabric')windFabric();
  if(hit.type==='stir') { config.speed=.05; if(!onHandle) config.radius=pointer.radius; }
  if(hit.type==='finger') selectedFinger=pointer.index;
  if(hit.type==='flight') { config.flightX=clamp(p.x/1000,.12,.88); config.altitude=clamp(1-p.y/720); }
  send(); sync(); e.preventDefault();
});
listen(canvas,'pointermove',e => {
  const held=fingerPointers.get(e.pointerId);
  if(held) {
    const p=canonical(e,true),t=held.transform,dx=p.x-held.start.x,dy=p.y-held.start.y,det=t.a*t.d-t.b*t.c;
    const localX=(t.d*dx-t.c*dy)/det,localY=(t.a*dy-t.b*dx)/det;
    config.fingers[held.index]=clamp(held.value+(held.index===0?-1:1)*localY/220+localX/600);
    send(); sync(); e.preventDefault(); return;
  }
  if(!pointer || pointer.id!==e.pointerId) {
    const p=canonical(e),hit=hitTestWitch(p.x,p.y,visualState());
    canvas.style.cursor=hit?'grab':'default';
    canvas.title=hit?.type==='object'?objects.find(item=>item.id===hit.id)?.name??'':({cat:'Meow — into the potion!',animal:'Catch this visitor',mouth:'Change her phrase',eyes:'An electrical hex',tree:'Play the L-system tree and reshape its branches',spider:'Wake the spider',web:'Pluck the web',broom:config.scene==='flight'?'Land beside the pot':'Take flight',fabric:'Touch the mesh for wind; pull to filter it',trail:'Pull her flying hair to bend the delay',ghost:'Lift a ghost to quicken the beat; lower it to slow the beat',spoon:'Lift or lower the spoon to change her voice',nose:'Pull her nose',hat:'Stretch the burned hat in any direction',hair:'Pull her hair for a noisier spell',hand:'Feature her finger spells',moon:'Fly to the moon',mushrooms:'Change the whole spell'})[hit?.type]??'';
    return;
  }
  if(pointer.type==='web'){const p=canonical(e),hit=hitTestWitch(p.x,p.y,visualState());if(hit?.type==='web'&&hit.index!==pointer.lastWeb){pluckWeb(hit.index);pointer.lastWeb=hit.index;}e.preventDefault();return;}
  const p=canonical(e,true,['hair','hat'].includes(pointer.type)?pointer.hairWarp:undefined), now=performance.now();
  if(pointer.type==='fabric') {
    config.fabricX=clamp(pointer.fabricX+(p.x-pointer.start.x)/120);config.fabricY=clamp(pointer.fabricY+(pointer.start.y-p.y)/120);
    if(now-fabricWindAt>100)windFabric();
  }
  else if(pointer.type==='trail') {config.trailPull=clamp(pointer.trailPull+(p.x-pointer.start.x)/100);config.trailTwist=clamp(pointer.trailTwist+(pointer.start.y-p.y)/90);}
  else if(pointer.type==='ghost') { config.ghostTempo=clamp(pointer.ghostTempo+pointer.start.y-p.y,36,180); }
  else if(pointer.type==='spoon') { setSpoonHeight(pointer.spoonHeight+(pointer.start.y-p.y)/180); }
  else if(pointer.type==='hair') {
    // The captured direction and warp keep moving broom/mushroom animation
    // from tugging the control underneath a stationary pointer.
    const dx=p.x-pointer.start.x,dy=p.y-pointer.start.y;
    config.hair=clamp(pointer.hair+(dx*pointer.hairAxis.x+dy*pointer.hairAxis.y)/Math.max(1,pointer.hairDistance));
  }
  else if(pointer.type==='hat') {
    const t=pointer.hatTransform,dx=p.x-pointer.start.x,dy=p.y-pointer.start.y;
    const x=(Math.cos(t.rotation)*dx+Math.sin(t.rotation)*dy)/t.scale,y=(-Math.sin(t.rotation)*dx+Math.cos(t.rotation)*dy)/t.scale;
    world.hatPullX=clamp(pointer.hatPullX+x,-185,185);world.hatPullY=clamp(pointer.hatPullY+y,-145,125);
    config.hat=clamp(pointer.hat+(Math.abs(x)*.7-y)/180);
  } else if(pointer.type==='nose') {config.nose=clamp(pointer.nose+(p.x-pointer.start.x)/150);}
  else if(pointer.type==='stir') {
    const current=stirLocation(p); let delta=current.angle-pointer.angle;
    if(delta>Math.PI) delta-=TAU; if(delta< -Math.PI) delta+=TAU;
    const dt=Math.max(.012,(now-pointer.time)/1000);
    if(Math.abs(delta)>.003) config.direction=delta<0?-1:1;
    config.speed=clamp(config.speed*.35+Math.abs(delta)/dt/12*.65,.02,1);
    config.radius=clamp(current.radius+pointer.radiusOffset,.08,1); pointer.ladleAngle+=delta; pointer.angle=current.angle; pointer.time=now;
  } else if(pointer.type==='finger') { config.fingers[pointer.index]=clamp(pointer.value+(pointer.index===0?-1:1)*(p.y-pointer.start.y)/220+(p.x-pointer.start.x)/600); }
  else if(pointer.type==='flight') { config.flightX=clamp(p.x/1000,.12,.88); config.altitude=clamp(1-p.y/720); config.speed=clamp(.15+Math.abs(p.x-pointer.start.x)/450,.02,1); }
  send(); sync(); e.preventDefault();
});
function releasePointer(e) {
  if(pointer?.id===e.pointerId && pointer.type==='ghost') {
    pointer=null;
    if(canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    send();sync();return;
  }
  if(fingerPointers.delete(e.pointerId)) { if(canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); send(); sync(); }
  if(pointer?.id===e.pointerId) { stopGesture(); sync(); }
}
listen(canvas,'pointerup',releasePointer); listen(canvas,'pointercancel',releasePointer); listen(canvas,'lostpointercapture',releasePointer);
listen(canvas,'keydown',e => {
  if(e.altKey || e.ctrlKey || e.metaKey) return;
  if(e.key==='Escape') { setScene('brew'); setPlaying(false); send(); sync(); e.preventDefault(); return; }
  if(/^[1-5]$/.test(e.key)) { selectedFinger=Number(e.key)-1; fingerKeys.add(selectedFinger); $('gestureReadout').value=instrumentLabels[selectedFinger]; send(); e.preventDefault(); return; }
  if(e.key==='[' || e.key===']') {
    selectedIngredient=selectedIngredient<0?(e.key===']'?0:objects.length-1):(selectedIngredient+(e.key===']'?1:-1)+objects.length)%objects.length;
    $('gestureReadout').value=`${objects[selectedIngredient].name}. Press Enter to drop into the potion.`;
    e.preventDefault();return;
  }
  if(e.key==='Enter') { if(!e.repeat)dropObject(objects[Math.max(0,selectedIngredient)].id);e.preventDefault();return; }
  if(['-','_','+','='].includes(e.key)) { config.tone=clamp(config.tone+(['+','='].includes(e.key)?.05:-.05));send();sync();e.preventDefault();return; }
  const objectId={q:'gesticules',e:'marimba',r:'choir'}[e.key.toLowerCase()];
  if(objectId){if(!e.repeat)dropObject(objectId);e.preventDefault();return;}
  const action={h:'hand',m:'moon',b:'brew',w:'mushrooms',f:'fabric',v:'mouth',x:'eyes',t:'tree',s:'spider'}[e.key.toLowerCase()];
  if(action) {if(!e.repeat) worldAction(action);e.preventDefault();return;}
  if(e.key.toLowerCase()==='g') { config.ghostTempo=clamp(config.ghostTempo+(e.shiftKey?-6:6),36,180);send();sync();e.preventDefault();return; }
  if(e.key.toLowerCase()==='p'){if(!e.repeat)pluckWeb((webIndex+1)%7);e.preventDefault();return;}
  const animal={c:'cat',n:'mouse',l:'lizard'}[e.key.toLowerCase()];
  if(animal){if(!e.repeat)captureAnimal(animal);e.preventDefault();return;}
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
  const step=e.shiftKey?.12:.035;
  if(world.handOpen || fingerKeys.size) { config.fingers[selectedFinger]=clamp(config.fingers[selectedFinger]+(['ArrowUp','ArrowRight'].includes(e.key)?step:-step)); }
  else if(config.scene==='flight') { if(e.key==='ArrowUp'||e.key==='ArrowDown') config.altitude=clamp(config.altitude+(e.key==='ArrowUp'?step:-step)); else config.flightX=clamp(config.flightX+(e.key==='ArrowRight'?step:-step),.12,.88); }
  else if(e.key==='ArrowUp'||e.key==='ArrowDown') config.radius=clamp(config.radius+(e.key==='ArrowUp'?step:-step),.08,1);
  else config.direction=e.key==='ArrowLeft'?-1:1;
  arrowKeys.add(e.key); keyboardGate=true; send(); sync(); e.preventDefault();
});
listen(canvas,'keyup',e => {
  if(/^[1-5]$/.test(e.key)) { fingerKeys.delete(Number(e.key)-1); send(); }
  if(e.key.startsWith('Arrow')) { arrowKeys.delete(e.key); keyboardGate=arrowKeys.size>0; send(); }
});
listen(canvas,'blur',() => { stopGesture(); });
listen(window,'blur',() => { stopGesture(); });
listen(window,'morphazoid:midi-input',e => { if(['noteOn','noteOff','pitchBend'].includes(e.detail?.message?.type)) e.preventDefault(); });
function resize() {
  const rect=canvas.getBoundingClientRect(); width=rect.width; height=rect.height;
  const dpr=Math.min(1.5,window.devicePixelRatio||1);
  canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr); ctx.setTransform(dpr,0,0,dpr,0,0);
}
const observer=new ResizeObserver(resize); observer.observe($('witchViewport'));
function resumeDrawing() {
  cancelAnimationFrame(frame);frame=0;lastPaint=0;last=performance.now();lastPerformanceTick=last;
  if(!disposed && !document.hidden && !pageSuspended) frame=requestAnimationFrame(draw);
}
function draw(now) {
  frame=0;
  if(disposed || document.hidden || pageSuspended) return;
  // Keep compositing below 30fps; audio and musical events own their sample clock.
  if(now-lastPaint<1000/30) {frame=requestAnimationFrame(draw);return;}
  lastPaint=now;
  const dt=Math.min(.06,(now-last)/1000); last=now;advancePerformanceTime(now);
  silentSpeed+=(gate()?config.speed-silentSpeed:-silentSpeed)*(1-Math.exp(-dt/(gate()?.08:1.3)));
  silentPhase=(silentPhase+config.direction*silentSpeed*dt*12+TAU)%TAU;
  motionTime+=dt*(audioMotionReady&&audio.node?audio.visual.speed:silentSpeed);
  if(audioMotionReady&&audio.node) {
    silentHandTime=audio.visual.handTime??silentHandTime;
    silentFlightPhase=audio.visual.flightPhase??silentFlightPhase;
    silentGhostPhase=audio.visual.ghostPhase??silentGhostPhase;
  } else if(gate()) {
    silentHandTime+=dt;silentFlightPhase+=dt*(1+config.speed*5)/1.4;
  }
  if(!(audioMotionReady&&audio.node) && playing) silentGhostPhase+=dt*config.ghostTempo/60;
  if(event) { event.age+=dt; if(event.age>3.5) event=null; }
  if(pointer?.type!=='hat') {
    const relax=reducedMotion.matches?0:Math.exp(-dt/.42);
    world.hatPullX*=relax;world.hatPullY*=relax;
    if(Math.abs(world.hatPullX)<.01)world.hatPullX=0;if(Math.abs(world.hatPullY)<.01)world.hatPullY=0;
  }
  const ease=reducedMotion.matches?1:1-Math.exp(-dt/ .18);
  for(const [key,target] of [['flightLift',config.scene==='flight'?1:0]]) { world[key]+=(target-world[key])*ease;if(Math.abs(target-world[key])<.001)world[key]=target; }
  for(const object of objects)if(object.dropped)object.dropAge=Math.min(10,Math.max(0,performanceTime-(object.droppedAt??performanceTime)));
  const state=visualState();
  if(handReady) {
    handSurfaces=[hand.render(state,0),hand.render(state,1)]; handSurface=handSurfaces[0];
    state.handSurface=handSurface;state.handSurfaces=handSurfaces;
    state.handPalms=[hand.getPalm(0),hand.getPalm(1)];
    state.handsTips=[hand.getTips(0),hand.getTips(1)];state.handWrists=[hand.getWrist(0),hand.getWrist(1)];
    state.handTips=state.handsTips[0];state.handWrist=state.handWrists[0];
  }
  renderWitch(ctx,width,height,state);
  frame=requestAnimationFrame(draw);
}
let readoutTick=0;
const clock=setInterval(() => {
  if(document.hidden || disposed) return;
  advancePerformanceTime();advanceSpell();
  if(Boolean(getWitchCatFrame({...config,performanceTime,catFrame:catClock,capturedAnimals}).captured)!==lastCatCaptured)send();
  // A held but motionless ladle loses energy; event timing never depends on drawing.
  if(pointer?.type==='stir' && performance.now()-pointer.time>120) { config.speed=Math.max(.02,config.speed*.8); send(); }
  if(++readoutTick%5===0) {
    const v=visualState();
    if(config.spoonAuto && pointer?.type!=='spoon') { $('voice').value=v.activeVoice;$('spoonHeight').value=v.spoonHeight;$('spoonHeightOut').value=`${Math.round(v.spoonHeight*100)}%`; }
    if(event)return;
    if(selectedIngredient>=0) { $('gestureReadout').value=`${objects[selectedIngredient].name}. Press Enter to drop into the potion.`;return; }
    $('gestureReadout').value=config.scene==='fingers'?(gate()?'Bend a finger to bend its sound.':'Her fingertips are listening.')
      :config.scene==='flight'?(v.speed>.025?`${Math.round(v.speed*100)}% flight · ${Math.round(config.altitude*100)}% height`:'The broom is waiting.')
        :v.speed>.025?`${config.direction<0?'Backward':'Forward'} · ${Math.round(v.speed*100)}% motion · ${Math.round(config.radius*100)}% open`:'The pot is listening.';
  }
},40);
listen(document,'visibilitychange',() => {
  if(document.hidden) { stopGesture(); audio.setAudible(false); cancelAnimationFrame(frame);frame=0; }
  else { audio.setAudible(audioOn&&!pageSuspended);resumeDrawing(); }
});
listen(window,'pageshow',e => {
  if(!e.persisted || disposed) return;
  pageSuspended=false;audio.setAudible(audioOn&&!document.hidden);resumeDrawing();
});
listen(window,'pagehide',e => {
  if(e.persisted) { pageSuspended=true;stopGesture(); audio.setAudible(false); cancelAnimationFrame(frame);frame=0; return; }
  if(disposed) return; disposed=true; ++request; clearInterval(clock); cancelAnimationFrame(frame); observer.disconnect(); abort.abort(); presets?.destroy(); hand.dispose();spider.dispose();audio.dispose();delete window.witchInstrument;
});
presets=registerHeaderPresets({id:'witch',presets:WITCH_PRESETS,capture:()=>structuredClone(config),apply:snapshot=>applySpell(snapshot),randomize:randomizeWitchPreset});
Object.defineProperty(window,'witchInstrument',{configurable:true,value:Object.freeze({get state() {
  const state=visualState(),catTargets=getWitchCatTargets(state),hair=getWitchHair(state);
  return {treeEnvelope:audio.visual.treeEnvelope??0,treeLevel:audio.visual.treeLevel??0,flybyTime:state.flybyTime,flybys:getWitchBlechFlyby(state.flybyTime),flybyLevel:audio.visual.flybyLevel??0,tree:getWitchTree(state),web:getWitchWeb(state),spellArm:getWitchSpellArm(state),eyeShock:state.eyeShock,spiderPulse:state.spiderPulse,webPulse:state.webPulse,spiderReady,spellTransition:spellTransition?{progress:spellTransition.mix,startsAt:spellTransition.start}:null,capturedAnimals:structuredClone(capturedAnimals),visitors:getWitchVisitors(state),visitorTargets:Object.fromEntries(Object.entries(getWitchVisitorTargets(state)).map(([id,targets])=>[id,Object.fromEntries(Object.entries(targets).map(([part,p])=>[part,{...p,...warpWitchPoint(p,state)}]))])),catMeow:state.catMeow,catTargets:catTargets?Object.fromEntries(Object.entries(catTargets).map(([key,value])=>[key,warpWitchPoint(value,state)])):null,config:structuredClone(config),playing,audioOn,world:{...world},handReady,performanceTime,cat:getWitchCatFrame(state),
    fingerTips:getFingerTips(state).map(p=>warpWitchPoint(p,state)),handWrist:state.handWrist,
    hands:[0,1].map(i=>({tips:getFingerTips(state,i).map(p=>warpWitchPoint(p,state)),wrist:warpWitchPoint(handTransform(state,i).wrist,state),palm:handReady?warpWitchPoint(transformHandPoint(state.handPalms[i],state,i),state):null,rotation:handTransform(state,i).rotation,scale:handTransform(state,i).scale})),handTime:state.handTime,flightPhase:state.flightPhase,manualFingerMask:state.manualFingerMask,spoonHeight:state.spoonHeight,activeVoice:state.activeVoice,
    ghostPhase:state.ghostPhase,ghosts:WITCH_LAYOUT.ghosts.map((_,i)=>{const ghost=getWitchGhostPosition(i,state);return {...ghost,...warpWitchPoint(ghost,state)};}),
    selectedIngredient:state.selectedIngredient,objects:objects.map(object=>({...object,...getWitchObjectPosition(object,state)})),targets:getWitchTargets(state),ladle:getWitchLadle(state),
    hairGeometry:{...hair,root:warpWitchPoint(hair.root,state),tip:warpWitchPoint(hair.tip,state),targets:hair.targets.map(p=>({...p,...warpWitchPoint(p,state)})),strands:hair.strands.map(strand=>({...strand,points:strand.points.map(p=>warpWitchPoint(p,state))}))},
    handMetadata:hand.getMetadata?.()??hand.metadata??null};
}})});
sync(); send(); resize(); resumeDrawing();
