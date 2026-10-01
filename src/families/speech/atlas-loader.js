import { SPELLING_DIPHONE_CLIPS } from '../../instruments/spelling-synthesizer/spelling-diphone-atlas.js';

function validClips(clips, duration) {
  return clips && Object.keys(clips).length === Object.keys(SPELLING_DIPHONE_CLIPS).length
    && Object.keys(SPELLING_DIPHONE_CLIPS).every(key => {
      const clip = clips[key];
      return clip && ['offset', 'duration', 'gain', 'sustainStart', 'sustainEnd']
        .every(field => Number.isFinite(clip[field]))
        && clip.offset >= 0 && clip.duration > 0 && clip.duration <= 3
        && clip.offset + clip.duration <= duration + 1e-6
        && clip.gain > 0 && clip.gain <= 8
        && clip.sustainStart >= 0 && clip.sustainEnd >= clip.sustainStart
        && clip.sustainEnd <= clip.duration;
    });
}

/** Generate the voice only after explicit Audio enable; cancel with its owner. */
export function loadSpeechAtlas({ audio, runtime = globalThis, signal, workerUrl, request } = {}) {
  return new Promise((resolve, reject) => {
    const WorkerClass = runtime.Worker ?? globalThis.Worker;
    if (typeof WorkerClass !== 'function') { reject(new Error('Speech needs browser worker support.')); return; }
    const aborted = () => Object.assign(new Error('Speech loading was cancelled.'), { name: 'AbortError' });
    if (signal?.aborted) { reject(aborted()); return; }
    const worker = new WorkerClass(workerUrl, { type: 'module' });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      worker.onmessage = worker.onerror = null;
      worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const cancel = () => finish(aborted());
    const timeout = setTimeout(() => finish(new Error('Speech voice loading timed out.')), 30000);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onerror = event => finish(new Error(event.message || 'Speech voice worker failed.'));
    worker.onmessage = ({ data }) => {
      if (settled) return;
      if (!data || typeof data !== 'object') { finish(new Error('Invalid speech worker message.')); return; }
      if (data.type === 'error') { finish(new Error(data.message)); return; }
      if (data.type !== 'ready') return;
      try {
        if (!(data.samples instanceof Float32Array) || data.samples.length > data.sampleRate * 90
          || !data.samples.length || !(data.sampleRate >= 8000 && data.sampleRate <= 96000)
          || !data.samples.every(value => Number.isFinite(value) && Math.abs(value) <= 1)
          || !validClips(data.clips, data.samples.length / data.sampleRate)) throw new Error('Invalid speech voice output.');
        const buffer = audio.createBuffer(1, data.samples.length, data.sampleRate);
        buffer.getChannelData(0).set(data.samples);
        finish(null, { buffer, clips: data.clips });
      } catch (error) { finish(error); }
    };
    try { worker.postMessage(request); }
    catch (error) { finish(error); }
  });
}
