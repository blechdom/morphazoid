import { findMotifs } from './motif-model.js';

self.onmessage = ({ data }) => {
  try {
    const result = findMotifs(data.reference, data.result, data.options);
    self.postMessage({ id: data.id, result });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
