import { createAmplitudeControl } from "../../amplitude-control.js";
import { DEFAULT_ENVELOPE, sanitizeEnvelope } from './envelope-presets.js';
import { ENVELOPE_POINT_LIMIT, ENVELOPE_POINT_GAP, pointsFromEnvelope, envelopeFromBreakpoints } from './envelope-shape.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const secondsText = value => value < 1 ? Number((value * 1000).toFixed(1)) + ' ms' : Number(value.toFixed(3)) + ' s';
const labels = ['T', 'A', 'D', 'S', 'R'];
const logSpan = Math.log1p(ENVELOPE_POINT_LIMIT / .002);
const encode = time => .04 + .92 * Math.log1p(time / .002) / logSpan;
const decode = x => .002 * Math.expm1(clamp((x - .04) / .92, 0, 1) * logSpan);

export function adsrPoints(envelope = DEFAULT_ENVELOPE) {
  return pointsFromEnvelope(envelope).map(({ time, level }) => ({ x: encode(time), y: level }));
}

export function adsrFromPoints(points) {
  return envelopeFromBreakpoints(points.map(point => ({ time: Number(decode(point.x).toFixed(6)), level: point.y })));
}

/** Same Shape-family interaction, now backed by actual independent DSP points. */
export const SYNTH_ADSR_EDITOR_MODEL = Object.freeze({
  labels, fixedNodes: [], presetPoints: () => adsrPoints(DEFAULT_ENVELOPE),
  normalizePoints: points => adsrPoints(adsrFromPoints(points)),
  // Each button is two-dimensional: left/right time, up/down level.
  nodeAria: () => false,
  handlePoints(points, { width }) {
    const gap = Math.min(.21, 36 / Math.max(1, width));
    const handles = points.map(point => ({ ...point }));
    for (let index = 1; index < handles.length; index++) handles[index].x = Math.max(handles[index].x, handles[index - 1].x + gap);
    handles[4].x = Math.min(.96, handles[4].x);
    for (let index = 3; index >= 0; index--) handles[index].x = Math.min(handles[index].x, handles[index + 1].x - gap);
    return handles;
  },
  moveNode(points, index, point) {
    const values = adsrFromPoints(points).points;
    const minimum = index ? values[index - 1].time + ENVELOPE_POINT_GAP : 0;
    const maximum = index < 4 ? values[index + 1].time - ENVELOPE_POINT_GAP : ENVELOPE_POINT_LIMIT;
    values[index] = { time: clamp(Number(decode(point.x).toFixed(6)), minimum, maximum), level: clamp(point.y, 0, 1) };
    return adsrPoints(envelopeFromBreakpoints(values));
  },
  describeNode(points, index) {
    const point = adsrFromPoints(points).points[index];
    return labels[index] + ' envelope node · ' + secondsText(point.time) + ' · ' + Math.round(point.level * 100) + '% · left/right time, up/down level';
  },
  axis(points) {
    return adsrFromPoints(points).points.map((point, index) => labels[index] + ' ' + secondsText(point.time) + ' · ' + Math.round(point.level * 100) + '%');
  },
  note: 'Drag any node · time runs left/right on a log scale · S holds until note-off; R ends with a short fade to silence.',
});

export function createEnvelopeEditor(host, { onChange = () => {} } = {}) {
  if (!host?.append) throw new TypeError('An envelope editor needs a host element.');
  const root = document.createElement('div'); root.className = 'synth-envelope';
  const graph = document.createElement('div'); graph.className = 'synth-envelope__shared';
  const sharedHost = document.createElement('div'); graph.append(sharedHost);
  root.append(graph); host.append(root);
  let referenceValue = structuredClone(DEFAULT_ENVELOPE), referencePoints = adsrPoints(referenceValue);
  let syncing = false, destroyed = false;
  const shared = createAmplitudeControl(sharedHost, {
    label: 'Amplitude shape · T/A/D/S/R', presets: [], showLevel: false, allowDisable: false,
    editorModel: SYNTH_ADSR_EDITOR_MODEL,
    onChange(controller) {
      if (syncing || destroyed) return;
      const points = controller.state.points;
      const unchanged = points.every((point, index) => Math.abs(point.x - referencePoints[index].x) < 1e-7
        && Math.abs(point.y - referencePoints[index].y) < 1e-7);
      // Cancelling a drag restores the original legacy ADSR too, not a new mode.
      onChange(unchanged ? structuredClone(referenceValue) : adsrFromPoints(points));
    },
  });
  const syncGraph = (points = referencePoints) => {
    syncing = true;
    shared.applyState({ enabled: true, preset: 'custom', level: 1, points });
    syncing = false;
  };
  syncGraph();
  let width = 0;
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
    const next = entries[0]?.contentRect.width;
    if (next > 0 && next !== width) {
      const focusedNode = root.contains(document.activeElement) ? document.activeElement.dataset.node : null;
      width = next; syncGraph(shared.state.points);
      if (focusedNode != null) root.querySelector(`[data-node="${focusedNode}"]`)?.focus({ preventScroll: true });
    }
  }) : null;
  resize?.observe(root);
  return Object.freeze({
    setValue(envelope) {
      if (destroyed) return;
      referenceValue = structuredClone(sanitizeEnvelope(envelope)); referencePoints = adsrPoints(referenceValue);
      syncGraph();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; resize?.disconnect(); shared.destroy(); root.remove();
    },
  });
}
