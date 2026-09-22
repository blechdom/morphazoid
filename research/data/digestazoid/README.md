# Digestazoid reference-audio subset

This directory contains a small, reproducible calibration subset for analyzing
Digestazoid sound families independently. The recordings are research
references, not playback assets for the instrument.

See `manifest.json` for source URLs, file identifiers, checksums, licenses,
selection rationale, and full-source inventory summaries. Paths in the manifest
are relative to the repository root.

Included material:

- one complete 465.048-second, annotated human bowel recording (CC BY 4.0);
- 22 unchanged one-second boiling WAV files stratified across background,
  nucleate, pre-CHF, and transition regimes (CC BY 4.0);
- the 5.983-second herring Fast Repetitive Tick supplementary WAV (CC BY,
  credited to Wilson, Batty, and Dill);
- one 1.802-second natural human burp from PDSounds/Wikimedia Commons (public
  domain); and
- one 12.539-second infant wet-fart and tummy-rumble recording from Wikimedia
  Commons (public domain). This last source is diaper-muffled and must not be
  treated as representative of unobstructed adult flatulence.

The manifest records both original Ogg files and deterministic PCM-WAV analysis
derivatives for the two public-domain human references. The total local source
payload is 70,284,603 bytes. Raw audio is intentionally ignored by Git; rerun
the acquisitions recorded in the manifest before reproducing the analysis.

`analysis/` contains the generated full JSON report, per-file and per-event CSV
tables, and `calibration-targets.json`. The target file contains relative
timing, spectrum, and band-energy ranges only. Absolute dBFS is omitted because
capture gain and mastering differ across sources.

The Cornell coupled-bubble project is inventoried but deliberately not copied.
Its project page says the files may not be reposted without permission, and its
uncompressed WAV alone exceeds this subset's size budget.

When publishing analysis, derivative plots, or measurements, retain the source
citations and state any transformations. Do not infer that the recordings may
be embedded as production samples merely because they are available here.
