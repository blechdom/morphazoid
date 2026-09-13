import { sonicSkin } from './src/puggler-sonic-skins.js';
import { PugglerModel, PROPS, PATTERNS, DEFAULTS, DRUMS, RIFFS, MAX_OBJECTS, RIDER_NAMES, CASTS, clamp, soundMapping } from './src/puggler.js';
import { PAGE_DEFAULTS, PRESETS } from './src/puggler-presets.js';
import { PugglerAudio } from './src/puggler-audio.js';
import { PugglerRenderer } from './src/puggler-renderer.js';
import { RIDER_KEYS, GAME_KEYS, drivingControls } from './src/puggler-controls.js';
import { SKINS, skinFor, presentProp } from './src/puggler-skins.js';
import { LIGHTING_SCENES } from './src/puggler-lighting.js';
import { createRangeField } from './src/ui/index.js';

const $ = id => document.getElementById(id);
const model = new PugglerModel(PAGE_DEFAULTS), audio = new PugglerAudio(), renderer = new PugglerRenderer($('stage'));
const soundDefaults = { level:.48, height:.65, stereo:1, motion:6, flight:.8, impacts:1.25, grit:.82, decay:1, boo:.75, trails:true, tempo:360, skin:'punk', lighting:'house' };
const params = { ...soundDefaults };
let running=true,starting=false,disposed=false,frame=0,timer=0,lastClock=performance.now()/1000,accumulator=0;
const targets=[null,null,null],pointers=new Map(),buttonPointers=new Map(),buttonStarts=new Map(),buttonKeys=new Set(),pulses=new Map();
const keys=new Set(),cleanups=[],ranges=new Map(),objectRows=[],keyButtons=new Map();
const riderToggles=[],toggleKeys=['Digit1','Digit2','Digit3'];
const listen=(element,type,handler,options)=>{element.addEventListener(type,handler,options);cleanups.push(()=>element.removeEventListener(type,handler,options));};
const percent=v=>`${Math.round(v*100)}%`;
function updateAudio(){audio.update(model.objects,{...params,active:!document.hidden},running&&!document.hidden);}
function status(){
  $('playButton').textContent=running?'Pause':'Play';
  $('playButton').setAttribute('aria-pressed',String(running));
}
function togglePlay(){running=!running;accumulator=0;lastClock=clock();updateAudio();status();}
function clock(){return audio.on&&audio.context?.state==='running'?audio.context.currentTime:performance.now()/1000;}
function addRange(container,id,label,min,max,step,value,formatter,destination){
  const field=createRangeField({id,label,min,max,step,value,formatValue:formatter,onInput:v=>{
    if(destination==='model')model.apply({[id]:v});else params[id]=v;
  }});$(container).append(field);ranges.set(id,field);
}
addRange('tempoControls','tempo','Tempo',100,1200,1,PAGE_DEFAULTS.tempo,v=>`${v} BPM`,'model');
addRange('physicsControls','loft','Throw height',.6,3,.05,1.8,v=>`${v.toFixed(2)}×`,'model');
addRange('physicsControls','assist','Catch reach',20,120,1,PAGE_DEFAULTS.assist,v=>`${v}`,'model');
addRange('physicsControls','chaos','Throw wildness',0,100,1,PAGE_DEFAULTS.chaos,v=>`${v}%`,'model');
addRange('physicsControls','gravity','Gravity',.45,1.65,.01,1,v=>`${v.toFixed(2)}×`,'model');
addRange('physicsControls','wind','Crosswind',-12,12,.1,0,v=>`${v>0?'+':''}${v.toFixed(1)}`,'model');
addRange('soundControls','flight','Airborne riffs',0,1,.01,params.flight,percent);
addRange('soundControls','impacts','Catch drums',0,2,.01,params.impacts,percent);
addRange('soundControls','boo','Audience',0,1,.01,params.boo,percent);
addRange('soundControls','height','Height → pitch',0,1.5,.01,.65,v=>`${v.toFixed(2)}×`);
addRange('soundControls','stereo','Stereo width',0,1,.01,1,percent);
addRange('soundControls','grit','Amp filth',0,1,.01,params.grit,percent);
addRange('soundControls','motion','Speed → brightness',0,12,.1,params.motion,v=>`${v.toFixed(1)}×`);
addRange('soundControls','decay','Drum tail',.2,1,.05,1,v=>v===1?'Full':percent(v));
$('preset').replaceChildren(...PRESETS.map(p=>new Option(p.name,p.id)));
$('cast').replaceChildren(...CASTS.map(c=>new Option(c.name,c.id)));
$('skin').replaceChildren(...SKINS.map(skin=>new Option(skin.name,skin.id)));
$('lighting').replaceChildren(...LIGHTING_SCENES.map(scene=>new Option(scene.name,scene.id)));
function syncSkinLabels(){
  ranges.get('grit').querySelector('.mz-field__label').textContent=sonicSkin(params.skin).grit;
  const skin=skinFor(params.skin),names=skin.riders;
  $('skin').value=skin.id;$('lighting').value=params.lighting;
  $('postersButton').textContent=skin.id==='punk'?'↻ Random flyers':'↻ Random backdrop';
  $('cast').replaceChildren(...CASTS.map(c=>new Option(c.riders.map(owner=>names[owner]).join(' + '),c.id)));
  document.querySelectorAll('.rider-keyboard').forEach((group,owner)=>group.setAttribute('aria-label',`${names[owner]} keyboard controls`));
  riderToggles.forEach((button,owner)=>button.querySelector('span').textContent=names[owner]);
  for(const [code,{button,owner,action}] of keyButtons){
    const label=code.replace('Key','').replace('Numpad','');
    button.setAttribute('aria-label',`${names[owner]} ${keyLabels[action]} (${code.startsWith('Numpad')?'numpad ':''}${label})`);
  }
  $('stage').setAttribute('aria-label',`${skin.name} juggling stage. Steer the unicycles with the keyboard controls below or drag a performer.`);
}
const patternNotation=p=>p.count>4?(p.sync?`(${p.values[0]}, ${p.values[0]})`:p.values.join(' · ')):p.notation;
function syncSelectors(){
  syncSkinLabels();
  $('count').value=String(model.config.count);
  for(const id of ['cast','phrase','passMode'])$(id).value=model.config[id];
  $('passingField').hidden=model.riderCount===1;
  $('autoRide').checked=model.config.autoRide;
  const patterns=PATTERNS.filter(p=>p.count===model.config.count).map(p=>new Option(`${p.name} · ${patternNotation(p)}`,p.id));
  if(model.config.phrase!=='loop'){
    const automatic=new Option(model.config.phrase==='verse'?'Verse phrases':'Evolving phrases','');
    automatic.disabled=true;patterns.unshift(automatic);
  }
  $('pattern').replaceChildren(...patterns);
  $('pattern').value=model.config.phrase==='loop'?model.pattern.id:'';
  for(const [id,field] of ranges)field.setValue(id in model.config?model.config[id]:params[id]);
  for(const {button,owner} of keyButtons.values())button.disabled=!model.activeIds.includes(owner);
  document.querySelectorAll('.rider-keyboard').forEach((group,i)=>group.classList.toggle('inactive',!model.activeIds.includes(i)));
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
      choice.append(...choices.map(id=>new Option(sonicSkin(params.skin).names[id],id)));choice.value=model.config[kind][i];
      choice.addEventListener('change',()=>{const values=[...model.config[kind]];values[i]=choice.value;model.apply({[kind]:values});});row.append(choice);
    }
    $('objectControls').append(row);objectRows.push({select,row});
  });syncObjectValues();
}
function syncObjectValues(){model.objects.forEach((o,i)=>{const r=objectRows[i];if(!r)return;const prop=presentProp(o.prop,params.skin);r.select.value=prop.id;r.select.title=`${prop.name} · ${prop.mass>=1?`${prop.mass} kg`:`${Math.round(prop.mass*1000)} g`}`;r.row.style.setProperty('--prop-color',prop.color);});}
for(const id of ['count','pattern','cast','phrase','passMode'])listen($(id),'change',()=>{
  const options={[id]:id==='count'?Number($(id).value):$(id).value};
  if(id==='pattern')options.phrase='loop';
  model.apply(options);
  if(id==='cast')releaseControls();syncSelectors();
});
listen($('autoRide'),'change',()=>model.apply({autoRide:$('autoRide').checked}));
listen($('skin'),'change',()=>{params.skin=skinFor($('skin').value).id;syncSelectors();});
listen($('lighting'),'change',()=>{params.lighting=LIGHTING_SCENES.find(scene=>scene.id===$('lighting').value)?.id??'house';});
listen($('postersButton'),'click',()=>model.apply({posterSeed:(model.posterSeed+1)>>>0}));
listen($('preset'),'change',()=>{
  const preset=PRESETS.find(p=>p.id===$('preset').value);if(!preset)return;
  model.apply({...preset.config,drums:preset.config.drums??DEFAULTS.drums,riffs:preset.config.riffs??DEFAULTS.riffs});
  releaseControls();syncSelectors();
});
listen($('randomButton'),'click',()=>{model.apply({propIds:Array.from({length:MAX_OBJECTS},()=>PROPS[Math.floor(model.random()*PROPS.length)].id)});syncObjects();});
listen($('resetButton'),'click',()=>{
  model.config={...PAGE_DEFAULTS,propIds:[...PAGE_DEFAULTS.propIds],drums:[...DEFAULTS.drums],riffs:[...DEFAULTS.riffs]};model.reset();Object.assign(params,soundDefaults);
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
function perform(action,owner){
  if(!model.activeIds.includes(owner))return;
  model.events=[];model[action](owner);handleEvents(model.events,(audio.context?.currentTime??0)+.01);
}
const keyLabels={fastLeft:'Fast ←',up:'High',fastRight:'Fast →',left:'←',down:'Low',right:'→',kick:'Kick',crowd:'To crowd'};
function refreshKey(code){const entry=keyButtons.get(code);if(!entry)return;const held=keys.has(code)||buttonKeys.has(code)||[...buttonPointers.values()].includes(code)||pulses.has(code);entry.button.classList.toggle('held',held);entry.button.setAttribute('aria-pressed',String(held));}
function pulseKey(code){
  if(pulses.has(code))clearTimeout(pulses.get(code));
  pulses.set(code,setTimeout(()=>{pulses.delete(code);refreshKey(code);},180));refreshKey(code);
}
function pressAction(code){
  const entry=keyButtons.get(code);if(!entry||!model.activeIds.includes(entry.owner))return;
  if(['left','right','fastLeft','fastRight'].includes(entry.action))targets[entry.owner]=null;
  if(entry.action==='kick')perform('kick',entry.owner);
  if(entry.action==='crowd')perform('throwToAudience',entry.owner);
}
RIDER_KEYS.forEach((cluster,owner)=>{
  const group=document.createElement('div');group.className='rider-keyboard';group.setAttribute('role','group');group.setAttribute('aria-label',`${RIDER_NAMES[owner]} keyboard controls`);
  const title=document.createElement('h2'),toggle=document.createElement('button');toggle.type='button';toggle.className='rider-toggle';toggle.dataset.rider=String(owner);toggle.id=`rider-${owner}`;
  toggle.setAttribute('aria-controls','stage');toggle.setAttribute('aria-keyshortcuts',String(owner+1));
  const shortcut=document.createElement('kbd');shortcut.textContent=String(owner+1);
  const name=document.createElement('span');name.textContent=RIDER_NAMES[owner];toggle.append(shortcut,name);
  listen(toggle,'click',()=>toggleRider(owner));riderToggles.push(toggle);title.append(toggle);group.append(title);
  const grid=document.createElement('div');grid.className='key-grid';
  for(const action of ['fastLeft','up','fastRight','left','down','right','kick','crowd']){
    const code=cluster[action],label=code.replace('Key','').replace('Numpad','');
    const button=document.createElement('button');button.type='button';button.dataset.key=code;button.dataset.action=action;
    button.id=`key-${code}`;button.setAttribute('aria-label',`${RIDER_NAMES[owner]} ${keyLabels[action]} (${code.startsWith('Numpad')?'numpad ':''}${label})`);button.setAttribute('aria-pressed','false');
    const key=document.createElement('kbd');key.textContent=code.startsWith('Numpad')?`#${label}`:label;
    const caption=document.createElement('span');caption.textContent=keyLabels[action];button.append(key,caption);
    if(owner===0&&action==='kick')button.dataset.midiTrigger='step';
    keyButtons.set(code,{button,owner,action});
    listen(button,'pointerdown',e=>{if(e.button!==0)return;e.preventDefault();buttonPointers.set(e.pointerId,code);buttonStarts.set(e.pointerId,performance.now());button.setPointerCapture(e.pointerId);pressAction(code);refreshKey(code);});
    const release=e=>{if(e.type==='pointerup'&&buttonPointers.has(e.pointerId)&&performance.now()-buttonStarts.get(e.pointerId)<150)pulseKey(code);buttonPointers.delete(e.pointerId);buttonStarts.delete(e.pointerId);refreshKey(code);};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(button,type,release);
    // Native keyboard/assistive clicks and a simple click get a short useful hold.
    listen(button,'keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!e.repeat)pressAction(code);buttonKeys.add(code);refreshKey(code);}});
    listen(button,'keyup',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();buttonKeys.delete(code);refreshKey(code);}});
    listen(button,'blur',()=>{buttonKeys.delete(code);refreshKey(code);});
    listen(button,'click',e=>{if(e.detail>0&&e.pointerType)return;pressAction(code);pulseKey(code);});
    grid.append(button);
  }
  group.append(grid);$('keyboardControls').append(group);
});
function controlTarget(e){return e.target?.closest('input,select,textarea,a,summary,[contenteditable=true],[role=slider],button:not([data-key])');}
listen(window,'keydown',e=>{
  if(controlTarget(e)||e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
  const toggleOwner=toggleKeys.indexOf(e.code);
  if(toggleOwner>=0){e.preventDefault();if(!e.repeat)toggleRider(toggleOwner);return;}
  if(!GAME_KEYS.has(e.code))return;
  e.preventDefault();if(!keys.has(e.code)&&!e.repeat)pressAction(e.code);keys.add(e.code);refreshKey(e.code);
});
listen(window,'keyup',e=>{keys.delete(e.code);refreshKey(e.code);});
function releaseControls(){
  keys.clear();targets.fill(null);pointers.clear();buttonPointers.clear();buttonStarts.clear();buttonKeys.clear();for(const timeout of pulses.values())clearTimeout(timeout);pulses.clear();
  for(const code of keyButtons.keys())refreshKey(code);
}
listen(window,'blur',releaseControls);
listen($('stage'),'pointerdown',e=>{
  if(e.button!==0)return;const x=renderer.worldX(e.clientX);
  const owner=model.activePlayers.reduce((nearest,p)=>Math.abs(x-p.x)<Math.abs(x-model.players[nearest].x)?p.id:nearest,model.activeIds[0]);
  pointers.set(e.pointerId,owner);$('stage').setPointerCapture(e.pointerId);targets[owner]=clamp(x,...model.playerBounds(owner));$('stage').focus({preventScroll:true});
});
listen($('stage'),'pointermove',e=>{if(pointers.has(e.pointerId)){const owner=pointers.get(e.pointerId);targets[owner]=clamp(renderer.worldX(e.clientX),...model.playerBounds(owner));}});
for(const type of ['pointerup','pointercancel','lostpointercapture'])listen($('stage'),type,e=>{const owner=pointers.get(e.pointerId);if(owner!==undefined)targets[owner]=null;pointers.delete(e.pointerId);});
listen(document,'visibilitychange',()=>{releaseControls();lastClock=clock();accumulator=0;updateAudio();});
// The independent fixed-step clock keeps manual riding and the audience alive
// while the transport gates only automatic juggling throws and its beat.
function tick(){
  if(disposed)return;
  const now=clock(),dt=clamp(now-lastClock,0,.1);lastClock=now;
  if(document.hidden){updateAudio();return;}
  accumulator+=dt;const events=[];
  const held=new Set([...keys,...buttonKeys,...buttonPointers.values(),...pulses.keys()]);
  while(accumulator>=1/120){events.push(...model.step(1/120,drivingControls(held,targets,model.activeIds),null,0,null,running));accumulator-=1/120;}
  params.tempo=model.config.tempo;handleEvents(events,(audio.context?.currentTime??0)+.035);updateAudio();
}
function handleEvents(events,audioTime){
  renderer.react(events,model.time,running);
  for(const e of events){
    audio.strike(e,params,audioTime-(model.time-e.time));
    if(e.kind==='replacement')syncObjectValues();
    if(['catch','kick','crowd-catch'].includes(e.kind)){
      const m=soundMapping(e.prop,e,params);
      window.dispatchEvent(new CustomEvent('morphazoid:midi-output-preview',{detail:{kind:'note',routeId:'puggler',source:'Juggling contact',sourceId:`puggler-${e.id}`,note:Math.round(69+12*Math.log2(m.frequency/440)),frequencyHz:m.frequency,velocity:Math.round(30+90*m.energy),durationMs:e.prop.decay*1000}}));
    }
  }
}
function draw(){if(disposed)return;if(!document.hidden)renderer.draw(model,params);frame=requestAnimationFrame(draw);}
function teardown(){if(disposed)return;disposed=true;releaseControls();clearInterval(timer);cancelAnimationFrame(frame);cleanups.forEach(fn=>fn());ranges.forEach(field=>field.destroy());renderer.dispose();void audio.close();}
listen(window,'pagehide',teardown,{once:true});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
syncSelectors();status();timer=setInterval(tick,20);frame=requestAnimationFrame(draw);
window.__puggler=Object.freeze({snapshot:()=>({skin:params.skin,lighting:params.lighting,riderNames:[...skinFor(params.skin).riders],time:model.time,running,audioOn:audio.on,x:model.x,beat:model.beat,pattern:model.pattern.id,count:model.objects.length,catches:model.catches,drops:model.drops,passes:model.passes,crowdCatches:model.crowdCatches,riders:model.riderCount,activeIds:[...model.activeIds],chaos:model.config.chaos,posterSeed:model.posterSeed,phrase:model.config.phrase,cast:model.config.cast,autoRide:model.config.autoRide,ridePattern:model.config.ridePattern,rideSpeed:model.config.rideSpeed,rideRange:model.config.rideRange,steeringTargets:[...targets],trails:params.trails,tempo:model.config.tempo,loft:model.config.loft,players:model.players.map(p=>({...p})),attacks:audio.attacks.size,sonics:audio.voices.filter(Boolean).map(v=>({slot:v.slot,key:v.key,skin:v.skin,speaker:v.speaker,role:v.role})),hitSounds:[...audio.attacks].map(v=>v.key),vocals:audio.voices.filter(v=>v?.character).map(v=>({slot:v.slot,character:v.character,speaker:v.speaker,role:v.role,startedAt:v.startedAt})),collage:renderer.collageStatus(),crowd:renderer.crowdSnapshot(model.time),pyro:renderer.pyroSnapshot(model.time),objects:model.objects.map(o=>({id:o.id,start:o.start,x:o.x,y:o.y,vx:o.vx,vy:o.vy,phase:o.phase,prop:o.prop.id,name:presentProp(o.prop,params.skin).name,owner:o.owner,fromOwner:o.fromOwner,voiceOwner:o.voiceOwner,drum:o.drum,riff:o.riff})),disposed})});
