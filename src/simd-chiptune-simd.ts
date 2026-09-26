import {
  BLOCK_SIZE, FREQUENCY, WIDTH, TONE, KIND, PULSE_LEVEL, SINE_LEVEL, LEVEL_LEFT, LEVEL_RIGHT,
  SAMPLE_RATE, texture, params, prepare_synth, prepare_parameters, pair, pairX, pairY, set_sample_rate,
  put_sample, beatTwo, previewEnvelope, widenStereo, clamp, round, max, pow, mix,
  squareWave, sawWave, sine, voiceTone, musicalTempo,
  STEM_OSC_LEFT, STEM_OSC_RIGHT, stemMetering, begin_synth_meter, begin_sample_meter,
  meter_synth_echo, capture_dry_drum_meters, meter_drums, finish_sample_meter, clear_stem_peaks,
} from "./simd-chiptune-kernel";
export {
  output_left_ptr, output_right_ptr, params_ptr, sequence_meta_ptr, sequence_cells_ptr,
  time_info_ptr, block_size, param_count, voice_count, reset, test_pattern_gate,
  tempo_clock_ptr, set_tempo_clock, musicalBeat, stem_peaks_ptr, stem_count, set_metering,
} from "./simd-chiptune-kernel";
export function lane_width(): i32 { return 4; }
function splat(value: f32): v128 { return v128.splat<f32>(value); }
function add(a: v128,b: v128): v128 { return v128.add<f32>(a,b); }
function sub(a: v128,b: v128): v128 { return v128.sub<f32>(a,b); }
function mul(a: v128,b: v128): v128 { return v128.mul<f32>(a,b); }
function fract4(value: v128): v128 { return sub(value,v128.floor<f32>(value)); }
function blep4(phase: v128,delta: v128): v128 {
  const dt=v128.max<f32>(splat(.000001),v128.min<f32>(splat(.5),delta));
  const start=v128.div<f32>(phase,dt);
  const before=sub(sub(add(start,start),mul(start,start)),splat(1));
  const end=v128.div<f32>(sub(phase,splat(1)),dt);
  const after=add(add(add(mul(end,end),end),end),splat(1));
  const tail=v128.bitselect(after,splat(0),v128.gt<f32>(phase,sub(splat(1),dt)));
  return v128.bitselect(before,tail,v128.lt<f32>(phase,dt));
}
function sine4(cycles: v128): v128 {
  // The source's transcendental is scalar on Wasm. Keeping the same function
  // for both variants also prevents chaotic hash-noise drift between kernels.
  let result=splat(sine(v128.extract_lane<f32>(cycles,0)));
  result=v128.replace_lane<f32>(result,1,sine(v128.extract_lane<f32>(cycles,1)));
  result=v128.replace_lane<f32>(result,2,sine(v128.extract_lane<f32>(cycles,2)));
  return v128.replace_lane<f32>(result,3,sine(v128.extract_lane<f32>(cycles,3)));
}
export function render_synth(time: f32): u64 {
  begin_synth_meter();
  if(params().synthMix==0) return pair(0,0);
  prepare_synth(time);
  let left: f32=0; let right: f32=0;
  for(let group: usize=0;group<32;group+=16) {
    const gainLeft=v128.load(LEVEL_LEFT+group), gainRight=v128.load(LEVEL_RIGHT+group);
    if(!v128.any_true(v128.or(gainLeft,gainRight))) continue;
    const frequency=v128.load(FREQUENCY+group);
    const kind=v128.load(KIND+group);
    const cycles=mul(splat(time),frequency);
    const fundamental=sine4(cycles);
    const phase=fract4(cycles);
    const delta=v128.div<f32>(frequency,splat(SAMPLE_RATE));
    const edge=blep4(phase,delta);
    const width=v128.load(WIDTH+group);
    const pulse=v128.bitselect(splat(1),splat(-1),v128.lt<f32>(phase,width));
    const square=sub(add(pulse,edge),blep4(fract4(sub(phase,width)),delta));
    const saw=sub(sub(mul(phase,splat(2)),splat(1)),edge);
    const oscillator=v128.bitselect(saw,square,v128.eq<f32>(kind,splat(1)));
    const tone=v128.load(TONE+group);
    const warm=add(oscillator,mul(sub(fundamental,oscillator),v128.max<f32>(sub(splat(0),tone),splat(0))));
    const drive=mul(v128.max<f32>(tone,splat(0)),splat(3));
    let wave=v128.div<f32>(mul(warm,add(splat(1),drive)),add(splat(1),mul(drive,v128.abs<f32>(warm))));
    const bass=add(mul(square,v128.load(PULSE_LEVEL+group)),mul(fundamental,v128.load(SINE_LEVEL+group)));
    wave=v128.bitselect(bass,wave,v128.eq<f32>(kind,splat(2)));
    const outputLeft=mul(wave,gainLeft),outputRight=mul(wave,gainRight);
    if (stemMetering) { v128.store(STEM_OSC_LEFT+group,outputLeft); v128.store(STEM_OSC_RIGHT+group,outputRight); }
    left+=v128.extract_lane<f32>(outputLeft,0); left+=v128.extract_lane<f32>(outputLeft,1);
    left+=v128.extract_lane<f32>(outputLeft,2); left+=v128.extract_lane<f32>(outputLeft,3);
    right+=v128.extract_lane<f32>(outputRight,0); right+=v128.extract_lane<f32>(outputRight,1);
    right+=v128.extract_lane<f32>(outputRight,2); right+=v128.extract_lane<f32>(outputRight,3);
  }
  const scale: f32=.2*params().synthMix;
  return pair((left+texture)*scale,(right+texture)*scale);
}

// Each echo is an analytic re-evaluation, exactly as in the source shader.
// A delay ring would change held-cell transitions, seeking, and preset recall.
export function render_sample(time: f32): u64 {
  begin_sample_meter();
  const p=params();
  let left: f32=0; let right: f32=0; let amplitude: f32=1; let swapped=false; let delayTime: f32=0;
  const taps=<i32>clamp(round(p.echoTaps),1,8);
  const crossfeed=clamp(p.echoCrossfeed,0,1);
  for(let tap=0;tap<taps;tap++) {
    const source=render_synth(time-delayTime);
    const sourceLeft=swapped?pairY(source):pairX(source);
    const sourceRight=swapped?pairX(source):pairY(source);
    const wet: f32=tap>0?p.echoWet:1;
    const wide=widenStereo(pair(sourceLeft*(swapped?crossfeed:1),sourceRight*(swapped?1:crossfeed)),p.echoStereo);
    left+=pairX(wide)*amplitude*wet; right+=pairY(wide)*amplitude*wet;
    meter_synth_echo(amplitude,wet,swapped,crossfeed,p);
    if(p.echoAlternate>=.5) swapped=!swapped;
    amplitude*=p.echoDecay; delayTime+=p.echoTime;
  }
  if(p.drumMix!=0) {
    const pan=clamp(p.ghostPan,-1,1);
    const drums=beatTwo(time,p);
    capture_dry_drum_meters();
    const ghosts=beatTwo(time-musicalTempo(time)/max(p.ghostDelayDivisor,.25),p);
    const duck=mix(1,.22,previewEnvelope(time));
    meter_drums(drums,ghosts,pan,duck,p);
    left+=(drums*.8+ghosts*.25*(1-pan)*p.ghostDrums)*p.drumMix*duck;
    right+=(drums*.8+ghosts*.25*(1+pan)*p.ghostDrums)*p.drumMix*duck;
  }
  const fade=pow(clamp(max(time,0)/max(p.fadeIn,.01),0,1),max(p.fadeCurve,.01));
  finish_sample_meter(fade,p.gain);
  return pair(left*fade*p.gain,right*fade*p.gain);
}
export function process(framesValue: i32,sampleRate: f32,timeSeconds: f32): void {
  set_sample_rate(sampleRate);
  prepare_parameters();
  clear_stem_peaks();
  const frames=framesValue<0?0:framesValue>BLOCK_SIZE?BLOCK_SIZE:framesValue;
  for(let frame=0;frame<frames;frame++) {
    const time: f32=timeSeconds+<f32>frame/SAMPLE_RATE;
    const result=render_sample(time);
    put_sample(frame,pairX(result),pairY(result));
  }
}
