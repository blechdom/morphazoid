import { sonicSkin } from "./puggler-sonic-skins.js";
import { PugglerModel, PROPS, PATTERNS, OBJECT_SOUND_CHOICES, DRUMS, RIFFS, MAX_OBJECTS, RIDER_NAMES, RIDE_PATTERNS, CASTS, clamp, soundMapping } from "./puggler.js";
import { PAGE_DEFAULTS, PRESETS } from "./puggler-presets.js";
import { PugglerAudio } from "./puggler-audio.js";
import { PugglerRenderer } from "./puggler-renderer.js";
import { GAME_KEYS, drivingControls } from "./puggler-controls.js";
import { SKINS, skinFor, presentProp } from "./puggler-skins.js";
import { LIGHTING_SCENES } from "./puggler-lighting.js";
import { objectSoundLabel } from './puggler-object-sounds.js';
import { SOUND_DEFAULTS, PUGGLER_FULL_PRESETS, capturePugglerPreset, applyPugglerPreset, randomizePugglerPreset } from './puggler-full-presets.js';
import { registerHeaderPresets } from '../../site/header-presets.js';
import { enhanceRangeKnob } from "../../ui/primitives/range-knob.js";
import { createRangeField } from "../../ui/index.js";

const $ = id => document.getElementById(id);
const model = new PugglerModel(PAGE_DEFAULTS), audio = new PugglerAudio(), renderer = new PugglerRenderer($('stage'));
const soundDefaults = { ...SOUND_DEFAULTS, level:.48, tempo:PAGE_DEFAULTS.tempo, allowFlashes:false };
let headerPresets;
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const params = { ...soundDefaults, reducedMotion:motionPreference.matches };
let running=true,starting=false,disposed=false,frame=0,timer=0,lastClock=performance.now()/1000,accumulator=0;
const targets=[null,null,null];
let stagePointer=null;
const keys=new Set(),cleanups=[],ranges=new Map(),objectRows=[],knobs=[];
const riderToggles=[],toggleKeys=['Digit1','Digit2','Digit3'];
const listen=(element,type,handler,options)=>{element.addEventListener(type,handler,options);cleanups.push(()=>element.removeEventListener(type,handler,options));};
const percent=v=>`${Math.round(v*100)}%`;
function updateAudio(){audio.update(model.objects,{...params,tempo:model.config.tempo,beat:model.beat,active:!document.hidden},running&&!document.hidden);}
function status(){
  $('playButton').textContent=running?'Pause':'Play';
  $('playButton').setAttribute('aria-pressed',String(running));
}
function togglePlay(){running=!running;accumulator=0;lastClock=clock();updateAudio();status();}
function clock(){return audio.on&&audio.context?.state==='running'?audio.context.currentTime:performance.now()/1000;}
function addRange(container,id,label,min,max,step,value,formatter,destination){
  const field=createRangeField({id,label,min,max,step,value,formatValue:formatter,onInput:v=>{
    if(destination==='model')model.apply({[id]:v});else params[id]=v;
    if(id==='count')syncSelectors();
    headerPresets?.refresh();
  }});$(container).append(field);ranges.set(id,field);
  if($(container).classList.contains('puggler-knobs'))knobs.push(enhanceRangeKnob(field.input));
}
addRange('performanceKnobs','rideSpeed','Ride speed',0,2.5,.05,PAGE_DEFAULTS.rideSpeed,v=>v===0?'Still':`${v.toFixed(2)}×`,'model');
addRange('performanceKnobs','count','Objects',1,10,1,PAGE_DEFAULTS.count,v=>`${v}`,'model');
addRange('performanceKnobs','tempo','Juggle / music',100,1200,1,PAGE_DEFAULTS.tempo,v=>`${v} BPM`,'model');
addRange('performanceKnobs','loft','Throw height',.6,3,.05,1.8,v=>`${v.toFixed(2)}×`,'model');
addRange('performanceKnobs','assist','Catch reach',20,120,1,PAGE_DEFAULTS.assist,v=>`${v}`,'model');
addRange('performanceKnobs','chaos','Wildness',0,100,1,PAGE_DEFAULTS.chaos,v=>`${v}%`,'model');
addRange('performanceKnobs','gravity','Gravity',.45,1.65,.01,1,v=>`${v.toFixed(2)}×`,'model');
addRange('performanceKnobs','wind','Crosswind',-12,12,.1,0,v=>`${v>0?'+':''}${v.toFixed(1)}`,'model');
addRange('lightingControls','lightIntensity','Light intensity',0,1,.01,params.lightIntensity,percent);
addRange('lightingControls','lightSpeed','Light motion',.2,2.5,.05,params.lightSpeed,v=>`${v.toFixed(2)}×`);
addRange('soundControls','sceneGain','Scene level',0,1,.01,params.sceneGain,percent);
addRange('soundControls','flight','Airborne riffs',0,1,.01,params.flight,percent);
addRange('soundControls','impacts','Catch impacts',0,2,.01,params.impacts,percent);
addRange('soundControls','drops','Drops / boos',0,1,.01,params.drops,percent);
addRange('soundControls','boo','Audience',0,3,.01,params.boo,percent);
for(const [id,description] of Object.entries({
  sceneGain:'Whole scene: objects, catches, drop boos and audience. Multiplied by the header Output level.',
  drops:'Foreground boos when an object drops. Separate from Audience; follows Scene level.',
  boo:'Crowd cheers and boos, up to 300% gain. Separate from Drops / boos; follows Scene level.',
})){
  ranges.get(id).title=description;$(id).setAttribute('aria-description',description);
}
addRange('soundControls','height','Height → pitch',0,1.5,.01,.65,v=>`${v.toFixed(2)}×`);
addRange('soundControls','stereo','Stereo width',0,1,.01,1,percent);
addRange('soundControls','grit','Amp filth',0,1,.01,params.grit,percent);
addRange('soundControls','motion','Speed → brightness',0,12,.1,params.motion,v=>`${v.toFixed(1)}×`);
addRange('soundControls','decay','Impact tail',.2,1,.05,1,v=>v===1?'Full':percent(v));
$('preset').replaceChildren(new Option('Custom juggling act',''),...PRESETS.map(p=>new Option(p.name,p.id)));
$('preset').value='ballet';
$('ridePattern').replaceChildren(...RIDE_PATTERNS.map(id=>new Option(id.replaceAll('-',' '),id)));
addRange('ridingControls','rideRange','Riding distance',0,100,1,PAGE_DEFAULTS.rideRange,v=>`${Math.round(v)}%`,'model');
$('skin').replaceChildren(...SKINS.map(skin=>new Option(skin.name,skin.id)));
$('lighting').replaceChildren(...LIGHTING_SCENES.map(scene=>new Option(scene.name,scene.id)));
function syncSkinLabels(){
  ranges.get('grit').querySelector('.mz-field__label').textContent=sonicSkin(params.skin).grit;
  const skin=skinFor(params.skin),names=skin.riders;
  $('skin').value=skin.id;$('lighting').value=params.lighting;
  $('postersButton').textContent='↻ Random flyers';
  riderToggles.forEach((button,owner)=>button.querySelector('span').textContent=names[owner]);
  $('stage').setAttribute('aria-label',`${skin.name} juggling stage. Drag or use Left and Right to steer all jugglers together.`);
}
const patternNotation=p=>p.count>4?(p.sync?`(${p.values[0]}, ${p.values[0]})`:p.values.join(' · ')):p.notation;
function syncSelectors(){
  syncSkinLabels();
  $('count').value=String(model.config.count);
  for(const id of ['ridePattern','passMode'])$(id).value=model.config[id];
  $('passingField').hidden=model.riderCount===1;
  $('autoRide').checked=model.config.autoRide;
  $('trails').checked=params.trails;
  $('allowFlashes').checked=params.allowFlashes;
  $('allowFlashes').disabled=params.reducedMotion;
  $('flashNote').textContent=params.reducedMotion?'Flashes disabled by reduced-motion preference.':'Optional flashing accents (up to 2 per second). Leave off if sensitive to flashes.';
  const patterns=PATTERNS.filter(p=>p.count===model.config.count).map(p=>new Option(`${p.name} · ${patternNotation(p)}`,p.id));
  patterns.unshift(new Option('Verse / fill / break','phrase:verse'),new Option('Evolving phrases','phrase:evolve'));
  $('pattern').replaceChildren(...patterns);
  $('pattern').value=model.config.phrase==='loop'?model.pattern.id:`phrase:${model.config.phrase}`;
  for(const [id,field] of ranges)field.setValue(id in model.config?model.config[id]:params[id]);
  riderToggles.forEach((button,owner)=>{
    const active=model.activeIds.includes(owner),last=active&&model.riderCount===1;
    button.setAttribute('aria-pressed',String(active));button.disabled=last;
    const name=skinFor(params.skin).riders[owner];
    button.title=last?'Keep at least one juggler onstage':`${active?'Hide':'Show'} ${name} (${owner+1})`;
    button.setAttribute('aria-label',`${owner+1} ${name} onstage`);
  });
  syncObjects();
}
function toggleRider(owner){
  const active=model.activeIds.includes(owner);if(active&&model.riderCount===1)return;
  const ids=active?model.activeIds.filter(id=>id!==owner):[...model.activeIds,owner].sort((a,b)=>a-b);
  const cast=CASTS.find(c=>c.riders.join(',')===ids.join(','));if(!cast)return;
  model.apply({cast:cast.id});releaseControls();syncSelectors();updateAudio();
}
function syncObjects(){
  $('objectControls').replaceChildren();objectRows.length=0;
  model.objects.forEach((o,i)=>{
    const row=document.createElement('div');row.className='object-row';row.style.setProperty('--prop-color',o.prop.color);
    const select=document.createElement('select');select.className='mz-select-field__select';select.id=`object${i}`;select.setAttribute('aria-label',`Sound object ${i+1}`);
    select.append(...PROPS.map(p=>new Option(presentProp(p,params.skin).name,p.id)));select.value=o.prop.id;
    select.addEventListener('change',()=>{const ids=[...model.config.propIds];ids[i]=select.value;model.apply({propIds:ids});syncObjectValues();});row.append(select);
    for(const [kind,choices,title] of [['drums',DRUMS,'Catch'],['riffs',RIFFS,'Air']]){
      const choice=document.createElement('select');choice.className='mz-select-field__select';choice.id=`${kind}${i}`;choice.setAttribute('aria-label',`${title} sound for object ${i+1}`);
      choice.append(...OBJECT_SOUND_CHOICES.map(id=>new Option(objectSoundLabel(params.skin,id,o.prop.id,kind==='drums'?'catch':'air'),id)),...choices.map(id=>new Option(sonicSkin(params.skin).names[id],id)));choice.value=model.config[kind][i];
      choice.addEventListener('change',()=>{const values=[...model.config[kind]];values[i]=choice.value;model.apply({[kind]:values});});row.append(choice);
    }
    $('objectControls').append(row);objectRows.push({select,row});
  });syncObjectValues();
}
function syncObjectValues(){model.objects.forEach((o,i)=>{const r=objectRows[i];if(!r)return;const prop=presentProp(o.prop,params.skin);r.select.value=prop.id;r.select.title=`${prop.name} · ${prop.mass>=1?`${prop.mass} kg`:`${Math.round(prop.mass*1000)} g`}`;r.row.style.setProperty('--prop-color',prop.color);for(const kind of ['drums','riffs']){const select=r.row.querySelector(`#${kind}${i}`);select.options[0].textContent=objectSoundLabel(params.skin,'object',o.prop.id,kind==='drums'?'catch':'air');select.title=select.selectedOptions[0]?.textContent??'';}});}
function selectPattern(value){
  model.apply(value.startsWith('phrase:')?{phrase:value.slice(7)}:{pattern:value,phrase:'loop'});
  syncSelectors();updateAudio();
}
listen($('pattern'),'change',()=>selectPattern($('pattern').value));
listen($('nextPattern'),'click',()=>{
  const select=$('pattern');selectPattern(select.options[(select.selectedIndex+1)%select.options.length].value);
});
for(const id of ['passMode','ridePattern'])listen($(id),'change',()=>{model.apply({[id]:$(id).value});syncSelectors();});
listen($('autoRide'),'change',()=>model.apply({autoRide:$('autoRide').checked}));
listen($('skin'),'change',()=>{params.skin=skinFor($('skin').value).id;syncSelectors();});
listen($('lighting'),'change',()=>{params.lighting=LIGHTING_SCENES.find(scene=>scene.id===$('lighting').value)?.id??'house';});
listen(motionPreference,'change',()=>{params.reducedMotion=motionPreference.matches;syncSelectors();});
listen($('allowFlashes'),'change',()=>{params.allowFlashes=$('allowFlashes').checked&&!params.reducedMotion;});
listen($('postersButton'),'click',()=>model.apply({posterSeed:(model.posterSeed+1)>>>0}));
listen($('preset'),'change',()=>{
  const preset=PRESETS.find(p=>p.id===$('preset').value);if(!preset)return;
  model.apply({...preset.config,drums:PAGE_DEFAULTS.drums.map((v,i)=>preset.config.drums?.[i]??v),riffs:PAGE_DEFAULTS.riffs.map((v,i)=>preset.config.riffs?.[i]??v)});
  releaseControls();syncSelectors();
});
listen($('randomButton'),'click',()=>{model.apply({propIds:Array.from({length:MAX_OBJECTS},()=>PROPS[Math.floor(model.random()*PROPS.length)].id)});syncObjects();});
listen($('resetButton'),'click',()=>{
  model.config={...PAGE_DEFAULTS,propIds:[...PAGE_DEFAULTS.propIds],drums:[...PAGE_DEFAULTS.drums],riffs:[...PAGE_DEFAULTS.riffs]};model.reset();Object.assign(params,soundDefaults);
  $('level').value=params.level;$('levelOut').value=percent(params.level);$('preset').value='ballet';$('trails').checked=true;
  releaseControls();accumulator=0;syncSelectors();status();updateAudio();
});
listen($('playButton'),'click',togglePlay);
listen($('level'),'input',()=>{params.level=Number($('level').value);$('levelOut').value=percent(params.level);updateAudio();});
listen($('trails'),'change',()=>params.trails=$('trails').checked);
listen($('audioButton'),'click',async()=>{
  if(starting||disposed)return;
  if(audio.on){audio.mute();$('audioButton').setAttribute('aria-pressed','false');$('audioState').textContent='off';lastClock=clock();status();return;}
  starting=true;$('audioButton').disabled=true;$('audioState').textContent='starting';$('audioError').hidden=true;
  try{await audio.arm();if(disposed)return;$('audioButton').setAttribute('aria-pressed','true');$('audioState').textContent='on';updateAudio();}
  catch(error){audio.mute();$('audioState').textContent='off';$('audioError').textContent=`Audio could not start: ${error.message}`;$('audioError').hidden=false;}
  finally{starting=false;if(!disposed){$('audioButton').disabled=false;lastClock=clock();status();}}
});
function throwToCrowd(){
  model.events=[];
  for(const owner of model.activeIds)model.throwToAudience(owner);
  handleEvents(model.events,(audio.context?.currentTime??0)+.01);
}
listen($('crowdButton'),'click',throwToCrowd);
RIDER_NAMES.forEach((name,owner)=>{
  const toggle=document.createElement('button');toggle.type='button';toggle.className='rider-toggle';toggle.dataset.rider=String(owner);toggle.id=`rider-${owner}`;
  toggle.setAttribute('aria-controls','stage');toggle.setAttribute('aria-keyshortcuts',String(owner+1));
  const shortcut=document.createElement('kbd');shortcut.textContent=String(owner+1);
  const caption=document.createElement('span');caption.textContent=name;toggle.append(shortcut,caption);
  listen(toggle,'click',()=>toggleRider(owner));riderToggles.push(toggle);$('keyboardControls').append(toggle);
});
function controlTarget(e){return e.target?.closest('input,select,textarea,a,summary,[contenteditable=true],[role=slider],button');}
listen(window,'keydown',e=>{
  if(controlTarget(e)||e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
  const toggleOwner=toggleKeys.indexOf(e.code);
  if(toggleOwner>=0){e.preventDefault();if(!e.repeat)toggleRider(toggleOwner);return;}
  if(!GAME_KEYS.has(e.code))return;
  e.preventDefault();if(e.code==='KeyG'&&!e.repeat)throwToCrowd();keys.add(e.code);
});
listen(window,'keyup',e=>keys.delete(e.code));
function releaseControls(){
  keys.clear();targets.fill(null);
  if(stagePointer!==null&&$('stage').hasPointerCapture(stagePointer))$('stage').releasePointerCapture(stagePointer);
  stagePointer=null;
}
listen(window,'blur',releaseControls);
function steerStage(e){
  const fraction=clamp(renderer.worldX(e.clientX)/1000,0,1);
  for(const owner of model.activeIds){const [low,high]=model.playerBounds(owner);targets[owner]=low+(high-low)*fraction;}
}
listen($('stage'),'pointerdown',e=>{
  if(e.button!==0||stagePointer!==null)return;
  stagePointer=e.pointerId;$('stage').setPointerCapture(e.pointerId);steerStage(e);$('stage').focus({preventScroll:true});
});
listen($('stage'),'pointermove',e=>{if(stagePointer===e.pointerId)steerStage(e);});
for(const type of ['pointerup','pointercancel','lostpointercapture'])listen($('stage'),type,e=>{if(stagePointer===e.pointerId){stagePointer=null;targets.fill(null);}});
listen(document,'visibilitychange',()=>{releaseControls();lastClock=clock();accumulator=0;updateAudio();});
// The independent fixed-step clock keeps manual riding and the audience alive
// while the transport gates only automatic juggling throws and its beat.
function tick(){
  if(disposed)return;
  const now=clock(),dt=clamp(now-lastClock,0,.1);lastClock=now;
  if(document.hidden){updateAudio();return;}
  accumulator+=dt;const events=[];
  const held=keys;
  while(accumulator>=1/120){events.push(...model.step(1/120,drivingControls(held,targets,model.activeIds),null,0,null,running));accumulator-=1/120;}
  params.tempo=model.config.tempo;handleEvents(events,(audio.context?.currentTime??0)+.035);updateAudio();
}
function handleEvents(events,audioTime){
  renderer.react(events,model.time,running);
  for(const e of events){
    audio.strike(e,params,audioTime-(model.time-e.time));
    if(e.kind==='replacement'){syncObjectValues();headerPresets?.refresh();}
    if(['catch','kick','crowd-catch'].includes(e.kind)){
      const m=soundMapping(e.prop,e,params);
      window.dispatchEvent(new CustomEvent('morphazoid:midi-output-preview',{detail:{kind:'note',routeId:'puggler',source:'Juggling contact',sourceId:`puggler-${e.id}`,note:Math.round(69+12*Math.log2(m.frequency/440)),frequencyHz:m.frequency,velocity:Math.round(30+90*m.energy),durationMs:e.prop.decay*1000}}));
    }
  }
}
function draw(){if(disposed)return;if(!document.hidden)renderer.draw(model,params);frame=requestAnimationFrame(draw);}
function teardown(){if(disposed)return;disposed=true;releaseControls();clearInterval(timer);cancelAnimationFrame(frame);cleanups.forEach(fn=>fn());headerPresets?.destroy();knobs.forEach(knob=>knob.destroy());ranges.forEach(field=>field.destroy());renderer.dispose();void audio.close();}
listen(window,'pagehide',teardown,{once:true});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
syncSelectors();status();timer=setInterval(tick,20);frame=requestAnimationFrame(draw);
headerPresets=registerHeaderPresets({
  id:'puggler',presets:PUGGLER_FULL_PRESETS,
  capture:()=>capturePugglerPreset(model,params),
  apply:snapshot=>{
    applyPugglerPreset(model,params,snapshot);
    $('preset').value='';releaseControls();syncSelectors();updateAudio();
  },
  randomize:randomizePugglerPreset,
});
window.__puggler=Object.freeze({snapshot:()=>({level:params.level,dropLevel:params.drops,sceneGain:params.sceneGain,allowFlashes:params.allowFlashes,reducedMotion:params.reducedMotion,rhythmicNotes:audio.noteCount,objectBufferCount:Object.keys(audio.objectBuffers??{}).length,airTails:audio.airTails.size,skin:params.skin,lighting:params.lighting,riderNames:[...skinFor(params.skin).riders],time:model.time,running,audioOn:audio.on,x:model.x,beat:model.beat,pattern:model.pattern.id,count:model.objects.length,catches:model.catches,drops:model.drops,passes:model.passes,crowdCatches:model.crowdCatches,riders:model.riderCount,activeIds:[...model.activeIds],chaos:model.config.chaos,posterSeed:model.posterSeed,phrase:model.config.phrase,cast:model.config.cast,autoRide:model.config.autoRide,ridePattern:model.config.ridePattern,rideSpeed:model.config.rideSpeed,rideRange:model.config.rideRange,steeringTargets:[...targets],trails:params.trails,tempo:model.config.tempo,loft:model.config.loft,players:model.players.map(p=>({...p})),attacks:audio.attacks.size,sonics:audio.voices.filter(Boolean).map(v=>({slot:v.slot,key:v.key,skin:v.skin,speaker:v.speaker,role:v.role,noteBeat:v.noteBeat??null,startedAt:v.startedAt,rate:v.rate})),hitSounds:[...audio.attacks].map(v=>v.key),vocals:audio.voices.filter(v=>v?.character).map(v=>({slot:v.slot,character:v.character,speaker:v.speaker,role:v.role,startedAt:v.startedAt})),collage:renderer.collageStatus(),crowd:renderer.crowdSnapshot(model.time),pyro:renderer.pyroSnapshot(model.time),objects:model.objects.map(o=>({id:o.id,start:o.start,x:o.x,y:o.y,vx:o.vx,vy:o.vy,phase:o.phase,prop:o.prop.id,name:presentProp(o.prop,params.skin).name,owner:o.owner,fromOwner:o.fromOwner,voiceOwner:o.voiceOwner,drum:o.drum,riff:o.riff})),disposed})});
