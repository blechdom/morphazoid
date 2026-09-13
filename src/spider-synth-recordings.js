// Measured Maratus volans courtship vibrations, Girard et al. (2011), CC BY 4.0.
// These are substrate recordings rendered as audio, not airborne Argiope calls.
// Exact source, extraction and licenses: assets/audio/spider-synth/README.md.
export const SPIDER_RECORDINGS = Object.freeze([
  ['peacock-rumble', 'Peacock rumble · recorded', 2.56, [.135, .402, .6, .949, 1.145], '../assets/audio/spider-synth/peacock-rumble.wav'],
  ['peacock-crunch', 'Peacock crunch · recorded', 1.34, [.247, .45, .668, .806], '../assets/audio/spider-synth/peacock-crunch.wav'],
  ['peacock-grind', 'Peacock grind · recorded', 2.0300226757369613, [.078, .293, .476, 1.543, 1.803], '../assets/audio/spider-synth/peacock-grind.wav'],
].map(([id, label, duration, cues, url]) => Object.freeze({ id, label, duration, url, cues: Object.freeze(cues) })));

export const SPIDER_RECORDING_MAX_VOICES = 8;
const bound = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const matches = (voice, scope) => voice.owner && (!scope || scope.sourceId == null || voice.sourceId === scope.sourceId)
  && (!scope || scope.channel == null || voice.channel === scope.channel);

/** Eight finite grains. Only accepted movement, contact or note events start one. */
export class SpiderRecordingBank {
  constructor(rate) {
    this.rate = rate; this.bank = new Array(SPIDER_RECORDINGS.length).fill(null);
    this.voices = Array.from({ length: SPIDER_RECORDING_MAX_VOICES }, () => ({ active: false, release: false,
      group: 0, position: 0, end: 0, age: 0, gain: 0, rate: 1, targetRate: 1, envelope: 1, expression: 1, owner: null }));
    this.output = new Float64Array(8); this.lastTrigger = new Float64Array(8).fill(-Infinity);
    this.cues = new Uint32Array(8); this.groupRates = new Float64Array(8).fill(1);
    this.smoothing = 1 - Math.exp(-1 / (rate * .02)); this.releaseStep = 1 / (rate * .025);
    this.events = 0; this.dropped = 0; this.active = 0;
  }
  setBank(records) {
    // Validate metadata transactionally; large PCM scanning/sanitizing belongs
    // to the main thread, outside the audio deadline. Buffers are transferred.
    if (!Array.isArray(records) || records.length > SPIDER_RECORDINGS.length) throw new TypeError('Unexpected spider recording bank.');
    const prepared = [];
    for (const entry of records) {
      const index = SPIDER_RECORDINGS.findIndex(record => record.id === entry?.id);
      if (index < 0 || !(entry.data instanceof Float32Array) || !Number.isFinite(entry.sampleRate)
        || entry.sampleRate < 8000 || entry.sampleRate > 192000 || entry.data.length < 2
        || Math.abs(entry.data.length / entry.sampleRate - SPIDER_RECORDINGS[index].duration) > .01
        || prepared.some(item => item.index === index)) throw new TypeError('Unexpected spider recording format.');
      prepared.push({ index, data: entry.data, sampleRate: entry.sampleRate });
    }
    for (const entry of prepared) this.bank[entry.index] = entry;
    return prepared.length;
  }
  trigger(index, group, strength, time, owner = null, expression = 1) {
    const record = this.bank[index];
    if (!record || !Number.isInteger(group) || group < 0 || group > 7 || strength <= 0) return false;
    // Sustained movement may retrigger fragments, but never becomes a noisy
    // autonomous loop. A row admits at most 6.25 grains/s and two tails.
    if (time - this.lastTrigger[group] < .16) return false;
    let target = null, count = 0;
    for (const voice of this.voices) { if (voice.active && voice.group === group) count++; if (!voice.active && !target) target = voice; }
    if (!target || count >= 2) { this.dropped++; return false; }
    const cues = SPIDER_RECORDINGS[index].cues, cue = cues[this.cues[group]++ % cues.length];
    const duration = .12 + bound(strength, 0, 1) * .46;
    target.active = true; target.release = false; target.group = group; target.record = record;
    target.position = Math.round(cue * record.sampleRate); target.end = Math.min(record.data.length - 1, target.position + duration * record.sampleRate);
    target.age = 0; target.gain = Math.sqrt(bound(owner && expression > 0 ? strength / expression : strength, 0, 1)) * .85; target.envelope = 1;
    target.owner = owner; target.ownerOrder = owner?.order; target.sourceId = owner?.sourceId; target.channel = owner?.channel;
    target.expression = target.targetExpression = bound(expression, 0, 1); target.noteRatio = owner ? 2 ** ((owner.note - 60) / 12) : 1;
    target.rate = target.targetRate = bound(this.groupRates[group] * target.noteRatio, .5, 2);
    this.lastTrigger[group] = time; this.events++; return true;
  }
  control(group, ratio, midi) {
    this.groupRates[group] = bound(ratio, .5, 2);
    for (const voice of this.voices) if (voice.active && voice.group === group) {
      const owner = voice.owner, scope = owner ? midi.scopes[owner.scope] : null;
      if (owner && (owner.order !== voice.ownerOrder || !owner.active || !(owner.held || owner.sustained))) voice.release = true;
      voice.targetExpression = scope ? scope.expression : 1;
      voice.targetRate = bound(ratio * voice.noteRatio * (scope ? 2 ** (scope.bend / 6) : 1), .5, 2);
    }
  }
  release(group = -1, scope = null, midiOnly = false) {
    for (const voice of this.voices) if (voice.active && (group < 0 || voice.group === group) && (!midiOnly || matches(voice, scope))) voice.release = true;
  }
  sample() {
    this.output.fill(0); let active = 0;
    for (const voice of this.voices) {
      if (!voice.active) continue;
      if (voice.release) voice.envelope = Math.max(0, voice.envelope - this.releaseStep);
      if (voice.position >= voice.end || voice.envelope <= 0) { voice.active = false; continue; }
      voice.rate += (voice.targetRate - voice.rate) * this.smoothing;
      voice.expression += (voice.targetExpression - voice.expression) * this.smoothing;
      const step = voice.record.sampleRate / this.rate * voice.rate;
      const index = Math.floor(voice.position), fraction = voice.position - index, data = voice.record.data;
      const signal = data[index] * (1 - fraction) + data[index + 1] * fraction;
      const attack = Math.min(1, voice.age / (this.rate * .008));
      const tail = Math.min(1, (voice.end - voice.position) / Math.max(1, step * this.rate * .025));
      const envelope = attack * attack * (3 - 2 * attack) * tail * tail * (3 - 2 * tail);
      this.output[voice.group] += (Number.isFinite(signal) ? bound(signal, -1, 1) : 0) * voice.gain * voice.envelope * envelope * voice.expression;
      voice.position += step; voice.age++; active++;
    }
    this.active = active; return this.output;
  }
}
