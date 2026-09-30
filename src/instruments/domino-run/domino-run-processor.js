export const MAX_DOMINO_VOICES = 96;
export const MAX_DOMINO_EVENTS = 4096;
const MAX_BUFFERS = 256;
const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));

function sampleVoice(voice, lowpass, attackPole) {
  const index = Math.floor(voice.position);
  const fraction = voice.position - index;
  const value = voice.data[index] + (voice.data[index + 1] - voice.data[index]) * fraction;
  if (!voice.varied) return value;
  voice.low += lowpass * (value - voice.low);
  const colored = value + voice.tilt * (value - voice.low);
  const weight = 1 + voice.attack * voice.attackEnvelope + voice.body * (1 - voice.attackEnvelope);
  voice.attackEnvelope *= attackPole;
  return colored * weight;
}

/** Bounded PCM mixer; future events do not occupy audible voice slots. */
export class DominoMixer {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.variationLowpass = 1 - Math.exp(-2 * Math.PI * 1800 / sampleRate);
    this.variationAttackPole = Math.exp(-1 / (sampleRate * 0.006));
    this.buffers = new Map();
    this.events = [];
    this.staged = [];
    this.stagedBatch = null;
    this.cursor = 0;
    this.voices = [];
    this.played = 0;
    this.dropped = 0;
    this.stolen = 0;
  }

  addBuffer({ id, data, sampleRate }) {
    if (!(data instanceof Float32Array) || !data.length || data.length > 288000) return;
    this.buffers.delete(id);
    this.buffers.set(id, { data, sampleRate: clamp(sampleRate, 8000, 96000) });
    while (this.buffers.size > MAX_BUFFERS) this.buffers.delete(this.buffers.keys().next().value);
  }

  touchBuffer(id) {
    const buffer = this.buffers.get(id);
    if (!buffer) return;
    this.buffers.delete(id);
    this.buffers.set(id, buffer);
  }

  enqueue(events, { stage = false, batch = 0 } = {}) {
    if (stage && this.stagedBatch !== batch) {
      this.staged.length = 0;
      this.stagedBatch = batch;
    }
    this.events = this.events.slice(this.cursor);
    this.cursor = 0;
    for (const event of events) {
      if (this.events.length + this.staged.length >= MAX_DOMINO_EVENTS) { this.dropped += 1; continue; }
      const buffer = this.buffers.get(event.bufferId);
      if (!buffer || !Number.isFinite(event.time)) { this.dropped += 1; continue; }
      const pan = clamp(event.pan, -1, 1);
      const gain = clamp(event.gain, 0, 1.5);
      const tilt = clamp(event.variation?.tilt, -0.45, 0.45);
      const attack = clamp(event.variation?.attack, -0.20, 0.20);
      const body = clamp(event.variation?.body, -0.15, 0.15);
      (stage ? this.staged : this.events).push({ time: event.time, data: buffer.data, tilt, attack, body, varied: Boolean(tilt || attack || body),
        step: buffer.sampleRate / this.sampleRate * clamp(event.rate, 0.25, 4),
        left: Math.cos((pan + 1) * Math.PI / 4) * gain,
        right: Math.sin((pan + 1) * Math.PI / 4) * gain, gain });
    }
    if (!stage) this.events.sort((a, b) => a.time - b.time);
  }

  // Prepare large batches in small packets so the LRU may evict a source only
  // after its pending events own a reference. Nothing sounds until commit.
  commit(start, notBefore = -Infinity, batch = 0) {
    if (this.stagedBatch !== batch) return;
    this.stagedBatch = null;
    if (!Number.isFinite(start)) { this.staged.length = 0; return; }
    this.events = this.events.slice(this.cursor); this.cursor = 0;
    for (const event of this.staged) {
      event.time += start;
      if (event.time >= notBefore) this.events.push(event);
    }
    this.staged.length = 0;
    this.events.sort((a, b) => a.time - b.time);
  }

  cancelQueued() {
    this.stagedBatch = null;
    this.staged.length = 0;
    this.events.length = 0;
    this.cursor = 0;
  }

  silence() {
    this.cancelQueued();
    for (const voice of this.voices) voice.release = Math.ceil(this.sampleRate * 0.008);
  }

  clear() {
    this.stagedBatch = null;
    this.staged.length = 0;
    this.events.length = 0;
    this.cursor = 0;
    this.voices.length = 0;
    this.buffers.clear();
  }

  process(left, right, time) {
    left.fill(0); right.fill(0);
    const end = time + left.length / this.sampleRate;
    while (this.cursor < this.events.length && this.events[this.cursor].time < end) {
      const event = this.events[this.cursor++];
      if (event.time < time - 0.06) { this.dropped += 1; continue; }
      const voice = { ...event, position: 0, offset: Math.max(0, Math.ceil((event.time - time) * this.sampleRate)),
        release: null, tail: null, low: 0, attackEnvelope: 1 };
      if (this.voices.length >= MAX_DOMINO_VOICES) {
        // Replace the weakest decaying tail, retaining a 3 ms crossfade.
        let index = 0; let lowest = Infinity;
        this.voices.forEach((item, i) => {
          const weight = item.gain * Math.max(0, 1 - item.position / item.data.length) ** 4;
          if (weight < lowest) { lowest = weight; index = i; }
        });
        const previous = this.voices[index];
        voice.tail = { ...previous, tail: null, remaining: Math.ceil(this.sampleRate * 0.003) };
        this.voices[index] = voice;
        this.stolen += 1;
      } else this.voices.push(voice);
      this.played += 1;
    }
    const releaseLength = Math.ceil(this.sampleRate * 0.008);
    const tailLength = Math.ceil(this.sampleRate * 0.003);
    for (let v = this.voices.length - 1; v >= 0; v -= 1) {
      const voice = this.voices[v];
      for (let i = voice.offset; i < left.length; i += 1) {
        if (voice.position >= voice.data.length - 1 || voice.release === 0) break;
        const value = sampleVoice(voice, this.variationLowpass, this.variationAttackPole);
        const fade = voice.release === null ? 1 : voice.release-- / releaseLength;
        left[i] += value * voice.left * fade;
        right[i] += value * voice.right * fade;
        voice.position += voice.step;
        const tail = voice.tail;
        if (tail && tail.remaining > 0 && tail.position < tail.data.length - 1) {
          const y = sampleVoice(tail, this.variationLowpass, this.variationAttackPole) * tail.remaining-- / tailLength;
          left[i] += y * tail.left * fade; right[i] += y * tail.right * fade;
          tail.position += tail.step;
        } else voice.tail = null;
      }
      voice.offset = 0;
      if (voice.position >= voice.data.length - 1 || voice.release === 0) this.voices.splice(v, 1);
    }
    if (this.cursor === this.events.length) { this.events.length = 0; this.cursor = 0; }
    return this.voices.length > 0 || this.events.length > this.cursor;
  }

  get status() {
    return { active: this.voices.length, queued: this.events.length - this.cursor + this.staged.length,
      buffers: this.buffers.size, played: this.played, dropped: this.dropped, stolen: this.stolen };
  }
}

// The mixer is also importable for offline timing and resource-bound checks.
const WorkletBase = globalThis.AudioWorkletProcessor ?? class {};
class DominoRunProcessor extends WorkletBase {
  constructor() {
    super();
    this.mixer = new DominoMixer(globalThis.sampleRate);
    this.ticks = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'buffer') this.mixer.addBuffer(data);
      else if (data.type === 'touch') this.mixer.touchBuffer(data.id);
      else if (data.type === 'events') this.mixer.enqueue(data.events);
      else if (data.type === 'stage') this.mixer.enqueue(data.events, { stage: true, batch: data.batch });
      else if (data.type === 'commit') this.mixer.commit(data.start, data.notBefore, data.batch);
      else if (data.type === 'cancel') this.mixer.cancelQueued();
      else if (data.type === 'silence') this.mixer.silence();
      else if (data.type === 'dispose') this.mixer.clear();
    };
  }
  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.[0]) return true;
    this.mixer.process(channels[0], channels[1] ?? channels[0], globalThis.currentTime);
    if (++this.ticks % 64 === 0) this.port.postMessage(this.mixer.status);
    return true;
  }
}
if (typeof globalThis.registerProcessor === 'function') {
  globalThis.registerProcessor('domino-run-processor', DominoRunProcessor);
}
