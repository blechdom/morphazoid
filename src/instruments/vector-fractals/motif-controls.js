import { captureMotif, closestMotifCenter } from './motif-model.js';
import { createRangeField } from '../../ui/primitives/range-field.js';
import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';
import { sampleReaderLayer } from './trace-model.js';

const COLORS = ['#ffba76', '#c69bff', '#80d9ff'];
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const sample = (values, phase) => {
  const at = clamp(phase, 0, 1) * (values.length - 1), i = Math.floor(at);
  return values[i] + (values[Math.min(i + 1, values.length - 1)] - values[i]) * (at - i);
};

export function mountMotifControls({ getState, update, getContour, getSelectedPath, getBank, getView, onStatus }) {
  const abort = new AbortController(), fields = new Map(), knobs = [];
  const listen = (node, event, fn) => node.addEventListener(event, fn, { signal: abort.signal });
  const host = document.createElement('div'); host.id = 'motifTools';
  host.innerHTML = `
    <label class="vector-select">Listen to<select id="travelerMode"><option value="path">Whole path</option><option value="compare">Compare A then B</option><option value="choir">Matched motif choir</option><option value="detail">Broad shape + detail</option></select></label>
    <label class="motif-check"><input id="travelerDetrend" type="checkbox">Remove closed-loop pitch drift</label>
    <details id="motifLab" class="vector-disclosure"><summary>Motif selection & comparison</summary>
      <div id="motifSelectionKnobs" class="vector-knobs"></div>
      <label class="vector-select">Pick on border<select id="motifPick"><option value="none">Navigate / select strand</option><option value="a">Capture A on next click</option><option value="b">Capture B on next click</option><option value="c">Capture C on next click</option></select></label>
      <div class="motif-actions"><button id="motifCaptureA" type="button">Capture A</button><button id="motifCaptureB" type="button">Capture B</button><button id="motifCaptureC" type="button">Capture C</button></div>
      <output id="motifCaptureStatus" class="motif-note" aria-live="polite">Choose a border and capture a stretch.</output>
      <div class="motif-actions"><button id="motifFind" type="button">Find similar in view</button><button id="motifClear" type="button">Clear captures</button></div>
      <label class="vector-select">Candidates<select id="motifMatches" aria-label="Similar motif candidates"><option value="">Search the visible border</option></select></label>
      <output id="motifSearchStatus" class="motif-note" role="status"></output>
      <label class="vector-select">Travel timing<select id="motifTiming"><option value="normalized">Equal phrase duration</option><option value="original">Same travel speed</option></select></label>
      <label id="motifSameVoiceField" class="motif-check"><input id="motifSameVoice" type="checkbox">Use A voice for both</label>
      <div id="motifAnalysisKnobs" class="vector-knobs"></div>
      <div class="motif-actions"><label><input id="motifMirror" type="checkbox">Allow mirrors</label><label><input id="motifReverse" type="checkbox">Allow reverse</label></div>
      <canvas id="motifComparison" role="img" aria-label="Normalized motif shapes and signed turning profiles, with synchronized playheads"></canvas>
      <output id="motifAnalysis" class="motif-note">Capture A and B to compare them.</output>
      <details class="vector-disclosure"><summary>Size, orientation & detail voices</summary>
        <label class="vector-select">Size cue<select id="motifScaleCue"><option value="off">Off</option><option value="register">Size → register</option><option value="timbre">Size → brightness</option></select></label>
        <div id="motifCueKnobs" class="vector-knobs"></div>
      </details>
      <details class="vector-disclosure"><summary>Comparison examples</summary>
        <label class="vector-select">Example<select id="motifExample"><option value="copy">Rotated / smaller copy</option><option value="resampled">Unevenly sampled copy</option><option value="mirror">Mirror image</option><option value="different">Different shape</option></select></label>
        <button id="motifLoadExample" class="contour-next" type="button">Compare with example</button>
      </details>
      <p class="motif-note">A, B and C stay captured while you zoom. Center and span choose the next capture. Use the layer Tone / Drum switches and voices below.</p>
    </details>`;
  document.getElementById('travelerControls').append(host);
  const drum = document.createElement('div');
  drum.innerHTML = `<label class="vector-select">Bead placement<select id="drumPlacement"><option value="distance">Equal distance</option><option value="turn">Equal turning</option></select></label><div id="drumTurnKnobs" class="vector-knobs"></div><label id="drumTurnColorField" class="motif-check"><input id="drumTurnColor" type="checkbox">Different colors for left / right turns</label>`;
  document.getElementById('drumOptions').prepend(drum);
  const $ = id => document.getElementById(id);
  const overlay = document.createElement('canvas'); overlay.id = 'motifOverlay'; overlay.setAttribute('aria-hidden', 'true');
  $('contourStage').parentElement.append(overlay);
  const comparisonCanvas = $('motifComparison');
  const specs = [
    ['motifCenter', 'Capture center', 0, 1, .005, v => `${Math.round(v * 100)}% of path`, 'motifSelectionKnobs'],
    ['motifSpan', 'Capture span', .02, 1, .005, v => `${Math.round(v * 100)}% of path`, 'motifSelectionKnobs'],
    ['motifDetail', 'Detail scale', .002, .12, .001, v => `${(v * 100).toFixed(1)}% of motif`, 'motifAnalysisKnobs'],
    ['motifElastic', 'Time flexibility', 0, .12, .005, v => v ? `${Math.round(v * 100)}%` : 'Strict', 'motifAnalysisKnobs'],
    ['motifScaleAmount', 'Size amount', 0, 1, .01, v => `${Math.round(v * 100)}%`, 'motifCueKnobs'],
    ['motifOrientation', 'Orientation → pan', 0, 1, .01, v => v ? `${Math.round(v * 100)}%` : 'Off', 'motifCueKnobs'],
    ['motifDetailGain', 'Fine turn gain', 0, 6, .1, v => v ? `${v.toFixed(1)}×` : 'Off', 'motifCueKnobs'],
    ['drumTurnStep', 'Turn per hit', 5, 180, 1, v => `${Math.round(v)}°`, 'drumTurnKnobs'],
  ];
  for (const [key, label, min, max, step, format, target] of specs) {
    const field = createRangeField({ id: key, label, min, max, step, value: getState()[key], format, onInput: value => update({ [key]: value }) });
    $(target).append(field); fields.set(key, field); knobs.push(enhanceRangeKnob(field.input, { scale: key === 'motifDetail' ? 'log' : 'linear' }));
  }
  const selects = ['travelerMode', 'motifTiming', 'motifScaleCue', 'drumPlacement'];
  const checks = ['travelerDetrend', 'motifMirror', 'motifReverse', 'drumTurnColor', 'motifSameVoice'];
  for (const key of selects) listen($(key), 'change', () => update({ [key]: $(key).value }));
  for (const key of checks) listen($(key), 'change', () => update({ [key]: $(key).checked }));
  let worker = null, serial = 0, searching = false, matches = [], lastSearchKey = '', lastResult = null, lastBank = null, previousMode = 'path', selection = null, selectionKey = '', lastDraw = 0;

  function snapshot(pathIndex = getSelectedPath(), point = null) {
    const result = getContour(), s = getState();
    if (!result || pathIndex < 0) return null;
    return captureMotif(result, pathIndex, { center: point ? closestMotifCenter(result, pathIndex, point) : s.motifCenter, span: s.motifSpan, samples: 512 });
  }
  function capture(index, pathIndex, point) {
    const captured = snapshot(pathIndex, point);
    if (!captured) { onStatus('Wait for a completed border, then capture a stretch.'); return false; }
    const captures = Array.from({ length: 3 }, (_, i) => getState().motifCaptures[i] ?? null); captures[index] = captured;
    update({ motifCaptures: captures }); onStatus(`Captured motif ${'ABC'[index]}.`); return true;
  }
  for (let i = 0; i < 3; i++) listen($(`motifCapture${'ABC'[i]}`), 'click', () => capture(i));
  function cancelSearch(clear = false) {
    ++serial; worker?.terminate(); worker = null; searching = false; $('motifFind').disabled = false;
    if (clear) { matches = []; $('motifMatches').replaceChildren(new Option('Search the visible border', '')); $('motifSearchStatus').textContent = ''; }
  }
  function search() {
    const result = getContour(), reference = getState().motifCaptures[0] ?? snapshot();
    if (!result || !reference) { onStatus('Capture a reference on a completed border first.'); return; }
    cancelSearch(true);
    if (!getState().motifCaptures[0]) update({ motifCaptures: [reference, ...getState().motifCaptures.slice(1)] });
    lastResult = result; const id = ++serial, s = getState(); searching = true; $('motifFind').disabled = true;
    $('motifSearchStatus').textContent = 'Comparing stretches across sizes…';
    worker = new Worker(new URL('./motif-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.id !== serial) return;
      worker?.terminate(); worker = null; searching = false; $('motifFind').disabled = false;
      if (data.error) { $('motifSearchStatus').textContent = `Search could not finish: ${data.error}`; return; }
      matches = data.result.matches;
      $('motifMatches').replaceChildren(new Option(matches.length ? 'Choose a candidate for B' : 'No separate candidate in view', ''));
      matches.forEach((match, i) => $('motifMatches').append(new Option(`${i + 1} · ${Math.round(match.comparison.similarity * 100)}% resemblance · ${Math.round(match.span * 100)}% span`, String(i))));
      $('motifSearchStatus').textContent = `${data.result.examined} candidates compared${data.result.limited ? ' · bounded search' : ''}. Scores describe sampled geometry.`;
      if (matches.length) {
        $('motifMatches').value = '0';
        const captures = [reference, matches[0].snapshot, matches[1]?.snapshot ?? getState().motifCaptures[2] ?? null];
        update({ motifCaptures: captures });
      }
    };
    worker.onerror = () => { cancelSearch(); $('motifSearchStatus').textContent = 'Search stopped. Try a smaller view.'; };
    worker.postMessage({ id, reference, result, options: { detail: s.motifDetail, mirror: s.motifMirror, reverse: s.motifReverse, elastic: s.motifElastic, limit: 6, maxCandidates: 192 } });
  }
  listen($('motifFind'), 'click', search);
  listen($('motifMatches'), 'change', () => {
    if ($('motifMatches').value === '') return;
    const match = matches[Number($('motifMatches').value)];
    if (match) update({ motifCaptures: [getState().motifCaptures[0], match.snapshot, getState().motifCaptures[2] ?? null] });
  });
  listen($('motifClear'), 'click', () => { cancelSearch(true); update({ motifCaptures: [] }); });
  listen($('motifLoadExample'), 'click', () => {
    const reference = getState().motifCaptures[0] ?? snapshot();
    if (!reference) { onStatus('Wait for a completed border before loading an example.'); return; }
    const example = exampleFrom(reference, $('motifExample').value);
    update({ motifCaptures: [reference, example, getState().motifCaptures[2] ?? null], travelerMode: 'compare' });
    onStatus('Example B is a constructed comparison, not another discovered fractal location.');
  });

  function sync() {
    const s = getState(), visible = s.mode === 'explorer' && s.contourReader === 'traveler';
    host.hidden = !visible; overlay.hidden = !visible;
    if (!visible) $('motifPick').value = 'none';
    for (const key of selects) $(key).value = s[key];
    for (const key of checks) $(key).checked = s[key];
    for (const [key, field] of fields) field.setValue(s[key]);
    $('drumTurnKnobs').hidden = s.drumPlacement !== 'turn'; $('drumTurnColorField').hidden = s.drumPlacement !== 'turn';
    if (s.travelerMode !== previousMode && s.travelerMode !== 'path') $('motifLab').open = true;
    previousMode = s.travelerMode;
    $('motifSameVoiceField').hidden = s.travelerMode !== 'compare';
    $('layerVoice1').disabled = visible && s.travelerMode === 'compare' && s.motifSameVoice;
    if ($('layerVoice1').disabled) $('layerVoice1').value = s.layerVoices[0];
    $('motifCaptureStatus').textContent = ['A', 'B', 'C'].map((label, i) => `${label}: ${s.motifCaptures[i] ? s.motifCaptures[i].source?.example || 'captured' : 'live preview'}`).join(' · ');
    const referenceKey = JSON.stringify([s.motifCaptures[0], s.motifDetail, s.motifMirror, s.motifReverse, s.motifElastic]);
    if (referenceKey !== lastSearchKey) { cancelSearch(true); lastSearchKey = referenceKey; }
  }

  function draw(phase, view) {
    const s = getState(), result = getContour(), bank = getBank();
    if (lastResult && result !== lastResult) { cancelSearch(true); lastResult = null; $('motifSearchStatus').textContent = 'View changed. Search again when refinement finishes.'; }
    if (overlay.hidden) return;
    const now = performance.now(); if (now - lastDraw < 1000 / 30) return; lastDraw = now;
    const ctx = sizeCanvas(overlay), width = overlay.clientWidth, height = overlay.clientHeight;
    ctx.clearRect(0, 0, width, height);
    const project = (x, y) => [(x - view.x) / view.width * width + width / 2, height / 2 - (y - view.y) / view.width * width];
    const drawPath = (points, color, dashed = false) => {
      if (!points?.length) return;
      ctx.strokeStyle = color; ctx.lineWidth = dashed ? 1 : 2; ctx.setLineDash(dashed ? [4, 5] : []); ctx.beginPath();
      for (let i = 0; i < points.length / 2; i++) { const p = project(points[i * 2], points[i * 2 + 1]); if (!i) ctx.moveTo(...p); else ctx.lineTo(...p); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    const nextSelectionKey = `${getSelectedPath()}:${s.motifCenter}:${s.motifSpan}`;
    if (selectionKey !== nextSelectionKey || selection?.result !== result) { selection = { result, snapshot: snapshot() }; selectionKey = nextSelectionKey; }
    drawPath(selection?.snapshot?.points, '#d5e6ef99', true);
    const captures = bank?.motif ? bank.motifCaptures : s.motifCaptures;
    captures?.forEach((capture, i) => { if (capture) drawPath(capture.points, COLORS[i]); });
    if (bank?.motif) {
      for (let i = 0; i < 3; i++) {
        if (!s.layerEnabled[i]) continue;
        for (const point of sampleReaderLayer(bank.layers[i], phase)) {
          const p = project(bank.view.x + point.x * bank.view.width, bank.view.y + point.y * bank.view.width);
          ctx.fillStyle = COLORS[i]; ctx.globalAlpha = point.presence;
          ctx.beginPath(); ctx.arc(...p, 4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }
      }
    }
    if (bank !== lastBank) { lastBank = bank; updateAnalysis(bank); }
    if ($('motifLab').open) drawComparison(bank, phase, s);
  }

  function updateAnalysis(bank) {
    const comparison = bank?.motifComparisons?.[1];
    if (!comparison) {
      const description = bank?.motifMode === 'detail'
        ? 'Motif A · broad shape, curl detail and fine detail share one captured curve.'
        : 'Choose Compare or Choir to hear A and B. Detail voices read A at three smoothing scales.';
      $('motifAnalysis').textContent = description;
      comparisonCanvas.setAttribute('aria-label', `Normalized motif shape and signed turning profiles. ${description}`);
      return;
    }
    const words = [`A / B · ${Math.round(comparison.similarity * 100)}% resemblance`, `turn error ${(comparison.turnError * 360).toFixed(1)}°`, `shape error ${comparison.geometryError.toFixed(3)}`];
    if (comparison.mirrored) words.push('mirrored'); if (comparison.reversed) words.push('reversed');
    if (comparison.stability) words.push(comparison.stability.label);
    if (comparison.samplingStability) words.push(comparison.samplingStability.label);
    if (bank.timingLimited) words.push('very short motifs use a minimum duration');
    $('motifAnalysis').textContent = words.join(' · ');
    comparisonCanvas.setAttribute('aria-label', `Normalized motif shapes and signed turning profiles. ${words.join('. ')}. These are sampled-geometry measures, not recognition probabilities.`);
  }
  function drawComparison(bank, phase, s) {
    const ctx = sizeCanvas(comparisonCanvas), w = comparisonCanvas.clientWidth, h = comparisonCanvas.clientHeight;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#93a8b1'; ctx.font = '10px sans-serif';
    ctx.fillText('Normalized shape', 6, 13); ctx.fillText('Turning phrase', w * .5 + 6, 13);
    const comparison = bank?.motifComparisons?.[1], descriptors = bank?.motifDescriptors;
    if (!descriptors?.[0]) return;
    const shapes = comparison ? [comparison.overlay.a, comparison.overlay.b] : [descriptors[0].normalized];
    const extent = Math.max(1, ...shapes.filter(Boolean).flatMap(points => Array.from(points, Math.abs)));
    const shapeScale = Math.min(w * .21, (h - 30) * .43) / extent;
    shapes.forEach((points, index) => {
      if (!points) return; ctx.strokeStyle = COLORS[index]; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i < points.length / 2; i++) { const x = w * .25 + points[i * 2] * shapeScale, y = h * .54 - points[i * 2 + 1] * shapeScale; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
      const layer = bank.layers[index], position = Math.min(layer?.motifPhase?.length - 1, Math.floor(phase * (layer?.motifPhase?.length ?? 0)));
      if (layer?.presence?.[position] > .05 && s.layerEnabled[index]) {
        let u = layer.motifPhase[position];
        if (index && comparison?.correspondence) {
          const map = comparison.correspondence;
          let at = 1; while (at < map.length - 1 && map[at] < u) at++;
          u = (at - 1 + clamp((u - map[at - 1]) / Math.max(1e-12, map[at] - map[at - 1]), 0, 1)) / (map.length - 1);
        }
        const at = u * (points.length / 2 - 1), before = Math.floor(at), after = Math.min(before + 1, points.length / 2 - 1), mix = at - before;
        const x = points[before * 2] * (1 - mix) + points[after * 2] * mix, y = points[before * 2 + 1] * (1 - mix) + points[after * 2 + 1] * mix;
        ctx.fillStyle = COLORS[index]; ctx.beginPath(); ctx.arc(w * .25 + x * shapeScale, h * .54 - y * shapeScale, 3, 0, Math.PI * 2); ctx.fill();
      }
    });
    const shown = bank.layers.map(layer => layer.turn).filter(values => values?.length);
    const range = Math.max(.1, ...shown.flatMap(values => Array.from(values, Math.abs)));
    bank.layers.forEach((layer, index) => {
      if (!layer.turn?.length) return;
      ctx.strokeStyle = COLORS[index]; ctx.globalAlpha = s.layerEnabled[index] ? 1 : .25; ctx.beginPath();
      for (let i = 0; i < layer.turn.length; i++) {
        const x = w * .52 + i / (layer.turn.length - 1) * w * .45, y = h * .54 + layer.turn[i] / range * (h - 30) * .42;
        if (!i || layer.presence?.[i] < .01) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    });
    ctx.strokeStyle = '#e5edf055'; ctx.beginPath(); ctx.moveTo(w * .52 + phase * w * .45, 20); ctx.lineTo(w * .52 + phase * w * .45, h - 4); ctx.stroke();
  }
  return { sync, draw, select(point, pathIndex) {
    if (getState().mode !== 'explorer' || getState().contourReader !== 'traveler') return false;
    const index = ['a', 'b', 'c'].indexOf($('motifPick').value);
    if (index < 0) return false;
    if (capture(index, pathIndex, point)) $('motifPick').value = 'none';
    return true;
  }, diagnosticSnapshot() { return { mode: getState().travelerMode, captures: [0, 1, 2].map(i => Boolean(getState().motifCaptures[i])), searching, matches: matches.length,
    bankActive: Boolean(getBank()?.motif), analysis: getBank()?.motifComparisons?.map(c => c ? { similarity: c.similarity, geometryError: c.geometryError, turnError: c.turnError, mirrored: c.mirrored, reversed: c.reversed, stability: c.stability, samplingStability: c.samplingStability } : null) ?? [] }; },
  destroy() { cancelSearch(); abort.abort(); knobs.forEach(knob => knob.destroy()); fields.forEach(field => field.destroy()); host.remove(); drum.remove(); overlay.remove(); } };
}

function sizeCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), width = Math.max(1, Math.round(canvas.clientWidth * dpr)), height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return ctx;
}

function exampleFrom(reference, kind) {
  const points = reference.points, count = points.length / 2;
  const xs = Array.from({ length: count }, (_, i) => points[2 * i]), ys = Array.from({ length: count }, (_, i) => points[2 * i + 1]);
  const cx = xs.reduce((a, b) => a + b, 0) / count, cy = ys.reduce((a, b) => a + b, 0) / count;
  const extent = Math.max(1e-12, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const transformed = [], angle = Math.PI * .37, scale = .55, n = kind === 'resampled' ? 337 : count;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), phase = kind === 'resampled' ? u ** 1.8 : u;
    let x = sample(xs, phase) - cx, y = sample(ys, phase) - cy;
    if (kind === 'mirror') y = -y;
    if (kind === 'different') { x = (u - .5) * extent; y = extent * (.24 * Math.sin(6 * Math.PI * u) + .15 * u); }
    transformed.push(cx + extent * .7 + scale * (x * Math.cos(angle) - y * Math.sin(angle)), cy + scale * (x * Math.sin(angle) + y * Math.cos(angle)));
  }
  return { points: transformed, closed: kind === 'different' ? false : reference.closed,
    source: { ...reference.source, pathIndex: -1, example: { copy: 'rotated / smaller example', resampled: 'resampled example', mirror: 'mirror example', different: 'different example' }[kind] } };
}
