# Rigged hand: source and license

- **Title:** Rigged hand
- **Author:** [Elena FF](https://sketchfab.com/elenaferfor)
- **Original:** https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e
- **License:** [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- **Attributed distribution:** https://github.com/cadenroberts/TheraHand/tree/36c051b036032740720164120c884ce16a65f162/public/rigged_hand
- **Retrieved and independently checked against the original Sketchfab API:** 2026-09-24

`SOURCE.LICENSE.txt` retains the distribution's original credit.
`source-metadata.json` records the original author, source and license metadata.

`hand.glb` losslessly combines the original glTF, binary buffer and three
2048-square texture images. Meshes, weights, materials and the `Open/Close`
animation are retained. There are 16,330 split vertices, 28,994 triangles and
69 skin joints; 22 joints have nonzero skin weights. One additional structural
palm ancestor rotates in the source animation.

GLB SHA-256:
`3eb51d0b612fb4b5f3b63c9e32ac145be191abcfd38ca7d3c5cf4fe0a7ee2d58`.

The artist's movement is open at 0 seconds, most curled at 1.333333 seconds, and
open again at 3.208333 seconds. `rig-report.json` records each deform bone's
open/closed transform and local bend axis. These are rig calibration values,
not measured human joint limits.

`src/instruments/gesticulating-hand/hand-source-motion-data.js` is **derived
animation data under CC BY-SA 4.0**, attributed to Elena FF in its file header.
The extraction retains the union of all 154 relevant rotation key times, samples
the other tracks at those times, and encodes the normalized quaternions as
Float32 data. Original timing is retained. Runtime playback may blend the motion
with user edits and map its duration to the chosen tempo. Modified model and
animation data must retain the same license. The separately authored sampling
helper and instrument implementation are MIT, as marked in their files.

## Rebuild from the pinned distribution

From the repository root, use a temporary directory for downloaded source files:

```sh
python3 scripts/gesticulating-hand/pack-model.py --download --out-dir /tmp/hand-source
python3 scripts/gesticulating-hand/analyze-model.py --model-dir /tmp/hand-source
python3 scripts/gesticulating-hand/build-source-motion.py --model-dir /tmp/hand-source --out-dir /tmp/hand-motion
```

The packed model is `/tmp/hand-source/elena-rigged-hand.glb`. Compare its hash with
the one above before replacing `hand.glb`. The analysis produces a new
`rig-report.json`; the motion extractor produces `hand-source-motion-data.js`
and an independent source-reference fixture. It does not rewrite the runtime
sampling helper.
