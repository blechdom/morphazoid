import { HAND_VOICE_LIMITS, VOICE_SOURCES } from './hand-model.js';
import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';

const FIELDS = [
  ['pitch', 'Tune', .01], ['tone', 'Tone', .01], ['grain', 'Grain', .01],
  ['pan', 'Pan', .01], ['attackScale', 'Attack', .01], ['releaseScale', 'Release', .01],
];
const signed = (value, digits = 0) => `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
const duration = seconds => seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${Number(seconds.toFixed(2))} s`;
const sourceName = source => source[0].toUpperCase() + source.slice(1);

/** Selected-voice controls keep native input events and the application's state owner. */
export function createHandSoundControls({ read, selected, labels, colors, change, selectFinger, listen }) {
  const el = id => document.getElementById(id), knobs = [];
  for (let i = 0; i < 5; i++) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.finger = i;
    button.style.setProperty('--finger-color', colors[i]);
    listen(button, 'click', () => selectFinger(i));
    el('voiceTabs').append(button);
  }
  for (const source of VOICE_SOURCES) el('voiceSource').add(new Option(sourceName(source), source));
  listen(el('voiceSource'), 'change', event => {
    const index = selected(); change(config => { config.voices[index].source = event.target.value; });
  });
  for (const [key, label, step] of FIELDS) {
    const id = `voice-${key}`, [min, max] = HAND_VOICE_LIMITS[key];
    const field = document.createElement('div'); field.className = 'hand-sound-param';
    field.innerHTML = `<label for="${id}">${label}</label><div class="hand-sound-knob"><span><output id="${id}Out" for="${id}"></output></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" /></div>`;
    el('voiceTweakControls').append(field);
    const input = el(id);
    listen(input, 'input', () => {
      const index = selected(), value = Number(input.value);
      change(config => { config.voices[index][key] = value; });
    });
    knobs.push(enhanceRangeKnob(input));
  }
  return {
    sync() {
      const config = read(), index = selected(), voice = config.voices[index], names = labels();
      el('voiceSoundTitle').textContent = `${names[index]} sound`;
      el('voiceSound').style.setProperty('--voice-color', colors[index]);
      el('voiceSource').value = voice.source;
      el('voiceSource').setAttribute('aria-label', `${names[index]} engine`);
      for (const button of el('voiceTabs').children) {
        button.textContent = names[Number(button.dataset.finger)];
        button.setAttribute('aria-pressed', String(Number(button.dataset.finger) === index));
      }
      FIELDS.forEach(([key, label], i) => {
        const input = el(`voice-${key}`), value = voice[key];
        input.value = value;
        const text = key === 'pitch' ? `${signed(value, 2)} oct`
          : key.endsWith('Scale') ? duration(config.sound[key === 'attackScale' ? 'attack' : 'release'] * value)
          : `${signed(value * 100)}%`;
        el(`voice-${key}Out`).value = text;
        input.setAttribute('aria-label', `${names[index]} ${label.toLowerCase()}`);
        input.setAttribute('aria-valuetext', key.endsWith('Scale') ? `${text}, ${value} times shared ${label.toLowerCase()}` : text);
        knobs[i].update();
      });
    },
    destroy() { for (const knob of knobs) knob.destroy(); },
  };
}
