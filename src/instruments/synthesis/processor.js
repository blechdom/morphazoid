const MAX_SEQUENCE_STEPS = 64;
const MAX_SEQUENCE_NOTES = 512;
const MAX_SEQUENCE_NOTES_PER_STEP = 8;
const MIN_SEQUENCE_TEMPO = 10;
const MAX_SEQUENCE_TEMPO = 1200;

const finiteNumber = (value, fallback) => Number.isFinite(value) ? Number(value) : fallback;
const clampNumber = (value, minimum, maximum, fallback) => (
  Math.max(minimum, Math.min(maximum, finiteNumber(value, fallback)))
);
const positiveModulo = (value, length) => ((value % length) + length) % length;

/** Audio-clock scheduling and the Rust/WASM boundary. No JS oscillator fallback. */
class RoadsSynthesisProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.api = new WebAssembly.Instance(options.processorOptions.module, {}).exports;
    if (![1, 2].includes(this.api.synth_abi_version())) throw new Error("Unsupported synthesis engine version.");
    this.engine = this.api.synth_new(sampleRate);
    this.bank = this.api.poly_new(sampleRate);
    this.noteOwners = new Map();
    this.polyDeadlines = Array(8).fill(null);
    this.polyBuffer = null;
    this.polyOutput = null;
    this.polySequence = 0x80000000;
    this.polyPlayId = null;
    this.polyPulseUntil = 0;
    this.lastSample = 0;
    this.modeFade = 0;
    this.modeFadeFrom = 0;
    this.processor = this.api.proc_new(sampleRate);
    this.processingUntil = 0;
    this.capture = null;
    this.buffer = null;
    this.output = null;
    this.state = null;
    this.playing = false;
    this.rate = 2;
    this.gate = null;
    this.parameterCount = this.api.synth_param_count?.() ?? 8;
    this.events = [];
    this.releaseAt = Infinity;
    this.nextTrigger = Infinity;
    this.heldNote = null;
    this.pulseNote = null;
    this.sequence = null;
    this.sequencePlaying = false;
    this.sequenceTempo = 120;
    this.sequenceRootFrequency = 220;
    this.sequenceAnchorBeat = 0;
    this.sequenceAnchorFrame = currentFrame;
    this.sequenceNextStep = -1;
    this.sequenceNextBeat = Infinity;
    this.sequenceCycleBase = 0;
    this.sequenceMono = null;
    this.sequenceLastStepIndex = null;
    this.sequenceLastCursor = null;
    this.sequenceStatusFrame = 0;
    this.sequenceRevision = 0;
    this.sequenceNoteSequence = 0x40000000;
    this.dead = false;
    this.failed = false;
    this.port.onmessage = ({ data }) => {
      try { this.message(data); }
      catch (error) { this.fail(error); }
    };
    this.port.postMessage({ type: "ready" });
  }

  fail(error) {
    this.failed = true;
    this.port.postMessage({ type: "error", message: String(error.message || error) });
  }

  sanitizeSequence(source) {
    if (!source || typeof source !== "object" || !Array.isArray(source.steps)) return null;
    const lengthBeats = clampNumber(source.lengthBeats, 1 / 4, 1024, 4);
    const steps = [];
    let noteCount = 0;
    for (let ordinal = 0; ordinal < Math.min(MAX_SEQUENCE_STEPS, source.steps.length); ordinal++) {
      const rawStep = source.steps[ordinal];
      if (!rawStep || typeof rawStep !== "object") continue;
      const notes = [];
      const rawNotes = Array.isArray(rawStep.notes) ? rawStep.notes : [];
      for (let index = 0; index < Math.min(MAX_SEQUENCE_NOTES_PER_STEP, rawNotes.length); index++) {
        if (noteCount >= MAX_SEQUENCE_NOTES) break;
        const rawNote = rawNotes[index];
        if (!rawNote || typeof rawNote !== "object") continue;
        notes.push({
          semitone: clampNumber(rawNote.semitone, -96, 96, 0),
          ratio: clampNumber(rawNote.ratio, 1 / 256, 256,
            2 ** (clampNumber(rawNote.semitone, -96, 96, 0) / 12)),
          velocity: clampNumber(rawNote.velocity, 0, 1, .75),
          gate: clampNumber(rawNote.gate, .01, 4, 1),
          accent: rawNote.accent === true,
        });
        noteCount++;
      }
      const authoredIndex = finiteNumber(rawStep.index, ordinal);
      steps.push({
        index: Math.max(-1_000_000, Math.min(1_000_000, Math.trunc(authoredIndex))),
        ordinal,
        at: positiveModulo(finiteNumber(rawStep.atBeats ?? rawStep.at, ordinal), lengthBeats),
        duration: clampNumber(rawStep.durationBeats ?? rawStep.duration, 1 / 960, 64, 1),
        notes,
        tie: rawStep.tie === true,
        slide: rawStep.slide === true,
      });
    }
    steps.sort((a, b) => a.at - b.at || a.ordinal - b.ordinal);
    return {
      studyId: typeof source.studyId === "string" ? source.studyId.slice(0, 96) : null,
      seed: Math.trunc(clampNumber(source.seed, -0x7fffffff, 0x7fffffff, 0)),
      stepBeats: clampNumber(source.stepBeats, 1 / 960, 64, 1),
      lengthBeats,
      steps,
    };
  }

  sanitizeSequenceTempo(value) {
    return clampNumber(value, MIN_SEQUENCE_TEMPO, MAX_SEQUENCE_TEMPO, this.sequenceTempo);
  }

  sanitizeSequenceRoot(value) {
    return clampNumber(value, 8, 20_000, this.sequenceRootFrequency);
  }

  sequenceBeatAt(frame = currentFrame) {
    if (!this.sequencePlaying) return this.sequenceAnchorBeat;
    return this.sequenceAnchorBeat + (frame - this.sequenceAnchorFrame) * this.sequenceTempo / (60 * sampleRate);
  }

  sequenceFrameAt(beat) {
    if (!this.sequencePlaying || !Number.isFinite(beat)) return Infinity;
    return this.sequenceAnchorFrame + Math.round((beat - this.sequenceAnchorBeat) * 60 * sampleRate / this.sequenceTempo);
  }

  setSequenceAnchor(beat, frame) {
    this.sequenceAnchorBeat = finiteNumber(beat, 0);
    this.sequenceAnchorFrame = Math.max(currentFrame, Math.round(finiteNumber(frame, currentFrame)));
  }

  seekSequence(beat, includeCurrent = false) {
    const sequence = this.sequence;
    if (!this.sequencePlaying || !sequence?.steps.length) {
      this.sequenceNextStep = -1;
      this.sequenceNextBeat = Infinity;
      this.sequenceCycleBase = 0;
      return;
    }
    const phase = positiveModulo(beat, sequence.lengthBeats);
    const cycleBase = beat - phase;
    const epsilon = 1e-9;
    let cursor = sequence.steps.findIndex(step => (
      includeCurrent ? step.at >= phase - epsilon : step.at > phase + epsilon
    ));
    this.sequenceCycleBase = cycleBase;
    if (cursor < 0) {
      cursor = 0;
      this.sequenceCycleBase += sequence.lengthBeats;
    }
    this.sequenceNextStep = cursor;
    this.sequenceNextBeat = this.sequenceCycleBase + sequence.steps[cursor].at;
  }

  advanceSequenceStep() {
    if (!this.sequence?.steps.length || this.sequenceNextStep < 0) {
      this.sequenceNextStep = -1;
      this.sequenceNextBeat = Infinity;
      return;
    }
    this.sequenceNextStep++;
    if (this.sequenceNextStep >= this.sequence.steps.length) {
      this.sequenceNextStep = 0;
      this.sequenceCycleBase += this.sequence.lengthBeats;
    }
    this.sequenceNextBeat = this.sequenceCycleBase + this.sequence.steps[this.sequenceNextStep].at;
  }

  nextSequenceNoteId() {
    this.sequenceNoteSequence = this.sequenceNoteSequence >= 0x7ffffffe ? 0x40000000 : this.sequenceNoteSequence + 1;
    return this.sequenceNoteSequence;
  }

  sequenceFrequency(ratio) {
    return Math.max(8, Math.min(20_000, this.sequenceRootFrequency * ratio));
  }

  cancelSequenceVoices() {
    if (this.sequenceMono) {
      this.sequenceMono = null;
      this.resumeUnderlyingNote();
    }
    for (const note of [...this.polyDeadlines]) if (note?.kind === "sequence") this.polyOff(note.id);
  }

  haltSequence() {
    const beat = this.sequenceBeatAt(currentFrame);
    this.cancelSequenceVoices();
    this.sequencePlaying = false;
    this.sequenceAnchorBeat = beat;
    this.sequenceAnchorFrame = currentFrame;
    this.sequenceNextStep = -1;
    this.sequenceNextBeat = Infinity;
    this.sequenceLastStepIndex = null;
    this.sequenceLastCursor = null;
    this.reportSequenceStatus(currentFrame, true);
  }

  reportSequenceStatus(frame = currentFrame, force = false) {
    if (!force && frame < this.sequenceStatusFrame) return;
    const beat = this.sequenceBeatAt(frame);
    const length = this.sequence?.lengthBeats ?? 0;
    this.sequenceStatusFrame = frame + Math.round(sampleRate / 20);
    this.port.postMessage({
      type: "sequence-status",
      loaded: !!this.sequence,
      playing: this.sequencePlaying && !!this.sequence,
      studyId: this.sequence?.studyId ?? null,
      stepIndex: this.sequenceLastStepIndex,
      cursor: this.sequenceLastCursor,
      phaseBeats: length ? positiveModulo(beat, length) : 0,
      beat,
      lengthBeats: length,
      tempo: this.sequenceTempo,
      rootFrequency: this.sequenceRootFrequency,
      revision: this.sequenceRevision,
      at: frame / sampleRate,
    });
  }

  sequenceMessageFrame(data) {
    return Math.max(currentFrame, Math.round(finiteNumber(data.at, currentTime) * sampleRate));
  }

  loadSequence(data) {
    const frame = this.sequenceMessageFrame(data);
    const previousBeat = Number.isFinite(data.phase) ? data.phase : this.sequenceBeatAt(frame);
    const wasPlaying = this.sequencePlaying;
    this.cancelSequenceVoices();
    this.sequence = this.sanitizeSequence(data.sequence);
    this.sequenceTempo = this.sanitizeSequenceTempo(data.tempo ?? data.sequence?.tempo);
    this.sequenceRootFrequency = this.sanitizeSequenceRoot(data.rootFrequency);
    this.sequencePlaying = !!this.sequence && (data.playing === true || wasPlaying && data.playing !== false);
    this.setSequenceAnchor(data.preservePhase === false ? 0 : previousBeat, frame);
    this.sequenceRevision++;
    this.sequenceLastStepIndex = null;
    this.sequenceLastCursor = null;
    this.seekSequence(this.sequenceAnchorBeat, false);
    this.reportSequenceStatus(frame, true);
  }

  startSequence(data) {
    if (!this.sequence) { this.reportSequenceStatus(currentFrame, true); return; }
    const frame = this.sequenceMessageFrame(data);
    const beat = Number.isFinite(data.phase) ? data.phase : (this.sequencePlaying ? this.sequenceBeatAt(frame) : 0);
    this.cancelSequenceVoices();
    this.sequenceTempo = this.sanitizeSequenceTempo(data.tempo);
    this.sequenceRootFrequency = this.sanitizeSequenceRoot(data.rootFrequency);
    this.sequencePlaying = true;
    this.setSequenceAnchor(beat, frame);
    this.seekSequence(beat, true);
    this.reportSequenceStatus(frame, true);
  }

  setSequenceTempoMessage(data) {
    if (!this.sequence) return;
    const frame = this.sequenceMessageFrame(data);
    const beat = Number.isFinite(data.phase) ? data.phase : this.sequenceBeatAt(frame);
    this.sequenceTempo = this.sanitizeSequenceTempo(data.tempo);
    this.setSequenceAnchor(beat, frame);
    if (this.sequenceNextBeat <= beat + 1e-9) this.seekSequence(beat, false);
    this.reportSequenceStatus(frame, true);
  }

  setSequenceRootMessage(data) {
    this.sequenceRootFrequency = this.sanitizeSequenceRoot(data.rootFrequency);
    if (this.sequenceMono) {
      const frequency = this.sequenceFrequency(this.sequenceMono.ratio);
      this.sequenceMono.frequency = frequency;
      this.api.synth_set_frequency(this.engine, frequency);
    }
    for (let slot = 0; slot < this.polyDeadlines.length; slot++) {
      const note = this.polyDeadlines[slot];
      if (note?.kind !== "sequence" || !(note.ratio > 0)) continue;
      const frequency = this.sequenceFrequency(note.ratio);
      note.frequency = frequency;
      this.api.poly_set_note_frequency(this.bank, note.id, frequency);
    }
    this.reportSequenceStatus(currentFrame, true);
  }

  triggerSequenceStep(step, eventBeat, cursor) {
    this.sequenceLastStepIndex = step.index;
    this.sequenceLastCursor = cursor;
    if (!step.notes.length || this.state?.kind === "processor") return;
    if (this.state?.voiceMode === "poly") {
      for (const note of step.notes) {
        const manualVoices = this.polyDeadlines.filter(deadline => deadline && deadline.kind !== "sequence").length;
        const sequenceVoices = this.polyDeadlines.filter(deadline => deadline?.kind === "sequence").length;
        if (manualVoices >= 8 || sequenceVoices >= 8 - manualVoices) break;
        const duration = Math.min(64, step.duration * note.gate);
        const endBeat = eventBeat + duration;
        const id = this.nextSequenceNoteId();
        const slot = this.polyNote(id, this.sequenceFrequency(note.ratio),
          note.velocity, Infinity, "sequence", endBeat);
        if (this.polyDeadlines[slot]?.id === id) this.polyDeadlines[slot].ratio = note.ratio;
      }
      return;
    }
    // The monophonic lane never displaces a key, audition, or the existing
    // Play/Repeat transport. Its next authored attack resumes automatically.
    if (this.heldNote || this.pulseNote || this.playing) return;
    const note = step.notes[0];
    const duration = Math.min(64, step.duration * note.gate);
    const frequency = this.sequenceFrequency(note.ratio);
    this.sequenceMono = { endBeat: eventBeat + duration, ratio: note.ratio, frequency, velocity: note.velocity };
    this.api.synth_note_on(this.engine, frequency, note.velocity);
  }

  processSequenceAt(frame) {
    if (!this.sequencePlaying || !this.sequence || frame < this.sequenceAnchorFrame || this.state?.kind === "processor") return;
    if (!this.state) {
      this.seekSequence(this.sequenceBeatAt(frame), false);
      return;
    }
    if (this.sequenceMono && this.sequenceFrameAt(this.sequenceMono.endBeat) <= frame) {
      this.sequenceMono = null;
      this.resumeUnderlyingNote();
    }
    for (const note of [...this.polyDeadlines]) {
      if (note?.kind === "sequence" && this.sequenceFrameAt(note.endBeat) <= frame) this.polyOff(note.id);
    }
    let guard = 0;
    while (this.sequenceNextStep >= 0 && this.sequenceFrameAt(this.sequenceNextBeat) <= frame && guard++ < MAX_SEQUENCE_STEPS) {
      const cursor = this.sequenceNextStep;
      const step = this.sequence.steps[cursor];
      const eventBeat = this.sequenceNextBeat;
      this.triggerSequenceStep(step, eventBeat, cursor);
      this.advanceSequenceStep();
    }
    this.reportSequenceStatus(frame, false);
  }

  sequenceBoundaryFrame() {
    if (!this.sequencePlaying || !this.sequence || this.state?.kind === "processor") return Infinity;
    let boundary = this.sequenceFrameAt(this.sequenceNextBeat);
    if (this.sequenceMono) boundary = Math.min(boundary, this.sequenceFrameAt(this.sequenceMono.endBeat));
    for (const note of this.polyDeadlines) {
      if (note?.kind === "sequence") boundary = Math.min(boundary, this.sequenceFrameAt(note.endBeat));
    }
    return boundary;
  }

  message(data) {
    if (this.dead) return;
    if (data.type === "sequence-load") {
      this.loadSequence(data);
    } else if (data.type === "sequence-start") {
      this.startSequence(data);
    } else if (data.type === "sequence-tempo") {
      this.setSequenceTempoMessage(data);
    } else if (data.type === "sequence-root") {
      this.setSequenceRootMessage(data);
    } else if (data.type === "sequence-stop" || data.type === "sequence-panic") {
      this.haltSequence();
    } else if (data.type === "state") {
      const wasPoly = this.state?.voiceMode === "poly" && this.state?.kind !== "processor";
      const nextPoly = data.state.voiceMode === "poly" && data.state.kind !== "processor";
      const wasProcessor = this.state?.kind === "processor";
      const nextProcessor = data.state.kind === "processor";
      if (wasPoly !== nextPoly || nextProcessor || wasProcessor) {
        const sequenceBeat = this.sequenceBeatAt(currentFrame);
        this.cancelSequenceVoices();
        this.setSequenceAnchor(sequenceBeat, currentFrame);
        this.seekSequence(sequenceBeat, false);
      }
      if (nextProcessor || wasProcessor) {
        this.api.synth_note_off(this.engine);
        this.api.poly_reset(this.bank);
        this.polyDeadlines.fill(null);
        this.polyPlayId = null;
        this.noteOwners.clear();
        this.events.length = 0;
        this.heldNote = this.pulseNote = null;
        this.releaseAt = this.nextTrigger = Infinity;
        if (nextProcessor) { this.configureProcessing(data, wasProcessor); return; }
        this.api.proc_set_source(this.processor, 0, 220, 0);
        this.api.proc_reset(this.processor);
      }
      if (wasPoly !== nextPoly) {
        this.modeFadeFrom = this.lastSample;
        this.modeFade = Math.round(sampleRate * .005);
      }
      if (nextPoly) { this.configurePoly(data, wasPoly); return; }
      let previousPolyPulse = null;
      if (wasPoly) {
        previousPolyPulse = this.polyDeadlines.filter(note => note?.kind === "pulse" && note.end > currentFrame).sort((a, b) => b.id - a.id)[0];
        this.api.poly_reset(this.bank);
        this.polyDeadlines.fill(null);
        this.polyPlayId = null;
        this.api.synth_reset(this.engine);
        this.heldNote = Array.from(this.noteOwners.values()).at(-1) || null;
        this.pulseNote = null;
        this.releaseAt = this.nextTrigger = Infinity;
      }
      const previousStyle = this.state?.playStyle;
      const previousMethod = this.state?.engineId;
      this.state = data.state;
      const s = this.state, p = this.api, e = this.engine;
      // Audition is one transaction. Releasing the old gate prevents a method
      // change from implicitly exciting a struck model before the explicit note.
      const audition = data.audition === true;
      if (audition) p.synth_note_off(e);
      if (wasPoly || s.engineId !== previousMethod) p.synth_set_method(e, s.engineId);
      if (p.synth_params_ptr && p.synth_apply_params) {
        const transfer = new Float32Array(p.memory.buffer, p.synth_params_ptr(e), this.parameterCount);
        transfer.fill(0);
        transfer.set(s.params.slice(0, this.parameterCount));
        p.synth_apply_params(e);
      } else s.params.forEach((v, i) => p.synth_set_param(e, i, v));
      p.synth_set_frequency(e, this.pulseNote?.frequency ?? this.heldNote?.frequency ?? this.sequenceMono?.frequency ?? s.frequencyHz);
      p.synth_set_envelope(e, s.envelope.attack, s.envelope.decay, s.envelope.sustain, s.envelope.release);
      p.synth_set_level_trim_db?.(e, s.levelTrimDb ?? 0);
      if (audition) {
        this.events = this.events.filter(event => event.type !== "note" || event.duration === null);
        // An audition starts the chosen model from its own complete state.
        // The Rust core retains the preceding output only for its short fade.
        p.synth_prepare_audition?.(e);
        this.beginPulse(s.frequencyHz, data.velocity ?? 0.8, data.duration, currentFrame);
        if (s.playStyle !== "strike") this.nextTrigger = Infinity;
      } else if (wasPoly) {
        if (previousPolyPulse) this.beginPulse(previousPolyPulse.frequency, previousPolyPulse.velocity,
          (previousPolyPulse.end - currentFrame) / sampleRate, currentFrame);
        else if (this.heldNote) p.synth_note_on(e, this.heldNote.frequency, this.heldNote.velocity);
        if (this.playing) this.startPlay();
      } else if (this.playing && previousStyle !== s.playStyle) this.startPlay();
    } else if (data.type === "play") {
      if (this.state?.kind === "processor") {
        this.playing = !!data.playing;
        this.processingUntil = 0;
        this.updateProcessingGate();
        return;
      }
      if (this.state?.voiceMode === "poly") { this.playPoly(data); return; }
      const wasPlaying = this.playing;
      const previousRate = this.rate;
      this.rate = Math.max(1 / 6, Math.min(20, Number(data.rate) || 2));
      this.gate = Number.isFinite(data.gate) ? Math.max(.05, Math.min(.95, data.gate)) : this.gate;
      this.playing = !!data.playing;
      if (this.playing && !wasPlaying) this.startPlay();
      else if (this.playing && this.state?.playStyle === "strike" && Number.isFinite(this.nextTrigger)) {
        if (this.pulseNote) this.nextTrigger = Math.max(currentFrame, this.releaseAt) + Math.round(sampleRate / this.rate);
        else {
          const phaseRemaining = Math.max(0, Math.min(1, (this.nextTrigger - currentFrame) / (sampleRate / previousRate)));
          this.nextTrigger = currentFrame + Math.round(phaseRemaining * sampleRate / this.rate);
          if (!this.heldNote && Number.isFinite(this.releaseAt) && this.gate !== null) {
            // The current gate follows the same beat phase as the next attack.
            // A shorter gate can close now; an already released gate stays closed.
            const gateRemaining = Math.max(0, this.gate - (1 - phaseRemaining));
            this.releaseAt = currentFrame + Math.round(gateRemaining * sampleRate / this.rate);
          }
        }
      }
      else if (!this.playing) {
        this.nextTrigger = Infinity;
        if (!this.pulseNote) this.releaseAt = Infinity;
        if (wasPlaying && !this.heldNote && !this.pulseNote) this.api.synth_note_off(this.engine);
      }
    } else if (data.type === "note" || data.type === "off" || data.type === "held-notes") {
      if (this.state?.kind === "processor") {
        if (data.type === "note") {
          this.processingUntil = currentFrame + Math.round(sampleRate * 3);
          this.updateProcessingGate();
        }
        return;
      }
      if (data.type === "off" && this.events.length >= 64) {
        const pendingNote = this.events.findIndex(event => event.type === "note");
        if (pendingNote >= 0) this.events.splice(pendingNote, 1);
        else this.events.shift();
      }
      if (this.events.length < 64) {
        this.events.push({ ...data, frame: Math.max(currentFrame, Math.round((data.at || currentTime) * sampleRate)) });
        this.events.sort((a, b) => a.frame - b.frame);
      }
    } else if (data.type === "silence") {
      this.haltSequence();
      this.playing = false;
      this.processingUntil = 0;
      this.capture = null;
      this.api.poly_all_notes_off(this.bank);
      this.polyDeadlines.fill(null);
      this.polyPlayId = null;
      this.polyPulseUntil = 0;
      this.noteOwners.clear();
      this.api.proc_set_source(this.processor, 0, 220, 0);
      this.api.proc_reset(this.processor);
      this.heldNote = null;
      this.pulseNote = null;
      this.events.length = 0;
      this.releaseAt = Infinity;
      this.nextTrigger = Infinity;
      this.api.synth_note_off(this.engine);
    } else if (data.type === "reset") {
      const sequenceBeat = this.sequenceBeatAt(currentFrame);
      this.cancelSequenceVoices();
      this.api.synth_reset(this.engine);
      this.api.poly_reset(this.bank);
      this.polyPulseUntil = 0;
      this.polyDeadlines.fill(null);
      this.polyPlayId = null;
      this.noteOwners.clear();
      this.heldNote = this.pulseNote = null;
      this.releaseAt = this.nextTrigger = Infinity;
      this.api.proc_reset(this.processor);
      this.events.length = 0;
      if (this.playing) this.startPlay();
      if (this.sequencePlaying) {
        this.setSequenceAnchor(sequenceBeat, currentFrame);
        this.seekSequence(sequenceBeat, false);
      }
    } else if (data.type === "restore-source") {
      this.api.synth_restore_source(this.engine);
      this.api.poly_restore_source(this.bank);
    } else if (data.type === "source") {
      const length = Math.min(262144, data.samples.length);
      new Float32Array(this.api.memory.buffer, this.api.synth_sample_ptr(this.engine), length).set(data.samples.subarray(0, length));
      this.api.synth_load_sample(this.engine, length, data.sampleRate);
      new Float32Array(this.api.memory.buffer, this.api.poly_sample_ptr(this.bank), length).set(data.samples.subarray(0, length));
      this.api.poly_load_sample(this.bank, length, data.sampleRate);
    } else if (data.type === "capture") {
      this.capture = { samples: new Float32Array(Math.min(262144, Math.round(sampleRate * 2))), offset: 0, id: data.id };
    } else if (data.type === "cancel-capture") {
      this.capture = null;
    } else if (data.type === "dispose") {
      this.api.synth_free(this.engine);
      this.api.poly_free(this.bank);
      this.api.proc_free(this.processor);
      this.dead = true;
    }
  }

  restoreHeldNotes(notes) {
    this.noteOwners.clear();
    for (const note of notes.slice(-128)) {
      const id = note.noteId ?? 1;
      this.noteOwners.set(id, { id, frequency: note.frequency, velocity: note.velocity });
    }
    if (this.state?.voiceMode === "poly") {
      for (const note of Array.from(this.noteOwners.values()).slice(-8)) this.polyNote(note.id, note.frequency, note.velocity);
    } else {
      this.sequenceMono = null;
      this.heldNote = Array.from(this.noteOwners.values()).at(-1) || null;
      this.pulseNote = null;
      this.releaseAt = Infinity;
      if (this.heldNote) this.api.synth_note_on(this.engine, this.heldNote.frequency, this.heldNote.velocity);
    }
  }

  copyOutput(samples, channels, offset, count) {
    const fadeLength = Math.round(sampleRate * .005);
    for (let i = 0; i < count; i++) {
      let value = samples[i];
      if (this.modeFade > 0) {
        const mix = this.modeFade-- / fadeLength;
        value = value * (1 - mix) + this.modeFadeFrom * mix;
      }
      for (const channel of channels) channel[offset + i] = value;
      this.lastSample = value;
    }
  }

  configurePoly(data, continuing) {
    const previousMethod = this.state?.engineId, previousStyle = this.state?.playStyle;
    const s = data.state, p = this.api, e = this.bank;
    const fresh = !continuing || data.audition;
    const previousPulse = !continuing && this.pulseNote && this.releaseAt > currentFrame
      ? { ...this.pulseNote, duration: (this.releaseAt - currentFrame) / sampleRate } : null;
    if (fresh) {
      if (continuing && data.audition) {
        this.modeFadeFrom = this.lastSample;
        this.modeFade = Math.round(sampleRate * .005);
      }
      p.synth_note_off(this.engine);
      p.poly_reset(e);
      this.polyDeadlines.fill(null);
      this.polyPlayId = null;
      this.polyPulseUntil = 0;
      this.pulseNote = null;
      this.releaseAt = this.nextTrigger = Infinity;
      if (data.audition) this.events = this.events.filter(event => event.type !== "note" || event.duration === null);
    }
    this.state = s;
    if (!continuing || s.engineId !== previousMethod) p.poly_set_method(e, s.engineId);
    const params = new Float32Array(p.memory.buffer, p.poly_params_ptr(e), this.parameterCount);
    params.fill(0); params.set(s.params.slice(0, this.parameterCount));
    p.poly_apply_params(e);
    p.poly_set_envelope(e, s.envelope.attack, s.envelope.decay, s.envelope.sustain, s.envelope.release);
    p.poly_set_level_trim_db(e, s.levelTrimDb ?? 0);
    if (fresh) {
      for (const note of Array.from(this.noteOwners.values()).slice(-8)) this.polyNote(note.id, note.frequency, note.velocity);
      if (data.audition) this.polyPulse(s.frequencyHz, data.velocity ?? .8, data.duration, currentFrame, true);
      else {
        if (previousPulse) this.polyPulse(previousPulse.frequency, previousPulse.velocity, previousPulse.duration, currentFrame);
        if (this.playing) this.startPolyPlay(currentFrame);
      }
    } else if (this.playing && previousStyle !== s.playStyle) {
      this.stopPolyPlay();
      this.startPolyPlay(currentFrame);
    } else if (this.polyPlayId !== null && s.playStyle === "hold") {
      p.poly_set_note_frequency(e, this.polyPlayId, s.frequencyHz);
    }
  }

  nextPolyId() {
    this.polySequence = this.polySequence >= 0xfffffffe ? 0x80000000 : this.polySequence + 1;
    return this.polySequence;
  }

  polyNote(id, frequency, velocity, end = Infinity, kind = "held", endBeat = Infinity) {
    if (kind !== "sequence" && this.polyDeadlines.every(Boolean)) {
      const sequence = this.polyDeadlines.find(note => note?.kind === "sequence");
      if (sequence) this.polyOff(sequence.id);
    }
    const slot = this.api.poly_note_on(this.bank, id, frequency, velocity);
    if (this.polyDeadlines[slot]?.id === this.polyPlayId) this.polyPlayId = null;
    this.polyDeadlines[slot] = { id, end, endBeat, kind, frequency, velocity };
    return slot;
  }

  polyOff(id) {
    this.api.poly_note_off(this.bank, id);
    for (let slot = 0; slot < 8; slot++) if (this.polyDeadlines[slot]?.id === id) this.polyDeadlines[slot] = null;
    if (id === this.polyPlayId) this.polyPlayId = null;
  }

  stopPolyPlay() {
    for (const note of this.polyDeadlines) if (note?.kind === "play") this.polyOff(note.id);
    this.polyPlayId = null;
    this.nextTrigger = Infinity;
  }

  polyPulse(frequency, velocity, duration, frame, audition = false) {
    const env = this.state.envelope;
    const fallback = env.attack + env.decay + .18;
    const seconds = Math.min(24.2, Math.max(.02, Number.isFinite(duration) ? duration : fallback));
    const end = frame + Math.round(sampleRate * seconds), id = this.nextPolyId();
    const takeHold = audition && this.playing && this.state.playStyle === "hold";
    this.polyNote(id, frequency, velocity, takeHold ? Infinity : end, takeHold ? "play" : "pulse");
    if (takeHold) this.polyPlayId = id;
    this.polyPulseUntil = end;
    if (this.playing && this.state.playStyle === "strike") this.nextTrigger = end + Math.round(sampleRate / this.rate);
    else if (takeHold) this.nextTrigger = Infinity;
  }

  startPolyPlay(frame) {
    // A Hold drone gives priority to eight physically held keys, then resumes
    // as soon as a gate is released. It never steals a key just to recover.
    if (this.state.playStyle === "hold" && this.polyDeadlines.every(Boolean)) return;
    if (this.state.playStyle === "strike" && this.polyPulseUntil > frame) {
      this.nextTrigger = this.polyPulseUntil + Math.round(sampleRate / this.rate);
      return;
    }
    const id = this.nextPolyId();
    const strike = this.state.playStyle === "strike";
    this.polyNote(id, this.state.frequencyHz, .75, strike ? frame + this.durationFrames() : Infinity, "play");
    this.polyPlayId = id;
    this.nextTrigger = strike ? frame + Math.round(sampleRate / this.rate) : Infinity;
  }

  playPoly(data) {
    const previousRate = this.rate, wasPlaying = this.playing;
    this.rate = Math.max(1 / 6, Math.min(20, Number(data.rate) || 2));
    this.gate = Number.isFinite(data.gate) ? Math.max(.05, Math.min(.95, data.gate)) : this.gate;
    this.playing = !!data.playing;
    if (!this.playing) { if (wasPlaying) this.stopPolyPlay(); return; }
    if (!wasPlaying) { this.startPolyPlay(currentFrame); return; }
    if (this.state.playStyle !== "strike") return;
    if (this.polyPulseUntil > currentFrame) {
      this.nextTrigger = this.polyPulseUntil + Math.round(sampleRate / this.rate);
      return;
    }
    const remaining = Math.max(0, Math.min(1, (this.nextTrigger - currentFrame) / (sampleRate / previousRate)));
    this.nextTrigger = currentFrame + Math.round(remaining * sampleRate / this.rate);
    const note = this.polyDeadlines.find(note => note?.id === this.polyPlayId);
    if (note && this.gate !== null) note.end = currentFrame + Math.round(Math.max(0, this.gate - (1 - remaining)) * sampleRate / this.rate);
  }

  processPoly(channels) {
    let offset = 0;
    const length = channels[0].length;
    while (offset < length) {
      const frame = currentFrame + offset;
      while (this.events.length && this.events[0].frame <= frame) {
        const event = this.events.shift();
        if (event.type === "held-notes") this.restoreHeldNotes(event.notes);
        else if (event.type === "note") {
          if (event.duration === null) {
            const id = event.noteId ?? 1;
            this.noteOwners.delete(id);
            if (this.noteOwners.size >= 128) this.noteOwners.delete(this.noteOwners.keys().next().value);
            this.noteOwners.set(id, { id, frequency: event.frequency, velocity: event.velocity });
            this.polyNote(id, event.frequency, event.velocity);
          } else this.polyPulse(event.frequency, event.velocity, event.duration, frame);
        } else if (event.noteId == null) {
          for (const id of this.noteOwners.keys()) this.polyOff(id);
          this.noteOwners.clear();
        } else {
          this.noteOwners.delete(event.noteId);
          this.polyOff(event.noteId);
        }
      }
      for (const note of this.polyDeadlines) if (note && frame >= note.end) this.polyOff(note.id);
      if (this.playing && (frame >= this.nextTrigger || this.state.playStyle === "hold" && this.polyPlayId === null)) this.startPolyPlay(frame);
      this.processSequenceAt(frame);
      let deadline = Infinity;
      for (const note of this.polyDeadlines) if (note) deadline = Math.min(deadline, note.end);
      const boundary = Math.min(currentFrame + length, this.events[0]?.frame ?? Infinity, deadline,
        this.nextTrigger, this.sequenceBoundaryFrame());
      const count = Math.max(1, Math.min(128, boundary - frame));
      this.api.poly_process(this.bank, count);
      if (this.polyBuffer !== this.api.memory.buffer) {
        this.polyBuffer = this.api.memory.buffer;
        this.polyOutput = new Float32Array(this.polyBuffer, this.api.poly_output_ptr(this.bank), 128);
      }
      this.copyOutput(this.polyOutput, channels, offset, count);
      offset += count;
    }
  }

  configureProcessing(data, continuing) {
    const previousMethod = this.state?.processorId;
    this.state = data.state;
    const s = this.state, p = this.api, e = this.processor;
    if (!continuing || previousMethod !== s.processorId) {
      p.proc_set_method(e, s.processorId);
      if (!continuing) p.proc_reset(e);
      this.processingUntil = 0;
    }
    const params = new Float32Array(p.memory.buffer, p.proc_params_ptr(e), 16);
    params.fill(0); params.set(s.params.slice(0, 16));
    p.proc_apply_params(e);
    p.proc_set_mix(e, s.wet ?? 1, s.bypass ? 1 : 0, s.inputDb ?? 0, s.outputDb ?? 0);
    if (data.audition && !this.playing) this.processingUntil = currentFrame + Math.round(sampleRate * 3);
    this.updateProcessingGate();
  }

  updateProcessingGate(frame = currentFrame) {
    if (this.state?.kind !== "processor") return;
    this.api.proc_set_source(this.processor, this.state.source ?? 0, this.state.frequencyHz,
      this.playing || frame < this.processingUntil ? 1 : 0);
  }

  processInputCapture(inputs) {
    const capture = this.capture;
    if (!capture) return;
    const channels = inputs[0] || [];
    const n = Math.min(128, capture.samples.length - capture.offset);
    for (let i = 0; i < n; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      capture.samples[capture.offset++] = channels.length ? value / channels.length * 10 ** ((this.state?.inputDb ?? 0) / 20) : 0;
    }
    if (capture.offset === capture.samples.length) {
      this.port.postMessage({ type: "captured", id: capture.id, samples: capture.samples, sampleRate }, [capture.samples.buffer]);
      this.capture = null;
    }
  }

  processEffect(inputs, channels) {
    const p = this.api, e = this.processor, length = channels[0].length;
    for (let offset = 0; offset < length; offset += 128) {
      const count = Math.min(128, length - offset);
      this.updateProcessingGate(currentFrame + offset);
      for (let channel = 0; channel < 2; channel++) {
        const input = new Float32Array(p.memory.buffer, p.proc_input_ptr(e, channel), 128);
        input.fill(0);
        const source = inputs[0]?.[channel] || inputs[0]?.[0];
        if (source) input.set(source.subarray(offset, offset + count));
      }
      p.proc_process(e, count);
      for (let channel = 0; channel < channels.length; channel++) {
        const output = new Float32Array(p.memory.buffer, p.proc_output_ptr(e, Math.min(1, channel)), count);
        channels[channel].set(output, offset);
      }
    }
  }

  startPlay() {
    if (!this.state) return;
    if (this.state.kind === "processor") { this.updateProcessingGate(); return; }
    if (this.state.voiceMode === "poly") { this.startPolyPlay(currentFrame); return; }
    this.sequenceMono = null;
    this.nextTrigger = this.state.playStyle === "strike"
      ? (this.pulseNote ? Math.max(currentFrame, this.releaseAt) : currentFrame) + Math.round(sampleRate / this.rate)
      : Infinity;
    if (!this.heldNote && !this.pulseNote) {
      this.api.synth_note_on(this.engine, this.state.frequencyHz, 0.75);
      this.releaseAt = this.state.playStyle === "strike" ? currentFrame + this.durationFrames() : Infinity;
    }
  }

  resumeUnderlyingNote() {
    // The finite note still owns an open gate here. Returning its pitch must
    // not restart ADSR or strike the physical model a second time.
    if (this.heldNote) this.api.synth_set_frequency(this.engine, this.heldNote.frequency);
    else if (this.playing && this.state?.playStyle === "hold") this.api.synth_set_frequency(this.engine, this.state.frequencyHz);
    else this.api.synth_note_off(this.engine);
  }

  beginPulse(frequency, velocity, duration, frame) {
    const env = this.state?.envelope;
    const fallback = (env?.attack ?? 0.01) + (env?.decay ?? 0.2) + 0.18;
    const seconds = Math.min(24.2, Math.max(0.02, Number.isFinite(duration) ? duration : fallback));
    this.sequenceMono = null;
    this.pulseNote = { frequency, velocity };
    this.releaseAt = frame + Math.round(sampleRate * seconds);
    this.api.synth_note_on(this.engine, frequency, velocity);
    if (this.playing && this.state?.playStyle === "strike") {
      // Finish this manual audition before counting a fresh repeat interval.
      this.nextTrigger = this.releaseAt + Math.round(sampleRate / this.rate);
    }
  }

  durationFrames() {
    if (this.gate !== null) return Math.max(1, Math.round(sampleRate / this.rate * this.gate));
    const env = this.state?.envelope;
    return Math.round(sampleRate * Math.min(8, Math.max(0.05, (env?.attack ?? 0.01) + (env?.decay ?? 0.2) + 0.12)));
  }

  process(inputs, outputs) {
    if (this.dead) return false;
    const channels = outputs[0];
    if (this.failed || !channels?.length) return true;
    try {
      this.processInputCapture(inputs);
      if (this.state?.kind === "processor") { this.processEffect(inputs, channels); return true; }
      if (this.state?.voiceMode === "poly") { this.processPoly(channels); return true; }
      let offset = 0;
      const length = channels[0].length;
      while (offset < length) {
        const frame = currentFrame + offset;
        while (this.events.length && this.events[0].frame <= frame) {
          const event = this.events.shift();
          if (event.type === "held-notes") this.restoreHeldNotes(event.notes);
          else if (event.type === "note") {
            if (event.duration === null) {
              const id = event.noteId ?? 1;
              this.sequenceMono = null;
              this.heldNote = { id, frequency: event.frequency, velocity: event.velocity };
              this.noteOwners.delete(id);
              if (this.noteOwners.size >= 128) this.noteOwners.delete(this.noteOwners.keys().next().value);
              this.noteOwners.set(id, this.heldNote);
              this.pulseNote = null;
              this.releaseAt = Infinity;
              this.api.synth_note_on(this.engine, event.frequency, event.velocity);
            } else this.beginPulse(event.frequency, event.velocity, event.duration, frame);
          } else {
            const wasLast = event.noteId == null || this.heldNote?.id === event.noteId;
            if (event.noteId == null) this.noteOwners.clear();
            else this.noteOwners.delete(event.noteId);
            if (wasLast) {
              this.heldNote = Array.from(this.noteOwners.values()).at(-1) || null;
              if (!this.pulseNote) {
                this.releaseAt = Infinity;
                if (this.heldNote) this.api.synth_note_on(this.engine, this.heldNote.frequency, this.heldNote.velocity);
                else this.resumeUnderlyingNote();
              }
            }
          }
        }
        if (frame >= this.releaseAt) {
          this.pulseNote = null;
          this.releaseAt = Infinity;
          this.resumeUnderlyingNote();
        }
        if (this.playing && frame >= this.nextTrigger) {
          if (!this.heldNote && !this.pulseNote) {
            this.api.synth_note_on(this.engine, this.state.frequencyHz, 0.75);
            this.releaseAt = frame + this.durationFrames();
          }
          this.nextTrigger = frame + Math.round(sampleRate / this.rate);
        }
        this.processSequenceAt(frame);
        const boundary = Math.min(currentFrame + length, this.events[0]?.frame ?? Infinity, this.releaseAt,
          this.nextTrigger, this.sequenceBoundaryFrame());
        const count = Math.max(1, Math.min(128, boundary - frame));
        this.api.synth_process(this.engine, count);
        if (this.buffer !== this.api.memory.buffer) {
          this.buffer = this.api.memory.buffer;
          this.output = new Float32Array(this.buffer, this.api.synth_output_ptr(this.engine), 128);
        }
        this.copyOutput(this.output, channels, offset, count);
        offset += count;
      }
    } catch (error) { for (const channel of channels) channel.fill(0); this.fail(error); }
    return true;
  }
}

registerProcessor("roads-synthesis", RoadsSynthesisProcessor);
