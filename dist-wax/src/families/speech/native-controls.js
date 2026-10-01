import { EXTENDED_ENGINES, nativeField, parameterValue, nativeSnapshot } from './extended-engines.js';
import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';
import { enhanceChooseSelect } from '../../ui/patterns/choose-select.js';

export function mountNativeVoiceControls(host, onChange) {
  if (!host) return {update(){},destroy(){}};
  let engine, controls = [];
  const clear = () => { for (const control of controls) control.widget?.destroy(); controls = []; host.replaceChildren(); };
  function update(state) {
    const spec = EXTENDED_ENGINES[state.engine];
    host.hidden = !spec;
    if (!spec) { if (engine) clear(); engine = null; return; }
    if (engine !== state.engine) {
      clear(); engine = state.engine;
      for (const [key, rule] of Object.entries(spec.controls)) {
        const label = document.createElement('label'); label.className = 'voice-native-control';
        const title = document.createElement('span'); title.textContent = rule.label;
        const output = document.createElement('output');
        const input = document.createElement(rule.choices ? 'select' : 'input');
        input.id = `native-${key}`; label.htmlFor = input.id;
        input.setAttribute('aria-label', rule.label);
        const dial = document.createElement('span'); dial.append(input);
        label.append(title, dial, output); host.append(label);
        let widget;
        if (rule.choices) {
          for (const value of rule.choices) { const option = document.createElement('option'); option.value = String(value); option.textContent = String(value).replaceAll('_',' '); input.append(option); }
          widget = enhanceChooseSelect(input, {label:rule.label});
        } else {
          input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '.002';
          widget = enhanceRangeKnob(input);
        }
        const reflect = () => {
          const value = rule.choices ? input.value : parameterValue(rule,Number(input.value));
          output.textContent = rule.choices ? '' : `${Number(value.toFixed(3))}${rule.unit ? ` ${rule.unit}` : ''}`;
          if (!rule.choices) input.setAttribute('aria-valuetext',output.textContent);
        };
        input.addEventListener(rule.choices ? 'change' : 'input', () => {
          const value = rule.choices ? rule.choices.find(value=>String(value)===input.value) : null;
          reflect(); onChange(nativeField(key), rule.choices ? nativeSnapshot(engine,{[key]:value})[nativeField(key)] : Number(input.value));
        });
        controls.push({input, rule, key, widget, reflect});
      }
    }
    for (const {input,rule,key,widget,reflect} of controls) {
      input.value = String(rule.choices ? parameterValue(rule,state[nativeField(key)]) : state[nativeField(key)]);
      input.disabled = state.switching;
      widget?.refresh?.(); widget?.update?.(); reflect();
    }
  }
  return {update,destroy:clear};
}
