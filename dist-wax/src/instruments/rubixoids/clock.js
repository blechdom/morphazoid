/** One musical timeline for Rubixoids; native score cursors remain instrument-owned. */
export class RubixoidsClock {
  constructor({ now = () => performance.now() / 1000, tempo = 126, swing = 0 } = {}) {
    this.wallTime = now;
    this.tempo = tempo;
    this.swing = swing;
    this.playing = false;
    this.revision = 0;
    this.context = null;
    this.owner = null;
    this.offset = 0;
    this.fallbackOffset = 0;
    this.lastTime = now();
    this.anchorTime = this.lastTime;
    this.anchorBeat = 0;
  }

  now() {
    const wall = this.wallTime();
    let time;
    // An attached device interruption holds musical time with the audio.
    // Explicit Audio-off and handoffs detach before using the silent clock.
    if (this.context && this.context.state !== 'closed') {
      time = this.context.currentTime + this.offset;
      this.fallbackOffset = time - wall;
    } else {
      time = wall + this.fallbackOffset;
    }
    this.lastTime = Math.max(this.lastTime, time);
    return this.lastTime;
  }

  attach(owner, context = null) {
    if (this.owner === owner && this.context === context) return;
    const time = this.now();
    this.owner = owner;
    this.context = context;
    this.offset = context ? time - context.currentTime : 0;
    this.fallbackOffset = time - this.wallTime();
  }

  detach(owner) {
    if (owner !== this.owner) return;
    const time = this.now();
    this.context = null;
    this.owner = null;
    this.fallbackOffset = time - this.wallTime();
  }

  beatAt(time = this.now()) {
    return this.anchorBeat + (this.playing ? Math.max(0, time - this.anchorTime) * this.tempo / 60 : 0);
  }

  configure({ tempo = this.tempo, swing = this.swing } = {}) {
    const nextTempo = Number.isFinite(Number(tempo)) ? Math.max(30, Math.min(300, Number(tempo))) : this.tempo;
    const nextSwing = Number.isFinite(Number(swing)) ? Math.max(0, Math.min(.42, Number(swing))) : this.swing;
    if (nextTempo === this.tempo && nextSwing === this.swing) return false;
    const time = this.now();
    this.anchorBeat = this.beatAt(time);
    this.anchorTime = Math.max(time, this.anchorTime);
    this.tempo = nextTempo;
    this.swing = nextSwing;
    this.revision += 1;
    return true;
  }

  play({ leadSeconds = .045 } = {}) {
    if (this.playing) return;
    this.anchorTime = this.now() + Math.max(0, leadSeconds);
    this.playing = true;
    this.revision += 1;
  }

  pause() {
    if (!this.playing) return;
    const time = this.now();
    this.anchorBeat = this.beatAt(time);
    this.anchorTime = time;
    this.playing = false;
    this.revision += 1;
  }

  grid(ordinal, { division = 1, subdivisions = 1 } = {}) {
    division = Math.max(1, Number(division) || 1);
    subdivisions = Math.max(1, Math.round(Number(subdivisions) || 1));
    ordinal = Math.max(0, Math.round(Number(ordinal) || 0));
    const beatFor = step => {
      const pulse = step / subdivisions;
      const pair = Math.floor(pulse / 2);
      const within = pulse - pair * 2;
      return (pair * 2 + (within < 1 ? within * (1 + this.swing)
        : 1 + this.swing + (within - 1) * (1 - this.swing))) / division;
    };
    const timeFor = beat => this.anchorTime + (beat - this.anchorBeat) * 60 / this.tempo;
    const beat = beatFor(ordinal);
    const pulseStart = Math.floor(ordinal / subdivisions) * subdivisions;
    return {
      ordinal, beat, time: timeFor(beat),
      duration: (beatFor(ordinal + 1) - beat) * 60 / this.tempo,
      pulseDuration: (beatFor(pulseStart + subdivisions) - beatFor(pulseStart)) * 60 / this.tempo,
      revision: this.revision,
    };
  }

  next({ division = 1, subdivisions = 1, minTime = this.now() + .012 } = {}) {
    division = Math.max(1, Number(division) || 1);
    subdivisions = Math.max(1, Math.round(Number(subdivisions) || 1));
    const pulse = this.beatAt(Math.max(minTime, this.anchorTime)) * division;
    const pair = Math.floor(pulse / 2);
    const within = pulse - pair * 2;
    const phase = pair * 2 + (within < 1 + this.swing ? within / (1 + this.swing)
      : 1 + (within - 1 - this.swing) / (1 - this.swing));
    let ordinal = Math.max(0, Math.ceil(phase * subdivisions - 1e-8));
    let point = this.grid(ordinal, { division, subdivisions });
    // Floating-point boundaries must never return an attack before its lead.
    if (point.time < minTime - 1e-7) point = this.grid(++ordinal, { division, subdivisions });
    return point;
  }

  audioTime(context, time) {
    // The active context already has an exact mapping; reading its quantized
    // currentTime twice could otherwise move a deadline by one render block.
    if (context === this.context && context.state !== 'closed') return time - this.offset;
    return context.currentTime + time - this.now();
  }

  performanceTime(time) {
    return (this.wallTime() + time - this.now()) * 1000;
  }

  snapshot() {
    const time = this.now();
    return {
      tempo: this.tempo, swing: this.swing, playing: this.playing,
      beat: this.beatAt(time), time, revision: this.revision,
      source: this.context && this.context.state !== 'closed' ? 'audio' : 'silent', owner: this.owner,
    };
  }
}

export const rubixoidsClock = new RubixoidsClock();
