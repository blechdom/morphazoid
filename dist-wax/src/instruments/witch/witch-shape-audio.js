import { buildShapesScene } from '../shapes/shapes-scene.js';
import { geometryContactVoice } from '../../families/geometry-presets/geometry-sound.js';
import { reduceVoiceContacts, normalizeVoiceGains, limitVoicePeakSum } from '../../audio.js';
import { WITCH_SHAPE_FORMS, WITCH_SHAPE_MORPH_SECONDS, getWitchShapeForm, createWitchShapeSceneState } from './witch-shape-model.js';

export const WITCH_SHAPE_CHARM_DURATION = 1.4;
const PLAN_FRAMES = 49;
const CONTACT_LIMIT = 8;
const VOICE_COUNT = 24;
const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const wrap = value => value > TAU || value < -TAU ? value % TAU : value;
let preparedPlans;

function hashPhase(key) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index); hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff * TAU;
}

/** The same moving plane/hyperplane and geometryContactVoice mapping used by
 * SHAPES' originalSynthSpecs. Eight contacts retain its y-to-pitch, x-to-pan
 * and z/W-to-modulation relationships. Preparation calls no browser APIs or
 * structuredClone, and never runs at an onset or inside the sample callback. */
function plans() {
  if (preparedPlans) return preparedPlans;
  preparedPlans = Object.freeze(WITCH_SHAPE_FORMS.map(form => {
    const state = createWitchShapeSceneState(form.id);
    const parameters = Object.freeze({ baseFrequency: 88, pitchRange: 2.75,
      soundMode: form.dimension === '4d' ? 'pm' : 'fm', fmIndex: 5.2, fmRatio: 1.8,
      playing: true, speed: 1 / WITCH_SHAPE_MORPH_SECONDS, direction: 1 });
    const frames = Array.from({ length: PLAN_FRAMES }, (_, index) => {
      const phase = .04 + .84 * index / (PLAN_FRAMES - 1);
      state.play.continuousPhase = phase;
      const scene = buildShapesScene(state), kind = form.dimension === '4d' ? 'hyper' : 'solid';
      const contacts = form.dimension === '4d' && scene.contacts.length > CONTACT_LIMIT
        ? Array.from({ length: CONTACT_LIMIT }, (_, i) => scene.contacts[Math.floor(i * scene.contacts.length / CONTACT_LIMIT)])
        : scene.contacts;
      const mapped = contacts.map((contact, i) => {
        // SHAPES' disabled geometry envelope preserves each contact's native
        // corner strength; the finite charm envelope is applied to the mix.
        const voice = geometryContactVoice(kind, contact, i, parameters, (_phase, peak) => peak);
        return { ...voice, pan: voice.pan * .85 };
      });
      const specs = limitVoicePeakSum(normalizeVoiceGains(reduceVoiceContacts(mapped, CONTACT_LIMIT)), .78).map(Object.freeze);
      return { phase, specs: Object.freeze(specs), targets: null };
    });
    for (let index = 0; index < frames.length; index++) {
      const from = frames[index].specs, to = frames[Math.min(frames.length - 1, index + 1)].specs;
      const keys = new Set([...from, ...to].map(voice => voice.key));
      frames[index].targets = Object.freeze([...keys].map(key => {
        const a = from.find(voice => voice.key === key), b = to.find(voice => voice.key === key);
        return Object.freeze({ key, seed: hashPhase(key), from: a ?? Object.freeze({ ...b, gain: 0 }), to: b ?? Object.freeze({ ...a, gain: 0 }) });
      }));
      Object.freeze(frames[index]);
    }
    return Object.freeze({ form: form.id, index: form.index, dimension: form.dimension,
      parameters, frames: Object.freeze(frames), source: 'SHAPES native plane/hyperplane continuous synthesis' });
  }));
  return preparedPlans;
}

/** Compact scalar adapter of MorphazoidContourSynth's native FM/PM voices:
 * same edge-key phase seeds, oscillators, slews, equal-power pan and geometry
 * gain limits. Only the short plane scan is retained, not SHAPES' whole UI. */
export class WitchShapeCharmDSP {
  constructor(rate = 48000) {
    this.rate = Number.isFinite(rate) ? Math.max(8000, Math.min(192000, rate)) : 48000;
    this.dt = 1 / this.rate; this.plans = plans(); this.plan = this.plans[0];
    this.voices = Array.from({ length: VOICE_COUNT }, () => ({ active: false, retained: false,
      key: '', target: null, mode: 'fm', gain: 0, frequency: 110, pan: 0,
      modulationIndex: 0, modulationRatio: 1, phase: 0, modulationPhase: 0 }));
    this.frequencySlew = 1 - Math.exp(-1 / (this.rate * .018));
    this.parameterSlew = 1 - Math.exp(-1 / (this.rate * .025));
    this.modulationSlew = 1 - Math.exp(-1 / (this.rate * .012));
    this.gainSlew = 1 - Math.exp(-1 / (this.rate * .004));
    this.active = false; this.age = WITCH_SHAPE_CHARM_DURATION; this.renderAge = this.age;
    this.form = this.plan.form; this.startedAt = 0; this.lastTime = 0; this.frame = -1; this.trajectory = 0;
    this.release = 1; this.releasing = false; this.releaseStep = this.dt / .035; this.attack = 0;
    this.pending = false; this.pendingForm = 0; this.pendingStartedAt = 0;
    this.left = this.right = 0;
  }

  get activeVoiceCount() { return this.voices.reduce((sum, voice) => sum + Number(voice.active), 0); }

  start(form, startedAt, time) {
    this.plan = this.plans[form]; this.form = this.plan.form;
    this.startedAt = startedAt; this.lastTime = time; this.age = this.renderAge = Math.max(0, time - startedAt);
    this.active = true; this.releasing = false; this.release = 1; this.attack = 0; this.frame = -1; this.trajectory = 0;
    for (const voice of this.voices) { voice.active = false; voice.target = null; voice.gain = 0; }
  }

  trigger(time = 0, detail = {}) {
    if (!Number.isFinite(time)) return false;
    const startedAt = Number.isFinite(detail?.startedAt) ? Math.max(0, detail.startedAt) : time;
    const age = time - startedAt, form = getWitchShapeForm(detail?.form).index;
    if (age >= WITCH_SHAPE_CHARM_DURATION || age < -.25) return false;
    if (this.active) {
      this.pending = true; this.pendingForm = form; this.pendingStartedAt = startedAt;
      this.releasing = true; this.releaseStep = this.dt / .012;
    } else this.start(form, startedAt, time);
    return true;
  }

  cancel() {
    this.pending = false;
    if (this.active) { this.releasing = true; this.releaseStep = this.dt / .035; }
  }

  stop() {
    this.active = false;
    for (const voice of this.voices) { voice.active = false; voice.target = null; voice.gain = 0; }
  }

  setFrame(index) {
    const targets = this.plan.frames[index].targets;
    for (const voice of this.voices) { voice.retained = false; voice.target = null; }
    // Keep existing edge phases before allocating newly intersected edges.
    for (const target of targets) for (const voice of this.voices) {
      if (voice.active && voice.key === target.key) { voice.retained = true; voice.target = target; break; }
    }
    for (const target of targets) {
      let found = false;
      for (const voice of this.voices) if (voice.retained && voice.key === target.key) { found = true; break; }
      if (found) continue;
      let chosen = null;
      for (const voice of this.voices) if (!voice.retained && (!chosen || !voice.active || voice.gain < chosen.gain)) {
        chosen = voice; if (!voice.active) break;
      }
      if (!chosen) continue;
      const spec = target.from, seed = target.seed;
      chosen.active = chosen.retained = true; chosen.key = target.key; chosen.target = target;
      chosen.mode = spec.mode; chosen.gain = 0; chosen.frequency = spec.frequency; chosen.pan = spec.pan;
      chosen.modulationIndex = spec.modulationIndex; chosen.modulationRatio = spec.modulationRatio;
      chosen.phase = seed; chosen.modulationPhase = seed * .61803398875;
    }
    this.frame = index;
  }

  next(time, enabled = true, playing = true) {
    this.left = this.right = 0;
    if (!this.active) return;
    if (!enabled || !playing || !Number.isFinite(time) || time < this.lastTime - 1e-9) this.cancel();
    if (Number.isFinite(time)) this.lastTime = time;
    if (this.releasing) {
      this.release = Math.max(0, this.release - this.releaseStep); this.renderAge += this.dt;
    } else if (Number.isFinite(time)) this.age = this.renderAge = Math.max(0, time - this.startedAt);
    if (!this.release || this.renderAge >= WITCH_SHAPE_CHARM_DURATION) {
      this.stop();
      if (this.pending && enabled && playing && time - this.pendingStartedAt < WITCH_SHAPE_CHARM_DURATION) {
        this.start(this.pendingForm, this.pendingStartedAt, time);
      } else if (!this.releasing) this.age = WITCH_SHAPE_CHARM_DURATION;
      this.pending = false;
      if (!this.active) return;
    }
    if (!this.releasing && time < this.startedAt) return;
    this.attack = Math.min(1, this.attack + this.dt / .008);
    const position = clamp(this.renderAge / WITCH_SHAPE_MORPH_SECONDS) * (PLAN_FRAMES - 1);
    const index = Math.min(PLAN_FRAMES - 1, Math.floor(position));
    // Only already-started edges may release. A cancelled pending cue never
    // opens its first voices, and the old shape cannot cross new edges while
    // fading into a newer click.
    if (!this.releasing) {
      this.trajectory = position - index;
      if (index !== this.frame) this.setFrame(index);
    }
    const amount = this.trajectory;
    for (const voice of this.voices) {
      if (!voice.active) continue;
      const target = voice.target, a = target?.from, b = target?.to;
      voice.gain += ((target ? a.gain + (b.gain - a.gain) * amount : 0) - voice.gain) * this.gainSlew;
      if (!target && voice.gain < .00001) { voice.active = false; continue; }
      if (target) {
        voice.frequency += (a.frequency + (b.frequency - a.frequency) * amount - voice.frequency) * this.frequencySlew;
        voice.pan += (a.pan + (b.pan - a.pan) * amount - voice.pan) * this.parameterSlew;
        voice.modulationIndex += (a.modulationIndex + (b.modulationIndex - a.modulationIndex) * amount - voice.modulationIndex) * this.modulationSlew;
        voice.modulationRatio += (a.modulationRatio + (b.modulationRatio - a.modulationRatio) * amount - voice.modulationRatio) * this.modulationSlew;
      }
      const increment = TAU * Math.max(20, Math.min(this.rate * .45, voice.frequency)) / this.rate;
      const modulationIncrement = increment * voice.modulationRatio;
      voice.modulationPhase = wrap(voice.modulationPhase + modulationIncrement);
      const modulation = Math.sin(voice.modulationPhase);
      voice.phase = wrap(voice.phase + increment + (voice.mode === 'fm' ? modulationIncrement * voice.modulationIndex * modulation : 0));
      const sample = Math.sin(voice.phase + (voice.mode === 'pm' ? voice.modulationIndex * modulation : 0)) * voice.gain;
      const pan = (Math.max(-1, Math.min(1, voice.pan)) + 1) * Math.PI / 4;
      this.left += sample * Math.cos(pan); this.right += sample * Math.sin(pan);
    }
    const gain = .22 * smooth(this.attack) * smooth(this.release)
      * (1 - smooth((this.renderAge - WITCH_SHAPE_MORPH_SECONDS) / (WITCH_SHAPE_CHARM_DURATION - WITCH_SHAPE_MORPH_SECONDS)));
    this.left *= gain; this.right *= gain;
  }
}
