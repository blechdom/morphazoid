import {
  BLOCK_SIZE, FREQUENCY, WIDTH, TONE, KIND, PULSE_LEVEL, SINE_LEVEL, LEVEL_LEFT, LEVEL_RIGHT,
  SAMPLE_RATE, texture, params, prepare_synth, prepare_parameters, pair, pairX, pairY, set_sample_rate,
  put_sample, beatTwo, previewEnvelope, widenStereo, clamp, round, max, pow, mix,
  squareWave, sawWave, sine, voiceTone,
} from "./simd-chiptune-kernel";
export {
  output_left_ptr, output_right_ptr, params_ptr, sequence_meta_ptr, sequence_cells_ptr,
  time_info_ptr, block_size, param_count, voice_count, reset, test_pattern_gate,
} from "./simd-chiptune-kernel";
export function lane_width(): i32 { return 1; }
export function render_synth(time: f32): u64 {
  if(params().synthMix==0) return pair(0,0);
  prepare_synth(time);
  let left: f32=0; let right: f32=0;
  for(let voice: usize=0;voice<32;voice+=4) {
    const gainLeft=load<f32>(LEVEL_LEFT+voice), gainRight=load<f32>(LEVEL_RIGHT+voice);
    if(gainLeft==0 && gainRight==0) continue;
    const frequency=load<f32>(FREQUENCY+voice);
    const kind=load<f32>(KIND+voice);
    const fundamental=sine(time*frequency);
    let wave=squareWave(time,frequency,load<f32>(WIDTH+voice));
    if(kind==1) wave=sawWave(time,frequency);
    if(kind==2) wave=wave*load<f32>(PULSE_LEVEL+voice)+fundamental*load<f32>(SINE_LEVEL+voice);
    else wave=voiceTone(wave,fundamental,load<f32>(TONE+voice));
    left+=wave*gainLeft; right+=wave*gainRight;
  }
  const scale: f32=.2*params().synthMix;
  return pair((left+texture)*scale,(right+texture)*scale);
}

// Each echo is an analytic re-evaluation, exactly as in the source shader.
// A delay ring would change held-cell transitions, seeking, and preset recall.
export function render_sample(time: f32): u64 {
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
    if(p.echoAlternate>=.5) swapped=!swapped;
    amplitude*=p.echoDecay; delayTime+=p.echoTime;
  }
  if(p.drumMix!=0) {
    const pan=clamp(p.ghostPan,-1,1);
    const drums=beatTwo(time,p);
    const ghosts=beatTwo(time-p.tempo/max(p.ghostDelayDivisor,.25),p);
    const duck=mix(1,.22,previewEnvelope(time));
    left+=(drums*.8+ghosts*.25*(1-pan)*p.ghostDrums)*p.drumMix*duck;
    right+=(drums*.8+ghosts*.25*(1+pan)*p.ghostDrums)*p.drumMix*duck;
  }
  const fade=pow(clamp(max(time,0)/max(p.fadeIn,.01),0,1),max(p.fadeCurve,.01));
  return pair(left*fade*p.gain,right*fade*p.gain);
}
export function process(framesValue: i32,sampleRate: f32,timeSeconds: f32): void {
  set_sample_rate(sampleRate);
  prepare_parameters();
  const frames=framesValue<0?0:framesValue>BLOCK_SIZE?BLOCK_SIZE:framesValue;
  for(let frame=0;frame<frames;frame++) {
    const time: f32=timeSeconds+<f32>frame/SAMPLE_RATE;
    const result=render_sample(time);
    put_sample(frame,pairX(result),pairY(result));
  }
}
