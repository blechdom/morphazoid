import { audioInputConstraints, audioInputDescription, configureAudioInputNode } from "../../audio-input-settings.js";

/** Owns browser input resources only. The Rust processor owns monitoring/gating. */
export class SynthesisInput {
  constructor({ isArmed, onChange = () => {}, runtime = globalThis }) {
    this.runtime = runtime;
    this.isArmed = isArmed;
    this.onChange = onChange;
    this.context = null;
    this.destination = null;
    this.analyser = null;
    this.node = null;
    this.stream = null;
    this.fileBuffer = null;
    this.fileName = "";
    this.loop = true;
    this.ended = false;
    this.kind = "none";
    this.pending = false;
    this.requestVersion = 0;
    this.disposed = false;
    this.label = "No external input";
  }

  attach(context, destination) {
    if (this.context === context && this.destination === destination) return;
    this.stop();
    this.analyser?.disconnect();
    const sameContext = this.context === context;
    this.context = context;
    this.destination = destination;
    // Native voice playback borrows this bus. Replacing a failed processor in
    // the same context must not orphan the voice graph or change its identity.
    if (!sameContext || !this.analyser) this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.connect(destination);
  }

  status() {
    return { kind: this.kind, pending: this.pending, label: this.label, hasFile: !!this.fileBuffer, loop: this.loop, ended: this.ended };
  }
  setLoop(value) {
    this.loop = !!value;
    if (this.kind === "file" && this.node) this.node.loop = this.loop;
    this.notify();
  }
  notify() { if (!this.disposed) this.onChange(this.status()); }

  stop({ keepFile = true } = {}) {
    this.requestVersion++;
    this.pending = false;
    this.ended = false;
    const node = this.node, stream = this.stream;
    this.node = null;
    this.stream = null;
    try { node?.stop?.(); } catch { /* A stream source has no stop method. */ }
    try { node?.disconnect(); } catch { /* Already disconnected. */ }
    for (const track of stream?.getTracks() ?? []) track.stop();
    this.kind = "none";
    this.label = "No external input";
    if (!keepFile) { this.fileBuffer = null; this.fileName = ""; }
    this.notify();
  }

  async startMicrophone() {
    if (!this.context || !this.isArmed() || this.disposed) throw new Error("Enable Audio before starting microphone / line input.");
    const mediaDevices = this.runtime.navigator?.mediaDevices;
    if (!mediaDevices?.getUserMedia) throw new Error("Microphone input is unavailable in this browser.");
    this.stop();
    const version = this.requestVersion;
    this.pending = true;
    this.label = "Requesting microphone / line input…";
    this.notify();
    let stream;
    try {
      stream = await mediaDevices.getUserMedia(audioInputConstraints(this.runtime));
      if (version !== this.requestVersion || this.disposed || !this.isArmed()) {
        stream.getTracks().forEach(track => track.stop());
        return false;
      }
      this.stream = stream;
      this.node = configureAudioInputNode(this.context.createMediaStreamSource(stream), this.runtime);
      this.node.connect(this.analyser);
      this.kind = "microphone";
      this.label = audioInputDescription(stream);
      for (const track of stream.getAudioTracks()) track.addEventListener?.("ended", () => {
        if (this.stream === stream) this.stop();
      }, { once: true });
      return true;
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (version !== this.requestVersion || this.disposed) return false;
      this.stop();
      throw error;
    } finally {
      if (version === this.requestVersion) this.pending = false;
      this.notify();
    }
  }

  setFile(decoded, name) {
    this.stop();
    const length = Math.min(decoded.length, Math.round(decoded.sampleRate * 120));
    const channels = Math.min(2, decoded.numberOfChannels);
    this.fileBuffer = this.context.createBuffer(channels, length, decoded.sampleRate);
    for (let channel = 0; channel < channels; channel++) this.fileBuffer.getChannelData(channel).set(decoded.getChannelData(channel).subarray(0, length));
    this.fileName = `${name} · ${(length / decoded.sampleRate).toFixed(1)} s${length < decoded.length ? " excerpt" : ""}`;
    this.startFile();
    return this.fileName;
  }

  startFile() {
    if (!this.fileBuffer || !this.context || !this.isArmed() || this.disposed) return false;
    this.stop();
    const source = this.context.createBufferSource();
    source.buffer = this.fileBuffer;
    source.loop = this.loop;
    source.onended = () => {
      if (this.node !== source) return;
      source.disconnect();
      this.node = null;
      this.kind = "none";
      this.ended = true;
      this.label = "Input finished";
      this.notify();
    };
    source.connect(this.analyser);
    source.start();
    this.node = source;
    this.kind = "file";
    this.label = this.fileName;
    this.notify();
    return true;
  }

  dispose() {
    this.stop({ keepFile: false });
    this.disposed = true;
    this.analyser?.disconnect();
    this.analyser = null;
    this.destination = null;
    this.context = null;
  }
}
