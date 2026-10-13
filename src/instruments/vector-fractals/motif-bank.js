import { captureMotif, describeMotif, compareMotifs, sampleMotifDescriptor } from './motif-model.js';
import { TRACE_TABLE_SIZE } from './trace-model.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const interpolate = (values, phase) => {
  if (!values?.length) return phase;
  const at = clamp(phase, 0, 1) * (values.length - 1), index = Math.floor(at);
  return values[index] + (values[Math.min(index + 1, values.length - 1)] - values[index]) * (at - index);
};
const empty = () => ({ x: new Float32Array(0), y: new Float32Array(0), bend: new Float32Array(0), fold: new Float32Array(0),
  contacts: [], events: [], beads: [], pathIndex: -1, closed: false });

/** A phrase bank shares the existing bounded audio-clock reader and voice controls. */
export function createMotifBank(results, options = {}) {
  const mode = options.travelerMode ?? 'compare', source = results?.[2] ?? results?.find(Boolean);
  const captures = Array.from({ length: 3 }, (_, i) => options.motifCaptures?.[i] || null);
  const chosen = options.finePath >= 0 ? options.finePath : 0;
  if (!captures[0] && source) captures[0] = captureMotif(source, chosen, { center: options.motifCenter, span: options.motifSpan, samples: 512 });
  // Unpinned previews keep new complete presets immediately playable.
  for (let i = 1; i < 3; i++) if (!captures[i] && source) {
    captures[i] = captureMotif(source, chosen, { center: ((options.motifCenter ?? .5) + i * .31) % 1,
      span: clamp((options.motifSpan ?? .18) * (i === 1 ? .65 : .4), .02, 1), samples: 512 });
  }
  const settings = { detail: options.motifDetail ?? .015, samples: 256,
    mirror: Boolean(options.motifMirror), reverse: Boolean(options.motifReverse), elastic: options.motifElastic ?? 0 };
  const descriptors = captures.map(capture => capture ? describeMotif(capture, settings) : null);
  const comparisons = descriptors.map((descriptor, i) => mode !== 'detail' && i && descriptor && descriptors[0] ? compareMotifs(descriptors[0], descriptor, settings) : null);
  const aligned = descriptors.map((descriptor, i) => comparisons[i]?.b ?? descriptor);
  const reference = descriptors[0];
  const view = source?.view ?? captures[0]?.source?.view ?? { x: 0, y: 0, width: 4, aspect: 1 };
  const bank = { reader: 'traveler', motif: true, motifMode: mode, view, layers: [], motifCaptures: mode === 'detail' ? [captures[0]] : captures,
    motifDescriptors: mode === 'detail' ? [reference, reference, reference] : aligned,
    motifComparisons: comparisons, motifTiming: options.motifTiming ?? 'normalized' };
  const lengths = aligned.map(d => Math.max(1e-15, d?.rawLength ?? reference?.rawLength ?? 1));
  const normalized = options.motifTiming !== 'original';
  const naturalWeight = lengths[0] / (lengths[0] + lengths[1]);
  const firstWeight = clamp(naturalWeight, .04, .96);
  const compareWeights = normalized ? [.5, .5] : [firstWeight, 1 - firstWeight];
  const maxLength = Math.max(...lengths);
  bank.timingLimited = !normalized && (mode === 'compare' ? firstWeight !== naturalWeight : mode === 'choir' && lengths.some(length => length / maxLength < .04));
  if (!reference) { bank.layers = [empty(), empty(), empty()]; return bank; }
  for (let layerIndex = 0; layerIndex < 3; layerIndex++) {
    const descriptor = mode === 'detail' ? reference : aligned[layerIndex];
    if (!descriptor || (mode === 'compare' && layerIndex === 2)) { bank.layers.push(empty()); continue; }
    const layer = { x: new Float32Array(TRACE_TABLE_SIZE), y: new Float32Array(TRACE_TABLE_SIZE),
      bend: new Float32Array(TRACE_TABLE_SIZE), fold: new Float32Array(TRACE_TABLE_SIZE), turn: new Float32Array(TRACE_TABLE_SIZE),
      presence: new Float32Array(TRACE_TABLE_SIZE), motifPhase: new Float32Array(TRACE_TABLE_SIZE),
      geometricTurn: new Float32Array(TRACE_TABLE_SIZE),
      closed: descriptor.closed, turnPerLap: 0, pathIndex: -1, beads: [], events: [],
      label: mode === 'detail' ? ['Broad', 'Curl detail', 'Fine detail'][layerIndex] : ['Motif A', 'Motif B', 'Motif C'][layerIndex] };
    const lengthRatio = clamp(Math.log2(descriptor.length / Math.max(1e-15, reference.length)), -4, 4);
    layer.registerOctaves = options.motifScaleCue === 'register' ? -lengthRatio * (options.motifScaleAmount ?? .5) : 0;
    layer.color = options.motifScaleCue === 'timbre' ? clamp(.5 - lengthRatio / 8, 0, 1) * (options.motifScaleAmount ?? .5) : 0;
    layer.pan = Math.sin(descriptor.orientation ?? 0) * (options.motifOrientation ?? 0);
    const start = mode === 'compare' && layerIndex === 1 ? compareWeights[0] : 0;
    const duration = mode === 'compare' ? compareWeights[layerIndex]
      : normalized || mode === 'detail' ? 1 : Math.max(.04, lengths[layerIndex] / maxLength);
    layer.phraseStart = start; layer.phraseDuration = duration;
    let previousTurn = 0;
    for (let i = 0; i < TRACE_TABLE_SIZE; i++) {
      const phase = i / TRACE_TABLE_SIZE, local = (phase - start) / duration;
      // A short silent gap and smooth ramps make an open arc a phrase, never a
      // fictitious closing segment. Heads/audio read the identical mapped phase.
      const progress = clamp((local - .04) / .92, 0, 1);
      const mapped = mode !== 'detail' && layerIndex > 0 && normalized
        ? interpolate(comparisons[layerIndex]?.correspondence, progress) : progress;
      const point = sampleMotifDescriptor(descriptor, mapped, { timing: normalized ? 'normalized' : 'original' });
      layer.geometricTurn[i] = point.turn;
      layer.motifPhase[i] = point.phase;
      layer.x[i] = (point.x - view.x) / view.width;
      layer.y[i] = (point.y - view.y) / view.width;
      let turn = mode === 'detail' ? (point.bands?.[layerIndex] ?? point.turn) * (layerIndex ? options.motifDetailGain ?? 2 : 1) : point.turn;
      if (options.travelerDetrend && descriptor.closed && (mode !== 'detail' || layerIndex === 0)) turn -= point.phase * (descriptor.totalTurn ?? 0);
      layer.turn[i] = turn;
      layer.bend[i] = clamp(Math.abs(turn - previousTurn) * 8, 0, 1);
      layer.fold[i] = clamp(Math.abs(point.bands?.[2] ?? 0) / Math.PI, 0, 1);
      previousTurn = turn;
      const gate = local > .04 && local < .96 ? Math.min(1, (local - .04) / .035, (.96 - local) / .035) : 0;
      layer.presence[i] = Math.sin(Math.PI / 2 * Math.max(0, gate)) ** 2;
    }
    addPhraseDrums(layer, options);
    layer.contacts = [{ x: layer.x, y: layer.y, bend: layer.bend, fold: layer.fold, turn: layer.turn,
      presence: layer.presence, turnPerLap: 0, registerOctaves: layer.registerOctaves, color: layer.color, pan: layer.pan }];
    bank.layers.push(layer);
  }
  return bank;
}

function addPhraseDrums(layer, options) {
  const angular = options.drumPlacement === 'turn', n = layer.x.length;
  const metric = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const amount = angular ? Math.abs(layer.geometricTurn[i] - layer.geometricTurn[i - 1]) : Math.hypot(layer.x[i] - layer.x[i - 1], layer.y[i] - layer.y[i - 1]);
    metric[i] = metric[i - 1] + (layer.presence[i] > .05 && layer.presence[i - 1] > .05 ? amount : 0);
  }
  const step = Math.max(angular ? (options.drumTurnStep ?? 30) * TAU / 360 : options.drumSpacing ?? .04, metric[n - 1] / 255);
  let next = step;
  for (let i = 1; i < n && layer.events.length < 256; i++) {
    while (metric[i] >= next && next > 0) {
      const blend = (next - metric[i - 1]) / Math.max(1e-15, metric[i] - metric[i - 1]);
      const phase = (i - 1 + blend) / n;
      const point = { x: layer.x[i - 1] + (layer.x[i] - layer.x[i - 1]) * blend,
        y: layer.y[i - 1] + (layer.y[i] - layer.y[i - 1]) * blend, bend: layer.bend[i], fold: layer.fold[i] };
      const bead = layer.beads.length;
      layer.beads.push({ id: bead, ...point, phases: [phase] });
      layer.events.push({ phase, bead, ...point, ...(angular && options.drumTurnColor ? { turnSign: Math.sign(layer.geometricTurn[i] - layer.geometricTurn[i - 1]) } : {}) });
      next += step;
      if (layer.events.length >= 256) break;
    }
  }
}
