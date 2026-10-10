import { createBank } from './model.js';
import { createContourBank } from './contour-audio.js';
self.onmessage = ({ data }) => {
  try {
    const bank = data.kind === 'contour' ? createContourBank(data.state, data.path) : createBank(data.state);
    const transfer = bank.frames.flatMap(f => [f.sourceX.buffer, f.sourceY.buffer, f.spectrumRe.buffer, f.spectrumIm.buffer,
      ...f.tables.flatMap(t => [t.x.buffer, t.y.buffer])]);
    self.postMessage({ id: data.id, bank }, transfer);
  } catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
