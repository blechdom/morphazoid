import { WitchAudio } from './witch-audio.js';
import { createWitchTrailGesture, beginWitchTrailGesture, moveWitchTrailGesture, releaseWitchTrailGesture, advanceWitchTrailGesture, witchTrailSpaceAtPoint, witchHairDelayControls } from './witch-trail-gesture.js';
import { createWitchFabricGesture, beginWitchFabricGesture, moveWitchFabricGesture, releaseWitchFabricGesture, advanceWitchFabricGesture } from './witch-fabric-gesture.js';
import { WITCH_VOICES, WITCH_HAND_MOTIONS, WITCH_HAND_SOUNDS, witchSpoonHeight, witchVoiceAtHeight, witchGhostFrame } from './witch-model.js';
import { blendWitchSpell, witchAccentEnvelope, witchWebCrossings, getWitchBlechFlyby, WITCH_GHOST_SCREAMS, getWitchGhostScream } from './witch-scene-model.js';
import { createWitchSpider } from './witch-spider.js';
import { createWitchEye } from './witch-eye.js';
import { getWitchVisitors, getWitchVisitorTargets } from './witch-visitors.js';
import { createWitchHand } from './witch-hand.js';
import { getWitchCatFrame, getWitchCatTargets } from './witch-cat.js';
import { createWitchCatClock, advanceWitchCatClock, snapshotWitchCatClock, witchCatMeowEnvelope } from './witch-cat-model.js';
import { WITCH_SHAPE_FORMS, getWitchShapeForm, getWitchShapeFrame, retargetWitchShapeCharm } from './witch-shape-model.js';
import { createWitchRenderBudget, resizeWitchRenderBudget, sampleWitchRenderBudget } from './witch-performance.js';
import { renderWitch, disposeWitchRenderer, hitTestWitch, getFingerTips, handTransform, transformHandPoint, getWitchObjectPosition, getWitchGhostPosition, getWitchGhostScare, getWitchTargets, getWitchLadle, getWitchHair, getWitchHat, getWitchHatDrop, getWitchTree, getWitchTreePulse, getWitchWeb, getWitchSpellArm, getWitchRestTrails, getWitchTrails, warpWitchPoint, getWitchLayout, getWitchViewport, WITCH_LAYOUT } from './witch-renderer.js';
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
// These are live transport choices, separate from each preset's auto motion.
// Keep the last values on Stop so the normal release tails can finish.
const awake={brew:true,hand:true,backing:true};
// Hair hush leaves a live manual instrument. Preset-owned automation stays
// saved, but cannot return until an explicit whole-scene preset recall.
let manualOnly=false,manualVoiceUntil=0;
let wakeFadeSeconds=.85;
let selectedIngredient = -1, quietVisual=null;
let shapeCharm={from:0,to:0,startedAt:-Infinity};
let blechFrenzyIndex=0;
let webStrumDetail=null;
const pendingAccents=[];
let performanceTime=0,lastPerformanceTick=performance.now();
const catClock=createWitchCatClock(0,config);
let catMeowAt=-Infinity, eyeShockAt=-Infinity, spiderAt=-Infinity, webAt=-Infinity, webIndex=0, fabricWindAt=-Infinity;
let spellTransition=null,lastCatCaptured=false,hairHush=null;
let ghostScare=null,ghostScreamVariant=-1;
const HAIR_HUSH_SECONDS=3.2;
const capturedAnimals={};
let catCaptureCount=0;
const fabricGesture=createWitchFabricGesture();
let fabricTick=0;
const trailGesture=createWitchTrailGesture();
let trailTick=0;
const spider=createWitchSpider(document,{onInvalidate:requestPaint});
let spiderReady=false,spiderSurface=null;
spider.ready.then(ready=>{if(disposed)return;spiderReady=ready;canvas.dataset.spiderReady=String(ready);requestPaint();});
let selectedFinger = 1, frame = 0, clock=0, paintDirty=true, lastPaint=0, last = performance.now(), silentPhase = 0, silentSpeed = 0;
let treeKeyboard = null;
let pointer = null, keyboardGate = false, event = null, ladleOffset = 0, motionTime = 0, silentHandTime = 0, silentFlightPhase = 0, silentGhostPhase = 0, silentFlybyTime = 0;
const ghostFrames=Array.from({length:3},()=>({}));
const fingerPointers = new Map(), fingerKeys = new Set(), arrowKeys = new Set();
let instrumentLabels = ['Thumb · glass','Index · reed','Middle · wire','Ring · metal','Little · marimba'];
let width = 1000, height = 720, portraitLayout = window.innerWidth < window.innerHeight, presets;
const world={handReach:1,handOpen:false,flightLift:0,trip:0,hatPullX:0,hatPullY:0,hatClicks:0,hatDrop:null,hairPullX:0,hairPullY:0};
const objects=WITCH_LAYOUT.objects.map(object=>({...object,dragging:false,dropped:false,dropAge:0}));
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const coarsePointer=window.matchMedia('(pointer: coarse)');
const renderBudget=createWitchRenderBudget({width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio});
let handReady=false,handSurface=null,handSurfaces=[],pageSuspended=false,audioMotionReady=false;
const hand=createWitchHand({onStatus:message=>{$('liveStatus').textContent=message;requestPaint();},quality:handQuality()});
let eyeReady=false,eyeSurface=null;
const eye=createWitchEye(document,{onInvalidate:requestPaint,quality:eyeQuality()});
eye.ready.then(ready=>{if(disposed)return;eyeReady=ready;canvas.dataset.eyeReady=String(ready);requestPaint();});
spider.setQuality?.(spiderQuality());
let paintCount=0,lastPaintDuration=0;
function handQuality() {return coarsePointer.matches?{maxWidth:560,frameInterval:50,textureSize:512}:{maxWidth:800,frameInterval:50,textureSize:1024};}
function spiderQuality() {return coarsePointer.matches?{size:160,frameInterval:66}:{size:224,frameInterval:50};}
function eyeQuality() {return {size:coarsePointer.matches?160:224,textureSize:512,frameInterval:50};}
hand.ready.then(ready=>{if(disposed)return;handReady=ready;canvas.dataset.handReady=String(ready);requestPaint();});
audio.onError=error => { audioMotionReady=false;audioOn=false;starting=false;hushPerformance();$('liveStatus').textContent=error.message; };
const sceneCopy = {
  brew: ['She brews her own voice.', 'Stir the pot. Pull her hair back to hush. Touch the moon to fly, mushrooms for a preset, or the SHAPES charm for new settings.', 'Stir for me', 'stirring'],
  fingers: ['An instrument in every finger.', 'Pull her fingertips. Touch the pot to return, the moon to fly, or mushrooms for trouble.', 'Play the hand', 'hand'],
  flight: ['Music for a midnight ride.', 'Pull her hair or the sky noodles to stretch and coil the delay. Click the moon or broom again to land.', 'Take flight', 'flight'],
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
  if(playing)scheduleClock();
  else {clearTimeout(clock);clock=0;}
  if(playing)quietVisual=null;
  else {catMeowAt=-Infinity;if(!audioMotionReady)silentSpeed=0;}
}
function hushPerformance(fadeSeconds=.8) {
  hairHush=null;manualVoiceUntil=0;clearGhostScare();
  setPlaying(false);stopGesture();pendingAccents.length=0;audio.releaseAccents();audio.setPresence(0,fadeSeconds);
  sync();$('gestureReadout').value='The spell rests. Touch the picture to wake her.';
}
function beginHairHush() {
  if(hairHush||!playing||config.scene==='flight')return;
  manualOnly=true;
  hairHush={until:performance.now()+HAIR_HUSH_SECONDS*1000};
  // Keep the generators and their clocks alive while the AudioParam fades.
  // Releasing their gates now would cut the sound off before the long fade.
  audio.setPresence(0,HAIR_HUSH_SECONDS);sync();
  $('gestureReadout').value='The brew slowly settles. Stir for her voice; bend a finger for its spell.';
}
function cue(kind) {
  if(kind==='unicorn-escape'&&!capturedAnimals.cat?.unicorn)return;
  if(kind==='blech-frenzy'&&config.scene!=='flight')return;
  if(starting&&!audio.running) {
    // Only the latest form matters while the worklet is loading.
    if(['shape-charm','blech-frenzy','web-strum'].includes(kind)&&pendingAccents.includes(kind))return;
    pendingAccents.push(kind);
    if(pendingAccents.length>4&&pendingAccents.shift()==='ghost-scream')clearGhostScare();
    return;
  }
  const capture=kind==='unicorn-escape'?capturedAnimals.cat:null;
  const detail=kind==='shape-charm'?{form:getWitchShapeForm(shapeCharm.to).id,startedAt:shapeCharm.startedAt}:
    kind==='blech-frenzy'?{flybyIndex:blechFrenzyIndex}:
    kind==='ghost-scream'?{variant:ghostScare?.variant??0}:
    kind==='web-strum'?webStrumDetail:
    capture?{startedAt:capture.startedAt,direction:capture.from.direction}:undefined;
  const accepted=audio.trigger(kind,detail);
  if(kind==='ghost-scream'&&ghostScare) {
    if(!accepted) {clearGhostScare();return;}
    // A rebuilt worklet has a new clock; stale telemetry belongs to its old node.
    ghostScare.afterAudioTime=ghostScare.audioNode===audio.node?audio.visual.audioTime??-1:-1;
    ghostScare.requestedAt=performance.now();
  }
}
function wakePerformance(part=null) {
  if(manualOnly&&part===null)part='accent';
  const restarting=!playing||Boolean(hairHush);hairHush=null;
  if(restarting)awake.brew=awake.hand=awake.backing=part===null;
  if(part==='brew'||part==='hand')awake[part]=true;
  // Short independent accents need their onset even on the Audio opt-in.
  wakeFadeSeconds=manualControl()||['web','fabric','scare','accent'].includes(part)?.035:.85;
  if(!playing)setPlaying(true);
  send();sync();
  if(audioOn)audio.setPresence(1,wakeFadeSeconds);
  else if(!starting)void startAudio();
}
function wakePart(type,index) {
  if(type==='ghost')return 'scare';
  if(type==='web'||type==='fabric')return type;
  if(['stir','spoon','mouth','nose','hat','brew'].includes(type))return 'brew';
  if(['finger','hand','sleeve'].includes(type))return 'hand';
  if(['tree','cat','animal','eyes','blech-flyby'].includes(type)||manualOnly)return 'accent';
  return null;
}
function gate() { return playing || Boolean(pointer && pointer.type!=='ghost') || keyboardGate || fingerMask()!==0; }
function stirring() { return pointer?.type==='stir' || (keyboardGate && !world.handOpen && !fingerKeys.size && config.scene!=='flight'); }
function manualControl() {return manualOnly&&!hairHush;}
function liveParts() {
  const manual=manualControl();
  return {brew:awake.brew&&(!manual||stirring()||['nose','hat','spoon'].includes(pointer?.type)||performance.now()<manualVoiceUntil),
    hand:awake.hand&&(!manual||fingerMask()!==0),backing:awake.backing&&!manual};
}
function motionSettings() {
  return manualControl()?{stirAuto:false,handAuto:false,spoonAuto:false}:{};
}
function auditionVoice(seconds=.85) {if(manualControl())manualVoiceUntil=performance.now()+seconds*1000;}
function send() { const cat=getWitchCatFrame({ ...config,performanceTime,catFrame:catClock,capturedAnimals }),parts=liveParts(); lastCatCaptured=Boolean(cat.captured);audio.update({ ...config,...motionSettings(),...fabricGesture.audio,catCaptured:lastCatCaptured, mode:config.scene, gate:gate(), brewEnabled:parts.brew, handEnabled:parts.hand, backingEnabled:parts.backing, stirring:stirring(), ghostGate:playing, fingerMask:manualControl()?fingerMask():playing?0:fingerMask(), manualFingerMask:fingerMask(), handFocus:world.handOpen?1:0, spoonAuto:!manualControl()&&config.spoonAuto && pointer?.type!=='spoon', volume:Number($('outputLevel').value) }); }
function sync() {
  requestPaint();
  const [caption,hint] = sceneCopy[config.scene];
  $('sceneLabel').textContent=caption;
  const manualHint=[manualOnly||!config.stirAuto?'Turn the ladle to stir; release to let it rest.':'',manualOnly||!config.handAuto?'Her fingers wait for you to bend them.':''].filter(Boolean).join(' ');
  const wakeHint='Stir for her voice; bend her fingers for their spells; pluck the web on its own. Mushrooms or the SHAPES charm restart the ensemble.';
  $('gestureHint').textContent=hairHush?`The brew is fading slowly. ${wakeHint}`:playing?[hint,manualHint,!awake.brew||!awake.hand?wakeHint:''].filter(Boolean).join(' '):wakeHint;
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
  if(playing&&manualControl()&&held?.type==='stir')auditionVoice(.32);
  if(held?.type==='fabric')releaseWitchFabricGesture(fabricGesture);
  if(held?.type==='trail')releaseWitchTrailGesture(trailGesture);
  if(held?.type==='tree')canvas.style.cursor='grab';
  if(held?.type==='spoon'&&!held.spoonMoved)Object.assign(config,held.spoonSettings);
  if(held?.type==='stir') ladleOffset=held.ladleAngle-(audioMotionReady&&audio.node?audio.visual.phase:silentPhase);
  pointer=null; treeKeyboard=null; keyboardGate=false;
  const captured=[...fingerPointers.keys()]; fingerPointers.clear(); fingerKeys.clear(); arrowKeys.clear();
  for(const id of captured) if(canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  if (held && canvas.hasPointerCapture(held.id)) canvas.releasePointerCapture(held.id);
  send();
}
function setScene(scene) { advancePerformanceTime();spellTransition=null;stopGesture(); config.scene=scene; if(scene!=='flight') {world.handOpen=scene==='fingers';releaseWitchTrailGesture(trailGesture,{cancel:true});} sync(); send(); }
function cycleStirring() {
  spellTransition=null;
  const speeds=[.18,.48,.85],next=speeds.find(speed=>speed>config.speed+.025);
  if(next===undefined)config.direction*=-1;
  config.speed=next??speeds[0];config.stirAuto=true;
  auditionVoice();
  send();sync();
  $('gestureReadout').value=`${['Slow','Medium','Fast'][speeds.indexOf(config.speed)]} ${config.direction>0?'clockwise':'counterclockwise'} stirring.`;
}
function worldAction(action) {
  if(action==='moon'||action==='mushrooms')refillShelf();
  if(action==='hand') {
    if(config.scene==='flight') { stopGesture();world.handOpen=!world.handOpen;sync();send(); }
    else setScene(world.handOpen?'brew':'fingers');
  }
  else if(action==='sleeve') {
    spellTransition=null;
    config.handAuto=true;
    config.handMotion=WITCH_HAND_MOTIONS[(WITCH_HAND_MOTIONS.indexOf(config.handMotion)+1)%WITCH_HAND_MOTIONS.length];
    send();sync();$('gestureReadout').value=`Hand animation: ${config.handMotion.replaceAll('-',' ')}.`;
  }
  else if(action==='moon'||action==='broom') {
    if(config.scene!=='flight') { setScene('flight'); trigger('launch'); }
    else setScene(world.handOpen?'fingers':'brew');
  } else if(action==='mushrooms') {
    const current=Math.max(0,WITCH_PRESETS.findIndex(preset=>preset.id===(presets?.selectedId??presets?.lastPresetId)));
    const next=WITCH_PRESETS[(current+1)%WITCH_PRESETS.length];
    if(presets?.view)presets.view.select(next.id);else applySpell(next.snapshot);
    cue('mushroom-gloop');
    $('gestureReadout').value=next.label;
  } else if(action==='dice') {
    advancePerformanceTime();
    if(presets?.view)presets.view.randomize();else applySpell(randomizeWitchPreset(config));
    const current=WITCH_SHAPE_FORMS.findIndex(form=>form.id===getWitchShapeForm(shapeCharm.to).id);
    shapeCharm=retargetWitchShapeCharm(shapeCharm,(current+1)%WITCH_SHAPE_FORMS.length,performanceTime);
    cue('shape-charm');
    $('gestureReadout').value='A new shape, a whole new spell.';
  } else if(action==='fabric') {
    if(config.scene==='flight') {
      beginWitchFabricGesture(fabricGesture,fabricLocation(getWitchTargets(visualState()).fabric),performance.now());
      releaseWitchFabricGesture(fabricGesture);windFabric();send();
    }
  } else if(action==='mouth') {
    auditionVoice(1.1);spellTransition=null;const current=config.spoonAuto?visualState().activeVoice:config.voice;config.voice=WITCH_VOICES[(WITCH_VOICES.indexOf(current)+1)%WITCH_VOICES.length];config.spoonAuto=false;config.spoonHeight=(WITCH_VOICES.indexOf(config.voice)+.5)/WITCH_VOICES.length;send();sync();
  } else if(action==='eyes') {advancePerformanceTime();eyeShockAt=performanceTime;cue('eye-shock');}
  else if(action==='hat') clickHat();
  else if(action==='spider') dropObject('spider');
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
function intensifyFlyby(slotIndex) {
  if(config.scene!=='flight')return;
  blechFrenzyIndex=slotIndex===1?1:0;
  cue('blech-frenzy');requestPaint();
}
function restoreHat({resetClicks=false}={}) {
  // Preset changes keep an unfinished three-click sequence across spells.
  if(resetClicks||world.hatClicks>=3) {world.hatClicks=0;world.hatDrop=null;}
  world.hatPullX=world.hatPullY=0;
}
function resetCompletedClickCycles() {
  restoreHat();
  // Keep the capture and clock so the unicorn finishes its escape.
  // The next cat visit starts a fresh tally after a completed cycle.
  if(catCaptureCount>=3)catCaptureCount=0;
}
function clickHat() {
  if(world.hatClicks>=3)return;
  advancePerformanceTime();
  const transform=getWitchHat(visualState()).transform;
  world.hatClicks++;
  if(world.hatClicks===3)world.hatDrop={startedAt:performanceTime,transform,
    hat:config.hat,hatPullX:world.hatPullX,hatPullY:world.hatPullY};
  $('gestureReadout').value=world.hatClicks===3?'The hat tumbles into the brew. A new preset brings it back.':world.hatClicks===2?'The hat breaks into burned scraps.':'One tug on the old hat.';
}
function returnObject(object) {
  if(!object || object.dropped) return;
  const home=getWitchLayout({portraitLayout}).objects.find(item=>item.id===object.id);
  Object.assign(object,{x:home.x,y:home.y,dragging:false,dropAge:0});
}
function refillShelf() {
  for(const object of objects) {object.dropped=false;returnObject(object);}
  selectedIngredient=-1;
}
function applySpell(snapshot,{refill=true}={}) {
  manualOnly=false;manualVoiceUntil=0;spellTransition=null;advancePerformanceTime();
  const scene=config.scene;
  stopGesture();releaseWitchFabricGesture(fabricGesture,{cancel:true});releaseWitchTrailGesture(trailGesture,{cancel:true});config=normalizeWitchPreset({...snapshot,scene});
  world.trip=config.trip;resetCompletedClickCycles();world.hairPullX=world.hairPullY=0;
  awake.brew=awake.hand=awake.backing=true;
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
    if(!manualOnly)awake.brew=awake.hand=awake.backing=true;
    resetCompletedClickCycles();world.hairPullX=world.hairPullY=0;
    if(pointer?.type==='trail')stopGesture();
    releaseWitchTrailGesture(trailGesture,{cancel:true});
    const target=normalizeWitchPreset(spell.snapshot);
    target.scene=config.scene;
    spellTransition={from:structuredClone(config),to:target,start:performanceTime+(object.phraseDuration||0),duration:object.flightDuration||1.5,mix:0};
  }
  Object.assign(object,{x:origin.x,y:origin.y,dragging:false,dropped:true,dropAge:0,droppedAt:performanceTime});
  if(id==='spider')spiderAt=performanceTime;
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
  if(!animal||!animal.active||animal.captured||config.scene==='flight'||state.flightLift>.1)return;
  const unicorn=id==='cat'&&++catCaptureCount===3;
  capturedAnimals[id]={startedAt:performanceTime,from:{x:animal.x,y:animal.y,rotation:animal.rotation,direction:animal.direction},...(unicorn?{unicorn:true}:{})};
  if(id==='cat')catMeowAt=performance.now();
  send();cue(`drop-${id}`);if(unicorn)cue('unicorn-escape');
  $('gestureReadout').value=unicorn?'The third cat becomes a sparkling unicorn and escapes!':`${id==='cat'?'Meow! ':''}The ${id} dives into the potion.`;
}
function windFabric() {
  if(config.scene!=='flight')return;
  fabricWindAt=performance.now();cue('fabric-wind');
}
function scareGhost(origin) {
  advancePerformanceTime();
  if(ghostScare||(audio.running&&audio.visual.ghostScreamActive)||config.scene==='flight')return;
  const ghost=origin??getWitchGhostPosition('hiccup',visualState());
  ghostScreamVariant=ghostScreamVariant<0?0:(ghostScreamVariant+1+Math.floor(Math.random()*(WITCH_GHOST_SCREAMS.length-1)))%WITCH_GHOST_SCREAMS.length;
  ghostScare={id:'hiccup',variant:ghostScreamVariant,origin:{x:ghost.x,y:ghost.y},heard:false,audioNode:audio.node,afterAudioTime:-1,requestedAt:null};
  cue('ghost-scream');
}
function clearGhostScare() {
  ghostScare=null;
  for(let index=pendingAccents.length-1;index>=0;index--)if(pendingAccents[index]==='ghost-scream')pendingAccents.splice(index,1);
}
function ghostScareState() {
  if(!ghostScare||!playing||!audioOn)return null;
  // Loading time is not part of the scare. Start the watchdog only when its
  // cue is sent, and still expire it if a stopped/rebuilt clock never replies.
  if(ghostScare.requestedAt===null)return null;
  const timeout=2000+(ghostScare.heard?getWitchGhostScream(ghostScare.variant).duration*1000:0);
  if(performance.now()-ghostScare.requestedAt>timeout) {clearGhostScare();return null;}
  const v=audio.visual;
  if(v.audioTime<=ghostScare.afterAudioTime)return null;
  if(v.ghostScreamActive) {
    ghostScare.heard=true;
    return {id:ghostScare.id,variant:v.ghostScreamVariant??ghostScare.variant,origin:ghostScare.origin,age:v.ghostScreamAge};
  }
  // Wait for the sound's first sample-clock packet, including initial Audio
  // startup. A finished or rejected cue never leaves a face stuck on screen.
  if(ghostScare.heard)clearGhostScare();
  return null;
}
function pluckWeb(index) {
  advancePerformanceTime();webIndex=Math.round(clamp(index,0,6));webAt=performanceTime;cue(`web-${webIndex}`);
}
function strumWeb(e) {
  const samples=e.getCoalescedEvents?.(),events=samples?.length?samples.slice(-8):[e];
  const web=getWitchWeb(),crossings=[],occludedRadius=visualState().spiderCaptured?0:56;
  for(const sample of events) {
    const p=canonical(sample,true,pointer.webWarp);
    if(Math.hypot(p.x-pointer.webPoint.x,p.y-pointer.webPoint.y)<2)continue;
    crossings.push(...witchWebCrossings(web,pointer.webPoint,p,occludedRadius));
    pointer.webPoint=p;
  }
  if(!crossings.length)return;
  const plucks=crossings.length<=8?crossings:Array.from({length:8},(_,i)=>crossings[Math.round(i*(crossings.length-1)/7)]);
  const now=performance.now(),interval=clamp((now-pointer.webTime)/1000/plucks.length,.008,.018);
  pointer.webTime=now;
  webStrumDetail={indices:plucks.map(pluck=>pluck.index),interval};
  advancePerformanceTime();webIndex=plucks.at(-1).index;webAt=performanceTime;cue('web-strum');
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
    if(!hadNode) {advancePerformanceTime();audio.syncPhase(silentPhase,silentSpeed,silentHandTime,undefined,silentFlightPhase,silentGhostPhase,snapshotWitchCatClock(catClock),silentFlybyTime,capturedAnimals);}
    audioMotionReady=true;audioOn=true;send();audio.setAudible(!document.hidden&&!pageSuspended);
    if(hairHush)audio.setPresence(0,Math.max(0,(hairHush.until-performance.now())/1000));
    else audio.setPresence(playing?1:0,playing?wakeFadeSeconds:0);
    if(playing)for(const kind of pendingAccents.splice(0))cue(kind);
    else pendingAccents.length=0;
  } catch(error) {audioOn=false;hushPerformance();$('liveStatus').textContent=`Sound could not start: ${error.message}. Touch Audio to try again.`;}
  finally {if(generation===request&&!disposed){starting=false;sync();}}
}
listen($('audioButton'),'click',()=>{
  if(audioOn) {hushPerformance();audioOn=false;audio.setAudible(false);sync();}
  else wakePerformance();
});
function resetPerformance() {
  const scene=config.scene;
  hushPerformance();manualOnly=false;performanceTime=0;fabricTick=trailTick=0;quietVisual=null;
  releaseWitchFabricGesture(fabricGesture,{cancel:true});releaseWitchTrailGesture(trailGesture,{cancel:true});
  catMeowAt=eyeShockAt=spiderAt=webAt=fabricWindAt=-Infinity;
  shapeCharm={from:0,to:0,startedAt:-Infinity};
  ghostScreamVariant=-1;
  restoreHat({resetClicks:true});world.hairPullX=world.hairPullY=0;spellTransition=null;
  for(const id of Object.keys(capturedAnimals))delete capturedAnimals[id];
  catCaptureCount=0;
  config=normalizeWitchPreset({...WITCH_DEFAULTS,scene});Object.assign(catClock,createWitchCatClock(0,config));
  silentPhase=silentSpeed=ladleOffset=motionTime=silentHandTime=silentFlightPhase=silentGhostPhase=silentFlybyTime=0;
  audio.syncPhase(0,0,0,undefined,0,0,snapshotWitchCatClock(catClock),0);
  event=null;world.trip=0;world.handOpen=scene==='fingers';refillShelf();send();sync();
  $('gestureReadout').value='The pot is listening.';
}
listen($('outputLevel'),'input',()=>{$('outputLevelOut').value=`${Math.round(Number($('outputLevel').value)*100)}%`;send();});
// The owner explicitly makes a real picture gesture the Audio opt-in.
// Pointerup after a hair pull must not immediately wake the spell again.
const wakeFromPicture=e=>{
  if(!e.isTrusted||(e.type==='pointerdown'&&e.button!==0))return;
  if(e.type==='click'&&e.detail!==0)return;
  const p=e.target===canvas?canonical(e):null;
  const hit=p?hitTestWitch(p.x,p.y,visualState()):null;
  wakePerformance(wakePart(hit?.type,hit?.index));
};
listen($('witchViewport'),'pointerdown',wakeFromPicture,{capture:true});
listen($('witchViewport'),'click',wakeFromPicture,{capture:true});
function canonical(e, logical=false, warpState) {
  const rect=canvas.getBoundingClientRect(),view=getWitchViewport(rect.width,rect.height,{portraitLayout});
  const p={x:(e.clientX-rect.left-view.x)/view.scale,y:(e.clientY-rect.top-view.y)/view.scale};
  return logical?warpWitchPoint(p,warpState??visualState(),true):p;
}
function fabricLocation(point) {
  const layout=getWitchLayout({portraitLayout});
  return {x:(point.x-layout.left)*1000/layout.width,y:(point.y-layout.top)*720/layout.height};
}
function stirLocation(point) {
  const pot=WITCH_LAYOUT.cauldron;
  const x=(point.x-pot.x)/pot.rx, y=(point.y-pot.y)/pot.ry;
  return { angle:Math.atan2(y,x),radius:clamp(Math.hypot(x,y),.08,1) };
}
function visualState() {
  const v=audioMotionReady&&audio.node ? (playing?audio.visual:quietVisual) : null;
  const phase=v?.phase??silentPhase, speed=v?.speed??silentSpeed;
  const mask=playing&&awake.hand&&!manualControl()?31:fingerMask();
  const handTime=v?.handTime??silentHandTime;
  const spoonHeight=v?.spoonHeight??(!manualControl()&&config.spoonAuto && pointer?.type!=='spoon'?witchSpoonHeight(handTime):config.spoonHeight);
  const activeVoice=v?.activeVoice??(!manualControl()&&config.spoonAuto?witchVoiceAtHeight(spoonHeight):config.voice);
  const fingerLevels=audioOn&&v?.fingerLevels?v.fingerLevels:Array.from({length:5},(_,i)=>mask&(1<<i)?1:0);
  const ghostPhase=liveParts().backing?(v?.ghostPhase??silentGhostPhase):silentGhostPhase;
  ghostFrames.forEach((out,i)=>witchGhostFrame(ghostPhase,i,out));
  return { ...config, portraitLayout, ...motionSettings(), ...world, ...fabricGesture.visual, ...fabricGesture.audio, fabricHeld:fabricGesture.held, trailStrands:trailGesture.active?trailGesture.strands:undefined, playing, performanceTime, capturedAnimals,flybyTime:v?.flybyTime??silentFlybyTime,renderScale:renderBudget.scale,onInvalidate:requestPaint,
    ghostScare:ghostScareState(),ghostScareHidden:Boolean(ghostScare),shapeCharm,eyeSurface,
    treeEnvelope:playing?(v?.treeEnvelope??0):0,treeProgress:v?.treeProgress??0,treeSoundShape:v?.treeShape??config.treeShape,
    flybyFrenzy:playing?(v?.flybyFrenzy??0):0,flybyFrenzyIndex:v?.flybyFrenzyIndex??blechFrenzyIndex,
    paletteFrom:spellTransition?.from.palette??config.palette,paletteTo:spellTransition?.to.palette??config.palette,paletteMix:spellTransition?.mix??1,
    eyeShock:audioOn?(v?.shockEnvelope??0):witchAccentEnvelope(performanceTime-eyeShockAt),spiderPulse:witchAccentEnvelope(performanceTime-spiderAt),webPulse:witchAccentEnvelope(performanceTime-webAt,1.3),webIndex,
    spiderCaptured:Boolean(objects.find(object=>object.id==='spider')?.dropped),spiderSurface, catFrame:catClock, catMeow:audioOn?(v?.catMeow??0):(playing?witchCatMeowEnvelope((performance.now()-catMeowAt)/1000):0), handPalms:handReady?[hand.getPalm(0),hand.getPalm(1)]:[], ghostPhase, ghostPresence:ghostFrames.map(frame=>frame.presence), ghostPulses:ghostFrames.map(frame=>playing?frame.pulse:0), flightPhase:v?.flightPhase??silentFlightPhase, objects, selectedIngredient:objects[selectedIngredient]?.id??null, spoonHeight, activeVoice, voice:activeVoice, gate:gate(), manualFingerMask:fingerMask(), reducedMotion:reducedMotion.matches, handTime, handSurface, handSurfaces, handsTips:handReady?[hand.getTips(0),hand.getTips(1)]:[], handWrists:handReady?[hand.getWrist(0),hand.getWrist(1)]:[], handTips:handReady?hand.getTips():[],handWrist:handReady?hand.getWrist():null,pickHand:handReady?hand.pick:null,warpTime:reducedMotion.matches?0:performanceTime,time:performanceTime, motionTime, phase, speed, energy:audioOn?(v?.energy??speed):speed, launchEnvelope:audioOn?(v?.launchEnvelope??0):(event?.kind==='launch'&&event.age<1.86?1:0), mouth:audioOn?(v?.mouth??0):(speed*(.35+.65*Math.abs(Math.sin(phase*3)))*(world.handOpen?.55:1)), fingerLevels, flightPulse:audioOn?(v?.flightPulse??0):speed*Math.max(0,Math.sin(phase*2)), direction:config.direction, event:event??(v?.effect ? {kind:v.effect,age:1-(v.effectEnvelope??0)} : null), selectedFinger, ladleAngle:pointer?.type==='stir'?pointer.ladleAngle:phase+ladleOffset, hitRadius:Math.max(46,24/Math.max(.1,getWitchViewport(width,height,{portraitLayout}).scale)) };
}
listen(canvas,'pointerdown',e => {
  canvas.dataset.pointerFocus='true';
  if(pointer || e.button!==0) return;
  const initial=visualState(),raw=canonical(e),hit=hitTestWitch(raw.x,raw.y,initial),p=canonical(e,true,initial);
  if(!hit) return;
  canvas.focus({preventScroll:true});
  if(hit.type!=='object'&&hit.type!=='blech-flyby')spellTransition=null;
  if(hit.type==='blech-flyby') {intensifyFlyby(hit.index);e.preventDefault();return;}
  if(['hand','sleeve','moon','broom','mushrooms','dice','mouth','eyes','spider'].includes(hit.type)) { worldAction(hit.type);e.preventDefault(); return; }
  if(hit.type==='tree') {
    // Keep the pickup coordinates fixed while branches and scene effects move.
    pointer={id:e.pointerId,type:'tree',start:p,moved:false,treeSpread:config.treeSpread,treeCurl:config.treeCurl,
      // A small trunk dead zone prevents touch rounding from reversing a pull.
      side:p.x<getWitchTree(initial).root.x-4?-1:1,
      hairWarp:{portraitLayout:initial.portraitLayout,trip:initial.trip,visualMode:initial.visualMode,eyeShock:initial.eyeShock,reducedMotion:initial.reducedMotion,warpTime:initial.warpTime}};
    canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';
    send();cue('tree-l-system');e.preventDefault();return;
  }
  if(hit.type==='cat'||hit.type==='animal'){captureAnimal(hit.type==='cat'?'cat':hit.id);e.preventDefault();return;}
  if(hit.type==='web'){
    pluckWeb(hit.index??0);
    pointer={id:e.pointerId,type:'web',webPoint:p,webTime:performance.now(),
      webWarp:{portraitLayout:initial.portraitLayout,trip:initial.trip,visualMode:initial.visualMode,eyeShock:initial.eyeShock,reducedMotion:initial.reducedMotion,warpTime:initial.warpTime}};
    canvas.setPointerCapture(e.pointerId);e.preventDefault();return;
  }
  if(['bat','spark','gust'].includes(hit.type)) { trigger(hit.type); return; }
  if(hit.type==='ghost') {
    pointer={id:e.pointerId,type:'ghost',index:hit.index,start:p,ghostTempo:config.ghostTempo,moved:false,origin:getWitchGhostPosition(hit.index,initial)};
    canvas.setPointerCapture(e.pointerId);e.preventDefault();return;
  }
  if(hit.type==='object') {dropObject(hit.id);e.preventDefault();return;}
  if(hit.type==='stir' && config.scene==='fingers') setScene('brew');
  if(hit.type==='finger') {
    const tip=initial.handTips?.[hit.index],palm=initial.handPalms?.[0];
    const dx=tip&&palm?tip.x-palm.x:-.8,dy=tip&&palm?tip.y-palm.y:-.6,length=Math.hypot(dx,dy)||1;
    selectedFinger=hit.index; fingerPointers.set(e.pointerId,{index:hit.index,start:p,transform:handTransform(initial),value:config.fingers[hit.index],outward:{x:dx/length,y:dy/length}});
    canvas.setPointerCapture(e.pointerId); send(); sync(); e.preventDefault(); return;
  }
  keyboardGate=false;
  const visual=visualState(), start=stirLocation(p), pot=WITCH_LAYOUT.cauldron;
  const hair=hit.type==='hair'?getWitchHair(initial):null;
  const hat=hit.type==='hat'?getWitchHat(initial):null;
  const onHandle=((p.x-pot.x)/pot.rx)**2+((p.y-pot.y)/pot.ry)**2>1;
  pointer={id:e.pointerId,type:hit.type,index:hit.index??0,start:p,value:config.fingers[hit.index??0],time:performance.now(),spoonHeight:visual.spoonHeight,nose:config.nose,hat:config.hat,hatTransform:hat?.transform,hatPullX:world.hatPullX,hatPullY:world.hatPullY,hair:config.hair,hairTransform:hair?.transform,hairPullX:world.hairPullX,hairPullY:world.hairPullY,hairAxis:hair?.axis,hairDistance:hair?.pullDistance,hairWarp:(hair||hat||hit.type==='fabric'||hit.type==='trail')?{portraitLayout:initial.portraitLayout,trip:initial.trip,visualMode:initial.visualMode,eyeShock:initial.eyeShock,reducedMotion:initial.reducedMotion,warpTime:initial.warpTime}:null,fabricX:config.fabricX,fabricY:config.fabricY,trailPull:config.trailPull,trailTwist:config.trailTwist,trailFeedback:config.trailFeedback,trailSpace:config.trailSpace,trailAnchor:hit.type==='trail'?getWitchHair(initial).tip:null,trailAngle:null,trailWinding:0,...start,ladleAngle:onHandle?visual.ladleAngle:start.angle,radiusOffset:onHandle?config.radius-start.radius:0};
  canvas.setPointerCapture(e.pointerId);
  if(hit.type==='spoon') {
    pointer.spoonSettings={voice:config.voice,spoonHeight:config.spoonHeight};pointer.spoonMoved=false;
    setSpoonHeight(visual.spoonHeight);
  }
  if(hit.type==='trail') {
    const rest=getWitchRestTrails(initial);beginWitchTrailGesture(trailGesture,rest,p,performance.now());
    pointer.trailAnchor=rest.find(strand=>strand.index===trailGesture.grab?.index)?.points.at(-1)??pointer.trailAnchor;
    trailTick=performanceTime;
  }
  if(hit.type==='fabric') {const fabricPoint=fabricLocation(p);beginWitchFabricGesture(fabricGesture,fabricPoint,performance.now());config.fabricX=clamp(fabricPoint.x/1000);config.fabricY=clamp(1-fabricPoint.y/720);windFabric();}
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
    // Capture the thumb's direction away from the palm: pulling it outward
    // opens it, even with the hand turned sideways or flying.
    const bend=held.index===0?-(localX*held.outward.x+localY*held.outward.y)/170:localY/220+localX/600;
    config.fingers[held.index]=clamp(held.value+bend);
    send(); sync(); e.preventDefault(); return;
  }
  if(!pointer || pointer.id!==e.pointerId) {
    const p=canonical(e),hit=hitTestWitch(p.x,p.y,visualState());
    canvas.style.cursor=hit?'grab':'default';
    canvas.dataset.hoverTarget=hit?.type??'';
    return;
  }
  if(pointer.type==='web'){strumWeb(e);e.preventDefault();return;}
  const p=canonical(e,true,['hair','hat','fabric','trail','tree'].includes(pointer.type)?pointer.hairWarp:undefined), now=performance.now();
  if(pointer.type==='tree') {
    const dx=p.x-pointer.start.x,dy=p.y-pointer.start.y;
    if(!pointer.moved&&Math.hypot(dx,dy)<5){e.preventDefault();return;}
    pointer.moved=true;
    config.treeSpread=clamp(pointer.treeSpread+dx*pointer.side/180);
    config.treeCurl=clamp(pointer.treeCurl-dy/180);
    // Bend the current one-shot voice; holding a branch never retriggers it.
  }
  else if(pointer.type==='fabric') {
    const fabricPoint=fabricLocation(p);
    moveWitchFabricGesture(fabricGesture,fabricPoint,now);
    config.fabricX=clamp(fabricPoint.x/1000);config.fabricY=clamp(1-fabricPoint.y/720);
    if(now-fabricWindAt>100)windFabric();
  }
  else if(pointer.type==='trail') {
    moveWitchTrailGesture(trailGesture,p,now);
    const dx=p.x-pointer.start.x,dy=p.y-pointer.start.y;
    config.trailPull=clamp(pointer.trailPull+dx/300);config.trailTwist=clamp(pointer.trailTwist-dy/300);
    if(Math.hypot(dx,dy)>18) {
      const angle=Math.atan2(dy,dx);
      if(pointer.trailAngle!==null)pointer.trailWinding+=Math.atan2(Math.sin(angle-pointer.trailAngle),Math.cos(angle-pointer.trailAngle));
      pointer.trailAngle=angle;
    }
    config.trailFeedback=clamp(pointer.trailFeedback+pointer.trailWinding/(TAU*2));
    const a=pointer.trailAnchor;
    config.trailSpace=witchTrailSpaceAtPoint(p,a);
  }
  else if(pointer.type==='ghost') {
    if(Math.hypot(p.x-pointer.start.x,p.y-pointer.start.y)>7)pointer.moved=true;
    if(pointer.moved)config.ghostTempo=clamp(pointer.ghostTempo+pointer.start.y-p.y,36,180);
  }
  else if(pointer.type==='spoon') {
    if(Math.hypot(p.x-pointer.start.x,p.y-pointer.start.y)>7)pointer.spoonMoved=true;
    if(pointer.spoonMoved)setSpoonHeight(pointer.spoonHeight+(pointer.start.y-p.y)/180);
  }
  else if(pointer.type==='hair') {
    // The captured direction and warp keep moving broom/mushroom animation
    // from tugging the control underneath a stationary pointer.
    const dx=p.x-pointer.start.x,dy=p.y-pointer.start.y;
    const pull=(dx*pointer.hairAxis.x+dy*pointer.hairAxis.y)/Math.max(1,pointer.hairDistance);
    const transform=pointer.hairTransform,cos=Math.cos(transform.rotation),sin=Math.sin(transform.rotation);
    const x=(cos*dx+sin*dy)/transform.scale,y=(-sin*dx+cos*dy)/transform.scale;
    world.hairPullX=clamp(pointer.hairPullX+x,-300,300);world.hairPullY=clamp(pointer.hairPullY+y,-240,240);
    config.hair=clamp(pointer.hair+pull);
    if(config.scene==='flight') {
      if(Math.hypot(x,y)>18) {
        const angle=Math.atan2(y,x);
        if(pointer.trailAngle!==null)pointer.trailWinding+=Math.atan2(Math.sin(angle-pointer.trailAngle),Math.cos(angle-pointer.trailAngle));
        pointer.trailAngle=angle;
      }
      Object.assign(config,witchHairDelayControls(pointer,{x,y},pointer.trailWinding));
    } else if(pull>.62&&!pointer.hushed) {pointer.hushed=true;beginHairHush();}
  }
  else if(pointer.type==='hat') {
    const t=pointer.hatTransform,dx=p.x-pointer.start.x,dy=p.y-pointer.start.y;
    if(Math.hypot(dx,dy)>7)pointer.hatMoved=true;
    const x=(Math.cos(t.rotation)*dx+Math.sin(t.rotation)*dy)/t.scale,y=(-Math.sin(t.rotation)*dx+Math.cos(t.rotation)*dy)/t.scale;
    world.hatPullX=clamp(pointer.hatPullX+x,-185,185);world.hatPullY=clamp(pointer.hatPullY+y,-145,125);
    config.hat=clamp(pointer.hat+(Math.abs(x)*.7-y)/180);
  } else if(pointer.type==='nose') {config.nose=clamp(pointer.nose+(p.x-pointer.start.x)/150);}
  else if(pointer.type==='stir') {
    const current=stirLocation(p); let delta=current.angle-pointer.angle;
    if(delta>Math.PI) delta-=TAU; if(delta< -Math.PI) delta+=TAU;
    const dt=Math.max(.012,(now-pointer.time)/1000);
    if(Math.abs(delta)>.003) config.direction=delta<0?-1:1;
    config.speed=clamp(config.speed*.35+Math.abs(delta)/dt/12*.65,config.stirAuto?.02:0,1);
    config.radius=clamp(current.radius+pointer.radiusOffset,.08,1); pointer.ladleAngle+=delta; pointer.angle=current.angle; pointer.time=now;
  } else if(pointer.type==='finger') { config.fingers[pointer.index]=clamp(pointer.value+(pointer.index===0?-1:1)*(p.y-pointer.start.y)/220+(p.x-pointer.start.x)/600); }
  else if(pointer.type==='flight') { config.flightX=clamp(p.x/1000,.12,.88); config.altitude=clamp(1-p.y/720); config.speed=clamp(.15+Math.abs(p.x-pointer.start.x)/450,.02,1); }
  send(); sync(); e.preventDefault();
});
function releasePointer(e) {
  if(pointer?.id===e.pointerId&&pointer.type==='spoon'&&e.type==='pointerup'&&!pointer.spoonMoved)cycleStirring();
  if(pointer?.id===e.pointerId&&pointer.type==='hat'&&e.type==='pointerup'&&!pointer.hatMoved)clickHat();
  if(pointer?.id===e.pointerId && pointer.type==='fabric' && e.type!=='pointerup')releaseWitchFabricGesture(fabricGesture,{cancel:true});
  if(pointer?.id===e.pointerId && pointer.type==='trail' && e.type!=='pointerup')releaseWitchTrailGesture(trailGesture,{cancel:true});
  if(pointer?.id===e.pointerId && pointer.type==='ghost') {
    if(e.type==='pointerup'&&!pointer.moved)scareGhost(pointer.origin);
    pointer=null;
    if(canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    send();sync();return;
  }
  if(fingerPointers.delete(e.pointerId)) { if(canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); send(); sync(); }
  if(pointer?.id===e.pointerId) { stopGesture(); sync(); }
}
listen(canvas,'pointerup',releasePointer); listen(canvas,'pointercancel',releasePointer); listen(canvas,'lostpointercapture',releasePointer);
listen(canvas,'keydown',e => {
  delete canvas.dataset.pointerFocus;
  if(e.altKey || e.ctrlKey || e.metaKey) return;
  if(e.key==='Escape') {hushPerformance();e.preventDefault();return;}
  if(e.key==='Backspace') {if(!e.repeat)resetPerformance();e.preventDefault();return;}
  if(e.key===' '||e.code==='Space') {if(!e.repeat){if(playing)hushPerformance();else wakePerformance();}e.preventDefault();return;}
  if(e.key.toLowerCase()==='f'&&config.scene!=='flight') {e.preventDefault();return;}
  if(e.key.toLowerCase()==='i') {
    const layout=getWitchLayout({portraitLayout});
    const flyby=config.scene==='flight'?getWitchBlechFlyby(visualState().flybyTime,layout).find(visitor=>visitor.x>layout.left&&visitor.x<layout.left+layout.width&&visitor.opacity>.1):null;
    if(!e.repeat&&flyby) {wakePerformance('accent');intensifyFlyby(flyby.slotIndex);}
    e.preventDefault();return;
  }
  if(e.key.toLowerCase()==='j') {
    if(!e.repeat&&config.scene!=='flight') {wakePerformance('scare');scareGhost();}
    e.preventDefault();return;
  }
  if(e.isTrusted&&(/^[1-5]$/.test(e.key)||['[',']','Enter','-','_','+','=','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)||/^[aqerhmbwdfvxtsgpcnlko]$/i.test(e.key))) {
    const part=/^[tcnlx]$/i.test(e.key)||treeKeyboard&&e.key.startsWith('Arrow')?'accent':e.key.toLowerCase()==='p'?'web':e.key.toLowerCase()==='f'?'fabric':/^[1-5ah]$/i.test(e.key)?'hand':/^[bvko]$/i.test(e.key)?'brew':e.key.startsWith('Arrow')&&!treeKeyboard?(world.handOpen||fingerKeys.size?'hand':config.scene!=='flight'?'brew':null):null;
    wakePerformance(part);
  }
  if(/^[1-5]$/.test(e.key)) { selectedFinger=Number(e.key)-1; fingerKeys.add(selectedFinger); $('gestureReadout').value=instrumentLabels[selectedFinger]; send(); e.preventDefault(); return; }
  if(e.key==='[' || e.key===']') {
    selectedIngredient=selectedIngredient<0?(e.key===']'?0:objects.length-1):(selectedIngredient+(e.key===']'?1:-1)+objects.length)%objects.length;
    $('gestureReadout').value=`${objects[selectedIngredient].name}. Press Enter to drop into the potion.`;
    e.preventDefault();return;
  }
  if(e.key==='Enter') { if(!e.repeat)dropObject(objects[Math.max(0,selectedIngredient)].id);e.preventDefault();return; }
  if(e.key.toLowerCase()==='o') {if(!e.repeat)cycleStirring();e.preventDefault();return;}
  if(['-','_','+','='].includes(e.key)) { config.tone=clamp(config.tone+(['+','='].includes(e.key)?.05:-.05));send();sync();e.preventDefault();return; }
  const objectId={q:'gesticules',e:'marimba',r:'chiptune'}[e.key.toLowerCase()];
  if(objectId){if(!e.repeat)dropObject(objectId);e.preventDefault();return;}
  if(e.key.toLowerCase()==='t') {
    if(!e.repeat){spellTransition=null;treeKeyboard={};cue('tree-l-system');}
    e.preventDefault();return;
  }
  if(treeKeyboard&&e.key.startsWith('Arrow')) {
    spellTransition=null;
    if(e.key==='ArrowLeft'||e.key==='ArrowRight')config.treeSpread=clamp(config.treeSpread+(e.key==='ArrowRight'?.05:-.05));
    else config.treeCurl=clamp(config.treeCurl+(e.key==='ArrowUp'?.05:-.05));
    send();sync();e.preventDefault();return;
  }
  const action={k:'hat',a:'sleeve',h:'hand',m:'moon',b:'brew',w:'mushrooms',d:'dice',f:'fabric',v:'mouth',x:'eyes',s:'spider'}[e.key.toLowerCase()];
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
  if(e.key.toLowerCase()==='t'&&treeKeyboard) {
    treeKeyboard=null;
    e.preventDefault();return;
  }
  if(/^[1-5]$/.test(e.key)) { fingerKeys.delete(Number(e.key)-1); send(); }
  if(e.key.startsWith('Arrow')) { arrowKeys.delete(e.key); keyboardGate=arrowKeys.size>0; send(); }
});
listen(canvas,'blur',() => { delete canvas.dataset.pointerFocus;stopGesture(); });
listen(window,'blur',() => { stopGesture(); });
listen(window,'morphazoid:midi-input',e => { if(['noteOn','noteOff','pitchBend'].includes(e.detail?.message?.type)) e.preventDefault(); });
function resize() {
  const portrait=window.innerWidth<window.innerHeight;
  if(portrait!==portraitLayout)stopGesture();
  portraitLayout=portrait;
  const rect=canvas.getBoundingClientRect(); width=rect.width; height=rect.height;
  const dpr=Math.min(1.5,window.devicePixelRatio||1);
  const nextWidth=Math.round(width*dpr),nextHeight=Math.round(height*dpr);
  if(canvas.width!==nextWidth||canvas.height!==nextHeight) {
    canvas.width=nextWidth;canvas.height=nextHeight;ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  const layout=getWitchLayout({portraitLayout});
  resizeWitchRenderBudget(renderBudget,{width,height,pixelRatio:dpr,worldWidth:layout.width,worldHeight:layout.height});
  requestPaint();
}
const observer=new ResizeObserver(resize); observer.observe($('witchViewport'));
function requestPaint() {
  paintDirty=true;
  if(!frame&&!disposed&&!document.hidden&&!pageSuspended)frame=requestAnimationFrame(draw);
}
function resumeDrawing() {
  cancelAnimationFrame(frame);frame=0;lastPaint=0;last=performance.now();lastPerformanceTick=last;
  requestPaint();scheduleClock();
}
listen(coarsePointer,'change',()=>{hand.setQuality(handQuality());spider.setQuality(spiderQuality());eye.setQuality(eyeQuality());resize();});
function draw(now) {
  frame=0;
  if(disposed || document.hidden || pageSuspended || (!playing&&!paintDirty)) return;
  // A little tolerance avoids accidentally painting at 20fps on a 60Hz display.
  // Raster pressure can lower graphics detail, never the musical sample clock.
  if(playing&&now-lastPaint<renderBudget.frameInterval-1.5) {frame=requestAnimationFrame(draw);return;}
  lastPaint=now;paintDirty=false;
  const paintStarted=performance.now();
  const dt=playing?Math.min(.06,(now-last)/1000):0;last=now;advancePerformanceTime(now);
  const parts=liveParts(),stirActive=gate() && parts.brew && (!manualControl()&&config.stirAuto || stirring());
  silentSpeed+=(stirActive?config.speed-silentSpeed:-silentSpeed)*(1-Math.exp(-dt/(stirActive?.08:1.3)));
  silentPhase=(silentPhase+config.direction*silentSpeed*dt*12+TAU)%TAU;
  motionTime+=dt*(audioMotionReady&&audio.node?audio.visual.speed:silentSpeed);
  if(audioMotionReady&&audio.node&&playing) {
    silentHandTime=audio.visual.handTime??silentHandTime;
    silentFlightPhase=audio.visual.flightPhase??silentFlightPhase;
    if(parts.backing)silentGhostPhase=audio.visual.ghostPhase??silentGhostPhase;
  } else if(gate()) {
    if(parts.hand)silentHandTime+=dt;
    silentFlightPhase+=dt*(1+config.flightSpeed*5)/1.4;
  }
  if(!(audioMotionReady&&audio.node) && playing&&parts.backing) silentGhostPhase+=dt*config.ghostTempo/60;
  if(event) { event.age+=dt; if(event.age>3.5) event=null; }
  if(pointer?.type!=='hair') {
    const relax=Math.exp(-dt/1.15);
    world.hairPullX*=relax;world.hairPullY*=relax;
    if(Math.abs(world.hairPullX)<.01)world.hairPullX=0;if(Math.abs(world.hairPullY)<.01)world.hairPullY=0;
  }
  if(pointer?.type!=='hat') {
    const relax=reducedMotion.matches?0:Math.exp(-dt/.42);
    world.hatPullX*=relax;world.hatPullY*=relax;
    if(Math.abs(world.hatPullX)<.01)world.hatPullX=0;if(Math.abs(world.hatPullY)<.01)world.hatPullY=0;
  }
  const ease=reducedMotion.matches?1:1-Math.exp(-dt/ .18);
  for(const [key,target] of [['flightLift',config.scene==='flight'?1:0]]) { world[key]+=(target-world[key])*ease;if(Math.abs(target-world[key])<.001)world[key]=target; }
  for(const object of objects)if(object.dropped)object.dropAge=Math.min(10,Math.max(0,performanceTime-(object.droppedAt??performanceTime)));
  const state=visualState();
  if(eyeReady) {eyeSurface=eye.render(state);state.eyeSurface=eyeSurface;}
  if(spiderReady&&world.flightLift<.99) {
    spiderSurface=spider.render(state.spiderPulse,state.time);
    state.spiderSurface=spiderSurface;
  }
  if(handReady) {
    handSurfaces=hand.renderPair(state); handSurface=handSurfaces[0];
    state.handSurface=handSurface;state.handSurfaces=handSurfaces;
    state.handPalms=[hand.getPalm(0),hand.getPalm(1)];
    state.handsTips=[hand.getTips(0),hand.getTips(1)];state.handWrists=[hand.getWrist(0),hand.getWrist(1)];
    state.handTips=state.handsTips[0];state.handWrist=state.handWrists[0];
  }
  renderWitch(ctx,width,height,state);
  lastPaintDuration=performance.now()-paintStarted;paintCount++;
  if(playing)sampleWitchRenderBudget(renderBudget,lastPaintDuration,now);
  if(playing||paintDirty)frame=requestAnimationFrame(draw);
}
let readoutTick=0;
function scheduleClock() {
  if(!clock&&playing&&!disposed&&!document.hidden&&!pageSuspended)clock=setTimeout(tick,40);
}
function tick() {
  clock=0;
  if(disposed||document.hidden||pageSuspended||!playing)return;
  if(hairHush&&performance.now()>=hairHush.until) {hushPerformance(0);return;}
  try {
    advancePerformanceTime();advanceSpell();
    if(manualVoiceUntil&&performance.now()>=manualVoiceUntil){manualVoiceUntil=0;send();}
    const fabricActive=fabricGesture.held||fabricGesture.audio.fabricPull>0||fabricGesture.audio.fabricVelocity>0;
    advanceWitchFabricGesture(fabricGesture,playing?Math.max(0,Math.min(.08,performanceTime-fabricTick)):0);fabricTick=performanceTime;
    if(fabricActive)send();
    if(trailGesture.active&&playing)advanceWitchTrailGesture(trailGesture,getWitchRestTrails(visualState()),Math.max(0,Math.min(.08,performanceTime-trailTick)));
    trailTick=performanceTime;
    if(Boolean(getWitchCatFrame({...config,performanceTime,catFrame:catClock,capturedAnimals}).captured)!==lastCatCaptured)send();
    // A held but motionless ladle loses energy; event timing never depends on drawing.
    if(pointer?.type==='stir' && performance.now()-pointer.time>120) { config.speed=Math.max(config.stirAuto?.02:0,config.speed*.8); send(); }
    if(playing&&++readoutTick%5===0) {
      const v=visualState();
      if(event)return;
      if(selectedIngredient>=0) { $('gestureReadout').value=`${objects[selectedIngredient].name}. Press Enter to drop into the potion.`;return; }
      $('gestureReadout').value=config.scene==='fingers'?(gate()?'Bend a finger to bend its sound.':'Her fingertips are listening.')
        :config.scene==='flight'?(v.speed>.025?`${Math.round(v.speed*100)}% flight · ${Math.round(config.altitude*100)}% height`:'The broom is waiting.')
          :v.speed>.025?`${config.direction<0?'Backward':'Forward'} · ${Math.round(v.speed*100)}% motion · ${Math.round(config.radius*100)}% open`:'The pot is listening.';
    }
  } finally {scheduleClock();}
}
listen(document,'visibilitychange',() => {
  if(document.hidden) { clearGhostScare();stopGesture(); audio.setAudible(false); cancelAnimationFrame(frame);frame=0;clearTimeout(clock);clock=0; }
  else { audio.setAudible(audioOn&&!pageSuspended);resumeDrawing(); }
});
listen(window,'pageshow',e => {
  if(!e.persisted || disposed) return;
  pageSuspended=false;audio.setAudible(audioOn&&!document.hidden);resumeDrawing();
});
listen(window,'pagehide',e => {
  clearGhostScare();
  if(e.persisted) { pageSuspended=true;stopGesture(); audio.setAudible(false); cancelAnimationFrame(frame);frame=0;clearTimeout(clock);clock=0; return; }
  if(disposed) return; disposed=true; ++request; clearTimeout(clock); cancelAnimationFrame(frame); observer.disconnect(); abort.abort(); presets?.destroy(); hand.dispose();spider.dispose();eye.dispose();disposeWitchRenderer(ctx);audio.dispose();delete window.witchInstrument;
});
// Keep shared preset transactions for the picture without mounting a menu.
presets=registerHeaderPresets({id:'witch',host:document.createElement('div'),presets:WITCH_SETTING_PRESETS,capture:()=>witchPresetSettings(config),apply:snapshot=>applySpell(snapshot),randomize:(previous,random)=>witchPresetSettings(randomizeWitchPreset(previous,random))});
Object.defineProperty(window,'witchInstrument',{configurable:true,value:Object.freeze({get state() {
  const state=visualState(),catTargets=getWitchCatTargets(state),hair=getWitchHair(state);
  const {form,id,dimension,progress,morphing}=getWitchShapeFrame(state);
  return {portraitLayout,viewport:getWitchViewport(width,height,state),shelves:getWitchLayout(state).shelves,visualTime:state.time,warpTime:state.warpTime,presenceLevel:audio.presenceNode?.gain.value??audio.presence,treeEnvelope:audio.visual.treeEnvelope??0,treeProgress:audio.visual.treeProgress??0,treeSoundShape:state.treeSoundShape,treeOnsets:audio.visual.treeOnsets??0,treeBranchCount:audio.visual.treeBranchCount??0,treePlayheads:getWitchTreePulse(state),treeLevel:audio.visual.treeLevel??0,flybyTime:state.flybyTime,flybys:getWitchBlechFlyby(state.flybyTime,getWitchLayout(state)).map(visitor=>({...visitor,...warpWitchPoint(visitor,state)})),flybyLevel:audio.visual.flybyLevel??0,flybyFrenzy:state.flybyFrenzy,flybyFrenzyIndex:state.flybyFrenzyIndex,tree:getWitchTree(state),web:getWitchWeb(state),spellArm:getWitchSpellArm(state),eyeShock:state.eyeShock,spiderPulse:state.spiderPulse,webPulse:state.webPulse,spiderReady,spiderCaptured:state.spiderCaptured,fabricGesture:structuredClone({held:fabricGesture.held,visual:fabricGesture.visual,audio:fabricGesture.audio}),trailGesture:structuredClone({held:trailGesture.held,active:trailGesture.active,grab:trailGesture.grab,point:trailGesture.point,strands:trailGesture.active?getWitchTrails(state).map(({index,points})=>({index,points})):[]}),spellTransition:spellTransition?{progress:spellTransition.mix,startsAt:spellTransition.start}:null,capturedAnimals:structuredClone(capturedAnimals),visitors:getWitchVisitors(state),visitorTargets:Object.fromEntries(Object.entries(getWitchVisitorTargets(state)).map(([id,targets])=>[id,Object.fromEntries(Object.entries(targets).map(([part,p])=>[part,{...p,...warpWitchPoint(p,state)}]))])),catMeow:state.catMeow,catTargets:catTargets?Object.fromEntries(Object.entries(catTargets).map(([key,value])=>[key,warpWitchPoint(value,state)])):null,config:structuredClone(config),presetId:presets?.selectedId??presets?.lastPresetId??WITCH_PRESETS[0].id,playing,audioOn,starting,hushing:Boolean(hairHush),parts:{brew:playing&&awake.brew,hand:playing&&awake.hand},backingAwake:playing&&awake.backing,quiet:!playing,presence:audio.presence,world:{...world},handReady,manualOnly,activeParts:liveParts(),performanceTime,cat:getWitchCatFrame(state),
    fingerTips:getFingerTips(state).map(p=>warpWitchPoint(p,state)),handWrist:state.handWrist,
    hands:[0,1].map(i=>({tips:getFingerTips(state,i).map(p=>warpWitchPoint(p,state)),wrist:warpWitchPoint(handTransform(state,i).wrist,state),palm:handReady?warpWitchPoint(transformHandPoint(state.handPalms[i],state,i),state):null,rotation:handTransform(state,i).rotation,scale:handTransform(state,i).scale})),handTime:state.handTime,flightPhase:state.flightPhase,manualFingerMask:state.manualFingerMask,spoonHeight:state.spoonHeight,activeVoice:state.activeVoice,
    ghostScare:getWitchGhostScare(state),ghostScareHidden:state.ghostScareHidden,catCaptureCount,
    shapeCharm:{form,id,dimension,progress,morphing},
    ghostPhase:state.ghostPhase,ghosts:WITCH_LAYOUT.ghosts.map((_,i)=>{const ghost=getWitchGhostPosition(i,state);return {...ghost,...warpWitchPoint(ghost,state)};}),
    selectedIngredient:state.selectedIngredient,objects:objects.map(object=>({...object,...getWitchObjectPosition(object,state)})),targets:getWitchTargets(state),hatStage:getWitchHat(state).stage,hatDrop:getWitchHatDrop(state),ladle:getWitchLadle(state),
    hairGeometry:{...hair,root:warpWitchPoint(hair.root,state),tip:warpWitchPoint(hair.tip,state),targets:hair.targets.map(p=>({...p,...warpWitchPoint(p,state)})),strands:hair.strands.map(strand=>({...strand,points:strand.points.map(p=>warpWitchPoint(p,state))}))},
    renderQuality:{...renderBudget,paints:paintCount,lastPaintDuration,pendingPaint:Boolean(frame),pendingTick:Boolean(clock)},
    eyeReady,eyeMetadata:eye.getMetadata(),spiderMetadata:spider.getMetadata?.()??null,handMetadata:hand.getMetadata?.()??hand.metadata??null};
}})});
sync(); send(); resize(); resumeDrawing();
