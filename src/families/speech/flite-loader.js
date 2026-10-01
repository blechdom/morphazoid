import { loadSpeechAtlas } from './atlas-loader.js';
export function loadFliteAtlas(options = {}) {
  return loadSpeechAtlas({ ...options,
    workerUrl: new URL('./flite-worker.js', import.meta.url),
    request: { type: 'render', voice: options.voice ?? 'slt' },
  });
}
