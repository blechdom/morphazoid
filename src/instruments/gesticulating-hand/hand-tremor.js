const TAU = Math.PI * 2;
const EMPTY = Object.freeze({});

/** Degree-based tremor shared by the visual rig and audio pose evaluation.
 * Rate/phase spread separate the five digit oscillators without taking ownership
 * of their clock. Zero spread retains the original synchronous/alternating motion.
 * The caller supplies initialized pose storage and cleared pitch offsets. */
export function createHandTremor({ clampHand, handDigitLimits, handWristLimits, FINGERS, TREMOR_FINGERS, TREMOR_JOINTS }) {
  return function applyHandTremor(value, time, out, pitchOffsets, form) {
    const settings = value && typeof value === 'object' ? value : EMPTY;
    const amount = clampHand(settings.amount, 0, 45, 0);
    if (amount === 0) return;
    const finger = TREMOR_FINGERS.includes(settings.finger) ? settings.finger : 'all';
    const selectedJoint = TREMOR_JOINTS.includes(settings.joint) ? settings.joint : 'tip';
    const joint = form === 'foot' && finger === 'thumb' && selectedJoint === 'middle' ? 'tip' : selectedJoint;
    const phase = clampHand(time, -1e9, 1e9, 0) * clampHand(settings.rate, .1, 120, 8) * TAU;
    const rateSpread = clampHand(settings.rateSpread, 0, 1, 0);
    const phaseSpread = clampHand(settings.phaseSpread, 0, 1, 0);
    if (joint === 'wrist') {
      const bounds = handWristLimits(form);
      const sidePhase = rateSpread === 0 ? phase : phase * 2 ** (.45 * rateSpread);
      const turnPhase = rateSpread === 0 ? phase : phase * 2 ** (.9 * rateSpread);
      out.wrist.flex = clampHand(out.wrist.flex + amount * Math.sin(phase), ...bounds.flex);
      out.wrist.side = clampHand(out.wrist.side + amount * .55 * Math.sin(sidePhase + .9 + TAU / 3 * phaseSpread), ...bounds.side);
      out.wrist.twist = clampHand(out.wrist.twist + amount * .7 * Math.sin(turnPhase + 1.8 + TAU * 2 / 3 * phaseSpread), ...bounds.twist);
      return;
    }
    for (let i = 0; i < 5; i++) {
      if (finger !== 'all' && finger !== 'alternating' && finger !== FINGERS[i]) continue;
      const f = out.fingers[i], bounds = handDigitLimits(form, i);
      const digitPhase = rateSpread === 0 ? phase : phase * 2 ** ((i - 2) * .45 * rateSpread);
      const offset = (finger === 'alternating' && i % 2 ? Math.PI : 0) + i * TAU / 5 * phaseSpread;
      const delta = amount * Math.sin(digitPhase + offset);
      const oldMiddle = f.pip, oldTip = f.dip;
      if (joint === 'knuckle' || joint === 'whole') f.mcp = clampHand(f.mcp + delta, ...bounds.mcp);
      if (joint === 'middle' || joint === 'whole') f.pip = clampHand(f.pip + delta, ...bounds.pip);
      if (joint === 'tip' || joint === 'whole') f.dip = clampHand(f.dip + delta, ...bounds.dip);
      if (joint === 'spread') f.spread = clampHand(f.spread + delta, ...bounds.spread);
      // Vibrato follows the visible middle/tip deflection after joint clipping.
      // Sideways splay keeps pitch intact and reaches the existing stereo mapping.
      pitchOffsets[i] = (f.pip - oldMiddle) * .0035 + (f.dip - oldTip) * .0028;
    }
  };
}
