import { presetStateKey } from './header-presets.js';
import { presetRandom, clonePresetData } from './preset-random.js';

/** Explicit, owner-authored flat scene fields. Never inspect DOM controls or live state. */
export function createPresetSchema(fields) {
  const keys = Object.keys(fields);
  function validate(value) {
    presetStateKey(value);
    if (!value || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
      throw new TypeError('Incomplete musical scene');
    }
    for (const [key, rule] of Object.entries(fields)) {
      const v = value[key];
      if (rule.choices ? !rule.choices.includes(v) : typeof v !== 'number' || v < rule.min || v > rule.max || (rule.integer && !Number.isInteger(v))) {
        throw new TypeError(`Invalid scene field: ${key}`);
      }
    }
    return clonePresetData(value);
  }
  return Object.freeze({
    keys: Object.freeze(keys), validate,
    capture: state => validate(Object.fromEntries(keys.map(key => [key, state[key]]))),
    bank: rows => Object.freeze(rows.map(([id, label, snapshot]) => Object.freeze({ id, label, snapshot: Object.freeze(validate(snapshot)) }))),
    randomize: (_previous, random = Math.random) => {
      const r = presetRandom(random);
      return validate(Object.fromEntries(Object.entries(fields).map(([key, rule]) => [key,
        rule.choices ? r.pick(rule.choices) : rule.integer ? r.integer(rule.min, rule.max)
          : Number(r.between(rule.min, rule.max).toFixed(6))])));
    },
  });
}
