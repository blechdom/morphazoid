import { synthParametersForMode } from '../../audio.js';
import { LSystemsSynthAudio, lSystemTimbreGain } from '../l-systems/sound-engines.js';
import { lSystemNoteEnvelope } from '../l-systems/discrete-audio.js';

export const IMPULSE_MODES = Object.freeze(['sine','triangle','square','saw','fm','pm','shepard']);
export const IMPULSE_DEFAULTS = Object.freeze({ mode:'fm',frequency:220,index:3,ratio:2,
  cutoff:9000,resonance:.6,attackMs:8,decayMs:30,sustain:.25,holdMs:10,releaseMs:120,
  shepardRate:1,shepardWidth:4,level:.35,tempo:60 });
export const IMPULSE_LIMITS = Object.freeze({ frequency:[20,4000],index:[0,12],ratio:[.125,16],
  cutoff:[80,20000],resonance:[.1,8],attackMs:[8,1000],decayMs:[8,2000],sustain:[0,1],
  holdMs:[0,3964],releaseMs:[20,3984],shepardRate:[-8,8],shepardWidth:[1,8],level:[0,1],tempo:[1,240] });
export function sanitizeImpulse(candidate={}) {
  const next={mode:IMPULSE_MODES.includes(candidate.mode)?candidate.mode:IMPULSE_DEFAULTS.mode};
  for(const [key,[low,high]] of Object.entries(IMPULSE_LIMITS)) {
    const value=Number(candidate[key]);
    next[key]=Number.isFinite(value)?Math.max(low,Math.min(high,value)):IMPULSE_DEFAULTS[key];
  }
  // The shared L-Systems envelope spans four seconds. Fit the actual stages,
  // including minimum attack/release, so the controls match what is played.
  const stages=['attackMs','decayMs','holdMs','releaseMs'];
  const minimum=stages.reduce((sum,key)=>sum+IMPULSE_LIMITS[key][0],0);
  const total=stages.reduce((sum,key)=>sum+next[key],0);
  if(total>4000)for(const key of stages) {
    const low=IMPULSE_LIMITS[key][0];
    next[key]=low+Math.floor((next[key]-low)*(4000-minimum)/(total-minimum));
  }
  return next;
}
export function impulseEnvelope(parameters) {
  const p=sanitizeImpulse(parameters),attack=p.attackMs/1000,decay=p.decayMs/1000,
    hold=p.holdMs/1000,release=p.releaseMs/1000,total=attack+decay+hold+release;
  return {duration:total,points:lSystemNoteEnvelope(total,{enabled:true,points:[
    {x:0,y:0},{x:attack/total,y:1},{x:(attack+decay)/total,y:p.sustain},
    {x:(attack+decay+hold)/total,y:p.sustain},{x:1,y:0},
  ]})};
}

const LEAD=.012,LOOKAHEAD=.085;
/** Audio-clock beat positions; overdue beats are skipped, never replayed. */
export class ImpulseClock {
  constructor(tempo,now) {this.tempo=tempo;this.anchor=now+LEAD;this.phase=0;this.nextBeat=0;}
  phaseAt(time) {return this.phase+(time-this.anchor)*this.tempo/60;}
  setTempo(tempo,now) {
    this.phase=this.phaseAt(now);this.anchor=now;this.tempo=tempo;
    this.nextBeat=Math.ceil(this.phaseAt(now+LEAD)-1e-9);
  }
  read(now) {
    this.nextBeat=Math.max(this.nextBeat,Math.ceil(this.phaseAt(now+.004)-1e-9));
    const events=[];
    for(let count=0;count<2;count++) {
      const at=this.anchor+(this.nextBeat-this.phase)*60/this.tempo;
      if(at>now+LOOKAHEAD)break;
      events.push(at);this.nextBeat++;
    }
    return events;
  }
}

/** The existing L-Systems synth, feeding the network instead of the speakers. */
class NetworkImpulseSynth extends LSystemsSynthAudio {
  constructor(target) {super(16,{adaptive:true,maxVoices:256});this.target=target;}
  buildGraph(context) {
    if(this.context&&this.context.state!=='closed')return;
    super.buildGraph(context);
    // The shared pool starts muted. Remove its default output synchronously,
    // before enable can raise the gain or any note can be scheduled.
    this.outputRelease?.();this.outputRelease=null;
    this.hostGate.disconnect();this.hostGate.connect(this.target);
  }
}

export function createImpulseSource({getContext,getTarget,canPlay,onChange=()=>{},onError=()=>{},
  poolFactory=target=>new NetworkImpulseSynth(target),timers=globalThis}={}) {
  let parameters={...IMPULSE_DEFAULTS},pool,poolContext,poolTarget,loading,enabled=false,playing=false,disposed=false,
    generation=0,timer,clock,noteCount=0,lastSentAt=-Infinity,lastNoteEnd=-Infinity;
  const now=()=>getContext()?.currentTime||0;
  function snapshot() {return {parameters:{...parameters},playing,enabled,pending:!!loading,noteCount,lastSentAt,
    sounding:enabled&&(playing||now()<lastNoteEnd)};}
  function emit(){if(!disposed)onChange();}
  function schedule(at) {
    if(!enabled||!pool?.enabled||!canPlay())return false;
    const p=parameters,envelope=impulseEnvelope(p);
    const voices=Math.min(256,Math.max(2,Math.ceil(envelope.duration*p.tempo/60)+2));
    pool.scheduleNotes([{key:`fractal-impulse:${++noteCount}`,frequency:p.frequency,pan:0,
      gain:p.level*lSystemTimbreGain(p.mode),...synthParametersForMode(p.mode,1,{
        fmIndex:p.index,pmIndex:p.index,fmRatio:p.ratio,pmRatio:p.ratio,
        shepardRate:p.shepardRate,shepardWidth:p.shepardWidth,
      })}],{envelopePoints:envelope.points,startAt:at,voiceLimit:voices,mode:p.mode});
    lastSentAt=at;lastNoteEnd=Math.max(lastNoteEnd,at+envelope.duration);emit();return true;
  }
  function pump() {
    if(!enabled||!playing||!canPlay()||getContext()?.state!=='running')return;
    for(const at of clock.read(now()))schedule(at);
  }
  function startRepeat() {
    if(timer!==undefined||!playing||!enabled||!canPlay())return;
    clock=new ImpulseClock(parameters.tempo,now());pump();timer=timers.setInterval(pump,25);
  }
  function stopRepeat() {if(timer!==undefined)timers.clearInterval(timer);timer=undefined;clock=undefined;pool?.cancelScheduledNotes();}
  async function enable() {
    const token=generation;
    if(disposed||!canPlay()||!getContext()||!getTarget())return false;
    if(loading){await loading;return disposed||token!==generation||!canPlay()?false:enable();}
    const context=getContext(),target=getTarget();
    if(pool&&(poolContext!==context||poolTarget!==target)) {
      enabled=false;stopRepeat();lastNoteEnd=-Infinity;
      void pool.close();pool=undefined;
    }
    if(enabled&&pool?.enabled){startRepeat();return true;}
    pool??=poolFactory(target);poolContext=context;poolTarget=target;
    const ownedPool=pool;
    pool.setLevel(1);pool.setTone(parameters.cutoff,parameters.resonance);
    loading=Promise.resolve().then(async()=>{
      try {
        if(disposed||token!==generation||!canPlay())return false;
        await ownedPool.enable({context});
        if(disposed||token!==generation||!canPlay()||context!==getContext()||target!==getTarget()) {
          ownedPool.disable();return false;
        }
        enabled=true;startRepeat();emit();return true;
      }catch(reason){
        if(token===generation&&!disposed&&canPlay()) {
          enabled=false;playing=false;stopRepeat();ownedPool.disable();onError(reason);
        }
        return false;
      }
    }).finally(()=>{loading=undefined;emit();});
    emit();return loading;
  }
  function disable(){generation++;enabled=false;playing=false;lastNoteEnd=-Infinity;stopRepeat();pool?.disable();emit();}
  function setParameters(patch) {
    const next=sanitizeImpulse({...parameters,...patch});
    if(clock&&next.tempo!==parameters.tempo){pool?.cancelScheduledNotes();clock.setTempo(next.tempo,now());}
    parameters=next;pool?.setTone(next.cutoff,next.resonance);pump();emit();return true;
  }
  async function setPlaying(value) {
    playing=!!value;
    if(!playing)stopRepeat();
    emit();if(playing&&canPlay())await enable();return playing;
  }
  async function send() {const token=generation;if(!await enable()||token!==generation||disposed)return false;return schedule(now()+LEAD);}
  async function dispose(){if(disposed)return;disable();disposed=true;await pool?.close();pool=undefined;}
  return {snapshot,enable,disable,setParameters,setPlaying,send,dispose};
}
