import { measureLevel } from './performance-level-measure.js';

// One bounded PCM measurement per worker. The host terminates it on completion
// or cancellation; no device, AudioContext, transport or playback gain is owned.
self.onmessage = ({ data }) => {
  try {
    const stats = measureLevel(data.channels, data.sampleRate);
    self.postMessage({ type: 'level', stats });
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error.message || error) });
  }
};
