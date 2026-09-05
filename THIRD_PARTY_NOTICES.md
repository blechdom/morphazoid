# Third-party notices

## MakeHuman teeth_base

Dentaphone's optional WebGL jaw adapts the MakeHuman system `teeth_base`
asset. The source contains 32 independent tooth shells and a connected mouth
shell:

- https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html
- https://static.makehumancommunity.org/about/license.html

MakeHuman released its system assets under CC0 1.0 Universal. Morphazoid
separates and names all 32 teeth, splits the mouth shell into independently
hinged upper and lower sections, recenters and scales the geometry, and converts
it to GLB. Source details and the exact OBJ hash are in
`assets/models/dentaphone-chomper.LICENSE.txt`.

The reproducible converter lives only in the Morphazoid source repository at
`scripts/build-dentaphone-chomper.py`; it is a build and provenance tool, not a
runtime dependency, and is intentionally omitted from published static-site
bundles. References to that path in the model's license notice refer to a
repository checkout.

## Gilbert generalized Hilbert curve

Paths adapts the recursive two-dimensional Gilbert reference algorithm:

- https://github.com/jakubcerveny/gilbert

Copyright (c) 2018 Jakub Červený

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

## Bioacoustic recordings

The built-in recording menus bundle twelve unchanged Ogg Vorbis or PCM WAV field
recordings from Wikimedia Commons. Full provenance, recording notes, source
links, license links, and file hashes are recorded in
`assets/bioacoustics/SOURCES.md`.

- Thrush nightingale, common blackbird, and chaffinch recordings: Oona
  Räisänen (Wikimedia Commons user Mysid), public-domain dedications.
## WebGPU Chiptune / Chiptune (sound) lineage

WebGPU Chiptune translates the active sound path of **Chiptune (sound)** by
srtuss (2015), Shadertoy shader ID `MljSRt`, from GLSL into WGSL and adds the
Morphazoid streaming runtime, controls, presets, visualization, and host state
adapter.

- Original shader: https://www.shadertoy.com/view/MljSRt
- Author credit in the supplied source: `srtuss, 2015`

The Shadertoy page is not loaded at runtime. The supplied shader text and
archived metadata did not state a reuse license, so this notice records
provenance without asserting license terms.

- House cricket recording: Wikimedia Commons user Morray, CC BY 3.0.
- Field cricket recording: Wikimedia Commons user Thatcher, CC BY-SA 3.0.
- European field cricket recording: Baudewijn Odé, CC BY-SA 4.0.
- Coyote group recording: Wikimedia Commons user Rybkovich, CC BY-SA 4.0.
- Frog chorus recording: Wikimedia Commons user Hughesdarren, CC BY-SA 4.0.
- Dolphin recording: Félix Blume, CC0 1.0.
- Humpback-whale recording: Wikimedia Commons user Spyrogumas, CC0 1.0.
- Killer-whale recording: U.S. National Park Service, public domain in the
  United States.
- Blue-whale recording: NOAA Pacific Marine Environmental Laboratory, public
  domain in the United States.

Morphazoid distributes the Creative Commons recordings unchanged, preserves
attribution and license links, and does not suggest endorsement by the
recordists or licensors.

No Indigenous or other human song recordings are redistributed. Links in the
Acoustic Manifold archive directory are discovery references, not licenses to
copy, train on, rearrange, or resynthesize their holdings. Record-level rights,
community authority, culturally sensitive access protocols, and any Traditional
Knowledge Labels remain applicable.

## Three.js

Dentaphone, Nightingale Manifold, and Acoustic Manifold vendor Three.js 0.185.1
for local, offline-safe WebGL rendering. Dentaphone also vendors the GLTFLoader
utilities needed by its anatomical jaw:

- https://threejs.org/
- https://github.com/mrdoob/three.js

Copyright © 2010-2026 three.js authors

Three.js is MIT-licensed. The complete license text is in
`vendor/three/LICENSE.txt`. Dentaphone's vendored loader utility imports were
changed only to point at the adjacent local Three.js ESM build.

## Fluid Music Open Drums / Hyperreal TR-808 and TR-909 samples

Sample Drums references version-pinned WAV files from the Fluid Music
open-drums npm packages at runtime:

- https://www.npmjs.com/package/%40fluid-music/tr-808
- https://www.npmjs.com/package/%40fluid-music/tr-909
- https://github.com/fluid-music/open-drums

The TR-808 package is ISC-licensed and its README says the original Hyperreal
samples were recorded by Michael Fischer with no licensing restrictions noted.

The TR-909 package README says the samples were recorded by Jason Baker / Rob
Roy Recordings and reproduces the original Hyperreal text allowing free copying
and distribution while prohibiting distribution of the samples for profit.
Because of that condition, Morphazoid does not vendor the TR-909 WAV files in
this repository; it references the pinned package URLs from the browser and
decodes them into memory during use.

## WebGPU 303 / Acid Synth lineage

WebGPU 303 adapts the local WebGPU Audio Acid Synth shader and streaming
architecture. That local demo credits its acid voice lineage to:

- sound - acid jam by srtuss on Shadertoy
- https://www.shadertoy.com/view/ldfSW2

Morphazoid keeps that attribution visible on the WebGPU 303 page and does not
load the Shadertoy page as a runtime dependency.

## Pink Trombone

The shared classic 44-section vocal-tract geometry used by Throatazoid, Pink
Trombonazoid, Spelling Synthesizer, and Hiccup Head, including its tongue-rest curve,
reflection coefficients, and two-step waveguide behavior, is adapted from Neil
Thapen's Pink Trombone:

- https://dood.al/pinktrombone/
- https://github.com/IMAGINARY/pink-trombone

Copyright 2017 Neil Thapen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## CMU Flite / KAL16 diphone voice

The Spelling Synthesizer diphone audio sprite was generated from the
`cmu_us_kal16` diphone voice in CMU Flite 2.2, then silence-trimmed, faded,
level-normalized, and packed by Morphazoid. These processing and packaging
changes are not endorsed by Carnegie Mellon University.

- https://github.com/festvox/flite

Language Technologies Institute
Carnegie Mellon University
Copyright (c) 1999-2017
All Rights Reserved.

Permission is hereby granted, free of charge, to use and distribute this
software and its documentation without restriction, including without
limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of this work, and to permit persons to whom this
work is furnished to do so, subject to the following conditions:

1. The code must retain the above copyright notice, this list of conditions
   and the following disclaimer.
2. Any modifications must be clearly marked as such.
3. Original authors' names are not deleted.
4. The authors' names are not used to endorse or promote products derived from
   this software without specific prior written permission.

CARNEGIE MELLON UNIVERSITY AND THE CONTRIBUTORS TO THIS WORK DISCLAIM ALL
WARRANTIES WITH REGARD TO THIS SOFTWARE, INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS, IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY NOR
THE CONTRIBUTORS BE LIABLE FOR ANY SPECIAL, INDIRECT OR CONSEQUENTIAL DAMAGES
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER
IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## OddVoices CC0 voice recordings

Vocalzoid includes compact audio sprites derived from the Air, Cicada, and
Quake voice recordings in OddVoices. Morphazoid extracts only eight labelled
English units per voice, trims long vowel bodies, removes DC offset, normalizes
level, adds short edge fades, and packs the units into browser-sized WAV files.
These packaging changes are not endorsed by the OddVoices authors. The
reproducible builder is `scripts/generate-vocalzoid-oddvoices.py`.

- https://gitlab.com/oddvoices/oddvoices/
- https://gitlab.com/oddvoices/oddvoices/-/tree/develop/voices
- Source revision: 33a248af8df88edf5166593bf36b7e24e7bc1f94

Public Domain.

OddVoices vocal data by Nathan Ho is marked CC0 1.0. To view a copy of this
mark, visit https://creativecommons.org/publicdomain/zero/1.0/

## CMU ARCTIC voice recordings

Vocalzoid includes five compact audio sprites made from the BDL, CLB, JMK,
KSP, and SLT voices in the CMU ARCTIC 0.95 releases. These files are modified
excerpts, not the original voices: Morphazoid selects eight automatically
aligned phone units per speaker, trims them to the “vocalzoid” demo inventory,
removes DC offset, normalizes level, adds edge fades, finds phase-matched vowel
loops, and packs the results into browser-sized mono WAV files. The original
authors do not endorse these modifications. The reproducible builder is
`scripts/generate-vocalzoid-arctic.py`.

- http://www.festvox.org/cmu_arctic/
- https://www.cs.cmu.edu/~awb/papers/ssw5/arctic.pdf
- Source releases: `cmu_us_{bdl,clb,jmk,ksp,slt}_arctic-0.95-release`

BDL, JMK, and SLT: Copyright (c) 2003 Carnegie Mellon University.
CLB and KSP: Copyright (c) 2005 Carnegie Mellon University.
All Rights Reserved.

Permission to use, copy, modify, and license the voices and their documentation
for any purpose is granted without fee, subject to the conditions and warranty
disclaimers reproduced in `vendor/cmu-arctic/COPYING` (2003 voices) and
`vendor/cmu-arctic/COPYING-2005` (2005 voices).

## PocketSphinx English pronunciation dictionary

Spelling Synthesizer uses the PocketSphinx English CMU pronunciation
dictionary to translate complete words into ARPABET phone sequences for local
readback:

- https://github.com/cmusphinx/pocketsphinx

Copyright (c) 1995-2014 Carnegie Mellon University. All rights reserved.
Copyright (c) 2014-2015 Alpha Cephei Inc.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

This work was supported in part by funding from the Defense Advanced Research
Projects Agency and the National Science Foundation of the United States of
America, and the CMU Sphinx Speech Consortium.

THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY "AS IS" AND ANY
EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY NOR ITS EMPLOYEES BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

## Tactile

The Lattice, Spiral, and Escher instruments use Tactile's
isohedral tiling data and utilities:

- https://isohedral.ca/software/tactile/
- https://github.com/isohedral/tactile-js

BSD 3-Clause License

Copyright (c) 2018, Craig S. Kaplan
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Signalsmith Stretch

L-system Delay's optional Silky renderer uses the Web Audio release of Signalsmith
Stretch:

- https://signalsmith-audio.co.uk/code/stretch/
- https://github.com/Signalsmith-Audio/signalsmith-stretch

MIT License

Copyright (c) 2022 Geraint Luff / Signalsmith Audio Ltd.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
