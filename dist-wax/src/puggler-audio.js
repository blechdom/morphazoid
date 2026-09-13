import { connectAudioOutput } from './audio-output-manager.js';
import { clamp, soundMapping, WORLD } from './puggler.js';
import { PUNK_DRUMS, PUNK_RIFFS, PHRASE_TEMPO, renderPunkPhrase, renderVocalChant } from './puggler-samples.js';
import { sonicSkin, eraPhraseKey } from './puggler-sonic-skins.js';
import { renderEraPhrase, renderEraDrum } from './puggler-era-samples.js';
import { renderEraVocal } from './puggler-era-vocals.js';
import { VOCAL_CHARACTERS, vocalCharacter, renderCharacterVocal } from './puggler-vocals.js';

export const MAX_PUGGLER_VOICES = 10;
// Twenty catches/second can overlap 36 of the 1.8-second cymbal recordings;
// leave room for crowd reactions while bounding even hostile event bursts.
export const MAX_PUGGLER_ATTACKS = 48;
export const MAX_PUGGLER_AIR_TAILS = 20;
const CATCH_GATE = .018;
const SAMPLE_IDS = [...PUNK_DRUMS, 'oi', 'woo', 'boo'];
const DRUM_GAIN = { kick: 1.15, snare: 1.03, crash: .55, tom: 1.05, hat: .62 };
const isVocal = role => role === 'oi' || role === 'woo';
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function vocalPerformer(object = {}) {
  // A pass belongs to its thrower until the receiving rider launches it again.
  // Explicit voice ownership also handles rescue kicks and audience returns.
  const valid = owner => Number.isInteger(owner) && owner >= 0 && owner < 3;
  const owner = object.voiceOwner ?? (object.phase === 'air' ? object.fromOwner : object.owner);
  return valid(owner) ? owner : valid(object.owner) ? object.owner : 0;
}

// Space changes playback pitch AND phrase speed. Velocity pushes the phrase
// forward and opens the tone. This expressive mapping is not physical Doppler.
export function punkMotion(object, parameters = {}) {
  const prop = object.prop ?? { mass: .2, hz: 196 };
  const body = { x: finite(object.x, WORLD.width / 2), y: finite(object.y, WORLD.handY), vx: finite(object.vx), vy: finite(object.vy) };
  const mapping = soundMapping(prop, body, parameters);
  const height = clamp((body.y - WORLD.handY) / 480, -.65, 1.8);
  const speed = Math.hypot(body.vx, body.vy);
  const tempoRatio = clamp(finite(parameters.tempo, 240), 60, 1200) / PHRASE_TEMPO;
  // Keep upper tempos audible as faster riffs without pitching every sample
  // up by the full tempo multiplier. Drum events still follow every catch.
  const tempo = tempoRatio <= 2 ? tempoRatio : 2 * Math.sqrt(tempoRatio / 2);
  const pathPitch = height * clamp(finite(parameters.height, .8), 0, 2) * 6;
  const bend = clamp(body.vx / 500 + finite(object.spinRate) / 55, -1.7, 1.7);
  return {
    rate: clamp(tempo * 2 ** ((pathPitch + bend) / 12) * (1 + Math.min(1, speed / 1900) * clamp(finite(parameters.motion, 5), 0, 12) * .018), .3, 6.8),
    pan: mapping.pan,
    tone: clamp(1300 + speed * clamp(finite(parameters.motion, 5), 0, 12) + height * 900, 650, 9500),
    level: .6 + Math.min(1, speed / 1600) * .4,
    energy: mapping.energy,
  };
}
export function punkVocalMotion(object, parameters = {}) {
  const mapping = punkMotion(object, parameters);
  const height = clamp((finite(object.y, WORLD.handY) - WORLD.handY) / 800, -.5, 1.5);
  const tempo = clamp(finite(parameters.tempo, 240), 60, 1200);
  const semitones = height * clamp(finite(parameters.height, .8), 0, 2) * 1.5
    + clamp(finite(object.vx) / 900, -.7, .7) + Math.log2(tempo / 240) * .15;
  return { ...mapping,
    // Preserve recognizable words and the recorded singer's mouth resonances;
    // tempo nudges the phrase rather than sending speech through guitar rates.
    rate: clamp(2 ** (semitones / 12), .84, 1.2),
    tone: clamp(6200 + Math.hypot(finite(object.vx), finite(object.vy)) * 1.25, 5800, 10000),
    level: .82 + .18 * Math.min(1, Math.hypot(finite(object.vx), finite(object.vy)) / 1600),
  };
}
// Era color changes the instrument, while the same trajectory still controls it.
export function sonicMotion(object, parameters = {}, role = object.riff) {
  const skin = sonicSkin(parameters.skin).id;
  const m = isVocal(role) ? punkVocalMotion(object, parameters) : punkMotion(object, parameters);
  if (skin === 'punk') return { ...m, resonance: .55 };
  const grit = clamp(finite(parameters.grit, .65), 0, 1);
  const height = clamp((finite(object.y, WORLD.handY) - WORLD.handY) / 800, 0, 1);
  if (isVocal(role)) return { ...m,
    tone: skin === 'future' ? clamp(2600 + height * 4300 + m.tone * .22, 3200, 9000) : m.tone,
    resonance: skin === 'future' ? .8 + grit * .7 : .55,
  };
  return { ...m,
    rate: skin === 'history' ? clamp(m.rate ** .66, .45, 3.55) : clamp(m.rate ** .82, .35, 5),
    tone: skin === 'history' ? clamp(m.tone * (.65 + grit * .45) + 700, 1200, 10000)
      : clamp(m.tone * (.48 + grit * .25) + height * 1800, 700, 9500),
    resonance: skin === 'history' ? .55 + grit * .2 : .8 + grit * 1.2,
  };
}
function saturator(amount = 1) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) { const x = i / (curve.length - 1) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  return curve;
}
export class PugglerAudio {
  constructor() {
    this.context = null; this.on = false; this.voices = Array(MAX_PUGGLER_VOICES).fill(null);
    this.phrasePositions = Array(MAX_PUGGLER_VOICES).fill(null);
    this.gateUntil = Array(MAX_PUGGLER_VOICES).fill(0);
    this.attacks = new Set(); this.airTails = new Set(); this.disposed = false;
    this.buffers = null; this.vocalBuffers = null; this.eraBuffers = null; this.loading = null; this.armSerial = 0; this.running = false; this.active = true; this.level = .38;
  }
  async arm() {
    if (this.disposed) return;
    const serial = ++this.armSerial;
    if (!this.context) {
      const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      this.context = new AudioContext();
      const c = this.context;
      this.bus = c.createGain(); this.master = c.createGain(); this.master.gain.value = 0;
      this.airBus = c.createGain(); this.airDuck = c.createGain(); this.airDuck.gain.value = 1;
      this.vocalBus = c.createGain(); this.vocalCompressor = c.createDynamicsCompressor();
      this.vocalCompressor.threshold.value = -8; this.vocalCompressor.knee.value = 10; this.vocalCompressor.ratio.value = 2;
      this.vocalCompressor.attack.value = .01; this.vocalCompressor.release.value = .1;
      this.drumBus = c.createGain(); this.drumBus.gain.value = 2.8;
      this.compressor = c.createDynamicsCompressor();
      this.compressor.threshold.value = -16; this.compressor.knee.value = 5; this.compressor.ratio.value = 12;
      this.compressor.attack.value = .002; this.compressor.release.value = .075;
      this.ceiling = c.createWaveShaper(); this.ceiling.curve = saturator(1.6); this.ceiling.oversample = '2x';
      // The oversampling reconstruction filter can briefly overshoot its curve
      // during extreme simultaneous hits. This unity guard bounds those peaks
      // before the unchanged 0.9 master headroom, without pumping the attacks.
      this.peakGuard = c.createWaveShaper(); this.peakGuard.curve = new Float32Array([-1, 1]);
      // Compress the sustained riffs separately: catches bypass that compressor
      // so their recorded transients survive. The shared final ceiling remains.
      this.airBus.connect(this.compressor); this.compressor.connect(this.airDuck); this.airDuck.connect(this.bus);
      this.vocalBus.connect(this.vocalCompressor); this.vocalCompressor.connect(this.airDuck);
      this.drumBus.connect(this.bus); this.bus.connect(this.ceiling); this.ceiling.connect(this.peakGuard); this.peakGuard.connect(this.master);
      this.releaseOutput = connectAudioOutput(c, this.master);
    }
    // Resume directly in the explicit Audio gesture, before sample fetches.
    const resumed = this.context.resume();
    if (!this.buffers && !this.loading) {
      this.abort = new AbortController();
      this.loading = this.loadSamples(this.abort.signal).finally(() => { this.loading = null; });
    }
    await Promise.all([resumed, this.loading]);
    if (!this.disposed && serial === this.armSerial) this.on = true;
  }
  async loadSamples(signal) {
    const c = this.context;
    const entries = await Promise.all(SAMPLE_IDS.map(async id => {
      const response = await fetch(new URL(`../assets/puggler/${id}.wav`, import.meta.url), { signal });
      if (!response.ok) throw new Error(`Puggler ${id} sample failed (${response.status})`);
      return [id, await c.decodeAudioData(await response.arrayBuffer())];
    }));
    if (this.disposed) return;
    const oiIndex = entries.findIndex(([id]) => id === 'oi'), oi = entries[oiIndex][1];
    const chant = renderVocalChant(oi.getChannelData(0), oi.sampleRate);
    const chantBuffer = c.createBuffer(1, chant.length, oi.sampleRate); chantBuffer.copyToChannel(chant, 0);
    entries[oiIndex][1] = chantBuffer;
    for (const role of ['guitar', 'bass']) {
      const rate = 22050, data = renderPunkPhrase(role, rate), buffer = c.createBuffer(1, data.length, rate);
      buffer.copyToChannel(data, 0); entries.push([role, buffer]);
    }
    const buffers = Object.fromEntries(entries), vocals = {}, eras = {};
    // Eighteen bounded, reusable phrases; skin/cast changes never decode or
    // rebuild samples in the real-time update loop. Audience clips stay separate.
    for (const character of VOCAL_CHARACTERS) for (const role of ['oi', 'woo']) {
      const original = buffers[role], data = character.skin === 'punk'
        ? renderCharacterVocal(original.getChannelData(0), original.sampleRate, character)
        : renderEraVocal(original.getChannelData(0), original.sampleRate, character, role);
      const buffer = c.createBuffer(1, data.length, original.sampleRate);
      buffer.copyToChannel(data, 0); vocals[`${character.id}:${role}`] = buffer;
    }
    for (const skin of ['history', 'future']) {
      const rate = 22050;
      const cache = (key, data) => {
        const buffer = c.createBuffer(1, data.length, rate); buffer.copyToChannel(data, 0); eras[key] = buffer;
      };
      for (let owner = 0; owner < 3; owner++) for (const role of ['guitar', 'bass'])
        cache(eraPhraseKey(skin, role, owner), renderEraPhrase(skin, role, owner, rate));
      for (const drum of PUNK_DRUMS) cache(`${skin}:${drum}`, renderEraDrum(skin, drum, rate));
    }
    this.buffers = buffers; this.vocalBuffers = vocals; this.eraBuffers = eras;
  }
  mute() {
    ++this.armSerial; this.on = false;
    if (this.master) this.master.gain.setTargetAtTime(0, this.context.currentTime, .012);
    this.releaseAll();
  }
  update(objects, parameters = {}, running) {
    if (!this.context || this.disposed) return;
    const t = this.context.currentTime;
    this.active = parameters.active !== false; this.level = clamp(finite(parameters.level, .38), 0, 1);
    const audible = this.on && this.active && this.level > 0 && Boolean(this.buffers);
    this.running = Boolean(running);
    this.master.gain.setTargetAtTime(audible ? this.level * .9 : 0, t, .012);
    if (!audible) { this.releaseAll(); return; }
    // Pause belongs to juggling, not the room: release riffs but retain catch
    // tails and model-triggered crowd reactions. Audio/level/visibility mute all.
    if (!running) { this.releaseRiffs(); return; }
    const flightCount = objects.slice(0, MAX_PUGGLER_VOICES).filter(o => ['air', 'replacement', 'audience'].includes(o.phase)).length;
    const flightMix = Math.min(1, Math.sqrt(4 / Math.max(1, flightCount)));
    for (let i = 0; i < MAX_PUGGLER_VOICES; i++) {
      const object = objects.find((o, index) => (o.id ?? index) === i);
      const role = PUNK_RIFFS.includes(object?.riff) ? object.riff : PUNK_RIFFS[i % PUNK_RIFFS.length];
      if (!object || !['air', 'replacement', 'audience'].includes(object.phase) || finite(parameters.flight, .7) <= 0) {
        this.releaseAir(i); continue;
      }
      const skin = sonicSkin(parameters.skin), owner = vocalPerformer(object);
      const character = isVocal(role) ? vocalCharacter(skin.id, owner) : null;
      const key = character ? `${character.id}:${role}` : eraPhraseKey(skin.id, role, owner);
      if (this.voices[i]?.key !== key) { this.releaseAir(i); this.voices[i] = this.startAir(role, t, i, character, skin.id, owner); }
      const v = this.voices[i], m = sonicMotion(object, parameters, role);
      this.advancePhrase(v, t); v.rate = m.rate;
      v.source.playbackRate.setTargetAtTime(m.rate, t, .035);
      v.filter.frequency.setTargetAtTime(m.tone, t, .025);
      v.filter.Q.setTargetAtTime(m.resonance, t, .025);
      v.pan.pan.setTargetAtTime(m.pan, t, .02);
      v.gain.gain.setTargetAtTime(clamp(finite(parameters.flight, .7), 0, 1) * skin.gains[role] * m.level * flightMix, Math.max(t, v.startedAt), .012);
      v.drive?.gain.setTargetAtTime(1 + clamp(finite(parameters.grit, .65), 0, 1) * (skin.id === 'future' ? .9 : role === 'guitar' ? 2.6 : 1.2), t, .025);
    }
  }
  startAir(role, t, slot, character = null, skin = 'punk', owner = 0) {
    const c = this.context, source = c.createBufferSource(), filter = c.createBiquadFilter();
    const gain = c.createGain(), pan = c.createStereoPanner();
    const vocal = isVocal(role), clean = vocal || skin === 'history';
    const drive = clean ? null : c.createGain(), dirt = clean ? null : c.createWaveShaper();
    const key = character ? `${character.id}:${role}` : eraPhraseKey(skin, role, owner);
    source.buffer = character ? this.vocalBuffers[key] : skin === 'punk' ? this.buffers[role] : this.eraBuffers[key]; source.loop = true;
    filter.type = 'lowpass'; filter.Q.value = .55; filter.frequency.value = vocal ? 7200 : 4200;
    gain.gain.value = 0; source.connect(filter);
    if (clean) filter.connect(gain);
    else { dirt.curve = saturator(skin === 'future' ? 1.1 : 1.3); dirt.oversample = '2x'; filter.connect(drive); drive.connect(dirt); dirt.connect(gain); }
    gain.connect(pan); pan.connect(clean ? this.vocalBus : this.airBus);
    const position = this.phrasePositions[slot];
    // Preserve relative phrase progress when a different character's treatment
    // changes the clip duration. Catches still pause the object's own cursor.
    const offset = position?.role !== role ? 0 : position.duration === source.buffer.duration
      ? position.offset : (position.offset / position.duration * source.buffer.duration) % source.buffer.duration;
    const startedAt = Math.max(t + .002, this.gateUntil[slot]);
    const voice = { role, key, skin, character:character?.id ?? null, speaker:owner, source, filter, gain, drive, dirt, pan, slot, offset, lastTime: startedAt, startedAt, rate: 1 };
    source.onended = () => this.disconnectVoice(voice);
    source.start(startedAt, offset); return voice;
  }
  advancePhrase(v, t) {
    // An AudioContext-time cursor preserves the musical phrase across catches.
    // Integrating each smoothed-rate target is a close phase approximation;
    // nothing advances while the object is held or lies on the floor.
    v.offset = (v.offset + Math.max(0, t - v.lastTime) * v.rate) % v.source.buffer.duration;
    v.lastTime = Math.max(v.lastTime, t);
  }
  releaseAir(i, at = this.context?.currentTime ?? 0, fast = false) {
    const v = this.voices[i]; if (!v) return;
    this.advancePhrase(v, Math.max(this.context.currentTime, at));
    this.phrasePositions[i] = { role: v.role, offset: v.offset, duration:v.source.buffer.duration };
    this.voices[i] = null;
    if (this.airTails.size >= MAX_PUGGLER_AIR_TAILS) this.disconnectVoice(this.airTails.values().next().value);
    this.airTails.add(v); this.fadeVoice(v, at, fast);
  }
  fadeVoice(v, at = this.context.currentTime, fast = false) {
    const t = Math.max(this.context.currentTime, at); v.releaseAt = t;
    v.gain.gain.cancelScheduledValues(t); v.gain.gain.setTargetAtTime(0, t, fast ? .003 : .008);
    try { v.source.stop(t + (fast ? CATCH_GATE : .05)); } catch {}
  }
  duckRiffs(t, amount) {
    // Only a physical catch requests this 45-ms dip. No tempo timer or backing
    // rhythm owns it; impacts=0 leaves the other airborne voices untouched.
    const gain = this.airDuck.gain;
    if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(t);
    else { gain.cancelScheduledValues(t); gain.setValueAtTime(gain.value, t); }
    const depth = 1 / (1 + amount * 2.2);
    gain.linearRampToValueAtTime(depth, t + .002);
    gain.setValueAtTime(depth, t + .014);
    gain.linearRampToValueAtTime(1, t + .045);
    this.ducking = true;
  }
  strike(event, parameters = {}, when) {
    if (!this.context || !this.on || this.disposed || !this.buffers || !this.active || parameters.active === false || finite(parameters.level, this.level) <= 0) return;
    const c = this.context, now = c.currentTime, at = finite(when, now);
    // Throwing owns its riff; landing owns its drum; dropping gets only the boo.
    if (at < now - .05 || at > now + .25 || !['catch', 'crowd-catch', 'crowd-woo', 'crowd-boo', 'drop', 'kick'].includes(event.kind)) return;
    const t = Math.max(now + .002, at);
    if (['catch', 'crowd-catch', 'drop'].includes(event.kind) && Number.isInteger(event.id) && event.id >= 0 && event.id < MAX_PUGGLER_VOICES) {
      // A whole catch/throw dwell can fall between 20-ms state polls at high
      // tempo. The event must still interrupt this object's airborne sound.
      this.gateUntil[event.id] = Math.max(this.gateUntil[event.id], t + CATCH_GATE);
      this.releaseAir(event.id, t, true);
    }
    const drop = event.kind === 'drop' || event.kind === 'crowd-boo', cheer = event.kind === 'crowd-woo', crowd = drop || cheer;
    const id = cheer ? 'woo' : drop ? 'boo' : event.kind === 'kick' ? 'kick'
      : PUNK_DRUMS.includes(event.drum) ? event.drum : PUNK_DRUMS[clamp(Math.floor(finite(event.id)), 0, MAX_PUGGLER_VOICES - 1) % PUNK_DRUMS.length];
    const amount = clamp(finite(crowd ? (parameters.crowd ?? parameters.boo) : parameters.impacts, crowd ? 1 : 1.25), 0, crowd ? 1 : 2);
    if (amount === 0) return;
    if (['catch', 'crowd-catch'].includes(event.kind)) this.duckRiffs(t, amount);
    if (this.attacks.size >= MAX_PUGGLER_ATTACKS) this.disconnectVoice(this.attacks.values().next().value);
    if (crowd) {
      const boos = [...this.attacks].filter(v => ['boo', 'woo'].includes(v.role) && !v.releasing);
      if (boos.length >= 3) { boos[0].releasing = true; this.fadeVoice(boos[0]); }
    }
    const m = punkMotion(event, parameters);
    const source = c.createBufferSource(), gain = c.createGain(), pan = c.createStereoPanner();
    const skin = sonicSkin(parameters.skin), key = crowd || skin.id === 'punk' ? id : `${skin.id}:${id}`;
    source.buffer = crowd || skin.id === 'punk' ? this.buffers[id] : this.eraBuffers[key];
    const rate = crowd ? clamp(.95 + finite(event.id) * .015, .85, 1.1) : clamp(1 + (m.energy - .5) * .045, .95, 1.05);
    source.playbackRate.value = rate; pan.pan.value = crowd ? m.pan * .3 : m.pan;
    const duration = Math.max(.05, Math.min(source.buffer.duration / rate, crowd ? 2 : source.buffer.duration * clamp(finite(parameters.decay, 1), .2, 2)));
    const peak = amount * (crowd ? (cheer ? .58 : .64) : DRUM_GAIN[id] * skin.impact * (.72 + .28 * m.energy));
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(peak * (crowd ? 1 : 1.35), t + .002);
    if (!crowd) {
      gain.gain.setValueAtTime(peak * 1.35, t + .012);
      gain.gain.linearRampToValueAtTime(peak, t + Math.min(.042, duration * .45));
    }
    gain.gain.setValueAtTime(peak, t + Math.max(crowd ? .004 : .043, duration - .045));
    gain.gain.linearRampToValueAtTime(0, t + duration);
    source.connect(gain); gain.connect(pan); pan.connect(crowd ? this.bus : this.drumBus);
    const voice = { role: id, key, skin: crowd ? 'crowd' : skin.id, source, gain, pan }; this.attacks.add(voice);
    source.onended = () => this.disconnectVoice(voice); source.start(t); source.stop(t + duration + .01);
  }
  disconnectVoice(v) {
    if (!v || v.disconnected) return; v.disconnected = true;
    this.attacks.delete(v); this.airTails.delete(v);
    v.source.onended = null; try { v.source.stop(); } catch {}
    for (const node of [v.source, v.filter, v.gain, v.drive, v.dirt, v.pan]) node?.disconnect();
  }
  releaseRiffs() {
    for (let i = 0; i < MAX_PUGGLER_VOICES; i++) this.releaseAir(i);
    for (const v of this.airTails) if (v.releaseAt > this.context.currentTime) this.fadeVoice(v);
    if (this.ducking) {
      this.airDuck.gain.cancelScheduledValues(this.context.currentTime);
      this.airDuck.gain.setTargetAtTime(1, this.context.currentTime, .008);
      this.ducking = false;
    }
  }
  releaseAll() {
    this.releaseRiffs();
    for (const v of this.attacks) if (!v.releasing) { v.releasing = true; this.fadeVoice(v); }
  }
  releaseAttack(v) { this.disconnectVoice(v); }
  async close() {
    if (this.disposed) return; this.disposed = true; this.on = false; ++this.armSerial; this.abort?.abort();
    for (const voice of [...this.attacks, ...this.airTails, ...this.voices]) this.disconnectVoice(voice);
    this.voices = []; this.buffers = null; this.vocalBuffers = null; this.eraBuffers = null; this.releaseOutput?.();
    for (const node of [this.airBus, this.airDuck, this.vocalBus, this.vocalCompressor, this.drumBus, this.bus, this.compressor, this.ceiling, this.peakGuard, this.master]) node?.disconnect();
    if (this.context?.state !== 'closed') await this.context?.close();
  }
}
