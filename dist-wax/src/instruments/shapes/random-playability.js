import { clamp } from "../../audio.js";

/** Factory/dice policy only. Never call when sanitizing, recalling saved scenes
 * or editing controls: the full manual instrument remains available. */
export function prepareShapesStarterSound(state) {
  const { voice, synthesis, play } = state, tone = synthesis.tone;
  // All geometry pitch curves map into [baseHz, baseHz * 2^range]. This keeps
  // even a curve flattened to its lowest point in a phone-friendly register,
  // without quantizing any geometry-derived pitch or reshaping the curve.
  voice.baseHz = Math.max(110, voice.baseHz);
  voice.rangeOctaves = Math.min(voice.rangeOctaves, Math.log2(3200 / voice.baseHz));
  if (state.selection.playingMode !== "triggers" && voice.engine === "fm") {
    tone.fmIndex = Math.min(1.5, tone.fmIndex * 0.28);
    tone.fmRatio = clamp(tone.fmRatio, 0.5, 2);
    voice.presetLevel = Math.min(0.24, voice.presetLevel * 0.5);
  } else if (state.selection.playingMode !== "triggers" && voice.engine === "square") {
    voice.presetLevel = Math.min(0.3, voice.presetLevel);
  }
  // Preserve shape-only studies, but do not let an almost-static axis stand
  // in for useful motion. Symmetric round forms need a moving reader too.
  const local = state.dimension[state.selection.dimension];
  if (state.selection.dimension === "2d") {
    if (local.rotationRunning) local.rotationSpeed = Math.sign(local.rotationSpeed || 1) * Math.max(0.08, Math.abs(local.rotationSpeed));
    if (!play.running && (!local.rotationRunning || state.profile.sides === 1)) play.running = true;
  } else {
    const moving = Object.values(local.rotationMotion).filter(motion => motion.running);
    for (const motion of moving) motion.speed = Math.sign(motion.speed || 1) * Math.max(0.06, Math.abs(motion.speed));
    if (!play.running && (!moving.length || ["sphere", "hypersphere"].includes(local.representation))) play.running = true;
  }
  if (play.running) play.rateCyclesPerSecond = Math.max(0.08, play.rateCyclesPerSecond);
  return state;
}

/** Density/mapping guards for dice, not manual scenes or curated subdivision studies. */
export function ensurePlayableShapesRandom(state) {
  const mode = state.selection.playingMode, two = state.selection.dimension === "2d";
  const local = state.dimension["2d"], tone = state.synthesis.tone;
  const percussion = mode === "notes" && state.voice.engine === "percussion";
  const discrete = mode !== "continuous";
  if (discrete) {
    state.play.running = true;
    state.play.rateCyclesPerSecond = Math.max(0.18, state.play.rateCyclesPerSecond);
    if (!percussion) state.play.divisions = Math.max(2, state.play.divisions);
  }
  if (two) {
    if (percussion && state.profile.sides < 3) {
      state.profile.sides = 3; state.profile.kind = "polygon"; local.closedShapeType = "polygon";
    }
    if (state.profile.sides === 2) local.reader = "points";
    if (local.reader === "points") {
      if (tone.cornerAmplitudeSource === "incidence") tone.cornerAmplitudeSource = "fixed";
      if (tone.percussionLevelSource === "incidence") tone.percussionLevelSource = "fixed";
    }
    if (state.profile.sides === 2 && tone.cornerAmplitudeSource === "corner") tone.cornerAmplitudeSource = "fixed";
    if (["phase", "incidence"].includes(tone.cornerAmplitudeSource)) state.play.running = true;
    if (mode === "continuous" && !state.play.running) tone.cornerAmplitudeSource = "fixed";
    if (state.play.running && !discrete) state.play.rateCyclesPerSecond = Math.max(0.08, state.play.rateCyclesPerSecond);
    tone.amplitudeEnvelopePoints = tone.amplitudeEnvelopePoints.map(point => ({ ...point, y: Math.max(0.08, point.y) }));
    if (discrete) {
      const divisions = state.play.divisions;
      const vertices = Math.max(1, state.profile.sides) * (state.profile.kind === "star" ? 2 : 1);
      // Reduce generated density before slowing a reader to a near standstill.
      state.play.divisions = Math.min(divisions, Math.max(1, Math.floor(48 / (vertices * local.heads * 0.12))));
      local.heads = Math.min(local.heads, Math.max(1, Math.floor(48 / (vertices * state.play.divisions * 0.12))));
      local.headOffsets = local.headOffsets.slice(0, local.heads);
      const density = vertices * local.heads * state.play.divisions;
      state.play.rateCyclesPerSecond = Math.max(0.12, Math.min(state.play.rateCyclesPerSecond, 48 / density));
    }
  } else if (state.play.running) {
    state.play.rateCyclesPerSecond = Math.max(0.12, state.play.rateCyclesPerSecond);
    if (["notes", "triggers"].includes(mode)) {
      state.play.rateCyclesPerSecond = Math.max(0.25, state.play.rateCyclesPerSecond);
      state.trigger.hitCap = Math.min(2, state.trigger.hitCap);
    }
  }
  if (mode === "notes") {
    const dimension = state.dimension[state.selection.dimension];
    if (["sphere", "torus", "hypersphere", "klein"].includes(dimension.representation)) {
      state.play.divisions = Math.min(2, state.play.divisions);
      state.play.rateCyclesPerSecond = Math.min(state.play.rateCyclesPerSecond, 0.2);
      state.notes.hitCap = 1;
    }
    if (!percussion) state.voice.voiceLimit = Math.max(state.voice.engine === "shepard" ? 8 : 12, state.voice.voiceLimit);
  }
  if (local.reader !== "points" || state.profile.sides === 2) tone.shepardMapping = "travel";
  if (mode === "triggers") {
    state.trigger.hitCap = Math.min(2, state.trigger.hitCap);
    if (two) {
      if (state.profile.sides * local.heads > 24) {
        state.play.divisions = 1;
        state.trigger.hitCap = 1;
        local.heads = Math.min(3, local.heads);
        local.headOffsets = local.headOffsets.slice(0, local.heads);
        local.rotationRunning = false;
      }
      const density = Math.max(1, state.profile.sides) * (state.profile.kind === "star" ? 2 : 1) * local.heads * state.play.divisions;
      const budget = 24 / state.trigger.hitCap / density;
      state.play.rateCyclesPerSecond = Math.max(0.08, Math.min(state.play.rateCyclesPerSecond, budget));
      local.rotationSpeed = Math.sign(local.rotationSpeed) * Math.min(Math.abs(local.rotationSpeed), budget);
    } else {
      const geometry = state.dimension[state.selection.dimension];
      if (["sphere", "torus", "hypersphere", "klein"].includes(geometry.representation)) {
        state.play.divisions = 1;
        state.play.rateCyclesPerSecond = Math.min(state.play.rateCyclesPerSecond, 0.18);
        state.trigger.hitCap = 1;
        for (const motion of Object.values(geometry.rotationMotion)) motion.running = false;
      }
    }
  }
  // Clamping a radar and its rotating form to the same speed can lock every
  // ray between markers forever. Keep a real relative crossing rate in rolls.
  if (discrete && two && local.reader === "radar" && local.rotationRunning
    && state.play.motion === "loop" && local.rotationMotion === "loop") {
    const relative = local.radialHeadDirections.slice(0, local.heads).map(direction =>
      Math.abs(state.play.direction * direction * state.play.rateCyclesPerSecond - local.rotationSpeed));
    if (Math.max(...relative) < 0.04) {
      local.rotationSpeed = -Math.sign(local.rotationSpeed || state.play.direction) * Math.max(0.08, Math.abs(local.rotationSpeed));
    }
  }
  return state;
}
