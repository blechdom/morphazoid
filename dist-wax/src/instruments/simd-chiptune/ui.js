import { createChoosePickerShell, anchorChoosePickerPanel } from '../../ui/patterns/choose-picker-shell.js';

/** The same Choose surface as the site header, mounted beside this instrument's transport. */
export function createSimdPresetPicker(select, presets, choose) {
  const doc = select.ownerDocument;
  const shell = createChoosePickerShell(doc, {
    current: 'Select Preset', label: 'Choose chiptune preset', title: 'Chiptune presets',
    panelId: 'simd-preset-panel', placeholder: 'Type a preset', filterLabel: 'Filter presets', listLabel: 'Chiptune presets',
  });
  shell.details.id = 'simdPresetPicker';
  shell.panel.append(shell.search, shell.list);
  shell.details.append(shell.summary, shell.panel);
  (select.closest("label") ?? select).replaceWith(shell.details);
  const buttons = presets.map(preset => {
    const row = doc.createElement('div');
    row.className = 'instrument-picker-row';
    const button = doc.createElement('button');
    button.type = 'button'; button.className = 'instrument-picker-link';
    button.dataset.presetId = preset.id; button.textContent = preset.label;
    button.addEventListener('click', () => {
      choose(preset); shell.details.open = false; shell.summary.focus();
    });
    row.append(button); shell.list.append(row); return button;
  });
  const anchor = anchorChoosePickerPanel(shell);
  shell.searchInput.addEventListener('input', () => {
    const needle = shell.searchInput.value.toLowerCase().trim();
    for (const button of buttons) button.parentElement.hidden = !button.textContent.toLowerCase().includes(needle);
  });
  shell.details.addEventListener('keydown', event => {
    if (event.key === 'Escape') { shell.details.open = false; shell.summary.focus(); }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.target === shell.searchInput) return;
    event.preventDefault();
    const visible = buttons.filter(button => !button.parentElement.hidden), index = visible.indexOf(doc.activeElement);
    visible[(index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length]?.focus();
  });
  const outside = event => { if (!shell.details.contains(event.target)) shell.details.open = false; };
  doc.addEventListener('pointerdown', outside);
  return {
    sync(id) {
      shell.currentLabel.textContent = presets.find(preset => preset.id === id)?.label ?? 'Custom';
      for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.presetId === id));
    },
    destroy() { anchor.destroy(); doc.removeEventListener('pointerdown', outside); },
  };
}

export function drawNoiseSweep(context, width, height, actor, params, pattern) {
  context.save();
  context.fillStyle = '#060d12'; context.fillRect(0, 0, width, height);
  context.font = '600 12px ui-monospace, monospace'; context.fillStyle = '#b5b3ff';
  context.fillText(pattern ? 'Noise texture plays in Song mode' : 'Noise sweep', 16, 24);
  const left = 16, top = 48, bottom = height - 24, span = width - left * 2;
  for (let step = 0; step <= 4; step++) {
    const y = top + (bottom - top) * step / 4;
    context.strokeStyle = '#213039'; context.beginPath(); context.moveTo(left, y); context.lineTo(width - left, y); context.stroke();
  }
  for (const [key, color] of [['textureDecay', '#b5b3ff'], ['textureSweep', '#55e4c5']]) {
    context.beginPath();
    for (let point = 0; point <= 160; point++) {
      const x = left + span * point / 160;
      const y = bottom - Math.exp(-point / 160 * params.texturePeriod * params[key]) * (bottom - top);
      if (point) context.lineTo(x, y); else context.moveTo(x, y);
    }
    context.strokeStyle = color; context.lineWidth = 2; context.globalAlpha = pattern ? .35 : .8; context.stroke();
  }
  if (!pattern) {
    const x = left + actor.stepPhase * span;
    context.strokeStyle = '#f4c95d'; context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.stroke();
  }
  context.restore();
}
