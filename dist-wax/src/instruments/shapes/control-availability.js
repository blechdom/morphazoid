/** Applicability, not parameter deletion: hidden settings survive selections. */
export function shapesControlAvailability(state) {
  const dimension = state.selection.dimension, two = dimension === "2d";
  const engine = state.voice.engine, triggers = state.selection.playingMode === "triggers";
  const profile = two || state.dimension[dimension].representation === "profile";
  return {
    profile,
    starDepth: profile && state.profile.kind === "star" && state.profile.sides > 2,
    character: !triggers && state.selection.playingMode === "continuous"
      && state.synthesis.model === "shapes" && ["fm", "pm", "shepard"].includes(engine),
    fm: engine === "fm" || (!two && engine === "pm"),
    fmSource: two && engine === "fm",
    pm: two && engine === "pm",
    shepardTurn: two && state.dimension["2d"].reader === "points" && state.profile.sides !== 2,
    shepardTurnGlide: two && state.dimension["2d"].reader === "points"
      && state.profile.sides !== 2 && state.synthesis.tone.shepardMapping === "turn",
  };
}
