export async function observeAutomataState(page) {
  // Read-only test instrumentation: production controller and browser audio
  // remain unchanged; no timing callbacks, audio methods or settings replaced.
  await page.route("**/src/families/experiments/experiments-app.js", async route => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: body + `\n
globalThis.__caSnapshot = () => structuredClone({
  evolution: state.caEvolutionSegments, rows: state.caRows, generation: state.caGeneration, initial: state.caInitialRow,
  parameters: captureAutomataPreset(state).parameters, playing: state.caPlaying,
  audioOn: state.audioOn, contextTime: audio.context?.currentTime,
  next: audio.automataClock?.queue[0], nextDeadline: audio.automataClock?.queue.find(row => row.time > audio.context.currentTime)?.time ?? audio.automataClock?.nextTime, nextTime: audio.automataClock?.nextTime,
  sources: audio.rowScanSources.size + audio.columnSources.size,
  contextCount: audio.context ? 1 : 0,
});` });
  });
}
