# Octopus — eight-arm performance sketch

**Status:** downloaded [Octopus rig by Dirk.z](https://sketchfab.com/3d-models/octopus-rig-48f40cb3dfd5473fbb200cf1dcd7b944)
is the **only visible creature** on the shared
[Rig Lab](../../src/pages/rig-lab.html), not a finished standalone instrument.
Its six long skinned chains and two short appendages serve eight separate sound
controls; they are not eight matching tentacles. Chosen to replace the rejected jellyfish leads;
the octopus is more directly playable than a single bell. An uncanny squid or
Cthulhu-inspired *model* could be explored later without claiming biological
accuracy. Four selectable **runtime UV-mapped skins** now coat the same imported
mesh: mottled Reef, blue/glowing Abyss, iridescent Pearl and olive Kelp. The
Skin sheen / wetness control changes PBR roughness and clearcoat while preserving
all 128 source bones. These procedural color/grain/glow maps are artistic looks,
not downloaded photographic textures or modifications to Dirk.z's GLB.
[Tentacled-model candidates](free-model-candidates.md) are research, not assets
used here.

**One action:** pull one of eight appendage tips. Longer chains bend/stretch
with it; its corresponding continuous resonant pitch and color
change. Squeeze the mantle for a separate pressure exciter, or run a silent/
audible motion pulse that visits individual arms over time.

| Gesture | Visible model | Synthesized sound |
| --- | --- | --- |
| Drag an arm tip / length and curl sliders | One identified radial chain | Its length/curl tune its independent pluck/hold |
| Squeeze the mantle | Body volume changes | Low pressure-driven pulse |
| Choose a skin, adjust wetness | Original UV-mapped skinned mesh changes material, not anatomy | Appearance-only control; pitch/transport do not change |
| Move in the current | Arm bends change | A visible directed pose, not an animal call |
| Play/Pause | One arm per pulse | Eight visits over successive cycles |

The source download declares CC BY 4.0; its GLB skin, UVs and branches have
been inspected. Invisible hit areas follow imported tips, never a drawn
procedural arm. Human appearance/physical-feel review remains open. A fantasy
[animated squid creature](https://sketchfab.com/3d-models/lurker-rigged-and-animated-28b3e1a216904de7ad212368fb9d8f59)
is a separate option, not evidence of a real octopus's motion.

The arm tones, mantle noise and current are **invented sonification**. No
octopus vocalization, physical acoustics, photorealism, fluid simulation,
MIDI implementation or sample recordings are claimed. Manual gestures do not
arm Audio or start Play. Human listening and touch testing remain before a
standalone release; [download provenance](../../assets/rig-lab/SOURCE.LICENSE.txt)
is recorded.
