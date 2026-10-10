import { createFractalDelayEngine } from './browser-engine.js';
import { MODES, ROUTING_MODES, DEFAULT_PARAMETERS, PARAMETER_LIMITS, randomizeParameters } from './model.js';
import { PRESETS, DEFAULT_PRESET } from './presets.js';
import { DEFAULT_PERFORMANCE, PERFORMANCE_LIMITS, musicalMix, recallMix, MASTERING_PRESETS } from './performance.js';
import { SAMPLE_INPUT_OPTIONS } from '../micmic/native/input-source.js';
import { createNetworkRenderer } from './renderer.js';
import { createAudioStrip } from '../../ui/patterns/audio-strip.js';
import { createStereoMeter } from '../../ui/patterns/level-meter.js';
import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';
import { mountAudioInputControl } from '../../audio-input-control.js';
import { registerHeaderPresets } from '../../site/header-presets.js';
import { initializeOutputRecording } from '../../site/output-recording-controls.js';

const $=id=>document.getElementById(id);
const engine=createFractalDelayEngine({parameters:DEFAULT_PRESET.parameters});
const renderer=createNetworkRenderer($('stage'));
let state=engine.getDiagnostics(),lastRevision=-1,lastStatus,lastAudio,lastStateKey='',lastCredit='',lastUi=-Infinity,lastRoutingLinks=0,frame,closed=false;
const run=promise=>Promise.resolve(promise).catch(reason=>{
  $('liveStatus').textContent=reason.message||String(reason);$('liveStatus').classList.add('is-error');
});
const audioStrip=createAudioStrip({buttonId:'audioButton',levelId:'outputLevel',level:1,levelLabel:'Output',
  onAudioClick:()=>run(engine.setAudio(!state.audioDesired)),onLevelInput:value=>run(engine.setPerformance({outputLevel:value}))});
$('headerAudio').replaceChildren(audioStrip);
const outputMeter=createStereoMeter({active:false});
$('headerControls').insertBefore(outputMeter,$('headerAudio'));
const inputControl=mountAudioInputControl({container:$('headerControls'),before:outputMeter,
  button:$('micButton'),gainInput:$('inputTrim'),gainValue:.85,
  getState:()=>({active:state.microphone,pending:state.microphonePending,
    supported:!!navigator.mediaDevices?.getUserMedia,error:state.input.mode==='mic'?state.error:'',channels:1}),
  getSignal:()=>({levels:[state.status.inputPeak||0]}),
  onStart:()=>engine.setMicrophoneEnabled(true),onStop:()=>engine.setMicrophoneEnabled(false),
  onGainInput:value=>run(engine.setPerformance({inputGain:value}))});
inputControl.gainInput.setAttribute('aria-label','Mic / line gain');
inputControl.root.querySelector('.mz-input-gain').title='Mic / line gain. Files and samples use unity input gain.';
initializeOutputRecording(document,globalThis,{routeId:'fractal-delay'});
const headerObserver=new ResizeObserver(()=>document.body.style.setProperty('--fractal-header-height',`${document.querySelector('.masthead').getBoundingClientRect().height}px`));
headerObserver.observe(document.querySelector('.masthead'));

const knobs=new Map();
for(const input of document.querySelectorAll('.knob-field input')){
  const id=input.id;
  knobs.set(id,enhanceRangeKnob(input,{scale:['timeMs','hpfHz','lpfHz','inputCount','pickupCount'].includes(id)?'log':'linear'}));
  input.addEventListener('input',()=>run(id in PARAMETER_LIMITS?
    engine.setParameters({[id]:Number(input.value)}):engine.setPerformance({[id]:Number(input.value)})));
}
const format=(key,value)=>{
  if(['timeMs','compressorAttackMs','compressorReleaseMs'].includes(key))return `${Number(value.toFixed(value<10?2:0))} ms`;
  if(['hpfHz','lpfHz'].includes(key))return value>=1000?`${(value/1000).toFixed(1)} kHz`:`${Math.round(value)} Hz`;
  if(['pitchOffset'].includes(key))return `${value>0?'+':''}${Number(value.toFixed(1))} st`;
  if(key.endsWith('Db'))return `${key==='delayGainDb'&&value>0?'+':''}${Number(value.toFixed(1))} dB`;
  if(key==='compressorRatio')return `${Number(value.toFixed(1))}:1`;
  if(['coupling','decay','boundary','linkDensity','inputPosition','inputSpread','pickup','pickupSpread','wet','dry'].includes(key))return `${Math.round(value*100)}%`;
  return Number(value.toFixed(3)).toString();
};
const presetMix=preset=>musicalMix({...DEFAULT_PERFORMANCE,
  wet:preset.parameters.mode==='membrane'?.85:.7,dry:preset.parameters.mode==='membrane'?.15:.3});
const bank=PRESETS.map(preset=>({id:preset.id,label:preset.label,snapshot:{parameters:preset.parameters,performance:presetMix(preset)}}));
$('presetSelect').replaceChildren(...PRESETS.map(preset=>new Option(preset.label,preset.id)));
const capture=()=>({parameters:{...state.parameters},performance:musicalMix(state.performance)});
const apply=async snapshot=>{
  await engine.setPerformance(recallMix(snapshot.performance,state.performance));
  await engine.setParameters(snapshot.parameters);
};
const presets=registerHeaderPresets({id:'fractal-delay',presets:bank,capture,apply,
  randomize:()=>({parameters:randomizeParameters(DEFAULT_PARAMETERS),performance:musicalMix(DEFAULT_PERFORMANCE)}),
  onApplied:entry=>{if(entry?.id)$('presetSelect').value=entry.id;},host:document.querySelector('[data-instrument-preset-host]')});
$('presetSelect').addEventListener('change',()=>{
  const preset=bank.find(entry=>entry.id===$('presetSelect').value);if(preset)run(apply(preset.snapshot));
});
$('fallbackPresets').hidden=true;
$('sampleSelect').replaceChildren(...SAMPLE_INPUT_OPTIONS.map(sample=>new Option(sample.label,sample.id)));
function nextOption(select){select.selectedIndex=(select.selectedIndex+1)%select.options.length;select.dispatchEvent(new Event('change',{bubbles:true}));}
$('sampleNext').addEventListener('click',()=>nextOption($('sampleSelect')));
$('modeNext').addEventListener('click',()=>nextOption($('mode')));
$('mode').addEventListener('change',()=>run(engine.setParameters({mode:$('mode').value})));
$('domain').addEventListener('change',()=>run(engine.setParameters({domain:$('domain').value})));
for(const id of ['routing','inputMode','pickupMode'])$(id).addEventListener('change',()=>run(engine.setParameters({[id]:$(id).value})));
$('sourceMode').addEventListener('change',()=>run(engine.setInputMode($('sourceMode').value)));
$('sampleSelect').addEventListener('change',()=>run(engine.setSample($('sampleSelect').value)));
$('fileInput').addEventListener('change',()=>{const file=$('fileInput').files[0];if(file)run(engine.loadFile(file));});
$('inputLoop').addEventListener('change',()=>engine.setInputLoop($('inputLoop').checked));
$('restartInput').addEventListener('click',()=>run(engine.restartInput()));
$('stopInput').addEventListener('click',()=>engine.stopInput());
$('masteringPreset').addEventListener('change',()=>{
  const preset=MASTERING_PRESETS.find(item=>item.id===$('masteringPreset').value);if(preset)run(engine.setPerformance(preset.mix));
});
for(const id of ['voiceBudget','manualBudget'])$(id).addEventListener('change',()=>run(engine.setVoiceBudget($('voiceBudget').value,$('manualBudget').checked)));
$('captureSound').addEventListener('click',async()=>{
  const text=JSON.stringify({instrument:'fractal-delay',version:1,...capture(),liveLevels:{inputGain:state.performance.inputGain,
    delayGainDb:state.performance.delayGainDb,outputLevel:state.performance.outputLevel,outputBoostDb:state.performance.outputBoostDb}},null,2);
  $('capturedSound').value=text;$('capturedSound').hidden=false;
  try{await navigator.clipboard.writeText(text);$('captureStatus').textContent='Copied. Paste into chat to save a preset.';}
  catch{$('capturedSound').select();$('captureStatus').textContent='Select and copy the captured parameters.';}
});

// Pointer geometry requests are coalesced in the worker; scalar sound controls
// never reinstall the graph or restart the source.
let drag;
$('stage').addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  drag={x:event.clientX,y:event.clientY,real:state.parameters.cReal,imag:state.parameters.cImag};
  $('stage').setPointerCapture(event.pointerId);$('stage').focus();
});
$('stage').addEventListener('pointermove',event=>{
  if(!drag)return;const rect=$('stage').getBoundingClientRect(),fine=event.shiftKey?.15:1;
  run(engine.setParameters({cReal:drag.real+(event.clientX-drag.x)/rect.width*3*fine,
    cImag:drag.imag-(event.clientY-drag.y)/rect.height*3*fine}));
});
for(const name of ['pointerup','pointercancel','lostpointercapture'])$('stage').addEventListener(name,()=>{drag=null;});
function arrows(event){
  const dx={ArrowLeft:-1,ArrowRight:1}[event.key]||0,dy={ArrowDown:-1,ArrowUp:1}[event.key]||0;
  if(!dx&&!dy)return;event.preventDefault();const step=event.shiftKey?.001:.01;
  run(engine.setParameters({cReal:state.parameters.cReal+dx*step,cImag:state.parameters.cImag+dy*step}));
}
function usesParameterPlane(){return state.parameters.domain==='mandelbrot'&&!['inverse','orbits'].includes(state.parameters.mode);}
$('stage').addEventListener('keydown',arrows);$('parameterMap').addEventListener('keydown',arrows);
const mapWorker=new Worker(new URL('./mandelbrot-worker.js',import.meta.url),{type:'module'});
let mapImage;
const mapContext=$('parameterMap').getContext('2d');
mapWorker.onmessage=({data})=>{mapImage=new ImageData(data.pixels,data.width,data.height);paintMap();};
mapWorker.postMessage({width:240,height:120});
function paintMap(){if(!mapImage)return;mapContext.putImageData(mapImage,0,0);
  const x=(state.parameters.cReal+2)/3*240,y=(1.5-state.parameters.cImag)/3*120;
  mapContext.strokeStyle='#fff6cb';mapContext.lineWidth=1.5;mapContext.beginPath();mapContext.arc(x,y,4,0,Math.PI*2);mapContext.stroke();}
$('parameterMap').addEventListener('pointerdown',event=>{
  const rect=$('parameterMap').getBoundingClientRect();
  run(engine.setParameters({cReal:-2+3*(event.clientX-rect.left)/rect.width,cImag:1.5-3*(event.clientY-rect.top)/rect.height}));
});
const release=engine.subscribe(next=>{state=next;
  if(next.network&&next.network.revision!==lastRevision){lastRevision=next.network.revision;
    lastRoutingLinks=next.network.edges.filter(edge=>edge.routingLink).length;renderer.setNetwork(next.network);}
  if(next.status!==lastStatus||next.audio!==lastAudio){lastStatus=next.status;lastAudio=next.audio;renderer.setStatus(next.audio?next.status:null);}
});
function syncControls(){
  const key=JSON.stringify([state.parameters,state.performance,state.input.mode,state.input.sampleId]);
  if(key===lastStateKey)return;lastStateKey=key;
  for(const [id,value]of Object.entries({...state.parameters,...state.performance})){
    const input=$(id);if(!input)continue;input.value=String(value);
    if(knobs.has(id)){knobs.get(id).update();const output=document.querySelector(`output[for="${id}"]`);if(output)output.textContent=format(id,value);}
  }
  audioStrip.setLevel(state.performance.outputLevel);inputControl.root.setGain(state.performance.inputGain);
  $('sourceMode').value=state.input.mode;$('sampleSelect').value=state.input.sampleId;
  $('sampleControls').hidden=state.input.mode!=='samples';$('fileControls').hidden=state.input.mode!=='file';
  $('mediaTransport').hidden=state.input.mode==='mic';
  $('domainField').hidden=['inverse','orbits'].includes(state.parameters.mode);
  $('canvasInstructions').textContent=usesParameterPlane()?'Drag: excitation position · Shift: fine · Arrow keys: adjust':'Drag: real / imaginary c · Shift: fine · Arrow keys: adjust c';
  for(const [id,label]of [['cReal','Real'],['cImag','Imaginary']]){
    const title=usesParameterPlane()?`Input ${label.toLowerCase()}`:`${label} c`;
    document.querySelector(`label[for="${id}"] b`).textContent=title;$(id).setAttribute('aria-label',title);
  }
  $('modeDescription').textContent=MODES.find(mode=>mode.id===state.parameters.mode).description;
  $('routingDescription').textContent=ROUTING_MODES.find(mode=>mode.id===state.parameters.routing)?.description||'';
  $('masteringPreset').value=MASTERING_PRESETS.find(preset=>Object.entries(preset.mix).every(([key,value])=>Math.abs(state.performance[key]-value)<.001))?.id||'';
  const detailTitle={inverse:'Generations',contours:'Contour detail',orbits:'Orbit steps',rays:'Ray detail',membrane:'Mesh detail'}[state.parameters.mode];
  document.querySelector('label[for="detail"] b').textContent=detailTitle;$('detail').setAttribute('aria-label',detailTitle);
  const coordinates=`${state.parameters.cReal.toFixed(3)} ${state.parameters.cImag<0?'−':'+'} ${Math.abs(state.parameters.cImag).toFixed(3)}i`;
  $('coordinateReadout').textContent=coordinates;paintMap();presets.refresh();
}
function paintUi(now){
  syncControls();audioStrip.setAudioState(state.audio?'on':state.audioDesired?'starting':state.error?'error':'off');
  inputControl.refresh();outputMeter.setLevels({left:state.status.outputLeftPeak||0,right:state.status.outputRightPeak||0,active:state.audio});
  $('inputNote').textContent=state.input.pending?'Loading input…':state.input.mode==='mic'?
    (state.microphone?state.inputDescription:'Enable Mic for capture. Mic / line gain is separate from file and sample playback.'):
    `${state.input.label || 'Choose a file'} · unity input gain${state.input.playing?' · playing':''}`;
  const creditKey=`${state.input.credit}|${state.input.creditUrl}`;
  if(creditKey!==lastCredit){lastCredit=creditKey;$('inputCredit').hidden=!state.input.credit;$('inputCredit').replaceChildren();
    if(state.input.credit){const a=document.createElement('a');a.textContent=state.input.credit;a.href=state.input.creditUrl||'#';a.rel='noopener';a.target='_blank';$('inputCredit').append(a);}}
  const n=state.network;
  const inputs=n?.inputPorts?.length||(n?1:0),pickups=n?.pickupPorts?.length||(n?1:0);
  const links=lastRoutingLinks;
  $('portReadout').textContent=`${inputs} excitation ${inputs===1?'point':'points'} · ${pickups} ${pickups===1?'pickup':'pickups'}${state.compiling?' · updating…':''}`;
  $('portsReadout').textContent=`${inputs} / ${pickups}`;$('linksReadout').textContent=String(links);
  $('edgeCount').textContent=`${state.preparedEdges.toLocaleString()} connections`;
  $('stageReadout').textContent=n?`${MODES.find(mode=>mode.id===n.mode).label.toUpperCase()} · ${n.edges.length.toLocaleString()} connections${state.compiling?' · preparing change':''}`:'Preparing complete network…';
  $('capacityReadout').textContent=`${state.requestedEdges.toLocaleString()} / ${state.preparedEdges.toLocaleString()}`;
  $('processingReadout').textContent=state.audio?`${state.activeEdges} connections / ${state.activeEdges*2} travelling waves`:'Audio off';
  $('cpuReadout').textContent=state.audio?`${Math.round(state.cpuLoad*100)}% / ${Math.round((state.status.peakLoad||0)*100)}%`:'—';
  $('estimateReadout').textContent=`${Math.round(state.cpuEstimate*100)}% · offline DSP benchmark`;
  $('memoryReadout').textContent=`${(state.requiredDelayBytes/1048576).toFixed(1)} / ${Math.round(state.sceneMemoryBytes/1048576)} MiB per scene`;
  $('deadlineReadout').textContent=String(state.status.deadlineMisses||0);$('rendererReadout').textContent=renderer.renderer;
  $('liveStatus').textContent=state.error|| (state.audio?`${state.input.playing||state.microphone?'Input playing':'Audio on · waiting for input'} · ${Math.round(state.sampleRate)} Hz`:'Audio off · geometry ready to explore.');
  $('liveStatus').classList.toggle('is-error',!!state.error);
  // Visible geometry represents admitted audio connections, including quiet ones.
  $('stage').setAttribute('aria-label',`${MODES.find(mode=>mode.id===(n?.mode||state.parameters.mode)).label}. ${state.preparedEdges} prepared connections, ${inputs} excitation points and ${pickups} pickups. ${usesParameterPlane()?'Drag to move the excitation position.':'Drag to change real and imaginary c.'}`);
  lastUi=now;
}
let lastDraw=-Infinity;
function animate(now){if(closed)return;if(now-lastDraw>=1000/30){renderer.resize();renderer.draw();lastDraw=now;}
  if(now-lastUi>=150)paintUi(now);frame=requestAnimationFrame(animate);}
frame=requestAnimationFrame(animate);
run(engine.ready());
document.addEventListener('visibilitychange',()=>{if(document.hidden)run(engine.setAudio(false));});
globalThis.addEventListener('pagehide',()=>{
  closed=true;cancelAnimationFrame(frame);release();presets.destroy();inputControl.destroy();audioStrip.destroy();
  for(const knob of knobs.values())knob.destroy();headerObserver.disconnect();mapWorker.terminate();renderer.dispose();void engine.dispose();
},{once:true});
