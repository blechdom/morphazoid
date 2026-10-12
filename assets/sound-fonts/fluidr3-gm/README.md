# FluidR3 GM 3.1 — complete SF3 edition

FluidR3 GM by Frank Wen and contributors, copyright 2000–2002 and 2008. The
bank also credits Toby Smithe (2008). Its [original README](UPSTREAM-README.txt)
lists the contributors; the [original MIT license](LICENSE.txt) accompanies it.
Keep these copyright and permission notices with redistributed copies.

This is the complete GM bank from the original `fluid-soundfont_3.1.orig.tar.gz`
archive hosted by Debian, converted from 148,398,306-byte SF2 to 24,197,264-byte
SF3. SF3 applies lossy Ogg Vorbis compression to the samples; it requires an
SF3-capable player. No presets, zones, generators, modulators or samples were
removed. All stereo sample links, loop points, sample rates and original keys
were verified unchanged. The bank contains 189 presets
(158 melodic and 31 percussion), including every bank-0 GM program, and 1,418
samples. The separate GS extension from the archive is not part of this GM bank.

The original SF2 is available from the source archive and is deliberately not
duplicated in this repository. The shared catalog is `../catalog.json`.
[`../provenance.json`](../provenance.json) records the exact source/archive,
original SF2, converted SF3, tooling and license hashes.

## Reproduce the conversion

Run the checked-in `convert-to-sf3.mjs` offline conversion script with Node
24.14.0, SpessaSynth Core 4.3.22 and stb-vorbis 0.0.6. The latter packages match
Morphazoid's existing vendored synthesizer versions; they are conversion tools,
not new runtime dependencies. Retrieve their npm tarballs without running install
scripts and extract into a temporary `node_modules/` directory:

```sh
mkdir -p node_modules/spessasynth_core node_modules/stb-vorbis
npm pack spessasynth_core@4.3.22 --ignore-scripts
npm pack stb-vorbis@0.0.6 --ignore-scripts
tar -xzf spessasynth_core-4.3.22.tgz --strip-components=1 -C node_modules/spessasynth_core
tar -xzf stb-vorbis-0.0.6.tgz --strip-components=1 -C node_modules/stb-vorbis
curl -fLO https://deb.debian.org/debian/pool/main/f/fluid-soundfont/fluid-soundfont_3.1.orig.tar.gz
tar -xzf fluid-soundfont_3.1.orig.tar.gz fluid-soundfont-3.1/FluidR3_GM.sf2
node /path/to/convert-to-sf3.mjs fluid-soundfont-3.1/FluidR3_GM.sf2 FluidR3_GM.sf3 node_modules/spessasynth_core/dist/index.js
```

The script verifies the source SF2 SHA-256 before conversion. Use FFmpeg
`6.1.1-3ubuntu5` with libvorbis `1.3.7-1build3` and libogg `1.3.5-3build1` on
little-endian Linux. Every sample is encoded separately with `libvorbis -q:a 5`,
metadata stripped, and FFmpeg bitexact flags to avoid randomized Ogg serials.
Four encoder processes run concurrently. SpessaSynth writes the standard SF3
header and original instrument programming; no extended chunks or replacement
default modulators are added. Two independent runs produced identical SF3 bytes.

The browser's pinned Vorbis decoder returns 24–128 extra tail frames for three
samples (`Cello G3(R)`, `Cello C#3(L)`, and `OcarE1`); all other decoded lengths
match the source. This small codec padding does not move any retained loop point.

Changing encoder versions may change the compressed bytes; use the recorded
versions and SHA-256 values to reproduce this distribution exactly. Compression
is a storage change and has not been described as lossless or certified by a
human listening test.
