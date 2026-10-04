import { NativeVoiceAudio } from '../voicesaurus/native-audio.js';
import { isSingingEngine, singingNoteDescriptors } from '../voicesaurus/native-singing-model.js';

/** Worker-rendered voice PCM feeding the host's existing processor and master.
 * Never opens/resumes a device. The host's explicit Audio action owns consent.
 */
export class VoiceInputSource {
  constructor({ host, renderSampleBank, changed = () => {}, error = () => {}, ended = () => {}, activity = () => {}, player } = {}) {
    this.host = host; this.changed = changed; this.error = error; this.ended = ended; this.activity = activity;
    this.player = player ?? new NativeVoiceAudio({ renderSampleBank });
    this.player.onEnded = () => { this.preview = false; this.notify(); this.ended(); };
    this.player.onAuditionEnded = () => this.notify();
    // Voice calibration is retained; the existing Synthesaurus master owns level.
    this.player.setLevel(.82);
    this.serial = 0; this.key = null; this.pendingKey = null; this.pending = null;
    this.wantsPlay = false; this.preview = false; this.busy = false; this.timings = []; this.loop = true;
  }
  permitted() { const host = this.host(); return host.armed && host.context?.state === 'running' && host.input?.analyser; }
  status() { return { loading: this.busy, playing: this.player.playing, auditioning: this.player.auditioning,
    position: this.player.currentPosition(), duration: this.player.buffer?.duration ?? 0, engine: this.player.engine ?? null }; }
  notify() { this.activity(Boolean(this.player.playing || this.player.auditioning)); this.changed(this.status()); }
  invalidate() {
    this.serial++; this.player.cancelRender(); this.player.stopAudition(); this.pending = null; this.pendingKey = null; this.busy = false;
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
        if ((this.wantsPlay || this.preview) && (!this.player.playing || restart)) this.player.play({ restart });
        this.notify(); return true;
      } catch (error) { if (serial === this.serial && error.name !== 'AbortError') this.error(error); return false; }
    }
    this.invalidate();
    const serial = this.serial;
    this.busy = true; this.pendingKey = key; this.notify();
    this.restart = restart;
    this.pending = (async () => {
      try {
        const host = this.host();
        await this.player.enable({ context: host.context, destination: host.input.analyser });
        if (serial !== this.serial || !this.permitted()) return false;
        // NativeVoiceAudio keeps the preceding buffer sounding until new PCM is ready.
        const result = await this.player.render(request);
        if (serial !== this.serial || !this.permitted()) return false;
        this.key = key;
        this.timings = result.noteTimings ?? (isSingingEngine(request) ? singingNoteDescriptors(request).map(note => ({
          index: note.index, start: (result.scoreOffsetSeconds ?? 0) + note.startSeconds,
          end: (result.scoreOffsetSeconds ?? 0) + note.startSeconds + note.seconds,
        })) : []);
        if (this.wantsPlay || this.preview) this.player.play({ restart: this.restart });
        return true;
      } catch (error) {
        if (serial === this.serial && error.name !== 'AbortError') this.error(error);
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
    const result = this.player.play({ offset: seconds }); this.notify(); return result;
  }
  async destroy() { this.pause(); await this.player.close(); }
}
