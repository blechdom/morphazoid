const freeze = (value) => Object.freeze(value);

function port(id, label, type, options = {}) {
  return freeze({
    id,
    label,
    type,
    types: freeze(options.types ?? [type]),
    required: Boolean(options.required),
    component: options.component ?? null,
  });
}

function parameter(id, label, minimum, maximum, defaultValue, options = {}) {
  return freeze({
    id,
    label,
    min: minimum,
    max: maximum,
    default: defaultValue,
    step: options.step ?? (maximum - minimum) / 100,
    unit: options.unit ?? "",
    scale: options.scale ?? "linear",
    options: options.options ? freeze([...options.options]) : null,
    low: options.low ?? "less",
    high: options.high ?? "more",
    behavior: options.behavior ?? "Changes the module's response.",
  });
}

function moduleSpec(spec) {
  return freeze({
    ...spec,
    aliases: freeze([...(spec.aliases ?? [])]),
    tags: freeze([...(spec.tags ?? [])]),
    inputs: freeze([...(spec.inputs ?? [])]),
    outputs: freeze([...(spec.outputs ?? [])]),
    params: freeze([...(spec.params ?? [])]),
    shaderSource: spec.shaderSource ? freeze({ ...spec.shaderSource }) : null,
    faust: spec.faust ? freeze({ ...spec.faust }) : null,
  });
}

const scaleParameter = () => parameter("scale", "Pitch scale", 0, 6, 2, {
  step: 1,
  options: ["Chromatic", "Major", "Minor", "Pentatonic", "Whole tone", "Octatonic", "Quarter-tone"],
  low: "chromatic grid",
  high: "quarter-tone grid",
  behavior: "Quantizes geometric positions to a musical pitch lattice; Quarter-tone uses 24 equal divisions per octave.",
});

const octaveParameter = (defaultValue = 3) => parameter("octaves", "Pitch span", 1, 4, defaultValue, {
  step: 1,
  unit: "oct",
  low: "compact",
  high: "wide",
  behavior: "Sets how many octaves the geometric field can traverse.",
});

const pitchGateOutputs = () => [
  port("pitch", "pitch", "control"),
  port("gate", "gate", "control", { component: "y" }),
];

const coordinateOutputs = (xLabel = "x", yLabel = "y") => [
  port("x", xLabel, "control"),
  port("y", yLabel, "control", { component: "y" }),
];

const fieldOutputs = (fieldLabel = "field") => [
  port("field", fieldLabel, "control"),
  port("gate", "gate", "control", { component: "y" }),
];

const rootInput = () => [port("root", "root / transpose", "control")];

export const SHADER_SYNTH_PLAYGROUND_GEOMETRY_MODULES = freeze([
  moduleSpec({
    id: "mirror-fold-sequencer", kind: 69, name: "Mirror Fold Sequencer", category: "geometry", color: "#ff8ccf",
    aliases: ["domain fold", "mirror sequence", "folded time", "triangle fold", "repeated domain"],
    tags: ["geometry", "domain repetition", "fract", "abs", "mirror", "sequence", "pitch gate"],
    description: "Treats step number as a shader coordinate, then repeatedly tiles and mirrors that coordinate before reading pitch from the folded position.",
    execution: "Single-sample · bounded domain-fold loop", wgsl: "x = abs(fract(x * symmetry + warp) * 2.0 - 1.0);",
    auditionKind: "pitch-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy kaleidoscopic domain fold", url: "https://www.shadertoy.com/view/4ss3WX" },
    inputs: rootInput(), outputs: pitchGateOutputs(),
    params: [
      parameter("rate", "Step rate", 0.05, 24, 4.2, { step: 0.01, unit: "Hz", scale: "log", low: "slow cells", high: "rapid cells", behavior: "Sets how quickly time advances from one folded coordinate to the next." }),
      parameter("length", "Pattern length", 2, 128, 17, { step: 1, low: "short repeat", high: "long form", behavior: "Sets how many source coordinates exist before the domain repeats." }),
      parameter("folds", "Fold passes", 1, 8, 4, { step: 1, low: "one reflection", high: "deep self-similarity", behavior: "Repeats the tile-and-mirror operation, creating nested and self-similar note orderings." }),
      parameter("symmetry", "Symmetry", 2, 16, 5, { step: 1, low: "broad mirrors", high: "many wedges", behavior: "Sets how many mirrored subdomains are created during every fold pass." }),
      parameter("warp", "Fold offset", 0, 1, 0.23, { step: 0.001, low: "centered", high: "displaced", behavior: "Moves the fold origins so the same symmetry produces a different traversal." }),
      scaleParameter(),
      octaveParameter(3),
      parameter("width", "Gate width", 0.03, 0.98, 0.58, { step: 0.01, low: "short points", high: "long strokes", behavior: "Sets how much of each folded coordinate remains audible with smoothed edges." }),
    ],
    faust: { symbol: "abs, floor, fmod", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "sdf-orbit-sequencer", kind: 70, name: "SDF Shape Sequencer", category: "geometry", color: "#ffad63",
    aliases: ["signed distance rhythm", "shape gate", "circle sequence", "box sequence", "sdf rhythm"],
    tags: ["geometry", "sdf", "distance field", "circle", "box", "hexagon", "ring", "sequence"],
    description: "Sweeps a line through a repeated signed shape field; each boundary crossing becomes a gate and each shape cell chooses a pitch.",
    execution: "Single-sample · analytic 2D shape field", wgsl: "gate = 1.0 - smoothstep(band, band + edge, abs(sdShape(point)));",
    auditionKind: "pitch-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy distance-field primitives", url: "https://www.shadertoy.com/view/Xds3zN" },
    inputs: rootInput(), outputs: pitchGateOutputs(),
    params: [
      parameter("rate", "Cell rate", 0.05, 20, 2.7, { step: 0.01, unit: "Hz", scale: "log", low: "slow crossings", high: "rapid crossings", behavior: "Sets how quickly the scan line crosses each geometric cell." }),
      parameter("shape", "Shape", 0, 5, 0, { step: 1, options: ["Circle", "Box", "Diamond", "Hexagon", "Ring", "Cross"], low: "round boundary", high: "cross boundary", behavior: "Changes the signed-distance formula and therefore the number and placement of crossings." }),
      parameter("size", "Shape extent", 0, 1, 0.58, { step: 0.01, low: "small target", high: "cell-sized target", behavior: "Maps the complete range to a useful extent for the selected shape, changing when the scan crosses its boundary." }),
      parameter("band", "Boundary band", 0.005, 0.28, 0.055, { step: 0.001, low: "thin trigger", high: "wide band", behavior: "Sets the audible thickness around the zero-distance contour." }),
      parameter("rotation", "Rotation", -1, 1, 0.08, { step: 0.01, unit: "turn", low: "counter-rotated", high: "rotated", behavior: "Rotates the scan path relative to the shape before measuring distance." }),
      scaleParameter(),
      octaveParameter(2),
      parameter("seed", "Cell seed", 1, 65535, 17011, { step: 1, low: "field A", high: "field B", behavior: "Chooses repeatable scan heights and pitch identities for the shape cells." }),
    ],
    faust: { symbol: "sqrt, abs, max", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "polar-kaleidoscope-sequencer", kind: 71, name: "Polar Kaleidoscope", category: "geometry", color: "#c790ff",
    aliases: ["kaleidoscope arp", "polar fold", "radial sequence", "wedge sequencer"],
    tags: ["geometry", "polar", "kaleidoscope", "angular repetition", "symmetry", "sequence"],
    description: "Wraps a circular step path into angular wedges and reflects every wedge, producing radial, palindromic pitch order.",
    execution: "Single-sample · polar modulo + reflection", wgsl: "wedge = abs(fract(angle * sectors) * 2.0 - 1.0);",
    auditionKind: "pitch-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy polar kaleidoscope", url: "https://www.shadertoy.com/view/4ss3WX" },
    inputs: rootInput(), outputs: pitchGateOutputs(),
    params: [
      parameter("rate", "Step rate", 0.05, 24, 5.25, { step: 0.01, unit: "Hz", scale: "log", low: "slow orbit", high: "rapid orbit", behavior: "Sets how quickly the point moves around the musical circle." }),
      parameter("length", "Orbit steps", 2, 128, 19, { step: 1, low: "coarse ring", high: "fine ring", behavior: "Sets how many angular samples complete the repeating orbit." }),
      parameter("sectors", "Mirror sectors", 2, 24, 7, { step: 1, low: "broad wedges", high: "fine wedges", behavior: "Divides the circle into reflected angular sectors." }),
      parameter("stride", "Angular stride", 1, 17, 5, { step: 1, low: "neighboring points", high: "star polygon", behavior: "Changes which angular point follows the current one, forming polygonal and star-like traversals." }),
      parameter("rotation", "Rotation", 0, 1, 0.11, { step: 0.001, unit: "turn", low: "original seam", high: "rotated seam", behavior: "Moves the wedge seams through the orbit and changes the mirrored note order." }),
      scaleParameter(),
      octaveParameter(3),
      parameter("width", "Gate width", 0.03, 0.98, 0.47, { step: 0.01, low: "points", high: "arcs", behavior: "Sets how long each angular sample remains audible." }),
    ],
    faust: { symbol: "atan2, fmod, abs", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "voronoi-cell-sequencer", kind: 72, name: "Voronoi Cell Sequencer", category: "geometry", color: "#73e7ff",
    aliases: ["cellular clock", "voronoi rhythm", "nearest point sequencer", "cell edge gate"],
    tags: ["geometry", "voronoi", "cellular", "nearest site", "border", "irregular rhythm", "sequence"],
    description: "Finds the closest jittered time-cell site and its runner-up; sites or the F2−F1 border ridge become irregular but deterministic musical events.",
    execution: "Single-sample · five-neighbor nearest-site search", wgsl: "nearest = min(nearest, abs(featurePoint - timeCoordinate));",
    auditionKind: "pitch-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy Voronoi distances", url: "https://www.shadertoy.com/view/ldl3W8" },
    inputs: rootInput(), outputs: pitchGateOutputs(),
    params: [
      parameter("rate", "Cell rate", 0.05, 20, 4, { step: 0.01, unit: "Hz", scale: "log", low: "sparse cells", high: "dense cells", behavior: "Sets the average density of Voronoi sites along musical time." }),
      parameter("jitter", "Site jitter", 0, 1, 0.82, { step: 0.01, low: "even grid", high: "irregular cells", behavior: "Moves each site away from the center of its cell, creating unequal event spacing." }),
      parameter("feature", "Trigger feature", 0, 1, 0, { step: 1, options: ["Sites", "Borders"], low: "cell centers", high: "shared borders", behavior: "Chooses whether gates occur near nearest sites or where two cells are equally close." }),
      parameter("width", "Feature width", 0.005, 0.34, 0.075, { step: 0.001, low: "thin events", high: "wide regions", behavior: "Sets the distance around each site or border that produces a gate." }),
      parameter("seed", "Cell seed", 1, 65535, 23173, { step: 1, low: "diagram A", high: "diagram B", behavior: "Chooses a repeatable arrangement of sites and pitch identities." }),
      scaleParameter(),
      octaveParameter(3),
      parameter("randomness", "Pitch order", 0, 1, 0.78, { step: 0.01, low: "cell order", high: "hashed order", behavior: "Morphs pitch choice from sequential cell order toward a deterministic per-feature shuffle." }),
    ],
    faust: { symbol: "min, abs, floor", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "truchet-path-sequencer", kind: 73, name: "Truchet Path Sequencer", category: "geometry", color: "#91ff8a",
    aliases: ["truchet tiles", "arc path", "tile path sequencer", "connected curve rhythm"],
    tags: ["geometry", "truchet", "tiling", "arc", "path", "hash", "sequence"],
    description: "Moves a scan point through hashed Truchet tiles; distance to the paired quarter-circle arcs opens gates along a repeatable curved path.",
    execution: "Single-sample · hashed tile orientation + arc SDF", wgsl: "distance = abs(length(local - corner) - tileRadius);",
    auditionKind: "pitch-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy Truchet experiment", url: "https://www.shadertoy.com/view/4cBcDy" },
    inputs: rootInput(), outputs: pitchGateOutputs(),
    params: [
      parameter("rate", "Tile rate", 0.05, 20, 3.35, { step: 0.01, unit: "Hz", scale: "log", low: "slow path", high: "rapid path", behavior: "Sets how quickly the scan point crosses each tile." }),
      parameter("length", "Tile strip", 2, 128, 23, { step: 1, low: "short strip", high: "long path", behavior: "Sets how many independently oriented tiles form the repeating path." }),
      parameter("lane", "Path height", -0.48, 0.48, 0.06, { step: 0.01, low: "lower arcs", high: "upper arcs", behavior: "Moves the scan line vertically through the quarter-circle paths." }),
      parameter("wander", "Path wander", 0, 1, 0.52, { step: 0.01, low: "straight scan", high: "curved scan", behavior: "Moves the scan height slowly across the strip so different arcs become active." }),
      parameter("width", "Arc width", 0.005, 0.22, 0.048, { step: 0.001, low: "thin line", high: "wide ribbon", behavior: "Sets the audible thickness around each Truchet arc." }),
      parameter("seed", "Tile seed", 1, 65535, 44711, { step: 1, low: "path A", high: "path B", behavior: "Chooses tile orientations and their repeatable pitch identities." }),
      scaleParameter(),
      octaveParameter(2),
    ],
    faust: { symbol: "sqrt, abs, floor", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "kifs-fold-sequencer", kind: 74, name: "KIFS Fold Sequencer", category: "geometry", color: "#ff6f91",
    aliases: ["iterated fold", "kaleidoscopic fractal sequence", "fractal fold arp", "kifs"],
    tags: ["geometry", "kifs", "fractal", "iterated function", "abs fold", "self similar", "sequence"],
    description: "Applies a bounded kaleidoscopic iterated-function fold to each point on a circular step path, turning self-similar regions into notes and rests.",
    execution: "Single-sample · 1–8 rotate/scale/absolute folds", wgsl: "point = rotate(abs(point), angle) * zoom - offset;",
    auditionKind: "pitch-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy KIFS fold study", url: "https://www.shadertoy.com/view/lXXSz7" },
    inputs: rootInput(), outputs: pitchGateOutputs(),
    params: [
      parameter("rate", "Step rate", 0.05, 20, 4.7, { step: 0.01, unit: "Hz", scale: "log", low: "slow orbit", high: "rapid orbit", behavior: "Sets how quickly the circular seed path advances." }),
      parameter("length", "Orbit points", 2, 128, 29, { step: 1, low: "coarse orbit", high: "long orbit", behavior: "Sets how many seed points are sampled before the fractal path repeats." }),
      parameter("iterations", "Fold iterations", 1, 8, 5, { step: 1, low: "simple symmetry", high: "deep self-similarity", behavior: "Sets the bounded number of absolute, rotation, scale, and offset operations." }),
      parameter("zoom", "Fold scale", 1.05, 2.8, 1.73, { step: 0.01, low: "gentle recursion", high: "fine recursion", behavior: "Scales the point on every iteration and changes the density of nested regions." }),
      parameter("angle", "Fold angle", -1, 1, 0.137, { step: 0.001, unit: "turn", low: "reverse rotation", high: "forward rotation", behavior: "Rotates every reflected domain before the next iteration." }),
      parameter("offset", "Fold offset", 0, 2, 0.82, { step: 0.01, low: "centered", high: "displaced", behavior: "Translates each recursive domain and changes its self-similar islands." }),
      parameter("threshold", "Region fill", 0.03, 0.97, 0.62, { step: 0.01, low: "rare islands", high: "dense field", behavior: "Sets which folded regions produce audible events." }),
      scaleParameter(),
    ],
    faust: { symbol: "abs, sin, cos", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "interference-lattice-sequencer", kind: 75, name: "Interference Lattice", category: "geometry", color: "#62f0d4",
    aliases: ["moire sequencer", "quasicrystal rhythm", "wave interference", "plane wave lattice"],
    tags: ["geometry", "interference", "moire", "quasicrystal", "rotational symmetry", "cosine", "sequence"],
    description: "Sums rotated plane waves along a two-dimensional orbit, then thresholds their interference field into quasi-periodic gates and pitches.",
    execution: "Single-sample · 3–12 bounded plane-wave sum", wgsl: "field += cos(TAU * wrappedTurns(dot(point, axis) * frequency + phase));",
    auditionKind: "pitch-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy woven interference patterns", url: "https://www.shadertoy.com/view/ttdczX" },
    inputs: rootInput(), outputs: pitchGateOutputs(),
    params: [
      parameter("rate", "Step rate", 0.05, 20, 6.1, { step: 0.01, unit: "Hz", scale: "log", low: "slow sampling", high: "rapid sampling", behavior: "Sets how quickly the orbit samples the interference field." }),
      parameter("length", "Orbit samples", 2, 128, 37, { step: 1, low: "short repeat", high: "long phase cycle", behavior: "Sets how many points are read before the orbit repeats." }),
      parameter("axes", "Wave axes", 3, 12, 7, { step: 1, low: "simple lattice", high: "dense quasicrystal", behavior: "Sets how many evenly rotated plane waves contribute to the field." }),
      parameter("frequency", "Spatial frequency", 0.5, 16, 4.3, { step: 0.01, low: "broad bands", high: "fine bands", behavior: "Sets the spacing of the virtual lines whose overlaps form rhythmic beats." }),
      parameter("rotation", "Lattice rotation", -1, 1, 0.09, { step: 0.001, unit: "turn", low: "counter-rotated", high: "rotated", behavior: "Rotates every interference axis around the sampled orbit." }),
      parameter("threshold", "Gate threshold", 0, 1, 0.57, { step: 0.01, low: "dense events", high: "rare peaks", behavior: "Keeps only field values above the chosen interference brightness." }),
      scaleParameter(),
      octaveParameter(3),
    ],
    faust: { symbol: "cos, dot", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "phase-plane", kind: 76, name: "Phase Plane", category: "geometry", color: "#79e9ff",
    aliases: ["coordinate orbit", "lissajous", "xy clock", "trajectory generator"],
    tags: ["geometry", "coordinates", "phase plane", "lissajous", "orbit", "control", "x y"],
    description: "Generates a continuous two-dimensional trajectory from absolute sample time so later geometry modules can be connected as coordinate processors.",
    execution: "Single-sample · analytic X/Y trajectory", wgsl: "point = vec2(cos(TAU * wrappedTurns(xPhase)), sin(TAU * wrappedTurns(yPhase)));",
    auditionKind: "coordinate", auditionPreset: null,
    shaderSource: { label: "ShaderToy sound clock model", url: "https://www.shadertoy.com/view/Ml2yDG" },
    inputs: [port("phase", "phase CV", "control")], outputs: coordinateOutputs("x coordinate", "y coordinate"),
    params: [
      parameter("rate", "Orbit rate", 0.005, 20, 0.31, { step: 0.001, unit: "Hz", scale: "log", low: "slow trajectory", high: "audio-rate orbit", behavior: "Sets how quickly the point completes its X-axis cycle." }),
      parameter("ratio", "Y/X ratio", 0.125, 16, 1.5, { step: 0.001, low: "slow Y motion", high: "dense Lissajous path", behavior: "Sets the frequency ratio between the two coordinate axes." }),
      parameter("phase", "Y phase", -1, 1, 0.25, { step: 0.001, unit: "turn", low: "lagging", high: "leading", behavior: "Offsets Y relative to X, changing whether the path is a line, ellipse, or crossed orbit." }),
      parameter("xRadius", "X radius", 0, 2, 1, { step: 0.01, low: "collapsed X", high: "wide X", behavior: "Scales horizontal travel through every connected field." }),
      parameter("yRadius", "Y radius", 0, 2, 1, { step: 0.01, low: "collapsed Y", high: "wide Y", behavior: "Scales vertical travel through every connected field." }),
      parameter("xCenter", "X center", -1, 1, 0, { step: 0.01, low: "left region", high: "right region", behavior: "Moves the orbit across the field without changing its shape." }),
      parameter("yCenter", "Y center", -1, 1, 0, { step: 0.01, low: "lower region", high: "upper region", behavior: "Moves the orbit vertically through the field." }),
      parameter("phaseDepth", "Phase CV depth", 0, 2, 0.25, { step: 0.001, unit: "turn", low: "fixed trajectory", high: "wide path displacement", behavior: "Offsets orbit phase from the input without pretending an arbitrary control signal can be integrated as stateless rate modulation." }),
    ],
    faust: { symbol: "os.osc", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "tile-mirror-domain", kind: 77, name: "Tile + Mirror", category: "geometry", color: "#ffcd66",
    aliases: ["fract tile", "domain repetition", "mirror grid", "repeat coordinates"],
    tags: ["geometry", "fract", "floor", "tiling", "mirror", "domain transform", "coordinate"],
    description: "Repeats incoming X/Y coordinates into local cells and optionally mirrors each axis, turning one trajectory into a tiled or palindromic domain.",
    execution: "Single-sample · coordinate transform", wgsl: "local = abs(fract(point * repeats) * 2.0 - 1.0);",
    auditionKind: "coordinate", auditionPreset: null,
    shaderSource: { label: "Book of Shaders pattern tiling", url: "https://thebookofshaders.com/09/" },
    inputs: [
      port("x", "x", "control", { required: true }),
      port("y", "y", "control"),
      port("offset", "offset CV", "control"),
    ],
    outputs: coordinateOutputs("local x", "local y"),
    params: [
      parameter("repeatX", "Repeat X", 1, 32, 4, { step: 1, low: "one cell", high: "dense columns", behavior: "Sets horizontal cell density and therefore horizontal event repetition." }),
      parameter("repeatY", "Repeat Y", 1, 32, 3, { step: 1, low: "one cell", high: "dense rows", behavior: "Sets vertical cell density independently from X." }),
      parameter("rotation", "Domain rotation", -1, 1, 0, { step: 0.001, unit: "turn", low: "counter-rotated", high: "rotated", behavior: "Mixes X and Y clocks before tiling, changing their recurrence relationship." }),
      parameter("scale", "Input scale", 0.05, 8, 1, { step: 0.01, low: "broad traversal", high: "fine traversal", behavior: "Scales the incoming trajectory before it enters the repeated grid." }),
      parameter("offsetX", "Offset X", -1, 1, 0, { step: 0.001, low: "earlier X seam", high: "later X seam", behavior: "Moves horizontal cell seams through the trajectory." }),
      parameter("offsetY", "Offset Y", -1, 1, 0, { step: 0.001, low: "earlier Y seam", high: "later Y seam", behavior: "Moves vertical cell seams through the trajectory." }),
      parameter("mirrorX", "Mirror X", 0, 1, 1, { step: 1, options: ["Forward", "Mirrored"], low: "reset seam", high: "continuous reversal", behavior: "Forward resets X at each tile seam; Mirrored reflects alternate travel into a continuous palindromic coordinate." }),
      parameter("mirrorY", "Mirror Y", 0, 1, 1, { step: 1, options: ["Forward", "Mirrored"], low: "reset seam", high: "continuous reversal", behavior: "Forward resets Y at each tile seam; Mirrored reflects alternate travel into a continuous palindromic coordinate." }),
    ],
    faust: { symbol: "floor, fmod, abs", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "polar-fold-domain", kind: 78, name: "Polar Fold", category: "geometry", color: "#c590ff",
    aliases: ["polar coordinates", "angular fold", "kaleidoscope transform", "radial coordinates"],
    tags: ["geometry", "polar", "radius", "angle", "kaleidoscope", "sector", "coordinate"],
    description: "Converts X/Y into radius and angle, then repeats and reflects the angular domain like a kaleidoscope while radial twist couples distance to timing.",
    execution: "Single-sample · guarded atan2 + sector fold", wgsl: "if (radius > originFade) { angle = atan2(y, x) / TAU; }\nfolded = fold(angle * sectors) * smoothstep(originFade, stableRadius, radius);",
    auditionKind: "coordinate", auditionPreset: null,
    shaderSource: { label: "ShaderToy polar kaleidoscope", url: "https://www.shadertoy.com/view/4ss3WX" },
    inputs: [
      port("x", "x", "control", { required: true }),
      port("y", "y", "control"),
      port("twist", "twist CV", "control"),
    ],
    outputs: coordinateOutputs("radius", "folded angle"),
    params: [
      parameter("sectors", "Sectors", 1, 32, 7, { step: 1, low: "one angle", high: "fine symmetry", behavior: "Sets how many angular copies surround the origin." }),
      parameter("rotation", "Rotation", -1, 1, 0, { step: 0.001, unit: "turn", low: "counter-rotated", high: "rotated", behavior: "Moves the symmetry seams through the input path." }),
      parameter("twist", "Radial twist", -8, 8, 0.4, { step: 0.01, low: "reverse spiral", high: "forward spiral", behavior: "Adds radius to angular phase, converting rings into spiral-like time structures." }),
      parameter("radiusGain", "Radius gain", 0, 4, 1, { step: 0.01, low: "flat radius", high: "wide radius CV", behavior: "Scales the continuous radius output." }),
      parameter("radiusOffset", "Radius offset", -2, 2, 0, { step: 0.01, low: "inward bias", high: "outward bias", behavior: "Moves the radius control range without changing angular folding." }),
      parameter("angleGain", "Angle gain", 0, 4, 1, { step: 0.01, low: "flat angle", high: "wide angle CV", behavior: "Scales the folded-angle control output." }),
      parameter("mirror", "Angle mirror", 0, 1, 1, { step: 1, options: ["Repeated", "Reflected"], low: "sector reset seams", high: "continuous sector reversal", behavior: "Repeated resets at sector seams; Reflected reverses alternate sectors so neighboring angular travel meets continuously." }),
      parameter("radiusFold", "Radius fold", 0, 1, 0, { step: 0.01, low: "continuous radius", high: "mirrored rings", behavior: "Morphs radius into repeating mirrored bands before output." }),
    ],
    faust: { symbol: "atan2, fmod, abs", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "sdf-pattern-field", kind: 79, name: "SDF Pattern", category: "geometry", color: "#ff9a64",
    aliases: ["distance field module", "shape contour", "geometry gate", "sdf field"],
    tags: ["geometry", "sdf", "distance", "contour", "circle", "box", "gate", "field"],
    description: "Measures incoming coordinates against a repeated analytic shape and exposes both its signed field and a softly edged contour gate.",
    execution: "Single-sample · repeated signed shape field", wgsl: "gate = 1.0 - smoothstep(band, band + softness, abs(distance));",
    auditionKind: "field-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy SDF primitive gallery", url: "https://www.shadertoy.com/view/Xds3zN" },
    inputs: [
      port("x", "x", "control", { required: true }),
      port("y", "y", "control"),
      port("size", "size CV", "control"),
    ],
    outputs: fieldOutputs("distance"),
    params: [
      parameter("shape", "Shape", 0, 5, 0, { step: 1, options: ["Circle", "Box", "Diamond", "Hexagon", "Ring", "Cross"], low: "circle", high: "cross", behavior: "Selects the signed-distance formula and its pattern of contour crossings." }),
      parameter("size", "Shape extent", 0, 1, 0.52, { step: 0.01, low: "small contour", high: "cell-sized contour", behavior: "Maps the full control range to a useful extent for the selected shape, so its contour remains inside the repeated cell." }),
      parameter("repeatX", "Repeat X", 1, 24, 2, { step: 1, low: "one column", high: "dense columns", behavior: "Repeats the shape horizontally before measuring distance." }),
      parameter("repeatY", "Repeat Y", 1, 24, 2, { step: 1, low: "one row", high: "dense rows", behavior: "Repeats the shape vertically." }),
      parameter("rotation", "Shape rotation", -1, 1, 0, { step: 0.001, unit: "turn", low: "counter-rotated", high: "rotated", behavior: "Rotates the incoming path relative to every repeated shape." }),
      parameter("band", "Contour band", 0, 0.35, 0.045, { step: 0.001, low: "zero contour", high: "wide contour", behavior: "Sets how far from the shape boundary the gate remains active." }),
      parameter("softness", "Edge softness", 0.001, 0.2, 0.018, { step: 0.001, low: "precise crossing", high: "rounded event", behavior: "Smooths contour transitions explicitly; compute shaders cannot use fragment-stage fwidth derivatives." }),
      parameter("invert", "Gate polarity", 0, 1, 0, { step: 1, options: ["Contour", "Away from contour"], low: "boundary events", high: "negative space", behavior: "Chooses the contour itself or its surrounding negative space as the event field." }),
    ],
    faust: { symbol: "sqrt, abs, max", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "sdf-logic", kind: 80, name: "SDF Logic", category: "geometry", color: "#ff7bba",
    aliases: ["distance boolean", "shape union", "shape intersection", "rhythm boolean"],
    tags: ["geometry", "sdf", "union", "intersection", "subtraction", "boolean", "gate", "morph"],
    description: "Combines two distance streams with union, intersection, subtraction, or XOR-like logic; a third control morphs toward a related operation.",
    execution: "Single-sample · distance-field min/max logic", wgsl: "distance = min(a, b); // union; max and max(a, -b) form other operations",
    auditionKind: "sdf-logic", auditionPreset: null,
    shaderSource: { label: "Book of Shaders distance composition", url: "https://thebookofshaders.com/07/" },
    inputs: [
      port("a", "distance A", "control", { required: true }),
      port("b", "distance B", "control", { required: true }),
      port("morph", "morph CV", "control"),
    ],
    outputs: fieldOutputs("distance"),
    params: [
      parameter("operation", "Operation", 0, 3, 0, { step: 1, options: ["Union", "Intersection", "A minus B", "XOR"], low: "rhythmic OR", high: "exclusive regions", behavior: "Selects the signed-distance boolean used as the primary field." }),
      parameter("smoothing", "Smooth union", 0, 0.5, 0.06, { step: 0.001, low: "hard topology", high: "merged contours", behavior: "Rounds the union and related morph target instead of switching at a sharp minimum." }),
      parameter("threshold", "Gate contour", -0.5, 0.5, 0, { step: 0.001, low: "inside contour", high: "outside contour", behavior: "Moves only the gate-extraction contour through the field; the continuous field output is unchanged." }),
      parameter("width", "Gate width", 0.001, 0.4, 0.04, { step: 0.001, low: "thin result", high: "wide result", behavior: "Sets the audible band around the combined distance contour." }),
      parameter("gainA", "Distance A gain", 0.1, 4, 1, { step: 0.01, low: "A compressed", high: "A expanded", behavior: "Rescales the first field before boolean composition." }),
      parameter("gainB", "Distance B gain", 0.1, 4, 1, { step: 0.01, low: "B compressed", high: "B expanded", behavior: "Rescales the second field independently." }),
      parameter("bias", "Field output bias", -1, 1, 0, { step: 0.001, low: "negative field", high: "positive field", behavior: "Offsets the continuous field output itself, which also moves its gate contour unless Gate contour compensates." }),
      parameter("morph", "Logic morph", 0, 1, 0, { step: 0.01, low: "selected operation", high: "paired operation", behavior: "Crossfades toward a paired distance operation; the morph input shifts this value by half range." }),
    ],
    faust: { symbol: "min, max", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "interference-field", kind: 81, name: "Interference Field", category: "geometry", color: "#63e7d0",
    aliases: ["moire field", "plane waves", "plasma controls", "quasicrystal field"],
    tags: ["geometry", "interference", "moire", "plane wave", "plasma", "field", "gate"],
    description: "Sums evenly rotated plane waves at incoming X/Y coordinates and exposes their continuous interference brightness plus a thresholded event field.",
    execution: "Single-sample · 2–12 bounded plane waves", wgsl: "field += cos(TAU * wrappedTurns(dot(point, direction) * frequency + phase));",
    auditionKind: "field-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy woven interference patterns", url: "https://www.shadertoy.com/view/ttdczX" },
    inputs: [
      port("x", "x", "control", { required: true }),
      port("y", "y", "control"),
      port("phase", "phase CV", "control"),
    ],
    outputs: fieldOutputs("field"),
    params: [
      parameter("axes", "Wave axes", 2, 12, 5, { step: 1, low: "simple crossing", high: "dense quasicrystal", behavior: "Sets rotational symmetry by changing how many plane waves meet." }),
      parameter("frequency", "Spatial frequency", 0.1, 24, 3.7, { step: 0.01, low: "broad bands", high: "fine bands", behavior: "Sets virtual stripe spacing and event density." }),
      parameter("rotation", "Field rotation", -1, 1, 0, { step: 0.001, unit: "turn", low: "counter-rotated", high: "rotated", behavior: "Changes which mixture of X and Y motion crosses each wave." }),
      parameter("phase", "Field phase", -1, 1, 0, { step: 0.001, unit: "turn", low: "earlier lattice", high: "later lattice", behavior: "Moves all interference bands without moving the incoming trajectory." }),
      parameter("threshold", "Gate threshold", 0, 1, 0.6, { step: 0.01, low: "dense regions", high: "rare peaks", behavior: "Selects how much constructive interference is needed for an event." }),
      parameter("softness", "Gate softness", 0.001, 0.35, 0.035, { step: 0.001, low: "sharp lattice", high: "rounded lattice", behavior: "Smooths the threshold into a usable control envelope." }),
      parameter("gain", "Field gain", 0, 4, 1, { step: 0.01, low: "flat field", high: "wide CV", behavior: "Scales continuous field output around zero." }),
      parameter("bias", "Field bias", -1, 1, 0, { step: 0.001, low: "negative CV", high: "positive CV", behavior: "Offsets continuous field output after normalization." }),
    ],
    faust: { symbol: "cos", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "voronoi-event-field", kind: 82, name: "Voronoi Events", category: "geometry", color: "#69dcff",
    aliases: ["worley controls", "cell identity", "voronoi gate", "cell border field"],
    tags: ["geometry", "voronoi", "worley", "cell", "nearest site", "border", "field", "gate"],
    description: "Searches a fixed 3×3 neighborhood around incoming coordinates; the nearest-cell identity becomes held CV while sites or the local F2−F1 ridge become events.",
    execution: "Single-sample · fixed local 3×3 feature search", wgsl: "f1 = min(f1, dot(delta, delta)); // also retain local f2 and nearest cell",
    auditionKind: "field-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy Voronoi distances", url: "https://www.shadertoy.com/view/ldl3W8" },
    inputs: [
      port("x", "x", "control", { required: true }),
      port("y", "y", "control"),
      port("motion", "cell motion", "control"),
    ],
    outputs: fieldOutputs("cell CV"),
    params: [
      parameter("scale", "Cell scale", 0.25, 24, 3.2, { step: 0.01, low: "large cells", high: "small cells", behavior: "Sets how many cells the incoming path can cross." }),
      parameter("jitter", "Site jitter", 0, 1, 0.8, { step: 0.01, low: "regular grid", high: "irregular cells", behavior: "Moves feature sites away from their cell centers." }),
      parameter("feature", "Event feature", 0, 1, 0, { step: 1, options: ["Sites", "Borders"], low: "center events", high: "edge events", behavior: "Chooses nearest-site distance or the F2−F1 ridge as the gate field." }),
      parameter("width", "Feature width", 0, 1, 0.25, { step: 0.001, low: "thin events", high: "broad events", behavior: "Maps the full knob to a useful distance range for sites or borders, whose natural scales differ." }),
      parameter("seed", "Diagram seed", 1, 65535, 31847, { step: 1, low: "diagram A", high: "diagram B", behavior: "Chooses deterministic feature positions and held cell identities." }),
      parameter("motionX", "Motion X", -2, 2, 0.2, { step: 0.01, low: "reverse drift", high: "forward drift", behavior: "Maps the motion input into horizontal travel through the cells." }),
      parameter("motionY", "Motion Y", -2, 2, -0.13, { step: 0.01, low: "reverse drift", high: "forward drift", behavior: "Maps the same motion input into an independent vertical drift." }),
      parameter("cellSpread", "Cell CV spread", 0, 4, 1, { step: 0.01, low: "flat identity", high: "wide identity CV", behavior: "Scales the held random value associated with the nearest cell." }),
    ],
    faust: { symbol: "min, floor", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "truchet-router", kind: 83, name: "Truchet Router", category: "geometry", color: "#8df58b",
    aliases: ["arc tile field", "truchet routing", "connected path gate", "tile orientation cv"],
    tags: ["geometry", "truchet", "tile", "arc", "path", "routing", "field", "gate"],
    description: "Measures incoming coordinates against paired circular arcs in deterministic Truchet tiles; arc proximity becomes a gate, with a short seam fade before tile identity changes.",
    execution: "Single-sample · cell hash + two arc distances", wgsl: "arc = min(abs(length(q - cornerA) - radius), abs(length(q - cornerB) - radius));",
    auditionKind: "field-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy Truchet + kaleidoscope", url: "https://www.shadertoy.com/view/7lKSWW" },
    inputs: [
      port("x", "x", "control", { required: true }),
      port("y", "y", "control"),
      port("turn", "turn CV", "control"),
    ],
    outputs: fieldOutputs("tile CV"),
    params: [
      parameter("scale", "Tile scale", 0.25, 24, 3, { step: 0.01, low: "large tiles", high: "fine tiles", behavior: "Sets how many arc tiles the trajectory crosses." }),
      parameter("radius", "Arc radius", 0.2, 0.8, 0.5, { step: 0.001, low: "detached corner arcs", high: "overlapping arcs", behavior: "Changes each pair of corner arcs; 0.5 meets neighboring tiles at their edge midpoints." }),
      parameter("width", "Arc width", 0.002, 0.3, 0.045, { step: 0.001, low: "thin path", high: "wide path", behavior: "Sets the active ribbon around each pair of tile arcs." }),
      parameter("orientation", "Orientation density", 0, 1, 0.5, { step: 0.01, low: "mostly one turn", high: "mostly opposite turn", behavior: "Biases the deterministic tile orientations and therefore global connectivity." }),
      parameter("seed", "Tile seed", 1, 65535, 42019, { step: 1, low: "routing A", high: "routing B", behavior: "Chooses a repeatable tiled-arc layout." }),
      parameter("rotation", "Domain rotation", -1, 1, 0, { step: 0.001, unit: "turn", low: "counter-rotated", high: "rotated", behavior: "Rotates the input trajectory through the tile grid." }),
      parameter("turnDepth", "Turn CV depth", -1, 1, 0.15, { step: 0.001, unit: "turn", low: "reverse steering", high: "forward steering", behavior: "Lets the turn input rotate the entire path traversal." }),
      parameter("tileSpread", "Tile CV spread", 0, 4, 1, { step: 0.01, low: "flat routing CV", high: "wide routing CV", behavior: "Scales the stable value emitted for each tile orientation and identity." }),
    ],
    faust: { symbol: "sqrt, abs, floor", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
]);

// The host provides the sample clock, hashing, scale quantizers, and the
// click-safe step envelope. These helpers are analytic and keep every output
// sample independent, so no hidden history or CPU work occurs between nodes.
export const SHADER_SYNTH_PLAYGROUND_GEOMETRY_HELPERS = /* wgsl */ `
fn geometryWrappedTurns(turns: f32) -> f32 {
  return fract(turns + 0.5) - 0.5;
}

fn geometryRotate(point: vec2<f32>, turns: f32) -> vec2<f32> {
  let angle = geometryWrappedTurns(turns) * TAU;
  let cosine = cos(angle);
  let sine = sin(angle);
  return vec2<f32>(
    point.x * cosine - point.y * sine,
    point.x * sine + point.y * cosine
  );
}

fn geometryShapeDistance(point: vec2<f32>, shape: u32, size: f32) -> f32 {
  let safeSize = max(size, 0.001);
  let q = abs(point);
  if (shape == 1u) {
    let delta = q - vec2<f32>(safeSize);
    return length(max(delta, vec2<f32>(0.0))) + min(max(delta.x, delta.y), 0.0);
  }
  if (shape == 2u) {
    return (q.x + q.y) * 0.70710678 - safeSize;
  }
  if (shape == 3u) {
    return max(q.x * 0.8660254 + q.y * 0.5, q.y) - safeSize;
  }
  if (shape == 4u) {
    return abs(length(point) - safeSize) - safeSize * 0.16;
  }
  if (shape == 5u) {
    let vertical = max(q.x - safeSize * 0.24, q.y - safeSize);
    let horizontal = max(q.x - safeSize, q.y - safeSize * 0.24);
    return min(vertical, horizontal);
  }
  return length(point) - safeSize;
}

// Each local pattern cell spans -0.5..0.5. Calibrating a normalized extent
// per shape keeps the complete control range useful. These are signed shape
// fields, so contour-width units remain relative to the selected formula.
fn geometryShapeSize(shape: u32, amount: f32) -> f32 {
  var maximum = 0.68;
  if (shape == 1u || shape == 5u) {
    maximum = 0.46;
  } else if (shape == 3u) {
    maximum = 0.66;
  } else if (shape == 4u) {
    maximum = 0.59;
  }
  return mix(0.04, maximum, clamp(amount, 0.0, 1.0));
}

fn geometryPitchDegree(field: f32, noteCount: u32) -> u32 {
  let safeCount = max(noteCount, 1u);
  return min(u32(floor(clamp(field, 0.0, 0.999999) * f32(safeCount))), safeCount - 1u);
}

fn geometrySmoothMin(a: f32, b: f32, smoothing: f32) -> f32 {
  let safeSmoothing = max(smoothing, 0.000001);
  let blend = clamp(0.5 + 0.5 * (b - a) / safeSmoothing, 0.0, 1.0);
  return mix(b, a, blend) - safeSmoothing * blend * (1.0 - blend);
}

fn geometrySmoothMax(a: f32, b: f32, smoothing: f32) -> f32 {
  return -geometrySmoothMin(-a, -b, smoothing);
}

fn geometryCellIdentity(cell: vec2<i32>, seed: u32) -> u32 {
  let x = bitcast<u32>(cell.x);
  let y = bitcast<u32>(cell.y);
  return (x * 2246822519u) ^ (y * 3266489917u) ^ seed;
}

fn geometryHash2(cell: vec2<i32>, seed: u32) -> vec2<f32> {
  let identity = geometryCellIdentity(cell, seed);
  return vec2<f32>(
    hashU32(identity * 747796405u + 2891336453u),
    hashU32(identity * 277803737u + 668265263u)
  );
}
`;

// Inserted inside the host evaluateNode switch. Ready-to-play sequencers return
// pitch/gate; coordinate processors return X/Y; field processors return a
// continuous field plus a softly edged gate through the same packed vec2 path.
export const SHADER_SYNTH_PLAYGROUND_GEOMETRY_CASES = /* wgsl */ `
    case 69u: {
      let coordinates = extraStepCoordinates(sampleIndex, p0.x, 0.0);
      let patternLength = u32(clamp(round(p0.y), 2.0, 128.0));
      let foldCount = u32(clamp(round(p0.z), 1.0, 8.0));
      let symmetry = max(round(p0.w), 2.0);
      var folded = (f32(coordinates.x % patternLength) + 0.5) / f32(patternLength);
      for (var iteration = 0u; iteration < 8u; iteration += 1u) {
        if (iteration >= foldCount) { break; }
        let displacement = p1.x * fract(f32(iteration + 1u) * 0.61803398875);
        folded = abs(fract(folded * symmetry + displacement) * 2.0 - 1.0);
      }
      let scale = u32(clamp(round(p1.y), 0.0, 6.0));
      let octaves = u32(clamp(round(p1.z), 1.0, 4.0));
      let noteCount = arpScaleSize(scale) * octaves;
      let degree = geometryPitchDegree(folded, noteCount);
      let pitch = inputA.x + arpScalePitch(degree, scale);
      result = vec2<f32>(pitch, extraEdgeGate(coordinates.y, coordinates.z, p1.w));
    }
    case 70u: {
      let coordinates = extraStepCoordinates(sampleIndex, p0.x, 0.0);
      let phase = f32(coordinates.y) / f32(max(coordinates.z - 1u, 1u));
      let shape = u32(clamp(round(p0.y), 0.0, 5.0));
      let seed = u32(round(abs(p1.w)));
      let cell = coordinates.x;
      let scanHeight = hashU32(cell * 2246822519u + seed) * 1.6 - 0.8;
      let point = geometryRotate(vec2<f32>(phase * 2.0 - 1.0, scanHeight), p1.x);
      let shapeSize = geometryShapeSize(shape, p0.z);
      let distance = abs(geometryShapeDistance(point, shape, shapeSize));
      let band = clamp(p0.w, 0.005, 0.28);
      let boundary = 1.0 - smoothstep(band, band + max(0.006, band * 0.32), distance);
      let scale = u32(clamp(round(p1.y), 0.0, 6.0));
      let octaves = u32(clamp(round(p1.z), 1.0, 4.0));
      let noteCount = arpScaleSize(scale) * octaves;
      let degree = geometryPitchDegree(hashU32(cell * 3266489917u + seed), noteCount);
      let pitch = inputA.x + arpScalePitch(degree, scale);
      let cellEnvelope = extraEdgeGate(coordinates.y, coordinates.z, 0.96);
      result = vec2<f32>(pitch, boundary * cellEnvelope);
    }
    case 71u: {
      let coordinates = extraStepCoordinates(sampleIndex, p0.x, 0.0);
      let orbitSteps = u32(clamp(round(p0.y), 2.0, 128.0));
      let sectors = max(round(p0.z), 2.0);
      let stride = max(round(p0.w), 1.0);
      let orbitPosition = f32(coordinates.x % orbitSteps) / f32(orbitSteps);
      let wedge = abs(fract((orbitPosition * stride + p1.x) * sectors) * 2.0 - 1.0);
      let scale = u32(clamp(round(p1.y), 0.0, 6.0));
      let octaves = u32(clamp(round(p1.z), 1.0, 4.0));
      let noteCount = arpScaleSize(scale) * octaves;
      let degree = geometryPitchDegree(wedge, noteCount);
      let pitch = inputA.x + arpScalePitch(degree, scale);
      result = vec2<f32>(pitch, extraEdgeGate(coordinates.y, coordinates.z, p1.w));
    }
    case 72u: {
      let coordinates = extraStepCoordinates(sampleIndex, p0.x, 0.0);
      let local = f32(coordinates.y) / f32(max(coordinates.z, 1u));
      let jitter = clamp(p0.y, 0.0, 1.0);
      let mode = u32(clamp(round(p0.z), 0.0, 1.0));
      let featureWidth = clamp(p0.w, 0.005, 0.34);
      let seed = u32(round(abs(p1.x)));
      // Offset the absolute cell so the first neighborhood contains five
      // unique non-negative identities instead of clamping -2 and -1 to zero.
      let centerCell = coordinates.x + 2u;
      var nearestDistance = 10.0;
      var secondDistance = 10.0;
      var nearestCell = centerCell;
      var secondCell = centerCell + 1u;
      for (var neighbor = -2; neighbor <= 2; neighbor += 1) {
        let candidateCell = u32(i32(centerCell) + neighbor);
        let siteOffset = (hashU32(candidateCell * 747796405u + seed) - 0.5) * jitter;
        let site = f32(neighbor) + 0.5 + siteOffset;
        let distance = abs(site - local);
        if (distance < nearestDistance) {
          secondDistance = nearestDistance;
          secondCell = nearestCell;
          nearestDistance = distance;
          nearestCell = candidateCell;
        } else if (distance < secondDistance) {
          secondDistance = distance;
          secondCell = candidateCell;
        }
      }
      let borderDistance = max((secondDistance - nearestDistance) * 0.5, 0.0);
      let measuredDistance = select(nearestDistance, borderDistance, mode == 1u);
      let softness = max(0.004, featureWidth * 0.24);
      let gate = 1.0 - smoothstep(featureWidth, featureWidth + softness, measuredDistance);
      var identity = nearestCell;
      if (mode == 1u) {
        let lower = min(nearestCell, secondCell);
        let upper = max(nearestCell, secondCell);
        identity = (lower * 2246822519u) ^ (upper * 3266489917u);
      }
      let scale = u32(clamp(round(p1.y), 0.0, 6.0));
      let octaves = u32(clamp(round(p1.z), 1.0, 4.0));
      let noteCount = arpScaleSize(scale) * octaves;
      let orderedDegree = identity % max(noteCount, 1u);
      let randomDegree = geometryPitchDegree(hashU32(identity + seed * 668265263u), noteCount);
      let degree = min(
        u32(round(mix(f32(orderedDegree), f32(randomDegree), clamp(p1.w, 0.0, 1.0)))),
        max(noteCount, 1u) - 1u
      );
      result = vec2<f32>(inputA.x + arpScalePitch(degree, scale), gate);
    }
    case 73u: {
      let coordinates = extraStepCoordinates(sampleIndex, p0.x, 0.0);
      let stripLength = u32(clamp(round(p0.y), 2.0, 128.0));
      let tile = coordinates.x % stripLength;
      let phase = f32(coordinates.y) / f32(max(coordinates.z - 1u, 1u));
      let seed = u32(round(abs(p1.y)));
      let wanderTurns = f32(tile) / f32(stripLength) + hashU32(seed);
      let lane = clamp(p0.z + sin(TAU * geometryWrappedTurns(wanderTurns)) * clamp(p0.w, 0.0, 1.0) * 0.44, -0.49, 0.49);
      let point = vec2<f32>(phase - 0.5, lane);
      let orientation = hashU32(tile * 1664525u + seed) >= 0.5;
      var cornerA = vec2<f32>(-0.5, -0.5);
      var cornerB = vec2<f32>(0.5, 0.5);
      if (orientation) {
        cornerA = vec2<f32>(-0.5, 0.5);
        cornerB = vec2<f32>(0.5, -0.5);
      }
      let arcDistance = min(
        abs(length(point - cornerA) - 0.5),
        abs(length(point - cornerB) - 0.5)
      );
      let arcWidth = clamp(p1.x, 0.005, 0.22);
      let arcGate = 1.0 - smoothstep(arcWidth, arcWidth + max(0.005, arcWidth * 0.28), arcDistance);
      let scale = u32(clamp(round(p1.z), 0.0, 6.0));
      let octaves = u32(clamp(round(p1.w), 1.0, 4.0));
      let noteCount = arpScaleSize(scale) * octaves;
      let identity = tile * 2u + select(0u, 1u, orientation);
      let degree = geometryPitchDegree(hashU32(identity * 2891336453u + seed), noteCount);
      let tileEnvelope = extraEdgeGate(coordinates.y, coordinates.z, 0.94);
      result = vec2<f32>(inputA.x + arpScalePitch(degree, scale), arcGate * tileEnvelope);
    }
    case 74u: {
      let coordinates = extraStepCoordinates(sampleIndex, p0.x, 0.0);
      let orbitPoints = u32(clamp(round(p0.y), 2.0, 128.0));
      let iterations = u32(clamp(round(p0.z), 1.0, 8.0));
      let orbitPhase = f32(coordinates.x % orbitPoints) / f32(orbitPoints);
      let orbitAngle = geometryWrappedTurns(orbitPhase) * TAU;
      var point = vec2<f32>(cos(orbitAngle), sin(orbitAngle));
      for (var iteration = 0u; iteration < 8u; iteration += 1u) {
        if (iteration >= iterations) { break; }
        point = geometryRotate(abs(point), p1.x + f32(iteration) * 0.037);
        point = point * clamp(p0.w, 1.05, 2.8)
          - vec2<f32>(p1.y, p1.y * 0.731 + f32(iteration) * 0.013);
        point = clamp(point, vec2<f32>(-32.0), vec2<f32>(32.0));
      }
      let field = fract(length(point) * 0.61803398875 + abs(point.x - point.y) * 0.173);
      let scale = u32(clamp(round(p1.w), 0.0, 6.0));
      let noteCount = arpScaleSize(scale) * 3u;
      let degree = geometryPitchDegree(field, noteCount);
      let hit = field <= clamp(p1.z, 0.03, 0.97);
      let gate = select(0.0, extraEdgeGate(coordinates.y, coordinates.z, 0.58), hit);
      result = vec2<f32>(inputA.x + arpScalePitch(degree, scale), gate);
    }
    case 75u: {
      let coordinates = extraStepCoordinates(sampleIndex, p0.x, 0.0);
      let orbitSamples = u32(clamp(round(p0.y), 2.0, 128.0));
      let axes = u32(clamp(round(p0.z), 3.0, 12.0));
      let orbitPhase = f32(coordinates.x % orbitSamples) / f32(orbitSamples);
      let orbitX = geometryWrappedTurns(orbitPhase);
      let orbitY = geometryWrappedTurns(orbitPhase * 1.61803398875);
      let point = vec2<f32>(
        cos(orbitX * TAU),
        sin(orbitY * TAU)
      );
      var field = 0.0;
      for (var axis = 0u; axis < 12u; axis += 1u) {
        if (axis >= axes) { break; }
        // Stripe axes are unoriented: PI covers every unique direction once.
        let angle = TAU * geometryWrappedTurns(0.5 * f32(axis) / f32(axes) + p1.x);
        let direction = vec2<f32>(cos(angle), sin(angle));
        let waveTurns = dot(point, direction) * p0.w + f32(axis) * 0.38196601125;
        field += cos(TAU * geometryWrappedTurns(waveTurns));
      }
      let normalizedField = clamp(field / f32(axes) * 0.5 + 0.5, 0.0, 1.0);
      let scale = u32(clamp(round(p1.z), 0.0, 6.0));
      let octaves = u32(clamp(round(p1.w), 1.0, 4.0));
      let noteCount = arpScaleSize(scale) * octaves;
      let degree = geometryPitchDegree(normalizedField, noteCount);
      let hit = normalizedField >= clamp(p1.y, 0.0, 1.0);
      let gate = select(0.0, extraEdgeGate(coordinates.y, coordinates.z, 0.52), hit);
      result = vec2<f32>(inputA.x + arpScalePitch(degree, scale), gate);
    }
    case 76u: {
      let baseRate = max(p0.x, 0.0001);
      let ratio = max(p0.y, 0.0001);
      let phaseOffset = inputA.x * p1.w;
      let xPhase = phaseAtSample(sampleIndex, baseRate) + phaseOffset;
      let yPhase = phaseAtSample(sampleIndex, baseRate * ratio) + phaseOffset * ratio + p0.z;
      let x = cos(TAU * geometryWrappedTurns(xPhase)) * p0.w + p1.y;
      let y = sin(TAU * geometryWrappedTurns(yPhase)) * p1.x + p1.z;
      result = vec2<f32>(x, y);
    }
    case 77u: {
      let repeats = max(round(vec2<f32>(p0.x, p0.y)), vec2<f32>(1.0));
      var point = geometryRotate(vec2<f32>(inputA.x, inputB.x) * p0.w, p0.z);
      point += vec2<f32>(p1.x + inputC.x, p1.y - inputC.x);
      let local = fract(point * repeats);
      let localX = select(local.x, abs(local.x * 2.0 - 1.0), p1.z >= 0.5);
      let localY = select(local.y, abs(local.y * 2.0 - 1.0), p1.w >= 0.5);
      result = vec2<f32>(localX, localY) * 2.0 - 1.0;
    }
    case 78u: {
      let point = vec2<f32>(inputA.x, inputB.x);
      let radius = length(point);
      let sectors = max(round(p0.x), 1.0);
      // WGSL leaves atan2(0, 0) unbounded. Keep the origin defined and fade
      // angular control across the neighborhood where direction is ambiguous.
      var baseAngle = 0.0;
      if (radius > 0.04) {
        baseAngle = atan2(point.y, point.x) / TAU;
      }
      let angularPhase = baseAngle + p0.y + (p0.z + inputC.x) * radius;
      let repeatedAngle = fract(angularPhase * sectors);
      let foldedAngle = select(repeatedAngle, abs(repeatedAngle * 2.0 - 1.0), p1.z >= 0.5);
      let angularStability = smoothstep(0.04, 0.24, radius);
      let ringRadius = abs(fract(radius) * 2.0 - 1.0);
      let radiusField = mix(radius, ringRadius, clamp(p1.w, 0.0, 1.0));
      result = vec2<f32>(
        (radiusField + p1.x) * p0.w,
        (foldedAngle * 2.0 - 1.0) * p1.y * angularStability
      );
    }
    case 79u: {
      let repeats = max(round(vec2<f32>(p0.z, p0.w)), vec2<f32>(1.0));
      let rotated = geometryRotate(vec2<f32>(inputA.x, inputB.x), p1.x);
      let local = fract(rotated * repeats + vec2<f32>(0.5)) - vec2<f32>(0.5);
      let shape = u32(clamp(round(p0.x), 0.0, 5.0));
      let size = geometryShapeSize(shape, p0.y + inputC.x * 0.2);
      let distance = geometryShapeDistance(local, shape, size);
      let band = max(p1.y, 0.0);
      let softness = max(p1.z, 0.001);
      var gate = 1.0 - smoothstep(band, band + softness, abs(distance));
      gate = select(gate, 1.0 - gate, p1.w >= 0.5);
      result = vec2<f32>(distance, gate);
    }
    case 80u: {
      let a = inputA.x * p1.x;
      let b = inputB.x * p1.y;
      let unionDistance = geometrySmoothMin(a, b, p0.y);
      let intersectionDistance = geometrySmoothMax(a, b, p0.y);
      let subtractionDistance = geometrySmoothMax(a, -b, p0.y);
      let xorDistance = geometrySmoothMax(
        geometrySmoothMin(a, b, p0.y),
        -geometrySmoothMax(a, b, p0.y),
        p0.y
      );
      let operation = u32(clamp(round(p0.x), 0.0, 3.0));
      var primary = unionDistance;
      var paired = intersectionDistance;
      if (operation == 1u) {
        primary = intersectionDistance;
        paired = unionDistance;
      } else if (operation == 2u) {
        primary = subtractionDistance;
        paired = xorDistance;
      } else if (operation == 3u) {
        primary = xorDistance;
        paired = subtractionDistance;
      }
      let logicMorph = clamp(p1.w + inputC.x * 0.5, 0.0, 1.0);
      let distance = mix(primary, paired, logicMorph) + p1.z;
      let measured = abs(distance - p0.z);
      let width = max(p0.w, 0.001);
      let gate = 1.0 - smoothstep(width, width + max(width * 0.25, 0.003), measured);
      result = vec2<f32>(distance, gate);
    }
    case 81u: {
      let axes = u32(clamp(round(p0.x), 2.0, 12.0));
      let point = vec2<f32>(inputA.x, inputB.x);
      var field = 0.0;
      for (var axis = 0u; axis < 12u; axis += 1u) {
        if (axis >= axes) { break; }
        // A stripe and its antipode are the same axis, so sample [0, PI).
        let angle = TAU * geometryWrappedTurns(0.5 * f32(axis) / f32(axes) + p0.z);
        let direction = vec2<f32>(cos(angle), sin(angle));
        let waveTurns = dot(point, direction) * p0.y + p0.w + inputC.x;
        field += cos(TAU * geometryWrappedTurns(waveTurns));
      }
      let centered = field / f32(axes);
      let normalized = clamp(centered * 0.5 + 0.5, 0.0, 1.0);
      let softness = max(p1.y, 0.001);
      let gate = smoothstep(p1.x - softness, p1.x + softness, normalized);
      result = vec2<f32>(centered * p1.z + p1.w, gate);
    }
    case 82u: {
      let seed = u32(round(abs(p1.x)));
      let point = vec2<f32>(inputA.x, inputB.x) * p0.x
        + inputC.x * vec2<f32>(p1.y, p1.z);
      let baseCell = vec2<i32>(floor(point));
      var nearestSquared = 1000000.0;
      var secondSquared = 1000000.0;
      var nearestCell = baseCell;
      var secondCell = baseCell + vec2<i32>(1, 0);
      for (var y: i32 = -1; y <= 1; y += 1) {
        for (var x: i32 = -1; x <= 1; x += 1) {
          let candidateCell = baseCell + vec2<i32>(x, y);
          let randomSite = geometryHash2(candidateCell, seed);
          let siteOffset = mix(vec2<f32>(0.5), randomSite, clamp(p0.y, 0.0, 1.0));
          let site = vec2<f32>(candidateCell) + siteOffset;
          let delta = site - point;
          let distanceSquared = dot(delta, delta);
          if (distanceSquared < nearestSquared) {
            secondSquared = nearestSquared;
            secondCell = nearestCell;
            nearestSquared = distanceSquared;
            nearestCell = candidateCell;
          } else if (distanceSquared < secondSquared) {
            secondSquared = distanceSquared;
            secondCell = candidateCell;
          }
        }
      }
      let siteDistance = sqrt(max(nearestSquared, 0.0));
      let borderDistance = max((sqrt(max(secondSquared, 0.0)) - siteDistance) * 0.5, 0.0);
      let borderMode = round(p0.z) >= 1.0;
      let measured = select(siteDistance, borderDistance, borderMode);
      let maximumWidth = select(0.45, 0.24, borderMode);
      let width = mix(0.005, maximumWidth, clamp(p0.w, 0.0, 1.0));
      let gate = 1.0 - smoothstep(width, width + max(width * 0.25, 0.004), measured);
      var identity = geometryCellIdentity(nearestCell, seed);
      if (borderMode) {
        identity = geometryCellIdentity(nearestCell, seed)
          ^ geometryCellIdentity(secondCell, seed)
          ^ 0x9e3779b9u;
      }
      let cellControl = (hashU32(identity * 2891336453u) * 2.0 - 1.0) * p1.w;
      result = vec2<f32>(cellControl, gate);
    }
    case 83u: {
      let seed = u32(round(abs(p1.x)));
      let point = geometryRotate(
        vec2<f32>(inputA.x, inputB.x) * p0.x,
        p1.y + inputC.x * p1.z
      );
      let cell = vec2<i32>(floor(point));
      let cellPhase = fract(point);
      let local = cellPhase - vec2<f32>(0.5);
      let identity = geometryCellIdentity(cell, seed);
      let randomValue = hashU32(identity * 1664525u + 1013904223u);
      let orientation = randomValue < clamp(p0.w, 0.0, 1.0);
      var cornerA = vec2<f32>(-0.5, -0.5);
      var cornerB = vec2<f32>(0.5, 0.5);
      if (orientation) {
        cornerA = vec2<f32>(-0.5, 0.5);
        cornerB = vec2<f32>(0.5, -0.5);
      }
      let radius = clamp(p0.y, 0.2, 0.8);
      let arcDistance = min(
        abs(length(local - cornerA) - radius),
        abs(length(local - cornerB) - radius)
      );
      let width = max(p0.z, 0.002);
      let arcGate = 1.0 - smoothstep(width, width + max(width * 0.28, 0.003), arcDistance);
      let cellEdgeDistance = min(
        min(cellPhase.x, 1.0 - cellPhase.x),
        min(cellPhase.y, 1.0 - cellPhase.y)
      );
      let cellEnvelope = smoothstep(0.0, max(width * 0.35, 0.008), cellEdgeDistance);
      let gate = arcGate * cellEnvelope;
      let orientationControl = select(-0.25, 0.25, orientation);
      let tileControl = ((randomValue * 2.0 - 1.0) * 0.75 + orientationControl) * p1.w;
      result = vec2<f32>(tileControl, gate);
    }
`;
