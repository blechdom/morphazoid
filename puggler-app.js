import { PugglerModel, PROPS, PATTERNS, DEFAULTS, DRUMS, RIFFS, MAX_OBJECTS, RIDER_NAMES, parseNotation, clamp, soundMapping } from './src/puggler.js';
import { PugglerAudio } from './src/puggler-audio.js';
import { PugglerRenderer } from './src/puggler-renderer.js';
import { RIDER_KEYS, GAME_KEYS, drivingControls } from './src/puggler-controls.js';
import { createRangeField } from './src/ui/index.js';

const $ = id => document.getElementById(id);
const PAGE_DEFAULTS = { ...DEFAULTS, count:6, pattern:'many-6', tempo:360, loft:1.8, partner:'trio-auto', phrase:'verse', assist:42, chaos:40, propIds:['guitar','can','boot','vinyl','cassette','glowstick','skateboard','mic','mushroom','plushrat'] };
const model = new PugglerModel(PAGE_DEFAULTS), audio = new PugglerAudio(), renderer = new PugglerRenderer($('stage'));
const soundDefaults = { level:.48, height:.65, stereo:1, motion:6, flight:.8, impacts:1.25, grit:.82, decay:1, boo:.75, trails:true, guides:true, tempo:360 };
const params = { ...soundDefaults };
let running = true, starting = false, disposed = false, frame = 0, timer = 0, lastClock = performance.now() / 1000, accumulator = 0;
let lastUi = 0, selectedPlayer = 0, eventHoldUntil = 0;
const targets=[null,null,null], pointers=new Map();
const heldButtons = new Set();
const keys = new Set(), cleanups = [], ranges = new Map(), meters = [], objectRows=[];
const listen = (element, type, handler, options) => { element.addEventListener(type, handler, options); cleanups.push(() => element.removeEventListener(type, handler, options)); };
const percent = v => `${Math.round(v * 100)}%`;
const presets = {
  ballet: { ...PAGE_DEFAULTS },
  bell: { count:1, pattern:'single', propIds:['bell',...DEFAULTS.propIds.slice(1)], tempo:240, partner:'solo', phrase:'evolve', loft:2, chaos:15 },
  metal: { count:10, pattern:'many-10', propIds:['guitar','boot','can','mic','vinyl','cassette','skateboard','cone','brick','plushrat'], tempo:1200, partner:'trio-auto', phrase:'evolve', loft:2.5, chaos:25 },
  float: { count:4, pattern:'fountain', propIds:['guitar','duck','boot','glowstick',...DEFAULTS.propIds.slice(4)], tempo:420, partner:'manual', phrase:'verse', loft:1.8, chaos:30 },
  rave: {count:8,pattern:'many-8',propIds:['glowstick','mushroom','vinyl','cassette','cone','plushrat','mic','bottle','guitar','boot'],tempo:720,partner:'trio-auto',phrase:'evolve',loft:2.2,chaos:30},
};
function status() {
  $('playButton').textContent = running ? 'Pause' : 'Play'; $('playButton').setAttribute('aria-pressed', String(running));
  $('motionStatus').textContent = running ? 'THE SHOW IS ROLLING' : 'HOLD THAT THOUGHT';
  $('liveStatus').textContent = !audio.on && running ? 'Audio is off — turn it on to hear playback' : audio.on ? 'Hands hit the drums. Air plays the riffs. Drops get booed.' : 'Ready. Enable Audio when you want to listen.';
}
function togglePlay() { running = !running; accumulator = 0; lastClock = clock(); audio.update(model.objects, params, running); status(); }
function clock() { return audio.on && audio.context?.state === 'running' ? audio.context.currentTime : performance.now() / 1000; }
function addRange(container, id, label, min, max, step, value, formatter, destination) {
  const field = createRangeField({ id, label, min, max, step, value, formatValue: formatter,
    onInput: v => { if(destination==='model')model.apply({ [id]: v });else params[id]=v; } });
  $(container).append(field); ranges.set(id, field);
}
addRange('motionControls','tempo','Juggling speed',100,1200,1,PAGE_DEFAULTS.tempo,v=>`${v} beats/min`,'model');
addRange('motionControls','loft','Throw height',.6,3,.05,1.8,v=>`${v.toFixed(2)}×`,'model');
addRange('motionControls','assist','Catch reach',20,120,1,PAGE_DEFAULTS.assist,v=>v<40?'Precise':v>85?'Extra forgiving':'Forgiving','model');
addRange('motionControls','chaos','Throw wildness',0,100,1,PAGE_DEFAULTS.chaos,v=>v===0?'Precise':`${v}%`,'model');
addRange('soundControls','flight','Airborne riffs',0,1,.01,params.flight,percent);
addRange('soundControls','impacts','Catch drums',0,2,.01,params.impacts,percent);
addRange('soundControls','boo','Crowd boos',0,1,.01,params.boo,percent);
addRange('soundControls','height','Height → pitch',0,1.5,.01,.65,v=>`${v.toFixed(2)}×`);
addRange('soundControls','stereo','Stereo width',0,1,.01,1,percent);
addRange('soundControls','grit','Amp filth',0,1,.01,params.grit,percent);
addRange('physicsControls','gravity','Gravity',.45,1.65,.01,1,v=>`${v.toFixed(2)}×`,'model');
addRange('physicsControls','wind','Crosswind',-12,12,.1,0,v=>`${v>0?'+':''}${v.toFixed(1)}`,'model');
addRange('physicsControls','motion','Speed → brightness',0,12,.1,params.motion,v=>`${v.toFixed(1)}×`);
addRange('physicsControls','decay','Drum tail',.2,1,.05,1,v=>v===1?'Full':`${Math.round(v*100)}%`);

const patternNotation = p => p.count>4 ? (p.sync?`(${p.values[0]}, ${p.values[0]})`:p.values.join(' · ')) : p.notation;
function syncSelectors() {
  $('count').value=String(model.config.count);$('mode').value=model.config.mode;
  for(const id of ['partner','phrase','passMode'])$(id).value=model.config[id];
  $('passMode').disabled=model.config.partner==='solo';
  $('pattern').disabled=model.config.phrase!=='loop';
  selectedPlayer=Math.min(selectedPlayer,model.riderCount-1);
  $('playerPicker').replaceChildren(...model.activePlayers.map(p=>new Option(`${p.id+1} · ${RIDER_NAMES[p.id]}`,String(p.id))));
  $('playerPicker').value=String(selectedPlayer);
  $('pattern').replaceChildren(...PATTERNS.filter(p=>p.count===model.config.count).map(p=>new Option(`${p.name} · ${patternNotation(p)}`,p.id)));
  $('pattern').value=model.pattern.id;
  const notes={cascade:'Inside throws, outside catches. Alternate hands.',reverse:'Outside throws, inside catches. Arcs turn inside out.',columns:'Two separate columns; alternate their throws.', 'sync-columns':'Both hands throw together into separate columns.'};
  $('patternNote').textContent=model.config.phrase==='loop'?(notes[model.pattern.id]??`${patternNotation(model.pattern)} · ${model.pattern.sync?'Both hands together, every two beats.':'Odd throws cross hands; even throws return. T means toss.'}`):model.config.phrase==='verse'?'16 beats: verse → fill → break → refrain. Rest and hold beats leave musical gaps.':'A changing set of compatible juggling phrases, with bursts, gaps, and a return to the beat.';
  $('stageBadge').textContent=`${model.config.count} OBJECTS / ${RIDER_NAMES.slice(0,model.riderCount).join(' + ').toUpperCase()}`;
  for(const [id,field] of ranges)field.setValue(id in model.config?model.config[id]:params[id]);
  syncObjects();
}
function syncObjects() {
  $('objectControls').replaceChildren();$('voiceMeters').replaceChildren();meters.length=0;objectRows.length=0;
  model.objects.forEach((o,i)=>{
    const card=document.createElement('div');card.className='object-card';
    const row=document.createElement('div');row.className='object-row';row.style.setProperty('--prop-color',o.prop.color);
    const dot=document.createElement('i');dot.setAttribute('aria-hidden','true');
    const select=document.createElement('select');select.id=`object${i}`;select.setAttribute('aria-label',`Sound object ${i+1}`);
    select.append(...PROPS.map(p=>new Option(p.name,p.id)));select.value=o.prop.id;
    const mass=document.createElement('output');mass.htmlFor=select.id;mass.textContent=o.prop.mass>=1?`${o.prop.mass} kg`:`${Math.round(o.prop.mass*1000)} g`;
    select.addEventListener('change',()=>{const ids=[...model.config.propIds];ids[i]=select.value;model.apply({propIds:ids});syncObjectValues();});row.append(dot,select,mass);card.append(row);
    const roles=document.createElement('div');roles.className='object-roles';
    for(const [kind,choices,title] of [['drums',DRUMS,'Catch'],['riffs',RIFFS,'Air']]){
      const label=document.createElement('label');label.textContent=title;
      const choice=document.createElement('select');choice.id=`${kind}${i}`;choice.setAttribute('aria-label',`${title} sound for object ${i+1}`);
      choice.append(...choices.map(id=>new Option(({guitar:'Guitar riff',bass:'Bass riff',oi:'Oi oi oi',woo:'Woooo',kick:'Kick drum',snare:'Snare',crash:'Crash cymbal',tom:'Floor tom',hat:'Hi-hat'})[id],id)));choice.value=model.config[kind][i];
      choice.addEventListener('change',()=>{const values=[...model.config[kind]];values[i]=choice.value;model.apply({[kind]:values});});label.append(choice);roles.append(label);
    }
    card.append(roles);$('objectControls').append(card);
    const meter=document.createElement('div');meter.className='puggler-voice';meter.style.setProperty('--prop-color',o.prop.color);
    const name=document.createElement('b');name.textContent=`${String(i+1).padStart(2,'0')} / ${o.prop.name.toUpperCase()}`;
    const readout=document.createElement('small'),bar=document.createElement('meter');bar.min=0;bar.max=1;bar.value=0;bar.setAttribute('aria-label',`${o.prop.name} motion energy`);meter.append(name,readout,bar);$('voiceMeters').append(meter);meters.push({readout,bar,name,meter});objectRows.push({select,mass,row});
  });
}
function syncObjectValues(){model.objects.forEach((o,i)=>{const r=objectRows[i],m=meters[i];if(!r)return;r.select.value=o.prop.id;r.mass.value=o.prop.mass>=1?`${o.prop.mass} kg`:`${Math.round(o.prop.mass*1000)} g`;r.row.style.setProperty('--prop-color',o.prop.color);m.name.textContent=`${String(i+1).padStart(2,'0')} / ${o.prop.name.toUpperCase()}`;m.meter.style.setProperty('--prop-color',o.prop.color);m.bar.setAttribute('aria-label',`${o.prop.name} motion energy`);});}
listen($('count'),'change',()=>{model.apply({count:Number($('count').value)});syncSelectors();});
listen($('pattern'),'change',()=>{model.apply({pattern:$('pattern').value});syncSelectors();});
listen($('mode'),'change',()=>model.apply({mode:$('mode').value}));
for(const id of ['partner','phrase','passMode'])listen($(id),'change',()=>{model.apply({[id]:$(id).value});releaseControls();syncSelectors();});
listen($('playerPicker'),'change',()=>selectRider(Number($('playerPicker').value)));
listen($('postersButton'),'click',()=>model.apply({posterSeed:(model.posterSeed+1)>>>0}));
listen($('preset'),'change',()=>{model.apply(presets[$('preset').value]);syncSelectors();});
listen($('randomButton'),'click',()=>{model.apply({propIds:Array.from({length:MAX_OBJECTS},()=>PROPS[Math.floor(model.random()*PROPS.length)].id)});syncObjects();});
listen($('resetButton'),'click',()=>{
  const keptMode=model.config.mode;
  model.config={...PAGE_DEFAULTS,mode:keptMode,propIds:[...PAGE_DEFAULTS.propIds],drums:[...DEFAULTS.drums],riffs:[...DEFAULTS.riffs]};model.reset();Object.assign(params,soundDefaults);
  $('level').value=params.level;$('levelOut').value=percent(params.level);$('preset').value='ballet';$('trails').checked=true;$('guides').checked=true;
  releaseControls();selectedPlayer=0;accumulator=0;eventHoldUntil=0;syncSelectors();status();
});
listen($('playButton'),'click',togglePlay);
listen($('level'),'input',()=>{params.level=Number($('level').value);$('levelOut').value=percent(params.level);audio.update(model.objects,params,running);});
for(const id of ['trails','guides'])listen($(id),'change',()=>params[id]=$(id).checked);
listen($('audioButton'),'click',async()=>{
  if(starting||disposed)return;
  if(audio.on){audio.mute();$('audioButton').setAttribute('aria-pressed','false');$('audioState').textContent='off';lastClock=clock();status();return;}
  starting=true;$('audioButton').disabled=true;$('audioState').textContent='starting';$('audioError').hidden=true;
  try { await audio.arm();if(disposed)return;$('audioButton').setAttribute('aria-pressed','true');$('audioState').textContent='on';audio.update(model.objects,params,running); }
  catch(error){audio.mute();$('audioState').textContent='off';$('audioError').textContent=`Audio could not start: ${error.message}`;$('audioError').hidden=false;}
  finally { starting=false;if(!disposed){$('audioButton').disabled=false;lastClock=clock();status();} }
});
function perform(action,owner=selectedPlayer) {
  if(!running||owner>=model.riderCount)return;
  model.events=[];model[action](owner);handleEvents(model.events,(audio.context?.currentTime??0)+.01);
}
listen($('kickButton'),'click',()=>perform('kick'));
listen($('crowdButton'),'click',()=>perform('throwToAudience'));
function selectRider(owner) {
  if(owner>=model.riderCount)return;
  releaseControls();selectedPlayer=owner;$('playerPicker').value=String(owner);
}
function controlTarget(e) { return e.target?.closest('input,select,textarea,button,a,summary,[contenteditable=true],[role=slider]'); }
listen(window,'keydown',e=>{
  if(controlTarget(e)||e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
  if(['Digit1','Digit2','Digit3'].includes(e.code)){e.preventDefault();if(!e.repeat)selectRider(Number(e.code.at(-1))-1);return;}
  if(!GAME_KEYS.has(e.code))return;
  e.preventDefault();keys.add(e.code);
  for(let group=0;group<RIDER_KEYS.length;group++){
    const owner=group===0?selectedPlayer:group;if(owner>=model.riderCount)continue;
    const k=RIDER_KEYS[group];
    if([k.left,k.right,k.fastLeft,k.fastRight].includes(e.code))targets[owner]=null;
    if(!e.repeat&&e.code===k.kick)perform('kick',owner);
    if(!e.repeat&&e.code===k.crowd)perform('throwToAudience',owner);
  }
});
listen(window,'keyup',e=>keys.delete(e.code));
function releaseControls() {
  keys.clear();targets.fill(null);pointers.clear();heldButtons.clear();
  document.querySelectorAll('.puggler-playbar .held').forEach(button=>button.classList.remove('held'));
}
listen(window,'blur',releaseControls);
for(const [id,key]of [['leftButton','left'],['rightButton','right'],['fastLeftButton','fastLeft'],['fastRightButton','fastRight'],['higherButton','up'],['lowerButton','down']]){
  const button=$(id);
  const press=()=>{heldButtons.add(key);targets[selectedPlayer]=null;button.classList.add('held');};
  const release=()=>{heldButtons.delete(key);button.classList.remove('held');};
  listen(button,'pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);press();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(button,type,release);
  listen(button,'keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();press();}});
  listen(button,'keyup',release);
}
listen($('stage'),'pointerdown',e=>{
  if(e.button!==0)return;const x=renderer.worldX(e.clientX);
  const owner=model.activePlayers.reduce((nearest,p)=>Math.abs(x-p.x)<Math.abs(x-model.players[nearest].x)?p.id:nearest,0);
  pointers.set(e.pointerId,owner);$('stage').setPointerCapture(e.pointerId);
  targets[owner]=clamp(x,...model.playerBounds(owner));$('stage').focus({preventScroll:true});
});
listen($('stage'),'pointermove',e=>{if(pointers.has(e.pointerId)){const owner=pointers.get(e.pointerId);targets[owner]=clamp(renderer.worldX(e.clientX),...model.playerBounds(owner));}});
for(const type of ['pointerup','pointercancel','lostpointercapture'])listen($('stage'),type,e=>{const owner=pointers.get(e.pointerId);if(owner!==undefined)targets[owner]=null;pointers.delete(e.pointerId);});
listen(document,'visibilitychange',()=>{releaseControls();lastClock=clock();accumulator=0;audio.update(model.objects,params,running&&!document.hidden);});

// Fixed-step model and musical events run on an independent timer. Once armed,
// AudioContext.currentTime is the clock; rAF only paints its resulting state.
function tick() {
  if(disposed)return;
  const now=clock(),dt=clamp(now-lastClock,0,.1);lastClock=now;
  if(!running||document.hidden){audio.update(model.objects,params,false);return;}
  accumulator+=dt;
  const events=[];
  while(accumulator>=1/120){events.push(...model.step(1/120,drivingControls(keys,selectedPlayer,targets,heldButtons,model.riderCount)));accumulator-=1/120;}
  params.tempo=model.config.tempo;
  const audioTime=audio.context?.currentTime??0;
  handleEvents(events,audioTime+.035);
  audio.update(model.objects,params,true);
}
function handleEvents(events,audioTime) {
  for(const e of events){
    audio.strike(e,params,audioTime-(model.time-e.time));
    if(e.kind==='replacement')syncObjectValues();
    const notable=['drop','replacement','crowd-throw','crowd-catch'].includes(e.kind);
    if(e.kind!=='throw'&&(notable||model.time>eventHoldUntil)){
      $('stageEvent').textContent=e.kind==='drop'?'BOOOOO! / FRONT ROW, HELP!':e.kind==='replacement'?`AUDIENCE LOBS A ${e.prop.name.toUpperCase()}`:e.kind==='crowd-throw'?`${RIDER_NAMES[e.owner].toUpperCase()} → THE PIT!`:e.kind==='crowd-catch'?'THE CROWD CAUGHT IT!':e.kind==='tower'?'EIGHT HIGH! +800':e.kind==='hat'?'HAT CATCH +50':`${RIDER_NAMES[e.owner].toUpperCase()} / ${e.kind==='catch'?e.drum?.toUpperCase()??'CATCH':e.kind.toUpperCase()}`;
      if(notable)eventHoldUntil=model.time+1.5;
    }
    if(['catch','hat','tower','kick','crowd-catch'].includes(e.kind)){
      const m=soundMapping(e.prop,e,params);
      window.dispatchEvent(new CustomEvent('morphazoid:midi-output-preview',{detail:{kind:'note',routeId:'puggler',source:'Juggling contact',sourceId:`puggler-${e.id}`,note:Math.round(69+12*Math.log2(m.frequency/440)),frequencyHz:m.frequency,velocity:Math.round(30+90*m.energy),durationMs:e.prop.decay*1000}}));
    }
  }
}
function draw(now) {
  if(disposed)return;
  if(!document.hidden){renderer.draw(model,params);if(now-lastUi>100){
    lastUi=now;
    for(const [id,value] of [['catchCount',model.catches],['comboCount',model.combo],['dropCount',model.drops],['scoreCount',model.score],['stackCount',`${model.stack.length} / 8`],['passCount',model.passes],['crowdCount',model.crowdCatches]])$(id).value=String(value);
    const preview=model.config.phrase==='loop'?model.pattern.values:parseNotation(model.rhythmPreview);
    $('phraseReadout').textContent=`${model.config.phrase==='loop'?model.pattern.name:model.currentPhrase} / ${preview.join(' · ')}`;
    $('riderReadout').value=`${RIDER_NAMES[selectedPlayer]} · throw ${model.players[selectedPlayer].loft.toFixed(2)}×${model.players[selectedPlayer].crowdQueued?' · crowd throw queued':''}`;
    const phraseBeat=model.config.phrase==='evolve'?Math.floor(model.beat)-model.phraseStart:Math.floor(model.beat);
    [...$('phraseSteps').children].forEach((step,i)=>{step.textContent=preview[i%preview.length]??'·';step.classList.toggle('active',i===((phraseBeat%16)+16)%16);});
    model.objects.forEach((o,i)=>{const m=soundMapping(o.prop,o,params);if(!meters[i])return;meters[i].readout.textContent=`${RIDER_NAMES[o.owner].toUpperCase()} · ${o.phase==='held'?o.drum.toUpperCase():o.phase==='waiting'?'NEXT OBJECT…':o.riff.toUpperCase()}`;meters[i].bar.value=['air','replacement','audience'].includes(o.phase)?m.energy:0;});
  }}
  frame=requestAnimationFrame(draw);
}
function teardown() {
  if(disposed)return;disposed=true;clearInterval(timer);cancelAnimationFrame(frame);cleanups.forEach(fn=>fn());ranges.forEach(field=>field.destroy());void audio.close();
}
listen(window,'pagehide',teardown,{once:true});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
$('phraseSteps').replaceChildren(...Array.from({length:16},()=>{const span=document.createElement('span');span.textContent='·';return span;}));
syncSelectors();status();timer=setInterval(tick,20);frame=requestAnimationFrame(draw);
// Read-only diagnostics support deterministic browser checks without extra UI.
window.__puggler = Object.freeze({ snapshot:()=>({ time:model.time,running,audioOn:audio.on,x:model.x,beat:model.beat,pattern:model.pattern.id,count:model.objects.length,catches:model.catches,drops:model.drops,passes:model.passes,crowdCatches:model.crowdCatches,riders:model.riderCount,selectedPlayer,chaos:model.config.chaos,posterSeed:model.posterSeed,phrase:model.config.phrase,partner:model.config.partner,tempo:model.config.tempo,loft:model.config.loft,players:model.players.map(p=>({...p})),stack:model.stack.length,attacks:audio.attacks.size,objects:model.objects.map(o=>({id:o.id,x:o.x,y:o.y,vx:o.vx,vy:o.vy,phase:o.phase,prop:o.prop.id,owner:o.owner,drum:o.drum,riff:o.riff})),disposed }) });
