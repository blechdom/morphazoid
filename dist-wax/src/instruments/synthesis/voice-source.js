import { NativeVoiceAudio } from '../voicesaurus/native-audio.js';
import { isSingingEngine, singingNoteDescriptors } from '../voicesaurus/native-singing-model.js';
import { playbackBeatForOffset, playbackOffsetForBeat } from '../voicesaurus/playback-offset.js';
import { NATIVE_OUTPUT_TRIMS } from '../voicesaurus/output-calibration.js';
import { gainForLevel } from './performance-level-measure.js';

const LEVEL_WORKER_URL = new URL('./voice-level-worker.js', import.meta.url);
const levelAbort = () => Object.assign(new Error('Voice level preparation cancelled.'), { name: 'AbortError' });

const renderTimings = (request, result) => result.timingUnavailable ? [] : result.noteTimings ?? (isSingingEngine(request)
  ? singingNoteDescriptors(request).map(note => ({ index: note.index,
    start: (result.scoreOffsetSeconds ?? 0) + note.startSeconds,
    end: (result.scoreOffsetSeconds ?? 0) + note.startSeconds + note.seconds })) : []);

/** Worker-rendered voice PCM feeding the host's existing processor and master.
 * Never opens/resumes a device. The host's explicit Audio action owns consent.
 */
export class VoiceInputSource {
  constructor({ host, renderSampleBank, changed = () => {}, error = () => {}, ended = () => {}, activity = () => {}, player,
    levelWorkerFactory = () => new Worker(LEVEL_WORKER_URL, { type: 'module', name: 'synthesis-voice-level' }) } = {}) {
    this.host = host; this.changed = changed; this.error = error; this.ended = ended; this.activity = activity;
    this.player = player ?? new NativeVoiceAudio({ renderSampleBank });
    this.player.onEnded = () => { this.preview = false; this.notify(); this.ended(); };
    this.player.onAuditionEnded = () => this.notify();
    // Voice calibration is retained; the existing Synthesaurus master owns level.
    this.player.setLevel(.82);
    this.serial = 0; this.key = null; this.pendingKey = null; this.pending = null;
    this.wantsPlay = false; this.preview = false; this.busy = false; this.timings = []; this.loop = true;
    this.descriptors = []; this.timingsCurrent = false; this.timingWarning = null; this.renderError = null;
    this.matchNextRender = false;
    this.levelWorkerFactory = levelWorkerFactory;
    this.levelStats = new WeakMap(); this.levelJob = null; this.levelRevision = 0;
  }
  prepareLevelMatch(enabled) {
    this.levelRevision++;
    this.matchNextRender = enabled;
    if (!enabled) { this.levelJob?.cancel(); this.player.setLevel(.82); }
  }
  async prepareRenderedLevel(result, { signal } = {}) {
    if (!this.matchNextRender || !result.buffer?.getChannelData || this.levelStats.has(result.buffer)) return;
    const buffer = result.buffer;
    if (buffer.sampleRate < 8000 || buffer.sampleRate > 192000) return;
    const revision = this.levelRevision;
    try {
      const stats = await new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(levelAbort()); return; }
        let worker, timer, settled = false;
        const finish = (error, value) => {
          if (settled) return; settled = true;
          clearTimeout(timer); signal?.removeEventListener('abort', cancel);
          worker?.terminate();
          if (this.levelJob === job) this.levelJob = null;
          if (error) reject(error); else resolve(value);
        };
        const cancel = () => finish(levelAbort());
        const job = { cancel };
        this.levelJob?.cancel(); this.levelJob = job;
        try {
          worker = this.levelWorkerFactory();
          worker.onmessage = ({ data }) => data?.type === 'level' ? finish(null, data.stats)
            : finish(new Error(data?.message || 'Voice level measurement failed.'));
          worker.onerror = event => finish(new Error(event?.message || 'Voice level worker could not load.'));
          worker.onmessageerror = () => finish(new Error('Voice level response could not be read.'));
          signal?.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(() => finish(new Error('Voice level measurement timed out.')), 10000);
          // Structured clone preserves the AudioBuffer's samples; never transfer
          // or detach PCM that the current/native player owns.
          worker.postMessage({ channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)),
            sampleRate: buffer.sampleRate });
        } catch (error) { finish(error); }
      });
      if (revision === this.levelRevision && !signal?.aborted) this.levelStats.set(buffer, stats);
    } catch (error) {
      if (signal?.aborted) throw levelAbort();
      // A disabled/failed optional meter must not reject otherwise valid PCM.
      // Matching will fall back to the reference trim if no cached stats exist.
      if (error.name !== 'AbortError' && revision === this.levelRevision) this.error(error);
    }
  }
  matchRenderedLevel(result) {
    if (!this.matchNextRender || !result.buffer?.getChannelData) return;
    const stats = this.levelStats.get(result.buffer);
    if (!stats) {
      // Unusual rates or unavailable measurements retain the reference trim.
      this.player.setLevel(.82); this.matchNextRender = false; return;
    }
    const gain = gainForLevel(stats);
    // NativeVoiceAudio applies its engine reference trim after this gain.
    // Replace that reference with a phrase-specific static gain, once per
    // preset/dice recall. Subsequent amplitude edits remain audible.
    this.player.setLevel(.82 * gain / (NATIVE_OUTPUT_TRIMS[result.engine] ?? 1));
    this.matchNextRender = false;
  }
  permitted() { const host = this.host(); return host.armed && host.context?.state === 'running' && host.input?.analyser; }
  status() { return { loading: this.busy, playing: this.player.playing, auditioning: this.player.auditioning,
    position: this.player.currentPosition(), duration: this.player.buffer?.duration ?? 0, engine: this.player.engine ?? null,
    timingsCurrent: this.timingsCurrent, timingWarning: this.timingWarning, renderError: this.renderError }; }
  notify() { this.activity(Boolean(this.player.playing || this.player.auditioning)); this.changed(this.status()); }
  invalidate() {
    this.levelJob?.cancel();
    this.serial++; this.player.cancelRender(); this.player.stopAudition(); this.pending = null; this.pendingKey = null; this.busy = false;
    this.timingsCurrent = false;
    this.notify();
  }
  pause() { this.wantsPlay = false; this.preview = false; this.invalidate(); this.player.pause(); this.notify(); }
  deactivate() { this.pause(); void this.player.disable().catch(this.error); }
  async update(value, { playing = false, loop = true, restart = false, audition = false, force = false } = {}) {
    if (!this.permitted()) return false;
    this.wantsPlay = playing; this.loop = loop;
    this.preview = !playing && (audition || this.preview); this.player.setLoop(loop && !this.preview);
    const request = { ...structuredClone(value.scene), text: value.text };
    const key = JSON.stringify(request);
    if (!force && this.pendingKey === key && this.pending) { this.restart ||= restart; return this.pending; }
    if (!force && this.key === key && this.player.buffer) {
      this.invalidate();
      const serial = this.serial;
      const host = this.host();
      try {
        await this.player.enable({ context: host.context, destination: host.input.analyser });
        if (serial !== this.serial || !this.permitted()) return false;
        await this.prepareRenderedLevel({ buffer: this.player.buffer, engine: this.player.engine });
        if (serial !== this.serial || !this.permitted()) return false;
        this.timingsCurrent = true; this.renderError = null;
        this.matchRenderedLevel({ buffer: this.player.buffer, engine: this.player.engine });
        if ((this.wantsPlay || this.preview) && (!this.player.playing || restart)) this.player.play({ restart });
        this.notify(); return true;
      } catch (error) { if (serial === this.serial && error.name !== 'AbortError') this.error(error); return false; }
    }
    this.invalidate();
    const serial = this.serial;
    this.busy = true; this.renderError = null; this.pendingKey = key; this.notify();
    this.restart = restart;
    this.pending = (async () => {
      try {
        const host = this.host();
        await this.player.enable({ context: host.context, destination: host.input.analyser });
        if (serial !== this.serial || !this.permitted()) return false;
        // NativeVoiceAudio keeps the preceding buffer sounding until new PCM is ready.
        const result = await this.player.render(request, { prepareResult: (result, options) => this.prepareRenderedLevel(result, options),
          positionForResult: (result, position) => {
          if (this.player.engine !== request.engine || !isSingingEngine(request) || result.timingUnavailable) return null;
          const beat = playbackBeatForOffset(position, this.descriptors, this.timings);
          return beat === null ? null : playbackOffsetForBeat(beat, singingNoteDescriptors(request), { noteTimings: renderTimings(request, result) });
        } });
        if (serial !== this.serial || !this.permitted()) return false;
        this.key = key;
        this.matchRenderedLevel(result);
        this.timings = renderTimings(request, result);
        this.descriptors = isSingingEngine(request) ? singingNoteDescriptors(request) : [];
        this.timingsCurrent = true; this.timingWarning = result.timingWarning ?? null;
        if (this.wantsPlay || this.preview) this.player.play({ restart: this.restart });
        return true;
      } catch (error) {
        if (serial === this.serial && error.name !== 'AbortError') {
          this.renderError = this.player.buffer ? 'Settings rejected; keeping the last good voice.' : 'Settings rejected; try another preset.';
          this.error(error);
        }
        return false;
      } finally {
        if (serial === this.serial) { this.busy = false; this.pending = null; this.pendingKey = null; this.notify(); }
      }
    })();
    return this.pending;
  }
  async audition(request) {
    if (!this.permitted()) return false;
    this.invalidate(); const serial = this.serial;
    this.busy = true; this.notify();
    try {
      const host = this.host();
      await this.player.enable({ context: host.context, destination: host.input.analyser });
      if (serial !== this.serial || !this.permitted()) return false;
      const result = await this.player.render(request, { store: false });
      if (serial !== this.serial || !this.permitted()) return false;
      return this.player.audition(result);
    } catch (error) {
      if (serial === this.serial && error.name !== 'AbortError') this.error(error);
      return false;
    } finally { if (serial === this.serial) { this.busy = false; this.notify(); } }
  }
  seek(seconds) {
    if (!this.permitted() || !this.player.buffer) return false;
    this.invalidate(); this.wantsPlay = true; this.preview = false; this.player.setLoop(this.loop);
    const result = this.player.play({ offset: seconds }); this.timingsCurrent = true; this.notify(); return result;
  }
  seekBeat(beat) {
    if (!this.timingsCurrent || !this.timings.length) return false;
    return this.seek(playbackOffsetForBeat(beat, this.descriptors, { noteTimings: this.timings }));
  }
  async destroy() { this.pause(); await this.player.close(); }
}
