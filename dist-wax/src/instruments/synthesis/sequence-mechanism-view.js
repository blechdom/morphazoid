import { getSequenceStudy } from './sequence-catalog.js';
import { applySequenceParameterValues } from './sequence-parameters.js';
import { compileSequence } from './sequence-compiler.js';

// These are readouts of this engine's effective data, not replicas of product
// panels. Tracker columns: https://tutorials.renoise.com/wiki/Pattern_Editor
// Note traversal: https://www.ableton.com/en/live-manual/11/live-midi-effect-reference/
// Stored time functions: https://doi.org/10.1145/362814.362817
const TITLES = Object.freeze({
  tracker: 'Tracker rows',
  'phrase-bank': 'Phrase memory',
  'ordered-chord': 'Held notes and traversal',
  'phrase-arp': 'Chord traversal',
  markov: 'Next-state probabilities',
  'ratio-canon': 'Independent pulse lanes',
  polymeter: 'Independent note lanes',
  'drawn-rows': 'Drawn control rows',
  'parameter-rows': 'Independent parameter rows',
  'accent-pattern': 'Notes and accents',
  groove: 'Timing and accents',
  'mutating-loop': 'Mutation passes',
  'conditional-steps': 'Conditions and chance',
});
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const whole = (value, min, max, fallback = min) => Math.round(clamp(finite(value, fallback), min, max));
const modulo = (value, size) => (value % size + size) % size;
const at = (array, index, fallback) => Array.isArray(array) && array.length ? array[modulo(index, array.length)] : fallback;
const number = value => Number(finite(value).toFixed(2)).toString();
const percent = value => `${number(finite(value) * 100)}%`;
const offset = value => `${finite(value) > 0 ? '+' : ''}${number(value)}`;
const pitch = value => value == null ? '—' : Array.isArray(value)
  ? value.length ? `[${value.map(pitch).join(' ')}]` : '—'
  : typeof value === 'object' ? Number.isFinite(value.ratio) && value.ratio > 0
    ? `×${number(value.ratio)}` : offset(value.semitone) : offset(value);
const notes = value => Array.isArray(value) ? value.length ? value.map(pitch).join(' · ') : '—' : pitch(value);
const orderName = order => ({ up: 'Low → high', down: 'High → low', pendulum: 'Up → down', played: 'As stored', 'inside-out': 'Inside → out', 'outside-in': 'Outside → in' })[order] || order;
const row = (label, value) => ({ type: 'text', label, value: String(value) });
const table = (columns, rows, label = '') => ({ type: 'table', columns, rows, label });
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const resolve = value => getSequenceStudy(typeof value === 'string' ? value : value?.id);

/** Exact next-state weights after the compiler's leap and edge clamps. */
export function markovTransitionMatrix(config = {}) {
  const count = Math.max(1, Math.min(64, config.states?.length || 1));
  const leap = whole(config.maxLeap, 1, count, count);
  return Array.from({ length: count }, (_, state) => {
    const source = at(config.transitions, state, [1]);
    const weights = (Array.isArray(source) && source.length ? source : [1]).slice(0, 129).map(value => Math.max(0, finite(value)));
    const total = weights.reduce((sum, value) => sum + value, 0);
    const result = Array(count).fill(0);
    const target = index => whole(state + clamp(index - Math.floor(weights.length / 2), -leap, leap), 0, count - 1);
    if (!(total > 0)) result[target(0)] = 1;
    else weights.forEach((weight, index) => { result[target(index)] += weight / total; });
    return result;
  });
}

function outputPath(cycle, start = 0, length = cycle.steps.length) {
  return cycle.steps.slice(start, start + length).map((step, index) => ({
    text: notes(step.notes), outputStep: start + index,
    detail: `Step ${start + index + 1}: ${notes(step.notes)}; beat ${number(step.at)}; duration ${number(step.duration)} beats`,
  }));
}

/** A small serializable description of real mechanism state, suitable for tests. */
export function buildSequenceMechanismModel(studyOrId, parameters = {}, suppliedCycle) {
  const study = resolve(studyOrId);
  if (!study || !TITLES[study.archetype]) return null;
  const { config, values } = applySequenceParameterValues(study, parameters);
  const cycle = suppliedCycle?.studyId === study.id && Array.isArray(suppliedCycle.steps)
    && suppliedCycle.steps.length > 0 && suppliedCycle.steps.length <= 64
    && suppliedCycle.steps.every(step => Array.isArray(step?.notes) && step.notes.length <= 8)
    && JSON.stringify(suppliedCycle.parameters) === JSON.stringify(values)
    ? suppliedCycle : compileSequence(study, { parameters: values });
  const blocks = [];
  let caption = 'Source values are before cycle transpose, density and tuning; scheduled output includes those mappings.';
  const path = () => ({ type: 'path', label: cycle.steps.some(step => step.notes.some(note => Number.isFinite(note.ratio)))
    ? 'Scheduled output · tuned ratios' : 'Scheduled output · pitch offsets', cells: outputPath(cycle) });
  switch (study.archetype) {
    case 'tracker': {
      const remembered = new Set(config.remember || []);
      blocks.push(table(['Row', 'Pitch offsets', 'Velocity', 'Row gate'], config.rows.map((entry, index) => [
        String(index + 1).padStart(2, '0'), notes(entry.notes),
        Number.isFinite(entry.velocity) ? percent(entry.velocity) : remembered.has('velocity') ? 'carry' : '72% default',
        Number.isFinite(entry.gate) ? percent(entry.gate) : remembered.has('gate') ? 'carry' : '100% default',
      ])));
      caption = 'Stored row locks. “Carry” keeps the preceding value; row gate is multiplied by the cycle gate.';
      break;
    }
    case 'phrase-bank':
      blocks.push({ type: 'chain', label: 'Chain', cells: config.chain.map((phrase, index) => ({
        text: `${String.fromCharCode(65 + phrase)}${at(config.phraseTranspose, index, 0) ? ` (${offset(at(config.phraseTranspose, index, 0))})` : ''}`,
        detail: `Chain position ${index + 1}: phrase ${phrase + 1}, transposition ${offset(at(config.phraseTranspose, index, 0))}`,
      })) });
      blocks.push(table(['Phrase', 'Stored events'], config.phrases.map((phrase, index) => [String.fromCharCode(65 + index), phrase.map(pitch).join(' → ')])));
      caption = 'Effective phrase order and chain transpositions. Brackets are simultaneous notes; — is a rest.';
      break;
    case 'ordered-chord':
      blocks.push(row('Held offsets', config.intervals.map(pitch).join(' · ')), row('Traversal', orderName(config.order)), row('Octave range', config.octaves), path());
      break;
    case 'phrase-arp':
      blocks.push(table(['Chord', 'Held offsets'], config.chords.map((chord, index) => [String(index + 1), notes(chord)])),
        row('Traversal', `${orderName(config.order)} · ${config.repeats || 1} pass${(config.repeats || 1) === 1 ? '' : 'es'}`),
        row('Opening chord', config.strum ? 'Simultaneous chord' : 'Individual notes'), path());
      break;
    case 'markov': {
      const matrix = markovTransitionMatrix(config);
      blocks.push(table(['From → to', ...config.states.map((value, index) => `S${index + 1}`)], matrix.map((weights, index) => [
        `S${index + 1} · ${pitch(config.states[index])}`,
        ...weights.map(probability => ({ text: probability > 0 ? percent(probability) : '—', probability })),
      ])));
      caption = `Starts at S${Math.floor(config.states.length / 2) + 1}. Weights include the maximum-leap and register-edge clamps, before output thinning.`;
      break;
    }
    case 'ratio-canon':
      blocks.push({ type: 'lanes', label: 'Source pulse positions', lanes: config.voices.map((voice, index) => {
        const period = whole(voice.period, 1, 64, 1), phase = whole(voice.phase, -64, 64, 0);
        return { label: `Lane ${index + 1} · every ${period} · phase ${phase} · ×${number(voice.pitchRatio)}`,
          cells: Array.from({ length: values.steps }, (_, step) => modulo(step - phase, period) === 0 ? `×${number(voice.pitchRatio)}` : null) };
      }) });
      if (config.ramp) blocks.push(row('Duration ramp', config.ramp > 0 ? `Accelerating · ${number(config.ramp)}` : `Decelerating · ${number(config.ramp)}`));
      caption = 'Independent pulse lanes before output thinning. Columns are clock positions, not equal elapsed-time widths when duration changes.';
      break;
    case 'polymeter':
      blocks.push({ type: 'lanes', label: 'Source note positions', lanes: config.lanes.map((lane, index) => {
        const period = whole(lane.period, 1, 64, lane.notes.length), phase = whole(lane.phase, -64, 64, 0);
        return { label: `Lane ${index + 1} · period ${period} · phase ${phase}`,
          cells: Array.from({ length: values.steps }, (_, step) => {
            const local = modulo(step + phase, period);
            return local < lane.notes.length && lane.notes[local] != null ? pitch(lane.notes[local]) : null;
          }) };
      }) });
      caption = 'Each lane retains its own period, phase and rests. These are source lanes, before output thinning and tuning.';
      break;
    case 'drawn-rows':
      blocks.push({ type: 'curves', label: 'Source pitch curves', rows: config.rows.map((points, index) => ({
        label: `Row ${index + 1}`, points: [...points],
        mask: Array.isArray(config.masks?.[index]) ? [...config.masks[index]] : null,
        velocity: Array.isArray(config.velocities?.[index]) ? [...config.velocities[index]] : null,
      })) });
      caption = 'Stored pitch anchors are linearly interpolated; cutout masks remove events. No continuous portamento is implied.';
      break;
    case 'parameter-rows':
      blocks.push(table(['Row', 'Period', 'Stored values'], [
        ['Pitch offsets', config.pitch.length, config.pitch.map(pitch).join(' · ')],
        ['Velocity', config.velocity.length, config.velocity.map(percent).join(' · ')],
        ['Row gate', config.gate.length, config.gate.map(percent).join(' · ')],
        ['Duration ×', config.duration.length, config.duration.map(number).join(' · ')],
      ]));
      caption = 'Each row wraps independently. Duration multiplies the step length; row gate multiplies the cycle gate.';
      break;
    case 'accent-pattern':
    case 'groove': {
      const accents = new Set(config.accents || []);
      blocks.push(table(['Step', 'Pitch offsets', 'Accent', ...(config.timing ? ['Duration ×'] : [])], config.notes.map((note, index) => [
        index + 1, pitch(note), accents.has(index) ? '●' : '—', ...(config.timing ? [number(at(config.timing, index, 1))] : []),
      ])));
      if (config.rotateEvery) blocks.push(row('Evolution', `Rotate after ${config.rotateEvery} pattern pass${config.rotateEvery === 1 ? '' : 'es'}`));
      caption = 'Source pattern before output thinning and tuning. Accent increases note velocity; duration changes timing, not pitch.';
      break;
    }
    case 'mutating-loop': {
      blocks.push(row('Base loop', config.base.map(pitch).join(' · ')), row('Mutation pool', config.mutationSet.map(pitch).join(' · ')),
        row('Rules', `${percent(config.probability)} mutation · ${config.generations || 4} generations${config.mirrorEvery ? ` · mirror every ${config.mirrorEvery}` : ''}`));
      const passes = Math.ceil(cycle.steps.length / config.base.length);
      blocks.push({ type: 'passes', label: 'Compiled passes · current seed', passes: Array.from({ length: passes }, (_, index) => ({
        label: `Pass ${index + 1}`, cells: outputPath(cycle, index * config.base.length, config.base.length),
      })) });
      caption = 'Passes show the actual compiled note output for this seed, including mutation, resets and rests.';
      break;
    }
    case 'conditional-steps':
      blocks.push(table(['Rule', 'Pitch offsets', 'Every', 'Offset', 'Base chance'], config.cells.map((cell, index) => [
        index + 1, pitch(cell.note), cell.every == null ? 'each step' : cell.every,
        cell.every == null ? '—' : cell.offset || 0, percent(cell.probability ?? 1),
      ])));
      if (config.breathe) blocks.push(row('Probability breath', percent(config.breathe)));
      caption = 'Recurrence gates each rule before chance, density breath and final output thinning. Multiple rules can coincide.';
      break;
    default: return null;
  }
  return freeze({ id: study.id, kind: study.archetype, title: TITLES[study.archetype], caption, blocks });
}

/** Passive HTML/SVG only; state and timing remain owned by the instrument. */
export function createSequenceMechanismView(host, studyOrId, parameters, cycle) {
  let model = buildSequenceMechanismModel(studyOrId, parameters, cycle);
  if (!model || !host?.ownerDocument) return null;
  const doc = host.ownerDocument;
  const element = doc.createElement('section'); element.className = 'synthesis-sequence-mechanism';
  element.dataset.sequenceMechanism = model.kind;
  host.append(element);
  let disposed = false, lastCursor = null;
  const make = (tag, text, className) => {
    const node = doc.createElement(tag); if (text != null) node.textContent = String(text);
    if (className) node.className = className; return node;
  };
  function addCells(parent, cells, className = 'synthesis-mechanism-path') {
    const list = make('ol', null, className);
    for (const cell of cells) {
      const item = make('li', cell.text); if (cell.detail) item.title = cell.detail;
      if (Number.isInteger(cell.outputStep)) item.dataset.outputStep = cell.outputStep;
      list.append(item);
    }
    parent.append(list);
  }
  function render() {
    if (disposed) return;
    const fragment = doc.createDocumentFragment(); fragment.append(make('h3', model.title));
    for (const block of model.blocks) {
      const section = make('div', null, 'synthesis-mechanism-block');
      if (block.label) section.append(make('div', block.label, 'synthesis-mechanism-label'));
      if (block.type === 'text') section.append(make('span', block.value, 'synthesis-mechanism-value'));
      else if (block.type === 'table') {
        const scroll = make('div', null, 'synthesis-mechanism-table-scroll'), tableNode = make('table');
        tableNode.setAttribute('aria-label', block.label || model.title);
        const head = make('thead'), heading = make('tr');
        for (const label of block.columns) { const cell = make('th', label); cell.scope = 'col'; heading.append(cell); }
        head.append(heading); tableNode.append(head);
        const body = make('tbody');
        for (const cells of block.rows) {
          const tr = make('tr');
          cells.forEach((value, index) => {
            const structured = value && typeof value === 'object', cell = make(index ? 'td' : 'th', structured ? value.text : value);
            if (!index) cell.scope = 'row';
            if (structured && Number.isFinite(value.probability)) cell.style.backgroundColor = `rgba(164, 113, 223, ${clamp(value.probability, 0, 1) * .6})`;
            tr.append(cell);
          }); body.append(tr);
        }
        tableNode.append(body); scroll.append(tableNode); section.append(scroll);
      } else if (block.type === 'chain' || block.type === 'path') addCells(section, block.cells, block.type === 'chain' ? 'synthesis-mechanism-chain' : undefined);
      else if (block.type === 'passes') {
        for (const pass of block.passes) {
          const lane = make('div', null, 'synthesis-mechanism-pass'); lane.append(make('span', pass.label)); addCells(lane, pass.cells); section.append(lane);
        }
      } else if (block.type === 'lanes') {
        for (const lane of block.lanes) {
          const label = make('div', lane.label, 'synthesis-mechanism-lane-label'); section.append(label);
          const strip = make('div', null, 'synthesis-mechanism-lane');
          strip.setAttribute('role', 'img'); strip.setAttribute('aria-label', `${lane.label}. ${lane.cells.map((value, index) => value == null ? null : `${index + 1}: ${value}`).filter(Boolean).join('; ')}`);
          for (let index = 0; index < lane.cells.length; index++) {
            const value = lane.cells[index], cell = make('span', null, value == null ? '' : 'is-on');
            cell.setAttribute('aria-hidden', 'true'); cell.title = `Clock position ${index + 1}: ${value ?? 'rest'}`; strip.append(cell);
          }
          section.append(strip);
        }
      } else if (block.type === 'curves') {
        const all = block.rows.flatMap(lane => lane.points), min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
        for (const lane of block.rows) {
          section.append(make('div', `${lane.label} · ${lane.points.map(pitch).join(' · ')}`, 'synthesis-mechanism-lane-label'));
          const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('synthesis-mechanism-curve');
          svg.setAttribute('viewBox', '0 0 400 64'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'img');
          svg.setAttribute('aria-label', `${lane.label}: stored pitch anchors ${lane.points.map(pitch).join(', ')}`);
          const pathNode = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
          pathNode.setAttribute('d', lane.points.map((value, index) => `${index ? 'L' : 'M'}${8 + index / Math.max(1, lane.points.length - 1) * 384},${54 - (value - min) / span * 44}`).join(' '));
          pathNode.setAttribute('vector-effect', 'non-scaling-stroke'); svg.append(pathNode); section.append(svg);
          if (lane.mask) section.append(make('div', `Cutouts: ${lane.mask.map(value => value ? 'sound' : 'rest').join(' · ')}`, 'synthesis-mechanism-secondary'));
          if (lane.velocity) section.append(make('div', `Velocity: ${lane.velocity.map(percent).join(' · ')}`, 'synthesis-mechanism-secondary'));
        }
      }
      fragment.append(section);
    }
    fragment.append(make('p', model.caption, 'synthesis-mechanism-caption'));
    element.replaceChildren(fragment); paintCursor();
  }
  function paintCursor() {
    for (const cell of element.querySelectorAll('[data-output-step]')) cell.classList.toggle('is-current', Number(cell.dataset.outputStep) === lastCursor);
  }
  render();
  return {
    element,
    kind: model.kind,
    ownedParameterIds: Object.freeze([]),
    setValue(next, nextCycle) { if (!disposed) { model = buildSequenceMechanismModel(studyOrId, next, nextCycle); render(); } },
    setCursor(cursor) { lastCursor = Number.isInteger(cursor) ? cursor : null; if (!disposed) paintCursor(); },
    destroy() { disposed = true; element.remove(); },
  };
}
