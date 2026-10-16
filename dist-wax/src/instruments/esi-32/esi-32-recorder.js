import { OutputRecorder, WAV_HEADER_BYTES } from '../../output-recorder.js';

export const ESI32_SAMPLE_RECORD_SECONDS = 60;
const BUSY_STATES = new Set(['starting', 'recording', 'stopping']);

/**
 * Records a caller-owned microphone/input-gain node as bounded 24-bit WAV.
 * The caller owns permissions, stream tracks and Audio. This tap never creates,
 * resumes, suspends or closes the context, and never monitors the input audibly.
 */
export class Esi32SampleRecorder {
  constructor({ runtime = globalThis, onChange = () => {}, onError = () => {} } = {}) {
    this.runtime = runtime;
    this.onChange = onChange;
    this.onError = onError;
    this._recorder = null;
    this._status = null;
    this._state = 'idle';
    this._blob = null;
    this._lastDuration = 0;
    this._lastChannels = 1;
    this._lastRate = 48000;
    this._generation = 0;
    this._stopPromise = null;
    this._disposePromise = null;
  }

  get state() { return this._state; }
  get blob() { return this._blob; }
  get elapsed() { return this._status?.seconds ?? 0; }
  get mimeType() { return 'audio/wav'; }
  get extension() { return 'wav'; }

  snapshot() {
    return Object.freeze({
      state: this.state, elapsed: this.elapsed, blob: this.blob,
      mimeType: this.mimeType, extension: this.extension,
      bytes: this._status?.bytes ?? 0,
      duration: this._lastDuration,
      channelCount: this._status?.channelCount ?? this._lastChannels,
      sampleRate: this._status?.sampleRate ?? this._lastRate,
      maxSeconds: ESI32_SAMPLE_RECORD_SECONDS,
      reason: this._status?.reason ?? '', error: this._status?.error ?? '',
    });
  }

  notify() { try { this.onChange(this.snapshot()); } catch {} }
  report(error) { try { this.onError(error instanceof Error ? error : new Error(String(error))); } catch {} }

  async start(context, source, channelCount = 1) {
    if (this._state === 'disposed' || BUSY_STATES.has(this._state)) return false;
    if (!context || context.state !== 'running'
      || !Number.isInteger(context.sampleRate) || context.sampleRate < 8000 || context.sampleRate > 192000
      || !source || typeof source.connect !== 'function' || typeof source.disconnect !== 'function'
      || (source.context && source.context !== context)) {
      this.report(new Error('Enable Audio and microphone input before recording a sample.'));
      return false;
    }
    if (![1, 2].includes(channelCount)) {
      this.report(new Error('Sample recording supports mono or stereo input.'));
      return false;
    }
    // The previous successful WAV remains available if this new attempt fails.
    const previous = this._recorder;
    if (previous) void previous.destroy();
    const generation = ++this._generation;
    let reportedError = '';
    const manager = {
      canRecord: () => context.state === 'running',
      recordingContext: () => context,
      recordingSampleRate: () => context.sampleRate,
      tapInto: (recordingContext, input) => {
        if (recordingContext !== context || context.state !== 'running') throw new Error('Audio input stopped before recording could start.');
        try { source.connect(input); }
        catch (error) { try { source.disconnect(input); } catch {} throw error; }
        let released = false;
        return () => {
          if (released) return;
          released = true;
          // Preserve the input meter and any other caller-owned connections.
          try { source.disconnect(input); } catch {}
        };
      },
    };
    const recorder = new OutputRecorder({
      manager, runtime: this.runtime, channelCount,
      // Sixty seconds is enforced on audio frames inside the shared worklet,
      // including when UI timers are delayed. No second recording engine.
      maxMemoryBytes: WAV_HEADER_BYTES + context.sampleRate * channelCount * 3 * ESI32_SAMPLE_RECORD_SECONDS,
      onchange: status => {
        if (generation !== this._generation || this._state === 'disposed') return;
        this._status = status;
        this._state = status.state;
        if (status.blob && status.frames > 0) {
          this._blob = status.blob;
          this._lastDuration = status.seconds;
          this._lastChannels = status.channelCount;
          this._lastRate = status.sampleRate;
        }
        if (status.error && status.error !== reportedError) {
          reportedError = status.error;
          this.report(new Error(status.error));
        }
        this.notify();
      },
    });
    this._recorder = recorder;
    this._stopPromise = null;
    try {
      await recorder.start({ filename: 'esi-32-microphone.wav' });
      return generation === this._generation && this._recorder === recorder && this._state === 'recording';
    } catch (error) {
      if (generation === this._generation && this._state !== 'disposed' && error.message !== reportedError) this.report(error);
      return false;
    }
  }

  stop(reason = 'stopped') {
    const recorder = this._recorder;
    if (!recorder || this._state === 'disposed') return Promise.resolve(null);
    if (this._stopPromise) return this._stopPromise;
    const pending = recorder.stop(reason).then(status => (
      this._state !== 'disposed' && this._recorder === recorder && status.frames > 0 ? status.blob : null
    )).finally(() => { if (this._stopPromise === pending) this._stopPromise = null; });
    this._stopPromise = pending;
    return pending;
  }

  dispose() {
    if (this._disposePromise) return this._disposePromise;
    this._generation += 1;
    const recorder = this._recorder;
    this._recorder = null;
    this._state = 'disposed';
    this._status = null;
    this._blob = null;
    this._lastDuration = 0;
    this.notify();
    this._disposePromise = recorder ? recorder.destroy() : Promise.resolve();
    return this._disposePromise;
  }
}
