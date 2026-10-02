# Shapes Parameter Map

Design reference for consolidating the six native Shapes instruments without
changing their sound engines:

- 2D Polygon Voices (`shape.html`)
- 2D Polygon Triggers (`shape-drums.html`)
- 3D Polyhedra Voices (`solid.html`)
- 3D Polyhedra Triggers (`solid-drums.html`)
- 4D Hyperpolyhedra Voices (`hyper.html`)
- 4D Hyperpolyhedra Triggers (`hyper-drums.html`)

`Voices` and `Triggers` are systems, not dimensions. Voices normally sustain
geometric contacts. Triggers detect discrete region onsets and route them to
the shared sixteen-voice FM drum bank. The Voices system's **Percussive** mode
is a voice engine; it is not the Triggers system.

## Canonical controller banks

Every instrument should expose exactly four controller banks. Audio enable and
master level remain global and outside the banks.

| Bank | 2D Polygon | 3D Polyhedra | 4D Hyperpolyhedra | Sharing rule |
|---|---|---|---|---|
| **Play** | Run, phase, rate, direction, loop/ping-pong; Points/Line/Radar reader; 1-12 heads, offsets, and per-head options | Run, surface phase, rate, direction; surface yaw/pitch angle, run, and speed | Run, W phase, rate, direction | Run, continuous phase, rate, and direction are canonical. Reader/head controls are 2D-only; surface orientation is 3D-only. |
| **Form** | Profile count/type, star depth; roundness, aspect, skew | Type; X/Y/Z scale; X/Z skew | Type; X/Y/Z/W scale | Profile topology is canonical. Local forms and deformation are dimension-private unless an explicit conversion is defined. |
| **Rotation** | XY angle, run, rate, direction, loop/ping-pong | X/Y/Z angle, run, signed speed; Shape/Surface drag target | XW/YW/ZW angle, run, signed speed | Exact between Voices and Triggers within a dimension. Mostly dimension-private across dimensions. |
| **Mapping** | Voices: pitch, envelope, timbre, articulation, stereo. Triggers: tuning depth, character depth, hit cap, drum map | Voices: pitch, envelope, FM/PM, percussion. Triggers: tuning depth, character depth, hit cap, drum map | Same pattern as 3D | Voice state and trigger state are separate canonical namespaces. Share only fields with matching semantics. |

### Current controls that belong elsewhere

| Current location | Canonical location | Reason |
|---|---|---|
| 2D rotation rows inside Play | Rotation | They transform the form, not the playhead. |
| Drum subdivisions inside Play | Secondary rail | They select trigger-region density and should remain reachable in every bank. |
| Voice engine selector inside Sound | Secondary rail | It selects the active voice engine. |
| Drum mapping selector inside Mapping | Secondary rail | It selects the trigger routing model. |
| 2D Sound and Mapping as separate banks | One Mapping bank | The four-bank layout needs Pitch, Envelope, Character, and Space subgroups under Mapping. |
| 3D/4D Sound bank | Mapping | It contains the voice mapping and articulation parameters for those instruments. |
| 2D Output bank | Excluded from controller tabs | It is a diagnostic monitor, not a parameter bank. |
| 3D Shape/Surface drag target outside the banks | Rotation | It determines which rotational object a canvas drag manipulates. |
| 3D surface yaw/pitch in Play | Keep in Play | These rotate the reader surface, not the solid. |
| Audio and level/output | Global header | These apply to the active instrument rather than one controller bank. |

## Secondary rail

Place this rail directly above the right-hand parameter pane.

| Rail control | Voices | Triggers |
|---|---|---|
| **System** | Voices | Triggers |
| **Mode** | Sine / FM / PM / Shepard / Percussive | Dimension-specific mapping choice |
| **Divisions** | Hidden for current native behavior | 1-16 trigger regions per side |
| **Bank tabs** | Play / Form / Rotation / Mapping | Play / Form / Rotation / Mapping |

Subdivided synth notes are not part of the current native synth behavior. To
support them later without conflating timbre and event generation, add an
independent `eventSource: continuous | corners | segments` parameter. Any such
addition is a new synthesis feature, not a consolidation-only change.

## Play

### Shared transport

| Parameter | 2D | 3D | 4D | Scope |
|---|---|---|---|---|
| Running | Voices and Triggers | Voices and Triggers | Voices and Triggers | Canonical across all six instruments |
| Continuous phase | 0-1; UI step `.0005` | 0-1; UI step `.001` | 0-1; UI step `.001` | Canonical; preserve the unwrapped `continuousPhase` during handoff |
| Rate | Actual 0-4 cyc/s through a nonlinear 0-1 UI; Voices default `.25`, Triggers `.06` | `.01`-`4` cyc/s; default `.12` | `.01`-`4` cyc/s; default `.10` | Canonical in cycles/second, never in slider coordinates |
| Direction | `-1`/`+1`, shown as CCW/CW | `-1`/`+1`, reverse/forward | `-1`/`+1`, reverse/forward | Canonical numeric sign |
| Motion | Loop/ping-pong in Voices and Triggers | Triggers support both; Voices currently loop only | Triggers support both; Voices currently loop only | Preserve canonical intent; do not overwrite it when an engine supports only loop |

### Dimension-specific Play parameters

| Dimension | Parameters | Native ranges/defaults |
|---|---|---|
| 2D | Reader method; head count; relative head phases; per-head direction; per-head scan axis; direction adjustments | Reader `trace`/`scan`/`radial`; heads `1`-`12`, default `1`; equidistant phases by default |
| 3D | Reader-surface yaw and pitch; per-axis reader animation and speed | Yaw `45deg`, pitch `-22deg`; angles `-180deg`-`180deg`; speeds `-.5`-`+.5` rev/s; defaults `+.04` and `+.03` |
| 4D | No additional reader-shape parameters | The W reader uses the canonical phase and rate |

Drum subdivisions are intentionally omitted from Play; they live in the
secondary rail.

## Form

### Exact native form parameters

| Dimension | Selectable forms | Deformation |
|---|---|---|
| 2D | `1` = circle; `2` = open line; `3`-`32` = polygon or star; star depth `.05`-`.82` | Roundness `-1`-`1`; aspect `-2`-`2`; skew `-2`-`2` |
| 3D | Cube, Pyramid, Octahedron, Triangular prism, Cone, Cylinder, Sphere, Torus, dynamic Profile prism | X/Y/Z scale `.5`-`1.6`; X/Z skew `-.7`-`+.7` |
| 4D | Tesseract, Hypersphere, Hyperpyramid, Klein bottle embedding, dynamic Profile hyperprism | X/Y/Z/W scale `.5`-`1.5` |

All form parameters are exact between Voices and Triggers within the same
dimension.

### Profile lifting

| Shared profile intent | 2D | 3D | 4D |
|---|---|---|---|
| Circle | Circle | Sphere | Hypersphere |
| Open line | Open line | Extruded line profile | Line hyperprism |
| N-sided polygon | N-sided polygon | N-sided prism | N-sided hyperprism |
| N-point star | N-point star | Star prism | Star hyperprism |
| Triangle | Triangle | Triangular prism | Triangular hyperprism |
| Square | Square | Cube/profile prism | Tesseract/profile hyperprism |

Local-only forms must not overwrite the remembered shared profile:

- 3D-only: Pyramid, Octahedron, Cone, Cylinder, Torus.
- 4D-only: Hyperpyramid, Klein bottle.
- `lift` is derived metadata, not a user parameter.

### Possible deformation translations

| Source | Target | Translation quality |
|---|---|---|
| 2D aspect | 3D/4D X/Y scale ratio | The 2D transform uses `X = 2^aspect`, `Y = 2^-aspect`, then normalizes radius. It cannot round-trip absolute scale and exceeds the 3D/4D ranges. |
| 2D skew | 3D X skew | Both use `x += y * skew`, but 2D's range is much wider; values outside `-.7`-`+.7` are lossy. |
| 3D X/Y/Z scale | 4D X/Y/Z scale | Same concept; only the 3D interval `1.5`-`1.6` needs an effective 4D clamp. |
| 4D W scale | None | 4D-only. |
| 3D Z skew | None | 3D-only. |
| 2D roundness | None | 2D-only. |

When a dimension has a narrower effective range, clamp the rendered value but
do not write that clamp back into canonical state.

## Rotation

| Dimension | Angle controls | Motion controls | Defaults |
|---|---|---|---|
| 2D | XY `-180deg`-`180deg` | Run; speed `0`-`4` rev/s; direction; loop/ping-pong | Angle `0deg`, speed `.12`, clockwise, loop |
| 3D | X/Y/Z `-180deg`-`180deg` | Per-axis run; signed speed `-.5`-`+.5` rev/s; Shape/Surface drag target | X `-24deg`/`+.03`; Y `36deg`/`+.08`; Z `8deg`/`+.02` |
| 4D | XW/YW/ZW `-180deg`-`180deg` | Per-plane run; signed speed `-.5`-`+.5` rev/s | XW `24deg`/`+.06`; YW `-18deg`/`+.04`; ZW `12deg`/`-.02` |

2D XY rotation is conceptually the same plane as 3D Z rotation, but the speed
ranges and motion models differ. Treat them as dimension-private until an
explicit signed-speed and motion conversion is implemented. The current 4D
instrument exposes only the three planes involving W, so it has no current XY,
YZ, or ZX rotation controls to share with 2D/3D.

## Mapping: Voices

### Engine parameters

| Parameter family | 2D | 3D | 4D |
|---|---|---|---|
| Engine | Sine, Percussive, Shepard, FM, PM | Same five | Same five |
| Base frequency | `20`-`440` Hz; default `130` | Default `110` | Default `82` |
| Pitch range | `0`-`7` oct; default `2.5` | Default `3` | Default `4` |
| FM | Index `0`-`12`, default `3`; ratio `.25`-`8`, default `2` | Index `3`; ratio `2` | Index `3.5`; ratio `1.5` |
| PM | Depth `0`-`8` rad, default `2`; ratio `.25`-`8`, default `1` | Reuses FM controls internally | Reuses FM controls internally |
| Shepard | Source Path distance/Turn angle; `.25`-`4` oct/circuit; Follow/Oppose; corner glide `.05`-`1`; width `2`-`8` | Rate follows reader; width hardcoded `4` | Rate follows reader; width hardcoded `5` |
| Percussive | Strike level `0`-`1`; five-node timed ADSR; Pluck/Note/Sustain/Pad; attack noise `0`-`1` | Attack `.5`-`30` ms; decay `15`-`2000` ms | Attack `.5`-`30` ms; decay `15`-`2000` ms |
| Continuous amplitude envelope | Enable; swell; Segment/Pluck/Note/Sustain/Pad; editable T/A/D/S/R nodes | Enable; swell; Pluck/Note/Sustain/Pad; editable nodes; level | Same as 3D |

### 2D voice mapping controls

| Group | Parameters and exact choices |
|---|---|
| Pitch source | Vertical / Horizontal / Center distance |
| Pitch response | Linear / Exponential / Logarithmic / Smooth S / Inverted, plus five editable curve nodes |
| Amplitude source | Direct / Left-right / Up-down / Center-edge / Corner sharpness / Crossing angle / Contour position |
| Timbre source | Direct / Left-right / Up-down / Center-edge / Crossing angle / Corner sharpness / Contour position; target is FM index or PM depth |
| Percussion amplitude source | Corner sharpness / Crossing angle / Fixed / Left-right / Up-down / Center-edge / Contour position / Inner-outer polarity |
| Percussion level response | Linear / Expand high / Expand low / Smooth S / Invert |
| Stereo source | Horizontal / Vertical / Center distance |
| Stereo direction and width | Flip; width `0`-`1`, default `1` |

### Hardcoded 3D/4D voice mappings

| Destination | 3D source | 4D source |
|---|---|---|
| Pitch | Intersection Y | Projected contact Y |
| Pan | Intersection X | Projected contact X |
| FM/PM character | Z depth | W depth |
| Continuous amplitude | Edge/contact phase plus corner strength | Edge/contact phase plus corner strength |
| Shepard movement | Surface-reader rate/direction | Hyperplane-reader rate/direction |
| Percussive onset | Vertex crossing | 4D-corner crossing |

For the four-bank design, merge 2D Sound and Mapping into a single Mapping
bank with internal **Pitch**, **Envelope**, **Character**, and **Space** groups.
Normalize the visible 3D/4D Sound bank to Mapping.

## Mapping: Triggers

### Exact parameters

| Parameter | 2D | 3D | 4D |
|---|---|---|---|
| Mapping choice | Side x tangent; Contact position; Playhead x incidence | Edge x axis; 3D position; Incidence x depth | Edge axis x depth; Projected position; W depth x incidence |
| Divisions | `1`-`16`, default `2`; inactive for circle | `1`-`16`, default `2` | `1`-`16`, default `2` |
| Tuning depth | `0`-`24` semitones, default `12` | Same | Same |
| Character depth | `0`-`1`, default `.7` | Same | Same |
| Hit cap | `1`-`16`, default `6` | `1`-`12`, default `6` | `1`-`16`, default `6` |
| Destination | Shared sixteen-voice FM drum bank | Same | Same |

### Canonical mapping-family translation

| Family | 2D | 3D | 4D |
|---|---|---|---|
| `feature` | Side/subdivision -> row; tangent -> column | Edge identity -> row; axis -> column | 4D edge axis -> row; projected depth -> column |
| `position` | Y -> row; X -> column | Y -> row; X -> column | Projected Y -> row; projected X -> column |
| `incidence` | Playhead -> row; incidence -> column | Incidence -> row; Z depth -> column | W depth -> row; W incidence -> column |

These families are semantic translations, not identical acoustic mappings.
Preserve a canonical hit cap through `16`; clamp only the 3D effective value
to `12`, without replacing the canonical value.

## Cross-dimensional state rules

| State | Scope | Rule |
|---|---|---|
| Audio intent | Global | `enabled` must remain on through a dimension handoff; an inactive frame may be gain-gated without changing intent. |
| Master level | Global | Voices use `level` (`0`-`1`); Triggers use `output` (`0`-`.9`). Preserve the canonical value and clamp only the effective destination. |
| Transport | Global | `running`, `continuousPhase`, `rateCyclesPerSecond`, and `direction` are exact shared fields. |
| Motion mode | Global intent, partial support | Preserve loop/ping-pong even while a 3D/4D Voices engine can only render loop. |
| Shared profile | Global | Store `sides`, `kind`, and `starDepth`; derive the dimension's profile representation. |
| Local form selection | Per dimension | Selecting Torus, Klein, and other local forms must not erase the shared profile. |
| Form deformation | Per dimension by default | Share only through an explicit, non-destructive conversion. |
| Reader details | Per dimension | 2D heads and 3D surface orientation have no cross-dimensional equivalent. |
| Rotation | Per dimension | Exact across Voices/Triggers in that dimension; do not force unlike planes together. |
| Voice engine state | Global Voices namespace | Retain independently of Trigger settings; share fields only where their DSP meaning matches. |
| Trigger state | Global Triggers namespace | Mapping family, divisions, tuning depth, character depth, hit cap, and drum bank persist across dimensions. |
| Effective clamps | Destination-only | Never overwrite a wider canonical value merely because the active dimension has a narrower control range. |

Geometry controls are shared between Voices and Triggers within the same
dimension. Switching systems should not create a second copy of Play, Form, or
Rotation state.

## Continuity status and remaining gaps

| Gap | Current behavior | Required canonical behavior |
|---|---|---|
| Audio, Play, and phase handoff | **Implemented in Shapes:** a switch now requires both native bridges, extrapolates continuous phase through preparation, crossfades host gain, and parks the old frame without clearing its transport intent. Parked render loops sleep at zero host gain. A failed target leaves the source visible and playing. | Keep this as the required host contract for every future dimension/system adapter. |
| PM depth | **Implemented for 3D/4D handoff:** capture reports the actual `fmIndex * .7` PM depth and apply performs the inverse `.7` projection. | A future separate native PM field would remove the adapter conversion, but canonical depth must remain radians. |
| Continuous amplitude envelope | **Implemented for the compatible subset:** enabled, swell, preset, five editable points, and envelope level now cross dimensions. The 2D-only Segment name becomes Custom in 3D/4D while retaining its exact points. | Keep new envelope controls additive so older dimensions never erase state they cannot render. |
| Shepard detail | 2D captures cycles/width, while 3D/4D ignore them and use hardcoded widths. | Preserve the full canonical Shepard state; use an effective fallback only where the native engine lacks a control. |
| Percussive articulation | 2D has strike level, timed envelope, and attack noise; 3D/4D have only attack/decay. | Keep the full canonical state and define a documented effective projection rather than overwriting hidden fields. |
| Motion mode | 3D/4D Voices do not capture or apply ping-pong. | Preserve canonical mode and either implement native support or render a temporary loop fallback. |
| Trigger hit cap | 3D max is `12`; 2D/4D max is `16`. | Clamp the 3D effective value without replacing canonical `13`-`16`. |
| Deformation ranges | Related scale/skew controls use different ranges. | Use destination-only clamps and retain the source value for round trips. |

## Recommended canonical state

```js
{
  audio: {
    enabled,
    level
  },

  selection: {
    dimension: "2d" | "3d" | "4d",
    system: "voices" | "triggers"
  },

  play: {
    running,
    continuousPhase,
    rateCyclesPerSecond,
    direction,
    motion: "loop" | "pingpong"
  },

  form: {
    profile: {
      sides,
      kind: "circle" | "line" | "polygon" | "star",
      starDepth
    },
    representationByDimension: {
      "2d": "profile",
      "3d": "profile" | "pyramid" | "octahedron" | "cone" | "cylinder" | "torus",
      "4d": "profile" | "hyperpyramid" | "klein"
    }
  },

  voices: {
    engine: "sine" | "fm" | "pm" | "shepard" | "percussion",
    pitch: { baseHz, rangeOctaves },
    fm: { index, ratio },
    pm: { depthRadians, ratio },
    shepard: { source, cycles, direction, cornerGlide, width },
    percussion: {
      level,
      envelope,
      attackNoise,
      attackMs,
      decayMs
    },
    envelope: {
      enabled,
      swell,
      preset,
      points,
      level
    },
    mapping: {
      pitchSource,
      pitchCurve,
      amplitudeSource,
      timbreSource,
      panSource,
      panFlip,
      panWidth
    }
  },

  triggers: {
    mappingFamily: "feature" | "position" | "incidence",
    subdivisions,
    pitchDepthSemitones,
    characterDepth,
    strikeLimit,
    drumBankId
  },

  byDimension: {
    "2d": {
      reader,
      heads,
      headLayout,
      formDeformation,
      rotationXY
    },
    "3d": {
      readerPlane,
      formDeformation,
      rotationsXYZ,
      interactionTarget
    },
    "4d": {
      formDeformation,
      rotationsXW_YW_ZW
    }
  }
}
```

The central rule is that audio intent, transport, profile topology, Voices
state, and Triggers state are canonical and are never replaced by a
dimension's effective fallback or clamp. Only genuinely dimension-specific
reader, deformation, and rotation fields belong under `byDimension`.
