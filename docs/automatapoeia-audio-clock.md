# Automatapoeia audio-clock scheduling

The owner reported uneven row timing and notes within a row sounding apart.
These are two different things:

- **Swing** deliberately alternates row intervals.
- **Time spread** deliberately distributes onsets within a row. At zero, the
  existing sound model places every event on the same sample at the row's center.
- Animation-frame-driven advancement was an actual timing defect. A controlled
  240 ms main-thread stall stretched a straight 12-row/s interval from 83.33 ms
  to 283.33 ms. That error is not swing or a preset feature.

## Change

`automatapoeia-clock.js` fills a 350 ms lookahead queue every 12 ms using
`AudioContext.currentTime`. Both the original buffer renderer and native sine
bank receive explicit audio-clock start times. Neither row advancement nor
note scheduling waits for an animation frame. The simulation is computed ahead
on a separate score snapshot; visible history adopts only the rows whose audio
time has arrived. Obsolete visual frames are skipped, not replayed.

Graphics start at 30 fps while Audio is on and back off further when rendering
is expensive. Low audio headroom defers drawing. Following the owner's next-row
request, preset/control changes replace the unheard queue at its next existing
row boundary, without clearing history. The page now starts paused; Play is
separate from Audio. Pause/Audio off/disposal cancels scheduling. Audio-off
visual evolution runs only while Play is active and never allocates/arms audio.
See [explicit transport and next-row edits](automatapoeia-live-transport.md).

The column bank counts release tails at their **scheduled audio time**, so
lookahead does not change its normalization or 384-active-source voice-stealing
decisions. Queued native nodes remain owned until `ended`, including future
steals. Preset/control changes retire old columns at the next boundary; panic
still stops everything immediately. Physical ownership includes the bounded
lookahead in addition to the audible source budget.

## Preservation and evidence

Factory presets, musical parameter ranges, the row renderer, oscillator types,
envelopes, pitch/timbre mappings, and intended Swing/Time spread are unchanged.
`automatapoeia-clock-controller.test.mjs` compares 180 generations of every
preset, including width changes/history trimming, with the pre-clock controller:
exact rows, analysis, connected sound objects and synthesis inputs. It also
compares sine-bank gain/steal decisions with the original just-in-time path.
The separately recorded note-release fix and original SHA fixtures are retained.

The timing browser tests stop graphics entirely for 1.5 seconds, then block the
UI thread for 240 ms, with straight 12-row/s playback. Every scheduled interval
remains 83.33 ms within half a sample; queued submissions are ahead of their
deadlines. The same cases run on source and generated WAX pages. Live rate
changes, Audio off, preset changes and previous hanging-note tests also run.

## Explicit limit

This is **bounded Web Audio lookahead**, not a new AudioWorklet/worker synthesis
engine or a hard-real-time guarantee. Rendering/filling the queue still uses
JavaScript on the main thread. A stall longer than its headroom can cause missing
rows; overdue attacks are discarded while the original tempo grid is retained,
not replayed as a burst or permanently slowed down. Surviving arbitrary long
main-thread freezes would require a separate worker/worklet pipeline and a
larger sound-preservation migration. OS/device starvation also cannot be ruled
out by browser code. Human listening and physical-device testing remain separate
from the automated timing evidence.
