import { loadSpeechAtlas } from '../../families/speech/atlas-loader.js';
export function loadEspeakAtlas(options = {}) {
  return loadSpeechAtlas({ ...options,
    workerUrl: new URL('./spelling-espeak-worker.js', import.meta.url),
    request: { type: 'render', voiceName: options.voiceName ?? 'en-us' },
  });
}
