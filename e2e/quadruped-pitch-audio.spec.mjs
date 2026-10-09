import { test, expect } from "@playwright/test";

test("all animal calls render lower and higher at the new pitch extremes with bounded tails", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/quadruped.html");
  const report = await page.evaluate(async () => {
    const source = await (await fetch("./src/instruments/quadruped/quadruped-app.js")).text();
    const { QUADRUPED_CALLS, quadrupedCallEvents } = await import("./src/instruments/quadruped/quadruped-voices.js");
    const { createQuadrupedGestureCall } = await import("./src/instruments/quadruped/quadruped-gesture-voices.js");
    // Exercise the actual app's oscillators, envelopes and filters in an offline
    // graph, independent of wall-clock scheduling and the output compressor.
    const functions = ["createPanner", "midiToFrequency", "scheduleTone", "schedulePitchContour", "scheduleCall"].map(name => {
      const match = source.match(new RegExp("function " + name + "\\([^]*?\\n\\}(?=\\r?\\n)"));
      if (!match) throw new Error("Missing synth primitive " + name);
      return match[0];
    }).join("\n");
    const render = new Function("graph", "call", `
      const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, Number(x) || 0));
      const selectedActor = 0, groupMode = "solo";
      const registerAudioSource = () => {};
      ${functions}
      scheduleCall(call, 0.02, 0);
    `);
    const rows = [];
    for (const animalId of Object.keys(QUADRUPED_CALLS)) for (let row = 0; row < 3; row++) {
      const pitches = [];
      for (const pitchSemitones of [-36, 0, 36]) {
        const score = { animalId, pitchSemitones, tempoBpm: 96, callPattern: [[1], [1], [1]] };
        const scored = quadrupedCallEvents(score, 0)[row];
        const gesture = createQuadrupedGestureCall(score, { row, strength: 1 });
        if (JSON.stringify(gesture.notes) !== JSON.stringify(scored.notes) || gesture.filter !== scored.filter) {
          throw new Error("Score/gesture pitch diverged");
        }
        const context = new OfflineAudioContext(2, 96000, 48000);
        const mixBus = context.createGain(); mixBus.connect(context.destination);
        render({ context, mixBus }, scored);
        const buffer = await context.startRendering();
        const samples = buffer.getChannelData(0);
        let peak = 0, energy = 0, tail = 0, crossings = 0;
        for (let i = 0; i < samples.length; i++) {
          const value = samples[i];
          if (!Number.isFinite(value)) throw new Error("Non-finite " + animalId + "/" + row);
          peak = Math.max(peak, Math.abs(value)); energy += value * value;
          if (i > samples.length - 2400) tail = Math.max(tail, Math.abs(value));
          if (i && samples[i - 1] < 0 && value >= 0) crossings++;
        }
        pitches.push({ pitchSemitones, rms: Math.sqrt(energy / samples.length), peak, tail, crossings });
      }
      rows.push({ animalId, row, pitches });
    }
    return rows;
  });
  for (const { animalId, row, pitches } of report) {
    for (const voice of pitches) {
      expect(voice.rms, `${animalId}/${row}/${voice.pitchSemitones}`).toBeGreaterThan(0.0001);
      expect(voice.peak).toBeLessThan(1);
      expect(voice.tail).toBeLessThan(0.00001);
    }
    expect(pitches[0].crossings, `${animalId}/${row} low`).toBeLessThan(pitches[1].crossings);
    expect(pitches[2].crossings, `${animalId}/${row} high`).toBeGreaterThan(pitches[1].crossings);
  }
  await test.info().attach("quadruped-pitch-calls", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
});
