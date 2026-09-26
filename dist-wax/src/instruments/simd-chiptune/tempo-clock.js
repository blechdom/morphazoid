// Musical time is the integral of tempo. Audio seconds remain untouched so a
// live tempo move cannot seek the song or reset the source oscillator phases.
export const TEMPO_RAMP_SECONDS = 0.12;
export const TEMPO_CLOCK_CAPACITY = 2048;
export const TEMPO_CLOCK_FIELDS = 5;

export class ChiptuneTempoClock {
  constructor(tempo = 1.3, seconds = 0, beat = seconds * tempo) {
    this.reset(tempo, seconds, beat);
  }
  reset(tempo, seconds = 0, beat = seconds * tempo) {
    this.segments = [[seconds, beat, tempo, tempo, 0]];
  }
  segmentAtTime(seconds) {
    let low = 0, high = this.segments.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.segments[middle][0] <= seconds) low = middle; else high = middle - 1;
    }
    return this.segments[low];
  }
  beatAt(seconds) {
    const [start, beat, from, to, duration] = this.segmentAtTime(seconds);
    const elapsed = seconds - start;
    if (elapsed <= 0 || !duration) return beat + elapsed * from;
    const ramp = Math.min(duration, elapsed);
    return beat + from * ramp + (to - from) * ramp * ramp / (2 * duration) + to * Math.max(0, elapsed - duration);
  }
  tempoAt(seconds) {
    const [start, , from, to, duration] = this.segmentAtTime(seconds);
    return duration ? from + (to - from) * Math.max(0, Math.min(1, (seconds - start) / duration)) : to;
  }
  timeAtBeat(beat) {
    let low = 0, high = this.segments.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.segments[middle][1] <= beat) low = middle; else high = middle - 1;
    }
    const [start, initial, from, to, duration] = this.segments[low];
    const distance = beat - initial;
    if (distance <= 0 || !duration) return start + distance / from;
    const rampBeats = (from + to) * duration / 2;
    if (distance >= rampBeats) return start + duration + (distance - rampBeats) / to;
    const slope = (to - from) / duration;
    // Rationalized quadratic avoids cancellation near a constant tempo.
    return start + 2 * distance / (from + Math.sqrt(from * from + 2 * slope * distance));
  }
  setTempo(tempo, seconds) {
    if (tempo === this.segments.at(-1)[3]) return false;
    const beat = this.beatAt(seconds), from = this.tempoAt(seconds);
    while (this.segments.length > 1 && this.segments.at(-1)[0] >= seconds) this.segments.pop();
    this.segments.push([seconds, beat, from, tempo, TEMPO_RAMP_SECONDS]);
    // The 2048-event history covers over 17 seconds at 120 changes/second,
    // including the longest original analytic echoes (14 s) and ghosts (16 s).
    if (this.segments.length > TEMPO_CLOCK_CAPACITY) this.segments.shift();
    return true;
  }
  writeTo(target) {
    let offset = 0;
    for (const segment of this.segments) { target.set(segment, offset); offset += TEMPO_CLOCK_FIELDS; }
    return this.segments.length;
  }
  restore(segments) { this.segments = segments.map(segment => [...segment]); }
}
