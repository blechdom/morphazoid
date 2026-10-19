import { WitchAudio } from './witch-audio.js';
import { createWitchHand } from './witch-hand.js';
import { renderWitch, hitTestWitch, getFingerTips, warpWitchPoint, WITCH_LAYOUT } from './witch-renderer.js';
import { WITCH_DEFAULTS, WITCH_PRESETS, normalizeWitchPreset, randomizeWitchPreset } from './witch-presets.js';
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
let playing = false, audioOn = false, starting = false, disposed = false, request = 0;
let selectedFinger = 1, frame = 0, lastPaint=0, last = performance.now(), silentPhase = 0, silentSpeed = 0;
let pointer = null, keyboardGate = false, event = null, ladleOffset = 0, motionTime = 0;
const fingerPointers = new Map(), fingerKeys = new Set(), sliderKeys = new Set(), sliderPointers = new Map(), arrowKeys = new Set();
const instrumentLabels = ['Thumb · glass','Index · reed','Middle · wire','Ring · metal','Little · marimba'];
const voiceLabels = ['Thumb · pitch','Index · vowel','Middle · rasp','Ring · tremble','Little · breath'];
let width = 1000, height = 720, presets;
const world={handReach:0,flightLift:0,trip:0};
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
let handReady=false,handSurface=null,pageSuspended=false;
const hand=createWitchHand({onStatus:message=>{$('liveStatus').textContent=message;}});
hand.ready.then(ready=>{if(disposed)return;handReady=ready;canvas.dataset.handReady=String(ready);});
audio.onError=error => { audioOn=false; starting=false; $('liveStatus').textContent=error.message; sync(); };
const sceneCopy = {
  brew: ['She brews her own voice.', 'Stir the pot. Touch her right hand, the moon, or the mushrooms.', 'Stir for me', 'stirring'],
  fingers: ['An instrument in every finger.', 'Pull her fingertips. Touch the pot to return, the moon to fly, or mushrooms for trouble.', 'Play the hand', 'hand'],
  flight: ['Music for a midnight ride.', 'Drag the sky to fly. Bats and ghosts ring out. Touch the pot to land; mushrooms bend the night.', 'Take flight', 'flight'],
};
function fingerMask() {
  let mask=0;
  for(const held of fingerPointers.values()) mask |= 1 << held.index;
  for(const index of fingerKeys) mask |= 1 << index;
  for(const index of sliderKeys) mask |= 1 << index;
  for(const index of sliderPointers.values()) mask |= 1 << index;
  if(keyboardGate && config.scene==='fingers') mask |= 1 << selectedFinger;
  return mask;
}
function gate() { return playing || Boolean(pointer) || keyboardGate || (config.scene==='fingers' && fingerMask()!==0); }
function send() { audio.update({ ...config, mode:config.scene, gate:gate(), fingerMask:playing?0:fingerMask(), volume:Number($('outputLevel').value) }); }
function sync() {
  const [caption,hint,playLabel,action] = sceneCopy[config.scene];
  $('sceneLabel').textContent = caption; $('gestureHint').textContent = hint;
  $('playLabel').textContent = playing ? 'Release' : playLabel;
  $('playGlyph').textContent = playing ? '■' : '▶';
  $('playButton').setAttribute('aria-pressed',String(playing));
  $('playButton').setAttribute('aria-label',`${playing?'Stop':'Play'} ${action}`);
  $('audioButton').setAttribute('aria-pressed',String(audioOn));
  $('audioState').textContent = starting ? 'starting' : audioOn ? 'on' : 'off';
  $('audioButton').disabled = starting;
  canvas.dataset.scene=config.scene;canvas.dataset.trip=String(world.trip);
  $('voice').value = config.voice;
  for (const key of ['speed','radius','altitude','tone','flightX']) { $(key).value=config[key]; $(`${key}Out`).value=`${Math.round(config[key]*100)}%`; }
  config.fingers.forEach((value,i) => { $(`finger${i}`).value=value; $(`finger${i}Out`).value=`${Math.round(value*100)}%`; });
  for (const key of ['glass','hair']) $(`${key}Out`).value=`${Math.round(config[key]*100)}%`;
  $('reverseButton').setAttribute('aria-pressed',String(config.direction<0));
  $('reverseButton').textContent = config.direction<0 ? '↶ Backward spell' : '↻ Forward spell';
  $('nightControls').hidden = config.scene !== 'flight';
  $('fingerControls').hidden = config.scene === 'flight';
  $('ingredientControls').hidden = config.scene !== 'brew';
  $('voiceControl').hidden = config.scene !== 'brew';
  $('radiusControl').hidden = config.scene !== 'brew';
  $('reverseButton').hidden = config.scene !== 'brew';
  $('speedControl').hidden = config.scene !== 'brew';
  $('flightSpeed').value=config.speed; $('flightSpeedOut').value=`${Math.round(config.speed*100)}%`;
  $('speedLabel').textContent = config.scene==='flight'?'Flight speed':'Motion';
  $('toneControl').hidden = config.scene === 'brew';
  $('voiceHeading').textContent = {brew:'Her voice',fingers:'Hand sound',flight:'Broom music'}[config.scene];
  $('fingerHeading').textContent = config.scene==='fingers'?'Five instruments':'Voice shaping';
  (config.scene==='fingers'?instrumentLabels:voiceLabels).forEach((label,i)=>{ $(`finger${i}Label`).textContent=label; });
  canvas.setAttribute('aria-label',`${caption} ${hint}`);
  presets?.refresh();
}
function stopGesture() {
  const held=pointer;
  if(held?.type==='stir') ladleOffset=held.ladleAngle-(audio.node?audio.visual.phase:silentPhase);
  pointer=null; keyboardGate=false;
  const captured=[...fingerPointers.keys()]; fingerPointers.clear(); fingerKeys.clear(); sliderKeys.clear(); sliderPointers.clear(); arrowKeys.clear();
  for(const id of captured) if(canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  if (held && canvas.hasPointerCapture(held.id)) canvas.releasePointerCapture(held.id);
  send();
}
function setScene(scene) { stopGesture(); config.scene=scene; sync(); send(); }
function worldAction(action) {
  if(action==='hand') setScene(config.scene==='fingers'?'brew':'fingers');
  else if(action==='moon') {
    if(config.scene!=='flight') { setScene('flight'); playing=true; send();sync();trigger('launch'); }
    else trigger('moon');
  } else if(action==='mushrooms') {
    world.trip=(world.trip+1)%4; sync();
    $('gestureReadout').value=world.trip?'Wonkywonk wonk.':'The forest settles.';
  } else if(action==='brew') setScene('brew');
}
function trigger(kind) {
  event={kind,age:0}; audio.trigger(kind);
  $('gestureReadout').value = {launch:'Bwa bwa ha ha hah ha!',moon:'A silver moon bell.',ghost:'Ghost chimes drift by.',bat:'A flutter of ticking wings.',spark:'A star plucks a string.',gust:'Wind through the broom.'}[kind] || kind;
}
async function toggleAudio() {
  const generation=++request;
  if(audioOn) { audioOn=false; audio.setAudible(false); sync(); return; }
  starting=true; $('liveStatus').textContent=''; sync();
  try {
    const hadNode=Boolean(audio.node);
    await audio.start();
    if(disposed || generation!==request) return;
    if(!hadNode) audio.syncPhase(silentPhase,silentSpeed);
    audioOn=true; send(); audio.setAudible(!document.hidden);
  } catch(error) { audioOn=false; $('liveStatus').textContent=`Sound could not start: ${error.message}. Try Audio again.`; }
  finally { if(generation===request && !disposed) { starting=false; sync(); } }
}
listen($('audioButton'),'click',toggleAudio);
listen($('playButton'),'click',() => { stopGesture(); playing=!playing; send(); sync(); });
listen($('resetButton'),'click',() => { stopGesture(); playing=false; config=normalizeWitchPreset(WITCH_DEFAULTS); silentPhase=0; silentSpeed=0; audio.syncPhase(0,0); ladleOffset=0; motionTime=0; event=null; world.trip=0; send(); sync(); $('gestureReadout').value='The pot is listening.'; });
for(const button of document.querySelectorAll('[data-world-action]')) listen(button,'click',() => worldAction(button.dataset.worldAction));
listen($('voice'),'change',() => { config.voice=$('voice').value; send(); sync(); });
for(const key of ['speed','radius','altitude','tone','flightX']) listen($(key),'input',() => { config[key]=Number($(key).value); send(); sync(); });
listen($('flightSpeed'),'input',()=>{ config.speed=Number($('flightSpeed').value); send(); sync(); });
for(let i=0;i<5;i++) {
  const slider=$(`finger${i}`);
  const release=()=>{ sliderKeys.delete(i); send(); };
  listen(slider,'input',() => { config.fingers[i]=Number(slider.value); selectedFinger=i; send(); sync(); });
  listen(slider,'pointerdown',e=>{
    if(config.scene==='fingers') { slider.focus({preventScroll:true}); sliderPointers.set(e.pointerId,i); selectedFinger=i; send(); }
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture']) listen(slider,type,e=>{ if(sliderPointers.delete(e.pointerId)) send(); });
  listen(slider,'blur',release);
  listen(slider,'keydown',e=>{ if(config.scene==='fingers' && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(e.key)) { sliderKeys.add(i); selectedFinger=i; send(); } });
  listen(slider,'keyup',release);
}
for(const type of ['pointerup','pointercancel']) listen(window,type,e=>{ if(sliderPointers.delete(e.pointerId)) send(); });
listen($('reverseButton'),'click',() => { config.direction*=-1; send(); sync(); });
listen($('outputLevel'),'input',() => { $('outputLevelOut').value=`${Math.round(Number($('outputLevel').value)*100)}%`; send(); });
for(const button of document.querySelectorAll('[data-effect]')) listen(button,'click',() => trigger(button.dataset.effect));
for(const key of ['glass','hair']) listen($(`${key}Button`),'click',() => { config[key]=clamp(config[key]+.25); event={kind:key,age:0}; send(); sync(); });
listen($('clearIngredients'),'click',() => { config.glass=0; config.hair=0; send(); sync(); });
function canonical(e, logical=false) {
  const rect=canvas.getBoundingClientRect(); const scale=Math.min(rect.width/1000,rect.height/720);
  const p={x:(e.clientX-rect.left-(rect.width-1000*scale)/2)/scale,y:(e.clientY-rect.top-(rect.height-720*scale)/2)/scale};
  return logical?warpWitchPoint(p,visualState(),true):p;
}
function stirLocation(point) {
  const pot=WITCH_LAYOUT.cauldron;
  const x=(point.x-pot.x)/pot.rx, y=(point.y-pot.y)/pot.ry;
  return { angle:Math.atan2(y,x),radius:clamp(Math.hypot(x,y),.08,1) };
}
function visualState() {
  const v=audio.node ? audio.visual : null;
  const phase=v?.phase??silentPhase, speed=v?.speed??silentSpeed;
  const mask=playing?31:fingerMask();
  const fingerLevels=audioOn&&v?.fingerLevels?v.fingerLevels:Array.from({length:5},(_,i)=>mask&(1<<i)?1:0);
  return { ...config, ...world, handSurface, handTips:handReady?hand.getTips():[],handWrist:handReady?hand.getWrist():null,pickHand:handReady?hand.pick:null,warpTime:reducedMotion.matches?0:performance.now()/1000,time:performance.now()/1000, motionTime, phase, speed, energy:audioOn?(v?.energy??speed):speed, launchEnvelope:audioOn?(v?.launchEnvelope??0):(event?.kind==='launch'&&event.age<1.86?1:0), mouth:config.scene==='brew'?(audioOn?(v?.mouth??0):(speed*(.35+.65*Math.abs(Math.sin(phase*3))))):(audioOn?(v?.mouth??0):(event?.kind==='launch'&&event.age<1.86?Math.max(0,Math.sin(event.age*25))*.6:0)), fingerLevels, flightPulse:audioOn?(v?.flightPulse??0):speed*Math.max(0,Math.sin(phase*2)), direction:config.direction, event:event??(v?.effect ? {kind:v.effect,age:1-(v.effectEnvelope??0)} : null), selectedFinger, ladleAngle:pointer?.type==='stir'?pointer.ladleAngle:phase+ladleOffset, hitRadius:Math.max(46,24/Math.max(.1,Math.min(width/1000,height/720))) };
}
listen(canvas,'pointerdown',e => {
  if(pointer || e.button!==0) return;
  const raw=canonical(e), hit=hitTestWitch(raw.x,raw.y,visualState()),p=canonical(e,true);
  if(!hit) return;
  canvas.focus({preventScroll:true});
  if(['hand','moon','mushrooms'].includes(hit.type)) { worldAction(hit.type);e.preventDefault(); return; }
  if(['ghost','bat'].includes(hit.type)) { trigger(hit.type); return; }
  if(hit.type==='stir' && config.scene!=='brew') setScene('brew');
  if(hit.type==='finger' && config.scene==='fingers') {
    selectedFinger=hit.index; fingerPointers.set(e.pointerId,{index:hit.index,start:p,value:config.fingers[hit.index]});
    canvas.setPointerCapture(e.pointerId); send(); sync(); e.preventDefault(); return;
  }
  playing=false; keyboardGate=false;
  const visual=visualState(), start=stirLocation(p), pot=WITCH_LAYOUT.cauldron;
  const onHandle=((p.x-pot.x)/pot.rx)**2+((p.y-pot.y)/pot.ry)**2>1;
  pointer={id:e.pointerId,type:hit.type,index:hit.index??0,start:p,value:config.fingers[hit.index??0],time:performance.now(),...start,ladleAngle:onHandle?visual.ladleAngle:start.angle,radiusOffset:onHandle?config.radius-start.radius:0};
  canvas.setPointerCapture(e.pointerId);
  if(hit.type==='stir') { config.speed=.05; if(!onHandle) config.radius=pointer.radius; }
  if(hit.type==='finger') selectedFinger=pointer.index;
  if(hit.type==='flight') { config.flightX=clamp(p.x/1000,.12,.88); config.altitude=clamp(1-p.y/720); }
  send(); sync(); e.preventDefault();
});
listen(canvas,'pointermove',e => {
  const held=fingerPointers.get(e.pointerId);
  if(held) {
    const p=canonical(e,true); config.fingers[held.index]=clamp(held.value+(held.index===0?-1:1)*(p.y-held.start.y)/220+(p.x-held.start.x)/600);
    send(); sync(); e.preventDefault(); return;
  }
  if(!pointer || pointer.id!==e.pointerId) { const p=canonical(e);canvas.style.cursor=hitTestWitch(p.x,p.y,visualState())?'grab':'default'; return; }
  const p=canonical(e,true), now=performance.now();
  if(pointer.type==='stir') {
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
  if(fingerPointers.delete(e.pointerId)) { if(canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); send(); sync(); }
  if(pointer?.id===e.pointerId) { stopGesture(); sync(); }
}
listen(canvas,'pointerup',releasePointer); listen(canvas,'pointercancel',releasePointer); listen(canvas,'lostpointercapture',releasePointer);
listen(canvas,'keydown',e => {
  if(e.altKey || e.ctrlKey || e.metaKey) return;
  if(e.key==='Escape') { setScene('brew'); playing=false; send(); sync(); e.preventDefault(); return; }
  if(config.scene==='fingers' && /^[1-5]$/.test(e.key)) { selectedFinger=Number(e.key)-1; fingerKeys.add(selectedFinger); $('gestureReadout').value=instrumentLabels[selectedFinger]; send(); e.preventDefault(); return; }
  const action={h:'hand',m:'moon',b:'brew',w:'mushrooms'}[e.key.toLowerCase()];
  if(action) {if(!e.repeat) worldAction(action);e.preventDefault();return;}
  const effect={t:'bat',g:'ghost',s:'spark',v:'gust'}[e.key.toLowerCase()];
  if(config.scene==='flight' && effect) { if(!e.repeat) trigger(effect); e.preventDefault(); return; }
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
  const step=e.shiftKey?.12:.035;
  if(config.scene==='fingers') { config.fingers[selectedFinger]=clamp(config.fingers[selectedFinger]+(['ArrowUp','ArrowRight'].includes(e.key)?step:-step)); }
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
  cancelAnimationFrame(frame);frame=0;lastPaint=0;last=performance.now();
  if(!disposed && !document.hidden && !pageSuspended) frame=requestAnimationFrame(draw);
}
function draw(now) {
  frame=0;
  if(disposed || document.hidden || pageSuspended) return;
  // Keep compositing below 30fps; audio and musical events own their sample clock.
  if(now-lastPaint<1000/30) {frame=requestAnimationFrame(draw);return;}
  lastPaint=now;
  const dt=Math.min(.06,(now-last)/1000); last=now;
  silentSpeed+=(gate()?config.speed-silentSpeed:-silentSpeed)*(1-Math.exp(-dt/(gate()?.08:1.3)));
  silentPhase=(silentPhase+config.direction*silentSpeed*dt*12+TAU)%TAU;
  motionTime+=dt*(audio.node?audio.visual.speed:silentSpeed);
  if(event) { event.age+=dt; if(event.age>3.5) event=null; }
  const ease=reducedMotion.matches?1:1-Math.exp(-dt/ .18);
  for(const [key,target] of [['handReach',config.scene==='fingers'?1:0],['flightLift',config.scene==='flight'?1:0]]) { world[key]+=(target-world[key])*ease;if(Math.abs(target-world[key])<.001)world[key]=target; }
  const state=visualState();
  if(handReady && world.flightLift<.999) { handSurface=hand.render(state);state.handSurface=handSurface;state.handTips=hand.getTips();state.handWrist=hand.getWrist(); }
  renderWitch(ctx,width,height,state);
  frame=requestAnimationFrame(draw);
}
let readoutTick=0;
const clock=setInterval(() => {
  if(document.hidden || disposed) return;
  // A held but motionless ladle loses energy; event timing never depends on drawing.
  if(pointer?.type==='stir' && performance.now()-pointer.time>120) { config.speed=Math.max(.02,config.speed*.8); send(); }
  if(++readoutTick%5===0 && !event) {
    const v=visualState();
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
  if(disposed) return; disposed=true; ++request; clearInterval(clock); cancelAnimationFrame(frame); observer.disconnect(); abort.abort(); presets?.destroy(); hand.dispose();audio.dispose();delete window.witchInstrument;
});
presets=registerHeaderPresets({id:'witch',presets:WITCH_PRESETS,capture:()=>structuredClone(config),apply:snapshot=>{stopGesture();config=normalizeWitchPreset(snapshot);send();sync();},randomize:randomizeWitchPreset});
Object.defineProperty(window,'witchInstrument',{configurable:true,value:Object.freeze({get state() {
  const state=visualState();
  return {config:structuredClone(config),playing,audioOn,world:{...world},handReady,
    fingerTips:getFingerTips(state).map(p=>warpWitchPoint(p,state)),handWrist:state.handWrist,
    handMetadata:hand.getMetadata?.()??hand.metadata??null};
}})});
sync(); send(); resize(); resumeDrawing();
