import { presetStateKey, validateFullPresetBank } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const decimals = step => (String(step).split(".")[1] ?? "").length;

function snapRange(field, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError("Preset value must be finite");
  const clamped = Math.min(field.max, Math.max(field.min, number));
  if (!field.step) return clamped;
  const snapped = field.min + Math.round((clamped - field.min) / field.step) * field.step;
  return Number(Math.min(field.max, snapped).toFixed(Math.max(decimals(field.step), decimals(field.min))));
}

export const range = (min, max, step = 0, randomRange = [min, max]) => ({ type: "range", min, max, step, randomRange });
export const choice = values => ({ type: "enum", values: Object.freeze([...values]) });
export const toggle = () => ({ type: "bool" });

function sanitizeValue(field, value) {
  if (field.type === "range") return snapRange(field, value);
  if (field.type === "enum") {
    if (!field.values.includes(value)) throw new TypeError("Preset value is not an allowed choice");
    return value;
  }
  return Boolean(value);
}

/**
 * Flat scalar-parameter preset model. `constrain` repairs dependent values and
 * must be idempotent; every key participates in capture, validation and dice.
 */
export function defineParamModel(fields, { constrain = snapshot => snapshot, label = "instrument" } = {}) {
  const keys = Object.freeze(Object.keys(fields));
  const sanitize = raw => {
    if (!raw || typeof raw !== "object") throw new TypeError(`Invalid ${label} preset`);
    const out = {};
    for (const key of keys) out[key] = sanitizeValue(fields[key], raw[key]);
    return constrain(out);
  };
  const validate = snapshot => {
    if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).length !== keys.length
      || presetStateKey(snapshot) !== presetStateKey(sanitize(snapshot))) {
      throw new TypeError(`Invalid complete ${label} preset`);
    }
    return snapshot;
  };
  const randomize = (current, random = Math.random) => {
    validate(current);
    const rng = presetRandom(random);
    const out = {};
    for (const key of keys) {
      const field = fields[key];
      if (field.type === "range") out[key] = snapRange(field, rng.between(field.randomRange[0], field.randomRange[1]));
      else if (field.type === "enum") out[key] = rng.pick(field.values);
      else out[key] = rng.unit() < 0.5;
    }
    return validate(sanitize(out));
  };
  const bank = entries => {
    const presets = entries.map(([id, label, values]) => Object.freeze({
      id, label, snapshot: Object.freeze(sanitize(values)),
    }));
    validateFullPresetBank(presets);
    return Object.freeze(presets);
  };
  return Object.freeze({ keys, fields, sanitize, validate, randomize, bank });
}
