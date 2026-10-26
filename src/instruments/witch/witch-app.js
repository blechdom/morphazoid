import { WitchAudio } from './witch-audio.js';
import { WITCH_VOICES, WITCH_HAND_SOUNDS, witchSpoonHeight, witchVoiceAtHeight, witchGhostFrame } from './witch-model.js';
import { blendWitchSpell, witchAccentEnvelope, getWitchBlechFlyby } from './witch-scene-model.js';
import { createWitchSpider } from './witch-spider.js';
import { getWitchVisitors, getWitchVisitorTargets } from './witch-visitors.js';
import { createWitchHand } from './witch-hand.js';
import { getWitchCatFrame, getWitchCatTargets } from './witch-cat.js';
import { createWitchCatClock, advanceWitchCatClock, snapshotWitchCatClock, witchCatMeowEnvelope } from './witch-cat-model.js';
import { renderWitch, hitTestWitch, getFingerTips, handTransform, transformHandPoint, getWitchObjectPosition, getWitchGhostPosition, getWitchTargets, getWitchLadle, getWitchHair, getWitchHat, getWitchTree, getWitchWeb, getWitchSpellArm, warpWitchPoint, WITCH_LAYOUT } from './witch-renderer.js';
import { WITCH_DEFAULTS, WITCH_PRESETS, WITCH_SETTING_PRESETS, witchPresetSettings, normalizeWitchPreset, randomizeWitchPreset } from './witch-presets.js';
import { registerHeaderPresets } from '../../site/header-presets.js';

const $ = id => document.getElementById(id);
const canvas = $('witchCanvas');
const ctx = canvas.getContext('2d', { alpha:false });
const audio = new WitchAudio();
audio.setPresence(0,0);
const abort = new AbortController();
const listen = (target,type,fn,options={}) => target.addEventListener(type,fn,{...options,signal:abort.signal});
const clamp = (v,min=0,max=1) => Math.max(min,Math.min(max,Number(v)||0));
const TAU = Math.PI * 2;
let config = normalizeWitchPreset(WITCH_DEFAULTS);
let playing = false, audioOn = false, starting = false, disposed = false, request = 0;
let selectedIngredient = -1, diceRolledAt=-Infinity, quietVisual=null;
const pendingAccents=[];
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
const fingerPointers = new Map(), fingerKeys = new Set(), arrowKeys = new Set();
let instrumentLabels = ['Thumb · glass','Index · reed','Middle · wire','Ring · metal','Little · marimba'];
let width = 1000, height = 720, presets;
const world={handReach:1,handOpen:false,flightLift:0,trip:0,hatPullX:0,hatPullY:0};
const objects=WITCH_LAYOUT.objects.map(object=>({...object,dragging:false,dropped:false,dropAge:0}));
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
let handReady=false,handSurface=null,handSurfaces=[],pageSuspended=false,audioMotionReady=false;
const hand=createWitchHand({onStatus:message=>{$('liveStatus').textContent=message;}});
hand.ready.then(ready=>{if(disposed)return;handReady=ready;canvas.dataset.handReady=String(ready);});
audio.onError=error => { audioMotionReady=false;audioOn=false;starting=false;hushPerformance();$('liveStatus').textContent=error.message; };
const sceneCopy = {
  brew: ['She brews her own voice.', 'Stir the pot. Pull her hair back to hush. Touch the moon to fly, mushrooms for a preset, or the die for new settings.', 'Stir for me', 'stirring'],
  fingers: ['An instrument in every finger.', 'Pull her fingertips. Touch the pot to return, the moon to fly, or mushrooms for trouble.', 'Play the hand', 'hand'],
  flight: ['Music for a midnight ride.', 'Pull the sky noodles to bend the delay. Pull her hair back to hush. Click the moon or broom again to land.', 'Take flight', 'flight'],
};
function fingerMask() {
  let mask=0;
  for(const held of fingerPointers.values()) mask |= 1 << held.index;
  for(const index of fingerKeys) mask |= 1 << index;
  if(keyboardGate && world.handOpen) mask |= 1 << selectedFinger;
  return mask;
}
function advancePerformanceTime(now=performance.now()) {
  const elapsed=Math.max(0,now-lastPerformanceTick)/1000;
  if(playing) {
    if(audioMotionReady&&audio.node) silentFlybyTime=audio.visual.flybyTime??silentFlybyTime;
    else if(config.scene==='flight') silentFlybyTime+=elapsed;
    if(audioMotionReady&&audio.node&&audio.visual.catClock) {performanceTime=audio.visual.catClock.time;Object.assign(catClock,audio.visual.catClock);}
    else {performanceTime+=elapsed;advanceWitchCatClock(catClock,performanceTime,config);}
  }
  lastPerformanceTick=now;
}
function setPlaying(value) {
  advancePerformanceTime();
  if(!value&&playing)quietVisual=audioMotionReady&&audio.node?structuredClone(audio.visual):null;
  playing=value;
  if(playing)quietVisual=null;
  else {catMeowAt=-Infinity;if(!audioMotionReady)silentSpeed=0;}
}
function hushPerformance() {
  setPlaying(false);stopGesture();pendingAccents.length=0;audio.releaseAccents();audio.setPresence(0,.8);
  sync();$('gestureReadout').value='The spell rests. Touch the picture to wake her.';
}
function cue(kind) {
  if(starting&&!audio.node) {pendingAccents.push(kind);if(pendingAccents.length>4)pendingAccents.shift();return;}
  audio.trigger(kind);
}
function wakePerformance() {
  if(!playing) {setPlaying(true);send();sync();}
  if(audioOn)audio.setPresence(1,.85);
  else if(!starting)void startAudio();
}
function gate() { return playing || Boolean(pointer && pointer.type!=='ghost') || keyboardGate || fingerMask()!==0; }
function send() { const cat=getWitchCatFrame({ ...config,performanceTime,catFrame:catClock,capturedAnimals }); lastCatCaptured=Boolean(cat.captured);audio.update({ ...config,catCaptured:lastCatCaptured, mode:config.scene, gate:gate(), ghostGate:playing, fingerMask:playing?0:fingerMask(), manualFingerMask:fingerMask(), handFocus:world.handOpen?1:0, spoonAuto:config.spoonAuto && pointer?.type!=='spoon', volume:Number($('outputLevel').value) }); }
function sync() {
  const [caption,hint,,action] = sceneCopy[config.scene];
  $('sceneLabel').textContent=caption;
  $('gestureHint').textContent=playing?hint:'Touch the picture to wake the spell. Pull her hair back to hush it again.';
  $('playLabel').textContent=playing?'Hush':'Wake';
  $('playGlyph').textContent=playing?'Ⅱ':'▶';
  $('playButton').setAttribute('aria-pressed',String(playing));
  $('playButton').setAttribute('aria-label',`${playing?'Hush':'Wake'} ${action}`);
  $('playButton').title=playing?'Hush the spell':'Wake the spell';
  $('audioButton').setAttribute('aria-pressed',String(audioOn));
  $('audioState').textContent=starting?'starting':audioOn?'on':'off';
  $('audioButton').disabled=starting;
  canvas.dataset.scene=config.scene;canvas.dataset.trip=String(world.trip);canvas.dataset.quiet=String(!playing);
  const handBank=WITCH_HAND_SOUNDS.find(bank=>bank.id===config.handSound)||WITCH_HAND_SOUNDS[0];
  instrumentLabels=handBank.sources.map((source,i)=>`${['Thumb','Index','Middle','Ring','Little'][i]} · ${source}`);
  canvas.setAttribute('aria-label',`${caption} ${$('gestureHint').textContent}`);
  presets?.refresh();
}
function stopGesture() {
  const held=pointer;
  if(held?.type==='stir') ladleOffset=held.ladleAngle-(audioMotionReady&&audio.node?audio.visual.phase:silentPhase);
  pointer=null; keyboardGate=false;
  const captured=[...fingerPointers.keys()]; fingerPointers.clear(); fingerKeys.clear(); arrowKeys.clear();
  for(const id of captured) if(canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  if (held && canvas.hasPointerCapture(held.id)) canvas.releasePointerCapture(held.id);
  send();
}
function setScene(scene) { advancePerformanceTime();spellTransition=null;stopGesture(); config.scene=scene; if(scene!=='flight') world.handOpen=scene==='fingers'; sync(); send(); }
function worldAction(action) {
  if(action==='moon'||action==='mushrooms')refillShelf();
  if(action==='hand') {
    if(config.scene==='flight') { stopGesture();world.handOpen=!world.handOpen;sync();send(); }
    else setScene(world.handOpen?'brew':'fingers');
  }
  else if(action==='moon'||action==='broom') {
    if(config.scene!=='flight') { setScene('flight'); trigger('launch'); }
    else setScene(world.handOpen?'fingers':'brew');
  } else if(action==='mushrooms') {
    const current=Math.max(0,WITCH_PRESETS.findIndex(preset=>preset.id===(presets?.selectedId??presets?.lastPresetId)));
    const next=WITCH_PRESETS[(current+1)%WITCH_PRESETS.length];
    if(presets?.view)presets.view.select(next.id);else applySpell(next.snapshot);
    $('gestureReadout').value=next.label;
  } else if(action==='dice') {
    if(presets?.view)presets.view.randomize();else applySpell(randomizeWitchPreset(config));
    diceRolledAt=performanceTime;$('gestureReadout').value='Twenty sides, a whole new spell.';
  } else if(action==='fabric') {
    if(config.scene==='flight')windFabric();
  } else if(action==='mouth') {
    spellTransition=null;const current=visualState().activeVoice;config.voice=WITCH_VOICES[(WITCH_VOICES.indexOf(current)+1)%WITCH_VOICES.length];config.spoonAuto=false;config.spoonHeight=(WITCH_VOICES.indexOf(config.voice)+.5)/WITCH_VOICES.length;send();sync();
  } else if(action==='eyes') {advancePerformanceTime();eyeShockAt=performanceTime;cue('eye-shock');}
  else if(action==='tree') {spellTransition=null;config.treeShape=(config.treeShape+1)%6;sync();cue('tree-l-system');}
  else if(action==='spider') {advancePerformanceTime();spiderAt=performanceTime;cue('spider-groan');}
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
  cue(kind);
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
function applySpell(snapshot,{refill=true}={}) {
  spellTransition=null;advancePerformanceTime();
  const scene=config.scene;
  stopGesture();config=normalizeWitchPreset({...snapshot,scene});
  world.trip=config.trip;world.hatPullX=world.hatPullY=0;
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
    const target=normalizeWitchPreset(spell.snapshot);
    target.scene=config.scene;
    spellTransition={from:structuredClone(config),to:target,start:performanceTime+(object.phraseDuration||0),duration:object.flightDuration||1.5,mix:0};
  }
  Object.assign(object,{x:origin.x,y:origin.y,dragging:false,dropped:true,dropAge:0,droppedAt:performanceTime});
  trigger(object.kind);sync();$('gestureReadout').value=`${object.name} joins the brew. Touch the mushrooms or moon to refill the ingredients.`;
}
function advanceSpell() {
  if(!spellTransition)return;
  const progress=clamp((performanceTime-spellTransition.start)/spellTransition.duration);
  spellTransition.mix=progress;
  config=blendWitchSpell(spellTransition.from,spellTransition.to,progress);
  world.trip=config.trip;
  if(progress===1)spellTransition=null;
  send();sync();
}
function captureAnimal(id) {
  advancePerformanceTime();
  const state=visualState(),animal=id==='cat'?getWitchCatFrame(state):getWitchVisitors(state).find(frame=>frame.id===id||frame.animalId===id);
  if(!animal||!animal.active||animal.captured||state.flightLift>.1)return;
  capturedAnimals[id]={startedAt:performanceTime,from:{x:animal.x,y:animal.y,rotation:animal.rotation,direction:animal.direction}};
  if(id==='cat')catMeowAt=performance.now();
  send();cue(`drop-${id}`);$('gestureReadout').value=`${id==='cat'?'Meow! ':''}The ${id} dives into the potion.`;
}
function windFabric() {
  if(config.scene!=='flight')return;
  fabricWindAt=performance.now();cue('fabric-wind');
}
function pluckWeb(index) {
  advancePerformanceTime();webIndex=Math.round(clamp(index,0,6));webAt=performanceTime;cue(`web-${webIndex}`);
}
function setSpoonHeight(value) {
  spellTransition=null;
  config.spoonHeight=clamp(value);config.voice=witchVoiceAtHeight(config.spoonHeight);
}
async function startAudio() {
  const generation=++request;
  starting=true;$('liveStatus').textContent='';sync();
  try {
    const hadNode=Boolean(audio.node);
    await audio.start();
    if(disposed||generation!==request)return;
    if(!hadNode) {advancePerformanceTime();audio.syncPhase(silentPhase,silentSpeed,silentHandTime,undefined,silentFlightPhase,silentGhostPhase,snapshotWitchCatClock(catClock),silentFlybyTime);}
    audioMotionReady=true;audioOn=true;send();audio.setAudible(!document.hidden);
    audio.setPresence(playing?1:0,playing?.85:0);
    if(playing)for(const kind of pendingAccents.splice(0))audio.trigger(kind);
    else pendingAccents.length=0;
  } catch(error) {audioOn=false;hushPerformance();$('liveStatus').textContent=`Sound could not start: ${error.message}. Touch Audio to try again.`;}
  finally {if(generation===request&&!disposed){starting=false;sync();}}
}
listen($('audioButton'),'click',()=>{
  if(audioOn) {hushPerformance();audioOn=false;audio.setAudible(false);sync();}
  else wakePerformance();
});
listen($('playButton'),'click',()=>{if(playing)hushPerformance();else wakePerformance();});
listen($('resetButton'),'click',()=>{
  const scene=config.scene;
  hushPerformance();performanceTime=0;quietVisual=null;
  catMeowAt=eyeShockAt=spiderAt=webAt=fabricWindAt=diceRolledAt=-Infinity;
  world.hatPullX=world.hatPullY=0;spellTransition=null;
  for(const id of Object.keys(capturedAnimals))delete capturedAnimals[id];
  config=normalizeWitchPreset({...WITCH_DEFAULTS,scene});Object.assign(catClock,createWitchCatClock(0,config));
  silentPhase=silentSpeed=ladleOffset=motionTime=silentHandTime=silentFlightPhase=silentGhostPhase=silentFlybyTime=0;
  audio.syncPhase(0,0,0,undefined,0,0,snapshotWitchCatClock(catClock),0);
  event=null;world.trip=0;world.handOpen=scene==='fingers';refillShelf();send();sync();
  $('gestureReadout').value='The pot is listening.';
});
listen($('outputLevel'),'input',()=>{$('outputLevelOut').value=`${Math.round(Number($('outputLevel').value)*100)}%`;send();});
// The owner explicitly makes a real picture/preset gesture the Audio opt-in.
// Pointerup after a hair pull must not immediately wake the spell again.
const wakeFromPicture=e=>{
  if(!e.isTrusted||(e.type==='pointerdown'&&e.button!==0)||e.target.closest('#playButton,#resetButton'))return;
  if(e.type==='click'&&e.detail!==0)return;
  wakePerformance();
};
listen($('witchViewport'),'pointerdown',wakeFromPicture,{capture:true});
listen($('witchViewport'),'click',wakeFromPicture,{capture:true});
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
  const v=audioMotionReady&&audio.node ? (playing?audio.visual:quietVisual) : null;
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
    eyeShock:audioOn?(v?.shockEnvelope??0):witchAccentEnvelope(performanceTime-eyeShockAt),spiderPulse:witchAccentEnvelope(performanceTime-spiderAt),webPulse:witchAccentEnvelope(performanceTime-webAt,1.3),webIndex,
    spiderSurface:spiderReady?spider.render(witchAccentEnvelope(performanceTime-spiderAt),performanceTime):null, catFrame:catClock, catMeow:audioOn?(v?.catMeow??0):(playing?witchCatMeowEnvelope((performance.now()-catMeowAt)/1000):0), handPalms:handReady?[hand.getPalm(0),hand.getPalm(1)]:[], ghostPhase, ghostPresence:ghostFrames.map(frame=>frame.presence), ghostPulses:ghostFrames.map(frame=>playing?frame.pulse:0), flightPhase:v?.flightPhase??silentFlightPhase, objects, selectedIngredient:objects[selectedIngredient]?.id??null, diceRoll:clamp(1-(performanceTime-diceRolledAt)/.7), spoonHeight, activeVoice, voice:activeVoice, gate:gate(), manualFingerMask:fingerMask(), reducedMotion:reducedMotion.matches, handTime, handSurface, handSurfaces, handsTips:handReady?[hand.getTips(0),hand.getTips(1)]:[], handWrists:handReady?[hand.getWrist(0),hand.getWrist(1)]:[], handTips:handReady?hand.getTips():[],handWrist:handReady?hand.getWrist():null,pickHand:handReady?hand.pick:null,warpTime:reducedMotion.matches?0:performanceTime,time:performanceTime, motionTime, phase, speed, energy:audioOn?(v?.energy??speed):speed, launchEnvelope:audioOn?(v?.launchEnvelope??0):(event?.kind==='launch'&&event.age<1.86?1:0), mouth:audioOn?(v?.mouth??0):(speed*(.35+.65*Math.abs(Math.sin(phase*3)))*(world.handOpen?.55:1)), fingerLevels, flightPulse:audioOn?(v?.flightPulse??0):speed*Math.max(0,Math.sin(phase*2)), direction:config.direction, event:event??(v?.effect ? {kind:v.effect,age:1-(v.effectEnvelope??0)} : null), selectedFinger, ladleAngle:pointer?.type==='stir'?pointer.ladleAngle:phase+ladleOffset, hitRadius:Math.max(46,24/Math.max(.1,Math.min(width/1000,height/720))) };
}
listen(canvas,'pointerdown',e => {
  if(pointer || e.button!==0) return;
  const initial=visualState(),raw=canonical(e),hit=hitTestWitch(raw.x,raw.y,initial),p=canonical(e,true,initial);
  if(!hit) return;
  canvas.focus({preventScroll:true});
  if(hit.type!=='object')spellTransition=null;
  if(['hand','moon','broom','mushrooms','dice','mouth','eyes','tree','spider'].includes(hit.type)) { worldAction(hit.type);e.preventDefault(); return; }
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
    canvas.title=hit?.type==='object'?objects.find(item=>item.id===hit.id)?.name??'':({cat:'Meow — into the potion!',animal:'Catch this visitor',mouth:'Change her phrase',eyes:'An electrical hex',tree:'Play the L-system tree and reshape its branches',spider:'Wake the spider',web:'Pluck the web',broom:config.scene==='flight'?'Land beside the pot':'Take flight',fabric:'Touch the mesh for wind; pull to filter it',trail:'Pull her flying hair to bend the delay',ghost:'Lift a ghost to quicken the beat; lower it to slow the beat',spoon:'Lift or lower the spoon to change her voice',nose:'Pull her nose',hat:'Stretch the burned hat in any direction',hair:'Pull her hair back to hush; touch the picture to wake',hand:'Feature her finger spells',moon:'Fly to the moon',mushrooms:'Change the spell settings',dice:'Roll all the spell settings'})[hit?.type]??'';
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
    const pull=(dx*pointer.hairAxis.x+dy*pointer.hairAxis.y)/Math.max(1,pointer.hairDistance);
    config.hair=clamp(pointer.hair+pull);
    if(pull>.62)hushPerformance();
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
  if(e.key==='Escape') {hushPerformance();e.preventDefault();return;}
  if(e.key===' '||e.code==='Space') {if(!e.repeat){if(playing)hushPerformance();else wakePerformance();}e.preventDefault();return;}
  if(e.isTrusted&&(/^[1-5]$/.test(e.key)||['[',']','Enter','-','_','+','=','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)||/^[qerhmbwdfvxtsgpcnl]$/i.test(e.key)))wakePerformance();
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
  const action={h:'hand',m:'moon',b:'brew',w:'mushrooms',d:'dice',f:'fabric',v:'mouth',x:'eyes',t:'tree',s:'spider'}[e.key.toLowerCase()];
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
  const dt=playing?Math.min(.06,(now-last)/1000):0;last=now;advancePerformanceTime(now);
  silentSpeed+=(gate()?config.speed-silentSpeed:-silentSpeed)*(1-Math.exp(-dt/(gate()?.08:1.3)));
  silentPhase=(silentPhase+config.direction*silentSpeed*dt*12+TAU)%TAU;
  motionTime+=dt*(audioMotionReady&&audio.node?audio.visual.speed:silentSpeed);
  if(audioMotionReady&&audio.node&&playing) {
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
  if(playing&&++readoutTick%5===0) {
    const v=visualState();
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
presets=registerHeaderPresets({id:'witch',presets:WITCH_SETTING_PRESETS,capture:()=>witchPresetSettings(config),apply:snapshot=>applySpell(snapshot),randomize:(previous,random)=>witchPresetSettings(randomizeWitchPreset(previous,random))});
Object.defineProperty(window,'witchInstrument',{configurable:true,value:Object.freeze({get state() {
  const state=visualState(),catTargets=getWitchCatTargets(state),hair=getWitchHair(state);
  return {visualTime:state.time,warpTime:state.warpTime,presenceLevel:audio.presenceNode?.gain.value??audio.presence,treeEnvelope:audio.visual.treeEnvelope??0,treeLevel:audio.visual.treeLevel??0,flybyTime:state.flybyTime,flybys:getWitchBlechFlyby(state.flybyTime),flybyLevel:audio.visual.flybyLevel??0,tree:getWitchTree(state),web:getWitchWeb(state),spellArm:getWitchSpellArm(state),eyeShock:state.eyeShock,spiderPulse:state.spiderPulse,webPulse:state.webPulse,spiderReady,spellTransition:spellTransition?{progress:spellTransition.mix,startsAt:spellTransition.start}:null,capturedAnimals:structuredClone(capturedAnimals),visitors:getWitchVisitors(state),visitorTargets:Object.fromEntries(Object.entries(getWitchVisitorTargets(state)).map(([id,targets])=>[id,Object.fromEntries(Object.entries(targets).map(([part,p])=>[part,{...p,...warpWitchPoint(p,state)}]))])),catMeow:state.catMeow,catTargets:catTargets?Object.fromEntries(Object.entries(catTargets).map(([key,value])=>[key,warpWitchPoint(value,state)])):null,config:structuredClone(config),playing,audioOn,starting,quiet:!playing,presence:audio.presence,world:{...world},handReady,performanceTime,cat:getWitchCatFrame(state),
    fingerTips:getFingerTips(state).map(p=>warpWitchPoint(p,state)),handWrist:state.handWrist,
    hands:[0,1].map(i=>({tips:getFingerTips(state,i).map(p=>warpWitchPoint(p,state)),wrist:warpWitchPoint(handTransform(state,i).wrist,state),palm:handReady?warpWitchPoint(transformHandPoint(state.handPalms[i],state,i),state):null,rotation:handTransform(state,i).rotation,scale:handTransform(state,i).scale})),handTime:state.handTime,flightPhase:state.flightPhase,manualFingerMask:state.manualFingerMask,spoonHeight:state.spoonHeight,activeVoice:state.activeVoice,
    ghostPhase:state.ghostPhase,ghosts:WITCH_LAYOUT.ghosts.map((_,i)=>{const ghost=getWitchGhostPosition(i,state);return {...ghost,...warpWitchPoint(ghost,state)};}),
    selectedIngredient:state.selectedIngredient,objects:objects.map(object=>({...object,...getWitchObjectPosition(object,state)})),targets:getWitchTargets(state),ladle:getWitchLadle(state),
    hairGeometry:{...hair,root:warpWitchPoint(hair.root,state),tip:warpWitchPoint(hair.tip,state),targets:hair.targets.map(p=>({...p,...warpWitchPoint(p,state)})),strands:hair.strands.map(strand=>({...strand,points:strand.points.map(p=>warpWitchPoint(p,state))}))},
    handMetadata:hand.getMetadata?.()??hand.metadata??null};
}})});
sync(); send(); resize(); resumeDrawing();
