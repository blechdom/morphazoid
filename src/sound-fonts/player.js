const modules = new WeakMap();
const processorURL = new URL('./player-processor.js', import.meta.url);
const abortError = () => new DOMException('SoundFont selection was superseded.', 'AbortError');

/** Reusable SF2/SF3 voice source. The instrument owns Audio, context and output. */
export class SoundFontPlayer {
  constructor(context, destination, { onError = () => {} } = {}) {
    this.context = context;
    this.destination = destination;
    this.onError = onError;
    this.current = null;
    this.pending = new Set();
    this.retiring = new Set();
    this.serial = 0;
    this.disposed = false;
    this.preset = { bank: 0, program: 0 };
  }

  async load(bytes) {
    if (this.disposed) throw abortError();
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 12 || bytes.byteLength > 128 * 1024 * 1024) throw new Error('Choose an SF2 or SF3 bank up to 128 MiB.');
    const serial = ++this.serial;
    for (const candidate of this.pending) candidate.reject?.(abortError());
    if (!modules.has(this.context)) {
      const promise = this.context.audioWorklet.addModule(processorURL.href);
      modules.set(this.context, promise);
      promise.catch(() => { if (modules.get(this.context) === promise) modules.delete(this.context); });
    }
    await modules.get(this.context);
    if (this.disposed || serial !== this.serial) throw abortError();
    const node = new AudioWorkletNode(this.context, 'morphazoid-sound-font-player', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    });
    const gain = this.context.createGain();
    gain.gain.value = 0;
    node.connect(gain); gain.connect(this.destination);
    const candidate = { node, gain, reject: null, timer: null };
    this.pending.add(candidate);
    try {
      await new Promise((resolve, reject) => {
        candidate.reject = reject;
        candidate.timer = setTimeout(() => reject(new Error('The SoundFont took too long to load.')), 60000);
        node.onprocessorerror = () => reject(new Error('The SoundFont audio processor could not start.'));
        node.port.onmessage = ({ data }) => {
          if (data.type === 'ready') resolve();
          if (data.type === 'error') reject(new Error(data.message));
        };
        const copy = bytes.slice(0);
        node.port.postMessage({ type: 'load', bytes: copy }, [copy]);
      });
      if (this.disposed || serial !== this.serial) throw abortError();
      const previous = this.current;
      this.current = candidate;
      candidate.node.port.onmessage = ({ data }) => { if (data.type === 'error') this.fail(candidate, new Error(data.message)); };
      candidate.node.onprocessorerror = () => this.fail(candidate, new Error('SoundFont playback stopped unexpectedly.'));
      this.setPreset(this.preset);
      gain.gain.setTargetAtTime(1, this.context.currentTime, 0.004);
      if (previous) {
        previous.node.port.onmessage = null;
        previous.node.onprocessorerror = null;
        previous.node.port.postMessage({ type: 'stop' });
        previous.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.004);
        this.retiring.add(previous);
        previous.timer = setTimeout(() => { this.release(previous); this.retiring.delete(previous); }, 30);
      }
    } catch (error) { this.release(candidate); throw error; }
    finally { clearTimeout(candidate.timer); this.pending.delete(candidate); }
  }

  setPreset(preset) {
    this.preset = { bank: preset?.bank ?? 0, program: preset?.program ?? 0 };
    this.current?.node.port.postMessage({ type: 'preset', ...this.preset });
  }
  noteOn(note, velocity = 0.75) {
    if (!this.current || this.disposed || !Number.isInteger(note) || note < 0 || note > 127) return null;
    if (!Number.isFinite(velocity) || velocity <= 0) { this.noteOff(note); return null; }
    this.current.gain.gain.setTargetAtTime(1, this.context.currentTime, 0.004);
    this.current.node.port.postMessage({ type: 'on', note, velocity: Math.round(Math.max(0, Math.min(1, velocity)) * 127) });
    return note;
  }
  noteOff(note) { this.current?.node.port.postMessage({ type: 'off', note }); }
  stopAll() {
    this.current?.node.port.postMessage({ type: 'stop' });
    if (this.current && this.context.state !== 'closed') this.current.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.004);
  }
  fail(source, error) {
    // A queued error can outlive a retired source. It must not stop a newer bank.
    if (this.disposed || this.current !== source) return;
    this.current = null;
    this.release(source);
    this.onError(error);
  }
  release(source) {
    if (source.released) return;
    source.released = true;
    clearTimeout(source.timer);
    source.node.onprocessorerror = null;
    source.node.port.onmessage = null;
    source.node.port.postMessage({ type: 'dispose' });
    source.node.port.close();
    source.node.disconnect(); source.gain.disconnect();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; ++this.serial;
    for (const candidate of this.pending) candidate.reject?.(abortError());
    for (const source of this.retiring) this.release(source);
    this.retiring.clear();
    if (this.current) this.release(this.current);
    this.current = null;
  }
}
