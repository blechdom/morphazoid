import { clamp, pitch01ToFrequency, synthParametersForMode } from "../../audio.js";
import { projectPoint4 } from "../../hyper.js";
import { rotatePoint3, projectPoint3 } from "../../solid.js";

export function geometryViewPoint(point) {
  return { ...projectPoint3(rotatePoint3(projectPoint4(point), { x: -16, y: 27, z: 0 }), 3.8), w: point.w };
}

// The original Solid/Hyper formulas, shared rather than approximated through
// Shapes' Character macro. Envelope sampling remains instrument-owned.
export function geometryContactVoice(kind, contact, index, state, sampleEnvelope) {
  const hyper = kind === "hyper";
  const projected = hyper ? geometryViewPoint(contact) : contact;
  const pitch = hyper ? clamp((projected.y + 1.2) / 2.4, 0, 1) : clamp((contact.y + 1) * 0.5, 0, 1);
  const drive = hyper ? clamp((contact.w + 1.25) / 2.5, 0, 1) : clamp((contact.z + 1) * 0.5, 0, 1);
  return {
    key: `${kind}:${contact.edgeIndex ?? index}`,
    frequency: pitch01ToFrequency(pitch, state.baseFrequency, state.pitchRange),
    gain: sampleEnvelope(contact.t ?? 0, hyper ? 0.18 + 0.64 * (contact.cornerStrength ?? 0) : 0.25 + 0.55 * (contact.cornerStrength ?? 0)),
    pan: clamp(projected.x, -1, 1),
    waveform: "sine",
    ...synthParametersForMode(state.soundMode, drive, {
      fmIndex: state.fmIndex, fmRatio: state.fmRatio,
      pmIndex: state.fmIndex * 0.7, pmRatio: state.fmRatio,
      shepardRate: state.playing ? state.speed * state.direction : 0,
      shepardWidth: hyper ? 5 : 4,
    }),
  };
}
