import createEspeak from '../../../vendor/espeak-ng/espeak-ng.js';
import { renderEspeakAtlas } from './spelling-espeak-atlas.js';

let rendering = false;
self.onmessage = async ({ data }) => {
  if (rendering || data?.type !== 'render') return;
  rendering = true;
  try {
    const module = await createEspeak();
    const voice = new module.eSpeakNGWorker();
    if (!['en-us', 'en-us+klatt'].includes(data.voiceName)) throw new Error('Unknown eSpeak voice.');
    const atlas = renderEspeakAtlas(voice, { voiceName: data.voiceName });
    self.postMessage({ type: 'ready', ...atlas }, [atlas.samples.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'eSpeak could not start.' });
  }
};
