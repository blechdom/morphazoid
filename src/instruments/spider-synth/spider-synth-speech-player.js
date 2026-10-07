// Bounded utterance playback inside the existing audio worklet. Current and
// replacement buffers retain separate ownership until the release completes.
export class SpiderSpeechPlayer {
  constructor(sampleRate) {
    this.sampleRate = sampleRate; this.current = null; this.pending = null;
    this.position = 0; this.release = 0; this.releasing = false;
    this.fadeFrames = Math.max(1, Math.round(sampleRate * .008));
  }
  speak(samples, sampleRate, gain = 1) {
    if (!(samples instanceof Float32Array) || !samples.length || !Number.isInteger(sampleRate)
      || sampleRate < 8000 || sampleRate > 96000 || samples.length > sampleRate * 30
      || !Number.isFinite(gain) || gain < 0 || gain > 8) return false;
    const next = { samples, sampleRate, gain };
    if (this.current) {
      this.pending = next;
      if (!this.releasing) { this.releasing = true; this.release = this.fadeFrames; }
    } else this.start(next);
    return true;
  }
  start(utterance) {
    this.current = utterance; this.pending = null; this.position = 0; this.releasing = false; this.release = 0;
  }
  stop() {
    this.pending = null;
    if (this.current && !this.releasing) { this.releasing = true; this.release = this.fadeFrames; }
  }
  sample() {
    const utterance = this.current;
    if (!utterance) return 0;
    const { samples, sampleRate, gain } = utterance;
    const index = Math.floor(this.position), mix = this.position - index;
    const edge = Math.max(0, Math.min(1, this.position / (sampleRate * .005), (samples.length - 1 - this.position) / (sampleRate * .005)));
    const release = this.releasing ? this.release / this.fadeFrames : 1;
    const value = ((samples[index] || 0) * (1 - mix) + (samples[index + 1] || 0) * mix) * edge * release * gain;
    this.position += sampleRate / this.sampleRate;
    if ((this.releasing && --this.release <= 0) || this.position >= samples.length) this.start(this.pending);
    return Number.isFinite(value) ? value : 0;
  }
}
