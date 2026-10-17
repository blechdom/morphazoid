import { renderNativeText, nativeTextDefaults } from '../../families/speech/native-text.js';

// A fixed local voice identity. Performer level remains in Roach's output
// graph; the native renderer never follows presets or output-volume changes.
const values = { ...nativeTextDefaults('espeak'), variant: 'croak', rate: 190, pitch: 38, range: 28, volume: 100 };
let started = false;
self.onmessage = async ({ data }) => {
  if (started) return; started = true;
  try {
    const text = typeof data?.text === 'string' ? data.text.trim().slice(0, 180) : '';
    const { samples, sampleRate } = await renderNativeText('espeak', text, values);
    self.postMessage({ type: 'ready', samples, sampleRate }, [samples.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || String(error) });
  }
};
