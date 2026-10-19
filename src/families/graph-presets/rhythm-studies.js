import { generateGraph } from '../../instruments/graph-delay/graph-delay.js';

// Authored launch/edge clocks, not random variations of a factory graph.
// Physical palettes use the sparse studies; dense graphs lose energy at forks
// and can exhaust their lower attack budgets. Audio/Play/output are not here.
export const GRAPH_RHYTHM_STUDIES = Object.freeze([
  ['pocket', 'chain', 8, 112, 2, 134, 1, 1, 0],
  ['ratchet', 'chain', 5, 210, .5, 28, 1, 1, 0],
  ['limp', 'chain', 5, 96, 2, 70, 4.2, 1.7, 0],
  ['orbit', 'ring', 7, 84, 4, 170, 1, 1, .58],
  ['answer', 'tree', 7, 72, 4, 200, 2.8, 1.2, 0],
  ['needle', 'chain', 6, 178, 1, 42, 1, 1, 0],
  ['tide', 'chain', 3, 44, 4, 420, 1.8, .7, 0],
  ['wire', 'chain', 4, 94, 2, 190, 1.5, 1, 0],
  ['pendulum', 'ring', 4, 62, 4, 270, 1, 1, .64],
  ['fork', 'dag', 6, 118, 2, 115, 2.6, .8, 0],
  ['rattle', 'chain', 5, 138, 1, 55, 2, 1.5, 0],
  ['tines', 'chain', 4, 78, 2, 220, 1.2, 1, 0],
  ['objects', 'chain', 3, 66, 2, 330, 1.6, 1.3, 0],
  ['stagger', 'tree', 7, 126, 2, 76, 5.5, 2.2, 0],
  ['spokes', 'hub', 5, 108, 2, 135, 1.8, .65, .26],
  ['descending', 'chain', 8, 104, 2, 110, 1, 1, 0],
  ['return', 'ring', 5, 90, 4, 180, 2.4, 1.6, .72],
  ['physical', 'chain', 4, 114, 2, 150, 1.3, 1, 0],
  ['sprint', 'chain', 9, 196, 2, 38, 1, 1, 0],
  ['breathing', 'ring', 6, 52, 4, 290, 2, .6, .48],
].map(([id, topology, nodeCount, tempo, pulseDivision, baseDelay, distanceRatio, timeCurve, feedback], index) => Object.freeze({
  id, topology, nodeCount, tempo, pulseDivision, baseDelay, distanceRatio, timeCurve, feedback,
  density: topology === 'dag' ? .55 : .12, seed: 101 + index * 17, nodePass: 1,
})));

export function graphRhythmParameters(study) {
  const { id, ...parameters } = study;
  return parameters;
}

export function graphStudyModel(parameters, padPath) {
  const graph = generateGraph({ ...parameters, type: parameters.topology, maxNodes: 32 });
  if (padPath) {
    if (padPath.length !== graph.nodes.length) throw new TypeError('Graph study path must cover every node');
    // Place each node inside its audible pad's cell; separate repeated pads so
    // every node remains individually draggable. With distanceRatio=1 this
    // changes timbre selection without changing the authored even edge clock.
    graph.nodes.forEach((node, i) => {
      const pad = padPath[i];
      const nudge = ((i % 3) - 1) * .055;
      node.x = (pad % 4 + .5) / 4 + nudge;
      node.y = (3 - Math.floor(pad / 4) + .5) / 4 + nudge;
    });
  }
  return graph;
}
