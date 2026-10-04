import { SynthesisInput } from "./input.js";
import { loadProcessingDemo } from "./demo-sources.js";
import { connectAudioOutput } from "../../audio-output-manager.js";

const WASM_URL = new URL("../../../assets/wasm/synthesis.wasm", import.meta.url);
const PROCESSOR_URL = new URL("./processor.js", import.meta.url);
let compiledModule;

async function getModule() {
  if (!compiledModule) {
    compiledModule = fetch(WASM_URL).then(async (response) => {
      if (!response.ok) throw new Error(`Synthesis engine could not load (${response.status}).`);
      return WebAssembly.compile(await response.arrayBuffer());
    }).catch((error) => { compiledModule = null; throw error; });
  }
  return compiledModule;
}

/** Browser lifecycle only. All sample generation belongs to the shared Rust core. */
export class SynthesisAudio {
  constructor(onError = () => {}, onInputChange = () => {}, onSequenceStatus = () => {}) {
    this.context = null;
    this.node = null;
    this.master = null;
    this.analyser = null;
    this.armed = false;
    this.armRequested = false;
    this.starting = null;
    this.nodeReady = null;
    this.pendingAudition = false;
    this.finishReady = null;
    this.startVersion = 0;
    this.disposed = false;
    this.state = null;
    this.playing = false;
    this.rate = 2;
    this.gate = 0.65;
    this.sequence = null;
    this.sequencePlaying = false;
    this.sequenceTempo = 120;
    this.sequenceRootFrequency = 220;
    this.sequencePhase = 0;
    this.sequenceEpoch = null;
    this.sequenceOriginBeat = 0;
    this.sequenceIntent = 0;
    this.sequenceAppliedIntent = 0;
    this.sequenceSynchronized = false;
    this.sequenceStatus = Object.freeze({
      loaded: false, playing: false, studyId: null, stepIndex: null,
      phaseBeats: 0, lengthBeats: 0, tempo: 120,
    });
    this.onSequenceStatus = typeof onSequenceStatus === "function" ? onSequenceStatus : () => {};
    this.onError = onError;
    this.source = null;
    this.input = new SynthesisInput({ isArmed: () => this.context?.state === "running" && !this.disposed, onChange: onInputChange });
    this.captureRequest = null;
    this.captureId = 0;
    this.fileVersion = 0;
    this.demoRequest = null;
    this.demoId = null;
    this.processingFile = null;
  }

  start({ arm = true } = {}) {
    if (this.disposed) return Promise.reject(new Error("This audio session has closed."));
    if (arm) this.armRequested = true;
    // Resume synchronously within the explicit Audio click, including on iOS.
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return Promise.reject(new Error("Web Audio is unavailable in this browser."));
    if (!this.context) this.context = new AudioContextClass({ latencyHint: "interactive" });
    else if (this.context.state !== "running") {
      // performance.now() advances while a suspended worklet clock does not.
      // Force a full score/phase rebase after resume.
      this.sequenceSynchronized = false;
    }
    const resumed = this.context.resume();
    if (this.starting) return this.starting;
    const version = ++this.startVersion;
    this.starting = (async () => {
      await resumed;
      if (!this.node) {
        const [module] = await Promise.all([getModule(), this.context.audioWorklet.addModule(PROCESSOR_URL)]);
        if (this.disposed) return;
        this.master = this.context.createGain();
        this.master.gain.value = 0;
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 4096;
        this.analyser.minDecibels = -100;
        this.analyser.maxDecibels = 0;
        this.analyser.smoothingTimeConstant = 0.55;
        this.node = new AudioWorkletNode(this.context, "roads-synthesis", {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "max",
          processorOptions: { module, outputArmed: false },
        });
        this.sequenceSynchronized = false;
        // Node construction returns before the audio thread has initialized its
        // engines. Keep Audio in "starting" until that work has completed, so a
        // first audition is not consumed while the audio clock catches up.
        this.nodeReady = new Promise((resolve, reject) => {
          const timer = setTimeout(() => this.finishReady?.(new Error("The audio engine took too long to start. Reload the page and try again.")), 10000);
          this.finishReady = error => {
            clearTimeout(timer);
            this.finishReady = null;
            if (error) reject(error); else resolve();
          };
        });
        // Install a rejection handler immediately; graph setup can throw before
        // the initialization promise reaches the await below.
        this.nodeReady.catch(() => {});
        this.node.onprocessorerror = () => {
          const error = new Error("The audio engine stopped. Turn Audio off and reload the page.");
          this.finishReady?.(error);
          this.onError(error);
        };
        this.node.port.onmessage = ({ data }) => {
          if (data.type === "ready") this.finishReady?.();
          if (data.type === "error") {
            const error = new Error(data.message);
            this.finishReady?.(error);
            this.onError(error);
          }
          if (data.type === "captured" && data.id === this.captureRequest?.id) {
            const request = this.captureRequest;
            this.captureRequest = null;
            clearTimeout(request.timer);
            this.input.stop();
            this.source = { samples: data.samples, sampleRate: data.sampleRate };
            this.sendSource();
            request.resolve(`Microphone capture · ${(data.samples.length / data.sampleRate).toFixed(1)} s`);
          }
          if (data.type === "sequence-status") {
            this.receiveSequenceStatus(data);
          }
        };
        this.input.attach(this.context, this.node);
        this.node.connect(this.master);
        this.master.connect(this.analyser);
        this.releaseOutput = connectAudioOutput(this.context, this.master);
        if (this.state) this.configure(this.state);
        if (this.source) this.sendSource();
      }
      await this.nodeReady;
      if (this.disposed || version !== this.startVersion) throw new Error("Audio startup was cancelled.");
      this.armed = this.armRequested;
      this.node.port.postMessage({ type: "output-armed", armed: this.armed });
      this.setLevel(this.state?.outputLevel ?? 0.7);
      this.setPlaying(this.playing, this.rate, this.gate);
      if (!this.sequenceSynchronized) this.syncSequence();
      if (this.pendingAudition) {
        this.pendingAudition = false;
        this.configure(this.state, { audition: true });
      }
    })().finally(() => { this.starting = null; });
    return this.starting;
  }

  configure(state, { audition = false } = {}) {
    this.state = structuredClone(state);
    if (audition && this.starting && !this.armed) this.pendingAudition = true;
    this.node?.port.postMessage({ type: "state", state: this.state, audition: audition && this.armed });
    this.setLevel(state.outputLevel);
  }

  receiveSequenceStatus(data) {
    const intent = Number.isSafeInteger(data.intent) && data.intent >= 0 ? data.intent : 0;
    this.sequenceAppliedIntent = Math.max(this.sequenceAppliedIntent, intent);
    // A status already in flight belongs to older desired state. It must not
    // flicker the readout or rewrite the clock used to author the next command.
    if (intent !== this.sequenceIntent) return;
    this.sequenceStatus = Object.freeze({ ...data });
    if (Number.isFinite(data.originBeat)) this.sequenceOriginBeat = data.originBeat;
    if (Number.isFinite(data.beat)) {
      const tempo = this.normalizeSequenceTempo(data.tempo);
      const boundaryDelta = Number.isFinite(data.at) && this.context
        ? data.at - this.context.currentTime
        : 0;
      this.sequenceTempo = tempo;
      this.sequencePhase = data.beat;
      this.sequenceEpoch = this.sequenceNow() + boundaryDelta;
      this.sequencePlaying = data.playing === true;
    }
    if (Number.isFinite(data.rootFrequency)) this.sequenceRootFrequency = this.normalizeSequenceRoot(data.rootFrequency);
    this.onSequenceStatus(this.sequenceStatus);
  }

  setLevel(level) {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(this.armed ? Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0.7)) : 0, this.context.currentTime, 0.012);
  }

  mute() {
    this.startVersion++;
    this.armRequested = false;
    this.pendingAudition = false;
    this.armed = false;
    this.stopInput();
    this.node?.port.postMessage({ type: "output-armed", armed: false });
    this.setLevel(0);
    // Keep either transport clock running behind the muted master. Re-enabling
    // Audio then rejoins the current phase instead of restarting step zero.
    if (!this.playing && !this.sequencePlaying) this.node?.port.postMessage({ type: "silence" });
  }

  setPlaying(playing, rate = this.rate, gate = this.gate) {
    this.playing = !!playing;
    this.rate = rate;
    this.gate = gate;
    this.node?.port.postMessage({ type: "play", playing: this.playing, rate, gate });
  }

  sequenceNow() {
    return (globalThis.performance?.now?.() ?? Date.now()) / 1000;
  }

  currentSequenceBeat(now = this.sequenceNow()) {
    if (!this.sequencePlaying || !Number.isFinite(this.sequenceEpoch)) return this.sequencePhase;
    return this.sequencePhase + Math.max(0, now - this.sequenceEpoch) * this.sequenceTempo / 60;
  }

  normalizeSequenceTempo(value) {
    return Math.max(10, Math.min(1200, Number.isFinite(value) ? value : this.sequenceTempo));
  }

  normalizeSequenceRoot(value) {
    return Math.max(8, Math.min(20_000, Number.isFinite(value) ? value : this.sequenceRootFrequency));
  }

  sequenceMessageTiming() {
    const lead = this.sequenceLeadSeconds();
    const now = this.sequenceNow();
    return {
      at: (this.context?.currentTime ?? 0) + lead,
      phase: this.currentSequenceBeat(now) + (this.sequencePlaying ? lead * this.sequenceTempo / 60 : 0),
    };
  }

  sequenceLeadSeconds() {
    return this.context && this.context.state === "running" ? 0.005 : 0;
  }

  firstSequenceAttackBeat(sequence = this.sequence) {
    if (!sequence?.steps?.length) return 0;
    let first = Infinity;
    for (const step of sequence.steps) {
      if (!Array.isArray(step?.notes) || !step.notes.length) continue;
      const beat = Number(step.atBeats ?? step.at);
      if (Number.isFinite(beat)) first = Math.min(first, Math.max(0, beat));
    }
    return Number.isFinite(first) ? first : 0;
  }

  /** Load a bounded, beat-addressed cycle without coupling it to the ordinary Play/Repeat transport. */
  setSequence(sequence, { rootFrequency = this.sequenceRootFrequency, preservePhase = true } = {}) {
    const now = this.sequenceNow();
    const phase = preservePhase ? this.currentSequenceBeat(now) : 0;
    this.sequence = sequence == null ? null : structuredClone(sequence);
    if (!this.sequence) this.sequencePlaying = false;
    this.sequencePhase = phase;
    this.sequenceEpoch = now;
    if (!preservePhase) this.sequenceOriginBeat = 0;
    this.sequenceTempo = this.normalizeSequenceTempo(this.sequence?.tempo);
    this.sequenceRootFrequency = this.normalizeSequenceRoot(rootFrequency);
    const intent = ++this.sequenceIntent;
    const timing = this.sequenceMessageTiming();
    if (this.node) {
      this.node.port.postMessage({
        type: "sequence-load", sequence: this.sequence, tempo: this.sequenceTempo,
        rootFrequency: this.sequenceRootFrequency, originBeat: this.sequenceOriginBeat,
        intent,
        preservePhase, playing: this.sequencePlaying,
        ...timing,
      });
      this.sequenceSynchronized = true;
    } else this.sequenceSynchronized = false;
    return this.sequence;
  }

  /** Replace a running score at one audio-frame boundary without a stop/load/start gap. */
  swapSequence(sequence, {
    rootFrequency = this.sequenceRootFrequency,
    restart = false,
    state = null,
  } = {}) {
    const now = this.sequenceNow();
    const lead = this.sequenceLeadSeconds();
    const previousTempo = this.sequenceTempo;
    const previousBeat = this.currentSequenceBeat(now);
    const wasPlaying = this.sequencePlaying;
    const stopPlay = this.playing;
    const next = sequence == null ? null : structuredClone(sequence);
    const nextTempo = this.normalizeSequenceTempo(next?.tempo);
    const scheduledBeat = previousBeat + (wasPlaying ? lead * previousTempo / 60 : 0);
    const triggerCurrent = restart || !wasPlaying;
    const firstAttackBeat = this.firstSequenceAttackBeat(next);
    const originBeat = triggerCurrent ? scheduledBeat - firstAttackBeat : this.sequenceOriginBeat;

    this.sequence = next;
    this.sequencePlaying = !!next;
    this.sequenceTempo = nextTempo;
    this.sequenceRootFrequency = this.normalizeSequenceRoot(rootFrequency);
    this.sequencePhase = wasPlaying ? scheduledBeat - lead * nextTempo / 60 : scheduledBeat;
    this.sequenceEpoch = wasPlaying ? now : now + lead;
    this.sequenceOriginBeat = originBeat;
    this.playing = false;
    if (state && typeof state === "object") {
      this.state = structuredClone(state);
      this.setLevel(this.state.outputLevel);
    }
    const transactionState = this.state && typeof this.state === "object" ? structuredClone(this.state) : null;
    const intent = ++this.sequenceIntent;
    if (this.node) {
      this.node.port.postMessage({
        type: "sequence-swap",
        sequence: this.sequence,
        tempo: this.sequenceTempo,
        rootFrequency: this.sequenceRootFrequency,
        at: (this.context?.currentTime ?? 0) + lead,
        phase: scheduledBeat,
        originBeat,
        intent,
        playing: this.sequencePlaying,
        preservePhase: !triggerCurrent,
        preserveVoices: wasPlaying && !triggerCurrent,
        triggerCurrent,
        stopPlay,
        ...(transactionState ? { state: transactionState } : {}),
      });
      this.sequenceSynchronized = true;
    } else this.sequenceSynchronized = false;
    return this.sequence;
  }

  /** Start (or re-align) the sequence. Epoch is performance-clock seconds paired with phase in beats. */
  startSequence({ tempo = this.sequenceTempo, rootFrequency = this.sequenceRootFrequency, phase = null, epoch = null } = {}) {
    const now = this.sequenceNow();
    const lead = this.sequenceLeadSeconds();
    const at = (this.context?.currentTime ?? 0) + lead;
    const wasPlaying = this.sequencePlaying;
    const previousTempo = this.sequenceTempo;
    const nextTempo = this.normalizeSequenceTempo(tempo);
    const explicitPhase = Number.isFinite(phase);
    let beat;
    if (explicitPhase) {
      // Without an epoch the caller authors the exact beat at the scheduled
      // audio boundary. A paired epoch explicitly opts into clock advancement.
      beat = phase + (Number.isFinite(epoch) ? Math.max(0, now + lead - epoch) * nextTempo / 60 : 0);
    } else {
      beat = wasPlaying
        ? this.currentSequenceBeat(now) + lead * previousTempo / 60
        : this.sequencePhase;
    }
    this.sequenceTempo = nextTempo;
    this.sequenceRootFrequency = this.normalizeSequenceRoot(rootFrequency);
    this.sequencePhase = beat;
    this.sequenceEpoch = now + lead;
    this.sequencePlaying = true;
    const intent = ++this.sequenceIntent;
    const resuming = !explicitPhase && !wasPlaying;
    this.node?.port.postMessage({
      type: "sequence-start", tempo: this.sequenceTempo, rootFrequency: this.sequenceRootFrequency,
      intent, at,
      ...(resuming
        ? { resume: true }
        : { phase: beat, originBeat: this.sequenceOriginBeat }),
    });
  }

  setSequenceTempo(tempo) {
    if (!Number.isFinite(tempo)) return;
    const now = this.sequenceNow();
    const lead = this.sequenceLeadSeconds();
    const previousTempo = this.sequenceTempo;
    const boundaryBeat = this.currentSequenceBeat(now)
      + (this.sequencePlaying ? lead * previousTempo / 60 : 0);
    this.sequenceTempo = this.normalizeSequenceTempo(tempo);
    this.sequencePhase = boundaryBeat;
    this.sequenceEpoch = now + lead;
    const intent = ++this.sequenceIntent;
    this.node?.port.postMessage({
      type: "sequence-tempo", tempo: this.sequenceTempo, intent,
      at: (this.context?.currentTime ?? 0) + lead, phase: boundaryBeat,
    });
  }

  setSequenceRootFrequency(rootFrequency) {
    this.sequenceRootFrequency = this.normalizeSequenceRoot(rootFrequency);
    const intent = ++this.sequenceIntent;
    this.node?.port.postMessage({
      type: "sequence-root", rootFrequency: this.sequenceRootFrequency, intent,
    });
  }

  stopSequence() {
    const now = this.sequenceNow();
    this.sequencePhase = this.currentSequenceBeat(now);
    this.sequenceEpoch = now;
    this.sequencePlaying = false;
    const intent = ++this.sequenceIntent;
    this.node?.port.postMessage({ type: "sequence-stop", intent });
  }

  panicSequence() {
    const now = this.sequenceNow();
    this.sequencePhase = this.currentSequenceBeat(now);
    this.sequenceEpoch = now;
    this.sequencePlaying = false;
    const intent = ++this.sequenceIntent;
    this.node?.port.postMessage({ type: "sequence-panic", intent });
  }

  syncSequence() {
    if (!this.node || !this.armed) return;
    // A forced rebase supersedes every status or transaction from the frozen
    // worklet clock, even if those messages arrive after context.resume().
    const loadIntent = this.sequenceIntent + 1;
    const startIntent = loadIntent + (this.sequencePlaying ? 1 : 0);
    this.sequenceIntent = startIntent;
    const timing = this.sequenceMessageTiming();
    this.node.port.postMessage({
      type: "sequence-load", sequence: this.sequence, tempo: this.sequenceTempo,
      rootFrequency: this.sequenceRootFrequency, originBeat: this.sequenceOriginBeat,
      intent: loadIntent,
      preservePhase: true, rebaseClock: true, playing: false, ...timing,
    });
    if (this.sequencePlaying) this.node.port.postMessage({
      type: "sequence-start", tempo: this.sequenceTempo, rootFrequency: this.sequenceRootFrequency,
      originBeat: this.sequenceOriginBeat, intent: startIntent, ...timing,
    });
    this.sequenceSynchronized = true;
  }

  getSequenceStatus() { return { ...this.sequenceStatus }; }

  setSequenceStatusListener(listener = () => {}) {
    this.onSequenceStatus = typeof listener === "function" ? listener : () => {};
    this.onSequenceStatus(this.sequenceStatus);
  }

  noteOn(frequency, velocity = 0.75, duration = null, noteId = null, at = null) {
    if (!this.armed) return;
    this.node?.port.postMessage({ type: "note", frequency, velocity, duration, noteId, at: at ?? this.context.currentTime + 0.005 });
  }

  resumeNotes(notes) {
    if (!this.armed || !notes.length) return;
    this.node?.port.postMessage({ type: "held-notes", notes: notes.slice(-128), at: this.context.currentTime + .005 });
  }

  noteOff(noteId = null) { this.node?.port.postMessage({ type: "off", noteId, at: (this.context?.currentTime ?? 0) + 0.005 }); }

  panic() {
    const beat = this.currentSequenceBeat();
    this.playing = false;
    this.sequencePlaying = false;
    this.sequencePhase = beat;
    this.sequenceEpoch = this.sequenceNow();
    const intent = ++this.sequenceIntent;
    this.node?.port.postMessage({ type: "silence", intent });
  }

  reset() {
    const intent = ++this.sequenceIntent;
    this.node?.port.postMessage({ type: "reset", intent });
    this.configure(this.state);
    this.setPlaying(this.playing, this.rate, this.gate);
    if (!this.sequenceSynchronized) this.syncSequence();
  }

  async loadFile(file, { processing = false } = {}) {
    if (!this.context || this.context.state !== "running") throw new Error("Prepare input before loading a local recording.");
    if (file.size > 40 * 1024 * 1024) throw new Error("Choose an audio file smaller than 40 MB.");
    this.stopInput();
    const version = ++this.fileVersion;
    const decoded = await this.context.decodeAudioData(await file.arrayBuffer());
    if (this.disposed || version !== this.fileVersion) throw new Error("Audio import was cancelled.");
    if (processing) {
      this.demoId = null;
      const label = this.input.setFile(decoded, file.name);
      this.processingFile = { buffer: this.input.fileBuffer, label: file.name };
      return label;
    }
    const length = Math.min(decoded.length, 262144);
    const samples = new Float32Array(length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const channel = decoded.getChannelData(c);
      for (let i = 0; i < length; i++) samples[i] += channel[i] / decoded.numberOfChannels;
    }
    this.source = { samples, sampleRate: decoded.sampleRate };
    this.sendSource();
    return `${file.name} · ${(length / decoded.sampleRate).toFixed(1)} s${length < decoded.length ? " excerpt" : ""}`;
  }

  async loadDemo(id) {
    if (!this.context || !this.armed) throw new Error("Enable Audio before loading a sample.");
    this.stopInput();
    const version = this.fileVersion;
    const request = new AbortController();
    this.demoRequest = request;
    try {
      const demo = await loadProcessingDemo(this.context, id, { signal: request.signal });
      if (!this.armed || this.disposed || version !== this.fileVersion) return false;
      this.demoId = id;
      this.input.setFile(demo.buffer, demo.label);
      return true;
    } catch (error) {
      if (request.signal.aborted || version !== this.fileVersion) return false;
      throw error;
    } finally { if (this.demoRequest === request) this.demoRequest = null; }
  }

  startUserFile() {
    if (!this.processingFile || !this.armed) return false;
    this.stopInput();
    this.demoId = null;
    this.input.setFile(this.processingFile.buffer, this.processingFile.label);
    return true;
  }

  async captureSource() {
    this.stopInput();
    const id = ++this.captureId;
    if (!await this.input.startMicrophone() || id !== this.captureId) return null;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.stopInput(); }, 6000);
      this.captureRequest = { id, resolve, reject, timer };
      this.node.port.postMessage({ type: "capture", id });
    });
  }

  cancelCapture() {
    this.captureId++;
    this.node?.port.postMessage({ type: "cancel-capture" });
    if (this.captureRequest) {
      clearTimeout(this.captureRequest.timer);
      this.captureRequest.resolve(null);
      this.captureRequest = null;
    }
  }

  startMicrophone() { this.stopInput(); return this.input.startMicrophone(); }
  startFile() { this.stopInput(); return this.input.startFile(); }

  stopInput() { this.fileVersion++; this.demoRequest?.abort(); this.demoRequest = null; this.cancelCapture(); this.input.stop(); }

  sendSource() {
    const samples = this.source.samples.slice();
    this.node?.port.postMessage({ type: "source", samples, sampleRate: this.source.sampleRate }, [samples.buffer]);
  }

  restoreSource() {
    this.stopInput();
    this.source = null;
    this.node?.port.postMessage({ type: "restore-source" });
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.finishReady?.(new Error("This audio session has closed."));
    this.mute();
    this.node?.port.postMessage({ type: "dispose" });
    this.input.dispose();
    this.processingFile = null;
    this.demoId = null;
    this.node?.disconnect();
    this.master?.disconnect();
    this.analyser?.disconnect();
    this.releaseOutput?.();
    await this.context?.close().catch(() => {});
  }
}
