import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";
import {
  SPELLING_DIPHONE_ATLAS_URL,
  SPELLING_DIPHONE_CLIPS,
} from "./spelling-diphone-atlas.js";
import { spellingPhoneDefinition } from "./spelling-pronunciation.js";
import {
  vocalzoidOpenBank,
  vocalzoidOpenBankRecipe,
} from "./vocalzoid-open-banks.js";
import {
  clampVocalzoid,
  normalizeUtauPath,
  resolveUtauEntry,
  vocalzoidRenderPlan,
  vocalzoidSequenceBeats,
  vocalzoidStyle,
} from "./vocalzoid.js";

const SILENCE = 0.0001;
const JOIN_OVERLAP_SECONDS = 0.024;
export const VOCALZOID_MAX_BANK_FILES = 12_000;
export const VOCALZOID_MAX_BANK_BYTES = 512 * 1024 * 1024;
export const VOCALZOID_MAX_DECODED_BANK_BYTES = 256 * 1024 * 1024;

function contextConstructor(runtime) {
  return runtime?.AudioContext ?? runtime?.webkitAudioContext;
}

function decodeAudioData(context, bytes) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const success = (buffer) => {
      if (settled) return;
      settled = true;
      resolve(buffer);
    };
    const failure = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      const result = context.decodeAudioData(bytes, success, failure);
      if (result?.then) result.then(success, failure);
    } catch (error) {
      failure(error);
    }
  });
}

function hold(parameter, at, fallback = SILENCE) {
  if (!parameter) return;
  if (typeof parameter.cancelAndHoldAtTime === "function") {
    try {
      parameter.cancelAndHoldAtTime(at);
      return;
    } catch {}
  }
  parameter.cancelScheduledValues?.(at);
  parameter.setValueAtTime?.(Number.isFinite(parameter.value) ? parameter.value : fallback, at);
}

function equalPowerCurve(length = 48, fadeIn = true) {
  return Float32Array.from({ length }, (_, index) => {
    const phase = index / Math.max(1, length - 1);
    return fadeIn ? Math.sin(phase * Math.PI * 0.5) : Math.cos(phase * Math.PI * 0.5);
  });
}

const FADE_IN_CURVE = equalPowerCurve();
const FADE_OUT_CURVE = equalPowerCurve(48, false);

function setEnvelope(parameter, at, duration, peak = 0.9, fadeSeconds = 0.025) {
  const safeDuration = Math.max(0.035, duration);
  const fade = Math.min(fadeSeconds, safeDuration * 0.42);
  const end = at + safeDuration;
  parameter.cancelScheduledValues?.(at);
  parameter.setValueAtTime?.(0, at);
  if (typeof parameter.setValueCurveAtTime === "function") {
    parameter.setValueCurveAtTime(
      Float32Array.from(FADE_IN_CURVE, (value) => value * peak),
      at,
      fade,
    );
    parameter.setValueAtTime?.(peak, Math.max(at + fade, end - fade));
    parameter.setValueCurveAtTime(
      Float32Array.from(FADE_OUT_CURVE, (value) => value * peak),
      Math.max(at + fade, end - fade),
      fade,
    );
  } else {
    parameter.linearRampToValueAtTime?.(peak, at + fade);
    parameter.setValueAtTime?.(peak, Math.max(at + fade, end - fade));
    parameter.linearRampToValueAtTime?.(0, end);
  }
}

function configureCompressor(node, context) {
  const at = context.currentTime;
  node.threshold?.setValueAtTime?.(-16, at);
  node.knee?.setValueAtTime?.(10, at);
  node.ratio?.setValueAtTime?.(7, at);
  node.attack?.setValueAtTime?.(0.004, at);
  node.release?.setValueAtTime?.(0.14, at);
}

function fileBytes(file) {
  if (typeof file?.arrayBuffer === "function") return file.arrayBuffer();
  if (file instanceof ArrayBuffer) return Promise.resolve(file.slice(0));
  if (ArrayBuffer.isView(file)) {
    return Promise.resolve(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  }
  throw new TypeError("Voicebank sample is not a readable file.");
}

function byteLength(file) {
  if (Number.isFinite(file?.size)) return Math.max(0, Number(file.size));
  if (file instanceof ArrayBuffer) return file.byteLength;
  if (ArrayBuffer.isView(file)) return file.byteLength;
  return 0;
}

function trailingMatch(files, requestedPath) {
  const normalized = normalizeUtauPath(requestedPath);
  if (files.has(normalized)) return files.get(normalized);
  const suffix = `/${normalized}`;
  for (const [path, file] of files) {
    if (path.endsWith(suffix)) return file;
  }
  const basename = normalized.split("/").pop();
  const sameName = [...files].filter(([path]) => path.split("/").pop() === basename);
  return sameName.length === 1 ? sameName[0][1] : null;
}

function sourceMidiFor(bank, entry) {
  const requested = normalizeUtauPath(entry.path || entry.filename);
  const direct = bank.sourceMidiByPath?.get(requested);
  if (Number.isFinite(direct)) return direct;
  const suffix = `/${requested}`;
  for (const [path, midi] of bank.sourceMidiByPath ?? []) {
    if (path.endsWith(suffix) && Number.isFinite(midi)) return midi;
  }
  return clampVocalzoid(bank.rootMidi, 24, 96);
}

function risingZeroNear(buffer, targetSeconds, minimumSeconds, maximumSeconds) {
  if (
    typeof buffer?.getChannelData !== "function"
    || !(buffer.sampleRate > 0)
  ) return targetSeconds;
  let samples;
  try { samples = buffer.getChannelData(0); } catch { return targetSeconds; }
  if (!samples?.length) return targetSeconds;
  const minimum = Math.max(1, Math.floor(minimumSeconds * buffer.sampleRate));
  const maximum = Math.min(samples.length - 1, Math.ceil(maximumSeconds * buffer.sampleRate));
  const target = Math.round(targetSeconds * buffer.sampleRate);
  let best = -1;
  let distance = Infinity;
  for (let index = minimum; index <= maximum; index += 1) {
    if (samples[index - 1] <= 0 && samples[index] > 0) {
      const candidateDistance = Math.abs(index - target);
      if (candidateDistance < distance) {
        best = index;
        distance = candidateDistance;
      }
    }
  }
  return best >= 0 ? best / buffer.sampleRate : targetSeconds;
}

function builtInSustainWindow(buffer, clip) {
  if (clip.sustainEnd > clip.sustainStart) {
    return Object.freeze({
      start: clip.offset + clip.sustainStart,
      end: clip.offset + clip.sustainEnd,
    });
  }
  if (!(clip.duration >= 0.14) || !["vowel", "glide"].includes(clip.kind)) return null;
  const minimum = clip.offset + clip.duration * 0.42;
  const maximum = clip.offset + clip.duration * 0.9;
  const start = risingZeroNear(
    buffer,
    clip.offset + clip.duration * 0.54,
    minimum,
    clip.offset + clip.duration * 0.66,
  );
  const end = risingZeroNear(
    buffer,
    clip.offset + clip.duration * 0.82,
    clip.offset + clip.duration * 0.7,
    maximum,
  );
  if (!(end - start >= 0.045) || start < clip.offset || end > clip.offset + clip.duration) {
    return null;
  }
  return Object.freeze({ start, end });
}

export class VocalzoidAudio {
  constructor({ runtime = globalThis, level = 0.52, style = "raw" } = {}) {
    this.runtime = runtime;
    this.level = clampVocalzoid(level, 0, 0.86);
    this.style = vocalzoidStyle(style);
    this.context = null;
    this.atlas = null;
    this.bank = null;
    this.openBank = null;
    this.openBuffers = new Map();
    this.builtInLoops = new WeakMap();
    this.input = null;
    this.highpass = null;
    this.presence = null;
    this.lowpass = null;
    this.compressor = null;
    this.master = null;
    this.analyser = null;
    this.releaseAudioOutput = null;
    this.active = new Set();
    this.enabled = false;
    this.buildGeneration = 0;
    this.playGeneration = 0;
    this.buildPromise = null;
    this.startedAt = 0;
    this.playbackDuration = 0;
  }

  get running() {
    return Boolean(this.enabled && this.context?.state === "running" && this.atlas);
  }

  get playing() {
    return this.active.size > 0;
  }

  async enable() {
    const generation = this.buildGeneration;
    if (!this.context || this.context.state === "closed" || !this.atlas) {
      if (!this.buildPromise) {
        this.buildPromise = this.build(generation).finally(() => {
          this.buildPromise = null;
        });
      }
      await this.buildPromise;
    }
    const context = this.context;
    if (!context || !this.atlas || generation !== this.buildGeneration) {
      throw new Error("Vocalzoid audio start was cancelled.");
    }
    unlockAudioContext(context);
    if (context.state !== "running") await context.resume?.();
    this.enabled = true;
    this.master.gain.cancelScheduledValues?.(context.currentTime);
    this.master.gain.setTargetAtTime?.(this.level, context.currentTime, 0.012);
    return this;
  }

  async build(generation = this.buildGeneration) {
    const Audio = contextConstructor(this.runtime);
    const fetcher = this.runtime?.fetch ?? globalThis.fetch;
    if (typeof Audio !== "function" || typeof fetcher !== "function") {
      throw new Error("Vocalzoid needs Web Audio and fetch support.");
    }
    const context = new Audio({ latencyHint: "interactive" });
    this.context = context;
    try {
      unlockAudioContext(context);
      const [response] = await Promise.all([
        fetcher.call(this.runtime, SPELLING_DIPHONE_ATLAS_URL),
        context.state !== "running" ? context.resume?.() : null,
      ]);
      if (!response || response.ok === false) throw new Error("The KAL16 voice atlas could not load.");
      const atlas = await decodeAudioData(context, await response.arrayBuffer());
      if (generation !== this.buildGeneration || context !== this.context) {
        throw new Error("Vocalzoid audio start was cancelled.");
      }

      const input = context.createGain();
      const highpass = context.createBiquadFilter();
      const presence = context.createBiquadFilter();
      const lowpass = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      const master = context.createGain();
      const analyser = context.createAnalyser();
      highpass.type = "highpass";
      presence.type = "peaking";
      presence.Q.value = 0.72;
      lowpass.type = "lowpass";
      lowpass.Q.value = 0.35;
      master.gain.value = 0;
      analyser.fftSize = 1_024;
      analyser.smoothingTimeConstant = 0.76;
      configureCompressor(compressor, context);
      input.connect(highpass);
      highpass.connect(presence);
      presence.connect(lowpass);
      lowpass.connect(compressor);
      compressor.connect(master);
      master.connect(analyser);
      this.releaseAudioOutput = connectAudioOutput(context, analyser, { runtime: this.runtime });

      this.atlas = atlas;
      this.input = input;
      this.highpass = highpass;
      this.presence = presence;
      this.lowpass = lowpass;
      this.compressor = compressor;
      this.master = master;
      this.analyser = analyser;
      this.applyStyle();
    } catch (error) {
      this.releaseAudioOutput?.();
      this.releaseAudioOutput = null;
      if (this.context === context) this.context = null;
      if (context.state !== "closed") {
        try { await context.close?.(); } catch {}
      }
      throw error;
    }
  }

  setLevel(value) {
    this.level = clampVocalzoid(value, 0, 0.86);
    if (this.context && this.master) {
      hold(this.master.gain, this.context.currentTime, this.level);
      this.master.gain.setTargetAtTime?.(this.level, this.context.currentTime, 0.012);
    }
    return this.level;
  }

  setStyle(value) {
    this.style = vocalzoidStyle(value);
    this.applyStyle();
    return this.style;
  }

  applyStyle() {
    if (!this.context || !this.highpass || !this.presence || !this.lowpass) return;
    const at = this.context.currentTime;
    this.highpass.frequency.setTargetAtTime?.(this.style.highpass, at, 0.018);
    this.presence.frequency.setTargetAtTime?.(this.style.presenceFrequency, at, 0.018);
    this.presence.gain.setTargetAtTime?.(this.style.presenceGain, at, 0.018);
    this.lowpass.frequency.setTargetAtTime?.(this.style.lowpass, at, 0.018);
    this.input.gain.setTargetAtTime?.(this.style.drive, at, 0.018);
  }

  setBank(bank) {
    if (!bank) {
      this.bank = null;
      return null;
    }
    const files = bank.files instanceof Map
      ? new Map([...bank.files].map(([path, file]) => [normalizeUtauPath(path), file]))
      : new Map();
    if (files.size > VOCALZOID_MAX_BANK_FILES) {
      throw new Error(`Voicebank has more than ${VOCALZOID_MAX_BANK_FILES.toLocaleString()} files.`);
    }
    const totalBytes = [...files.values()].reduce((sum, file) => sum + byteLength(file), 0);
    if (totalBytes > VOCALZOID_MAX_BANK_BYTES) {
      throw new Error("Voicebank is larger than the 512 MB browser safety limit.");
    }
    this.bank = {
      name: String(bank.name || "Local UTAU bank"),
      entries: [...(bank.entries ?? [])],
      files,
      sourceMidiByPath: bank.sourceMidiByPath instanceof Map
        ? new Map([...bank.sourceMidiByPath].map(([path, midi]) => [normalizeUtauPath(path), midi]))
        : new Map(),
      rootMidi: clampVocalzoid(bank.rootMidi ?? 60, 24, 96),
      decoded: new Map(),
      decodedBytes: 0,
    };
    this.openBank = null;
    return this.bank;
  }

  clearBank() {
    this.bank = null;
  }

  setOpenBank(value) {
    this.openBank = vocalzoidOpenBank(value);
    if (this.openBank) this.bank = null;
    return this.openBank;
  }

  clearOpenBank() {
    this.openBank = null;
  }

  async loadOpenBank() {
    if (!this.openBank || !this.context) return null;
    const bank = this.openBank;
    const context = this.context;
    if (this.openBuffers.has(bank.id)) return this.openBuffers.get(bank.id);
    const fetcher = this.runtime?.fetch ?? globalThis.fetch;
    const promise = Promise.resolve(fetcher.call(this.runtime, bank.url))
      .then(async (response) => {
        if (!response || response.ok === false) {
          throw new Error(`${bank.name} could not load.`);
        }
        const buffer = await decodeAudioData(context, await response.arrayBuffer());
        if (this.context !== context) throw new Error("Vocalzoid audio start was cancelled.");
        return buffer;
      })
      .catch((error) => {
        this.openBuffers.delete(bank.id);
        throw error;
      });
    this.openBuffers.set(bank.id, promise);
    return promise;
  }

  async decodeBankEntry(entry) {
    if (!this.bank || !this.context) return null;
    const bank = this.bank;
    const context = this.context;
    const path = normalizeUtauPath(entry.path || entry.filename);
    if (bank.decoded.has(path)) return bank.decoded.get(path);
    const file = trailingMatch(bank.files, path);
    if (!file) return null;
    const promise = fileBytes(file)
      .then((bytes) => decodeAudioData(context, bytes))
      .then((buffer) => {
        if (this.bank !== bank || this.context !== context) {
          throw new Error("Voicebank decoding was cancelled.");
        }
        const decodedBytes = Math.max(0, Number(buffer?.length) || 0)
          * Math.max(1, Number(buffer?.numberOfChannels) || 1)
          * 4;
        if (bank.decodedBytes + decodedBytes > VOCALZOID_MAX_DECODED_BANK_BYTES) {
          throw new Error("Decoded voicebank audio reached the 256 MB memory safety limit.");
        }
        bank.decodedBytes += decodedBytes;
        return buffer;
      })
      .catch((error) => {
        bank.decoded.delete(path);
        throw error;
      });
    bank.decoded.set(path, promise);
    return promise;
  }

  async prepareBankNotes(notes) {
    if (!this.bank) return [];
    let previousPhone = "-";
    const resolved = [];
    for (const note of notes) {
      const entry = resolveUtauEntry(this.bank.entries, note, previousPhone);
      const phones = note.phones ?? [];
      if (phones.length) previousPhone = phones[phones.length - 1];
      resolved.push(entry);
    }
    const buffers = new Map();
    // Decode serially: AudioBuffer allocation happens before the decoded-memory
    // guard can inspect it, so parallel decoding can briefly multiply peak RAM.
    for (const entry of new Set(resolved.filter(Boolean))) {
      try {
        buffers.set(entry, await this.decodeBankEntry(entry));
      } catch {
        buffers.set(entry, null);
      }
    }
    return resolved.map((entry) => Object.freeze({
      entry,
      buffer: entry ? buffers.get(entry) ?? null : null,
    }));
  }

  rateAutomation(parameter, ratio, at, duration, {
    vibratoCents = 18,
    vibratoRate = 5.2,
    previousRatio = ratio,
    glideSeconds = 0.06,
  } = {}) {
    const glide = Math.min(Math.max(0, glideSeconds), duration * 0.35);
    parameter.cancelScheduledValues?.(at);
    if (glide > 0.001) {
      parameter.setValueAtTime?.(Math.max(0.001, previousRatio), at);
      parameter.exponentialRampToValueAtTime?.(Math.max(0.001, ratio), at + glide);
    } else {
      parameter.setValueAtTime?.(Math.max(0.001, ratio), at);
    }
    const vibratoStart = at + glide;
    const vibratoDuration = Math.max(0, duration - glide);
    if (vibratoDuration <= 0.04 || vibratoCents <= 0 || typeof parameter.setValueCurveAtTime !== "function") {
      parameter.setValueAtTime?.(ratio, vibratoStart);
      return;
    }
    const points = Math.max(32, Math.min(384, Math.ceil(vibratoDuration * 80)));
    const curve = Float32Array.from({ length: points }, (_, index) => {
      const progress = index / Math.max(1, points - 1);
      const onset = Math.min(1, progress / 0.22);
      const cents = Math.sin(progress * vibratoDuration * vibratoRate * Math.PI * 2)
        * vibratoCents * onset;
      return ratio * (2 ** (cents / 1_200));
    });
    parameter.setValueCurveAtTime(curve, vibratoStart, vibratoDuration);
  }

  trackSource(source, gain) {
    const active = { source, gain };
    this.active.add(active);
    source.onended = () => {
      this.active.delete(active);
      try { source.disconnect?.(); } catch {}
      try { gain.disconnect?.(); } catch {}
    };
    return active;
  }

  scheduleBuiltIn(event, baseTime, options, previousMidi) {
    const definition = spellingPhoneDefinition(event.phone);
    const clip = definition ? SPELLING_DIPHONE_CLIPS[definition.sampleKey] : null;
    if (!clip) return false;
    const context = this.context;
    const plannedAt = baseTime + event.start;
    const plannedDuration = Math.max(0.045, event.duration);
    const source = context.createBufferSource();
    const gain = context.createGain();
    const rootMidi = this.style.rootMidi;
    const ratio = 2 ** ((event.midi - rootMidi) / 12);
    const previousRatio = 2 ** (((previousMidi ?? event.midi) - rootMidi) / 12);
    source.buffer = this.atlas;
    let sustainWindow = null;
    if (event.sustain) {
      sustainWindow = this.builtInLoops.get(clip);
      if (sustainWindow === undefined) {
        sustainWindow = builtInSustainWindow(this.atlas, clip);
        this.builtInLoops.set(clip, sustainWindow);
      }
    }
    source.loop = Boolean(sustainWindow);
    if (sustainWindow) {
      source.loopStart = sustainWindow.start;
      source.loopEnd = sustainWindow.end;
    }
    const availableWall = clip.duration / Math.max(0.001, ratio);
    const audibleDuration = source.loop
      ? plannedDuration
      : Math.min(plannedDuration, availableWall);
    // Short edge consonants must touch their score boundary after pitching.
    // The plan gives pickups a 22 ms tail beyond that boundary; keep only a
    // bounded fraction of the real pitched clip there so even tiny onsets
    // begin before (and still cross) Note-On.
    let at = plannedAt;
    if (event.role === "onset") {
      const boundary = plannedAt + plannedDuration - 0.022;
      const overlap = Math.min(0.022, audibleDuration * 0.35);
      at = boundary + overlap - audibleDuration;
    } else if (event.role === "release") {
      at = plannedAt + plannedDuration - audibleDuration;
    }
    this.rateAutomation(source.playbackRate, ratio, at, audibleDuration, {
      vibratoCents: event.sustain ? options.vibratoCents : 0,
      vibratoRate: options.vibratoRate,
      previousRatio,
      glideSeconds: options.glideSeconds,
    });
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.input);
    setEnvelope(gain.gain, at, audibleDuration, clip.gain * (event.sustain ? 0.78 : 0.9), 0.024);
    this.trackSource(source, gain);
    try {
      if (source.loop) {
        source.start(at, clip.offset);
        source.stop(at + audibleDuration + 0.006);
      } else {
        source.start(at, clip.offset, Math.min(clip.duration, audibleDuration * ratio));
      }
      return true;
    } catch {
      source.onended = null;
      for (const active of this.active) {
        if (active.source === source) this.active.delete(active);
      }
      try { source.disconnect?.(); } catch {}
      try { gain.disconnect?.(); } catch {}
      return false;
    }
  }

  scheduleUtau(note, entry, buffer, baseTime, beatSeconds, options, previousMidi) {
    if (!entry || !buffer) return false;
    const context = this.context;
    const targetAt = baseTime + note.start * beatSeconds;
    const rootMidi = sourceMidiFor(this.bank, entry);
    const ratio = 2 ** ((note.midi - rootMidi) / 12);
    const previousRatio = 2 ** (((previousMidi ?? note.midi) - rootMidi) / 12);
    const preutter = clampVocalzoid(
      entry.preutterance / 1_000 / Math.max(0.001, ratio),
      0,
      0.45,
    );
    const at = Math.max(context.currentTime + 0.004, targetAt - preutter);
    const noteDuration = note.duration * beatSeconds + preutter;
    const offset = Math.min(buffer.duration, Math.max(0, entry.offset / 1_000));
    const end = entry.cutoff < 0
      ? Math.min(buffer.duration, offset + Math.abs(entry.cutoff) / 1_000)
      : Math.max(offset, buffer.duration - entry.cutoff / 1_000);
    const sourceLength = end - offset;
    if (!(sourceLength >= 0.018)) return false;
    const fixedEnd = offset + entry.consonant / 1_000;
    const loopStart = Math.min(end - 0.014, Math.max(offset + 0.006, fixedEnd));
    const loopEnd = end - 0.004;
    const requiresExtension = noteDuration * ratio > sourceLength;
    const canLoop = loopEnd - loopStart >= 0.012;
    // Unlike an OpenUtau resampler, Web Audio cannot safely stretch a sample
    // with no vowel body. Report failure so the complete KAL note is used.
    if (requiresExtension && !canLoop) return false;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = requiresExtension && canLoop;
    if (source.loop) {
      source.loopStart = loopStart;
      source.loopEnd = loopEnd;
    }
    this.rateAutomation(source.playbackRate, ratio, at, noteDuration, {
      vibratoCents: options.vibratoCents,
      vibratoRate: options.vibratoRate,
      previousRatio,
      glideSeconds: options.glideSeconds,
    });
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.input);
    const overlap = clampVocalzoid(Math.abs(entry.overlap) / 1_000 / Math.max(0.001, ratio), 0.012, 0.09);
    setEnvelope(gain.gain, at, noteDuration, 0.82, overlap);
    this.trackSource(source, gain);
    try {
      if (source.loop) {
        source.start(at, offset);
        source.stop(at + noteDuration + 0.008);
      } else {
        source.start(at, offset, Math.min(sourceLength, noteDuration * ratio));
      }
      return true;
    } catch {
      source.onended = null;
      for (const active of this.active) {
        if (active.source === source) this.active.delete(active);
      }
      try { source.disconnect?.(); } catch {}
      try { gain.disconnect?.(); } catch {}
      return false;
    }
  }

  scheduleOpenUnit(key, buffer, at, duration, midi, options, previousMidi, sustain = false) {
    const clip = this.openBank?.clips?.[key];
    if (!clip || !buffer) return false;
    const ratio = 2 ** ((midi - this.openBank.rootMidi) / 12);
    const previousRatio = 2 ** (((previousMidi ?? midi) - this.openBank.rootMidi) / 12);
    const canLoop = sustain && clip.loopEnd - clip.loopStart >= 0.06;
    if (sustain && duration * ratio > clip.duration && !canLoop) return false;
    const audibleDuration = canLoop
      ? duration
      : Math.min(duration, clip.duration / Math.max(0.001, ratio));
    if (!(audibleDuration >= 0.025)) return false;
    const context = this.context;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = canLoop;
    if (canLoop) {
      source.loopStart = clip.offset + clip.loopStart;
      source.loopEnd = clip.offset + clip.loopEnd;
    }
    this.rateAutomation(source.playbackRate, ratio, at, audibleDuration, {
      vibratoCents: sustain ? options.vibratoCents : 0,
      vibratoRate: options.vibratoRate,
      previousRatio,
      glideSeconds: sustain ? options.glideSeconds : 0,
    });
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.input);
    setEnvelope(gain.gain, at, audibleDuration, sustain ? 0.78 : 0.88, 0.024);
    this.trackSource(source, gain);
    try {
      if (canLoop) {
        source.start(at, clip.offset);
        source.stop(at + audibleDuration + 0.006);
      } else {
        source.start(at, clip.offset, Math.min(clip.duration, audibleDuration * ratio));
      }
      return true;
    } catch {
      source.onended = null;
      for (const active of this.active) {
        if (active.source === source) this.active.delete(active);
      }
      try { source.disconnect?.(); } catch {}
      try { gain.disconnect?.(); } catch {}
      return false;
    }
  }

  scheduleOpenNote(note, buffer, baseTime, beatSeconds, options, previousMidi) {
    const recipe = vocalzoidOpenBankRecipe(note);
    if (!recipe) return false;
    const at = baseTime + note.start * beatSeconds;
    const duration = Math.max(0.14, note.duration * beatSeconds);
    const ratio = 2 ** ((note.midi - this.openBank.rootMidi) / 12);
    const releaseClip = recipe.release ? this.openBank.clips[recipe.release] : null;
    const releaseDuration = releaseClip
      ? Math.min(duration * 0.28, releaseClip.duration / Math.max(0.001, ratio))
      : 0;
    const onsetClip = recipe.onset ? this.openBank.clips[recipe.onset] : null;
    const onsetDuration = onsetClip
      ? Math.min(duration * 0.32, onsetClip.duration / Math.max(0.001, ratio))
      : 0;
    const onsetOverlap = Math.min(JOIN_OVERLAP_SECONDS, onsetDuration * 0.35);
    const onsetAt = at - Math.max(0, onsetDuration - onsetOverlap);
    const releaseAt = at + duration - releaseDuration;
    const onsetOk = !recipe.onset || this.scheduleOpenUnit(
      recipe.onset,
      buffer,
      onsetAt,
      onsetDuration,
      note.midi,
      options,
      previousMidi,
      false,
    );
    const sustainOk = this.scheduleOpenUnit(
      recipe.sustain,
      buffer,
      at,
      duration,
      note.midi,
      options,
      previousMidi,
      true,
    );
    const releaseOk = !recipe.release || this.scheduleOpenUnit(
      recipe.release,
      buffer,
      releaseAt,
      releaseDuration,
      note.midi,
      options,
      note.midi,
      false,
    );
    return onsetOk && sustainOk && releaseOk;
  }

  async play(notes, {
    bpm = 108,
    vibratoCents = 22,
    vibratoRate = 5.2,
    glideMs = 65,
  } = {}) {
    const generation = ++this.playGeneration;
    await this.enable();
    if (generation !== this.playGeneration) return null;
    this.stop({ fadeMs: 8, cancelPending: false });
    const sequence = [...(notes ?? [])].sort((left, right) => left.start - right.start);
    if (!sequence.length) return null;
    const beatSeconds = 60 / clampVocalzoid(bpm, 40, 220);
    const resolved = this.bank ? await this.prepareBankNotes(sequence) : [];
    let openBuffer = null;
    if (this.openBank) {
      try { openBuffer = await this.loadOpenBank(); } catch {}
    }
    if (generation !== this.playGeneration) return null;
    const maximumPreutter = this.bank
      ? Math.max(0, ...resolved.map(({ entry }, index) => {
        if (!entry) return 0;
        const rootMidi = sourceMidiFor(this.bank, entry);
        const ratio = 2 ** ((sequence[index].midi - rootMidi) / 12);
        return clampVocalzoid(
          entry.preutterance / 1_000 / Math.max(0.001, ratio),
          0,
          0.45,
        );
      }))
      : 0;
    const renderPlan = vocalzoidRenderPlan(sequence, bpm);
    const builtInPickup = Math.max(0, -Math.min(0, ...renderPlan.map(({ start }) => start)));
    let openPickup = 0;
    if (this.openBank) {
      const first = sequence[0];
      const recipe = vocalzoidOpenBankRecipe(first);
      const onset = recipe && this.openBank.clips[recipe.onset];
      if (onset) {
        const ratio = 2 ** ((first.midi - this.openBank.rootMidi) / 12);
        const wall = Math.min(first.duration * beatSeconds * 0.32, onset.duration / Math.max(0.001, ratio));
        openPickup = Math.max(0, wall - Math.min(JOIN_OVERLAP_SECONDS, wall * 0.35));
      }
    }
    const pickup = Math.min(0.45, Math.max(maximumPreutter, builtInPickup, openPickup));
    const baseTime = this.context.currentTime + 0.055 + pickup;
    const options = {
      vibratoCents: clampVocalzoid(vibratoCents, 0, 100),
      vibratoRate: clampVocalzoid(vibratoRate, 2, 9),
      glideSeconds: clampVocalzoid(glideMs, 0, 260) / 1_000,
    };
    const fallbackNoteIds = new Set();
    let previousMidi = sequence[0].midi;

    if (this.bank) {
      for (let index = 0; index < sequence.length; index += 1) {
        const note = sequence[index];
        const { entry, buffer } = resolved[index];
        if (!this.scheduleUtau(note, entry, buffer, baseTime, beatSeconds, options, previousMidi)) {
          fallbackNoteIds.add(note.id);
        }
        previousMidi = note.midi;
      }
    } else if (this.openBank) {
      for (const note of sequence) {
        if (!this.scheduleOpenNote(note, openBuffer, baseTime, beatSeconds, options, previousMidi)) {
          fallbackNoteIds.add(note.id);
        }
        previousMidi = note.midi;
      }
    }

    const previousMidiByNote = new Map();
    previousMidi = sequence[0].midi;
    for (const note of sequence) {
      previousMidiByNote.set(note.id, previousMidi);
      previousMidi = note.midi;
    }
    for (const event of renderPlan) {
      if ((this.bank || this.openBank) && !fallbackNoteIds.has(event.noteId)) continue;
      this.scheduleBuiltIn(event, baseTime, options, previousMidiByNote.get(event.noteId));
    }

    this.startedAt = baseTime;
    this.playbackDuration = vocalzoidSequenceBeats(sequence) * beatSeconds;
    const customNotes = this.bank ? sequence.length - fallbackNoteIds.size : 0;
    const openNotes = this.openBank ? sequence.length - fallbackNoteIds.size : 0;
    return Object.freeze({
      startedAt: baseTime,
      duration: this.playbackDuration,
      customNotes,
      openNotes,
      fallbackNotes: (this.bank || this.openBank) ? fallbackNoteIds.size : 0,
      sourceName: customNotes
        ? this.bank.name
        : openNotes ? this.openBank.name : this.style.name,
    });
  }

  stop({ fadeMs = 22, immediate = false, cancelPending = true } = {}) {
    if (cancelPending) this.playGeneration += 1;
    if (!this.context) return false;
    const at = this.context.currentTime;
    const end = at + Math.max(0.004, fadeMs / 1_000);
    for (const active of this.active) {
      if (immediate) {
        active.source.onended = null;
        try { active.source.stop?.(at); } catch {}
        try { active.source.disconnect?.(); } catch {}
        try { active.gain.disconnect?.(); } catch {}
        continue;
      }
      hold(active.gain.gain, at, SILENCE);
      active.gain.gain.linearRampToValueAtTime?.(0, end);
      try { active.source.stop?.(end); } catch {}
    }
    if (immediate) this.active.clear();
    this.startedAt = 0;
    this.playbackDuration = 0;
    return true;
  }

  spectrum(target) {
    if (!this.analyser || !(target instanceof Uint8Array)) return false;
    this.analyser.getByteFrequencyData(target);
    return true;
  }

  async disable() {
    this.buildGeneration += 1;
    this.enabled = false;
    this.stop({ immediate: true });
    if (this.context && this.context.state === "running") await this.context.suspend?.();
  }

  async close() {
    this.buildGeneration += 1;
    this.playGeneration += 1;
    this.enabled = false;
    this.stop({ immediate: true, cancelPending: false });
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    await this.context?.close?.();
    this.context = null;
    this.atlas = null;
    this.openBuffers.clear();
    this.active.clear();
  }
}
