import { createFractalDelayEngine } from './browser-engine.js';
import { MODES, DEFAULT_PARAMETERS, PARAMETER_LIMITS, randomizeParameters, NO_DECAY_PARAMETERS, hasNoDecay } from './model.js';
import { PRESETS, DEFAULT_PRESET, recallParameters } from './presets.js';
import { DEFAULT_PERFORMANCE, PERFORMANCE_LIMITS, musicalMix, recallMix, MASTERING_PRESETS } from './performance.js';
import { SAMPLE_INPUT_OPTIONS } from '../micmic/native/input-source.js';
import { createNetworkRenderer } from './renderer.js';
import { createAudioStrip } from '../../ui/patterns/audio-strip.js';
import { createStereoMeter } from '../../ui/patterns/level-meter.js';
import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';
import { mountAudioInputControl } from '../../audio-input-control.js';
import { registerHeaderPresets } from '../../site/header-presets.js';
import { initializeOutputRecording } from '../../site/output-recording-controls.js';
import { initializeTapTempoControls } from '../../site/tap-tempo-controls.js';
import { enhanceSharedNavigation } from '../../../nav.js';
import { IMPULSE_LIMITS } from './impulse-source.js';
import { DEFAULT_EXPLORER_VIEW, EXPLORER_PRESETS, EXPLORER_LIMITS, normalizeExplorerView,
  complexAt, pixelAt, zoomExplorer, panExplorer, projectExplorerImage } from './fractal-explorer.js';

const $=id=>document.getElementById(id);
enhanceSharedNavigation(document);
const engine=createFractalDelayEngine({parameters:DEFAULT_PRESET.parameters});
const renderer=createNetworkRenderer($('stage'));
let explorerView={...DEFAULT_EXPLORER_VIEW},explorerRegionId=EXPLORER_PRESETS[0].id,motionTempoLatched=false;
let state=engine.getDiagnostics(),lastRevision=-1,lastStatus,lastAudio,lastStateKey='',lastUi=-Infinity,lastRoutingLinks=0,frame,closed=false;
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
const impulseIds=Object.fromEntries(Object.keys(IMPULSE_LIMITS).map(key=>[`impulse${key[0].toUpperCase()}${key.slice(1)}`,key]));
let previousLossSettings;
$('noDecay').addEventListener('change',()=>{
  if($('noDecay').checked){
    previousLossSettings=Object.fromEntries(Object.keys(NO_DECAY_PARAMETERS).map(key=>[key,state.parameters[key]]));
    run(engine.setParameters(NO_DECAY_PARAMETERS));
  }else{
    run(engine.setParameters(previousLossSettings||Object.fromEntries(Object.keys(NO_DECAY_PARAMETERS).map(key=>[key,DEFAULT_PRESET.parameters[key]]))));
    previousLossSettings=undefined;
  }
});
function editParameters(patch){
  if(motionTempoLatched){
    const key=['realMotionTempo','imagMotionTempo'].find(key=>Object.hasOwn(patch,key));
    if(key){
      patch={...patch,realMotionTempo:patch[key],imagMotionTempo:patch[key]};
      // Mirror the paired control before another native keyboard/drag event
      // can read its old value. Do not dispatch an extra musical event.
      for(const id of ['realMotionTempo','imagMotionTempo']){
        $(id).value=String(patch[key]);knobs.get(id)?.update();
        document.querySelector(`output[for="${id}"]`).textContent=format(id,Number(patch[key]));
      }
    }
  }
  return engine.setParameters(patch);
}
for(const input of document.querySelectorAll('.knob-field input[type=range]')){
  const id=input.id;
  knobs.set(id,enhanceRangeKnob(input,{scale:['timeMs','hpfHz','lpfHz','inputCount','pickupCount','realMotionTempo','imagMotionTempo','explorerZoom','impulseFrequency','impulseCutoff','impulseRatio','impulseTempo'].includes(id)?'log':'linear'}));
  input.addEventListener('input',()=>{
    if(id==='explorerZoom'){setExplorerView(zoomExplorer(explorerView,Number(input.value)));return;}
    if(impulseIds[id]){engine.setImpulseParameters({[impulseIds[id]]:Number(input.value)});return;}
    run(id in PARAMETER_LIMITS?editParameters({[id]:Number(input.value)}):engine.setPerformance({[id]:Number(input.value)}));
  });
}
// Rust/WASM pages own their bootstrap; nav.js leaves this lifecycle to us.
const tapTempo=initializeTapTempoControls(document,globalThis);
const format=(key,value)=>{
  if(key==='impulseTempo')return `${Number(value.toFixed(1))} BPM`;
  if(key.startsWith('impulse')&&key.endsWith('Ms'))return `${Math.round(value)} ms`;
  if(['impulseFrequency','impulseCutoff'].includes(key))return value>=1000?`${(value/1000).toFixed(2)} kHz`:`${Math.round(value)} Hz`;
  if(['impulseSustain','impulseLevel'].includes(key))return `${Math.round(value*100)}%`;
  if(key.endsWith('MotionTempo'))return `${Number(value.toFixed(2))} BPM`;
  if(key.endsWith('MotionDepth'))return `±${Number(value.toFixed(3))}`;
  if(['timeMs','compressorAttackMs','compressorReleaseMs'].includes(key))return `${Number(value.toFixed(value<10?2:0))} ms`;
  if(['hpfHz','lpfHz'].includes(key))return value>=1000?`${(value/1000).toFixed(1)} kHz`:`${Math.round(value)} Hz`;
  if(['pitchOffset'].includes(key))return `${value>0?'+':''}${Number(value.toFixed(1))} st`;
  if(key==='geometryPitch')return `±${Number(value.toFixed(1))} st`;
  if(key.endsWith('Db'))return `${['inputDriveDb','delayGainDb'].includes(key)&&value>0?'+':''}${Number(value.toFixed(1))} dB`;
  if(key==='compressorRatio')return `${Number(value.toFixed(1))}:1`;
  if(['coupling','decay','boundary','linkDensity','inputPosition','inputSpread','pickup','pickupSpread','wet','dry','tapCoverage','turnTone'].includes(key))return `${Math.round(value*100)}%`;
  return Number(value.toFixed(3)).toString();
};
const presetMix=preset=>musicalMix({...DEFAULT_PERFORMANCE,
  wet:preset.parameters.mode==='membrane'?.85:.7});
const bank=PRESETS.map(preset=>({id:preset.id,label:preset.label,snapshot:{parameters:preset.parameters,performance:presetMix(preset)}}));
$('presetSelect').replaceChildren(...PRESETS.map(preset=>new Option(preset.label,preset.id)));
const capture=()=>({parameters:{...state.parameters},performance:musicalMix(state.performance)});
const apply=async snapshot=>{
  await engine.setPerformance(recallMix(snapshot.performance,state.performance));
  await engine.setParameters(recallParameters(snapshot.parameters));
  // A complete sound preset retains its authored rates; linking is a live
  // editing preference, separate from the saved musical snapshot.
  if(snapshot.parameters.realMotionTempo!==snapshot.parameters.imagMotionTempo)motionTempoLatched=false;
  lastStateKey='';
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
for(const id of ['routing','inputMode','pickupMode','propagation'])$(id).addEventListener('change',()=>run(engine.setParameters({[id]:$(id).value})));
$('sourceMode').addEventListener('change',()=>run(engine.setInputMode($('sourceMode').value)));
$('impulseMode').addEventListener('change',()=>engine.setImpulseParameters({mode:$('impulseMode').value}));
$('sendImpulse').addEventListener('click',()=>run(engine.sendImpulse()));
$('impulsePlay').addEventListener('click',()=>run(engine.setImpulsePlaying(!state.impulse.playing)));
$('sampleSelect').addEventListener('change',()=>run(engine.setSample($('sampleSelect').value)));
$('fileInput').addEventListener('change',()=>{const file=$('fileInput').files[0];if(file)run(engine.loadFile(file));});
$('inputLoop').addEventListener('change',()=>engine.setInputLoop($('inputLoop').checked));
$('restartInput').addEventListener('click',()=>run(engine.restartInput()));
$('stopInput').addEventListener('click',()=>engine.stopInput());
for(const axis of ['real','imag'])$(`${axis}MotionPlay`).addEventListener('click',()=>
  run(engine.setMotionPlaying(axis,!state.motion[axis].playing)));
$('motionTempoLatch').addEventListener('click',()=>{
  motionTempoLatched=!motionTempoLatched;lastStateKey='';
  if(motionTempoLatched)run(editParameters({realMotionTempo:state.parameters.realMotionTempo}));
});
for(const [id,key]of [['cRealNumber','cReal'],['cImagNumber','cImag']]){
  const input=$(id);
  const edit=()=>{if(input.value.trim()&&Number.isFinite(input.valueAsNumber))run(editParameters({[key]:input.valueAsNumber}));};
  input.addEventListener('input',edit);
  input.addEventListener('change',edit);
  input.addEventListener('blur',()=>{input.value=String(Number(state.parameters[key].toPrecision(12)));});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();edit();input.blur();}});
}
$('masteringPreset').addEventListener('change',()=>{
  const preset=MASTERING_PRESETS.find(item=>item.id===$('masteringPreset').value);if(preset)run(engine.setPerformance(preset.mix));
});
for(const id of ['voiceBudget','manualBudget'])$(id).addEventListener('change',()=>run(engine.setVoiceBudget($('voiceBudget').value,$('manualBudget').checked)));
$('captureSound').addEventListener('click',async()=>{
  const text=JSON.stringify({instrument:'fractal-delay',version:4,...capture(),explorer:{...explorerView},motionTempoLatched,
    impulse:{...state.impulse.parameters},liveLevels:{inputGain:state.performance.inputGain,
    inputDriveDb:state.performance.inputDriveDb,delayGainDb:state.performance.delayGainDb,dry:state.performance.dry,
    outputLevel:state.performance.outputLevel,outputBoostDb:state.performance.outputBoostDb}},null,2);
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
  if(!dx&&!dy)return;event.preventDefault();
  const step=(event.shiftKey? .001:.01)/(event.currentTarget.id==='parameterMap'?explorerView.zoom:1);
  run(engine.setParameters({cReal:state.parameters.cReal+dx*step,cImag:state.parameters.cImag+dy*step}));
}
function usesParameterPlane(){return state.parameters.domain==='mandelbrot'&&!['inverse','orbits'].includes(state.parameters.mode);}
$('stage').addEventListener('keydown',arrows);$('parameterMap').addEventListener('keydown',arrows);
const mapWorker=new Worker(new URL('./mandelbrot-worker.js',import.meta.url),{type:'module'});
let mapRevision=0,mapBusy=false,mapFailed=false,pendingMapRequest,lastMapKey='',lastMapSubmission=-Infinity;
const mapImages=[];
const mapContext=$('parameterMap').getContext('2d');
function mapAspect(){const rect=$('parameterMap').getBoundingClientRect();return rect.width/Math.max(1,rect.height);}
function mapInterval(){return state.audio||state.motion.real.playing||state.motion.imag.playing?150:100;}
function submitMap(request){pendingMapRequest=undefined;mapBusy=true;lastMapSubmission=performance.now();mapWorker.postMessage(request);}
function requestMap(){
  if(mapFailed||closed)return;
  const rect=$('parameterMap').getBoundingClientRect();if(rect.width<1||rect.height<1)return;
  const moving=state.motion.real.playing||state.motion.imag.playing;
  const extent=state.audio||moving?240:EXPLORER_LIMITS.maxDimension,scale=extent/Math.max(rect.width,rect.height);
  const width=Math.max(2,Math.round(rect.width*scale)),height=Math.max(2,Math.round(rect.height*scale));
  const request={width,height,view:{...explorerView},cReal:state.parameters.cReal,cImag:state.parameters.cImag};
  const key=JSON.stringify([width,height,explorerView,explorerView.set==='julia'?[request.cReal,request.cImag]:null]);
  if(key===lastMapKey)return;lastMapKey=key;request.revision=++mapRevision;
  // Finish one finite image, retaining only the latest target. Continuous c
  // motion must not cancel every frame, and never queues a render backlog.
  if(mapBusy||performance.now()-lastMapSubmission<mapInterval())pendingMapRequest=request;
  else submitMap(request);
}
mapWorker.onmessage=({data})=>{
  mapBusy=false;
  if(data.pixels&&data.view?.set===explorerView.set){
    // Julia imagery belongs to one coefficient; never combine different sets
    // while filling newly exposed areas from cached wider views.
    for(let i=mapImages.length-1;i>=0;i--){const image=mapImages[i];
      if(data.view.set==='julia'&&image.view.set==='julia'&&(image.cReal!==data.cReal||image.cImag!==data.cImag))mapImages.splice(i,1);
    }
    const surface=document.createElement('canvas');surface.width=data.width;surface.height=data.height;
    surface.getContext('2d').putImageData(new ImageData(data.pixels,data.width,data.height),0,0);
    mapImages.push({...data,pixels:undefined,surface});
    // Retain each set's widest view as an underlay, plus recent detail. Six
    // bounded raster surfaces use at most 3 MiB; no image backlog is retained.
    if(mapImages.length>6){
      const widest=set=>mapImages.filter(image=>image.view.set===set).reduce((best,image)=>!best||image.view.zoom<best.view.zoom?image:best,null);
      const keep=new Set([widest('julia'),widest('mandelbrot'),mapImages.at(-1)]);
      mapImages.splice(mapImages.findIndex(image=>!keep.has(image)),1);
    }
    paintMap();
  }
};
mapWorker.onerror=()=>{mapFailed=true;mapBusy=false;pendingMapRequest=undefined;lastStateKey='';};
function paintMap(){
  const canvas=$('parameterMap'),rect=canvas.getBoundingClientRect(),aspect=mapAspect();
  const width=Math.max(2,Math.round(rect.width)),height=Math.max(2,Math.round(rect.height));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  mapContext.fillStyle='#050709';mapContext.fillRect(0,0,width,height);
  const images=mapImages.filter(image=>image.view.set===explorerView.set);
  const latest=images.at(-1);
  const latestCrop=latest&&projectExplorerImage(latest,explorerView,width,height);
  const covered=latestCrop&&latestCrop[4]<1e-6&&latestCrop[5]<1e-6&&latestCrop[4]+latestCrop[6]>=width-1e-6&&latestCrop[5]+latestCrop[7]>=height-1e-6;
  const layers=covered?[latest]:[...images.filter(image=>image!==latest).sort((a,b)=>a.view.zoom-b.view.zoom),...(latest?[latest]:[])];
  for(const image of layers){
    const crop=projectExplorerImage(image,explorerView,width,height);
    if(crop)mapContext.drawImage(image.surface,...crop);
  }
  if(explorerView.set==='mandelbrot'){
    const point=pixelAt(explorerView,state.parameters.cReal,state.parameters.cImag,aspect);
    mapContext.strokeStyle='#fff6cb';mapContext.lineWidth=1.5;mapContext.beginPath();mapContext.arc(point.x*width,point.y*height,5,0,Math.PI*2);mapContext.stroke();
  }
}
function setExplorerView(view){
  explorerView=normalizeExplorerView(view);lastStateKey='';requestMap();paintMap();
}
$('explorerZoom').min=String(EXPLORER_LIMITS.zoom[0]);$('explorerZoom').max=String(EXPLORER_LIMITS.zoom[1]);
$('explorerPreset').replaceChildren(new Option('Custom view',''),...EXPLORER_PRESETS.map(preset=>new Option(preset.label,preset.id)));
$('explorerPreset').addEventListener('change',()=>{
  const preset=EXPLORER_PRESETS.find(preset=>preset.id===$('explorerPreset').value);if(!preset)return;
  explorerRegionId=preset.id;
  setExplorerView(preset.view);
  if(Number.isFinite(preset.cReal)&&Number.isFinite(preset.cImag))run(editParameters({cReal:preset.cReal,cImag:preset.cImag}));
});
$('explorerPresetNext').addEventListener('click',()=>{
  // Motion can make the displayed selection Custom. Keep browsing from the
  // last chosen region and never visit the Custom placeholder as a preset.
  const index=EXPLORER_PRESETS.findIndex(preset=>preset.id===explorerRegionId);
  $('explorerPreset').value=EXPLORER_PRESETS[(index+1)%EXPLORER_PRESETS.length].id;
  $('explorerPreset').dispatchEvent(new Event('change',{bubbles:true}));
});
$('explorerSet').addEventListener('change',()=>setExplorerView({set:$('explorerSet').value,zoom:1}));
$('explorerReset').addEventListener('click',()=>setExplorerView({set:explorerView.set,zoom:1}));
let mapDrag;
$('parameterMap').addEventListener('pointerdown',event=>{
  if(mapDrag||![0,1].includes(event.button))return;event.preventDefault();
  const canvas=$('parameterMap'),rect=canvas.getBoundingClientRect();
  mapDrag={id:event.pointerId,x:event.clientX,y:event.clientY,view:{...explorerView},real:state.parameters.cReal,imag:state.parameters.cImag,
    pan:event.altKey||event.button===1,fine:event.shiftKey};canvas.setPointerCapture(event.pointerId);canvas.focus();
  if(!mapDrag.pan&&!event.shiftKey&&explorerView.set==='mandelbrot'){
    const point=complexAt(explorerView,(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height,mapAspect());
    run(editParameters({cReal:point.real,cImag:point.imag}));
  }
});
$('parameterMap').addEventListener('pointermove',event=>{
  if(!mapDrag||mapDrag.id!==event.pointerId)return;
  const rect=$('parameterMap').getBoundingClientRect(),dx=(event.clientX-mapDrag.x)/rect.width,dy=(event.clientY-mapDrag.y)/rect.height;
  if(mapDrag.pan){setExplorerView(panExplorer(mapDrag.view,dx,dy,mapAspect()));return;}
  const fine=(event.shiftKey||mapDrag.fine)? .15:1;
  if(explorerView.set==='julia'||mapDrag.fine){
    const span=EXPLORER_LIMITS.span/mapDrag.view.zoom;
    run(editParameters({cReal:mapDrag.real+dx*span*fine,cImag:mapDrag.imag-dy*span/mapAspect()*fine}));
  }else{
    const point=complexAt(explorerView,(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height,mapAspect());
    run(editParameters({cReal:point.real,cImag:point.imag}));
  }
});
for(const name of ['pointerup','pointercancel','lostpointercapture'])$('parameterMap').addEventListener(name,event=>{
  if(mapDrag?.id===event.pointerId)mapDrag=undefined;
});
$('parameterMap').addEventListener('wheel',event=>{
  event.preventDefault();const rect=$('parameterMap').getBoundingClientRect();
  setExplorerView(zoomExplorer(explorerView,explorerView.zoom*Math.exp(-Math.max(-200,Math.min(200,event.deltaY))*.003),
    (event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height,mapAspect()));
},{passive:false});
$('parameterMap').addEventListener('keydown',event=>{
  if(['+','=','-','_'].includes(event.key)){event.preventDefault();setExplorerView(zoomExplorer(explorerView,explorerView.zoom*((event.key==='-'||event.key==='_')? .8:1.25)));}
  if(event.key==='Escape'){event.preventDefault();setExplorerView({set:explorerView.set,zoom:1});}
});
const mapResize=new ResizeObserver(()=>{requestMap();paintMap();});mapResize.observe($('parameterMap'));
const release=engine.subscribe(next=>{state=next;
  if(next.network&&next.network.revision!==lastRevision){lastRevision=next.network.revision;
    lastRoutingLinks=next.network.edges.filter(edge=>edge.routingLink).length;renderer.setNetwork(next.network);}
  if(next.status!==lastStatus||next.audio!==lastAudio){lastStatus=next.status;lastAudio=next.audio;renderer.setStatus(next.audio?next.status:null);}
});
function syncControls(){
  const key=JSON.stringify([state.parameters,state.performance,state.input.mode,state.input.sampleId,state.audio,state.impulse.parameters,state.impulse.playing,state.impulse.pending,state.motion.real.playing,state.motion.imag.playing,explorerView,motionTempoLatched]);
  if(key===lastStateKey)return;lastStateKey=key;
  const impulseValues=Object.fromEntries(Object.entries(impulseIds).map(([id,key])=>[id,state.impulse.parameters[key]]));
  for(const [id,value]of Object.entries({...state.parameters,...state.performance,...impulseValues})){
    const input=$(id);if(!input)continue;
    const changed=input.value!==String(value);if(changed)input.value=String(value);
    if(knobs.has(id)){
      const output=document.querySelector(`output[for="${id}"]`),text=format(id,value);
      if(changed||output?.textContent!==text)knobs.get(id).update();
      if(output&&output.textContent!==text)output.textContent=text;
    }
  }
  audioStrip.setLevel(state.performance.outputLevel);inputControl.root.setGain(state.performance.inputGain);
  $('sourceMode').value=state.input.mode;$('sampleSelect').value=state.input.sampleId;
  $('sampleControls').hidden=state.input.mode!=='samples';$('fileControls').hidden=state.input.mode!=='file';
  $('mediaTransport').hidden=!['file','samples'].includes(state.input.mode);
  $('impulseControls').hidden=state.input.mode!=='impulse';$('impulseMode').value=state.impulse.parameters.mode;
  $('sendImpulse').disabled=!state.audio||state.impulse.pending;
  $('impulsePlay').setAttribute('aria-pressed',String(state.impulse.playing));
  $('impulsePlay').setAttribute('aria-label',`${state.impulse.playing?'Pause':'Play'} repeating impulses`);
  $('domainField').hidden=['inverse','orbits'].includes(state.parameters.mode);
  $('canvasInstructions').textContent=usesParameterPlane()?'Drag: excitation position · Shift: fine · Arrow keys: adjust':'Drag: real / imaginary c · Shift: fine · Arrow keys: adjust c';
  for(const [id,label]of [['cReal','Real'],['cImag','Imaginary']]){
    const title=usesParameterPlane()?`Input ${label.toLowerCase()}`:`${label} c`;
    document.querySelector(`label[for="${id}"] b`).textContent=title;$(id).setAttribute('aria-label',title);
    const numberInput=$(id==='cReal'?'cRealNumber':'cImagNumber');
    if(document.activeElement!==numberInput)numberInput.value=String(Number(state.parameters[id].toPrecision(12)));
  }
  $('modeDescription').textContent=MODES.find(mode=>mode.id===state.parameters.mode).description;
  const paths=state.parameters.propagation==='paths';
  $('noDecay').checked=hasNoDecay(state.parameters);
  for(const [axis,name]of [['real','Real'],['imag','Imaginary']]){
    const playing=state.motion[axis].playing,button=$(`${axis}MotionPlay`);
    button.setAttribute('aria-pressed',String(playing));
    button.setAttribute('aria-label',`${playing?'Pause':'Play'} ${name} c motion`);
  }
  $('motionTempoLatch').setAttribute('aria-pressed',String(motionTempoLatched));
  $('motionTempoLatch').title=motionTempoLatched?'Release linked coordinate tempos':'Link Real and Imaginary tempos';
  $('explorerSet').value=explorerView.set;$('explorerZoom').value=String(explorerView.zoom);knobs.get('explorerZoom').update();
  document.querySelector('output[for="explorerZoom"]').textContent=`${Number(explorerView.zoom.toFixed(2))}×`;
  const matchesRegion=preset=>Object.keys(explorerView).every(key=>Math.abs(preset.view[key]-explorerView[key])<1e-9||preset.view[key]===explorerView[key])&&
    (preset.cReal===null||Math.abs(preset.cReal-state.parameters.cReal)<1e-9&&Math.abs(preset.cImag-state.parameters.cImag)<1e-9);
  const chosenRegion=EXPLORER_PRESETS.find(preset=>preset.id===explorerRegionId);
  const sameView=matchesRegion(chosenRegion)?chosenRegion:
    EXPLORER_PRESETS.find(preset=>preset.cReal!==null&&matchesRegion(preset))||EXPLORER_PRESETS.find(matchesRegion);
  $('explorerPreset').value=sameView?.id||'';
  $('explorerReadout').textContent=mapFailed?'Fractal view unavailable':`${explorerView.set==='julia'?'Julia':'Mandelbrot'} · ${Number(explorerView.zoom.toFixed(2))}×`;
  $('parameterMap').setAttribute('aria-label',`${explorerView.set==='julia'?'Julia fractal. Drag to change c.':'Mandelbrot parameter map. Drag to select c.'} Alt-drag to pan; plus and minus to zoom.`);
  for(const id of ['geometryPitch','tapCoverage','turnTone'])$(id).disabled=!paths;
  $('masteringPreset').value=MASTERING_PRESETS.find(preset=>Object.entries(preset.mix).every(([key,value])=>Math.abs(state.performance[key]-value)<.001))?.id||'';
  const detailTitle={inverse:'Generations',contours:'Contour detail',orbits:'Orbit steps',rays:'Ray detail',membrane:'Mesh detail'}[state.parameters.mode];
  document.querySelector('label[for="detail"] b').textContent=detailTitle;$('detail').setAttribute('aria-label',detailTitle);
  const coordinates=`${Number(state.parameters.cReal.toFixed(6))} ${state.parameters.cImag<0?'−':'+'} ${Number(Math.abs(state.parameters.cImag).toFixed(6))}i`;
  $('coordinateReadout').textContent=coordinates;requestMap();paintMap();presets.refresh();
}
function paintUi(now){
  syncControls();audioStrip.setAudioState(state.audio?'on':state.audioDesired?'starting':state.error?'error':'off');
  inputControl.refresh();outputMeter.setLevels({left:state.status.outputLeftPeak||0,right:state.status.outputRightPeak||0,active:state.audio});
  const n=state.network;
  const inputs=n?.inputPorts?.length||(n?1:0),pickups=n?.pickupPorts?.length||(n?1:0);
  const links=lastRoutingLinks;
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
function animate(now){if(closed)return;
  if(!mapBusy&&pendingMapRequest&&now-lastMapSubmission>=mapInterval()){const request=pendingMapRequest;pendingMapRequest=undefined;submitMap(request);}
  if(now-lastDraw>=1000/30){renderer.resize();renderer.draw();lastDraw=now;}
  if(now-lastUi>=150)paintUi(now);frame=requestAnimationFrame(animate);}
frame=requestAnimationFrame(animate);
run(engine.ready());
document.addEventListener('visibilitychange',()=>{if(document.hidden)run(engine.setAudio(false));});
globalThis.addEventListener('pagehide',()=>{
  closed=true;cancelAnimationFrame(frame);release();presets.destroy();tapTempo?.destroy();inputControl.destroy();audioStrip.destroy();
  for(const knob of knobs.values())knob.destroy();headerObserver.disconnect();mapResize.disconnect();mapWorker.terminate();renderer.dispose();void engine.dispose();
},{once:true});
