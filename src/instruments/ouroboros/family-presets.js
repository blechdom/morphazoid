import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const round = (value, digits) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

export function createOuroborosFamilyPresets({
  defaults, sanitize, fields, existing = [], extra = [], exclude = ["level"],
}) {
  const keys = Object.freeze(Object.keys(defaults).filter(key => !exclude.includes(key)));
  const capture = params => {
    const safe = sanitize({ ...defaults, ...params });
    return Object.fromEntries(keys.map(key => [key, safe[key]]));
  };
  const validate = snapshot => {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
      || Object.keys(snapshot).length !== keys.length
      || presetStateKey(snapshot) !== presetStateKey(capture(snapshot))) {
      throw new TypeError("Invalid complete Ouroboros preset");
    }
    return snapshot;
  };
  const scene = ({ id, label, description, ...params }) => {
    const snapshot = Object.freeze(capture(params));
    return Object.freeze({ id, label, snapshot });
  };
  const presets = Object.freeze([...existing, ...extra].map(scene));
  const missing = keys.filter(key => !(key in fields));
  if (missing.length) throw new Error(`Randomizer fields missing: ${missing.join(", ")}`);

  const draw = (rng, field) => {
    if (field.direction) return rng.unit() < 0.5 ? -1 : 1;
    if (field.choices) return rng.pick(field.choices);
    const [low, high] = field.range;
    const unit = rng.unit();
    const value = field.log ? low * (high / low) ** unit : low + (high - low) * unit;
    return round(value, field.digits ?? 3);
  };
  const randomize = (current, random = Math.random) => {
    validate(current);
    const rng = presetRandom(random);
    const raw = {};
    for (const key of keys) raw[key] = draw(rng, fields[key]);
    return validate(capture(raw));
  };
  return Object.freeze({ keys, capture, validate, presets, randomize });
}
