import { createTraceBank } from './trace-model.js';

// Reader trajectories and bead crossings are built away from both the UI and
// the audio thread. The controller retains only its newest waiting request.
self.onmessage = ({ data }) => {
  try {
    const bank = createTraceBank(data.layers, data.options);
    bank.id = data.id;
    const buffers = new Set();
    const collect = value => {
      if (!value || typeof value !== 'object') return;
      if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
      else for (const child of Object.values(value)) collect(child);
    };
    collect(bank);
    self.postMessage({ id: data.id, bank }, [...buffers]);
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
