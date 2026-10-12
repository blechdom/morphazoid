import { parseBlackMidiScore } from './midiphoria-black-score.js';

self.onmessage = ({ data }) => {
  try {
    const score = parseBlackMidiScore(data.buffer, data.options);
    const transfer = ['starts', 'ends', 'sortedEnds', 'pitches', 'velocities', 'channels'].map(key => score[key].buffer);
    transfer.push(...score.tracks.map(track => track.maxEnds.buffer));
    self.postMessage({ score }, transfer);
  } catch (error) { self.postMessage({ error: error?.message || 'Could not index this MIDI score.' }); }
};
