import { createPreset, MODELS, DEFAULT_PARAMS, normalizeParams, randomizeParams } from './model.js';

const regime = (model, value) => {
  const [min, max] = MODELS.find(item => item.id === model).nativeRange;
  return (value - min) / (max - min);
};
export function captureScene(params) {
  const { playing, ...scene } = normalizeParams(params);
  return scene;
}
const preset = (id, label, model, parameter, patch = {}) => ({
  id, label, snapshot: captureScene(createPreset(model, { regime: regime(model, parameter), ...patch })),
});
const rhythm = (id, label, model, parameter, patch = {}) => preset(id, `Rhythm · ${label}`, model, parameter, {
  sonification: 'rhythm', headCount: 4, speed: 1, headRate: .35, panAxis: 'horizontal', panWidth: .75, ...patch,
});
export const PRESETS = Object.freeze([
  { id: 'butterfly', label: 'Lorenz · butterfly', snapshot: captureScene(DEFAULT_PARAMS) },
  preset('clear-butterfly', 'Lorenz · clear butterfly', 'lorenz', 28, { frequency: 164.8, clarity: .97, depth: .25, cutoff: 3400 }),
  preset('turbulence', 'Lorenz · turbulence', 'lorenz', 42, { frequency: 83, clarity: .06, depth: .9, speed: 1.8, cutoff: 9500 }),
  preset('still-air', 'Lorenz · still air', 'lorenz', 8, { frequency: 240, clarity: .92, depth: .6, speed: .45, cutoff: 2500 }),
  preset('emergence', 'Hopf · emergence', 'hopf', .04, { frequency: 196.5, clarity: .95, speed: .6, depth: .2, cutoff: 2800 }),
  preset('limit-circle', 'Hopf · limit circle', 'hopf', .8, { frequency: 128.4, clarity: .55, depth: .7, cutoff: 4800 }),
  preset('dissolving', 'Hopf · dissolving', 'hopf', -.3, { frequency: 310.7, clarity: .8, depth: .45, speed: .4, cutoff: 1200 }),
  preset('two-cycles', 'Doubling · two cycles', 'logistic', 3.2, { frequency: 120, clarity: .65, depth: .75, speed: .8, cutoff: 4300 }),
  preset('four-cycles', 'Doubling · four cycles', 'logistic', 3.5, { frequency: 175, clarity: .4, depth: .95, speed: 1.2, cutoff: 6200 }),
  preset('logistic-dust', 'Doubling · chaotic dust', 'logistic', 3.99, { frequency: 280, clarity: .03, depth: 1, speed: 1.5, cutoff: 13000 }),
  preset('period-three', 'Doubling · period-three window', 'logistic', 3.835, { frequency: 140, clarity: .65, depth: .8, speed: .6, cutoff: 3800 }),
  preset('fold-warm', 'Hysteresis · warm branch', 'fold', -.52, { frequency: 125.6, clarity: .8, depth: .8, speed: .5, cutoff: 2400 }),
  preset('fold-bright', 'Hysteresis · bright branch', 'fold', .52, { frequency: 125.6, clarity: .55, depth: .85, speed: 1.3, cutoff: 8200 }),
  preset('fold-edge', 'Hysteresis · tipping point', 'fold', -.38, { frequency: 187.2, clarity: .3, depth: .95, speed: .7, cutoff: 5200 }),
  preset('spiral', 'Rössler · spiral', 'rossler', 5.7, { frequency: 98.3, clarity: .45, depth: .65, speed: .7, cutoff: 4600 }),
  preset('clear-spiral', 'Rössler · clear spiral', 'rossler', 3, { frequency: 220.7, clarity: .95, depth: .2, speed: .4, cutoff: 2100 }),
  preset('spiral-storm', 'Rössler · spiral storm', 'rossler', 12, { frequency: 76.1, clarity: .08, depth: .95, speed: 2, cutoff: 11000 }),
  preset('shape-butterfly', 'Playheads · butterfly duet', 'lorenz', 28, { sonification: 'shape', frequency: 110, speed: .7, headRate: .45, pitchSpan: 2.5, headCount: 2, cutoff: 4800 }),
  preset('shape-horizon', 'Playheads · horizontal trio', 'lorenz', 42, { sonification: 'shape', pitchAxis: 'horizontal', frequency: 82, speed: .4, headRate: .8, pitchSpan: 3.1, headCount: 3, cutoff: 6200 }),
  preset('shape-spiral', 'Playheads · spiral distance', 'rossler', 5.7, { sonification: 'shape', pitchAxis: 'center', frequency: 130, speed: .65, headRate: .6, pitchSpan: 2.5, headCount: 1, cutoff: 4200 }),
  preset('shape-octet', 'Choir · butterfly octet', 'lorenz', 28, { sonification: 'shape', headCount: 8, frequency: 90, pitchSpan: 2.8, headRate: .45, headSpread: 1.5, speed: .75, panAxis: 'horizontal', panWidth: .8 }),
  preset('shape-sixteen', 'Choir · sixteen depths', 'lorenz', 42, { sonification: 'shape', headCount: 16, pitchAxis: 'depth', frequency: 65, pitchSpan: 3.4, headRate: .3, headSpread: 2, panAxis: 'horizontal', panWidth: .9 }),
  preset('shape-angle', 'Choir · around the spiral', 'rossler', 5.7, { sonification: 'shape', headCount: 6, pitchAxis: 'angle', frequency: 110, pitchSpan: 1.8, headRate: .25, speed: 1.2, panAxis: 'angle', panWidth: .85, amplitudeAxis: 'center', amplitudeDepth: .5 }),
  preset('shape-path', 'Choir · path glissandi', 'hopf', .8, { sonification: 'shape', headCount: 8, pitchAxis: 'path', frequency: 55, pitchSpan: 3.2, headRate: .15, speed: 1.8, headSpread: 2.2, panAxis: 'path', panWidth: .8 }),
  preset('shape-depth', 'Choir · depth quartet', 'lorenz', 28, { sonification: 'shape', headCount: 4, pitchAxis: 'depth', headRate: .5, speed: 1.2, panAxis: 'horizontal', panWidth: 1 }),
  preset('shape-bend', 'Choir · zigzag bends', 'logistic', 3.99, { sonification: 'shape', headCount: 12, pitchAxis: 'bend', frequency: 75, pitchSpan: 2.1, speed: .6, headRate: .3, travelAxis: 'path', travelSpan: 2, panAxis: 'horizontal', panWidth: .8 }),
  preset('shape-breath', 'Choir · breathing contour', 'lorenz', 42, { sonification: 'shape', headCount: 6, frequency: 120, pitchSpan: 1.2, speed: .8, headRate: .2, travelAxis: 'height', travelSpan: 2, amplitudeAxis: 'center', amplitudeDepth: .85, panAxis: 'depth', panWidth: .8 }),
  preset('shape-distance-choir', 'Choir · expanding spiral', 'rossler', 12, { sonification: 'shape', headCount: 16, pitchAxis: 'center', frequency: 80, pitchSpan: 2.5, speed: 1.5, headRate: .25, headSpread: 2, travelAxis: 'center', travelSpan: 2, amplitudeAxis: 'height', amplitudeDepth: .55, panAxis: 'horizontal', panWidth: .9 }),
  rhythm('rhythm-height', 'height clocks', 'lorenz', 28, { tempo: 96, tempoAxis: 'height', tempoSpan: 2, frequency: 110 }),
  rhythm('rhythm-radius', 'radius bells', 'lorenz', 28, { headCount: 8, pulseVoice: 'bell', tempo: 84, tempoAxis: 'center', tempoSpan: 3, pitchAxis: 'depth', frequency: 80, pitchSpan: 3, headRate: .4, headSpread: 1, speed: 1.2 }),
  rhythm('rhythm-depth', 'depth accelerations', 'lorenz', 42, { headCount: 6, tempo: 90, tempoAxis: 'depth', tempoSpan: 2.6, pitchAxis: 'horizontal', frequency: 100, pitchSpan: 2.2, headRate: .6, speed: .9, panAxis: 'depth', amplitudeAxis: 'height', amplitudeDepth: .3 }),
  rhythm('rhythm-angle', 'spiral ticks', 'rossler', 5.7, { headCount: 5, pulseVoice: 'tick', tempo: 120, tempoAxis: 'angle', tempoSpan: 2, pitchAxis: 'center', frequency: 150, pitchSpan: 1.2, headRate: .45, speed: 1.4, panAxis: 'angle', panWidth: .85 }),
  rhythm('rhythm-corners', 'corner clocks', 'logistic', 3.99, { headCount: 8, pulseVoice: 'tick', tempo: 72, tempoAxis: 'bend', tempoSpan: 3, frequency: 120, pitchSpan: 3, headRate: .2, speed: 1.2 }),
  rhythm('rhythm-path', 'path accelerando', 'hopf', 1.2, { headCount: 6, tempo: 80, tempoAxis: 'path', tempoSpan: 3, frequency: 110, pitchSpan: 1.6, headRate: .22, speed: 1.5, panAxis: 'path', panWidth: .9 }),
  rhythm('rhythm-breath', 'slow butterfly', 'lorenz', 28, { pulseVoice: 'bell', tempo: 48, tempoAxis: 'height', tempoSpan: 3, pulseDecay: .75, frequency: 80, pitchSpan: 2.8, headRate: .08, speed: .55, amplitudeAxis: 'center', amplitudeDepth: .7, panWidth: .5 }),
  rhythm('rhythm-chase', 'twelve chasing heads', 'lorenz', 42, { headCount: 12, tempo: 132, tempoAxis: 'horizontal', tempoSpan: 2, headSpread: 2, travelAxis: 'depth', travelSpan: 2, frequency: 80, pitchSpan: 2, headRate: .6, speed: 1.8, panWidth: .9 }),
  rhythm('rhythm-unison', 'eight staggered clocks', 'lorenz', 28, { headCount: 8, tempo: 96, pitchAxis: 'center', frequency: 100, pitchSpan: 2, headRate: .3, headSpread: 2 }),
  rhythm('rhythm-octaves', 'half / one / two / four', 'hopf', 1.2, { headCount: 8, pulseVoice: 'bell', tempo: 60, rhythmRatios: 'octaves', pitchAxis: 'path', frequency: 90, headRate: .2, headSpread: 1, speed: 1.4 }),
  rhythm('rhythm-234', 'two : three : four', 'lorenz', 28, { headCount: 6, tempo: 96, rhythmRatios: 'two-three-four', frequency: 110, speed: .7, panAxis: 'depth' }),
  rhythm('rhythm-fibonacci', 'one : two : three : five', 'rossler', 5.7, { headCount: 8, pulseVoice: 'bell', tempo: 48, rhythmRatios: 'fibonacci', pitchAxis: 'horizontal', frequency: 80, pitchSpan: 2.4, headRate: .4, speed: 1.3 }),
  rhythm('rhythm-variable-234', 'bending two : three : four', 'lorenz', 42, { headCount: 12, pulseVoice: 'tick', tempo: 72, rhythmRatios: 'two-three-four', tempoAxis: 'height', tempoSpan: 2.5, pitchAxis: 'path', frequency: 90, pitchSpan: 2.7, headRate: .5, speed: 1.5 }),
  rhythm('rhythm-variable-octaves', 'period-three clocks', 'logistic', 3.835, { headCount: 12, tempo: 84, rhythmRatios: 'octaves', tempoAxis: 'center', tempoSpan: 2, pitchAxis: 'bend', frequency: 70, pitchSpan: 2.8, headRate: .25, speed: .8 }),
  rhythm('rhythm-kick', 'circular low pulses', 'hopf', 1.1, { pulseVoice: 'kick', tempo: 80, rhythmRatios: 'two-three-four', frequency: 45, pitchAxis: 'center', pitchSpan: .8, pulseDecay: .22, headRate: .3, speed: 1.5, panWidth: 0 }),
  rhythm('rhythm-depth-kick', 'depth drums', 'lorenz', 28, { headCount: 6, pulseVoice: 'kick', tempo: 96, tempoAxis: 'depth', tempoSpan: 2.2, frequency: 40, pitchSpan: .6, pulseDecay: .2, amplitudeAxis: 'height', amplitudeDepth: .45, panAxis: 'depth', panWidth: .7, headRate: .4, speed: .9 }),
  rhythm('rhythm-paper-ticks', 'sixteen paper ticks', 'logistic', 3.99, { headCount: 16, pulseVoice: 'tick', tempo: 144, tempoAxis: 'height', tempoSpan: 1.6, frequency: 160, pitchSpan: 1.6, pulseDecay: .045, panWidth: .9, headRate: .35, speed: 2, headSpread: 2 }),
  rhythm('rhythm-glass-sixteen', 'sixteen glass clocks', 'lorenz', 42, { headCount: 16, pulseVoice: 'bell', tempo: 60, tempoAxis: 'center', tempoSpan: 2, rhythmRatios: 'fibonacci', frequency: 90, pitchSpan: 2.9, pulseDecay: .65, panAxis: 'angle', panWidth: .9, amplitudeAxis: 'depth', amplitudeDepth: .4, headRate: .3, speed: 1.1 }),
  rhythm('rhythm-ripples', 'spiral ripples', 'rossler', 12, { headCount: 10, tempo: 108, tempoAxis: 'height', tempoSpan: 2.7, pitchAxis: 'center', frequency: 65, pitchSpan: 3, travelAxis: 'center', travelSpan: 2, headSpread: 1.5, panWidth: .8, headRate: .22, speed: 1.5 }),
  rhythm('rhythm-hysteresis', 'branch slows / branch speeds', 'fold', -.2, { headCount: 3, pulseVoice: 'bell', tempo: 66, tempoAxis: 'horizontal', tempoSpan: 3, frequency: 90, panAxis: 'path', panWidth: .5, headRate: .2, speed: .7 }),
  rhythm('rhythm-fold-pulse', 'fold pulse cascade', 'fold', .52, { headCount: 8, pulseVoice: 'kick', tempo: 90, tempoAxis: 'path', tempoSpan: 3, pitchAxis: 'horizontal', frequency: 40, pitchSpan: 1, pulseDecay: .35, headSpread: 2, panWidth: .6, headRate: .18, speed: 1.2 }),
  rhythm('rhythm-turbulent-bells', 'turbulent bell swarm', 'lorenz', 60, { headCount: 16, pulseVoice: 'bell', tempo: 180, tempoAxis: 'depth', tempoSpan: 2, rhythmRatios: 'octaves', frequency: 55, pitchSpan: 3, cutoff: 6200, pulseDecay: .12, travelAxis: 'bend', travelSpan: 2, amplitudeAxis: 'center', amplitudeDepth: .6, panAxis: 'depth', panWidth: 1, headSpread: 1.6, speed: 1.6, headRate: .4 }),
]);
export function randomizeScene(scene, random = Math.random) {
  return captureScene(randomizeParams(scene, random));
}
