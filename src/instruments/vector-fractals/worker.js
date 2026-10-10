import { createBank } from './model.js';
self.onmessage = ({ data }) => {
  try {
    const bank = createBank(data.state);
    const transfer = bank.frames.flatMap(f => [f.sourceX.buffer, f.sourceY.buffer, f.spectrumRe.buffer, f.spectrumIm.buffer,
      ...f.tables.flatMap(t => [t.x.buffer, t.y.buffer])]);
    self.postMessage({ id: data.id, bank }, transfer);
  } catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
