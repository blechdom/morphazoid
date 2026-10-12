import { BLACK_MIDI_LIMITS } from './midiphoria-black-score.js';

/** Worker parsing never detaches the caller's audio/MIDI buffer. Abort terminates
 * parsing immediately. Deliberately no large synchronous main-thread fallback. */
export function parseBlackMidi(buffer, { signal, limits } = {}) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > BLACK_MIDI_LIMITS.bytes) return Promise.reject(new Error('Falling notes accepts MIDI files up to 200 MB.'));
  if (signal?.aborted) return Promise.reject(new DOMException('MIDI indexing cancelled.', 'AbortError'));
  if (typeof Worker === 'undefined') return Promise.reject(new Error('Falling notes needs browser Web Workers. Audio playback is still available.'));
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(new URL('./midiphoria-black-worker.js', import.meta.url), { type: 'module' }); }
    catch (error) { reject(error); return; }
    const finish = (error, score) => { signal?.removeEventListener('abort', abort); worker.terminate(); if (error) reject(error); else resolve(score); };
    const abort = () => finish(new DOMException('MIDI indexing cancelled.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.score);
    worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || 'MIDI indexing worker failed.')); };
    // Copy once into the worker. The synth may still own/use the original.
    try { const copy = buffer.slice(0); worker.postMessage({ buffer: copy, options: { limits } }, [copy]); }
    catch (error) { finish(error); }
  });
}
