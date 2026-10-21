import { connectAudioOutput } from "../../audio-output-manager.js";
import { resumeAudioContext } from "../../audio-startup.js";
import {
  IDENTITY_ORIENTATION, MAX_VOICES, ORBIT_SECONDS, clamp,
  grainHit, needleNormalAt, needleRadius, normalAt, rollPlayPose, wrap, zoneContainsNormal,
} from "./model.js";

const SCAN_SECONDS = .008;
const LOOKAHEAD_SECONDS = .13;
const MAX_PICKUP_ATTACKS = 16;
const FADE_SHAPE = Array.from({ length: 5 }, (_, index) =>
  Math.sin(index * Math.PI / 8) ** 2);

function fadeAt(fraction) {
  const position = clamp(fraction, 0, 1) * (FADE_SHAPE.length - 1);
  const index = Math.min(FADE_SHAPE.length - 2, Math.floor(position));
  return FADE_SHAPE[index] + (FADE_SHAPE[index + 1] - FADE_SHAPE[index])
    * (position - index);
}

function rampFade(param, when, duration, peak, backwards = false) {
  for (let index = 1; index < FADE_SHAPE.length; index++)
    param.linearRampToValueAtTime(
      peak * FADE_SHAPE[backwards ? FADE_SHAPE.length - 1 - index : index],
      when + duration * index / (FADE_SHAPE.length - 1));
}

function voiceGainAt(voice, when) {
  if (when <= voice.startAt || when >= voice.endAt) return 0;
  if (when < voice.startAt + voice.attack)
    return voice.peak * fadeAt((when - voice.startAt) / voice.attack);
  if (when > voice.endAt - voice.release)
    return voice.peak * fadeAt((voice.endAt - when) / voice.release);
  return voice.peak;
}

/** A grain fires on entry into its actual surface zone, using the audio clock. */
export class GlobuleAudio {
  constructor({ onHit = () => {}, onError = () => {} } = {}) {
    this.onHit = onHit;
    this.onError = onError;
    this.context = null;
    this.master = null;
    this.releaseOutput = null;
    this.buffers = new WeakMap();
    this.voices = new Set();
    this.timer = null;
    this.ribbons = [];
    this.orientation = IDENTITY_ORIENTATION;
    this.playPose = IDENTITY_ORIENTATION;
    this.enabled = false;
    this.playing = false;
    this.speed = 1;
    this.direction = 1;
    this.scatter = .68;
    this.needle = 3.5;
    this.needleWidth = 30;
    this.level = .58;
    this.anchorPhase = 0;
    this.anchorTime = 0;
    this.nextTime = 0;
    this.step = 0;
    this.inside = new Set();
    this.scratchInside = new Set();
    this.scratchPhase = null;
  }

  async arm() {
    if (this.context) {
      await resumeAudioContext(this.context);
      return;
    }
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Context) throw new Error("This browser cannot play collected audio.");
    const context = new Context({ latencyHint: "interactive" });
    this.context = context;
    try {
      // Start the resume inside the explicit Audio click, before any other await.
      await resumeAudioContext(context);
      if (this.context !== context) return;
      const master = context.createGain();
      master.gain.value = 0;
      this.releaseOutput = connectAudioOutput(context, master);
      this.master = master;
    } catch (cause) {
      await this.close();
      throw cause;
    }
  }

  setRibbons(ribbons, orientation = this.orientation, playPose = this.playPose) {
    const retained = new Set(ribbons);
    for (const voice of this.voices) {
      if (!retained.has(voice.ribbon)) this.releaseVoice(voice);
    }
    this.ribbons = ribbons;
    this.orientation = orientation;
    this.playPose = playPose;
  }
  setLevel(level) {
    this.level = clamp(level, 0, .8);
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(this.enabled ? this.level : 0, this.context.currentTime, .018);
  }
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.setLevel(this.level);
    if (!this.enabled) {
      this.stopScheduler();
      this.releaseVoices();
      this.inside.clear();
      this.scratchInside.clear();
      this.scratchPhase = null;
    } else if (this.playing) this.startScheduler();
  }
  setControls({ speed = this.speed, direction = this.direction,
    scatter = this.scatter, needle = this.needle,
    needleWidth = this.needleWidth, playPose = this.playPose,
    phase = this.phase() } = {}) {
    const now = this.context?.currentTime ?? 0;
    const live = this.playing && this.enabled;
    // Lookahead may already have scanned past "now". Compare the old physical
    // contact at the rebase point, not those future scheduled contacts.
    const oldNeedle = needleNormalAt(this.orientation, phase, this.needle,
      this.scatter, this.playPose);
    const oldInsideNow = live ? new Set(this.ribbons.filter(grain =>
      zoneContainsNormal(grain, oldNeedle, needleRadius(this.needleWidth)))
      .map(grain => grain.key)) : null;
    if (live) {
      this.stopScheduler();
      // Retain sounding scraps when steering or adjusting speed. Only cancel
      // lookahead attacks from the old route; new contact is scanned below.
      for (const voice of this.voices)
        if (voice.startAt > now) this.releaseVoice(voice);
    }
    this.anchorPhase = wrap(phase);
    this.anchorTime = now;
    this.speed = clamp(speed, .5, 2);
    this.direction = direction === -1 ? -1 : 1;
    this.scatter = clamp(scatter, 0, 1);
    this.needle = clamp(needle, 0, 7);
    this.needleWidth = Math.round(clamp(needleWidth, 0, 100));
    this.playPose = playPose;
    if (live) {
      this.inside = oldInsideNow;
      this.startScheduler(false);
    }
  }
  transport(playing, phase) {
    this.playing = Boolean(playing);
    this.anchorPhase = wrap(phase);
    this.anchorTime = this.context?.currentTime ?? 0;
    if (!this.playing) {
      this.stopScheduler();
      this.releaseVoices();
      this.inside.clear();
      return;
    }
    if (this.enabled) this.startScheduler();
  }
  phase(atTime = this.context?.currentTime ?? 0) {
    return wrap(this.anchorPhase + (this.playing ? Math.max(0, atTime - this.anchorTime)
      * this.speed * this.direction / ORBIT_SECONDS : 0));
  }
  seek(phase = 0, resetSequence = false) {
    this.stopScheduler();
    this.releaseVoices();
    this.anchorPhase = wrap(phase);
    this.anchorTime = this.context?.currentTime ?? 0;
    if (resetSequence) {
      this.step = 0; // Home repeats the same grain variations from the same ball.
      this.scratchInside.clear();
      this.scratchPhase = null;
    }
    if (this.playing && this.enabled) this.startScheduler();
  }
  /**
   * A scratch sweeps over every intervening zone, including across the seam.
   * Phase may be unwrapped, so fast drags never teleport past a tiny grain.
   */
  scratch(phase, force = false) {
    if (!this.enabled || !this.context || this.context.state !== "running" || !this.ribbons.length) return;
    const now = this.context.currentTime;
    try {
      if (force || this.scratchPhase === null) {
        this.scratchInside.clear();
        this.scratchPhase = phase;
        this.scratchInside = this.scanAt(phase, now + .012, this.scratchInside);
        return;
      }
      const previous = this.scratchPhase;
      const steps = Math.min(160, Math.max(1, Math.ceil(Math.abs(phase - previous) * 320)));
      for (let step = 1; step <= steps; step++) {
        this.scratchInside = this.scanAt(previous + (phase - previous) * step / steps,
          now + .012 + step / steps * .025, this.scratchInside);
      }
      this.scratchPhase = phase;
    } catch (cause) {
      this.fail(cause);
    }
  }

  /** Trace every intervening *screen-space roll*, not just the pointer's
   * endpoints. This also catches brief zones crossed during a fast diagonal
   * swipe and works while the automatic motor is paused. */
  scratchRoll(fromPose, dx, dy, radius, phase = this.phase()) {
    if (!this.enabled || !this.context || this.context.state !== "running"
      || !this.ribbons.length || !Number.isFinite(radius) || radius <= 0) return;
    const now = this.context.currentTime;
    try {
      if (this.scratchPhase === null) {
        this.scratchInside.clear();
        this.scratchInside = this.scanAt(phase, now + .012, this.scratchInside, fromPose);
      }
      const steps = Math.min(160, Math.max(1,
        Math.ceil(Math.hypot(dx, dy) / (radius * .035))));
      for (let step = 1; step <= steps; step++) {
        const pose = rollPlayPose(fromPose, dx * step / steps, dy * step / steps, radius);
        this.scratchInside = this.scanAt(phase, now + .012 + step / steps * .025,
          this.scratchInside, pose);
      }
      this.scratchPhase = phase;
    } catch (cause) {
      this.fail(cause);
    }
  }

  /** Audition new PCM at the moment of contact, whether Play is moving or not.
   * A long pointer jump may collect hundreds of cells: sample that sweep in
   * order instead of creating hundreds of simultaneous Web Audio nodes. */
  auditionPickup(grains) {
    if (!this.enabled || !this.master || this.context?.state !== "running"
      || !grains?.length) return 0;
    const count = Math.min(MAX_PICKUP_ATTACKS, grains.length);
    let sounded = 0;
    try {
      for (let index = 0; index < count; index++) {
        const grain = grains[Math.floor(index * grains.length / count)];
        if (this.schedule({ ...grainHit(grain), pickup: true },
          this.context.currentTime + .012 + index * .008, 1)) sounded++;
      }
    } catch (cause) { this.fail(cause); }
    return sounded;
  }

  startScheduler(resetContact = true) {
    if (!this.context || !this.master || !this.enabled || !this.playing || this.timer) return;
    if (resetContact) this.inside.clear();
    this.scratchInside.clear();
    this.scratchPhase = null;
    this.nextTime = this.context.currentTime + .025;
    this.tick();
    this.timer = setInterval(() => this.tick(), 30);
  }
  stopScheduler() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  releaseVoices() {
    for (const voice of this.voices) this.releaseVoice(voice);
  }
  releaseVoice(voice) {
    if (voice.released) return;
    voice.released = true;
    const now = this.context?.currentTime ?? 0;
    try {
      const gain = voice.gain.gain;
      if (voice.startAt > now) {
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(0, now);
        voice.source.stop(now);
      } else if (voice.endAt - now > .032) {
        // cancelScheduledValues alone drops an in-flight ramp back to its
        // previous event, producing a click. Hold its instantaneous level.
        if (typeof gain.cancelAndHoldAtTime === "function") gain.cancelAndHoldAtTime(now);
        else {
          const level = voiceGainAt(voice, now);
          gain.cancelScheduledValues(now);
          gain.setValueAtTime(level, now);
        }
        gain.linearRampToValueAtTime(0, now + .028);
        voice.source.stop(now + .032);
      }
      // Near its natural end, the original fade is shorter and already smooth.
    } catch { /* already ended or the context is closing */ }
  }
  bufferFor(ribbon, reverse) {
    let stored = this.buffers.get(ribbon);
    if (!stored) { stored = {}; this.buffers.set(ribbon, stored); }
    const key = reverse ? "reverse" : "forward";
    if (stored[key]) return stored[key];
    const { channels, sampleRate } = ribbon;
    const buffer = this.context.createBuffer(channels.length, channels[0].length, sampleRate);
    channels.forEach((channel, index) => {
      const data = reverse ? Float32Array.from(channel).reverse() : channel;
      buffer.copyToChannel(data, index);
    });
    stored[key] = buffer;
    return buffer;
  }
  /** Scan contact, not proximity: an empty spot stays silent even on a full ball. */
  scanAt(phase, when, previouslyInside, playPose = this.playPose) {
    const inside = new Set(), arriving = [];
    const needle = needleNormalAt(this.orientation, phase, this.needle, this.scatter, playPose);
    const radius = needleRadius(this.needleWidth);
    for (const grain of this.ribbons) {
      if (!zoneContainsNormal(grain, needle, radius)) continue;
      inside.add(grain.key);
      if (!previouslyInside.has(grain.key)) arriving.push(grain);
    }
    // In a crowded crossing, the nearest actual contacts win the voice budget;
    // source number and original tape position never determine priority.
    arriving.sort((left, right) => {
      const distance = grain => {
        const normal = grain.normal ?? normalAt(grain.angle, grain.latitude);
        return (1 - (normal[0] * needle[0] + normal[1] * needle[1]
          + normal[2] * needle[2]))
          / Math.max(grain.angularRadius * 2 * Math.PI,
            grain.latitudeRadius * Math.PI / 7) ** 2;
      };
      return distance(left) - distance(right);
    });
    for (const grain of arriving) this.schedule(grainHit(grain, this.scatter, this.step++, this.direction), when);
    return inside;
  }
  schedule(hit, when, speed = this.speed) {
    if (this.voices.size >= MAX_VOICES) return false;
    const context = this.context;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const pan = context.createStereoPanner();
    source.buffer = this.bufferFor(hit.ribbon, hit.reverse);
    source.playbackRate.value = clamp(speed * hit.rate, .35, 2.8);
    pan.pan.value = hit.pan;
    source.connect(gain);
    gain.connect(pan);
    pan.connect(this.master);
    const duration = source.buffer.duration / source.playbackRate.value;
    const attack = Math.min(.018, duration * .26);
    const release = Math.min(.038, duration * .4);
    let overlapping = 0;
    for (const voice of this.voices)
      if (!voice.released && voice.startAt <= when && voice.endAt > when) overlapping++;
    // A stereo panner sums both input channels toward the panned side; bound
    // that gain as well as the number of overlapping full-scale sample voices.
    const stereoSpread = hit.ribbon.channels.length === 2
      ? 1 + Math.sin(Math.abs(pan.pan.value) * Math.PI / 2) : 1;
    const peak = .22 / ((1 + overlapping) ** .8 * stereoSpread);
    gain.gain.setValueAtTime(0, when);
    rampFade(gain.gain, when, attack, peak);
    gain.gain.setValueAtTime(peak, when + duration - release);
    rampFade(gain.gain, when + duration - release, release, peak, true);
    const voice = { source, gain, pan, ribbon: hit.ribbon, released: false,
      startAt: when, endAt: when + duration, attack, release, peak };
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      pan.disconnect();
      this.voices.delete(voice);
    };
    try {
      source.start(when);
      source.stop(when + duration + .004);
      this.voices.add(voice);
    } catch (cause) {
      source.disconnect(); gain.disconnect(); pan.disconnect();
      throw cause;
    }
    this.onHit(hit.ribbon, hit);
    return true;
  }
  fail(cause) {
    this.setEnabled(false);
    this.onError(cause);
  }
  tick() {
    const context = this.context;
    if (!context || context.state !== "running" || !this.enabled || !this.playing) return;
    try {
      // When the page or context was suspended, skip stale attacks rather than
      // bursting through a backlog on the next interval.
      if (this.nextTime < context.currentTime - .03) {
        this.nextTime = context.currentTime + .02;
        this.inside.clear();
      }
      let probes = 0;
      while (this.nextTime < context.currentTime + LOOKAHEAD_SECONDS && probes++ < 40) {
        this.inside = this.scanAt(this.phase(this.nextTime), this.nextTime, this.inside);
        this.nextTime += SCAN_SECONDS;
      }
    } catch (cause) {
      this.fail(cause);
    }
  }
  async close() {
    this.enabled = false;
    this.playing = false;
    this.stopScheduler();
    this.releaseVoices();
    for (const voice of this.voices) {
      voice.source.onended = null;
      voice.source.disconnect();
      voice.gain.disconnect();
      voice.pan.disconnect();
    }
    this.voices.clear();
    this.releaseOutput?.();
    this.releaseOutput = null;
    this.master?.disconnect();
    this.master = null;
    const context = this.context;
    this.context = null;
    try { await context?.close(); } catch { /* already closed */ }
    this.buffers = new WeakMap();
    this.inside.clear();
    this.scratchInside.clear();
    this.scratchPhase = null;
  }
}
