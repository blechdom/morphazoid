import { PROCESSING_SCHEMA } from "./processing-schema.js";
import { PROCESSING_DATA } from "./processing-catalog.js";
import { TEACHING_DATA } from "./teaching.js";
import { HISTORICAL_DATA } from "./historical-catalog.js";
import { DEFAULT_TUNING_ID, sanitizeTuningId } from "./tunings.js";
/** Synthesis teaching catalogue. Parameters are normalized; displayed units match
 * the Rust engine contract. Presets never own master output level or audio state. */
import { PRESET_LEVEL_TRIMS_DB, METHOD_LEVEL_TRIMS_DB } from "./level-calibration.js";

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const finite = (value, fallback) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() && value.length < 80 ? Number(value) : NaN;
  return Number.isFinite(number) ? number : fallback;
};
const clamp = (value, min = 0, max = 1, fallback = min) => Math.max(min, Math.min(max, finite(value, fallback)));
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Percent metadata uses displayed physical units; engine values remain normalized.
const c = (label, min = 0, max = 1, unit = '%', scale = 'linear') => ({ id: slug(label), label, min: unit === '%' ? min * 100 : min, max: unit === '%' ? max * 100 : max, unit, scale });
export const PARAMETER_COUNT = 16;
const RANGE_MIGRATIONS = [{"engineId":6,"index":0,"old":{"min":8,"max":200,"scale":"linear"},"next":{"min":1,"max":500,"scale":"linear"}},{"engineId":6,"index":1,"old":{"min":2,"max":80,"scale":"linear"},"next":{"min":1,"max":200,"scale":"linear"}},{"engineId":9,"index":0,"old":{"min":0.1,"max":12,"scale":"linear"},"next":{"min":0.0625,"max":32,"scale":"linear"}},{"engineId":10,"index":0,"old":{"min":0.1,"max":12,"scale":"linear"},"next":{"min":0.0625,"max":32,"scale":"linear"}},{"engineId":11,"index":0,"old":{"min":0.1,"max":12,"scale":"linear"},"next":{"min":0.0625,"max":32,"scale":"linear"}},{"engineId":12,"index":0,"old":{"min":0.1,"max":12,"scale":"linear"},"next":{"min":0.0625,"max":32,"scale":"linear"}},{"engineId":11,"index":1,"old":{"min":0,"max":16,"scale":"linear"},"next":{"min":0,"max":32,"scale":"linear"}},{"engineId":12,"index":1,"old":{"min":0,"max":8,"scale":"linear"},"next":{"min":0,"max":32,"scale":"linear"}},{"engineId":7,"index":0,"old":{"min":80,"max":16000,"scale":"log"},"next":{"min":20,"max":20000,"scale":"log"}},{"engineId":20,"index":0,"old":{"min":200,"max":4000,"scale":"linear"},"next":{"min":80,"max":12000,"scale":"linear"}},{"engineId":21,"index":0,"old":{"min":200,"max":4000,"scale":"linear"},"next":{"min":80,"max":12000,"scale":"linear"}},{"engineId":22,"index":0,"old":{"min":200,"max":4000,"scale":"linear"},"next":{"min":80,"max":12000,"scale":"linear"}},{"engineId":21,"index":1,"old":{"min":1,"max":8,"scale":"linear"},"next":{"min":1,"max":32,"scale":"linear"}},{"engineId":15,"index":0,"old":{"min":0.25,"max":4,"scale":"linear"},"next":{"min":0.03125,"max":16,"scale":"linear"}},{"engineId":15,"index":2,"old":{"min":1,"max":48,"scale":"linear"},"next":{"min":1,"max":256,"scale":"linear"}},{"engineId":17,"index":1,"old":{"min":0.15,"max":8,"scale":"linear"},"next":{"min":0.01,"max":30,"scale":"linear"}},{"engineId":19,"index":1,"old":{"min":0.15,"max":8,"scale":"linear"},"next":{"min":0.01,"max":30,"scale":"linear"}}];
// A few existing sound identities now also demonstrate the newly widened range.
// Keys are preset index, then original control index; values are physical units.
const PRESET_RANGE_OVERRIDES = {
  6: { 1: { 0: 420, 1: 28 }, 2: { 0: 2, 1: 155 }, 5: { 0: 1, 1: 200 }, 7: { 0: 310, 1: 72 } },
  7: { 5: { 0: 19500 }, 6: { 0: 38 } },
  9: { 2: { 0: .0625 }, 5: { 0: 27 } },
  10: { 6: { 0: 24.7 }, 7: { 0: .075 } },
  11: { 5: { 0: 19.3, 1: 29 }, 6: { 0: .08, 1: 18 } },
  12: { 5: { 1: 22 }, 6: { 0: 26.5, 1: 6 }, 7: { 0: .07, 1: 28 } },
  15: { 2: { 2: 192 }, 3: { 0: 11.5 }, 4: { 0: .065, 2: 128 }, 7: { 0: 7.2, 2: 240 } },
  17: { 2: { 1: .055 }, 3: { 1: 24 } },
  19: { 1: { 1: .045 }, 4: { 1: 26 } },
  20: { 1: { 0: 6200 }, 6: { 0: 9300 }, 7: { 0: 95 } },
  21: { 2: { 1: 28 }, 5: { 0: 7100 }, 6: { 1: 20 }, 7: { 0: 10500 } },
  22: { 2: { 0: 5600 }, 5: { 0: 9100 }, 6: { 0: 110 } },
};
export function migrateLegacyParameter(engineId, index, normalized) {
  const change = RANGE_MIGRATIONS.find(item => item.engineId === engineId && item.index === index);
  const n = clamp(normalized);
  if (!change) return n;
  const { old, next } = change;
  let physical = old.scale === 'log' ? old.min * (old.max / old.min) ** n : old.min + (old.max - old.min) * n;
  // The original DSP floors these two counts. Keep exact integer boundaries
  // slightly inside their new bin so float32 conversion cannot drop a count.
  if ((engineId === 15 && index === 2 || engineId === 21 && index === 1) && Math.abs(physical - Math.round(physical)) < 1e-6) physical += .001;
  return clamp(next.scale === 'log' ? Math.log(physical / next.min) / Math.log(next.max / next.min) : (physical - next.min) / (next.max - next.min));
}

const integer = (label, min, max) => ({ ...c(label, min, max, ''), integer: true });
const choice = (label, options) => ({ ...integer(label, 0, options.length - 1), options });
const bipolar = label => c(label, -1, 1, '');
const hz = (label, min, max, scale = 'linear') => c(label, min, max, 'Hz', scale);
const ENV = {
  hold: [.018, .22, .8, .35], pad: [1.4, 1.1, .82, 2.7], swell: [.48, .7, .68, 1.4],
  pluck: [.003, .68, 0, .45], tap: [.002, .13, 0, .12], bell: [.002, 2.9, 0, 2.4],
  bass: [.006, .25, .5, .18], reed: [.07, .32, .76, .28], long: [.1, 1.4, .48, 3.2],
};
const p = (name, params, frequencyHz, envelope, cue, stableId) => ({
  id: stableId || slug(name), name, params: [...params], frequencyHz,
  envelope: Object.fromEntries(['attack', 'decay', 'sustain', 'release'].map((key, i) => [key, (Array.isArray(envelope) ? envelope : ENV[envelope])[i]])), cue,
});
const ROADS = { label: 'Curtis Roads, The Computer Music Tutorial (1996)', url: 'https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/' };
const SOURCES = {
  hardSync: {"label": "Eli Brandt, Hard Sync Without Aliasing (2001)", "url": "https://www.cs.cmu.edu/~eli/papers/icmc01-hardsync.pdf"},
  ssb: {"label": "Miller Puckette, The Theory and Technique of Electronic Music: frequency shifting", "url": "https://msp.ucsd.edu/techniques/latest/book.pdf"},
  wavelet: {"label": "Mallat, A theory for multiresolution signal decomposition: the wavelet representation (1989)", "url": "https://doi.org/10.1109/34.192463"},
  colored: {"label": "Voss & Clarke, 1/f noise in music (1978)", "url": "https://doi.org/10.1121/1.381721"},
  shaker: {"label": "Cook, Physically Informed Sonic Modeling (PhISM): Synthesis of Percussive Sounds (1997)", "url": "https://doi.org/10.2307/3681012"},
  membrane: {"label": "Bilbao, Numerical Sound Synthesis (2009)", "url": "https://doi.org/10.1002/9780470749012"},
  fdn: {"label": "Julius O. Smith, Feedback Delay Networks (FDN)", "url": "https://ccrma.stanford.edu/~jos/pasp/Feedback_Delay_Networks_FDN.html"},
  rossler: {"label": "Rössler, An equation for continuous chaos (1976)", "url": "https://doi.org/10.1016/0375-9601(76)90101-8"},

  roads: ROADS,
  scanned: { label: 'Scanned synthesis: history and references', url: 'https://en.wikipedia.org/wiki/Scanned_synthesis' },
  corpus: { label: 'Schwarz, Concatenative Sound Synthesis: The Early Years (2006)', url: 'https://doi.org/10.1162/comj.2006.30.3.5' },
  padsynth: { label: 'Paul Nasca, PADsynth algorithm (2005)', url: 'https://zynaddsubfx.sourceforge.io/doc/PADsynth/PADsynth.htm' },
  vps: { label: 'Kleimola et al., Vector Phaseshaping Synthesis (2011)', url: 'https://www.dafx.de/paper-archive/2011/Papers/55_e.pdf' },
  ar: { label: 'van den Oord et al., WaveNet (2016): family reference', url: 'https://arxiv.org/abs/1609.03499' },
  latent: { label: 'Caillon & Esling, RAVE (2021): family reference', url: 'https://arxiv.org/abs/2111.05011' },
  ddsp: { label: 'Engel et al., DDSP (2020): family reference', url: 'https://arxiv.org/abs/2001.04643' },
  diffusion: { label: 'Kong et al., DiffWave (2020): family reference', url: 'https://arxiv.org/abs/2009.09761' },
  blep: { label: 'Välimäki et al., Alias-Suppressed Oscillators Based on Differentiated Polynomial Waveforms (2010)', url: 'https://doi.org/10.1109/TASL.2009.2026507' },
  adaa: { label: 'Parker, Zavalishin & Le Bivic, Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time Convolution (2016)', url: 'https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf' },
};
// Exact normalized slots/ranges and preserving defaults from the Rust engine.
const EXPANSIONS = {
  0: [
    {"index": 4,"id": "start-jitter","label": "Start jitter","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "loop-crossfade","label": "Loop crossfade","min": 0,"max": 256,"unit": "samples","scale": "linear","defaultNormalized": 0.125},
    {"index": 6,"id": "fine-tune","label": "Fine tune","min": -100,"max": 100,"unit": "cents","scale": "linear","defaultNormalized": 0.5},
    {"index": 7,"id": "sample-interpolation","label": "Sample interpolation","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 1},
  ],
  1: [
    {"index": 4,"id": "table-resolution","label": "Table resolution","min": 16,"max": 2048,"unit": "samples","scale": "log","defaultNormalized": 1,"integer": true},
    {"index": 5,"id": "phase-offset","label": "Phase offset","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "fold","label": "Wavefold","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "unison-mix","label": "Unison mix","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  2: [
    {"index": 8,"id": "harmonic-stretch","label": "Harmonic stretch","min": 1,"max": 1.8,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 9,"id": "spectral-tilt","label": "Spectral tilt","min": -24,"max": 24,"unit": "dB/oct","scale": "linear","defaultNormalized": 0.5},
    {"index": 10,"id": "odd-even","label": "Odd / even bias","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 11,"id": "detune","label": "Partial detune","min": 0,"max": 60,"unit": "cents","scale": "linear","defaultNormalized": 0},
    {"index": 12,"id": "phase-spread","label": "Phase spread","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 13,"id": "partial-offset","label": "Partial offset","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 14,"id": "partial-motion","label": "Partial motion","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 15,"id": "motion-rate","label": "Motion rate","min": 0.1,"max": 12,"unit": "Hz","scale": "linear","defaultNormalized": 0.3},
  ],
  3: [
    {"index": 4,"id": "phase-offset","label": "Phase offset","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "basis-gap","label": "Basis gap","min": 1,"max": 16,"unit": "","scale": "linear","defaultNormalized": 0,"integer": true},
    {"index": 6,"id": "sequency-motion","label": "Sequency motion","min": 0,"max": 8,"unit": "","scale": "linear","defaultNormalized": 0,"integer": true},
    {"index": 7,"id": "motion-rate","label": "Motion rate","min": 0.1,"max": 10,"unit": "Hz","scale": "linear","defaultNormalized": 0.2},
  ],
  4: [
    {"index": 4,"id": "orbit-depth","label": "Vector orbit","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "orbit-rate","label": "Orbit rate","min": 0.02,"max": 10,"unit": "Hz","scale": "linear","defaultNormalized": 0.1},
    {"index": 6,"id": "corner-a","label": "Corner A waveform","min": 0,"max": 3,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "corner-b","label": "Corner B waveform","min": 0,"max": 3,"unit": "","scale": "linear","defaultNormalized": 0.3333333333333333},
    {"index": 8,"id": "corner-c","label": "Corner C waveform","min": 0,"max": 3,"unit": "","scale": "linear","defaultNormalized": 0.6666666666666666},
    {"index": 9,"id": "corner-d","label": "Corner D waveform","min": 0,"max": 3,"unit": "","scale": "linear","defaultNormalized": 1},
  ],
  5: [
    {"index": 4,"id": "surface-ripples","label": "Surface ripples","min": 1,"max": 12,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "x-offset","label": "X offset","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 6,"id": "y-offset","label": "Y offset","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 7,"id": "rotation","label": "Terrain rotation","min": 0,"max": 360,"unit": "degrees","scale": "linear","defaultNormalized": 0},
  ],
  6: [
    {"index": 4,"id": "source-position","label": "Source position","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "scan-speed","label": "Scan speed","min": -2,"max": 2,"unit": "×","scale": "linear","defaultNormalized": 0.5625},
    {"index": 6,"id": "reverse-probability","label": "Reverse probability","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "grain-window","label": "Grain window","min": 0,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0,"options": ["Hann","Triangle","Blackman"],"integer": true},
  ],
  7: [
    {"index": 4,"id": "filter-mode","label": "Filter mode","min": 0,"max": 3,"unit": "","scale": "linear","defaultNormalized": 0,"options": ["Lowpass","Bandpass","Highpass","Notch"],"integer": true},
    {"index": 5,"id": "envelope-depth","label": "Cutoff envelope","min": -8,"max": 8,"unit": "octaves","scale": "linear","defaultNormalized": 0.5},
    {"index": 6,"id": "filter-drive","label": "Filter drive","min": 1,"max": 12,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "pulse-width","label": "Pulse width","min": 0.02,"max": 0.98,"unit": "","scale": "linear","defaultNormalized": 0.5},
  ],
  8: [
    {"index": 4,"id": "model-order","label": "Model order","min": 2,"max": 24,"unit": "poles","scale": "linear","defaultNormalized": 0.45454545454545453,"integer": true},
    {"index": 5,"id": "pre-emphasis","label": "Pre-emphasis","min": 0,"max": 0.98,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "pole-radius","label": "Pole radius","min": 0.94,"max": 0.9995,"unit": "","scale": "linear","defaultNormalized": 0.9243697478991588},
    {"index": 7,"id": "analysis-length","label": "Analysis length","min": 128,"max": 2048,"unit": "samples","scale": "log","defaultNormalized": 0.75,"integer": true},
  ],
  9: [
    {"index": 4,"id": "carrier-shape","label": "Carrier shape","min": 0,"max": 3,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "mod-phase","label": "Modulator phase","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "carrier-harmonic","label": "Carrier harmonic","min": 1,"max": 8,"unit": "","scale": "linear","defaultNormalized": 0,"integer": true},
    {"index": 7,"id": "mod-detune","label": "Modulator offset","min": -24,"max": 24,"unit": "Hz","scale": "linear","defaultNormalized": 0.5},
  ],
  10: [
    {"index": 4,"id": "carrier-transpose","label": "Carrier transpose","min": -24,"max": 24,"unit": "semitones","scale": "linear","defaultNormalized": 0.5},
    {"index": 5,"id": "mod-phase","label": "Modulator phase","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "rectification","label": "Rectification","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "input-drive","label": "Input drive","min": 1,"max": 8,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  11: [
    {"index": 4,"id": "second-ratio","label": "Second operator ratio","min": 0.1,"max": 12,"unit": "","scale": "linear","defaultNormalized": 0.15966386554621848},
    {"index": 5,"id": "second-depth","label": "Second operator depth","min": 0,"max": 8,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "operator-topology","label": "Parallel / serial","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "feedback-delay","label": "Feedback delay","min": 1,"max": 64,"unit": "samples","scale": "linear","defaultNormalized": 0,"integer": true},
  ],
  12: [
    {"index": 4,"id": "second-ratio","label": "Second operator ratio","min": 0.1,"max": 12,"unit": "","scale": "linear","defaultNormalized": 0.15966386554621848},
    {"index": 5,"id": "second-depth","label": "Second operator depth","min": 0,"max": 8,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "operator-topology","label": "Parallel / serial","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "feedback-delay","label": "Feedback delay","min": 1,"max": 64,"unit": "samples","scale": "linear","defaultNormalized": 0,"integer": true},
  ],
  13: [
    {"index": 4,"id": "phase-offset","label": "Phase offset","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "second-breakpoint","label": "Second breakpoint","min": 0.02,"max": 0.98,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 6,"id": "second-warp","label": "Second distortion","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "resonance-damping","label": "Resonance damping","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  14: [
    {"index": 4,"id": "source-shape","label": "Source waveform","min": 0,"max": 3,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "wet","label": "Shaping mix","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 1},
    {"index": 6,"id": "fold-multiplier","label": "Fold multiplier","min": 1,"max": 8,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "bit-depth","label": "Quantization","min": 4,"max": 24,"unit": "bits","scale": "linear","defaultNormalized": 1,"integer": true},
  ],
  15: [
    {"index": 4,"id": "carrier-offset","label": "Carrier offset","min": -2,"max": 2,"unit": "partials","scale": "linear","defaultNormalized": 0.5},
    {"index": 5,"id": "spacing-phase","label": "Spacing phase","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "alternating-phase","label": "Partial phase step","min": 0,"max": 180,"unit": "degrees","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "spacing-detune","label": "Spacing fine tune","min": -50,"max": 50,"unit": "cents","scale": "linear","defaultNormalized": 0.5},
    {"index": 8,"id": "count-multiplier","label": "Partial count multiplier","min": 1,"max": 8,"unit": "","scale": "linear","defaultNormalized": 0,"integer": true},
  ],
  16: [
    {"index": 4,"id": "spring-nonlinearity","label": "Spring nonlinearity","min": 0,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "tension-envelope","label": "Tension envelope","min": -2,"max": 2,"unit": "octaves","scale": "linear","defaultNormalized": 0.5},
    {"index": 6,"id": "pickup","label": "Pickup position","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.3225806451612903},
    {"index": 7,"id": "boundary","label": "Clamped / free ends","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 8,"id": "strike-width","label": "Strike width","min": 0.01,"max": 0.4,"unit": "","scale": "linear","defaultNormalized": 0.20512820512820512},
    {"index": 9,"id": "mass-count","label": "Mass count","min": 8,"max": 32,"unit": "","scale": "linear","defaultNormalized": 1,"integer": true},
  ],
  17: [
    {"index": 4,"id": "mode-count","label": "Mode count","min": 1,"max": 16,"unit": "","scale": "linear","defaultNormalized": 1,"integer": true},
    {"index": 5,"id": "mode-detune","label": "Mode detune","min": 0,"max": 50,"unit": "cents","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "decay-tilt","label": "Decay tilt","min": -2,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 7,"id": "partial-tilt","label": "Partial tilt","min": -2,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 8,"id": "strike-hardness","label": "Strike hardness","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 9,"id": "strike-noise","label": "Strike noise","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  18: [
    {"index": 4,"id": "reed-offset","label": "Reed opening","min": 0.1,"max": 1.2,"unit": "","scale": "linear","defaultNormalized": 0.4727272727272727},
    {"index": 5,"id": "reed-power","label": "Reed curve","min": 0.5,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0.3333333333333333},
    {"index": 6,"id": "pressure-vibrato","label": "Pressure vibrato","min": 0,"max": 0.1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "vibrato-rate","label": "Vibrato rate","min": 0.1,"max": 12,"unit": "Hz","scale": "linear","defaultNormalized": 0.4},
    {"index": 8,"id": "breath-noise","label": "Breath noise","min": 0,"max": 0.3,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 9,"id": "reed-minimum","label": "Reed lower limit","min": -1,"max": 0,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  19: [
    {"index": 4,"id": "dispersion","label": "String dispersion","min": 0,"max": 0.8,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "inversion","label": "Feedback inversion","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "excitation-length","label": "Excitation length","min": 0.1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 1},
    {"index": 7,"id": "excitation-mix","label": "Noise / displacement","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.65},
    {"index": 8,"id": "pick-burst","label": "Pick noise burst","min": 0,"max": 20,"unit": "ms","scale": "linear","defaultNormalized": 0},
  ],
  20: [
    {"index": 4,"id": "onset-time","label": "Grain onset","min": 0.1,"max": 10,"unit": "ms","scale": "linear","defaultNormalized": 0.09090909090909091},
    {"index": 5,"id": "second-ratio","label": "Second formant ratio","min": 1,"max": 4,"unit": "","scale": "linear","defaultNormalized": 0.4333333333333333},
    {"index": 6,"id": "grain-phase","label": "Grain phase","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "formant-jitter","label": "Formant jitter","min": 0,"max": 0.4,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  21: [
    {"index": 4,"id": "pulse-power","label": "Pulse curvature","min": 0.2,"max": 4,"unit": "","scale": "linear","defaultNormalized": 0.2105263157894737},
    {"index": 5,"id": "alternating-pulses","label": "Alternating pulses","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "formant-chirp","label": "Formant chirp","min": -24,"max": 24,"unit": "semitones","scale": "linear","defaultNormalized": 0.5},
    {"index": 7,"id": "cycle-jitter","label": "Cycle jitter","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  22: [
    {"index": 4,"id": "window-shape","label": "Window: Gaussian → Hann → triangle","min": 0,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "carrier-phase","label": "Carrier phase","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "second-ratio","label": "Second formant ratio","min": 1,"max": 5,"unit": "","scale": "linear","defaultNormalized": 0.42500000000000004},
    {"index": 7,"id": "window-drift","label": "Window drift","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  23: [
    {"index": 4,"id": "start-level","label": "Start level","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "end-level","label": "End level","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 1},
    {"index": 6,"id": "return-curve","label": "Return curvature","min": -2,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 7,"id": "rectification","label": "Rectification","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  24: [
    {"index": 8,"id": "midpoint-1","label": "Midpoint 1 offset","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 9,"id": "midpoint-2","label": "Midpoint 2 offset","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 10,"id": "midpoint-3","label": "Midpoint 3 offset","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 11,"id": "midpoint-4","label": "Midpoint 4 offset","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 12,"id": "midpoint-5","label": "Midpoint 5 offset","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 13,"id": "midpoint-6","label": "Midpoint 6 offset","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 14,"id": "midpoint-7","label": "Midpoint 7 offset","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 15,"id": "midpoint-8","label": "Midpoint 8 offset","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
  ],
  25: [
    {"index": 4,"id": "carrier-shape","label": "Carrier shape","min": 0,"max": 3,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "depth-envelope","label": "Depth envelope","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 6,"id": "distribution","label": "Noise distribution","min": 0,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0,"options": ["Uniform","Gaussian","Binary"],"integer": true},
    {"index": 7,"id": "seed","label": "Noise seed","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  26: [
    {"index": 4,"id": "interpolation","label": "Interpolation: linear → cosine → cubic","min": 0,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "time-scale","label": "Time scale","min": 0.25,"max": 4,"unit": "","scale": "log","defaultNormalized": 0.5},
    {"index": 6,"id": "elasticity","label": "Waveform elasticity","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "duration-ceiling","label": "Duration ceiling","min": 1,"max": 8,"unit": "","scale": "linear","defaultNormalized": 0.14285714285714285},
    {"index": 8,"id": "seed","label": "Random seed","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  27: [
    {"index": 4,"id": "pulse-phase","label": "Pulsaret phase","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "masking","label": "Pulse masking","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "pulse-damping","label": "Pulsaret damping","min": 0,"max": 10,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "pulse-skew","label": "Pulsaret skew","min": 0.1,"max": 4,"unit": "","scale": "linear","defaultNormalized": 0.23076923076923078},
  ],
  28: [
    {"index": 4,"id": "position-offset","label": "Source offset","min": 0,"max": 100,"unit": "%","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "freeze","label": "Freeze analysis","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0,"options": ["Moving","Frozen"],"integer": true},
    {"index": 6,"id": "low-cut","label": "Low frequency","min": 20,"max": 24000,"unit": "Hz","scale": "log","defaultNormalized": 0},
    {"index": 7,"id": "high-cut","label": "High frequency","min": 20,"max": 24000,"unit": "Hz","scale": "log","defaultNormalized": 1},
    {"index": 8,"id": "spectral-gate","label": "Spectral gate","min": 0,"max": 100,"unit": "%","scale": "linear","defaultNormalized": 0},
    {"index": 9,"id": "phase-lock","label": "Phase locking","min": 0,"max": 100,"unit": "%","scale": "linear","defaultNormalized": 0},
  ],
  29: [
    {"index": 4,"id": "update-stride","label": "Model update stride","min": 8,"max": 128,"unit": "samples","scale": "linear","defaultNormalized": 0.2,"integer": true},
    {"index": 5,"id": "centering","label": "Centering force","min": 0,"max": 0.004,"unit": "","scale": "linear","defaultNormalized": 0.05},
    {"index": 6,"id": "pickup-offset","label": "Scan offset","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "bow-force","label": "Bow force","min": 0,"max": 0.05,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  30: [
    {"index": 4,"id": "descriptor-sharpness","label": "Descriptor sharpness","min": 0,"max": 8,"unit": "","scale": "linear","defaultNormalized": 0.125},
    {"index": 5,"id": "fragment-overlap","label": "Fragment overlap","min": 0,"max": 0.95,"unit": "","scale": "linear","defaultNormalized": 0.5263157894736842},
    {"index": 6,"id": "fragment-window","label": "Fragment window","min": 0,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0,"options": ["Hann","Triangle","Blackman"],"integer": true},
    {"index": 7,"id": "reverse-probability","label": "Reverse probability","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  31: [
    {"index": 4,"id": "harmonic-count","label": "Harmonic count","min": 1,"max": 96,"unit": "partials","scale": "linear","defaultNormalized": 0.49473684210526314,"integer": true},
    {"index": 5,"id": "harmonic-stretch","label": "Harmonic stretch","min": 0.8,"max": 1.2,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 6,"id": "odd-even-balance","label": "Odd / even balance","min": 0,"max": 100,"unit": "%","scale": "linear","defaultNormalized": 0.5},
    {"index": 7,"id": "phase-seed","label": "Phase seed","min": 0,"max": 100,"unit": "%","scale": "linear","defaultNormalized": 0},
    {"index": 8,"id": "bandwidth-scale","label": "Bandwidth multiplier","min": 0.1,"max": 10,"unit": "×","scale": "log","defaultNormalized": 0.5},
  ],
  32: [
    {"index": 4,"id": "motion-shape","label": "Motion: sine → triangle → saw","min": 0,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "motion-phase","label": "Motion phase","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "vertical-motion","label": "Vertical motion","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "motion-ratio","label": "Vertical motion ratio","min": 0.25,"max": 4,"unit": "","scale": "linear","defaultNormalized": 0.2},
  ],
  33: [
    {"index": 4,"id": "history-amount","label": "History amount","min": 0,"max": 150,"unit": "%","scale": "linear","defaultNormalized": 0.6666666666666666},
    {"index": 5,"id": "prediction-rate","label": "Prediction rate","min": 3000,"max": 24000,"unit": "Hz","scale": "log","defaultNormalized": 0.6666666666666666},
    {"index": 6,"id": "history-stride","label": "History stride","min": 1,"max": 8,"unit": "samples","scale": "linear","defaultNormalized": 0,"integer": true},
    {"index": 7,"id": "sampling-seed","label": "Sampling seed","min": 0,"max": 100,"unit": "%","scale": "linear","defaultNormalized": 0},
  ],
  34: [
    {"index": 4,"id": "latent-spread","label": "Latent spread","min": 0,"max": 2,"unit": "×","scale": "linear","defaultNormalized": 0.5},
    {"index": 5,"id": "orbit-depth","label": "Orbit depth","min": 0,"max": 100,"unit": "%","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "orbit-rate","label": "Orbit rate","min": 0.01,"max": 8,"unit": "Hz","scale": "log","defaultNormalized": 0.5},
    {"index": 7,"id": "orbit-plane","label": "Orbit plane","min": 0,"max": 5,"unit": "","scale": "linear","defaultNormalized": 0,"options": ["XY","XZ","XW","YZ","YW","ZW"],"integer": true},
  ],
  35: [
    {"index": 4,"id": "partial-count","label": "Partial count","min": 1,"max": 8,"unit": "partials","scale": "linear","defaultNormalized": 1,"integer": true},
    {"index": 5,"id": "harmonic-stretch","label": "Harmonic stretch","min": 0.8,"max": 1.2,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 6,"id": "noise-color","label": "Noise color","min": -1,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 7,"id": "attack-brightness","label": "Attack brightness","min": 0,"max": 100,"unit": "%","scale": "linear","defaultNormalized": 0},
    {"index": 8,"id": "attack-time","label": "Attack color time","min": 0.005,"max": 2,"unit": "s","scale": "log","defaultNormalized": 0.5},
  ],
  36: [
    {"index": 4,"id": "condition-contrast","label": "Condition contrast","min": 0,"max": 2,"unit": "×","scale": "linear","defaultNormalized": 0.5},
    {"index": 5,"id": "noise-endpoint","label": "Residual noise","min": 0,"max": 80,"unit": "%","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "stochasticity","label": "Sampling stochasticity","min": 0,"max": 100,"unit": "%","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "regeneration-rate","label": "Regeneration rate","min": 0,"max": 4,"unit": "Hz","scale": "linear","defaultNormalized": 0},
  ],
  37: [
    {"index": 4,"id": "bit-depth","label": "Quantization","min": 4,"max": 24,"unit": "bits","scale": "linear","defaultNormalized": 1,"integer": true},
    {"index": 5,"id": "dither","label": "Dither","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "phase-offset","label": "Phase offset","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "oversampling","label": "Oversampling","min": 0,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0,"options": ["1×","2×","4×"],"integer": true},
  ],
  38: [
    {"index": 4,"id": "source-shape","label": "Sine / saw source","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 1},
    {"index": 5,"id": "wet","label": "Shaping mix","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 1},
    {"index": 6,"id": "pre-emphasis","label": "Pre-emphasis","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "input-bit-depth","label": "Input quantization","min": 4,"max": 24,"unit": "bits","scale": "linear","defaultNormalized": 1,"integer": true},
  ],
  39: [
    {"index": 0,"id": "slave-ratio","label": "Slave ratio","min": 1,"max": 32,"unit": "","scale": "linear","defaultNormalized": 0.0967741935483871},
    {"index": 1,"id": "slave-waveform","label": "Slave waveform","min": 0,"max": 2,"unit": "","scale": "integer", "options": ["Sine", "Saw", "Pulse"],"defaultNormalized": 0.5},
    {"index": 2,"id": "pulse-width","label": "Pulse width","min": 0.02,"max": 0.98,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 3,"id": "reset-phase","label": "Reset phase","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 4,"id": "sync-envelope","label": "Sync envelope","min": -24,"max": 24,"unit": "semitones","scale": "linear","defaultNormalized": 0.5},
    {"index": 5,"id": "sync-depth","label": "Sync depth","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 1},
    {"index": 6,"id": "sync-jitter","label": "Sync jitter","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "antialias","label": "Antialias sync","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 1,"options": ["Off","On"],"integer": true},
  ],
  40: [
    {"index": 0,"id": "frequency-shift","label": "Frequency shift","min": -4000,"max": 4000,"unit": "Hz","scale": "linear","defaultNormalized": 0.5},
    {"index": 1,"id": "modulator-ratio","label": "Modulator ratio","min": 0.1,"max": 16,"unit": "","scale": "linear","defaultNormalized": 0.05660377358490566},
    {"index": 2,"id": "sideband","label": "Upper / lower","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 3,"id": "harmonic-count","label": "Modulator harmonics","min": 1,"max": 32,"unit": "","scale": "linear","defaultNormalized": 0.22580645161290322,"integer": true},
    {"index": 4,"id": "rolloff","label": "Harmonic rolloff","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 5,"id": "wet","label": "Sideband mix","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 1},
    {"index": 6,"id": "modulator-phase","label": "Modulator phase","min": 0,"max": 1,"unit": "cycles","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "shift-motion","label": "Shift motion","min": 0,"max": 2000,"unit": "Hz","scale": "linear","defaultNormalized": 0},
  ],
  41: [
    {"index": 0,"id": "wavelet-family","label": "Wavelet family","min": 0,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0,"options": ["Morlet","Mexican hat","Haar"],"integer": true},
    {"index": 1,"id": "scale-count","label": "Scale count","min": 1,"max": 8,"unit": "","scale": "linear","defaultNormalized": 0.5714285714285714,"integer": true},
    {"index": 2,"id": "scale-spacing","label": "Scale spacing","min": 1.25,"max": 4,"unit": "","scale": "linear","defaultNormalized": 0.2727272727272727},
    {"index": 3,"id": "scale-decay","label": "Scale decay","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 4,"id": "wavelet-width","label": "Wavelet width","min": 0.025,"max": 0.5,"unit": "","scale": "linear","defaultNormalized": 0.4},
    {"index": 5,"id": "translation","label": "Wavelet translation","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 6,"id": "scale-motion","label": "Scale motion","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "chirp","label": "Wavelet chirp","min": 0,"max": 10,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  42: [
    {"index": 0,"id": "spectral-exponent","label": "Spectral exponent","min": -2,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 1,"id": "low-cut","label": "Low cut","min": 20,"max": 2000,"unit": "Hz","scale": "log","defaultNormalized": 0},
    {"index": 2,"id": "high-cut","label": "High cut","min": 200,"max": 20000,"unit": "Hz","scale": "log","defaultNormalized": 1},
    {"index": 3,"id": "distribution","label": "Distribution","min": 0,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0,"options": ["Uniform","Gaussian","Binary"],"integer": true},
    {"index": 4,"id": "hold-length","label": "Sample hold","min": 1,"max": 64,"unit": "samples","scale": "linear","defaultNormalized": 0,"integer": true},
    {"index": 5,"id": "resonance-frequency","label": "Resonance frequency","min": 100,"max": 8000,"unit": "Hz","scale": "log","defaultNormalized": 0.4},
    {"index": 6,"id": "resonance","label": "Resonance","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 7,"id": "flutter","label": "Level flutter","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  43: [
    {"index": 0,"id": "particle-count","label": "Particle count","min": 2,"max": 256,"unit": "","scale": "log","defaultNormalized": 0.6,"integer": true},
    {"index": 1,"id": "collision-rate","label": "Collision rate","min": 0.01,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 2,"id": "mode-spread","label": "Mode spread","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 3,"id": "energy-decay","label": "Energy decay","min": 0.05,"max": 4,"unit": "s","scale": "log","defaultNormalized": 0.45},
    {"index": 4,"id": "resonance-q","label": "Resonance Q","min": 1,"max": 100,"unit": "","scale": "log","defaultNormalized": 0.7},
    {"index": 5,"id": "shake-force","label": "Continuous shake","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "contact-noise","label": "Contact noise","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.7},
    {"index": 7,"id": "brightness","label": "Contact brightness","min": 20,"max": 20000,"unit": "Hz","scale": "log","defaultNormalized": 0.6},
  ],
  44: [
    {"index": 0,"id": "tension","label": "Membrane tension","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.4},
    {"index": 1,"id": "damping","label": "Damping","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.3},
    {"index": 2,"id": "strike-x","label": "Strike X","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 3,"id": "strike-y","label": "Strike Y","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 4,"id": "aspect","label": "Aspect ratio","min": 0.5,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0.3333333333333333},
    {"index": 5,"id": "pickup-x","label": "Pickup X","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.3},
    {"index": 6,"id": "pickup-y","label": "Pickup Y","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.6},
    {"index": 7,"id": "boundary","label": "Clamped / free","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 8,"id": "strike-hardness","label": "Strike hardness","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.7},
    {"index": 9,"id": "grid-resolution","label": "Grid resolution","min": 6,"max": 16,"unit": "","scale": "linear","defaultNormalized": 0.6,"integer": true},
  ],
  45: [
    {"index": 0,"id": "network-size","label": "Network size","min": 0.002,"max": 0.2,"unit": "s","scale": "log","defaultNormalized": 0.5},
    {"index": 1,"id": "decay","label": "Decay","min": 0.05,"max": 10,"unit": "s","scale": "log","defaultNormalized": 0.5},
    {"index": 2,"id": "damping","label": "Damping","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.3},
    {"index": 3,"id": "diffusion","label": "Diffusion","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 1},
    {"index": 4,"id": "line-count","label": "Delay lines","min": 2,"max": 8,"unit": "","scale": "linear","defaultNormalized": 1,"integer": true},
    {"index": 5,"id": "dispersion","label": "Delay dispersion","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.4},
    {"index": 6,"id": "injection","label": "Injection position","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
    {"index": 7,"id": "excitation-noise","label": "Noise excitation","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 1},
    {"index": 8,"id": "saturation","label": "Feedback saturation","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 9,"id": "inversion","label": "Feedback inversion","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0},
  ],
  46: [
    {"index": 0,"id": "rossler-a","label": "Rössler a","min": 0.05,"max": 0.5,"unit": "","scale": "linear","defaultNormalized": 0.3333333333333333},
    {"index": 1,"id": "rossler-b","label": "Rössler b","min": 0.05,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.15789473684210525},
    {"index": 2,"id": "rossler-c","label": "Rössler c","min": 2,"max": 16,"unit": "","scale": "linear","defaultNormalized": 0.2642857142857143},
    {"index": 3,"id": "time-scale","label": "Time scale","min": 0.2,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0.4444444444444445},
    {"index": 4,"id": "output-axis","label": "Output: X → Y → Z","min": 0,"max": 2,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 5,"id": "rotation","label": "Projection rotation","min": 0,"max": 360,"unit": "","scale": "linear","defaultNormalized": 0},
    {"index": 6,"id": "integration-quality","label": "Minimum integration substeps","min": 1,"max": 8,"unit": "","scale": "linear","defaultNormalized": 1,"integer": true},
    {"index": 7,"id": "initial-state","label": "Initial state","min": 0,"max": 1,"unit": "","scale": "linear","defaultNormalized": 0.5},
  ],
};

// Repair factory examples whose spectrum/decay hid the intended sound. Controls
// remain unrestricted; these are playable starting points, not gain automation.
const AUDIBLE_PRESET_SETTINGS = {
  "karplus-strong/high-harmonic-pin": {"controls":{"inversion":0,"pick-burst":1,"excitation-mix":0.4,"excitation-length":1}},
  "karplus-strong/hollow-center-pluck": {"controls":{"inversion":0,"pick-burst":1,"excitation-mix":0.4,"excitation-length":1}},
  "karplus-strong/soft-low-string": {"controls":{"inversion":0,"pick-burst":0,"excitation-length":1,"excitation-mix":0.4}},
  "physical/soft-heavy-spring": {"controls":{"stiffness":10,"damping":3,"mass-gradient":65},"frequencyHz":123},
  "physical/rubbery-short-knock": {"controls":{"stiffness":22,"damping":10,"mass-gradient":45},"frequencyHz":223,"envelope":{"attack":0.003,"decay":0.36,"sustain":0,"release":0.3}},
  "physical/damped-wooden-tap": {"controls":{"stiffness":70,"damping":15},"frequencyHz":367},
  "physical/edge-strike": {"controls":{"strike-position":9,"strike-width":0.06,"damping":4}},
  "pulsar/hard-window-tick": {"controls":{"duty":18,"pulsaret-formant":3.25,"pulse-phase":0,"masking":0,"pulse-damping":1,"pulse-skew":1},"frequencyHz":223},
  "particle-shaker/sparse-beads": {"controls":{"resonance-q":72,"brightness":6200,"contact-noise":0.4}},
  "particle-shaker/separated-pebble-clicks": {"controls":{"resonance-q":64,"contact-noise":0.4}},
  "granular/needle-shower": {"controls":{"grain-size":6,"density":150,"pitch-spread":12}},
  "fdn-resonator/short-wooden-box": {"controls":{"diffusion":1,"damping":0.55,"excitation-noise":0.55,"line-count":6}},
  "fdn-resonator/long-low-resonator": {"controls":{"network-size":0.08,"damping":0.4,"excitation-noise":0.3},"frequencyHz":97},
  "fdn-resonator/saturated-struck-network": {"controls":{"inversion":1,"saturation":0.45}},
};
function audiblePreset(methodId, controls, preset, params) {
  const setting = AUDIBLE_PRESET_SETTINGS[methodId + '/' + preset.id];
  if (!setting) return { ...preset, params };
  params = [...params];
  for (const [id, physical] of Object.entries(setting.controls)) {
    const index = controls.findIndex(control => control.id === id);
    if (index < 0) throw new Error('Unknown preset control: ' + methodId + '/' + id);
    params[index] = normalizedParameter(controls[index], physical);
  }
  return { ...preset, params, ...(setting.frequencyHz ? { frequencyHz: setting.frequencyHz } : {}),
    ...(setting.envelope ? { envelope: { ...setting.envelope } } : {}) };
}

// Added normalized slots, in implementation order. Empty rows keep preserving defaults.
const PRESET_EXTENSIONS = {
  0: [[], [.03, .04, .5, 1], [], [.3, .4, .38, .8], [], [.15, .18, .6, 1], [], [.65, .7, .45, .65]],
  1: [[], [.82, .25, 0, .08], [], [1, .5, .1, 0], [], [.18, .13, .25, .05], [], [.65, .68, .4, .18]],
  2: [[], [], [], [0, .6, .5, .04, .2, .5, 0, .3], [], [.32, .45, .5, .1, .3, .5, 0, .3], [0, .4, .7, .18, .65, .5, .18, .06], [.08, .7, .5, .12, .4, .5, .35, .62]],
  3: [[], [.1, 0, 0, .1], [], [.25, .13, 0, .2], [], [.8, .8, .5, .8], [], [.05, .2, .25, .15]],
  4: [[], [], [], [.65, .015, 0, .33, .67, 1], [], [.12, .3, .33, .67, 0, 1], [], [.05, .1, .67, 1, .33, .67]],
  5: [[], [.85, .35, .6, .13], [], [.4, .5, .25, .25], [], [.15, .25, .6, .55], [], [.05, .55, .4, .08]],
  6: [[], [.36, .5, 0, 0], [], [.6, .62, .35, .5], [], [.18, .7, .7, 1], [], [.4, .35, .45, .5]],
  7: [[], [0, .55, .1, .5], [], [0, .65, .12, .3], [1 / 3, .5, .03, .5], [2 / 3, .5, .05, .5], [], [0, .44, 0, .5]],
  8: [[], [.73, .22, .86, .62], [], [.45, .15, .9, .85], [], [.36, .4, .82, .35], [], [.91, .25, .97, 1]],
  9: [[], [.16, 0, 0, .5], [], [0, .25, .14, .56], [], [.68, .4, .28, .7], [], [.33, .15, .14, .46]],
  10: [[], [.5, .25, 0, 0], [], [.5, .15, .14, .12], [], [.75, .5, .08, .08], [], [.25, .7, .25, .2]],
  11: [[], [.076, .04, 0, 0], [], [.239, .2, .8, .04], [], [.48, .65, .6, .18], [], [.076, .18, .3, .08]],
  12: [[], [.076, .08, 0, 0], [], [.24, .28, .9, .03], [], [.5, .7, .75, .22], [], [.11, .18, .3, .1]],
  13: [[], [.12, .7, .2, .1], [], [.25, .18, .48, .18], [], [.4, .85, .65, .4], [], [.05, .3, .25, .6]],
  14: [[], [.2, 1, .05, 1], [], [.33, .85, .15, 1], [], [.67, 1, .6, .65], [], [1, .9, .35, .25]],
  15: [[], [.5, .12, 0, .5, 0], [], [.58, .25, .3, .52, .14], [], [.8, .33, .65, .58, .43], [], [.42, .1, .2, .48, .29]],
  16: [[], [.12, .6, .25, .1, .15, .75], [], [.04, .48, .68, .15, .4, 1], [], [.3, .65, .45, .25, .06, .5], [], [.08, .5, .4, .05, .65, .9]],
  17: [[], [.47, 0, .42, .55, .18, .03], [], [1, .18, .65, .4, .08, 0], [], [.27, .06, .35, .7, .72, .15], [], [.8, .35, .6, .6, .45, .25]],
  18: [[], [.47, .34, .15, .4, .04, 0], [], [.47, .33, .05, .5, .35, 0], [], [.49, .32, .28, .6, .08, 0], [], [.46, .35, .45, .25, .12, 0]],
  19: [[], [.12, 0, .75, .5, .08], [], [.4, .1, .4, .8, .22], [], [.15, .65, .55, .7, .1], [], [.65, .25, .25, .9, .45]],
  20: [[], [.2, .65, .25, .03], [], [.02, .4, .1, .3], [], [.35, .55, .35, .15], [], [.01, .12, .5, .05]],
  21: [[], [.08, 0, .5, 0], [], [.65, .3, .7, .08], [], [.3, .8, .3, .3], [], [.15, .5, .62, .55]],
  22: [[], [.5, .25, .45, .05], [], [1, .5, .2, .18], [], [.25, .15, .75, .4], [], [.65, .6, .35, .7]],
  23: [[], [.15, .85, .65, 0], [], [.05, .7, .25, .1], [], [.3, .95, .8, .35], [], [.2, .75, .35, .65]],
  24: [[], [.5, .55, .5, .45, .5, .55, .5, .45], [], [.65, .4, .55, .45, .35, .6, .45, .55], [], [.85, .15, .8, .2, .75, .25, .7, .3], [], [.58, .36, .74, .25, .67, .44, .52, .35]],
  25: [[], [.33, .5, 0, .15], [], [0, .75, .5, .33], [], [.67, .3, 1, .62], [], [.15, .65, .5, .86]],
  26: [[], [.5, .4, .2, .2, .15], [], [1, .6, .55, .45, .35], [], [0, .75, .12, .7, .67], [], [.75, .35, .72, .35, .89]],
  27: [[], [.25, 0, .05, .35], [], [.1, .25, .2, .12], [], [.5, .45, .65, .6], [], [.7, .2, .35, .45]],
  28: [[], [.25, 1, 0, 1, 0, .6], [], [.45, 0, .08, .93, .04, .35], [], [.6, 0, .35, 1, .2, .1], [], [.15, 1, .1, .85, .08, .8]],
  29: [[], [.4, .12, .25, .05], [], [.1, .02, .5, .35], [], [.65, .25, .7, .6], [], [.25, .08, .1, .18]],
  30: [[], [.5, .65, .5, .1], [], [.8, .2, 1, .35], [], [.25, .9, 0, .65], [], [.6, .45, .5, .2]],
  31: [[], [.75, .5, .35, .15, .55], [], [.4, .6, .7, .4, .35], [], [1, .45, .55, .65, .8], [], [.65, .55, .25, .9, .62]],
  32: [[], [.5, .25, .2, .2], [], [1, .5, .55, .4], [], [.25, .1, .85, .65], [], [.75, .7, .35, .1]],
  33: [[], [.55, .8, 0, .12], [], [.75, .65, .14, .3], [], [.45, .45, .28, .65], [], [.85, .7, .14, .9]],
  34: [[], [.6, .1, .35, 0], [], [.4, .35, .2, .4], [], [.7, .5, .4, .8], [], [.55, .7, .25, 1]],
  35: [[], [.71, .5, .4, .2, .5], [], [1, .55, .65, .4, .35], [], [.43, .48, .2, .7, .2], [], [.86, .52, .8, .5, .65]],
  36: [[], [.6, .04, .1, 0], [], [.45, .1, .3, .05], [], [.7, .2, .6, .12], [], [.55, .08, .4, .2]],
  // Keep algorithm comparisons matched in every added slot.
  37: [[], [], [], [], [], [], [], []],
  38: [[], [], [], [], [0, .85, .1, 1], [1, 1, .15, 1], [.4, .7, .25, 1], [1, 1, .4, .7]],
};

function method(engineId, id, label, group, description, legacyControls, presets, extra = {}) {
  const playStyle = extra.playStyle || 'hold';
  const added = EXPANSIONS[engineId] || [];
  const controls = legacyControls.map((control, index) => {
    const change = RANGE_MIGRATIONS.find(item => item.engineId === engineId && item.index === index);
    const quantization = engineId === 15 && index === 2 || engineId === 21 && index === 1 ? 'floor' : control.quantization;
    return { ...control, ...(change?.next || {}), ...(quantization ? { quantization } : {}) };
  });
  const defaultParams = Array(PARAMETER_COUNT).fill(0);
  legacyControls.forEach((control, index) => { defaultParams[index] = migrateLegacyParameter(engineId, index, presets[0].params[index]); });
  added.forEach(control => { controls[control.index] = control; defaultParams[control.index] = control.defaultNormalized; });
  const expandedPresets = presets.map((preset, presetIndex) => {
    const params = [...defaultParams];
    preset.params.forEach((value, index) => { params[index] = migrateLegacyParameter(engineId, index, value); });
    (PRESET_EXTENSIONS[engineId]?.[presetIndex] || []).forEach((value, index) => {
      params[legacyControls.length + index] = value;
    });
    for (const [index, physical] of Object.entries(PRESET_RANGE_OVERRIDES[engineId]?.[presetIndex] || {})) {
      params[index] = normalizedParameter(controls[index], physical);
    }
    return { ...audiblePreset(id, controls, preset, params), levelTrimDb: PRESET_LEVEL_TRIMS_DB[`${id}/${preset.id}`] ?? 0 };
  });
  return { engineId, id, label, group, description, principle: description,
    lineage: extra.lineage || 'Roads 1996: synthesis and analysis–resynthesis families.',
    citation: SOURCES[extra.source || 'roads'], playStyle,
    triggerLabel: playStyle === 'strike' ? 'Strike' : 'Hold note', sourceInput: false,
    controls, defaultParams, presets: expandedPresets, referenceLevelTrimDb: METHOD_LEVEL_TRIMS_DB[id] ?? 0, ...extra, ...TEACHING_DATA[id],
  };
}
// New banks are authored in physical units; conversion uses the same UI contract.
function np(engineId, name, values, frequencyHz, envelope, cue, stableId) {
  const controls = EXPANSIONS[engineId];
  for (const id of Object.keys(values)) {
    if (!controls.some(control => control.id === id)) throw new Error(`Unknown parameter ${engineId}:${id}`);
  }
  const params = controls.map(control => Object.hasOwn(values, control.id)
    ? normalizedParameter(control, values[control.id]) : control.defaultNormalized);
  return p(name, params, frequencyHz, envelope, cue, stableId);
}

const LEGACY_METHODS = freeze([
  method(0, 'sampling', 'Sampling / sample playback', 'Sample and grain synthesis', 'Read a stored sound at a controllable rate; position, loop length and direction expose its changing contents.',
    [c('Position'), c('Loop length', .03, 1), c('Rate variation'), choice('Direction', ['Forward', 'Reverse'])], [
      p('Whole phrase', [.03, 1, 0, 0], 220, 'hold', 'Hear the complete source before shortening its loop.'),
      p('Tiny bright loop', [.1, .025, 0, 0], 307, 'hold', 'A short segment becomes a repeating pitched texture.'),
      p('Backward bloom', [.08, .82, .1, 1], 173, 'swell', 'Reversed source detail rises into the envelope.'),
      p('Low tape drift', [.25, .66, .85, 0], 73, 'long', 'Slow playback and rate movement soften the source.'),
      p('Middle fragment', [.45, .15, .05, 0], 220, 'pluck', 'A brief interior detail repeats under a plucked envelope.'),
      p('Late shimmer', [.81, .09, .48, 0], 593, 'pad', 'A late fragment turns into a high sustained texture.'),
      p('Reverse tick', [.58, .02, 0, 1], 431, 'tap', 'A tiny reversed slice makes a sharp transient.'),
      p('Wavering ribbon', [.34, .38, 1, 1], 147, 'reed', 'A medium reverse loop bends continuously in rate.'),
    ], { sourceInput: true }),
  method(1, 'wavetable', 'Wavetable synthesis', 'Oscillators and waveform construction', 'An oscillator reads a stored single-cycle waveform; shape and interpolation determine its harmonic spectrum.',
    [c('Shape'), c('Brightness'), c('Pulse width', .05, .95), c('Interpolation')], [
      p('Round fundamental', [0, .2, .5, 1], 220, 'hold', 'A nearly sinusoidal reference for the spectrum display.'),
      p('Soft triangle', [.33, .18, .5, 1], 177, 'pad', 'Weak upper harmonics and a slow onset.'),
      p('Bright saw', [.67, .95, .5, 1], 127, 'bass', 'A full harmonic series with a direct attack.'),
      p('Hollow square', [1, .7, .5, 1], 283, 'reed', 'Odd harmonics give a hollow held tone.'),
      p('Narrow pulse', [1, 1, .08, 1], 191, 'pluck', 'A narrow duty cycle emphasizes a buzzy spectrum.'),
      p('Stepped high note', [.69, .87, .5, 0], 1387, 'hold', 'Nearest-point reads expose the table steps.'),
      p('Muted saw cloud', [.61, .05, .5, .88], 94, 'swell', 'Brightness rolls back while the waveform remains saw-like.'),
      p('Wide pulse tap', [.93, .8, .87, .65], 479, 'tap', 'Pulse asymmetry changes the spectral gaps.'),
    ]),
  method(2, 'additive', 'Additive synthesis', 'Additive and spectral synthesis', 'Eight weighted sine partials form a spectrum. Stretch, tilt, detune and motion extend the harmonic reference; zeroing a partial removes that component.',
    Array.from({ length: 8 }, (_, i) => c(`Partial ${i + 1}`)), [
      p('Single sine', [1, 0, 0, 0, 0, 0, 0, 0], 220, 'hold', 'Only the fundamental appears in the spectrum.'),
      p('Eight-part saw', [1, .5, .333, .25, .2, .167, .143, .125], 139, 'reed', 'The one-over-harmonic amplitude law approaches a saw.'),
      p('Odd clarinet', [1, 0, .44, 0, .24, 0, .14, 0], 207, 'reed', 'Only odd partials remain.'),
      p('Missing fundamental', [0, 1, .8, .6, .3, .18, .1, .08], 127, 'hold', 'The ear may infer a pitch with no fundamental energy.'),
      p('High organ stops', [.25, .02, .03, .8, .02, .3, .02, .95], 173, 'hold', 'Octave-related upper partials dominate.'),
      p('Two-part beatless bell', [.5, 0, 0, 0, .9, 0, .35, 0], 311, 'bell', 'Widely separated harmonic components ring together.'),
      p('Even hollow stack', [0, 1, 0, .7, 0, .5, 0, .3], 107, 'pad', 'Even-only components move the perceived fundamental up.'),
      p('Upper cluster strike', [.08, .04, .03, .05, .72, 1, .83, .64], 263, 'tap', 'A compact group of upper harmonics makes a bright click.'),
    ]),
  method(3, 'walsh', 'Walsh-function synthesis', 'Oscillators and waveform construction', 'Weighted rectangular basis functions construct a waveform; their sequency counts sign changes instead of sinusoidal frequency.',
    [integer('Basis order', 1, 16), c('Odd / even'), integer('Sequency', 1, 8), c('Smoothing')], [
      p('Binary reed', [.08, 0, .04, .15], 181, 'reed', 'A small rectangular basis set makes a firm reed-like tone.'),
      p('Soft binary flute', [.15, .12, .1, .95], 397, 'swell', 'Smoothing rounds the rectangular steps.'),
      p('Checker buzz', [.9, .5, .86, .05], 117, 'hold', 'Many rapid sign changes generate a dense bright spectrum.'),
      p('Even ladder', [.4, 1, .28, .1], 223, 'hold', 'Even basis weighting shifts the pattern of partials.'),
      p('Odd staircase', [.48, 0, .58, .2], 157, 'bass', 'Odd weighting produces a different stepped waveform.'),
      p('Clock tick', [1, .9, 1, 0], 787, 'tap', 'High sequency and an abrupt envelope make a digital tick.'),
      p('Muffled blocks', [.75, .75, .72, .85], 83, 'pad', 'High-order detail survives beneath a softened edge.'),
      p('Broken organ', [.25, .35, .44, .4], 307, 'long', 'Intermediate basis weights yield an uneven organ spectrum.'),
    ]),
  method(4, 'multiple-wavetable', 'Multiple-wavetable / vector synthesis', 'Oscillators and waveform construction', 'Crossfade four stored waveforms with two coordinates, then detune and drift the layers.',
    [c('Vector X'), c('Vector Y'), c('Detune', 0, 40, 'cents'), c('Drift')], [
      p('Pure corner', [0, 0, 0, 0], 220, 'hold', 'One corner isolates a reference waveform.'),
      p('Opposite corner', [1, 1, 0, 0], 220, 'hold', 'The opposite corner changes timbre at the same pitch.'),
      p('Center blend', [.5, .5, .1, 0], 173, 'reed', 'All four sources contribute to one spectrum.'),
      p('Slow vector cloud', [.2, .8, .32, .9], 107, 'pad', 'Drift moves the blend while detuning makes slow beating.'),
      p('Wide detuned stack', [.78, .22, 1, .05], 149, 'swell', 'Large detuning spreads otherwise stable layers.'),
      p('Lean edge pluck', [.8, 0, 0, .08], 337, 'pluck', 'An edge crossfade limits the blend to two sources.'),
      p('Drifting upper voices', [.3, .55, .56, 1], 577, 'long', 'Bright upper layers move and beat over a long release.'),
      p('Dry vector bass', [.92, .66, .04, 0], 61, 'bass', 'A nearly stationary dense blend makes a compact bass.'),
    ]),
  method(5, 'wave-terrain', 'Wave-terrain synthesis', 'Oscillators and waveform construction', 'Trace a two-dimensional orbit across a mathematical surface and read its height as audio.',
    [c('X radius', .05, 1), c('Y radius', .05, 1), c('Path ratio', .25, 4, '×'), c('Terrain height')], [
      p('Small round orbit', [.12, .12, .2, .18], 220, 'hold', 'A small balanced orbit samples a gentle region.'),
      p('Wide rough orbit', [.95, .85, .2, .95], 157, 'hold', 'A large path crosses more surface detail.'),
      p('Horizontal thread', [1, .01, .2, .8], 293, 'reed', 'Flattening the orbit changes which terrain features are read.'),
      p('Vertical thread', [.01, 1, .2, .8], 293, 'reed', 'Rotate the flattened path by exchanging the radii.'),
      p('Uneven orbit bell', [.67, .4, .39, .72], 197, 'bell', 'An unequal path ratio introduces complex beating.'),
      p('Slow valley', [.3, .6, .02, .32], 73, 'pad', 'A slow secondary traversal broadens the low texture.'),
      p('Fast ridge chatter', [.82, .93, .97, 1], 397, 'tap', 'A fast secondary traversal adds rapid high detail.'),
      p('Soft elliptical reed', [.37, .78, .47, .1], 251, 'swell', 'A smooth surface and elliptical orbit keep the edges soft.'),
    ]),
  method(6, 'granular', 'Granular synthesis', 'Sample and grain synthesis', 'Overlap short windowed source fragments. Grain duration, density, position spread and transposition control the texture.',
    [c('Grain size', 8, 200, 'ms'), c('Density', 2, 80, '/s'), c('Position spray'), c('Pitch spread', 0, 24, 'st')], [
      p('Sparse grains', [.65, .02, .1, 0], 220, 'hold', 'Separated fragments expose individual grain envelopes.'),
      p('Frozen cloud', [.9, .82, 0, .02], 220, 'pad', 'Long overlapping grains blur into a stable texture.'),
      p('Fine sand', [.01, .94, .88, .15], 347, 'hold', 'Very short scattered grains become noisy and bright.'),
      p('Pitch constellation', [.35, .45, .2, 1], 181, 'long', 'Wide grain transposition separates a cloud into many pitches.'),
      p('Low scattered tape', [.82, .16, 1, .2], 83, 'reed', 'Long grains jump across the source at low playback pitch.'),
      p('Needle shower', [0, 1, .4, .8], 593, 'tap', 'Tiny dense high grains make a sharp burst.'),
      p('Overlapping flutter', [.18, .32, .08, .05], 257, 'hold', 'Moderate density leaves a fluttering grain rhythm.'),
      p('Broad evolving mist', [.7, .72, .92, .62], 137, 'swell', 'Position and pitch spread continually vary the overlap.'),
    ], { sourceInput: true }),
  method(7, 'subtractive', 'Subtractive synthesis', 'Filtering and source–filter synthesis', 'A resonant low-pass filter removes harmonics from an oscillator and noise mixture.',
    [hz('Cutoff', 80, 16000, 'log'), c('Resonance'), c('Wave shape'), c('Noise')], [
      p('Muted saw bass', [.28, .12, .55, 0], 73, 'bass', 'A low cutoff removes the saw source’s upper partials.'),
      p('Open saw lead', [.9, .1, .5, 0], 197, 'reed', 'An open filter exposes almost the whole source spectrum.'),
      p('Resonant whistle', [.47, .95, .6, .03], 173, 'hold', 'High resonance emphasizes a narrow band near cutoff.'),
      p('Hollow pulse', [.62, .3, 1, 0], 263, 'hold', 'Pulse harmonics pass through a moderate resonant filter.'),
      p('Breathing noise', [.38, .42, .2, .96], 220, 'swell', 'Filtered noise forms a broad breath-like band.'),
      p('Bright hat', [.96, .1, 0, 1], 811, 'tap', 'A short envelope turns high-frequency noise into percussion.'),
      p('Low wind', [.12, .64, .1, 1], 53, 'pad', 'A low resonant cutoff shapes a sustained noise bed.'),
      p('Soft sine body', [.72, 0, 0, 0], 331, 'pluck', 'A simple source stays pure despite an open cutoff.'),
    ]),
  method(8, 'lpc', 'Linear predictive coding (LPC)', 'Filtering and source–filter synthesis', 'An analyzed all-pole model filters voiced or noisy excitation; analysis scale moves the modeled spectral envelope.',
    [c('Model / vowel'), c('Breath'), c('Analysis spectral scale', .65, 1.7, '×'), c('Excitation shape')], [
      p('Dark voiced model', [.02, .02, .82, 0], 137, 'reed', 'A low-brightness source excites the first spectral model.'),
      p('Bright voiced model', [.85, .03, .35, .8], 197, 'reed', 'Another model and a different analysis scale shift the formants.'),
      p('Whispered model', [.38, 1, .5, 0], 220, 'swell', 'Noise excitation keeps the model’s spectral envelope.'),
      p('Breathy alto', [.58, .45, .52, .25], 283, 'hold', 'Voiced and noise excitation mix under one model.'),
      p('Raised spectral model', [.23, .1, 1, .8], 83, 'long', 'Faster source analysis raises the modeled resonances.', 'long-tract'),
      p('Lower spectral chirp', [.72, .05, 0, .9], 593, 'pluck', 'Slower source analysis lowers the modeled resonances.', 'short-tract-chirp'),
      p('Hissed consonant', [.94, .97, .12, .4], 397, 'tap', 'A high, noisy spectral model becomes a brief hiss.'),
      p('Rough pulse voice', [.46, .2, .68, 1], 163, 'hold', 'A richer periodic excitation emphasizes the model poles.'),
    ], { sourceInput: true, lineage: 'Roads 1996: linear prediction and source–filter analysis–resynthesis. Default models are synthetic teaching sources.' }),
  method(9, 'am', 'Amplitude modulation (AM)', 'Modulation and phase shaping', 'Multiply a carrier by a biased modulator. Modulator ratio and depth move energy into sidebands.',
    [c('Frequency ratio', .1, 12, '×'), c('Depth'), c('Modulator shape'), c('Bias')], [
      p('Dry carrier', [.076, 0, 0, 1], 220, 'hold', 'Zero depth leaves the carrier as a reference.'),
      p('Deep harmonic tremor', [.076, 1, 0, .8], 173, 'hold', 'A one-to-one modulator creates harmonic sidebands.'),
      p('Slow tremolo edge', [0, .88, 0, .7], 37, 'hold', 'Low absolute modulation frequency approaches audible tremolo.'),
      p('Inharmonic chime', [.19, .96, 0, .35], 311, 'bell', 'A noninteger ratio separates the sidebands from the harmonic series.'),
      p('Square shutter', [.16, .95, 1, .55], 149, 'reed', 'A rectangular modulator contributes many sideband pairs.'),
      p('High sideband spray', [.94, .95, .75, .2], 263, 'tap', 'A fast rich modulator disperses energy across high frequencies.'),
      p('Biased soft pad', [.04, .28, .2, 1], 113, 'pad', 'A strong bias preserves the carrier under gentle modulation.'),
      p('Carrier-thin metal', [.37, 1, .18, 0], 227, 'pluck', 'Low bias suppresses the central carrier relative to its sidebands.'),
    ]),
  method(10, 'ring', 'Ring modulation', 'Modulation and phase shaping', 'Multiply two bipolar signals to produce sum and difference frequencies; offset restores a carrier component.',
    [c('Frequency ratio', .1, 12, '×'), c('Carrier shape'), c('Modulator shape'), c('Offset')], [
      p('Two sine sidebands', [.16, 0, 0, 0], 220, 'hold', 'Two sinusoidal inputs produce a simple sum/difference pair.'),
      p('Near-unison beating', [.079, 0, 0, 0], 317, 'long', 'A near-unison modulator creates a very low difference tone.'),
      p('Clanging pair', [.238, .06, 0, 0], 197, 'bell', 'An inharmonic ratio produces an exposed metallic pair.'),
      p('Saw carrier metal', [.29, 1, 0, 0], 131, 'reed', 'Each saw harmonic creates its own sideband pair.'),
      p('Square modulator gong', [.41, .1, 1, 0], 101, 'bell', 'A rich modulator multiplies the number of partials.'),
      p('Carrier restored', [.18, .6, .28, 1], 251, 'hold', 'Offset adds the carrier back into the ring-modulated spectrum.'),
      p('Radio splinter', [.96, .9, .95, .04], 683, 'tap', 'Fast complex inputs create a dense short metallic burst.'),
      p('Low difference drone', [.025, .38, .22, .3], 79, 'pad', 'A low ratio builds a slowly evolving low-register texture.'),
    ]),
  method(11, 'fm', 'Frequency modulation (FM)', 'Modulation and phase shaping', 'A modulator changes instantaneous oscillator frequency. Index controls sideband width; feedback and an index envelope change its evolution.',
    [c('Frequency ratio', .1, 12, '×'), c('Index', 0, 16, ''), c('Feedback'), c('Index envelope')], [
      p('Pure starting tone', [.076, 0, 0, 0], 220, 'hold', 'Zero index is the unmodulated carrier.'),
      p('Brass swell', [.076, .22, .05, .35], 173, 'swell', 'A harmonic ratio opens a compact bright spectrum.'),
      p('Electric tine', [.244, .18, 0, .94], 307, 'bell', 'An evolving modulation index gives a bright attack and purer tail.'),
      p('Inharmonic bell', [.279, .39, .02, .55], 197, 'bell', 'A noninteger ratio produces inharmonic ringing partials.'),
      p('Feedback reed', [.076, .1, .65, .08], 149, 'reed', 'Feedback thickens a modest-index harmonic tone.'),
      p('Metal burst', [.72, .93, .2, 1], 263, 'tap', 'A large fast index produces a brief wide spectrum.'),
      p('Low growling wire', [.043, .62, .84, .18], 61, 'hold', 'Subharmonic modulation and feedback roughen the low voice.'),
      p('Glass thread', [.58, .035, 0, .2], 683, 'long', 'A small index places faint sidebands far from the carrier.'),
    ]),
  method(12, 'pm', 'Phase modulation (PM)', 'Modulation and phase shaping', 'Displace oscillator phase with another signal. Depth, waveform and feedback determine the new sidebands.',
    [c('Frequency ratio', .1, 12, '×'), c('Phase depth', 0, 8, 'rad'), c('Feedback'), c('Modulator shape')], [
      p('Plain phase reference', [.076, 0, 0, 0], 220, 'hold', 'With no phase displacement, only the carrier remains.'),
      p('Harmonic phase reed', [.16, .25, .05, 0], 181, 'reed', 'A near-integer ratio generates a harmonic sideband pattern.'),
      p('Glass phase bell', [.291, .42, 0, .05], 311, 'bell', 'An inharmonic ratio gives widely spaced ringing components.'),
      p('Bent triangle', [.076, .63, .04, .5], 233, 'pluck', 'Changing modulator shape changes phase motion within each cycle.'),
      p('Square phase teeth', [.35, .82, .04, 1], 137, 'hold', 'Sharp phase motion adds a dense hard spectrum.'),
      p('Feedback grit', [.103, .38, .85, .2], 89, 'bass', 'Feedback adds roughness to a low phase-modulated note.'),
      p('Fine upper glints', [.9, .08, 0, .18], 733, 'long', 'Small depth creates faint distant sidebands.'),
      p('Deep phase cloud', [.213, 1, .38, .66], 173, 'pad', 'Large phase displacement spreads energy over many components.'),
    ]),
  method(13, 'phase-distortion', 'Phase-distortion synthesis', 'Modulation and phase shaping', 'Warp the oscillator’s phase ramp before waveform lookup; a breakpoint and resonant shaping control the harmonic contour.',
    [c('Breakpoint', .02, .98), c('Distortion amount'), c('Resonance', 1, 8, '×'), c('Pulse character')], [
      p('Unbent reference', [.5, 0, 0, 0], 220, 'hold', 'Zero distortion exposes the source oscillator.'),
      p('Sawward bend', [.08, .85, 0, 0], 163, 'reed', 'An early breakpoint sharply compresses one part of the cycle.'),
      p('Late bend', [.92, .85, 0, 0], 163, 'reed', 'Moving the breakpoint to the other side changes the wave shape.'),
      p('Resonant synthetic vowel', [.27, .8, .5, .15], 197, 'hold', 'Resonant shaping concentrates energy above the fundamental.'),
      p('Thin pulse pluck', [.05, 1, .16, 1], 283, 'pluck', 'Pulse character and a strong bend produce a sharp twang.'),
      p('Soft bent pad', [.38, .25, .1, .1], 107, 'pad', 'A mild warp adds upper harmonics without a hard edge.'),
      p('High resonant click', [.18, .96, 1, .8], 557, 'tap', 'A high resonance makes a compact bright transient.'),
      p('Low elastic bass', [.74, .65, .3, .65], 67, 'bass', 'An asymmetric phase contour adds weight and bite.'),
    ]),
  method(14, 'waveshaping', 'Waveshaping', 'Nonlinear waveshaping', 'Apply a nonlinear transfer curve to each sample. Drive, folding and asymmetry create new harmonics.',
    [c('Drive', 1, 12, '×'), c('Fold'), bipolar('Asymmetry'), c('Transfer shape')], [
      p('Gentle saturation', [.02, 0, .5, 1], 220, 'hold', 'Low drive rounds peaks gently.'),
      p('Hard odd harmonics', [.72, 0, .5, 1], 149, 'reed', 'Symmetric saturation favors odd harmonic growth.'),
      p('Biased even harmonics', [.4, 0, .83, 1], 149, 'reed', 'Asymmetry introduces even harmonic content.'),
      p('Folded sine lead', [.53, .9, .5, 0], 233, 'hold', 'Folding turns amplitude excursions into extra waveform reversals.'),
      p('Metallic fold strike', [1, 1, .7, .12], 311, 'tap', 'Many folds create a dense bright transient.'),
      p('Soft biased pad', [.1, .08, .3, .8], 97, 'pad', 'Mild asymmetric shaping adds warmth under a slow envelope.'),
      p('Crushed bass', [.92, .18, .55, 1], 59, 'bass', 'Strong saturation gives a broad low-register spectrum.'),
      p('Sine transfer chime', [.28, .3, .15, 0], 479, 'bell', 'A periodic transfer curve produces a different harmonic pattern.'),
    ]),
  method(15, 'dsf', 'Discrete summation formulas (DSF)', 'Additive and spectral synthesis', 'A compact summation produces regularly spaced partials with a geometric amplitude rolloff.',
    [c('Partial spacing', .25, 4, '×'), c('Rolloff', 0, .98), integer('Partial count', 1, 48), c('Odd / even')], [
      p('Single partial', [.2, .5, 0, .5], 220, 'hold', 'One component isolates the base oscillator.'),
      p('Falling harmonic comb', [.2, .54, .45, .5], 173, 'reed', 'Geometric rolloff forms a regular harmonic comb.'),
      p('Bright full comb', [.2, .98, 1, .5], 97, 'hold', 'Many nearly equal partials sharpen the waveform.'),
      p('Wide metal spacing', [.73, .85, .55, .5], 233, 'bell', 'Wide noninteger spacing makes an inharmonic ringing comb.'),
      p('Tight partial cluster', [0, .83, .65, .8], 311, 'pad', 'Small spacing packs components close together.'),
      p('Odd-focused reed', [.2, .75, .38, 0], 197, 'reed', 'Odd/even weighting hollows out the harmonic distribution.'),
      p('Even comb pluck', [.46, .9, .23, 1], 137, 'pluck', 'Alternate partial emphasis changes the perceived center.'),
      p('Thin high spray', [1, .62, .96, .25], 683, 'tap', 'Wide spacing and a short envelope expose distant upper components.'),
    ]),
  method(16, 'physical', 'Physical modeling: mass–spring', 'Physical models and resonators', 'Excite a coupled mass–spring system. Coupling, damping, strike position and mass distribution determine its vibration.',
    [c('Stiffness'), c('Damping'), c('Strike position'), c('Mass gradient')], [
      p('Balanced elastic bar', [.4, .2, .4, 0], 173, 'bell', 'An even mass distribution gives a coherent coupled response.'),
      p('Soft heavy spring', [.04, .3, .5, .7], 61, 'pluck', 'Weak coupling and unequal masses make a low elastic response.'),
      p('Rigid bright bar', [.98, .08, .13, .1], 347, 'bell', 'Strong coupling and low damping extend bright vibration.'),
      p('Damped wooden tap', [.55, .9, .24, .15], 197, 'tap', 'High damping removes the ringing tail.'),
      p('Center strike', [.6, .2, .5, .05], 233, 'bell', 'A central strike excites a different set of motions.'),
      p('Edge strike', [.6, .2, .02, .05], 233, 'bell', 'A near-end strike and light damping reveal the elastic body.'),
      p('Uneven mass chime', [.7, .05, .35, 1], 283, 'long', 'A steep mass gradient separates the vibration rates.'),
      p('Rubbery short knock', [.15, .65, .72, .6], 107, 'pluck', 'A soft uneven system sheds its motion quickly.'),
    ], { playStyle: 'strike', lineage: 'Roads 1996 physical modeling. A small coupled numerical teaching model, not a calibrated material simulation.' }),
  method(17, 'modal', 'Modal synthesis', 'Physical models and resonators', 'A strike excites a bank of damped resonant modes; mode spacing and excitation weights determine material-like color.',
    [c('Inharmonicity'), c('Modal decay', .15, 8, 's'), c('Strike position'), c('Brightness')], [
      p('Harmonic resonator', [0, .3, .45, .45], 173, 'bell', 'Harmonically related modes resemble a pitched resonator.'),
      p('Metal plate', [.9, .7, .15, .95], 233, 'bell', 'Inharmonic bright modes sustain a metallic tail.'),
      p('Dry wooden block', [.48, .015, .64, .23], 397, 'tap', 'Short low-brightness modes make a compact knock.'),
      p('Long glass ring', [.64, 1, .25, .6], 593, 'long', 'Long-lived inharmonic modes overlap in the high register.'),
      p('Dark low gong', [.95, .9, .46, .12], 61, 'bell', 'Low dark modes keep a long, uneven decay.'),
      p('Edge-bright chime', [.3, .52, .02, 1], 311, 'bell', 'An edge-like strike emphasizes upper modes.'),
      p('Center-muted chime', [.3, .52, .5, .35], 311, 'pluck', 'Moving the excitation changes the modal balance.'),
      p('Tiny ceramic tick', [.72, .05, .9, .85], 1021, 'tap', 'A high short inharmonic bank makes a hard tick.'),
    ], { playStyle: 'strike', lineage: 'Roads 1996 physical modeling and modal synthesis. Mode ratios are teaching controls, not measured objects.' }),
  method(18, 'waveguide', 'Digital waveguide / nonlinear excitation', 'Physical models and resonators', 'A nonlinear reed-like exciter feeds a lossy delay loop representing wave travel through a resonator.',
    [c('Pressure'), c('Reed stiffness'), c('Loss'), c('Bore character')], [
      p('Gentle reed', [.48, .4, .32, .3], 173, 'reed', 'Moderate pressure sustains a restrained nonlinear tone.'),
      p('Overblown edge', [.84, .50, .12, .45], 283, 'hold', 'High pressure makes the excitation more nonlinear.'),
      p('Soft breathy pipe', [.60, .30, .48, .08], 397, 'swell', 'Low pressure and high losses soften the resonance.'),
      p('Dark long bore', [.55, .35, .45, .95], 73, 'reed', 'A low fundamental and different bore character darken the voice.'),
      p('Stiff nasal reed', [.68, .70, .25, .2], 223, 'hold', 'A stiff exciter changes the harmonic balance.'),
      p('Leaky short puff', [.78, .3, .62, .6], 137, 'pluck', 'Lossy feedback shortens and roughens the puff.'),
      p('Clear pipe line', [.60, .50, .06, 0], 593, 'long', 'Low losses preserve a clearer sustained resonance.'),
      p('Ragged bass reed', [.84, .30, .4, 1], 53, 'bass', 'Strong drive and a soft exciter create a rough low response.'),
    ], { lineage: 'Roads 1996 digital waveguides and McIntyre–Schumacher–Woodhouse excitation–resonator lineage. A bounded reed-like teaching model.' }),
  method(19, 'karplus-strong', 'Karplus–Strong synthesis', 'Physical models and resonators', 'An excitation burst circulates through a filtered delay loop; losses and pick position shape the decaying string-like tone.',
    [c('Damping'), c('Decay', .15, 8, 's'), c('Pick position', .02, .98), c('Excitation color')], [
      p('Natural string pluck', [.32, .38, .22, .6], 173, 'bell', 'A moderate filtered loop gives a familiar plucked decay.'),
      p('Palm-muted string', [.92, .03, .2, .42], 107, 'tap', 'Strong damping removes the bright tail quickly.'),
      p('Bright bridge pluck', [.1, .52, .02, 1], 283, 'bell', 'A near-end pick emphasizes a bright harmonic comb.'),
      p('Hollow center pluck', [.3, .5, .5, .65], 283, 'bell', 'A central pick suppresses part of the harmonic series.'),
      p('Long wire', [.03, 1, .12, .95], 397, 'long', 'Small losses sustain a thin bright loop.'),
      p('Soft low string', [.65, .25, .4, .1], 53, 'pluck', 'A dark excitation and damping make a round low pluck.'),
      p('Noisy short rattle', [.13, .07, .72, 1], 83, 'tap', 'A bright noisy excitation dominates the short response.'),
      p('High harmonic pin', [.2, .63, .84, .85], 947, 'bell', 'A high register exposes the delay loop’s sparse upper harmonics.'),
    ], { playStyle: 'strike' }),
  method(20, 'fof', 'FOF / CHANT formant synthesis', 'Formant and pulse synthesis', 'Overlap short enveloped sinusoidal bursts at a fundamental rate; burst frequency and damping define formants.',
    [hz('Formant', 200, 4000), hz('Bandwidth', 30, 600), c('Grain decay span', 3, 8, 'τ'), c('Second formant')], [
      p('Open low vowel', [.14, .18, .5, .35], 137, 'reed', 'A low formant shapes the pulse train into a vowel-like tone.'),
      p('Bright upper vowel', [.63, .17, .7, .9], 223, 'hold', 'High formants concentrate energy far above the pitch.'),
      p('Narrow singing band', [.32, .01, 1, .08], 173, 'long', 'Narrow bandwidth allows longer resonant bursts.'),
      p('Breathy broad formant', [.38, .95, .3, .48], 197, 'swell', 'Broad bandwidth spreads the formant across more harmonics.'),
      p('Separated vocal pulses', [.22, .5, 0, .1], 43, 'hold', 'Low pitch and little overlap reveal individual bursts.'),
      p('Dual-formant choir', [.21, .22, .8, 1], 283, 'pad', 'Two formant regions share a smooth slow envelope.'),
      p('Nasal short chirp', [.78, .13, .18, .65], 479, 'pluck', 'A high narrow formant makes a concentrated chirp.'),
      p('Dark formant thud', [0, .7, .06, 0], 61, 'tap', 'A short broad low formant makes a percussive pulse.'),
    ]),
  method(21, 'vosim', 'VOSIM', 'Formant and pulse synthesis', 'Repeat groups of damped sine-squared pulses separated by silence; pulse frequency gives a formant independently of the group rate.',
    [hz('Formant', 200, 4000), integer('Pulses', 1, 8), c('Damping'), c('Silence')], [
      p('Rounded pulse voice', [.2, .4, .45, .2], 173, 'reed', 'A short pulse group makes a concentrated vocal-like spectrum.'),
      p('Single pulse whistle', [.47, 0, .1, .05], 397, 'hold', 'One pulse per group exposes the basic pulse shape.'),
      p('Long ringing packet', [.36, 1, .02, .15], 137, 'long', 'Many weakly damped pulses sharpen the formant.'),
      p('Damped packet knock', [.18, .6, .97, .2], 107, 'tap', 'Strong within-group damping makes the first pulses dominate.'),
      p('Gapped vocal rhythm', [.26, .45, .35, .95], 41, 'hold', 'Long silent gaps reveal the group repetition.'),
      p('Bright nasal packet', [.9, .72, .32, .55], 233, 'reed', 'A high packet frequency moves the formant upward.'),
      p('Smooth dense buzz', [.31, .85, .17, 0], 283, 'pad', 'Minimal silence packs the pulse groups closely together.'),
      p('Tiny hard syllable', [.75, .12, .8, .8], 683, 'pluck', 'A short bright pulse group behaves like a clipped syllable.'),
    ]),
  method(22, 'window-formant', 'Window-function formant synthesis', 'Formant and pulse synthesis', 'Window a sinusoidal carrier once per fundamental cycle; the window’s duration and skew shape its formant band.',
    [hz('Formant', 200, 4000), c('Window width'), c('Window skew'), c('Second formant')], [
      p('Rounded vowel window', [.19, .6, .5, .3], 173, 'reed', 'A moderate symmetric window gives a broad vocal-like band.'),
      p('Narrow spectral band', [.41, 1, .5, .03], 223, 'long', 'A longer time window narrows the formant bandwidth.'),
      p('Short broad burst', [.41, .02, .5, .03], 223, 'tap', 'A short window spreads the same formant into a wide band.'),
      p('Early skewed voice', [.26, .6, 0, .45], 137, 'hold', 'An early-skewed window changes the pulse shape and spectrum.'),
      p('Late skewed voice', [.26, .6, 1, .45], 137, 'hold', 'The opposite skew reverses the within-cycle emphasis.'),
      p('High double formant', [.79, .75, .35, 1], 347, 'swell', 'A second formant enriches the upper spectrum.'),
      p('Low window drum', [0, .13, .25, .05], 53, 'pluck', 'A broad low formant under a short envelope makes a drum-like pulse.'),
      p('Airy formant pad', [.54, .25, .72, .78], 197, 'pad', 'Wide dual bands and a slow envelope blur the pulse edges.'),
    ]),
  method(23, 'waveform-segment', 'Waveform-segment synthesis', 'Oscillators and waveform construction', 'Construct each cycle from shaped segments joined at a movable breakpoint, with optional step quantization.',
    [c('Breakpoint', .05, .95), bipolar('Segment level'), c('Curvature'), integer('Steps', 2, 32)], [
      p('Balanced bent ramp', [.5, .5, .3, 1], 220, 'hold', 'A centered join produces a balanced segmented wave.'),
      p('Early peak', [.03, 1, .1, 1], 173, 'reed', 'A short rising segment gives a sharp asymmetric waveform.'),
      p('Late trough', [.94, 0, .1, 1], 173, 'reed', 'The join shifts near the end of the cycle.'),
      p('Two-step square', [.5, .92, 0, 0], 127, 'bass', 'Coarse quantization reduces the shape to large steps.'),
      p('Curved soft segment', [.37, .7, 1, .95], 307, 'pad', 'High curvature softens the segment transitions.'),
      p('Stepped staircase', [.23, .87, .35, .2], 233, 'hold', 'A few steps introduce a visibly terraced waveform.'),
      p('Thin segment tick', [.01, .97, .85, .55], 733, 'tap', 'A narrow strong segment gives a bright short click.'),
      p('Uneven low ramp', [.74, .18, .6, .73], 67, 'pluck', 'An off-center negative join makes an uneven low-register cycle.'),
    ]),
  method(24, 'graphic', 'Graphic waveform synthesis', 'Oscillators and waveform construction', 'Eight editable sample points define one waveform cycle. Moving a point changes the interpolated shape and its harmonics.',
    Array.from({ length: 8 }, (_, i) => bipolar(`Point ${i + 1}`)), [
      p('Drawn sine', [.5, .854, 1, .854, .5, .146, 0, .146], 220, 'hold', 'Eight samples outline a smooth sinusoidal cycle.'),
      p('Drawn triangle', [.5, .75, 1, .75, .5, .25, 0, .25], 173, 'reed', 'Straight-sided rise and fall give a softer odd-harmonic tone.'),
      p('Drawn ramp', [0, .143, .286, .429, .571, .714, .857, 1], 127, 'bass', 'The wrap from the last point to the first sharpens the ramp.'),
      p('Drawn pulse', [1, 1, 1, .9, 0, 0, 0, .1], 197, 'hold', 'High and low plateaus make a pulse-like wave.'),
      p('Single positive spike', [.5, .5, 1, .5, .5, .5, .5, .5], 311, 'pluck', 'One displaced point produces a narrow peak per cycle.'),
      p('Double hill', [.5, 1, .5, 0, .5, .85, .5, .15], 149, 'pad', 'Two hills emphasize the second harmonic.'),
      p('Jagged contour', [.91, .13, .72, .35, 1, .01, .59, .24], 263, 'tap', 'Uneven alternating points produce a dense bright shape.'),
      p('Asymmetric bowl', [.2, .1, .05, .12, .3, .83, .97, .65], 83, 'long', 'A broad trough and narrow crest add asymmetric harmonic content.'),
    ]),
  method(25, 'noise-modulation', 'Noise modulation', 'Noise and stochastic synthesis', 'Use correlated random motion to modulate amplitude or frequency; depth and rate move from gentle fluctuation to broadband texture.',
    [c('Depth'), hz('Noise rate', .2, 2000, 'log'), c('Correlation'), c('AM → FM')], [
      p('Slow amplitude breathing', [.35, .02, .95, 0], 220, 'hold', 'Slow correlated noise makes irregular level motion.'),
      p('Random pitch drift', [.12, .05, .95, 1], 173, 'long', 'A shallow slow frequency disturbance bends the pitch.'),
      p('Rough amplitude hiss', [.96, .98, .02, 0], 283, 'hold', 'Fast noise modulation spreads energy around the carrier.'),
      p('Wide frequency fog', [.88, .82, .2, 1], 107, 'pad', 'Deep random frequency motion smears the tonal center.'),
      p('Correlated flutter', [.57, .32, .7, .25], 197, 'reed', 'Intermediate random rate creates uneven flutter.'),
      p('Metal rain burst', [1, 1, 0, .78], 593, 'tap', 'Fast deep modulation makes a bright noisy transient.'),
      p('Nearly stable flute', [.025, .25, .82, .8], 397, 'swell', 'Small depth adds unstable edges to a mostly stable tone.'),
      p('Broken low tremor', [.8, .2, .15, .4], 53, 'bass', 'Coarse irregular movement roughens a low note.'),
    ]),
  method(26, 'stochastic', 'Dynamic stochastic synthesis', 'Noise and stochastic synthesis', 'Random walks move waveform breakpoint heights and durations inside bounds, continually rebuilding the cycle.',
    [c('Amplitude step'), c('Duration step'), { ...integer('Breakpoints', 3, 32), quantization: 'floor' }, c('Distribution')], [
      p('Stable polygon drone', [.015, .01, .24, .5], 173, 'hold', 'Very small random steps retain a nearly fixed polygon.'),
      p('Wandering contour', [.28, .04, .32, .35], 223, 'long', 'Amplitude walks change timbre while durations stay nearly fixed.'),
      p('Elastic pitch cloud', [.06, .7, .2, .6], 107, 'pad', 'Duration walks disturb the cycle timing more strongly.'),
      p('Ragged random reed', [.55, .38, .45, .3], 197, 'reed', 'Both breakpoint dimensions move at moderate depth.'),
      p('Fine noisy polygon', [.9, .63, 1, .95], 293, 'hold', 'Many highly mobile points create a rough detailed spectrum.'),
      p('Three-point lurch', [.75, .82, 0, .05], 73, 'bass', 'A few large moves produce abrupt changes of contour.'),
      p('Stochastic splinter', [1, 1, .85, .85], 683, 'tap', 'Large random steps under a short envelope make a brittle burst.'),
      p('Slow uneven wire', [.13, .18, .1, .9], 137, 'swell', 'A sparse waveform wanders under the selected probability law.'),
    ], { lineage: 'Roads 1996 stochastic waveform synthesis; dynamic stochastic synthesis associated with Iannis Xenakis. A bounded breakpoint random-walk teaching implementation.' }),
  method(27, 'pulsar', 'Pulsar synthesis', 'Formant and pulse synthesis', 'Repeat a windowed pulsaret followed by silence. Duty ratio separates the repetition pitch from the pulsaret’s internal frequency.',
    [c('Duty', .02, 1), c('Pulsaret formant', 1, 12, '×'), c('Scatter'), c('Window')], [
      p('Continuous pulsaret', [1, 0, 0, .5], 220, 'hold', 'Full duty leaves little silence between pulsarets.'),
      p('Narrow buzzing pulse', [.06, .2, 0, .35], 173, 'reed', 'A short duty cycle makes a broad bright formant.'),
      p('Formant whistle', [.36, .72, 0, .75], 197, 'long', 'Internal pulsaret cycles concentrate energy above the repetition rate.'),
      p('Scattered pulse cloud', [.22, .4, .88, .7], 107, 'pad', 'Scatter breaks the regularity of the pulsar train.'),
      p('Sparse low knocks', [.03, .1, .2, .9], 31, 'hold', 'Low repetition exposes distinct pulsarets.'),
      p('Hard window tick', [.01, .95, 0, 0], 683, 'tap', 'A hard short pulsaret gives a sharp transient.'),
      p('Soft pulse reed', [.55, .25, .08, 1], 283, 'swell', 'A softer window reduces the pulse edges.'),
      p('Chaotic bass grain', [.12, .82, 1, .15], 59, 'bass', 'Strong scatter and high internal cycles make a grainy low voice.'),
    ]),
  method(28, 'phase-vocoder', 'Phase-vocoder analysis–resynthesis', 'Additive and spectral synthesis', 'Analyze overlapping FFT frames, track phase evolution and resynthesize after changing frame timing or spectral pitch.',
    [c('Time stretch', .25, 4, '×', 'log'), c('Transpose', -12, 12, 'st'), bipolar('Spectral tilt'), c('Phase diffusion')], [
      p('Analysis reference', [.5, .5, .5, 0], 220, 'hold', 'Near-unit stretch and zero transposition give a reconstruction reference.'),
      p('Four-times slower', [1, .5, .5, 0], 220, 'pad', 'Slow frame progression extends spectral events.'),
      p('Fast compressed phrase', [0, .5, .5, 0], 220, 'pluck', 'Fast frame progression shortens events.'),
      p('Octave-lowered stretch', [.72, 0, .42, .05], 220, 'long', 'A lower spectral pitch combines with slower progression.'),
      p('Octave-raised shimmer', [.5, 1, .75, .12], 220, 'swell', 'Raised spectral pitch and a bright tilt emphasize the top end.'),
      p('Dark spectral veil', [.68, .5, 0, .25], 220, 'pad', 'Negative tilt weights low bins over high bins.'),
      p('Diffuse frozen texture', [.98, .58, .62, 1], 220, 'long', 'Phase diffusion softens coherent transients into a broad texture.'),
      p('Bright granular smear', [.06, .72, 1, .75], 220, 'tap', 'Fast frames, high tilt and diffusion make a brief spectral smear.'),
    ], { sourceInput: true, lineage: 'Roads 1996 analysis–resynthesis and phase-vocoder techniques. Included as a synthesis-related analysis–resynthesis process.' }),
  method(29, 'scanned', 'Scanned synthesis', 'Oscillators and waveform construction', 'A slowly evolving mass–spring shape becomes a wavetable scanned at audio rate, separating model motion from pitch.',
    [c('Stiffness'), c('Damping'), c('Scan shape'), c('Mass gradient')], [
      p('Slow elastic scan', [.12, .08, .2, .12], 173, 'pad', 'A gently moving shape makes slow spectral evolution.'),
      p('Fast rippling scan', [.95, .08, .25, .12], 173, 'hold', 'Stiffer coupling speeds the shape changes without retuning the note.'),
      p('Damped frozen contour', [.4, .97, .5, .1], 283, 'long', 'Damping settles the evolving wave toward a steadier contour.'),
      p('Uneven mass orbit', [.45, .05, .55, 1], 107, 'swell', 'Unequal masses disturb the evolving waveform symmetries.'),
      p('Sharp scan reed', [.55, .25, .98, .3], 223, 'reed', 'A sharper scan shape emphasizes upper harmonics.'),
      p('Soft scan flute', [.28, .35, 0, .18], 397, 'hold', 'A smooth scan shape keeps the moving spectrum restrained.'),
      p('Elastic pluck', [.78, .48, .72, .62], 137, 'pluck', 'A short envelope catches one portion of the moving shape.'),
      p('Low unsettled drone', [.65, 0, .86, .84], 53, 'pad', 'Small damping keeps the uneven model evolving through a long note.'),
    ], { source: 'scanned', lineage: 'Verplank, Mathews and Shaw, late 1990s–2000. A compact slow mass–spring scanning model.' }),
  method(30, 'corpus', 'Corpus-based concatenative synthesis', 'Sample and grain synthesis', 'Choose analyzed sound fragments by spectral brightness and noisiness, then join them with controlled continuity.',
    [c('Target brightness'), c('Target noisiness'), c('Fragment length', 20, 250, 'ms'), c('Continuity')], [
      p('Dark tonal mosaic', [.06, 0, .65, .8], 173, 'hold', 'Selection favors low-brightness tonal fragments.'),
      p('Bright tonal mosaic', [.97, .02, .65, .8], 173, 'hold', 'The same selection process targets brighter tonal fragments.'),
      p('Noisy source dust', [.75, 1, .03, .08], 283, 'hold', 'Short noisy fragments make a discontinuous grainy texture.'),
      p('Long continuous phrase', [.4, .3, 1, 1], 220, 'long', 'Long fragments and continuity preserve more neighboring source detail.'),
      p('Cut-up syllables', [.52, .5, .18, 0], 197, 'reed', 'Low continuity allows abrupt jumps between selected fragments.'),
      p('Dark breath mosaic', [.08, .95, .7, .62], 83, 'pad', 'Selection favors dark noisy pieces under a slow envelope.'),
      p('Bright fragment strike', [1, .6, 0, .25], 593, 'tap', 'Very short bright fragments make a compact transient.'),
      p('Tonal noisy border', [.48, .5, .43, .5], 137, 'swell', 'Midpoint targets alternate between contrasting source descriptions.'),
    ], { source: 'corpus', sourceInput: true, lineage: 'Corpus-based musical mosaicing and CataRT, 2000s onward. Default corpus is generated locally; importing a source supplies another fragment collection.' }),
  method(31, 'padsynth', 'PADsynth', 'Additive and spectral synthesis', 'Spread harmonics into frequency bands, assign phases and inverse-transform the spectrum into a long looping waveform.',
    [c('Bandwidth', 2, 90, 'cents'), c('Harmonic rolloff'), c('Bandwidth scaling'), c('Band profile')], [
      p('Narrow harmonic organ', [0, .7, .15, .5], 173, 'hold', 'Very narrow bands approach distinct stable harmonics.'),
      p('Wide string ensemble', [.65, .5, .75, .4], 137, 'pad', 'Broad harmonic bands create ensemble-like beating.'),
      p('Air choir', [.85, .78, .95, .72], 223, 'swell', 'Wide upper bands blend into a soft noisy halo.'),
      p('Bright spectral cloud', [.7, .06, .85, .15], 107, 'pad', 'Slow harmonic rolloff retains a rich upper spectrum.'),
      p('Dark low pad', [.4, .98, .2, .65], 53, 'long', 'Strong rolloff suppresses upper harmonics.'),
      p('Thin glass bands', [.09, .35, 0, .98], 593, 'bell', 'Narrow concentrated band profiles retain clear spectral ridges.'),
      p('Broad constant-width mist', [1, .45, 0, .35], 197, 'pad', 'Large bandwidth without upper scaling gives a different density.'),
      p('Short ensemble stab', [.48, .25, .65, 0], 283, 'pluck', 'A short envelope exposes the initial phase-rich ensemble waveform.'),
    ], { source: 'padsynth', lineage: 'Paul Nasca, PADsynth, 2005. Spectral-band wavetable generation.' }),
  method(32, 'vector-phase', 'Vector phaseshaping', 'Modulation and phase shaping', 'A two-dimensional breakpoint reshapes the phase trajectory; moving its coordinates and modulating them controls the spectrum.',
    [c('Horizontal breakpoint', .02, .98), c('Vertical breakpoint', .02, 1.98, ''), c('Modulation depth'), hz('Modulation rate', .1, 20)], [
      p('Neutral phase vector', [.5, .5, 0, .1], 220, 'hold', 'A central breakpoint gives a reference phase trajectory.'),
      p('Narrow phase reed', [.06, .5, 0, .1], 173, 'reed', 'An early horizontal breakpoint concentrates phase motion.'),
      p('Tall vector formant', [.28, .95, .04, .08], 223, 'hold', 'A high vertical breakpoint adds extra phase travel.'),
      p('Low vector formant', [.72, .02, .04, .08], 223, 'hold', 'Lowering the vertical coordinate changes the harmonic emphasis.'),
      p('Slow moving phase pad', [.35, .72, .62, .01], 107, 'pad', 'A slow moving breakpoint animates the phase contour.'),
      p('Fast vector chatter', [.12, .88, .9, 1], 283, 'reed', 'Rapid breakpoint motion makes a more complex changing spectrum.'),
      p('Tiny vector ping', [.92, .93, .1, .3], 683, 'tap', 'An extreme breakpoint and short envelope make a bright tick.'),
      p('Wide low phase motion', [.58, .33, 1, .2], 61, 'long', 'Deep motion explores a large region of the phase map.'),
    ], { source: 'vps', lineage: 'Kleimola and colleagues, vector phaseshaping, DAFx 2011; an extension of phase-distortion approaches.' }),
  method(33, 'neural-ar', 'Neural autoregressive synthesis', 'Neural and learned synthesis', 'A small trained predictor generates successive samples using preceding samples and timbre conditions; temperature adds prediction variation.',
    [c('Timbre'), c('Texture'), c('Contour'), c('Temperature')], [
      p('Clean dark prediction', [.06, 0, .2, 0], 173, 'hold', 'A dark clean condition exposes the learned periodic prediction.'),
      p('Clean bright prediction', [.97, 0, .2, 0], 173, 'hold', 'Changing timbre asks the same predictor for a brighter frame.'),
      p('Textured neural breath', [.45, .95, .25, .35], 223, 'swell', 'The learned harmonic texture and temperature add changing detail.'),
      p('Rounded learned contour', [.35, .08, 0, .03], 307, 'reed', 'One end of the learned contour condition shapes the periodic frame.'),
      p('Peaked learned contour', [.35, .08, 1, .03], 307, 'reed', 'The opposite contour condition changes the waveform shape.'),
      p('Warm uncertain pad', [.2, .3, .55, .72], 107, 'pad', 'Temperature adds variation to a softer trained condition.'),
      p('Brittle prediction burst', [.95, .8, .95, 1], 593, 'tap', 'Bright harmonic conditioning and high temperature give an irregular attack.'),
      p('Low dry learned pulse', [.7, .02, .82, .05], 61, 'bass', 'A low, clean contour foregrounds the periodic waveform.'),
    ], { source: 'ar', lineage: 'Locally trained compact teaching network illustrating autoregressive generation. WaveNet is a family reference, not the bundled model.' }),
  method(34, 'neural-latent', 'Neural latent-space synthesis', 'Neural and learned synthesis', 'A small trained autoencoder represents periodic waveform frames with four coordinates; its decoder turns those coordinates back into sound.',
    ['Latent X', 'Latent Y', 'Latent Z', 'Latent W'].map(label => bipolar(label)), [
      p('Latent center', [.5, .5, .5, .5], 220, 'hold', 'The center of all four coordinates gives a decoder reference.'),
      p('Negative X edge', [0, .5, .5, .5], 173, 'reed', 'Move only X to hear the decoder’s learned X direction.'),
      p('Positive X edge', [1, .5, .5, .5], 173, 'reed', 'The opposite X edge gives a matched-pitch comparison.'),
      p('Y to Z diagonal', [.4, .92, .08, .5], 283, 'pluck', 'Opposed Y and Z coordinates combine learned features.'),
      p('Lower corner contour', [.1, .2, .15, .1], 107, 'pad', 'A lower-coordinate corner samples one region of the learned manifold.'),
      p('High corner contour', [.9, .85, .95, .9], 107, 'pad', 'The opposite corner changes multiple decoded waveform features.'),
      p('W axis chime', [.45, .3, .62, 1], 593, 'bell', 'A strong W coordinate highlights a different decoder direction.'),
      p('Crossed latent bass', [.85, .08, .86, .04], 61, 'bass', 'Alternating coordinate extremes combine distant learned features.'),
    ], { source: 'latent', lineage: 'Locally trained compact waveform autoencoder. RAVE is a family reference; its architecture and pretrained weights are not used.' }),
  method(35, 'ddsp', 'Differentiable DSP (DDSP)', 'Neural and learned synthesis', 'A trained controller sets harmonic and noise synthesis parameters learned through a differentiable signal-generation objective.',
    [c('Brightness'), c('Odd / even'), c('Formant'), c('Noise')], [
      p('Dark learned harmonics', [.05, .5, .2, 0], 173, 'hold', 'The controller emphasizes a dark harmonic spectrum.'),
      p('Bright learned harmonics', [.95, .5, .2, 0], 173, 'hold', 'Higher brightness moves predicted energy into upper partials.'),
      p('Odd learned reed', [.58, 0, .5, .05], 223, 'reed', 'Odd/even conditioning changes the predicted harmonic balance.'),
      p('Even learned stack', [.58, 1, .5, .05], 223, 'reed', 'The opposite balance reveals another harmonic weighting.'),
      p('Low formant breath', [.42, .35, 0, .65], 107, 'swell', 'A low formant condition and noise mix create a breathy spectrum.'),
      p('High formant shimmer', [.72, .65, 1, .15], 397, 'long', 'A high formant condition emphasizes an upper spectral region.'),
      p('Noisy learned strike', [.97, .5, .83, 1], 593, 'tap', 'A strong noise branch shares a short bright attack.'),
      p('Soft harmonic pad', [.3, .2, .35, .22], 137, 'pad', 'Gentle harmonic and noise contributions share a long envelope.'),
    ], { source: 'ddsp', lineage: 'Locally trained compact controller with harmonic-plus-noise DSP. Follows the differentiable-DSP principle; not an imported Google DDSP model.' }),
  method(36, 'diffusion', 'Diffusion-based synthesis', 'Neural and learned synthesis', 'A small trained denoiser iteratively transforms a noisy waveform frame toward a conditioned periodic signal.',
    [c('Timbre'), c('Harmonic shape'), { ...integer('Denoising steps', 4, 20), unit: 'steps' }, c('Variation')], [
      p('Denoised dark frame', [.02, .25, 1, .15], 173, 'hold', 'Twenty reverse steps target a darker periodic condition.'),
      p('Denoised bright frame', [.97, .25, 1, .15], 173, 'hold', 'The same initial variation targets a brighter spectrum.'),
      p('Few-step frame', [.5, .5, .08, .35], 223, 'swell', 'Fewer reverse steps trace a coarser path to the final predicted frame.'),
      p('Odd-harmonic target', [.55, 0, .95, .2], 283, 'reed', 'The shape condition steers the target toward odd harmonics.'),
      p('Full-harmonic target', [.55, 1, .95, .2], 283, 'reed', 'Changing the target shape alters the harmonic distribution.'),
      p('Alternate noise seed', [.35, .4, .55, .94], 137, 'pad', 'A different deterministic seed changes the reconstruction details.'),
      p('Bright coarse-step burst', [1, .85, 0, .72], 593, 'tap', 'A short bright condition exposes the coarser reverse trajectory.'),
      p('Dark settled bass', [.12, .75, .9, .48], 61, 'bass', 'A low note with more reverse steps exposes the learned periodic contour.'),
    ], { source: 'diffusion', lineage: 'Locally trained compact periodic-frame denoising model. DiffWave is a family reference, not the bundled architecture or weights.' }),
  method(37, 'antialias-oscillator', 'Alias-reduced oscillators', 'Oscillators and waveform construction', 'Compare a naïve oscillator with polynomial/minimum-phase bandlimited-step corrections and differentiated polynomial waveforms.',
    [choice('Algorithm', ['Naïve', 'PolyBLEP', 'DPW', 'MinBLEP']), c('Pulse width', .05, .95), c('Saw → square'), c('Drive', 1, 4, '×')], [
      p('High naïve saw', [0, .5, 0, 0], 1907, 'hold', 'Listen and look for folded-back components in the high naïve saw.'),
      p('High PolyBLEP saw', [1 / 3, .5, 0, 0], 1907, 'hold', 'The same pitch and shape with polynomial step correction.'),
      p('High DPW saw', [2 / 3, .5, 0, 0], 1907, 'hold', 'Differentiate a polynomial waveform at the same comparison pitch.'),
      p('High MinBLEP saw', [1, .5, 0, 0], 1907, 'hold', 'A minimum-phase correction provides another matched comparison.'),
      p('Naïve narrow pulse', [0, .06, 1, 0], 1327, 'hold', 'A narrow pulse makes a demanding aliasing example.'),
      p('PolyBLEP narrow pulse', [1 / 3, .06, 1, 0], 1327, 'hold', 'Compare the narrow pulse with discontinuity correction.'),
      p('DPW driven bass', [2 / 3, .5, .3, .75], 73, 'bass', 'A lower driven example shows that antialiasing does not remove harmonics.'),
      p('MinBLEP wide pulse', [1, .85, 1, .2], 683, 'pluck', 'A wide pulse combines spectral gaps with a short envelope.'),
    ], { source: 'blep', lineage: 'Post-1996 oscillator implementation advances. These reduce aliasing in established waveform synthesis families.' }),
  method(38, 'antiderivative-waveshaping', 'Antiderivative antialiasing (ADAA)', 'Nonlinear waveshaping', 'Use a transfer function’s antiderivative to average nonlinear shaping between samples, reducing aliasing from added harmonics.',
    [c('Drive', 1, 12, '×'), bipolar('Asymmetry'), c('ADAA mix'), c('Transfer shape')], [
      p('High direct saturation', [.75, .5, 0, 0], 1487, 'hold', 'Direct nonlinear shaping supplies the high-frequency comparison.'),
      p('High ADAA saturation', [.75, .5, 1, 0], 1487, 'hold', 'The same drive with antiderivative averaging changes the aliases.'),
      p('Biased direct clipping', [.65, .85, 0, 1], 1187, 'hold', 'Asymmetric soft clipping creates even and odd harmonics.'),
      p('Biased ADAA clipping', [.65, .85, 1, 1], 1187, 'hold', 'The same biased clip with ADAA provides a matched comparison.'),
      p('Gentle smooth reed', [.05, .5, 1, .2], 223, 'reed', 'Low drive adds a restrained set of upper harmonics.'),
      p('Saturated low body', [.95, .54, 1, .65], 61, 'bass', 'Strong shaping thickens a low note.'),
      p('Half-averaged edge', [.85, .2, .5, .85], 397, 'pluck', 'The mix interpolates between direct and averaged nonlinear output.'),
      p('Bright shaped tick', [1, .95, .95, 1], 947, 'tap', 'Strong asymmetric shaping makes a compact bright transient.'),
    ], { source: 'adaa', lineage: 'Parker, Zavalishin and Le Bivic, DAFx 2016. An antialiasing implementation for established nonlinear waveshaping.' }),
  method(39, 'hard-sync', 'Hard-sync oscillator', 'Oscillators and waveform construction', 'A master oscillator resets a slave oscillator. Slave ratio and reset phase reshape the harmonic spectrum; optional discontinuity correction reduces reset aliasing.', [], [
    np(39, 'Unity sine reference', { 'slave-ratio': 1, 'slave-waveform': 0 }, 220, 'hold', 'At a unity ratio the sine slave follows the master period.'),
    np(39, 'Classic synced saw', { 'slave-ratio': 4.2, 'slave-waveform': 1 }, 137, 'reed', 'A faster saw resets at the lower master frequency.'),
    np(39, 'Descending sync brass', { 'slave-ratio': 2.6, 'sync-envelope': 18 }, 173, 'pluck', 'The envelope moves the slave ratio through a bright attack.'),
    np(39, 'High ratio thin reed', { 'slave-ratio': 13.3, 'reset-phase': .2, 'sync-depth': .95 }, 113, 'hold', 'Many slave cycles fit inside each master period.'),
    np(39, 'Pulse sync bass', { 'slave-ratio': 3.1, 'slave-waveform': 2, 'pulse-width': .18, 'sync-envelope': 6 }, 61, 'bass', 'Pulse width and sync ratio jointly change the spectral gaps.'),
    np(39, 'Unsteady soft sync', { 'slave-ratio': 6.7, 'slave-waveform': .45, 'sync-depth': .48, 'sync-jitter': .25, 'reset-phase': .3 }, 227, 'long', 'Partial resetting and timing jitter weaken strict repetition.'),
    np(39, 'Direct reset comparison', { 'slave-ratio': 5.7, 'slave-waveform': 1, antialias: 0 }, 1487, 'hold', 'Uncorrected high-frequency resets reveal discontinuity artifacts.'),
    np(39, 'Corrected reset comparison', { 'slave-ratio': 5.7, 'slave-waveform': 1, antialias: 1 }, 1487, 'hold', 'Every other setting matches the direct reset comparison.'),
  ], { source: 'hardSync', lineage: 'Hard sync predates digital synthesis; Brandt (ICMC 2001) describes antialiasing its reset discontinuities.' }),
  method(40, 'single-sideband', 'Single-sideband modulation / frequency shifting', 'Modulation and phase shaping', 'Quadrature components form a selected sideband. An additive frequency shift moves spectral components by an offset instead of a common pitch multiplier.', [], [
    np(40, 'Unshifted harmonic source', { 'frequency-shift': 0, 'modulator-ratio': 1, 'harmonic-count': 8 }, 220, 'hold', 'A zero shift supplies a spectral reference for the bank.'),
    np(40, 'Upward spectral displacement', { 'frequency-shift': 137, 'harmonic-count': 12, rolloff: .4 }, 173, 'hold', 'An additive offset displaces the source harmonic positions.'),
    np(40, 'Downward bell', { 'frequency-shift': -193, 'harmonic-count': 10, rolloff: .65 }, 311, 'bell', 'A downward frequency translation creates an inharmonic ringing set.'),
    np(40, 'Near zero beating', { 'frequency-shift': 2.7, wet: .5, 'harmonic-count': 5 }, 197, 'long', 'Dry and slightly shifted components make slow beating.'),
    np(40, 'Lower sideband metal', { 'frequency-shift': 317, sideband: 1, 'modulator-ratio': 1.4, 'harmonic-count': 16, rolloff: .3 }, 149, 'reed', 'Selecting the other sideband changes the translated partial pattern.'),
    np(40, 'Two sideband blend', { 'frequency-shift': 431, sideband: .5, 'modulator-ratio': 2.1, 'harmonic-count': 6, wet: .9 }, 223, 'hold', 'Blending the two sideband directions approaches a ring-like spectrum.'),
    np(40, 'Moving metallic field', { 'frequency-shift': 73, 'shift-motion': 640, 'harmonic-count': 24, rolloff: .55, 'modulator-phase': .25 }, 107, 'pad', 'Shift motion moves the spectral components through changing relationships.'),
    np(40, 'Large shift splinter', { 'frequency-shift': 2700, 'modulator-ratio': 3.7, 'harmonic-count': 20, rolloff: .15, sideband: .2 }, 397, 'tap', 'A large offset and rich source make a bright short burst.'),
  ], { source: 'ssb', lineage: 'Quadrature single-sideband modulation and frequency shifting; see Puckette, The Theory and Technique of Electronic Music. An older synthesis technique added to this catalog.' }),
  method(41, 'wavelet', 'Multiscale wavelet synthesis', 'Additive and spectral synthesis', 'Sum translated and scaled copies of a mother wavelet. Scale count, spacing and translation change the mixture of localized detail at several resolutions.', [], [
    np(41, 'One scale Morlet pulse', { 'scale-count': 1, 'wavelet-width': .22 }, 220, 'hold', 'One localized oscillatory wavelet establishes the reference shape.'),
    np(41, 'Smooth multiscale bell', { 'scale-count': 5, 'scale-spacing': 2, 'scale-decay': .6, 'wavelet-width': .3 }, 263, 'bell', 'Several scales combine fine detail with a broad smooth body.'),
    np(41, 'Ricker wavelet layers', { 'wavelet-family': 1, 'scale-count': 6, 'scale-spacing': 1.7, 'scale-decay': .45, translation: .35 }, 173, 'reed', 'A nonoscillatory mother pulse creates a different multiscale waveform.', 'mexican-hat-layers'),
    np(41, 'Compact bright packet', { 'scale-count': 8, 'scale-spacing': 2.6, 'scale-decay': .25, 'wavelet-width': .07, chirp: 3 }, 347, 'pluck', 'Narrow packets and fine scales concentrate rapid detail.'),
    np(41, 'Broad wavelet cloud', { 'scale-count': 7, 'scale-spacing': 1.3, 'scale-decay': .7, 'wavelet-width': .46, 'scale-motion': .3 }, 83, 'pad', 'Nearby scales overlap into a broad slowly changing shape.'),
    np(41, 'Haar steps', { 'wavelet-family': 2, 'scale-count': 5, 'scale-spacing': 2, 'scale-decay': .45, 'wavelet-width': .25, translation: .2 }, 137, 'hold', 'A rectangular mother wavelet exposes sharp multiscale steps.'),
    np(41, 'Translated scales', { 'wavelet-family': 1, 'scale-count': 8, 'scale-spacing': 1.8, translation: .85, 'wavelet-width': .18 }, 197, 'long', 'Changing translation rearranges where scale contributions line up.'),
    np(41, 'Moving chirped field', { 'scale-count': 6, 'scale-spacing': 2.2, 'scale-motion': .85, chirp: 8, translation: .65, 'wavelet-width': .12 }, 127, 'swell', 'Scale movement and chirp continuously change the packet detail.'),
  ], { source: 'wavelet', lineage: 'Scale and translation construction follows multiresolution/wavelet principles (Mallat 1989). This finite synthesis bank does not claim an orthonormal analysis transform.' }),
  method(42, 'colored-noise', 'Colored / 1/f noise synthesis', 'Noise and stochastic synthesis', 'Shape random excitation toward a chosen spectral slope, then apply band limits and optional resonance. Finite filters approximate colored-noise spectra over a bounded band.', [], [
    np(42, 'White noise reference', { 'spectral-exponent': 0 }, 220, 'hold', 'A flat source spectrum provides the noise-color reference.'),
    np(42, 'Pink noise bed', { 'spectral-exponent': 1, 'high-cut': 15000 }, 220, 'pad', 'A downward spectral slope gives less high-frequency energy.'),
    np(42, 'Brown low rumble', { 'spectral-exponent': 2, 'low-cut': 20, 'high-cut': 1800, flutter: .15 }, 61, 'long', 'A steeper slope and low ceiling emphasize slow low-frequency motion.'),
    np(42, 'Blue noise hiss', { 'spectral-exponent': -1, 'low-cut': 350, 'high-cut': 18000 }, 397, 'hold', 'A rising spectral slope favors high-frequency hiss.'),
    np(42, 'Resonant narrow wind', { 'spectral-exponent': .7, 'low-cut': 120, 'high-cut': 3600, 'resonance-frequency': 950, resonance: .68, flutter: .3 }, 173, 'swell', 'Band limits and a resonance concentrate the noise into a wind-like region.'),
    np(42, 'Held binary crackle', { 'spectral-exponent': -.4, distribution: 2, 'hold-length': 24, 'high-cut': 9500 }, 220, 'hold', 'A binary source and sample hold produce coarse irregular steps.'),
    np(42, 'Slow Gaussian wash', { 'spectral-exponent': 1.4, distribution: 1, 'hold-length': 4, flutter: .75, 'high-cut': 6200 }, 107, 'pad', 'Gaussian excitation and level flutter create a changing dark wash.'),
    np(42, 'Bright noise burst', { 'spectral-exponent': -1.6, 'low-cut': 1500, 'high-cut': 20000, distribution: 1, resonance: .2, 'resonance-frequency': 5300 }, 811, 'tap', 'A short envelope turns a bright random spectrum into a percussion texture.'),
  ], { source: 'colored', lineage: 'Colored-noise and 1/f processes predate 1996; Voss and Clarke (1978) discuss their musical use. Spectral slopes here are finite-band approximations.' }),
  method(43, 'particle-shaker', 'Stochastic particle shaker', 'Physical models and resonators', 'A decaying shake-energy reservoir generates probabilistic particle collisions that excite damped resonances. Particle count, contact noise and losses shape the rattle.', [], [
    np(43, 'Sparse beads', { 'particle-count': 6, 'collision-rate': .16, 'energy-decay': .6, 'resonance-q': 36 }, 2300, [ .001, 1, 0, .3 ], 'A small particle population leaves individual collisions exposed.'),
    np(43, 'Dense maraca texture', { 'particle-count': 180, 'collision-rate': .75, 'mode-spread': .65, 'energy-decay': .45, 'resonance-q': 14, brightness: 11000 }, 3700, [ .001, .8, 0, .2 ], 'Many collisions overlap into a dense bright shake.'),
    np(43, 'Long scraping rattle', { 'particle-count': 96, 'collision-rate': .85, 'energy-decay': 2.5, 'resonance-q': 8, 'contact-noise': .95, brightness: 6200 }, 1700, [ .001, 3, 0, 1 ], 'Long energy decay and noisy contacts sustain an irregular scrape.'),
    np(43, 'Bright seed rattle', { 'particle-count': 48, 'collision-rate': .4, 'mode-spread': .8, 'energy-decay': .22, 'resonance-q': 55, brightness: 17000 }, 5600, [ .001, .55, 0, .2 ], 'Brief high resonances make a fine bright rattle.'),
    np(43, 'Low hollow container', { 'particle-count': 24, 'collision-rate': .35, 'mode-spread': .2, 'energy-decay': .9, 'resonance-q': 72, brightness: 2400 }, 430, [ .001, 1.5, 0, .6 ], 'Low lightly damped modes reveal a hollow resonant body.'),
    np(43, 'Separated pebble clicks', { 'particle-count': 3, 'collision-rate': .08, 'energy-decay': 1.5, 'resonance-q': 6, 'contact-noise': .35, brightness: 4800 }, 1300, [ .001, 2, 0, .5 ], 'Sparse events and short resonances expose isolated impacts.'),
    np(43, 'Continuous shake gesture', { 'particle-count': 120, 'collision-rate': .6, 'energy-decay': .7, 'shake-force': .65, 'resonance-q': 22, brightness: 9800 }, 3100, 'hold', 'Continuous energy replenishment maintains collisions while the note is held.'),
    np(43, 'Tiny collision burst', { 'particle-count': 230, 'collision-rate': .95, 'energy-decay': .08, 'resonance-q': 10, 'contact-noise': 1, brightness: 18500 }, 6700, [ .001, .2, 0, .1 ], 'A fast energy loss concentrates many contacts into one short burst.'),
  ], { source: 'shaker', playStyle: 'strike', lineage: 'Physically informed stochastic collision/resonator lineage, associated with Cook’s PhISM (1997) and STK Shakers. No recorded shaker samples or calibrated material models.' }),
  method(44, 'fdtd-membrane', 'Two-dimensional finite-difference membrane', 'Physical models and resonators', 'A grid approximates wave propagation across a struck membrane. Tension, losses, strike and pickup positions change the excited and observed modes.', [], [
    np(44, 'Central low membrane', { tension: .35, damping: .22, 'strike-x': .5, 'strike-y': .5 }, 97, [ .001, 1.5, 0, .7 ], 'A central strike emphasizes the symmetric modes of a low membrane.'),
    np(44, 'Off-center bright drum', { tension: .7, damping: .28, 'strike-x': .26, 'strike-y': .37, 'strike-hardness': .9 }, 173, [ .001, 1, 0, .45 ], 'Moving the strike excites a different mixture of membrane modes.'),
    np(44, 'Edge strike', { tension: .55, damping: .2, 'strike-x': .12, 'strike-y': .65, 'pickup-x': .4, 'pickup-y': .3, 'strike-hardness': 1 }, 127, [ .001, 1.4, 0, .7 ], 'An edgeward strike and displaced pickup expose asymmetric motion.'),
    np(44, 'Muted skin', { tension: .4, damping: .82, 'strike-hardness': .35, 'grid-resolution': 10 }, 113, [ .001, .35, 0, .15 ], 'Strong internal damping suppresses the membrane tail.'),
    np(44, 'Long rectangular membrane', { tension: .25, damping: .05, aspect: 1.75, 'strike-x': .35, 'strike-y': .45, 'grid-resolution': 16 }, 73, [ .001, 3.5, 0, 1.8 ], 'An unequal aspect and low losses spread the long-lived mode relationships.'),
    np(44, 'Small high membrane', { tension: .95, damping: .4, aspect: .7, 'grid-resolution': 8, 'strike-hardness': .95 }, 587, [ .001, .55, 0, .25 ], 'A higher excitation scale and hard strike make a compact bright membrane.'),
    np(44, 'Wide soft mallet', { tension: .32, damping: .32, 'strike-hardness': .08, 'pickup-x': .45, 'pickup-y': .55, boundary: .15 }, 137, [ .001, 1.2, 0, .5 ], 'A broad soft strike suppresses the finest spatial detail.'),
    np(44, 'Loose boundary response', { tension: .6, damping: .15, boundary: .75, 'strike-x': .28, 'strike-y': .7, 'pickup-x': .72, 'pickup-y': .28, aspect: 1.3 }, 157, [ .001, 2.2, 0, 1 ], 'Boundary character and separated strike/pickup positions change the modal balance.'),
  ], { source: 'membrane', playStyle: 'strike', lineage: 'Finite-difference wave-equation modeling; see Bilbao, Numerical Sound Synthesis (2009). A small teaching grid with numerical stability limits, not a calibrated drum or plate.' }),
  method(45, 'fdn-resonator', 'Feedback delay network resonator', 'Physical models and resonators', 'Coupled delay lines circulate an excitation through a lossy mixing network. Delay sizes, coupling and damping produce an abstract resonant body.', [], [
    np(45, 'Short wooden box', { 'network-size': .009, decay: .35, damping: .7, diffusion: .75, dispersion: .3, 'line-count': 4 }, 173, [ .001, .65, 0, .35 ], 'Short delays and strong high-frequency loss make a compact resonant box.'),
    np(45, 'Long metal chamber', { 'network-size': .025, decay: 6.5, damping: .12, diffusion: 1, dispersion: .65 }, 263, [ .001, 5, 0, 3 ], 'Long feedback decay lets the densely coupled resonances ring.'),
    np(45, 'Few coupled delay tones', { 'network-size': .012, decay: 2.5, 'line-count': 3, dispersion: .08, 'excitation-noise': .2, diffusion: .6 }, 220, [ .001, 2.5, 0, 1 ], 'A small network and simple excitation reveal individual delay resonances.'),
    np(45, 'Dense dark cloud', { 'network-size': .13, decay: 8, damping: .8, 'line-count': 8, dispersion: .85, saturation: .08 }, 83, [ .001, 6, 0, 3.5 ], 'Long unequal delays and dark feedback produce a dense tail.'),
    np(45, 'Bright small cavity', { 'network-size': .0035, decay: .8, damping: .08, dispersion: .5, injection: .2 }, 593, [ .001, 1, 0, .45 ], 'A short network places strong resonances high in the spectrum.'),
    np(45, 'Weakly coupled echoes', { 'network-size': .085, decay: 2.2, diffusion: .05, 'line-count': 4, dispersion: .75 }, 197, [ .001, 2.8, 0, 1.2 ], 'Weak mixing preserves more of the separate delay-line responses.'),
    np(45, 'Saturated struck network', { 'network-size': .018, decay: 3, damping: .3, saturation: .65, inversion: .7, injection: .8 }, 137, [ .001, 3, 0, 1.5 ], 'Nonlinear feedback and inversion reshape the decaying resonant spectrum.'),
    np(45, 'Long low resonator', { 'network-size': .18, decay: 9, damping: .55, 'excitation-noise': .15, dispersion: .2, 'line-count': 6 }, 61, [ .001, 8, 0, 4 ], 'Large delay lengths and slow losses sustain a low abstract resonant body.'),
  ], { source: 'fdn', playStyle: 'strike', lineage: 'Feedback delay networks: see Julius O. Smith, Physical Audio Signal Processing. Used here as an excited resonator; it is not a calibrated room simulation.' }),
  method(46, 'rossler', 'Rössler chaotic synthesis', 'Oscillators and waveform construction', 'Integrate a deterministic nonlinear three-state system and project its motion to audio. Parameter changes move between regular and irregular trajectories; pitch is a nominal time scale.', [], [
    np(46, 'Classic chaotic orbit', { 'rossler-a': .2, 'rossler-b': .2, 'rossler-c': 5.7 }, 173, 'hold', 'The familiar parameter region gives the three-state system its reference motion.'),
    np(46, 'Gentler orbit', { 'rossler-a': .12, 'rossler-b': .2, 'rossler-c': 3.2, 'time-scale': .8 }, 220, 'reed', 'Lower parameter values explore a gentler part of the trajectory range.'),
    np(46, 'Slow irregular drone', { 'rossler-a': .24, 'rossler-b': .18, 'rossler-c': 7.2, 'time-scale': .3, rotation: 35 }, 132.5, 'pad', 'Slow time scaling reveals the uneven motion of the nonlinear state.'),
    np(46, 'Y projection', { 'output-axis': 1, rotation: 0 }, 173, 'hold', 'Changing only the observed coordinate gives another view of the same system.'),
    np(46, 'Z projection spikes', { 'output-axis': 2, rotation: 0 }, 173, 'hold', 'The third coordinate emphasizes differently shaped excursions.'),
    np(46, 'Rotated mixed reed', { 'output-axis': .65, rotation: 120, 'rossler-a': .18, 'rossler-c': 6.1 }, 251, 'reed', 'A rotated coordinate mixture changes the audio projection.'),
    np(46, 'Fast chaotic chatter', { 'time-scale': 1.65, 'rossler-a': .27, 'rossler-b': .25, 'rossler-c': 8.5, 'output-axis': 1.6 }, 593, 'tap', 'Faster integration time and a mixed projection expose rapid irregular detail.'),
    np(46, 'Different initial path', { 'initial-state': .83, rotation: 245, 'output-axis': .35, 'rossler-c': 5.9, 'time-scale': .6 }, 107, 'long', 'A changed initial condition and projection produce another deterministic path.'),
  ], { source: 'rossler', lineage: 'Rössler, An equation for continuous chaos (1976). Deterministic nonlinear oscillation, not random noise; not every parameter setting is guaranteed to be chaotic or exactly pitched.' }),
]);

export const SYNTHESIS_METHODS = freeze([...LEGACY_METHODS, ...HISTORICAL_DATA.map(item => ({
  ...item, kind: 'synthesis', description: item.principle, sourceInput: false,
  playStyle: item.playStyle || 'hold', triggerLabel: item.playStyle === 'strike' ? 'Strike' : 'Hold note',
  defaultParams: Array.from({ length: PARAMETER_COUNT }, (_, i) => item.controls[i]?.defaultNormalized ?? 0),
  referenceLevelTrimDb: METHOD_LEVEL_TRIMS_DB[item.id] ?? 0,
  presets: item.presets.map(preset => ({ ...preset, levelTrimDb: PRESET_LEVEL_TRIMS_DB[`${item.id}/${preset.id}`] ?? 0 })),
}))]);
export const PROCESSOR_METHODS = freeze(PROCESSING_SCHEMA.methods.map(schema => {
  const data = PROCESSING_DATA.find(item => item.processorId === schema.processorId);
  const controls = schema.params.map(control => ({ ...control,
    id: control.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    ...((schema.processorId === 7 && control.index === 4 || schema.processorId === 10 && control.index === 0) ? { integer: true } : {}),
    ...(control.choices && !(schema.processorId === 2 && control.index === 3) ? { options: control.choices, integer: true } : {}),
    ...(schema.processorId === 2 && control.index === 3 ? { optionValues: [2, 4], options: control.choices, integer: true } : {}),
  }));
  return { ...data, id: `fx-${schema.id}`, processorId: schema.processorId, kind: 'processor',
    label: schema.name, principle: data.description, playStyle: 'process', triggerLabel: 'Audition', sourceInput: true,
    controls, defaultParams: schema.defaultParams, referenceLevelTrimDb: 0,
    presets: data.presets.map(preset => ({ ...preset, levelTrimDb: 0, envelope: { attack: .001, decay: .002, sustain: 1, release: .003 } })),
  };
}));
export const METHODS = freeze([...SYNTHESIS_METHODS, ...PROCESSOR_METHODS]);

export const METHOD_GROUPS = freeze([...new Set(METHODS.map(item => item.group))]);
export const PRESET_COUNT = METHODS.reduce((sum, item) => sum + item.presets.length, 0);
export const STATE_VERSION = 4;
export function getMethod(id) {
  return METHODS.find(item => typeof id === 'number' ? item.engineId === id : item.id === id) || METHODS[0];
}
export function getPreset(methodId, presetId) {
  const { presets } = getMethod(methodId);
  return presets.find(item => item.id === presetId) || presets[0];
}
export function parameterValue(control, normalized) {
  const value = clamp(normalized);
  if (control.optionValues) return control.optionValues[Math.round(value * (control.optionValues.length - 1))];
  const scaled = control.scale === 'log' ? control.min * (control.max / control.min) ** value : control.min + (control.max - control.min) * value;
  return control.quantization === 'floor' ? Math.floor(scaled + 1e-8) : control.integer ? Math.round(scaled) : Math.min(control.max, Math.max(control.min, scaled));
}
export function normalizedParameter(control, physical) {
  const value = clamp(physical, control.min, control.max, control.min);
  if (control.optionValues) {
    const closest = control.optionValues.reduce((best, item, i) => Math.abs(item - value) < Math.abs(control.optionValues[best] - value) ? i : best, 0);
    return closest / (control.optionValues.length - 1);
  }
  const quantized = control.quantization === 'floor' ? Math.min(control.max, Math.round(value) + .001) : control.integer ? Math.round(value) : value;
  return clamp(control.scale === 'log'
    ? Math.log(quantized / control.min) / Math.log(control.max / control.min)
    : (quantized - control.min) / (control.max - control.min));
}
export function formatParameter(control, normalized) {
  const value = parameterValue(control, normalized);
  if (control.options) return control.options[control.optionValues ? control.optionValues.indexOf(value) : Math.round(value)];
  if (control.unit === '%') return `${Number(value.toFixed(2))}%`;
  const display = control.integer ? String(value) : String(Number(value.toPrecision(4)));
  return `${display}${control.unit ? ` ${control.unit}` : ''}`;
}
export function createDefaultState(methodId = METHODS[0].id) {
  const method = getMethod(methodId);
  const preset = method.presets[0];
  return { version: STATE_VERSION, methodId: method.id, presetId: preset.id, params: [...preset.params],
    voiceMode: 'mono', tuningId: DEFAULT_TUNING_ID, frequencyHz: preset.frequencyHz,
    envelope: { ...preset.envelope }, levelTrimDb: preset.levelTrimDb, outputLevel: .7,
    ...(method.kind === "processor" ? { source: preset.source, wet: preset.wet, bypass: false, inputDb: preset.inputDb, outputDb: preset.outputDb } : {}) };
}
export function sanitizeState(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const method = getMethod(input.methodId ?? input.engineId);
  const preset = getPreset(method.id, input.presetId);
  // Version 1 padded every voice to eight slots; those old padding zeros are not
  // meaningful values for newly exposed parameters. Unversioned full-width state
  // (including a preset object) follows the current 16-slot contract.
  const incomingVersion = finite(input.version, (input.params?.length || 0) <= 8 ? 1 : STATE_VERSION);
  const legacy = method.engineId < 39 && incomingVersion < 2;
  const legacyCount = [2, 24].includes(method.engineId) ? 8 : 4;
  const params = Array.from({ length: PARAMETER_COUNT }, (_, index) => {
    if (index >= method.controls.length) return 0;
    if (legacy && index >= legacyCount) return method.defaultParams[index];
    const provided = finite(input.params?.[index], NaN);
    if (!Number.isFinite(provided)) return preset.params[index];
    return legacy ? migrateLegacyParameter(method.engineId, index, provided) : clamp(provided);
  });
  const envelope = input.envelope && typeof input.envelope === 'object' ? input.envelope : {};
  return { version: STATE_VERSION, methodId: method.id, presetId: input.presetId === 'custom' ? 'custom' : preset.id, params,
    voiceMode: input.voiceMode === 'poly' ? 'poly' : 'mono',
    tuningId: sanitizeTuningId(input.tuningId),
    frequencyHz: clamp(input.frequencyHz, 20, 8000, preset.frequencyHz),
    envelope: { attack: clamp(envelope.attack, .001, 12, preset.envelope.attack), decay: clamp(envelope.decay, .002, 12, preset.envelope.decay),
      sustain: clamp(envelope.sustain, 0, 1, preset.envelope.sustain), release: clamp(envelope.release, .003, 16, preset.envelope.release) },
    levelTrimDb: clamp(input.levelTrimDb, -36, 48, input.presetId === 'custom' ? method.referenceLevelTrimDb : preset.levelTrimDb),
    outputLevel: clamp(input.outputLevel, 0, 1, .7),
    ...(method.kind === 'processor' ? {
      source: Math.round(clamp(input.source, 0, PROCESSING_SCHEMA.sources.length - 1, preset.source)),
      wet: clamp(input.wet, 0, 1, preset.wet), bypass: input.bypass === true,
      inputDb: clamp(input.inputDb, -36, 24, preset.inputDb), outputDb: clamp(input.outputDb, -36, 24, preset.outputDb),
    } : {}) };
}
export function stateFromPreset(methodId, presetId, previous = {}) {
  const method = getMethod(methodId);
  const preset = getPreset(method.id, presetId);
  return sanitizeState({ ...preset, version: STATE_VERSION, methodId: method.id, presetId: preset.id,
    outputLevel: previous.outputLevel, voiceMode: previous.voiceMode, tuningId: previous.tuningId });
}
/** Full bounded musical randomization. Audio state, output level and sources live outside presets. */
export function randomizeState(value = {}, rng = Math.random) {
  const current = sanitizeState(value);
  const method = getMethod(current.methodId);
  const random = () => clamp(rng());
  const params = Array.from({ length: PARAMETER_COUNT }, (_, index) => index < method.controls.length ? random() : 0);
  if (method.id === 'additive' && params.slice(0, 8).every(value => value < .1)) params[0] = .7;
  const frequencyHz = 40 * 35 ** random();
  const envelope = {
    attack: .002 * 900 ** random(), decay: .04 * 100 ** random(),
    sustain: random(), release: .04 * 100 ** random(),
  };
  const attackDraw = Math.log(envelope.attack / .002) / Math.log(900);
  if (method.id === 'physical') {
    // A heavily damped mass–spring strike dies before a long attack opens.
    envelope.attack = .001 + (.003 + .05 * (1 - params[1]) ** 2) * attackDraw;
  } else if (['fdtd-membrane', 'particle-shaker', 'fdn-resonator'].includes(method.id)) {
    envelope.attack = .001 + .008 * attackDraw ** 2;
  } else if (method.id === 'karplus-strong') {
    // A short excitation can decay internally before a long output attack opens.
    envelope.attack = .001 + .005 * (1 - params[0]) ** 2 * attackDraw;
  } else if (method.id === 'phase-vocoder') {
    // Keep a broad random passband around the transposed source's nominal
    // fundamental. Independent narrow masks often remove every occupied bin.
    const fundamental = frequencyHz * 2 ** ((params[1] * 24 - 12) / 12);
    const low = Math.max(20, fundamental * (.1 + .4 * params[6]));
    const high = Math.min(24000, fundamental * (3 + 12 * params[7]));
    params[6] = Math.log(low / 20) / Math.log(1200);
    params[7] = Math.log(high / 20) / Math.log(1200);
    params[8] *= .3;
  } else if (method.id === 'waveguide') {
    // Open the envelope quickly and keep the pressure/transfer curve above the
    // local oscillation threshold. Every visible control still varies.
    const pressureDraw = params[0];
    envelope.attack = .005 + .2 * attackDraw ** 2;
    envelope.sustain = .85 + .15 * envelope.sustain;
    params[1] = .3 + .45 * params[1];
    params[2] = .04 + .25 * params[2];
    params[4] = (.4 + .38 * params[4] - .1) / 1.1;
    params[6] *= .45;
    params[8] *= .15;
    const opening = .1 + 1.1 * params[4];
    const curve = .5 + 1.5 * params[5];
    const range = 1 - .5 * params[9];
    const offset = .5 * params[9] + range * opening;
    const targetSlope = 1.025 + .02 * pressureDraw;
    let low = 0, high = 1 - offset;
    for (let iteration = 0; iteration < 32; iteration++) {
      const displacement = (low + high) * .5;
      const reed = offset + displacement;
      const slope = reed ** (curve - 1) * (reed + curve * displacement);
      if (slope < targetSlope) low = displacement;
      else high = displacement;
    }
    const drive = (low + high) * .5 / range;
    params[0] = clamp((drive / ((.12 + .88 * params[1]) * envelope.sustain) - .08) / 1.04);
  }
  return sanitizeState({ ...current, presetId: 'custom', params, frequencyHz, envelope, levelTrimDb: method.referenceLevelTrimDb });
}
