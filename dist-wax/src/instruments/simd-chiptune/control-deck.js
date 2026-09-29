/** Instrument-owned knob panels. Musical state stays in the Chiptune controller. */
export function createSequenceKnob(doc, { label, min, max, step = 1, read, change, format = String, travel = 130, pageStep = step * 5, reset, capture, restore }) {
  const element = doc.createElement('div'); element.className = 'webgpu-knob';
  const dial = doc.createElement('div'); dial.className = 'webgpu-knob-dial'; dial.tabIndex = 0;
  dial.setAttribute('role', 'slider'); dial.setAttribute('aria-label', label);
  dial.setAttribute('aria-valuemin', String(min)); dial.setAttribute('aria-valuemax', String(max));
  const name = doc.createElement('span'); name.className = 'webgpu-knob-label'; name.textContent = label;
  const output = doc.createElement('output'); output.className = 'webgpu-knob-value';
  element.append(dial, name, output);
  let drag = null;
  const sync = () => {
    const value = read(), unit = (value - min) / (max - min), text = format(value);
    dial.style.setProperty('--knob-angle', (-135 + unit * 270) + 'deg');
    dial.style.setProperty('--knob-fill', unit * 75 + '%');
    dial.setAttribute('aria-valuenow', String(value)); dial.setAttribute('aria-valuetext', text);
    output.textContent = text;
  };
  const apply = value => { change(Math.min(max, Math.max(min, Math.round(value / step) * step))); sync(); };
  dial.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault(); dial.focus({ preventScroll: true });
    drag = { id: event.pointerId, y: event.clientY, value: read(), snapshot: capture?.() }; dial.setPointerCapture(event.pointerId);
  });
  dial.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    apply(drag.value + (drag.y - event.clientY) * (max - min) / travel);
  });
  const end = (event, cancel) => {
    if (drag?.id !== event.pointerId) return;
    const { value: before, snapshot } = drag; drag = null;
    if (dial.hasPointerCapture(event.pointerId)) dial.releasePointerCapture(event.pointerId);
    if (cancel) { if (restore) { restore(snapshot); sync(); } else apply(before); }
  };
  dial.addEventListener('pointerup', event => end(event, false));
  dial.addEventListener('pointercancel', event => end(event, true));
  dial.addEventListener('lostpointercapture', event => end(event, true));
  if (reset !== undefined) dial.addEventListener('dblclick', event => { event.preventDefault(); apply(reset); });
  dial.addEventListener('keydown', event => {
    const amount = step * (event.shiftKey ? 5 : 1);
    const next = { ArrowUp: read() + amount, ArrowRight: read() + amount, ArrowDown: read() - amount,
      ArrowLeft: read() - amount, Home: min, End: max, PageUp: read() + pageStep, PageDown: read() - pageStep }[event.key];
    if (next === undefined) return;
    event.preventDefault(); apply(next);
  });
  sync(); return { element, sync };
}


export function createSequenceScrollbar(doc, {
  label, orientation = 'horizontal', controls = 'stage', read, change, bounds, format = String,
}) {
  const vertical = orientation === 'vertical';
  const element = doc.createElement('div'); element.className = 'simd-sequence-scrollbar'; element.tabIndex = 0;
  element.setAttribute('role', 'scrollbar'); element.setAttribute('aria-label', label);
  element.setAttribute('aria-controls', controls); element.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
  const track = doc.createElement('span'); track.className = 'simd-scroll-track';
  const thumb = doc.createElement('span'); thumb.className = 'simd-scroll-thumb';
  track.append(thumb); element.append(track);
  let drag = null;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const range = () => {
    const { min, max, visible, total, step = 1, pageStep } = bounds();
    const fraction = total > 0 ? clamp(visible / total, 0, 1) : 1;
    return { min, max, step, fraction, pageStep: pageStep ?? step * 5 };
  };
  const sync = () => {
    const { min, max, fraction } = range(), value = clamp(read(), min, max);
    const start = max > min ? (value - min) / (max - min) * (1 - fraction) : 0;
    element.hidden = max <= min || fraction >= 1;
    element.style.setProperty('--scroll-start', start * 100 + '%');
    element.style.setProperty('--scroll-size', fraction * 100 + '%');
    element.setAttribute('aria-valuemin', String(min)); element.setAttribute('aria-valuemax', String(max));
    element.setAttribute('aria-valuenow', String(value)); element.setAttribute('aria-valuetext', format(value));
  };
  const apply = value => {
    const { min, max, step } = range();
    const next = clamp(min + Math.round((value - min) / step) * step, min, max);
    if (next !== read()) change(next);
    sync();
  };
  const position = event => vertical ? event.clientY : event.clientX;
  const geometry = () => {
    const rect = track.getBoundingClientRect();
    return { start: vertical ? rect.top : rect.left, size: vertical ? rect.height : rect.width };
  };
  const move = event => {
    const { min, max, fraction } = range(), { start, size } = geometry();
    const travel = size * (1 - fraction);
    if (travel <= 0) return;
    const unit = (position(event) - start - drag.grab * size * fraction) / travel;
    apply(min + clamp(unit, 0, 1) * (max - min));
  };
  element.addEventListener('pointerdown', event => {
    if (drag || element.hidden || (event.button !== undefined && event.button !== 0)) return;
    const { min, max, fraction } = range(), { start, size } = geometry();
    if (max <= min || size <= 0 || fraction >= 1) return;
    event.preventDefault(); event.stopPropagation(); element.focus({ preventScroll: true });
    const value = read(), offset = (value - min) / (max - min) * size * (1 - fraction);
    const grab = thumb.contains(event.target) && fraction > 0
      ? clamp((position(event) - start - offset) / (size * fraction), 0, 1) : .5;
    drag = { id: event.pointerId, value, grab };
    element.setPointerCapture(event.pointerId);
    move(event);
  });
  element.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); move(event);
  });
  const end = (event, cancelled) => {
    if (drag?.id !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (!cancelled) move(event);
    const original = drag.value; drag = null;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    if (cancelled) { change(original); sync(); }
  };
  element.addEventListener('pointerup', event => end(event, false));
  element.addEventListener('pointercancel', event => end(event, true));
  element.addEventListener('lostpointercapture', event => end(event, true));
  element.addEventListener('keydown', event => {
    const { min, max, step, pageStep } = range(), value = read();
    const next = { ArrowLeft: value - step, ArrowUp: value - step, ArrowRight: value + step,
      ArrowDown: value + step, Home: min, End: max, PageUp: value - pageStep, PageDown: value + pageStep }[event.key];
    if (next === undefined) return;
    event.preventDefault(); event.stopPropagation();
    if (!drag) apply(next);
  });
  element.addEventListener('wheel', event => {
    if (drag || element.hidden) return;
    const { min, max, step } = range(), value = read();
    const delta = vertical ? event.deltaY : event.deltaX || event.deltaY;
    const next = clamp(value + Math.sign(delta) * step, min, max);
    if (next === value) return;
    event.preventDefault(); event.stopPropagation(); apply(next);
  }, { passive: false });
  sync(); return { element, sync };
}

function tabs(doc, mount, definitions, { navigation = null } = {}) {
  const bar = navigation ?? doc.createElement('div'); bar.classList.add('simd-deck-tabs');
  bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Control group');
  if (!navigation) mount.append(bar);
  const entries = definitions.map(({ id, label }) => {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
    button.setAttribute('role', 'tab'); button.id = 'tab-' + id; button.setAttribute('aria-controls', 'panel-' + id);
    const panel = doc.createElement('div'); panel.className = 'simd-deck-panel'; panel.id = 'panel-' + id;
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
    bar.append(button); mount.append(panel); return { id, button, panel };
  });
  let selected = entries[0]?.id;
  const select = id => {
    selected = id;
    for (const item of entries) {
      const active = item.id === id;
      item.button.setAttribute('aria-selected', String(active)); item.button.tabIndex = active ? 0 : -1;
      item.panel.hidden = !active;
    }
  };
  for (const item of entries) {
    item.button.addEventListener('click', () => select(item.id));
    item.button.addEventListener('keydown', event => {
      const available = entries.filter(entry => !entry.button.hidden), index = available.indexOf(item);
      const next = { ArrowRight: (index + 1) % available.length, ArrowLeft: (index + available.length - 1) % available.length,
        Home: 0, End: available.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault(); select(available[next].id); available[next].button.focus();
    });
  }
  select(selected);
  return { entries, sync(available) {
    for (const entry of entries) entry.button.hidden = !available(entry.id);
    if (!entries.find(entry => entry.id === selected && !entry.button.hidden)) select(entries.find(entry => !entry.button.hidden)?.id);
    for (const entry of entries) entry.panel.hidden = entry.button.hidden || entry.id !== selected;
  } };
}

export function createSimdControlDeck(doc, {
  groups, modes, special, labels, notes, createKnob, setParam, params, sequence,
  specialControls, setLane, focusVoice, footerKeys = [],
}) {
  const external = new Set(['tempo', ...footerKeys]);
  const elements = [], groupBlocks = [], tabSets = [], sequenceKnobs = [], toggles = [];
  const usedSpecial = new Set();
  const mountKey = (key, mount) => {
    if (external.has(key)) return;
    if (special[key] === 'pitch-classes' || special[key] === 'gate-durations') {
      const type = special[key];
      if (usedSpecial.has(type)) return;
      usedSpecial.add(type);
      const element = specialControls[type];
      if (element) { mount.append(element); elements.push({ key, element }); }
      return;
    }
    let element;
    if (special[key] === 'toggle') {
      element = doc.createElement('button'); element.type = 'button'; element.className = 'mini-action';
      element.dataset.paramKey = key; element.textContent = labels[key] ?? key;
      element.addEventListener('click', () => setParam(key, params()[key] ? 0 : 1)); toggles.push({ key, element });
    } else {
      element = createKnob(key);
      if (labels[key]) {
        element.querySelector('.webgpu-knob-label').textContent = labels[key];
        element.querySelector('[role="slider"]').setAttribute('aria-label', labels[key]);
      }
      if (notes[key]) element.title = notes[key];
    }
    elements.push({ key, element }); mount.append(element);
  }
  const groupBody = (group, mount) => {
    const keys = [...group.core, ...group.detail].filter(key => !external.has(key));
    if (!keys.length) return;
    const block = doc.createElement('section'); block.className = 'simd-control-group'; block.dataset.controlGroup = group.id;
    const grid = doc.createElement('div'); grid.className = 'simd-knob-grid';
    for (const key of keys) mountKey(key, grid);
    block.append(grid); mount.append(block); groupBlocks.push({ keys, block });
  };
  const globalGroups = groups.filter(group => group.owner === 'global');
  const globalMount = doc.getElementById('knobControls'); globalMount.replaceChildren();
  const globalTabs = tabs(doc, globalMount, globalGroups, { navigation: doc.getElementById('simdGlobalTabs') });
  for (const entry of globalTabs.entries) groupBody(globalGroups.find(group => group.id === entry.id), entry.panel);
  tabSets.push({ tabs: globalTabs, owners: globalGroups.map(group => ({ id: group.id, groups: [group] })) });
  const fractions = [1/128, 1/64, 1/32, 1/24, 1/16, 1/12, 1/8, 1/6, 1/4, 1/3, 3/8, 1/2, 2/3, 1, 2, 3, 4, 5/8, 3/4, 8, 16].sort((a,b) => a-b);
  const fractionText = value => {
    for (let denominator = 1; denominator <= 128; denominator++) {
      const numerator = Math.round(value * denominator);
      if (Math.abs(numerator / denominator - value) < .000001) return numerator + '/' + denominator;
    }
    return value.toFixed(3);
  };
  const rhythm = (lane, owner, mount) => {
    const grid = doc.createElement('div'); grid.className = 'simd-knob-grid simd-pattern-rhythm'; grid.dataset.sequenceLane = lane;
    const update = changes => { focusVoice(owner, owner === 'drums' ? lane : undefined); setLane(lane, changes); };
    const specs = [
      { label: 'Steps', min: 1, max: 32, read: () => sequence().lanes[lane].activeLength, change: activeLength => update({ activeLength }) },
      { label: 'Step time', min: 0, max: fractions.length - 1, patternOnly: true,
        read: () => fractions.reduce((best, value, index) => Math.abs(value - sequence().lanes[lane].stepBeats) < Math.abs(fractions[best] - sequence().lanes[lane].stepBeats) ? index : best, 0),
        format: () => fractionText(sequence().lanes[lane].stepBeats) + ' beat', change: value => update({ stepBeats: fractions[value] }) },
    ];
    if (owner !== 'drums') specs.push({ label: 'Note length', min: 5, max: 100, patternOnly: true,
      title: '% of each step; increase Step time for longer, slower notes.',
      read: () => Math.round(sequence().lanes[lane].gate * 100), format: value => value + '%', change: value => update({ gate: value / 100 }) });
    for (const spec of specs) {
      const knob = createSequenceKnob(doc, spec); knob.element.dataset.sequenceParam = spec.label;
      if (spec.title) knob.element.title = spec.title;
      if (spec.label === 'Steps') knob.element.title = 'Independent loops: lane length. Song: length of the repeating edited-step overlay.';
      grid.append(knob.element); sequenceKnobs.push({ ...knob, patternOnly: spec.patternOnly });
    }
    mount.prepend(grid);
  };
  for (const owner of ['drums', 'bass', 'arp', 'lead', 'upperOne', 'upperTwo', 'noise']) {
    const mount = doc.querySelector(`.simd-voice-controls[data-voice="${owner}"]`); mount.replaceChildren();
    const ownGroups = groups.filter(group => group.owner === owner);
    if (owner === 'drums') {
      const definitions = [{ id: 'drums-kit', label: 'Kit', part: null },
        ...['kick', 'snare', 'hats', 'shaker'].map(part => ({ id: 'drums-' + part, label: { kick: 'Kick', snare: 'Snare', hats: 'Hats', shaker: 'Shaker' }[part], part }))];
      const deck = tabs(doc, mount, definitions), owners = [];
      for (const entry of deck.entries) {
        const { part } = definitions.find(item => item.id === entry.id);
        if (part) entry.button.addEventListener('click', () => focusVoice(owner, part));
        const assigned = ownGroups.filter(group => (group.part ?? null) === part);
        for (const group of assigned) groupBody(group, entry.panel);
        if (part) rhythm(part, owner, entry.panel);
        owners.push({ id: entry.id, groups: assigned, sequenceLane: part });
      }
      tabSets.push({ tabs: deck, owners });
    } else {
      const panel = doc.createElement('div'); panel.className = 'simd-deck-panel simd-flat-panel';
      panel.id = 'panel-' + owner; panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', owner + ' sound and sequence controls');
      mount.append(panel);
      for (const group of ownGroups) groupBody(group, panel);
      if (owner !== 'noise') rhythm(owner, owner, panel);
      else {
        const note = doc.createElement('p'); note.className = 'simd-deck-note'; note.textContent = 'The sweep plays in Song arrangement.';
        note.dataset.noiseModeNote = ''; panel.append(note);
      }
    }
  }
  const applicable = key => sequence().mode === 'song' || modes[key] !== 'song';
  return { sync() {
    for (const { key, element } of elements) element.hidden = !applicable(key);
    for (const { key, element } of toggles) element.setAttribute('aria-pressed', String(Boolean(params()[key])));
    for (const { keys, block } of groupBlocks) block.hidden = !keys.some(applicable);
    for (const item of tabSets) item.tabs.sync(id => {
      const owner = item.owners.find(owner => owner.id === id);
      return Boolean(owner.sequenceLane) || owner.groups.some(group => group.keys.some(key => !external.has(key) && applicable(key)));
    });
    for (const knob of sequenceKnobs) {
      knob.element.hidden = Boolean(knob.patternOnly) && sequence().mode !== 'pattern';
      knob.sync();
    }
    doc.querySelector('[data-noise-mode-note]').hidden = sequence().mode === 'song';
  } };
}
