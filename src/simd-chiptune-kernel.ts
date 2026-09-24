// AssemblyScript port of Morphazoid's complete WebGPU Chiptune WGSL.
// Original musical source: "Chiptune (sound)", srtuss (2015),
// https://www.shadertoy.com/view/MljSRt — see the original renderer in
// src/instruments/webgpu-chiptune/webgpu-chiptune.js.
// Authored controls, sequence packing, and analytic echoes retain source units.
export const BLOCK_SIZE: i32 = 128;
export const PARAM_COUNT: i32 = 154;
export const VOICE_COUNT: i32 = 8;
export const PI2: f32 = 6.283185307179586476925286766559;
export const OUTPUT_CEILING: f32 = 0.88;
export const PREVIEW_DURATION: f32 = 0.22;
export const PREVIEW_HOLD: f32 = 0.14;
export const PREVIEW_GAIN: f32 = 1.6;
export let SAMPLE_RATE: f32 = 48000;
const OUTPUT_LEFT: usize = memory.data(BLOCK_SIZE * 4, 16);
const OUTPUT_RIGHT: usize = memory.data(BLOCK_SIZE * 4, 16);
const PARAMS: usize = memory.data(PARAM_COUNT * 4, 16);
const META: usize = memory.data(192, 16);
const CELLS: usize = memory.data(288 * 32, 16);
const TIME_INFO: usize = memory.data(16, 16);
export const FREQUENCY: usize = memory.data(32, 16);
export const WIDTH: usize = memory.data(32, 16);
export const TONE: usize = memory.data(32, 16);
export const KIND: usize = memory.data(32, 16);
export const PULSE_LEVEL: usize = memory.data(32, 16);
export const SINE_LEVEL: usize = memory.data(32, 16);
export const LEVEL_LEFT: usize = memory.data(32, 16);
export const LEVEL_RIGHT: usize = memory.data(32, 16);
export let texture: f32 = 0;
const GATE_OFFSETS_A: usize = memory.data(128,16);
const GATE_OFFSETS_B: usize = memory.data(128,16);
const GATE_DURATIONS_A: usize = memory.data(128,16);
const GATE_DURATIONS_B: usize = memory.data(128,16);
let gateCountA: i32=0;
let gateCountB: i32=0;
let gateSteps: f32=32;
export function prepare_parameters(): void {
  const p=params();
  gateCountA=0; gateCountB=0;
  gateSteps=clamp(round(p.gatePatternSteps),1,32);
  for(let step: u32=0;step < <u32>gateSteps;step++) {
    const a=packedGateDuration(p,false,step), b=packedGateDuration(p,true,step);
    if(a>0) { store<f32>(GATE_OFFSETS_A+<usize>(gateCountA<<2),<f32>step); store<f32>(GATE_DURATIONS_A+<usize>(gateCountA<<2),a); gateCountA++; }
    if(b>0) { store<f32>(GATE_OFFSETS_B+<usize>(gateCountB<<2),<f32>step); store<f32>(GATE_DURATIONS_B+<usize>(gateCountB<<2),b); gateCountB++; }
  }
}
@unmanaged
export class AudioParam {
  tempo: f32;
  transpose: f32;
  patternSeed: f32;
  pitchRange: f32;
  gateRate: f32;
  gateLength: f32;
  pulseWidth: f32;
  pwmDepth: f32;
  pwmRate: f32;
  upperOneLevel: f32;
  upperTwoLevel: f32;
  bassPulseLevel: f32;
  bassSineLevel: f32;
  leadLevel: f32;
  arpLevel: f32;
  noiseLevel: f32;
  stereoWidth: f32;
  kickLevel: f32;
  snareLevel: f32;
  hatLevel: f32;
  shakerLevel: f32;
  kickTone: f32;
  snareTone: f32;
  drumDecay: f32;
  drumMix: f32;
  ghostDrums: f32;
  echoTaps: f32;
  echoTime: f32;
  echoDecay: f32;
  echoStereo: f32;
  fadeIn: f32;
  gain: f32;
  scaleMask: f32;
  upperOneSpan: f32;
  upperTwoSpan: f32;
  bassSpan: f32;
  upperOneRegister: f32;
  bassRegister: f32;
  arpRegister: f32;
  sectionUnits: f32;
  pitchClock: f32;
  bassClock: f32;
  gateFastRatio: f32;
  gateSwitchShortUnits: f32;
  gateSwitchLongUnits: f32;
  leadTrillRate: f32;
  leadInterval: f32;
  leadPhraseUnits: f32;
  arpRate: f32;
  arpSpan: f32;
  arpOctaveRate: f32;
  arpOctaves: f32;
  bassPulseWidth: f32;
  drumRate: f32;
  echoCrossfeed: f32;
  gateAttack: f32;
  gateRelease: f32;
  texturePeriod: f32;
  textureDecay: f32;
  kickCycle: f32;
  kickSubcycle: f32;
  snareNoiseMix: f32;
  hatBalance: f32;
  ghostDelayDivisor: f32;
  ghostPan: f32;
  gateA0: f32;
  gateA1: f32;
  gateA2: f32;
  gateA3: f32;
  gateB0: f32;
  gateB1: f32;
  gateB2: f32;
  gateB3: f32;
  gatePatternSteps: f32;
  gateShortRatio: f32;
  gateLongRatio: f32;
  fastGateShare: f32;
  longGateBoostShare: f32;
  leadSectionShare: f32;
  leadTrillShare: f32;
  tuningCents: f32;
  upperTwoRegister: f32;
  leadRegister: f32;
  leadClock: f32;
  leadSpan: f32;
  arpBassFollow: f32;
  voiceCrossfeed: f32;
  synthMix: f32;
  fadeCurve: f32;
  echoAlternate: f32;
  snareCycle: f32;
  snarePhase: f32;
  hatACycle: f32;
  hatASubcycle: f32;
  hatARepeat: f32;
  hatAPhase: f32;
  hatBCycle: f32;
  shakerCycle: f32;
  shakerPhase: f32;
  noiseRate: f32;
  noiseColor: f32;
  textureSweep: f32;
  kickBodyPhase: f32;
  kickTransientPhase: f32;
  kickBodySweep: f32;
  kickTransientSweep: f32;
  kickAttackTime: f32;
  kickDecayRate: f32;
  kickClipKnee: f32;
  snareHoldTime: f32;
  snareDecayRate: f32;
  snareNoiseSweep: f32;
  snareNoiseRate: f32;
  snareModRate: f32;
  snareModDepth: f32;
  snareCarrierRate: f32;
  hatANoiseRate: f32;
  hatADecayRate: f32;
  hatBLowNoiseRate: f32;
  hatBHighNoiseRate: f32;
  hatBHighMix: f32;
  hatBDecayRate: f32;
  shakerNoiseRate: f32;
  shakerDecayRate: f32;
  upperTwoClockRatio: f32;
  kickPhase: f32;
  hatBPhase: f32;
  hatARepeatPhase: f32;
  arpPhase: f32;
  echoWet: f32;
  arpGateDepth: f32;
  bassGateRateRatio: f32;
  leadGateRateRatio: f32;
  upperTwoGateRateRatio: f32;
  snareNoiseColor: f32;
  hatANoiseColor: f32;
  hatBNoiseColor: f32;
  shakerNoiseColor: f32;
  upperOnePhase: f32;
  upperTwoPhase: f32;
  bassPhase: f32;
  leadPhase: f32;
  gatePatternPhase: f32;
  gateSwitchShortPhase: f32;
  gateSwitchLongPhase: f32;
  sectionPhase: f32;
  leadTrillPhase: f32;
  leadPhrasePhase: f32;
  arpOctavePhase: f32;
  texturePhase: f32;
  upperOneTone: f32;
  upperTwoTone: f32;
  leadTone: f32;
  arpTone: f32;
}
@unmanaged
class TimeInfo { offset: f32; preview_lane: f32; preview_value: f32; preview_start: f32; }
export function params(): AudioParam { return changetype<AudioParam>(PARAMS); }
const time_info = changetype<TimeInfo>(TIME_INFO);
export function output_left_ptr(): usize { return OUTPUT_LEFT; }
export function output_right_ptr(): usize { return OUTPUT_RIGHT; }
export function params_ptr(): usize { return PARAMS; }
export function sequence_meta_ptr(): usize { return META; }
export function sequence_cells_ptr(): usize { return CELLS; }
export function time_info_ptr(): usize { return TIME_INFO; }
export function block_size(): i32 { return BLOCK_SIZE; }
export function param_count(): i32 { return PARAM_COUNT; }
export function voice_count(): i32 { return VOICE_COUNT; }
export function set_sample_rate(value: f32): void { SAMPLE_RATE = max(8000, min(192000, value)); }
export function reset(): void {
  memory.fill(OUTPUT_LEFT, 0, BLOCK_SIZE * 4); memory.fill(OUTPUT_RIGHT, 0, BLOCK_SIZE * 4);
  memory.fill(LEVEL_LEFT, 0, 32); memory.fill(LEVEL_RIGHT, 0, 32);
  time_info.offset = 0; time_info.preview_lane = -1; time_info.preview_value = 0; time_info.preview_start = -100;
}
export function put_sample(index: i32, left: f32, right: f32): void {
  store<f32>(OUTPUT_LEFT + <usize>(index << 2), isFinite(left) ? clamp(left, -OUTPUT_CEILING, OUTPUT_CEILING) : 0);
  store<f32>(OUTPUT_RIGHT + <usize>(index << 2), isFinite(right) ? clamp(right, -OUTPUT_CEILING, OUTPUT_CEILING) : 0);
}
export function pair(x: f32, y: f32): u64 { return <u64>reinterpret<u32>(x) | (<u64>reinterpret<u32>(y) << 32); }
export function pairX(value: u64): f32 { return reinterpret<f32>(<u32>value); }
export function pairY(value: u64): f32 { return reinterpret<f32>(<u32>(value >> 32)); }
export function max(a: f32, b: f32): f32 { return Mathf.max(a,b); }
export function min(a: f32, b: f32): f32 { return Mathf.min(a,b); }
export function clamp(a: f32, lo: f32, hi: f32): f32 { return max(lo,min(hi,a)); }
export function floor(a: f32): f32 { return Mathf.floor(a); }
export function round(a: f32): f32 { return Mathf.round(a); }
export function fract(a: f32): f32 { return a-floor(a); }
export function sin(a: f32): f32 { return Mathf.sin(a); }
export function exp(a: f32): f32 { return Mathf.exp(a); }
export function pow(a: f32,b: f32): f32 { return Mathf.pow(a,b); }
export function abs(a: f32): f32 { return Mathf.abs(a); }
export function mix(a: f32,b: f32,t: f32): f32 { return a+(b-a)*t; }
export function select<T>(a: T,b: T,condition: bool): T { return condition ? b : a; }
export function smoothstep(a: f32,b: f32,x: f32): f32 { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
export function sequenceLength(lane: u32): u32 { const value=load<u32>(META+16+(<usize>lane<<2)); return value<1 ? 1 : value>32 ? 32 : value; }
export function patternMode(): bool { return load<u32>(META+52)==1; }
export function laneRate(lane: u32,fallback: f32): f32 { return max(patternMode() ? load<f32>(META+64+(<usize>lane<<2)) : fallback, 0.000001); }
export function patternEnvelope(lane: u32,beat: f32,tempo: f32): f32 {
  const rate=laneRate(lane,1); const phase=fract(beat*rate); const duration: f32=1/(tempo*rate);
  const edge=min(.2,.003/max(duration,.000001)); const gate=load<f32>(META+128+(<usize>lane<<2));
  return smoothstep(0,edge,phase)*(1-smoothstep(max(edge,gate-edge),gate,phase));
}
export let cellValue: f32=0;
export let cellState: u32=0;
export let cellVelocity: f32=1;
export function sequenceCellAt(lane: u32,beat: f32,rate: f32,phase: f32): void {
  const length=sequenceLength(lane);
  const position=modulo(beat*laneRate(lane,rate)+(patternMode()?0:phase)*<f32>length,<f32>length);
  const index=<u32>max(floor(position),0);
  const address=CELLS+<usize>((lane*32+(index<length?index:length-1))*32);
  const held=beat/max(params().tempo,.000001)<load<f32>(address+16);
  cellValue=load<f32>(address+(held?8:0)); cellState=load<u32>(address+(held?12:4)); cellVelocity=load<f32>(address+(held?28:24));
}
export function scaleLock(y: f32,maskSource: f32): f32 {
  const x=modulo(y,12); const mask=<u32>clamp(round(maskSource),1,4095);
  let nearest: f32=1e10; let signed: f32=0;
  for(let note: u32=0;note<=12;note++) if((mask&(1<<(note%12)))!=0) {
    const candidate=x-<f32>note; if(abs(candidate)<nearest) { nearest=abs(candidate); signed=candidate; }
  }
  return y-signed;
}
export function widenStereo(value: u64,width: f32): u64 {
  const middle=(pairX(value)+pairY(value))*.5; const side=(pairX(value)-pairY(value))*.5*width;
  return pair(middle+side,middle-side);
}
export function voiceBalance(right: bool,p: AudioParam): u64 {
  const crossfeed=clamp(p.voiceCrossfeed,0,1); const normalization: f32=1.5/(1+crossfeed);
  return right ? pair(crossfeed*normalization,normalization) : pair(normalization,crossfeed*normalization);
}
export function drumSequenceTiming(lane: u32,beat: f32,rate: f32,tempo: f32,sourceTime: f32): u64 {
  sequenceCellAt(lane,beat,rate,0);
  const manualTime=sequenceStepTime(lane,beat,rate,tempo);
  const duration: f32=1/max(tempo*laneRate(lane,rate),.000001);
  const fadeStart=max(0,duration-min(.004,duration*.25));
  const tail: f32=1-smoothstep(fadeStart,duration,manualTime);
  const activity: f32=(cellState==2?0:1)*(cellState==1?tail*clamp(cellValue,0,1):1);
  return pair(cellState==1?manualTime:sourceTime,activity);
}
export function modulo(x: f32, y: f32) : f32 {
  return x - floor(x / y) * y;
}

export function sequenceStepTime(
  lane: u32,
  master_beat: f32,
  rate: f32,
  tempo_hz: f32,
) : f32 {
  let length = sequenceLength(lane);
  let effective_rate = laneRate(lane, rate);
  let position = modulo(master_beat * effective_rate, f32(length));
  return fract(position) / max(tempo_hz * effective_rate, 0.000001);
}

export function stepValue(edge: f32, x: f32) : f32 {
  return select<f32>(0.0, 1.0, x >= edge);
}

export function smoothAny(edge0: f32, edge1: f32, x: f32) : f32 {
  let width = edge1 - edge0;
  if (abs(width) < 0.000001) { return stepValue(edge0, x); }
  let t = clamp((x - edge0) / width, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

export function sine(phase: f32) : f32 {
  return sin(phase * PI2);
}

export function shns(x: f32, p: AudioParam) : f32 {
  return fract(sin(floor(x * p.noiseRate)) * 29919.0) - 0.5;
}

export function hpns(x: f32, h: f32, p: AudioParam) : f32 {
  let colored_h = h * p.noiseColor;
  return shns(x + colored_h, p) - shns(x - colored_h, p);
}

export function noteGate(
  t_source: f32,
  offset: f32,
  duration: f32,
  length: f32,
  pattern_steps: f32,
  attack: f32,
  release: f32,
) : f32 {
  let pattern_period = max(round(pattern_steps), 1.0);
  let t = modulo(t_source - offset, pattern_period);
  let scaled_duration = max(0.05, duration * length);
  let attack_width = max(attack, 0.001);
  let release_width = max(release, 0.001);
  let current_gate = smoothAny(-attack_width, 0.0, t)
    * smoothAny(0.0, -release_width, t - scaled_duration);
  let next_t = t - pattern_period;
  let next_gate = smoothAny(-attack_width, 0.0, next_t)
    * smoothAny(0.0, -release_width, next_t - scaled_duration);
  return max(current_gate, next_gate);
}

export function packedGateCode(p: AudioParam, lane_b: bool, segment: u32) : u32 {
  let code: f32 = 0.0;
  switch (segment) {
    case 0: { code = select(p.gateA0, p.gateB0, lane_b); break; }
    case 1: { code = select(p.gateA1, p.gateB1, lane_b); break; }
    case 2: { code = select(p.gateA2, p.gateB2, lane_b); break; }
    default: { code = select(p.gateA3, p.gateB3, lane_b); }
  }
  return u32(clamp(round(code), 0.0, 65535.0));
}

export function packedGateDuration(p: AudioParam, lane_b: bool, step: u32) : f32 {
  let code = packedGateCode(p, lane_b, step / 8);
  let state = (code >> ((step % 8) * 2)) & 3;
  switch (state) {
    case 1: { return p.gateShortRatio; }
    case 2: { return 1.0; }
    case 3: { return p.gateLongRatio; }
    default: { return 0.0; }
  }
}

export function patternGate(t: f32,length: f32,p: AudioParam,lane_b: bool): f32 {
  let value: f32=0;
  const phased=t+p.gatePatternPhase*gateSteps;
  const offsets=lane_b?GATE_OFFSETS_B:GATE_OFFSETS_A;
  const durations=lane_b?GATE_DURATIONS_B:GATE_DURATIONS_A;
  const count=lane_b?gateCountB:gateCountA;
  for(let i=0;i<count;i++) {
    value+=noteGate(phased,load<f32>(offsets+<usize>(i<<2)),load<f32>(durations+<usize>(i<<2)),length,gateSteps,p.gateAttack,p.gateRelease);
    if(value>=1) return 1;
  }
  return clamp(value,0,1);
}
export function test_pattern_gate(time: f32,length: f32,laneB: i32): f32 {
  prepare_parameters(); return patternGate(time,length,params(),laneB!=0);
}

export function gate(t: f32, length: f32, p: AudioParam) : f32 {
  return patternGate(t, length, p, false);
}

export function gateOne(t: f32, length: f32, p: AudioParam) : f32 {
  return patternGate(t, length, p, true);
}

export function previewEnvelope(time: f32) : f32 {
  let local_time = time - time_info.preview_start;
  return smoothAny(0.0, 0.004, local_time)
    * smoothAny(0.0, PREVIEW_HOLD - PREVIEW_DURATION, local_time - PREVIEW_DURATION);
}

export function blep(t_source: f32, dt_source: f32) : f32 {
  let dt = clamp(dt_source, 0.000001, 0.5);
  if (t_source < dt) {
    let t = t_source / dt;
    return t + t - t * t - 1.0;
  }
  if (t_source > 1.0 - dt) {
    let t = (t_source - 1.0) / dt;
    return t * t + t + t + 1.0;
  }
  return 0.0;
}

export function sawWave(time: f32, frequency: f32) : f32 {
  let phase = fract(time * frequency);
  return phase * 2.0 - 1.0 - blep(phase, frequency / SAMPLE_RATE);
}

export function squareWave(time: f32, frequency: f32, pulse_width: f32) : f32 {
  let phase = fract(time * frequency);
  let value: f32 = select<f32>(-1.0, 1.0, phase < pulse_width);
  value += blep(phase, frequency / SAMPLE_RATE);
  value -= blep(fract(phase - pulse_width), frequency / SAMPLE_RATE);
  return value;
}

export function noteFrequency(note: f32, p: AudioParam) : f32 {
  let frequency: f32 = 440.0 * pow(2.0, (note + p.tuningCents / 100.0) / 12.0);
  return clamp(frequency, 20.0, SAMPLE_RATE * 0.45);
}

export function voiceTone(wave: f32, fundamental: f32, tone: f32) : f32 {
  let warm = mix(wave, fundamental, max(-tone, 0.0));
  let drive = max(tone, 0.0) * 3.0;
  return warm * (1.0 + drive) / (1.0 + drive * abs(warm));
}

export function beatTwo(time: f32, p: AudioParam) : f32 {
  let tempo = p.tempo * max(p.drumRate, 0.01);
  let master_beat = time * p.tempo;
  let sequence_rate = max(p.drumRate, 0.01) * 4.0;
  let decay = max(p.drumDecay, 0.1);
  let value: f32 = 0.0;

  let tb = modulo(
    time * tempo - p.kickPhase * p.kickCycle,
    max(p.kickCycle, 0.05),
  );
  tb = modulo(tb, max(p.kickSubcycle, 0.05)) / tempo;
  let kick_sequence = drumSequenceTiming(
    5, master_beat, sequence_rate, p.tempo, tb,
  );
  tb = pairX(kick_sequence);
  let kick = sin(
    exp(tb * -p.kickBodySweep) * p.kickBodyPhase * p.kickTone
    + exp(tb * -p.kickTransientSweep) * p.kickTransientPhase * p.kickTone
  ) * exp(
    max(p.kickAttackTime - tb, 0.0) * (-p.kickDecayRate / decay),
  ) * exp(tb * (-p.kickDecayRate / decay));
  kick = smoothAny(-p.kickClipKnee, p.kickClipKnee, kick) * 2.0 - 1.0;
  value = kick * pairY(kick_sequence) * 0.3 * p.kickLevel;

  tb = modulo(
    time * tempo - p.snarePhase * p.snareCycle,
    max(p.snareCycle, 0.01),
  ) / tempo;
  let snare_sequence = drumSequenceTiming(
    6, master_beat, sequence_rate, p.tempo, tb,
  );
  tb = pairX(snare_sequence);
  let snare_envelope = exp(
    max(tb - p.snareHoldTime, 0.0) * (-p.snareDecayRate / decay),
  );
  let snare_mix = clamp(p.snareNoiseMix, 0.0, 1.0);
  value += (
    hpns(
      exp(-tb * p.snareNoiseSweep) * p.snareNoiseRate,
      0.0002 * p.snareNoiseColor,
      p,
    )
      * snare_envelope * 0.9 * snare_mix
    + sin(
      sin(tb * p.snareModRate * p.snareTone) * p.snareModDepth
        + tb * p.snareCarrierRate * p.snareTone
    )
      * snare_envelope * 0.9 * (1.0 - snare_mix)
  ) * pairY(snare_sequence) * 0.6 * p.snareLevel;

  tb = modulo(
    time * tempo + p.hatAPhase * p.hatACycle,
    max(p.hatACycle, 0.01),
  );
  tb = modulo(tb, max(p.hatASubcycle, 0.01));
  tb = modulo(
    tb - 1.0 - p.hatARepeatPhase * p.hatARepeat,
    max(p.hatARepeat, 0.01),
  ) / tempo;
  let hat_a_sequence = drumSequenceTiming(
    7, master_beat, sequence_rate, p.tempo, tb,
  );
  tb = pairX(hat_a_sequence);
  let hat_mix = clamp(p.hatBalance, 0.0, 1.0);
  value += hpns(tb * p.hatANoiseRate, 0.0002 * p.hatANoiseColor, p)
    * exp(tb * (-p.hatADecayRate / decay))
    * pairY(hat_a_sequence) * 0.45 * (1.0 - hat_mix) * p.hatLevel;

  tb = modulo(
    time * tempo - p.hatBPhase * p.hatBCycle,
    max(p.hatBCycle, 0.01),
  ) / tempo;
  let hat_b_sequence = drumSequenceTiming(
    7, master_beat, sequence_rate, p.tempo, tb,
  );
  tb = pairX(hat_b_sequence);
  value += (
    hpns(tb * p.hatBLowNoiseRate, 0.00002 * p.hatBNoiseColor, p)
      + hpns(tb * p.hatBHighNoiseRate, 0.002 * p.hatBNoiseColor, p)
        * p.hatBHighMix
  ) * exp(tb * (-p.hatBDecayRate / decay))
    * pairY(hat_b_sequence) * 0.45 * hat_mix * p.hatLevel;

  tb = modulo(
    time * tempo - p.shakerPhase * p.shakerCycle,
    max(p.shakerCycle, 0.01),
  ) / tempo;
  let shaker_sequence = drumSequenceTiming(
    8, master_beat, sequence_rate, p.tempo, tb,
  );
  tb = pairX(shaker_sequence);
  value += hpns(tb * p.shakerNoiseRate, 0.0002 * p.shakerNoiseColor, p)
    * exp(tb * (-p.shakerDecayRate / decay))
    * pairY(shaker_sequence) * 0.3 * p.shakerLevel;
  return value;
}

function writeVoice(index: i32, frequency: f32, width: f32, kind: f32, tone: f32, level: f32, balance: u64): void {
  const offset=<usize>(index<<2);
  store<f32>(FREQUENCY+offset,frequency); store<f32>(WIDTH+offset,width);
  store<f32>(KIND+offset,kind); store<f32>(TONE+offset,tone);
  store<f32>(PULSE_LEVEL+offset,1); store<f32>(SINE_LEVEL+offset,0);
  store<f32>(LEVEL_LEFT+offset,level*pairX(balance)); store<f32>(LEVEL_RIGHT+offset,level*pairY(balance));
}
function writeBass(index: i32, frequency: f32, level: f32, p: AudioParam): void {
  writeVoice(index,frequency,p.bassPulseWidth,2,0,level,pair(1,1));
  const offset=<usize>(index<<2);
  store<f32>(PULSE_LEVEL+offset,1.5*p.bassPulseLevel); store<f32>(SINE_LEVEL+offset,2*p.bassSineLevel);
}
function sourceInput(lane: u32,beat: f32,clock: f32,phase: f32,span: f32,p: AudioParam): f32 {
  sequenceCellAt(lane,beat,clock,phase);
  const source=floor(beat*clock+phase*<f32>sequenceLength(lane));
  const generated=floor(fract(source*source*p.patternSeed)*span*p.pitchRange);
  return cellState==1 ? cellValue : generated;
}
function activity(): f32 { return cellState==2 ? 0 : cellVelocity; }
function preparePattern(time: f32,p: AudioParam,width: f32): void {
  const beat=time*p.tempo;
  for(let lane: u32=0;lane<5;lane++) {
    sequenceCellAt(lane,beat,1,0);
    if(cellState==2 || cellVelocity<=0) continue;
    let offset=cellValue;
    let voiceRegister=p.upperOneRegister; let level=p.upperOneLevel; let tone=p.upperOneTone;
    if(lane==1) { voiceRegister=p.upperTwoRegister; level=p.upperTwoLevel; tone=p.upperTwoTone; }
    if(lane==2) voiceRegister=p.bassRegister;
    if(lane==3) { voiceRegister=p.leadRegister; level=p.leadLevel*1.5; tone=p.leadTone; }
    if(lane==4) { voiceRegister=p.arpRegister; offset*=p.arpSpan*p.pitchRange; level=p.arpLevel; tone=p.arpTone; }
    const frequency=noteFrequency(scaleLock(offset,p.scaleMask)+voiceRegister+p.transpose,p);
    const envelope=patternEnvelope(lane,beat,p.tempo)*cellVelocity;
    if(lane==2) { writeBass(<i32>lane,frequency,envelope,p); continue; }
    let balance=pair(1,1);
    if(lane==0) balance=widenStereo(voiceBalance(false,p),p.stereoWidth);
    if(lane==1 || lane==4) balance=widenStereo(voiceBalance(true,p),p.stereoWidth);
    writeVoice(<i32>lane,frequency,width,lane>=3?1:0,tone,level*envelope,balance);
  }
}
function preparePreview(time: f32,p: AudioParam,width: f32,bassBasis: f32): void {
  const envelope=previewEnvelope(time);
  if(time_info.preview_lane<0 || envelope<=0) return;
  const lane=<u32>clamp(round(time_info.preview_lane),0,4);
  const beat=time*p.tempo;
  let note=scaleLock(time_info.preview_value,p.scaleMask);
  let level=p.upperOneLevel; let voiceRegister=p.upperOneRegister;
  let balance=widenStereo(voiceBalance(false,p),p.stereoWidth);
  if(lane==1) { level=p.upperTwoLevel; voiceRegister=p.upperTwoRegister; balance=widenStereo(voiceBalance(true,p),p.stereoWidth); }
  if(lane==2) {
    writeBass(5,noteFrequency(note+p.bassRegister+p.transpose,p),envelope*PREVIEW_GAIN,p);
    return;
  }
  if(lane==3) {
    note+=stepValue(1-p.leadTrillShare,fract(beat*p.leadTrillRate+p.leadTrillPhase))*p.leadInterval;
    voiceRegister=p.leadRegister; level=1.5*p.leadLevel; balance=pair(1,1);
  }
  if(lane==4) {
    const span=max(p.arpSpan,.01);
    note=scaleLock(clamp(time_info.preview_value,0,1)*span*p.pitchRange,p.scaleMask)
      +bassBasis*p.arpBassFollow
      +floor(abs(modulo(beat*p.arpOctaveRate+p.arpOctavePhase*2,2)-1)*p.arpOctaves)*12;
    voiceRegister=p.arpRegister; level=p.arpLevel; balance=widenStereo(voiceBalance(true,p),p.stereoWidth);
  }
  writeVoice(5,noteFrequency(note+voiceRegister+p.transpose,p),width,lane>=3?1:0,0,level*envelope*PREVIEW_GAIN,balance);
}

// Populate all five original pitched stems and the same-shader preview voice.
// Gate/pitch control is scalar; the renderers process this structure of arrays
// either one voice or four independent voices at once, with no heap allocation.
export function prepare_synth(time: f32): void {
  const p=params();
  memory.fill(LEVEL_LEFT,0,32); memory.fill(LEVEL_RIGHT,0,32);
  texture=0;
  const beat=time*p.tempo;
  const width=clamp(sin(time*p.pwmRate)*p.pwmDepth+p.pulseWidth,.02,.98);
  if(patternMode()) { preparePattern(time,p,width); return; }
  const shortSwitch=fract(beat/max(p.gateSwitchShortUnits,.01)+p.gateSwitchShortPhase);
  const longSwitch=fract(beat/max(p.gateSwitchLongUnits,.01)+p.gateSwitchLongPhase);
  const p0=stepValue(1-p.fastGateShare,shortSwitch);
  const p1=max(p0,1-stepValue(p.longGateBoostShare,longSwitch));
  const section=stepValue(p.leadSectionShare,fract(beat/max(p.sectionUnits,.01)+p.sectionPhase));
  const duck=mix(1,.22,previewEnvelope(time));

  let input=sourceInput(0,beat,p.pitchClock,p.upperOnePhase,p.upperOneSpan,p);
  let note=scaleLock(input,p.scaleMask)+p.upperOneRegister+p.transpose;
  let envelope=gate(beat*8*mix(1,p.gateFastRatio,p0)*p.gateRate,p.gateLength,p)*section;
  writeVoice(0,noteFrequency(note,p),width,0,p.upperOneTone,envelope*p.upperOneLevel*activity()*duck,widenStereo(voiceBalance(false,p),p.stereoWidth));

  input=sourceInput(1,beat,p.pitchClock*p.upperTwoClockRatio,p.upperTwoPhase,p.upperTwoSpan,p);
  note=scaleLock(input,p.scaleMask)+p.upperTwoRegister+p.transpose;
  envelope=gate(beat*8*mix(1,p.gateFastRatio,p1)*p.gateRate*p.upperTwoGateRateRatio,p.gateLength,p)*section;
  writeVoice(1,noteFrequency(note,p),width,0,p.upperTwoTone,envelope*p.upperTwoLevel*activity()*duck,widenStereo(voiceBalance(true,p),p.stereoWidth));

  input=sourceInput(2,beat,p.bassClock,p.bassPhase,p.bassSpan,p);
  const bassBasis=scaleLock(input,p.scaleMask);
  note=bassBasis+p.bassRegister+p.transpose;
  const bassGate=gate(beat*8*p.gateRate*p.bassGateRateRatio,p.gateLength,p);
  writeBass(2,noteFrequency(note,p),bassGate*activity()*duck,p);

  input=sourceInput(3,beat,p.leadClock,p.leadPhase,p.leadSpan,p);
  note=scaleLock(input,p.scaleMask)+stepValue(1-p.leadTrillShare,fract(beat*p.leadTrillRate+p.leadTrillPhase))*p.leadInterval+p.leadRegister+p.transpose;
  const phrase=max(p.leadPhraseUnits,.01);
  envelope=gateOne(modulo(beat+p.leadPhrasePhase*phrase,phrase)*8*p.gateRate*p.leadGateRateRatio,p.gateLength,p)*(1-section);
  writeVoice(3,noteFrequency(note,p),width,1,p.leadTone,envelope*1.5*p.leadLevel*activity()*duck,pair(1,1));

  const span=max(p.arpSpan,.01);
  sequenceCellAt(4,beat,p.arpRate,p.arpPhase);
  const generated=abs(modulo(beat*p.arpRate+p.arpPhase*span*2,span*2)-span);
  const contour=cellState==1 ? clamp(cellValue,0,1)*span : generated;
  note=scaleLock(contour*p.pitchRange,p.scaleMask)+bassBasis*p.arpBassFollow
    +floor(abs(modulo(beat*p.arpOctaveRate+p.arpOctavePhase*2,2)-1)*p.arpOctaves)*12
    +p.arpRegister+p.transpose;
  const arpGate=mix(1,bassGate,p.arpGateDepth);
  writeVoice(4,noteFrequency(note,p),width,1,p.arpTone,p.arpLevel*arpGate*activity()*duck,widenStereo(voiceBalance(true,p),p.stereoWidth));
  preparePreview(time,p,width,bassBasis);
  const period=max(p.texturePeriod,.01);
  const noiseTime=modulo(beat+p.texturePhase*period,period);
  texture=hpns(exp(noiseTime*-p.textureSweep),.0002,p)*exp(noiseTime*-p.textureDecay)*p.noiseLevel;
}
