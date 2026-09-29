import { RUBIX_BANK_CONTROLS, rubixBankParams, formatRubixBankParam } from './sound-params.js';

/** Native controls only; state and audio remain in the owning instrument. */
export function createRubixSoundPanel(document, onChange) {
  const host = document.getElementById('bankSoundControls');
  let bank = null;
  const elements = new Map();
  return { update(nextBank, bankParams, legacy) {
    const controls = RUBIX_BANK_CONTROLS[nextBank] ?? [];
    host.hidden = controls.length === 0;
    if (bank !== nextBank) {
      bank = nextBank; elements.clear(); host.replaceChildren();
      const owner = host.ownerDocument;
      for (const control of controls) {
        const label = owner.createElement('label');
        const heading = owner.createElement('span');
        const title = owner.createElement('b'); title.textContent = control.label;
        const input = owner.createElement(control.options ? 'select' : 'input');
        input.id = `bank-${control.key}`; label.htmlFor = input.id;
        input.dataset.bankParam = control.key;
        label.className = control.options ? 'select-control' : 'control';
        heading.append(title); label.append(heading);
        let output;
        if (control.options) {
          for (const [value, text] of control.options) { const option = owner.createElement('option'); option.value = value; option.textContent = text; input.append(option); }
          const shell = owner.createElement('span'); shell.className = 'select-shell'; shell.append(input); label.append(shell);
        } else {
          input.type = 'range'; input.min = control.min; input.max = control.max; input.step = control.step;
          output = owner.createElement('output'); output.htmlFor = input.id; output.id = `${input.id}Out`;
          heading.append(output); label.append(input);
        }
        input.addEventListener(control.options ? 'change' : 'input', () => {
          const value = control.options ? input.value : Number(input.value);
          if (output) output.textContent = formatRubixBankParam(control, value);
          onChange(nextBank, control.key, value);
        });
        elements.set(control.key, { input, output }); host.append(label);
      }
    }
    const params = rubixBankParams(nextBank, bankParams, legacy);
    for (const control of controls) {
      const { input, output } = elements.get(control.key);
      input.value = String(params[control.key]);
      if (output) output.textContent = formatRubixBankParam(control, params[control.key]);
    }
  } };
}
