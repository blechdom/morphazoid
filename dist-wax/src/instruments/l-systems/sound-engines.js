import { VoicePool, clamp } from "../../audio.js";
import { GraphDrumAudio, GRAPH_DRUM_PERCUSSION_STYLES, graphDrumPercussionVoice } from "../../families/graph/graph-drum-audio.js";

export const L_SYSTEMS_TRIGGER_STYLES = GRAPH_DRUM_PERCUSSION_STYLES;
export { graphDrumPercussionVoice as lSystemsPercussionVoice };

export function lSystemTimbreGain(mode) {
  return ({ sine: 1, triangle: 1, square: .55, saw: .68, fm: .78, pm: .88, shepard: .82 })[mode] ?? 1;
}

/** One smoothed tone stage for the bounded worklet, not a filter per branch. */
export class LSystemsSynthAudio extends VoicePool {
  buildGraph(context = null) {
    super.buildGraph(context);
    this.toneFilter = this.context.createBiquadFilter();
    this.toneFilter.type = "lowpass";
    this.toneFilter.frequency.value = Math.min(this.context.sampleRate * .45, this.tone?.cutoff ?? 9000);
    this.toneFilter.Q.value = this.tone?.resonance ?? .6;
    this.master.disconnect(this.compressor);
    this.master.connect(this.toneFilter).connect(this.compressor);
  }
  setTone(cutoff, resonance) {
    this.tone = { cutoff: clamp(cutoff, 80, 20000), resonance: clamp(resonance, .1, 8) };
    if (!this.context || !this.toneFilter) return;
    this.toneFilter.frequency.setTargetAtTime(Math.min(this.context.sampleRate * .45, this.tone.cutoff), this.context.currentTime, .025);
    this.toneFilter.Q.setTargetAtTime(this.tone.resonance, this.context.currentTime, .025);
  }
  resetGraph() {
    this.toneFilter?.disconnect();
    this.toneFilter = null;
    super.resetGraph();
  }
}

/** Graph's bounded physical/plucked banks with app mute/cancel contracts. */
export class LSystemsDrumAudio extends GraphDrumAudio {
  setOutput(value) {
    // Do not briefly unmute the physical bank before reapplying its host gain.
    this.output = clamp(value, 0, .9);
    this.fmAudio.setOutput(this.output);
    this.physicalAudio.setOutput(this.output * (this.hostGain ?? 1));
  }
  setHostGain(gain, rampMilliseconds = 45) {
    this.hostGain = clamp(gain, 0, 1);
    this.fmAudio.setHostGain(this.hostGain, rampMilliseconds);
    this.physicalAudio.setOutput(this.output * this.hostGain);
  }
  cancelScheduledHits() {
    this.fmAudio.cancelScheduledHits();
    this.physicalAudio.cancelScheduledHits();
  }
}
