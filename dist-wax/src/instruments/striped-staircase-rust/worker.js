import { buildStaircaseField } from './field.js';

// Analysis never runs in the rendering/audio callback. The owner discards stale
// revisions and terminates this worker when its instrument is disposed.
self.onmessage = ({ data }) => {
  if (data?.type !== 'analyze') return;
  const revision = data.revision;
  try {
    const result = buildStaircaseField(data);
    self.postMessage({ type: 'field', revision, ...result },
      [result.table.buffer, ...result.overlays.flatMap(overlay =>
        [overlay.points.buffer, ...overlay.branches.map(branch => branch.points.buffer)])]);
  } catch (error) {
    self.postMessage({ type: 'error', revision, error: String(error?.message || error) });
  }
};
