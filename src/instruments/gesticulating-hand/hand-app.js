import { createHandViewer, FINGER_COLORS } from './hand-viewer.js';
import { FINGERS, VOICE_SOURCES, HAND_DEFAULTS, HAND_LIMITS, HAND_POSES, HAND_MOTIONS, HAND_PRESETS, TREMOR_FINGERS, TREMOR_JOINTS, HAND_SKINS, HAND_LIGHTINGS,
  normalizeHandConfig, evaluateHandPose, randomizeHandConfig, handMotionPeriod } from './hand-model.js';
import { HandAudio } from './hand-audio.js';
import { registerHeaderPresets } from '../../site/header-presets.js';

const el = id => document.getElementById(id);
const abort = new AbortController();
const listen = (node, type, callback) => node.addEventListener(type, callback, { signal: abort.signal });
const labels = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const state = {
  config: normalizeHandConfig(HAND_DEFAULTS), selected: 1, joint: 'mcp',
  playing: false, soundPlaying: false, audioOn: false, starting: false,
  phase: 0, tremorOffset: 0, epoch: performance.now(), pointerMask: 0, midi: new Map(),
  loaded: false, disposed: false, linked: true,
};
const audio = new HandAudio();
let viewer, frame = 0, lastDraw = -Infinity, presets, audioRequest = 0, jointAbort;
const sourceId = source => typeof source === 'string' ? source : source.id;
const sourceLabel = source => typeof source === 'string' ? source[0].toUpperCase() + source.slice(1) : source.label;
const clamp = (v, low, high) => Math.max(low, Math.min(high, Number(v) || 0));
const clone = value => structuredClone(value);
const root = document.documentElement;
let headerHeight=-1, stickyOffset=-1;
function measureHandLayout() {
  const header=document.querySelector('.masthead').getBoundingClientRect().height;
  const offset=header+el('handStage').getBoundingClientRect().height;
  if(header!==headerHeight){headerHeight=header;root.style.setProperty('--hand-header-height',`${header}px`);}
  if(offset!==stickyOffset){stickyOffset=offset;root.style.setProperty('--hand-sticky-offset',`${offset}px`);}
}
const layoutObserver=new ResizeObserver(measureHandLayout);
layoutObserver.observe(document.querySelector('.masthead'));layoutObserver.observe(el('handStage'));
measureHandLayout();
function syncViewButtons() {
  const current=state.config.view;
  if(!current)return;
  for(const button of document.querySelectorAll('[data-view]')) {
    const yaw={palm:.12,back:-Math.PI+.12,side:Math.PI/2}[button.dataset.view];
    button.setAttribute('aria-pressed',String(Math.abs(current.yaw-yaw)<.001&&Math.abs(current.pitch-.035)<.001));
  }
}

function currentTime() {
  if (state.audioOn && audio.running) return audio.getMotionTime();
  return state.phase + (state.playing ? (performance.now() - state.epoch) / 1000 : 0);
}
function anchor(time = currentTime()) { state.phase = time; state.epoch = performance.now(); }
function notify(message = '') { el('liveStatus').textContent = message; }
function transportNotice() {
  notify(!state.audioOn && (state.playing || state.soundPlaying)
    ? 'Audio is off — turn it on to hear playback' : '');
}
function syncTransport() {
  el('audioButton').setAttribute('aria-pressed', String(state.audioOn));
  el('audioState').textContent = state.starting ? 'starting' : state.audioOn ? 'on' : 'off';
  for (const [id, active, label] of [['soundPlayButton', state.soundPlaying, 'Sound'], ['motionButton', state.playing, 'Motion']]) {
    el(id).setAttribute('aria-pressed', String(active));
    el(id).innerHTML = `<span aria-hidden="true">${active ? 'Ⅱ' : '▶'}</span> ${label}`;
    el(id).setAttribute('aria-label', `${active ? 'Pause' : 'Play'} ${label.toLowerCase()}`);
  }
  transportNotice();
}
function midiMask() { let mask = 0; for (const note of state.midi.values()) mask |= 1 << note.finger; return mask; }
function syncHeld() { audio.setHeldFingers(state.pointerMask | midiMask()); }
function performanceConfig() {
  if (!state.midi.size) return state.config;
  const config = clone(state.config);
  for (const note of state.midi.values()) {
    const finger = config.pose.fingers[note.finger];
    finger.mcp = Math.max(finger.mcp, 18 + note.velocity * 42);
    finger.pip = Math.max(finger.pip, 16 + note.velocity * 58);
    finger.dip = Math.max(finger.dip, 12 + note.velocity * 42);
  }
  return normalizeHandConfig(config);
}
function publish() {
  state.config = normalizeHandConfig(state.config);
  audio.setConfig(performanceConfig()); presets?.refresh(); requestDraw();
}
function setPlaying(playing) {
  anchor(); state.playing = Boolean(playing);
  audio.setTransport({ time: state.phase, tremorOffset: state.tremorOffset, playing: state.playing });
  syncTransport(); requestDraw();
}
function setSoundPlaying(playing) {
  state.soundPlaying = Boolean(playing); audio.setSoundPlaying(state.soundPlaying);
  syncTransport(); requestDraw();
}
async function setAudio(active) {
  const request = ++audioRequest;
  anchor();
  if (!active) {
    state.audioOn = state.starting = false; audio.mute(); syncTransport(); requestDraw(); return;
  }
  state.starting = true; syncTransport();
  try {
    const pending = audio.arm(); // Unlock directly in the explicit Audio/MIDI gesture.
    const armed = await pending;
    if (state.disposed || request !== audioRequest || armed === false) return;
    const time = currentTime();
    state.audioOn = true; state.starting = false;
    audio.setConfig(performanceConfig()); audio.setTransport({ time, tremorOffset: state.tremorOffset, playing: state.playing });
    audio.setSoundPlaying(state.soundPlaying); syncHeld(); anchor(time);
    syncTransport(); requestDraw();
  } catch (error) {
    if (request !== audioRequest || state.disposed) return;
    state.audioOn = state.starting = false; syncTransport();
    notify(`Audio could not start: ${error.message}`);
  }
}
function requestDraw() { if (!frame && !state.disposed) frame = requestAnimationFrame(draw); }
function effectivePose(time) {
  return evaluateHandPose(performanceConfig(), time, undefined, time + state.tremorOffset);
}
function draw(now) {
  frame = 0;
  if (state.disposed) return;
  if (now - lastDraw >= 1000 / 40 || !state.playing) {
    viewer?.setPose(effectivePose(currentTime())); viewer?.render(); lastDraw = now;
  }
  if (state.playing) requestDraw();
}
function selectFinger(index, joint = state.joint) {
  state.selected = clamp(index, 0, 4); state.joint = ['mcp', 'pip', 'dip', 'spread'].includes(joint) ? joint : 'mcp';
  for (const node of document.querySelectorAll('button[data-finger]')) node.setAttribute('aria-pressed', String(Number(node.dataset.finger) === state.selected));
  const jointName = state.selected === 0 ? { mcp: 'base', pip: 'knuckle', dip: 'tip', spread: 'opposition' } : { mcp: 'knuckle', pip: 'middle joint', dip: 'tip', spread: 'spread' };
  el('selectionReadout').textContent = `${labels[state.selected]} · ${jointName[state.joint]}`;
  viewer?.selectFinger(state.selected, state.joint); buildJointControls(); requestDraw();
}
function jointLimits(index, joint) {
  return (index === 0 ? HAND_LIMITS.thumb : HAND_LIMITS.finger)[joint];
}
function buildJointControls() {
  if (el('jointControls').dataset.finger === String(state.selected)) {
    for (const key of ['mcp','pip','dip','spread']) {
      el('joint-'+key).value=state.config.pose.fingers[state.selected][key];
      el('joint-'+key+'Out').value=Math.round(state.config.pose.fingers[state.selected][key])+'°';
    }
    return;
  }
  jointAbort?.abort();jointAbort=new AbortController();
  el('jointControls').dataset.finger=String(state.selected);
  el('jointControls').replaceChildren();
  const names = state.selected === 0 ? ['Base bend', 'Knuckle bend', 'Tip bend', 'Opposition'] : ['Knuckle bend', 'Middle joint', 'Tip joint', 'Spread'];
  for (const [n, key] of ['mcp','pip','dip','spread'].entries()) {
    const [min,max] = jointLimits(state.selected,key), id = `joint-${key}`;
    const label = document.createElement('label'); label.className = 'hand-control'; label.htmlFor = id;
    label.innerHTML = `<span>${names[n]} <output id="${id}Out" for="${id}">${Math.round(state.config.pose.fingers[state.selected][key])}°</output></span><input id="${id}" type="range" min="${min}" max="${max}" step="1" value="${state.config.pose.fingers[state.selected][key]}" />`;
    el('jointControls').append(label);
    label.querySelector('input').addEventListener('input',event => {
      state.config.pose.fingers[state.selected][key] = Number(event.target.value);
      state.joint = key; el(`${id}Out`).value = `${Math.round(Number(event.target.value))}°`;
      audio.auditionFinger(state.selected,.22); publish();
    }, {signal:jointAbort.signal});
  }
}
function syncControls() {
  const controls = { tremorAmount: state.config.tremor.amount, tremorRate: state.config.tremor.rate, speed: state.config.motion.speed, tempo: state.config.motion.tempo, motionAmount: state.config.motion.amount,
    wristFlex: state.config.pose.wrist.flex, wristSide: state.config.pose.wrist.side, wristTwist: state.config.pose.wrist.twist,
    ...state.config.sound };
  for (const [id,value] of Object.entries(controls)) {
    if (!el(id)) continue;
    el(id).value = value; updateOutput(id, value);
  }
  el('motionPreset').value = state.config.motion.id;
  el('tremorFinger').value=state.config.tremor.finger;el('tremorJoint').value=state.config.tremor.joint;
  el('tremorFinger').disabled=state.config.tremor.joint==='wrist';
  el('skin').value=state.config.appearance.skin;el('lighting').value=state.config.appearance.lighting;
  el('posePreset').value = HAND_POSES.find(p=>JSON.stringify(p.pose)===JSON.stringify(state.config.pose))?.id??'custom';
  for (let i=0;i<5;i++) {
    const voice = state.config.voices[i];
    el(`source-${i}`).value = voice.source; el(`voice-level-${i}`).value = voice.level;
    el(`mute-${i}`).setAttribute('aria-pressed',String(voice.mute));
    el(`solo-${i}`).setAttribute('aria-pressed',String(voice.solo));
  }
  buildJointControls();syncViewButtons();
}
function updateOutput(id,value) {
  if (!el(`${id}Out`)) return;
  el(`${id}Out`).value = id.startsWith('wrist') ? `${Math.round(value)}°`
    : id === 'tremorAmount' ? `${Number(value.toFixed(1))}°`
    : id === 'tremorRate' ? `${Number(value.toFixed(1))} Hz` : id === 'speed' ? `${Number(value.toFixed(2))}×` : id === 'tempo' ? String(Math.round(value)) : id === 'rootHz' ? `${Math.round(value)} Hz`
    : ['attack','release'].includes(id) ? `${Math.round(value*1000)} ms` : `${Math.round(value*100)}%`;
}
function applyConfiguration(value) {
  const next = normalizeHandConfig(value);
  // Rebase seconds to preserve the cycle position when tempo, speed or cycle
  // length changes. The audio worklet and silent viewer receive one anchor.
  const previousTime = currentTime();
  const time = previousTime * handMotionPeriod(next.motion) / handMotionPeriod(state.config.motion);
  // Tremor runs in real Hz. Retain its phase independently when choreography
  // seconds are rebased, including while paused and when its own rate changes.
  state.tremorOffset = (previousTime + state.tremorOffset) * state.config.tremor.rate / next.tremor.rate - time;
  state.config = next; anchor(time); viewer?.setCameraView(next.view); viewer?.setAppearance(next.appearance); publish();
  audio.setTransport({ time, tremorOffset: state.tremorOffset, playing: state.playing }); syncControls();
}
function updateConfiguration(mutator) {
  const next = clone(state.config); mutator(next); applyConfiguration(next);
}
function editJoint({ finger, joint, bend, spread, start, end }) {
  if (start) {
    if(finger<5)selectFinger(finger,joint);else el('selectionReadout').textContent='Wrist';
    state.pointerMask = finger < 5 ? 1<<finger : 31; syncHeld();
  }
  if (end) { state.pointerMask = 0; syncHeld(); return; }
  if (finger === 5) {
    state.config.pose.wrist.flex += bend; state.config.pose.wrist.twist += spread;
  } else {
    const digit = state.config.pose.fingers[finger]; digit[joint] += bend;
    digit.spread += spread;
    if (state.linked && joint === 'mcp') { digit.pip += bend * .85; digit.dip += bend * .55; }
  }
  if (state.pointerMask && (bend || spread)) {
    // Direct edits have no automatic-motion derivative. Excite the changed
    // finger explicitly so a sustained drag can keep ringing Metal voices.
    if (finger < 5) audio.auditionFinger(finger, .15);
    else for (let i = 0; i < 5; i++) audio.auditionFinger(i, .15);
  }
  publish(); syncControls();
}
function buildMixer() {
  for (let i=0;i<5;i++) {
    const tab = document.createElement('button'); tab.type='button'; tab.dataset.finger=i;
    tab.style.setProperty('--finger-color',FINGER_COLORS[i]); tab.textContent=labels[i];
    listen(tab,'click',()=>selectFinger(i)); el('fingerTabs').append(tab);
    const row = document.createElement('div'); row.className='hand-voice'; row.style.setProperty('--finger-color',FINGER_COLORS[i]);
    row.innerHTML = `<button type="button" class="hand-voice-name" data-finger="${i}" aria-pressed="false">${labels[i]}</button><select id="source-${i}" aria-label="${labels[i]} sound"></select><label for="voice-level-${i}"><span class="sr-only">${labels[i]} level</span><input id="voice-level-${i}" type="range" min="0" max="1" step="0.01" value="0.6" /></label><div class="hand-mix-actions"><button type="button" id="mute-${i}" aria-label="Mute ${labels[i].toLowerCase()}" aria-pressed="false">Mute</button><button type="button" id="solo-${i}" aria-label="Solo ${labels[i].toLowerCase()}" aria-pressed="false">Solo</button></div>`;
    el('fingerMixer').append(row);
    for (const source of VOICE_SOURCES) el(`source-${i}`).add(new Option(sourceLabel(source),sourceId(source)));
    listen(row.querySelector('[data-finger]'),'click',()=>selectFinger(i));
    listen(el(`source-${i}`),'change',event=>updateConfiguration(c=>{c.voices[i].source=event.target.value;}));
    listen(el(`voice-level-${i}`),'input',event=>updateConfiguration(c=>{c.voices[i].level=Number(event.target.value);}));
    for (const key of ['mute','solo']) listen(el(`${key}-${i}`),'click',()=>updateConfiguration(c=>{c.voices[i][key]=!c.voices[i][key];}));
  }
}
function reset() {
  // Recovery resets musical state; output and both players remain under their controls.
  state.midi.clear(); state.pointerMask=0;
  syncHeld(); applyConfiguration(HAND_DEFAULTS); selectFinger(1,'mcp');
}
function releaseNotes() { state.midi.clear(); state.pointerMask=0; audio.setConfig(state.config); syncHeld(); requestDraw(); }
function midiKey(message) { return `${message.sourceId??'midi'}:${message.channel??0}:${message.note}`; }
function onMidi(event) {
  const {message,routeId} = event.detail??{};
  if (!message || (routeId && routeId !== 'gesticulating-hand')) return;
  const key=midiKey(message);
  if (message.type==='noteOn' && Number(message.velocity)>0) {
    event.preventDefault();
    if(!Number.isInteger(message.note)||message.note<0||message.note>127)return;
    if (state.midi.size>=32 && !state.midi.has(key)) state.midi.delete(state.midi.keys().next().value);
    const finger=((Number(message.note)-60)%5+5)%5;
    state.midi.set(key,{finger,velocity:clamp(message.velocity,0,127)/127});
    audio.setConfig(performanceConfig());selectFinger(finger); syncHeld(); requestDraw();
  } else if (message.type==='noteOff' || (message.type==='noteOn' && !message.velocity)) {
    event.preventDefault(); state.midi.delete(key); audio.setConfig(performanceConfig());syncHeld(); requestDraw();
  } else if (message.type==='controlChange' && [120,123].includes(message.controller??message.control)) {
    event.preventDefault(); releaseNotes();
  } else if (message.type==='pitchBend') {
    event.preventDefault(); updateConfiguration(c=>{ c.pose.wrist.twist=clamp(message.normalized,-1,1)*55; });
  } else if (message.type==='start' || message.type==='continue') { event.preventDefault(); setPlaying(true); }
  else if (message.type==='stop') { event.preventDefault(); setPlaying(false); releaseNotes(); }
}

buildMixer();
for(const [id,options] of [['tremorFinger',TREMOR_FINGERS],['tremorJoint',TREMOR_JOINTS],['skin',HAND_SKINS],['lighting',HAND_LIGHTINGS]]) {
  const names={all:'All fingers',alternating:'Alternating',tip:'Tips',middle:id==='tremorJoint'?'Middle joints':'Middle',knuckle:'Knuckles',whole:'Whole fingers'};
  for(const value of options)el(id).add(new Option(names[value]??sourceLabel(value),value));
}
for(const [id,key] of [['tremorFinger','finger'],['tremorJoint','joint']])listen(el(id),'change',event=>updateConfiguration(c=>{c.tremor[key]=event.target.value;}));
for(const [id,key] of [['tremorAmount','amount'],['tremorRate','rate']])listen(el(id),'input',event=>updateConfiguration(c=>{c.tremor[key]=Number(event.target.value);}));
for(const id of ['skin','lighting'])listen(el(id),'change',event=>updateConfiguration(c=>{c.appearance[id]=event.target.value;}));
for(const motion of HAND_MOTIONS) el('motionPreset').add(new Option(motion.label,motion.id));
el('posePreset').add(new Option('Custom pose','custom'));
for(const pose of HAND_POSES) el('posePreset').add(new Option(pose.label,pose.id));
listen(el('audioButton'),'click',()=>setAudio(!(state.audioOn||state.starting)));
listen(el('soundPlayButton'),'click',()=>setSoundPlaying(!state.soundPlaying));
listen(el('motionButton'),'click',()=>setPlaying(!state.playing));
listen(el('motionPreset'),'change',event=>updateConfiguration(c=>{c.motion.id=event.target.value;}));
listen(el('posePreset'),'change',event=>{
  const pose=HAND_POSES.find(p=>p.id===event.target.value);
  if(pose) updateConfiguration(c=>{c.pose=clone(pose.pose);});
});
for(const id of ['speed','tempo','motionAmount','rootHz','brightness','roughness','space','attack','release','wristFlex','wristSide','wristTwist']) {
  listen(el(id),'input',event=>{
    const value=Number(event.target.value);
    if(id==='tempo'||id==='speed') { updateConfiguration(c=>{c.motion[id]=value;}); return; }
    else if(id==='motionAmount') state.config.motion.amount=value;
    else if(id.startsWith('wrist')) {
      state.config.pose.wrist[id.slice(5).toLowerCase()]=value;
      for(let i=0;i<5;i++) audio.auditionFinger(i,.15);
    }
    else state.config.sound[id]=value;
    updateOutput(id,value); publish();
  });
}
for(const [id,bounds] of Object.entries({speed:HAND_LIMITS.motion.speed,tempo:HAND_LIMITS.motion.tempo,motionAmount:HAND_LIMITS.motion.amount,
  ...HAND_LIMITS.sound,wristFlex:HAND_LIMITS.wrist.flex,wristSide:HAND_LIMITS.wrist.side,wristTwist:HAND_LIMITS.wrist.twist})){
  if(el(id)){el(id).min=bounds[0];el(id).max=bounds[1];}
}
el('attack').step=.001;
listen(el('outputLevel'),'input',event=>{audio.setOutput(Number(event.target.value));updateOutput('outputLevel',Number(event.target.value));});
listen(el('linkJoints'),'change',event=>{state.linked=event.target.checked;});
listen(el('showJoints'),'change',event=>{viewer?.setShowJoints(event.target.checked);requestDraw();});
listen(el('clearSolo'),'click',()=>updateConfiguration(c=>{for(const voice of c.voices)voice.solo=false;}));
listen(el('relaxFinger'),'click',()=>updateConfiguration(c=>{c.pose.fingers[state.selected]=clone(HAND_DEFAULTS.pose.fingers[state.selected]);}));
listen(el('resetAll'),'click',reset);
for(const button of document.querySelectorAll('[data-view]')) listen(button,'click',()=>{
  viewer?.setView(button.dataset.view);syncViewButtons();
  requestDraw();
});
listen(el('zoomIn'),'click',()=>{viewer?.zoom(.85);requestDraw();});
listen(el('zoomOut'),'click',()=>{viewer?.zoom(1.18);requestDraw();});
listen(el('handCanvas'),'keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey)return;
  if(/^[1-5]$/.test(event.key)){event.preventDefault();selectFinger(Number(event.key)-1);return;}
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home'].includes(event.key))return;
  event.preventDefault();
  if(event.key==='Home'){el('relaxFinger').click();return;}
  const amount=event.shiftKey?1:5;
  editJoint({finger:state.selected,joint:state.joint,bend:(event.key==='ArrowDown'?amount:event.key==='ArrowUp'?-amount:0),spread:(event.key==='ArrowRight'?amount:event.key==='ArrowLeft'?-amount:0)});
  audio.auditionFinger(state.selected,.25);
});
listen(window,'morphazoid:midi-input',onMidi);
listen(window,'blur',releaseNotes);
listen(document,'visibilitychange',()=>{if(document.hidden)releaseNotes();else requestDraw();});
listen(window,'resize',()=>{viewer?.resize();requestDraw();});
listen(window,'pagehide',event=>{
  if(event.persisted){
    anchor();cancelAnimationFrame(frame);frame=0;state.audioOn=state.starting=false;audioRequest++;
    releaseNotes();audio.close();syncTransport();return;
  }
  state.disposed=true;audioRequest++;cancelAnimationFrame(frame);releaseNotes();presets?.destroy();
  jointAbort?.abort();layoutObserver.disconnect();abort.abort();viewer?.dispose();audio.close();
});
listen(window,'pageshow',event=>{
  if(event.persisted&&!state.disposed){anchor(state.phase);audio.setTransport({time:state.phase,tremorOffset:state.tremorOffset,playing:state.playing});syncTransport();requestDraw();}
});
presets=registerHeaderPresets({id:'gesticulating-hand',presets:HAND_PRESETS,
  capture:()=>clone(state.config),
  apply:applyConfiguration,
  randomize:(snapshot,random)=>randomizeHandConfig(snapshot,random),
});
audio.setConfig(state.config);audio.setOutput(Number(el('outputLevel').value));
audio.onStateChange=()=>{
  if(!state.disposed&&state.audioOn&&!audio.running){anchor(audio.getMotionTime());state.audioOn=false;syncTransport();notify('Audio was interrupted — turn it on to resume.');requestDraw();}
};
el('modelCredit').innerHTML='<p>Right hand by <a href="https://sketchfab.com/elenaferfor">Elena FF</a> · <a href="https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e">Rigged hand</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Original skin, deform rig and Open/Close animation. Morphazoid adds joint controls and sound.</p>';
syncControls();syncTransport();selectFinger(1,'mcp');
try {
  viewer=createHandViewer(el('handCanvas'),{
    onSelect:selectFinger,onGesture:editJoint,onChange:requestDraw,
    onViewChange:view=>{state.config.view=view;syncViewButtons();presets?.refresh();},
    onStatus:message=>{el('modelStatus').textContent=message;el('modelStatus').hidden=!message;},
    onReady:()=>{state.loaded=true;requestDraw();},
  });
  viewer.setCameraView(state.config.view);viewer.setAppearance(state.config.appearance);requestDraw();
} catch(error) {el('modelStatus').textContent=`The 3D view could not start: ${error.message}. The joint controls remain playable.`;}

// Read-only seam for interaction, lifecycle and audio/visual causality checks.
window.__gesticulatingHand = {
  snapshot:()=>{const time=currentTime();return {config:clone(state.config),pose:effectivePose(time),time,tremorTime:time+state.tremorOffset,
    playing:state.playing,soundPlaying:state.soundPlaying,audioOn:state.audioOn,loaded:state.loaded,
    selected:state.selected,held:state.pointerMask|midiMask(),audio:audio.getState(),viewer:viewer?.getState()};},
};
