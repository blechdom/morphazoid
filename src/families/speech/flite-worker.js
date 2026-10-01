import { renderFliteAtlas } from './flite-atlas.js';
import { SPELLING_DIPHONE_CLIPS } from '../../instruments/spelling-synthesizer/spelling-diphone-atlas.js';
let rendering = false;
self.onmessage = async ({ data }) => {
  if (rendering || data?.type !== 'render') return;
  rendering = true;
  try {
    const response = await fetch(new URL('../../../vendor/flite/flite.wasm', import.meta.url));
    if (!response.ok) throw new Error(`Flite download failed: ${response.status}`);
    const module = await WebAssembly.compile(await response.arrayBuffer());
    const atlas = renderFliteAtlas(module, { voice: data.voice, metadata: SPELLING_DIPHONE_CLIPS });
    self.postMessage({ type: 'ready', ...atlas }, [atlas.samples.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Flite could not start.' });
  }
};
