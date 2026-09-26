# Automatapoeia controls / Fast clockwork

Based on main `fd50a90`. This change is limited to Automatapoeia; shared-family
controller/style changes are Automata-scoped.

- **Rules** is the existing live rule picker, directly below Restart / Reseed.
  Rule family, boundary and width remain in Rule settings. Presets and rule
  changes retain the running lineage and use the existing audio clock.
- Sound, Sound shaping, Rule settings and Readout reuse Shape's colored section
  delimiters and +/− disclosures. Transport remains permanently available.
- The ADSR curve is a view of the existing four parameters, not a new envelope
  engine. Drag A/D/R sideways for time and S vertically for sustain level. Time
  handles have independent logarithmic lanes: this is a schematic envelope,
  not a linear-time plot. Even a 1 ms attack alongside a 2 s release remains
  editable on a phone. Shift-drag is fine adjustment. Arrow keys change by one
  native step (Shift: ten); Home/End select the endpoints.
- Original parameter IDs, limits, input events, outputs and preset state remain.
  The app explicitly publishes graph gestures through the monitor-only MIDI
  preview API because the native observer deliberately rejects synthetic input.
  This does **not** route or send MIDI. The full MIDI Out monitor stays visible.
- Evolution/Render prose, background/NKS cards and appended catalogue information
  are removed from the page. Internal evolution history is not removed.

## Fast clockwork evidence

The old preset used 12 ms attack and 35% gate. Across 32 centered-seed Rule-60
rows at 48 kHz, contour modulation yielded ~9–13 ms attacks against ~2–5 ms gates,
releasing each note during the quiet beginning of its smooth attack.

The revised **2 ms attack / 65% gate** reaches its attack peak before release.
Output remains 0.34; no global gain, DSP, randomizer or envelope clamp changes.
The same deterministic comparison yielded mean raw row RMS **0.0036 → 0.0369**,
with revised minimum raw row RMS ~0.0248 and peak ~0.582. These are renderer
measurements, not perceived loudness or final speaker levels. Regression tests
cover both 44.1 and 48 kHz and three synthesis seeds; browser tests cover the
actual Audio → Play path, live edits, recall, randomize, reset and cleanup.

Human listening and physical iPhone/touch evaluation remain necessary.
`automatapoeia-controls-runtime-changes.json` records exact reversible amendments;
the module-relocation baseline fixture is unchanged.
