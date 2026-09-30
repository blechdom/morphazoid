import { DEFAULT_PARAMS, PRESETS, MATERIALS, LAYOUTS, sanitizeParams, sceneParams, randomizeParams, buildRun, compileRun, createRunSimulation } from "./domino-run-model.js";
import { sanitizeDrawing, buildDrawnRun } from "./domino-run-drawing.js";
import { DominoAudio } from "./domino-run-audio.js";
import { DominoRenderer } from "./domino-run-renderer.js";
import { registerHeaderPresets } from "../../site/header-presets.js";
import { createRangeField, createSelectField } from "../../ui/index.js";

const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
const canvas = $("stage"), renderer = new DominoRenderer(canvas), audio = new DominoAudio();
let params = sanitizeParams(DEFAULT_PARAMS), edits = [], drawing = null, undo = [];
let run, playableRun, timeline, simulation = null, committedSimulation = null, manualPushes = [], referenceDuration = 1, selected = 0, mode = "push", playing = false, disposed = false;
let anchor = 0, offset = 0, queuedCycle = -1, frame = 0, lastDraw = 0, buildTimer = 0, pointer = null;
let streamQueued = new Set(), streamFuture = [];
let transportUsesAudioClock = false;
let draftPoints = [], drawCursor = {x:0,z:0};
let presetController, activeStartIds = null, activeForce = 1;
const fields = new Map(), zeroButtons = new Map();
// Keep one clock domain through suspension/interruption. AudioContext time
// freezes with the sound; explicit Audio actions rebase it.
const clock = () => transportUsesAudioClock && audio.context ? audio.context.currentTime : performance.now() / 1000;
const cycleLength = () => timeline.duration + .85;
const rawTime = () => Math.max(0, offset + (playing ? Math.max(0,clock()-anchor)*(simulation?1:params.speed) : 0));
const localTime = () => simulation ? rawTime() : params.loop ? rawTime() % cycleLength() : Math.min(rawTime(),timeline.duration);
const snapshot = () => ({version:1,params:clone(params),edits:clone(edits),drawing:clone(drawing)});
const liveParams = () => ({loop:params.loop,autoStand:params.autoStand,standDelay:params.standDelay});
function canonicalScene(state) {
  if(state?.version!==1||!state.params||!Array.isArray(state.edits))throw new TypeError("Invalid Domino Run scene");
  return {version:1,params:sceneParams(state.params),edits:clone(state.edits).slice(0,512),drawing:state.drawing?sanitizeDrawing(state.drawing):null};
}
const captureScene = () => canonicalScene(snapshot());
function phaseNow() {
  if(!timeline)return 0;
  const time=localTime();
  if(simulation)return (time%Math.max(.01,referenceDuration))/Math.max(.01,referenceDuration);
  // A scene chosen during the reset gap starts ready to fall, never past its end.
  return time<timeline.duration?time/Math.max(.01,timeline.duration):0;
}

function error(e) { $("audioError").hidden=false; $("audioError").textContent=e?.message||String(e); }
function announce(text) { $("liveStatus").textContent=text; }
function fieldValue(key,value) { fields.get(key)?.setValue?.(value); }
function sync() {
  for(const [key,value] of Object.entries(params)) fieldValue(key,value);
  for(const [key,button] of zeroButtons)button.disabled=params[key]===0;
  fieldValue("layout",drawing?"drawn":params.layout);
  fields.get("count").hidden=Boolean(drawing);
  $("seed").value=params.seed; $("loop").checked=params.loop; $("loop").disabled=params.autoStand;
  $("autoStand").checked=params.autoStand;
  $("standDelay").disabled=!params.autoStand;
  $("playButton").textContent=playing?"Ⅱ Pause":"▶ Run";
  $("playButton").setAttribute("aria-pressed",String(playing));
  $("audioButton").setAttribute("aria-pressed",String(audio.armed));
  $("audioState").textContent=audio.armed?"on":"off";
  $("sceneName").textContent=drawing?"Drawn pattern":PRESETS.find(p=>JSON.stringify(sceneParams(p.params))===JSON.stringify(sceneParams(params))&&!edits.length)?.name||"Custom run";
  $("reachCount").textContent=`${timeline.reachableCount??timeline.falls.length}/${run.dominoes.length} reachable`;
  $("undoEdit").disabled=$("undoDraw").disabled=!undo.length;
  $("drawingInfo").textContent=drawing?`${run.dominoes.length} dominoes · ${drawing.strokes.length} ${drawing.strokes.length===1?"path":"paths"}${run.truncated?" · 512 limit":""}`:"Your first stroke replaces this run.";
  syncSelected();presetController?.refresh();
}
function syncSelected() {
  const d=run.dominoes.find(d=>d.id===selected)||run.dominoes[0];
  for(const id of ["tileSize","tileMaterial","removeSelected","pushSelected","chooseDomino"])$(id).disabled=!d;
  $("selectedNumber").textContent=d?String(d.id+1):"—";
  if(!d)return;
  selected=d.id;$("tileSize").value=d.height;$("tileSizeOut").value=d.height.toFixed(2);
  $("tileMaterial").value=d.material;$("removeSelected").textContent=d.enabled===false?"Put back":"Lift out";
}
function streamTimeline() {
  timeline={events:simulation.events,falls:simulation.falls,duration:simulation.duration,
    reachableCount:simulation.reachableCount,blockedLinks:simulation.blockedLinks};
}
function advanceStream() {
  const now=rawTime();
  // Retain a current-time simulation so manual pushes can replace only the
  // speculative future, without replaying a long performance from its start.
  const present=simulation.hasPending?now:Math.min(now,simulation.duration);
  const committed=committedSimulation.advance(present);
  if(committed.complete)committedSimulation.prune(Math.max(0,now-1));
  const result=simulation.advance(now+4);
  // A capped replay resumes next tick, including while paused. Never prune as
  // though its requested horizon has already been reached.
  if(result.complete)simulation.prune(Math.max(0,rawTime()-1));
  streamTimeline();
  return result.complete;
}
function streamBatch(raw) {
  // Keep a render-quantum grace before freeing capacity. Unsent events remain
  // in the model; backpressure never discards a dense cohort or a later floor hit.
  streamFuture=streamFuture.filter(e=>{if(e.time<raw-.04){streamQueued.delete(e.eventId);return false;}return true;});
  const capacity=Math.max(0,3500-streamFuture.length);
  const batch=timeline.events.filter(e=>e.time>=raw&&!streamQueued.has(e.eventId)).slice(0,capacity);
  for(const e of batch){streamQueued.add(e.eventId);streamFuture.push(e);}
  return batch;
}
function queueAudio({live=false}={}) {
  if(live)audio.cancelQueued();else audio.silence();
  queuedCycle=-1;streamQueued=new Set();streamFuture=[];
  if(!playing||!audio.armed)return;
  const raw=rawTime();let future;
  if(simulation){advanceStream();future=streamBatch(raw).map(e=>({...e,time:e.time-raw}));}
  else {
    const cycle=cycleLength(),index=params.loop?Math.floor(raw/cycle):0;future=[];
    for(let n=index;n<=index+(params.loop?1:0);n++)for(const event of timeline.events){
      const t=n*cycle+event.time-raw;if(t>=-.001)future.push({...event,time:Math.max(0,t)/params.speed});
    }
    queuedCycle=index+(params.loop?1:0);
  }
  const requested=audio.context.currentTime+(live?0:.045);
  const actual=audio.queue(future,requested,{preserveStart:live});
  anchor=typeof actual==="number"?actual:requested;offset=raw;
}
function audioStateChanged() {
  if(disposed||!transportUsesAudioClock)return;
  if(audio.armed)queueAudio({live:true});else audio.cancelQueued();
  sync();
}
function rebuild({preserve=true,phase=phaseNow(),streamTime=simulation?rawTime():null,startIds=activeStartIds,force=activeForce}={}) {
  clearTimeout(buildTimer);buildTimer=0;manualPushes=[];
  const begun=clock();
  run=drawing?buildDrawnRun(drawing,params):buildRun(params);
  for(const edit of edits){
    const d=run.dominoes.find(d=>d.id===edit.id);if(!d)continue;
    if(Number.isFinite(edit.x))d.x=clamp(edit.x,-150,150);
    if(Number.isFinite(edit.z))d.z=clamp(edit.z,-150,150);
    if(Number.isFinite(edit.height)){const ratio=clamp(edit.height,.3,4)/d.height;d.height*=ratio;d.width*=ratio;d.depth*=ratio;}
    if(MATERIALS.some(m=>m.id===edit.material)){d.material=edit.material;d.color=MATERIALS.find(m=>m.id===edit.material).color;}
    if(typeof edit.enabled==="boolean")d.enabled=edit.enabled;
  }
  const enabled=run.dominoes.filter(d=>d.enabled!==false),ids=new Set(enabled.map(d=>d.id));
  const playable=playableRun={...run,dominoes:enabled,links:run.links.filter(e=>ids.has(e.from)&&ids.has(e.to)),roots:run.roots.filter(id=>ids.has(id))};
  const options={startIds:startIds?.filter(id=>ids.has(id))??playable.roots,force};
  const firstPass=compileRun(playable,options);
  referenceDuration=Math.max(.01,firstPass.duration/params.speed);
  committedSimulation=params.autoStand?createRunSimulation(playable,{...options,autoStand:true,standDelay:params.standDelay,speed:params.speed}):null;
  simulation=committedSimulation?.fork()??null;
  offset=preserve?(simulation&&streamTime!==null?streamTime+(playing?clock()-begun:0):phase*(simulation?referenceDuration:firstPass.duration)):0;anchor=clock();
  if(simulation){advanceStream();}else timeline=firstPass;
  audio.setParams(params);queueAudio({live:preserve});sync();draw();
}
function apply(state) {
  const scene=canonicalScene(state),phase=phaseNow();
  clearTimeout(buildTimer);
  if(presetController)presetController.hasPresetInteraction=true;
  params=sanitizeParams({...scene.params,...liveParams()});edits=scene.edits;
  drawing=scene.drawing;
  undo=[];draftPoints=[];activeStartIds=null;activeForce=1;
  rebuild({phase,streamTime:null});
}
function setParam(key,value) {
  if(key==="layout"&&value==="drawn"){setMode("draw");return;}
  const next=sanitizeParams({...params,[key]:value});
  if(next[key]===params[key]&&!(key==="layout"&&drawing))return;
  const before=rawTime(),phase=phaseNow(),streamTime=simulation?before:null;params=next;
  offset=before;anchor=clock();
  if(["ring","brightness","soundVariation","loop"].includes(key)||key==="speed"&&!simulation){audio.setParams(params);queueAudio({live:true});sync();return;}
  if(!["autoStand","standDelay","speed"].includes(key)){
    edits=[];undo=[];activeStartIds=null;activeForce=1;
    if(key==="layout"||key==="count")drawing=null;
  }
  clearTimeout(buildTimer);buildTimer=setTimeout(()=>rebuild({phase,streamTime:["autoStand","standDelay","speed"].includes(key)&&streamTime!==null?rawTime():null}),55);
}
function start(ids=run.roots,force=1) {
  if(!run.dominoes.length){announce("Draw a path first.");return;}
  clearTimeout(buildTimer);activeStartIds=[...ids];activeForce=force;playing=true;
  rebuild({preserve:false,startIds:ids,force});announce(`Run started at domino ${(ids[0]??0)+1}.`);
}
function pushDomino(ids,force=1) {
  if(buildTimer)rebuild();
  const enabled=new Set(playableRun.dominoes.map(d=>d.id));
  ids=[...new Set(ids)].filter(id=>enabled.has(id));
  if(!ids.length){announce("Choose a standing domino to push.");return;}
  if(!playing&&offset===0&&activeStartIds===null){start(ids,force);return;}
  const began=clock(),now=localTime();
  // Whole-run recovery has finished the previous wave; a push can begin the
  // next run immediately while no falling pieces remain to interrupt.
  if(!simulation&&params.loop&&now>=timeline.duration){start(ids,force);return;}
  if(simulation){
    const current=committedSimulation.advance(now);
    if(!current.complete){announce("Catching up with the run. Push again in a moment.");return;}
    if(!committedSimulation.trigger(ids,now,force)){announce("That domino is already falling or down. Wait for it to stand, or use Stand all.");return;}
    audio.cancelQueued();
    simulation=committedSimulation.fork();
  }else{
    const fallen=new Set(timeline.falls.filter(f=>f.start<=now).map(f=>f.id));
    ids=ids.filter(id=>!fallen.has(id));
    if(!ids.length){announce("That domino is already falling or down. Use Stand all to set it up again.");return;}
    audio.cancelQueued();
    // Each tile has at most one manual start per repeated run. A new earlier
    // push replaces its future start; completed starts remain unchanged.
    manualPushes=manualPushes.filter(push=>!ids.includes(push.id));
    manualPushes.push(...ids.map(id=>({id,time:now,force})));
    timeline=compileRun(playableRun,{startIds:activeStartIds??playableRun.roots,force:activeForce,pushes:manualPushes});
    referenceDuration=Math.max(.01,timeline.duration/params.speed);
  }
  const resumedAt=clock();
  offset=now+(playing?Math.max(0,resumedAt-began)*(simulation?1:params.speed):0);anchor=resumedAt;playing=true;
  if(simulation)advanceStream();
  queueAudio({live:true});sync();draw();
  announce(`Domino ${(ids[0]??0)+1} pushed. Other falls keep going.`);
}
function pause() {offset=rawTime();playing=false;audio.silence();sync();draw();}
function togglePlay() {
  if(playing){pause();return;}
  if(offset===0&&activeStartIds===null||(!simulation&&!params.loop&&offset>=timeline.duration)||(simulation&&!simulation.hasPending&&offset>=timeline.duration)){start();return;}
  playing=true;anchor=clock();queueAudio();sync();
}
function standUp() {offset=0;anchor=clock();activeStartIds=null;activeForce=1;rebuild({preserve:false});announce("Dominoes standing again.");}
function rememberEdit() {undo.push(snapshot());if(undo.length>30)undo.shift();}
function undoEdit() {
  if(!undo.length)return;
  clearTimeout(buildTimer);
  const state=undo.pop(),phase=phaseNow();params=sanitizeParams({...state.params,...liveParams()});edits=clone(state.edits);drawing=clone(state.drawing);
  draftPoints=[];activeStartIds=null;activeForce=1;rebuild({phase,streamTime:null});announce("Last edit undone.");
}
function editTile(patch,{remember=true}={}) {
  if(!run.dominoes.length)return;
  if(remember)rememberEdit();
  let edit=edits.find(e=>e.id===selected);if(!edit){edit={id:selected};edits.push(edit);}
  Object.assign(edit,patch);rebuild();
}
function setMode(next) {
  if(mode!==next)draftPoints=[];mode=next;
  document.querySelectorAll("[data-mode]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.mode===mode)));
  $("drawTools").hidden=mode!=="draw";
  $("stageHelp").textContent=mode==="draw"?"Draw a path, then release. Add more strokes for more chains. Keyboard: arrows move, Enter adds a point, Shift+Enter finishes, Esc cancels.":mode==="arrange"?"Tap a domino to select it; drag to move it. Edit one domino changes that piece’s height or material. Arrow keys move it; Shift makes fine changes.":mode==="view"?"Drag to orbit the run. Use + and − to zoom, or Fit to return.":"Click a standing domino to push it. Push elsewhere to add another wave. Drag empty space to orbit.";
  canvas.style.cursor=mode==="draw"?"crosshair":mode==="view"?"grab":mode==="arrange"?"move":"pointer";draw();
}
function commitStroke(points) {
  if(points.length<2){draftPoints=[];draw();return;}
  const candidate=sanitizeDrawing({version:1,strokes:[...(drawing?.strokes??[]),{id:Math.max(0,...(drawing?.strokes??[]).map(s=>Number(s.id)||0))+1,closed:$("closeLoops").checked,points}]});
  const next=buildDrawnRun(candidate,params);
  if(next.dominoes.length<2||(drawing&&next.dominoes.length<=run.dominoes.length)){
    announce(run.dominoes.length>=512?"The pattern is full. Undo a stroke or start a new pattern.":"Draw a longer path to place at least two dominoes.");draftPoints=[];draw();return;
  }
  const extending=Boolean(drawing);rememberEdit();drawing=candidate;if(!extending)edits=[];draftPoints=[];activeStartIds=null;activeForce=1;
  rebuild({streamTime:null});announce(`${run.dominoes.length} dominoes in ${drawing.strokes.length} ${drawing.strokes.length===1?"path":"paths"}.`);
}
function newPattern() {
  rememberEdit();drawing=sanitizeDrawing({version:1,strokes:[]});edits=[];draftPoints=[];activeStartIds=null;
  setMode("draw");rebuild({preserve:false});announce("Blank pattern. Draw your first path.");
}
function createFields() {
  const select=(key,label,options,parent)=>{
    const f=createSelectField({id:key,label,value:params[key],options:options.map(o=>({value:o.id,label:o.label})),onChange:value=>setParam(key,value)});
    $(parent).append(f);fields.set(key,f);
  };
  const range=(key,label,min,max,step,parent,format)=>{
    const f=createRangeField({id:key,label,min,max,step,value:params[key],formatValue:format,onInput:value=>setParam(key,Number(value))});
    if(["sizeVariation","growth","stairRise","ring","soundVariation"].includes(key)){
      const row=document.createElement("div"),button=document.createElement("button");
      row.className="domino-reset-field";button.className="domino-zero";button.type="button";
      button.dataset.zeroParam=key;button.textContent="↺ 0";button.title=`Reset ${label} to zero`;button.setAttribute("aria-label",button.title);
      button.addEventListener("click",()=>f.setValue(0,{emit:true}));
      row.append(f,button);$(parent).append(row);zeroButtons.set(key,button);
    }else $(parent).append(f);
    fields.set(key,f);
  };
  select("layout","Path",[...LAYOUTS,{id:"drawn",label:"Drawn pattern"}],"structureFields");
  select("material","Material",[...MATERIALS,{id:"mixed",label:"Mixed materials"}],"structureFields");
  range("count","Dominoes",16,512,1,"structureFields",n=>String(Math.round(n)));
  range("spacing","Spacing",.24,1.35,.01,"structureFields",n=>`${Number(n).toFixed(2)} × height`);
  range("size","Overall size",.65,1.5,.01,"structureFields",n=>`${Number(n).toFixed(2)}×`);
  range("sizeVariation","Size variation",0,.4,.01,"structureFields",n=>`${Math.round(n*100)}%`);
  range("growth","Size gradient",-.5,.5,.01,"structureFields",n=>Number(n)===0?"Even":`${n>0?"Growing":"Shrinking"} ${Math.round(Math.abs(n)*100)}%`);
  range("stairRise","Step height",0,.3,.01,"structureFields",n=>Number(n).toFixed(2));
  range("standDelay","After landing",.1,12,.1,"renewFields",n=>`${Number(n).toFixed(1)} s`);
  range("speed","Run speed",.35,2.4,.01,"soundFields",n=>`${Number(n).toFixed(2)}×`);
  range("ring","Resonance",0,1,.01,"soundFields",n=>`${Math.round(n*100)}%`);
  range("brightness","Brightness",.1,1,.01,"soundFields",n=>`${Math.round(n*100)}%`);
  range("soundVariation","Sound variation",0,1,.01,"soundFields",n=>`${Math.round(n*100)}%`);
  for(const m of MATERIALS){const o=document.createElement("option");o.value=m.id;o.textContent=m.label;$("tileMaterial").append(o);}
}
function draw() {
  if(disposed||!timeline)return;
  $("finishPath").disabled=draftPoints.length<2;
  const time=localTime(),rise=!simulation&&time>timeline.duration?clamp((time-timeline.duration)/.85,0,1):0;
  renderer.render(run,timeline,time,{selected,showPaths:$("showPaths").checked,resurrection:rise*rise*(3-2*rise),
    autoStand:Boolean(simulation),draft:mode==="draw"?{points:draftPoints,cursor:drawCursor}:null});
  const latest=new Map();for(const f of timeline.falls)if(f.start<=time)latest.set(f.id,f);
  const fallen=[...latest.values()].filter(f=>time>=f.start+f.duration&&(!simulation||time<f.standEnd)).length;
  $("fallenCount").textContent=`${fallen} fallen`;
  $("reachCount").textContent=`${timeline.reachableCount??timeline.falls.length}/${run.dominoes.length} reachable`;
  const progress=simulation?(time%referenceDuration)/referenceDuration:time/Math.max(.01,timeline.duration);
  const percent=Math.round(clamp(progress,0,1)*100);
  $("progressFill").style.width=`${percent}%`;$("progressTrack").setAttribute("aria-valuenow",String(percent));
  $("runStatus").textContent=!run.dominoes.length?"Draw a path to begin":rise>0?"Standing up…":playing?
    simulation?`${fallen} down · rising after ${params.standDelay.toFixed(1)} s`:`${fallen} / ${run.dominoes.length} fallen`:
    offset===0?"Ready · push any domino":simulation&&offset>=timeline.duration?"Wave ended · push a domino":
    !simulation&&offset>=timeline.duration?(timeline.falls.length<run.dominoes.length?"Run stopped at a gap · push another tile":"Run complete"):"Paused";
}
function animate(t) {
  if(disposed)return;
  if(t-lastDraw>1000/40){draw();lastDraw=t;}
  frame=requestAnimationFrame(animate);
}
function tick() {
  if(disposed)return;
  if(!playing){if(simulation&&simulation.time<rawTime()+4){advanceStream();draw();}return;}
  if(!run.dominoes.length)return;
  const raw=rawTime();
  if(simulation){
    advanceStream();
    if(audio.armed){const batch=streamBatch(raw);if(batch.length)audio.queue(batch,anchor-offset,{preserveStart:true});}
    if(!simulation.hasPending&&raw>=timeline.duration){offset=Math.max(timeline.duration,committedSimulation.time);playing=false;sync();draw();}
    return;
  }
  if(!params.loop&&raw>=timeline.duration){offset=timeline.duration;playing=false;sync();return;}
  if(params.loop&&audio.armed){
    const index=Math.floor(raw/cycleLength());
    if(index>queuedCycle){queueAudio({live:true});}
    else if(index+1>queuedCycle){
      const next=index+1;
      audio.queue(timeline.events.map(e=>({...e,time:e.time/params.speed})),anchor+(next*cycleLength()-offset)/params.speed);
      queuedCycle=next;
    }
  }
}
function localPoint(event){const r=canvas.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top};}
function groundPoint(p){const v=renderer.unproject(p.x,p.y,0);return{x:clamp(v.x,-150,150),z:clamp(v.z,-150,150)};}
canvas.addEventListener("pointerdown",event=>{
  if(pointer||event.button>0)return;
  const p=localPoint(event),hit=mode==="draw"?null:renderer.hit(p.x,p.y);
  if(hit!==null){selected=hit;syncSelected();}
  pointer={id:event.pointerId,start:p,last:p,hit,mode,moved:false,yaw:renderer.yaw,tilt:renderer.tilt,before:snapshot()};
  renderer.fitLocked=mode==="draw"||mode==="arrange"&&hit!==null;
  if(mode==="draw"){drawCursor=groundPoint(p);draftPoints=[drawCursor];draw();}
  canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});
});
canvas.addEventListener("pointermove",event=>{
  if(pointer?.id!==event.pointerId)return;
  const p=localPoint(event);pointer.moved ||= Math.hypot(p.x-pointer.start.x,p.y-pointer.start.y)>5;
  if(!pointer.moved)return;
  if(pointer.mode==="draw"){
    for(const sample of event.getCoalescedEvents?.().length?event.getCoalescedEvents():[event]){
      const point=groundPoint(localPoint(sample)),last=draftPoints.at(-1);
      if(draftPoints.length<8192&&Math.hypot(point.x-last.x,point.z-last.z)>.02)draftPoints.push(point);
      drawCursor=point;
    }
    draw();
  }else if(pointer.mode==="arrange"&&pointer.hit!==null){
    const d=run.dominoes.find(d=>d.id===pointer.hit),a=renderer.unproject(pointer.last.x,pointer.last.y,d.elevation),b=renderer.unproject(p.x,p.y,d.elevation);
    editTile({x:d.x+b.x-a.x,z:d.z+b.z-a.z},{remember:false});
  }else {renderer.yaw=pointer.yaw+(p.x-pointer.start.x)*.008;renderer.tilt=clamp(pointer.tilt+(p.y-pointer.start.y)*.002,.25,.85);draw();}
  pointer.last=p;
});
function finishPointer(event,cancel=false){
  if(pointer?.id!==event.pointerId)return;
  const last=pointer;pointer=null;
  if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  if(last.mode==="draw"){
    if(cancel){draftPoints=[];draw();}
    else if(last.moved){const end=groundPoint(localPoint(event));if(Math.hypot(end.x-draftPoints.at(-1).x,end.z-draftPoints.at(-1).z)>.02)draftPoints.push(end);commitStroke(draftPoints);}
    else {draftPoints=[];draw();}
  }else if(cancel&&last.mode==="arrange"){edits=last.before.edits;rebuild();}
  else if(last.moved&&last.mode==="arrange"&&last.hit!==null){undo.push(last.before);if(undo.length>30)undo.shift();sync();}
  else if(!cancel&&!last.moved&&last.hit!==null&&last.mode==="push")pushDomino([last.hit],.9+clamp(event.pressure||.5,0,1)*.3);
  renderer.fitLocked=false;draw();
}
canvas.addEventListener("pointerup",e=>finishPointer(e));
canvas.addEventListener("pointercancel",e=>finishPointer(e,true));
canvas.addEventListener("lostpointercapture",e=>{if(pointer)finishPointer(e,true);});
canvas.addEventListener("keydown",event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="z"){event.preventDefault();undoEdit();return;}
  if(mode==="draw"){
    if(event.key==="Escape"){event.preventDefault();draftPoints=[];renderer.fitLocked=false;draw();return;}
    if(event.key==="Enter"){
      event.preventDefault();
      if(event.shiftKey){commitStroke(draftPoints);renderer.fitLocked=false;draw();}
      else {renderer.fitLocked=true;draftPoints.push({...drawCursor});draw();}
      return;
    }
    if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)){
      event.preventDefault();event.stopPropagation();const step=event.shiftKey ? .1 : params.size*params.spacing*1.2;
      drawCursor={x:clamp(drawCursor.x+(event.key==="ArrowRight"?step:event.key==="ArrowLeft"?-step:0),-150,150),z:clamp(drawCursor.z+(event.key==="ArrowDown"?step:event.key==="ArrowUp"?-step:0),-150,150)};draw();return;
    }
  }
  if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)){
    event.preventDefault();event.stopPropagation();if(!run.dominoes.length)return;
    if(mode==="arrange"){
      const d=run.dominoes.find(d=>d.id===selected),step=event.shiftKey ? .035 : .15;
      editTile({x:d.x+(event.key==="ArrowRight"?step:event.key==="ArrowLeft"?-step:0),z:d.z+(event.key==="ArrowDown"?step:event.key==="ArrowUp"?-step:0)});
    }else {const at=run.dominoes.findIndex(d=>d.id===selected);selected=run.dominoes[(at+(event.key==="ArrowLeft"||event.key==="ArrowUp"?-1:1)+run.dominoes.length)%run.dominoes.length].id;syncSelected();draw();}
  }else if(event.key==="Enter"){event.preventDefault();pushDomino([selected]);}
});
const keyHandler=e=>{if(!e.defaultPrevented&&e.code==="Space"&&!e.repeat&&!e.target.closest("input,select,textarea,button,summary,a")){e.preventDefault();togglePlay();}};
document.addEventListener("keydown",keyHandler);
document.querySelectorAll("[data-mode]").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
$("audioButton").addEventListener("click",async()=>{
  const arm=!audio.armed;$("audioButton").disabled=true;
  try{
    await audio.setArmed(arm);
    // Manual pushes and visual time may advance while Audio is starting.
    // Capture that progress before changing clock domains.
    const elapsed=rawTime();transportUsesAudioClock=arm;
    audio.context?.addEventListener("statechange",audioStateChanged);
    offset=elapsed;anchor=clock();queueAudio();$("audioError").hidden=true;
  }catch(e){
    const elapsed=rawTime();transportUsesAudioClock=false;
    offset=elapsed;anchor=clock();error(e);
  }finally{$("audioButton").disabled=false;sync();}
});
$("level").addEventListener("input",()=>{audio.setLevel(Number($("level").value));$("levelOut").value=`${Math.round(Number($("level").value)*100)}%`;});
$("playButton").addEventListener("click",togglePlay);
$("resetRun").addEventListener("click",standUp);
$("loop").addEventListener("change",()=>setParam("loop",$("loop").checked));
$("autoStand").addEventListener("change",()=>setParam("autoStand",$("autoStand").checked));
$("undoDraw").addEventListener("click",undoEdit);
$("newPattern").addEventListener("click",newPattern);
$("finishPath").addEventListener("click",()=>{commitStroke(draftPoints);renderer.fitLocked=false;draw();});
$("seed").addEventListener("change",()=>setParam("seed",Number($("seed").value)));
$("newRun").addEventListener("click",()=>apply({version:1,params:sceneParams(randomizeParams((params.seed+0x9e3779b9)>>>0)),edits:[]}));
$("showPaths").addEventListener("change",draw);
$("zoomIn").addEventListener("click",()=>{renderer.zoom=clamp(renderer.zoom*1.2,.5,4);draw();});
$("zoomOut").addEventListener("click",()=>{renderer.zoom=clamp(renderer.zoom/1.2,.5,4);draw();});
$("fitView").addEventListener("click",()=>{renderer.zoom=1;renderer.yaw=-.48;renderer.tilt=.54;draw();});
$("chooseDomino").addEventListener("click",()=>{setMode("arrange");canvas.scrollIntoView({block:"nearest"});canvas.focus({preventScroll:true});announce("Tap a domino to edit that piece. Drag it to move it.");});
$("pushSelected").addEventListener("click",()=>pushDomino([selected]));
$("removeSelected").addEventListener("click",()=>editTile({enabled:run.dominoes.find(d=>d.id===selected).enabled===false}));
$("tileMaterial").addEventListener("change",()=>editTile({material:$("tileMaterial").value}));
$("tileSize").addEventListener("change",()=>editTile({height:Number($("tileSize").value)}));
$("tileSize").addEventListener("input",()=>{$("tileSizeOut").value=Number($("tileSize").value).toFixed(2);});
$("undoEdit").addEventListener("click",undoEdit);
$("resetAll").addEventListener("click",async()=>{pause();await audio.setArmed(false);transportUsesAudioClock=false;params=sanitizeParams(DEFAULT_PARAMS);edits=[];drawing=null;draftPoints=[];undo=[];activeStartIds=null;activeForce=1;renderer.zoom=1;renderer.yaw=-.48;renderer.tilt=.54;setMode("push");rebuild({preserve:false});});
const midiHandler=event=>{
  const m=event.detail?.message;if(!m||disposed)return;
  if(m.type==="noteOn"){event.preventDefault();if(!document.hidden&&run.dominoes.length)pushDomino([run.dominoes[((m.note??60)%run.dominoes.length+run.dominoes.length)%run.dominoes.length].id],clamp((m.velocity??100)/100,.2,1.4));}
  else if(m.type==="noteOff")event.preventDefault();
  else if(m.type==="controlChange"&&[120,123].includes(m.controller)){event.preventDefault();pause();}
  else if(m.type==="controlChange"&&m.controller===74){event.preventDefault();setParam("brightness",.1+.9*(m.value??0)/127);}
  else if(m.type==="controlChange"&&m.controller===7){event.preventDefault();$("level").value=clamp((m.value??0)/127,0,1);$("level").dispatchEvent(new Event("input",{bubbles:true}));}
  else if(m.type==="start"){event.preventDefault();if(!document.hidden)start();}
  else if(m.type==="continue"){event.preventDefault();if(!playing&&!document.hidden)togglePlay();}
  else if(m.type==="stop"){event.preventDefault();pause();}
};
window.addEventListener("morphazoid:midi-input",midiHandler);
const visibility=()=>{if(document.hidden&&playing)pause();};
document.addEventListener("visibilitychange",visibility);
createFields();rebuild({preserve:false});
presetController=registerHeaderPresets({id:"domino-run",presets:PRESETS.map(p=>({id:p.id,label:p.name,snapshot:canonicalScene({version:1,params:p.params,edits:[],drawing:null})})),capture:captureScene,apply,randomize:(_state,random=Math.random)=>canonicalScene({version:1,params:randomizeParams(Math.floor(random()*4294967296)),edits:[],drawing:null})});
const observer=new ResizeObserver(()=>{renderer.resize();draw();});observer.observe($("stageWrap"));
const timer=setInterval(tick,80);frame=requestAnimationFrame(animate);
function dispose(){if(disposed)return;disposed=true;clearInterval(timer);clearTimeout(buildTimer);cancelAnimationFrame(frame);observer.disconnect();presetController.destroy();audio.context?.removeEventListener("statechange",audioStateChanged);audio.dispose();document.removeEventListener("keydown",keyHandler);document.removeEventListener("visibilitychange",visibility);window.removeEventListener("morphazoid:midi-input",midiHandler);}
window.addEventListener("pagehide",dispose,{once:true});
// Read-only scene/clock evidence for browser QA; playback uses the public controls.
globalThis.dominoRun=Object.freeze({get snapshot(){return snapshot();},get run(){return clone(run);},get timeline(){return clone(timeline);},get targets(){return renderer.hits.map(({id,x,y})=>({id,x,y}));},get selected(){return selected;},get drawing(){return clone(drawing);},get pending(){return simulation?.hasPending??false;},get playing(){return playing;},get time(){return localTime();},get audio(){return {...audio.status,armed:audio.armed,state:audio.context?.state??"uninitialized"};}});
