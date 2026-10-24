import assert from "node:assert/strict";

// An additive, exact reversal for older frozen-site byte references. These
// historical tests still reject unrelated drift; they just predate Tapezoid.
const changes = new Map([
  ["README.md", [[
    "**[Tapezoid](tapezoid.html)** puts a continuous original track—or your local\n"
      + "audio—on a ribbon routed out of a cassette at the top of an overhead desk.\n"
      + "Grab bare tape and draw a multi-turn maze in one stroke; drag a post back to\n"
      + "squeeze its delay. TIME shows each stretch's own length-dependent seconds;\n"
      + "pools add storage on their stretch. The toolbar adds heads, up to 32 posts,\n"
      + "delay pools, Razor, Scotch and Eraser. Reich-inspired two-, four- and eight-loop phase studies\n"
      + "use original or local audio; head-to-REC feedback is a separate tape echo.\n"
      + "Razor makes two continuous paths with different arrivals, rejoining before\n"
      + "the next part by default. Drag the blue end to a later tape segment—or touch\n"
      + "that segment with Scotch—to make an adjustable A/B mixer. Scotch at the original\n"
      + "join restores one path. The transport sits above one\n"
      + "cassette: the downloaded [“Cassette Tape” by joshtmc](https://sketchfab.com/3d-models/cassette-tape-4613411c569d4185a2e07f31b1bf9e49)\n"
      + "(CC BY-SA 4.0) is now the default 3D model. Choose a different local GLB or\n"
      + "the generated shell instead. Audio starts off; REC prints the track,\n"
      + "**not microphone input**.\n"
      + "Find it in Work in Progress.\n"
      + "[Controls and limitations](docs/tapezoid.md).\n\n",
    "",
  ]]],
  ["docs/THIRD_PARTY_NOTICES.md", [[
    "Dentaphone, Nightingale Manifold, Acoustic Manifold, and Tapezoid use the\n"
      + "existing local Three.js 0.185.1 bundle for offline-safe WebGL rendering.\n"
      + "Tapezoid's tape, ports, tools and fallback shell are code-generated. Its default\n"
      + "cassette is the credited model below. A performer can replace it with their own\n"
      + "GLB for a local session without uploading or redistributing that chosen model.\n"
      + "Dentaphone and Tapezoid use the vendored GLTFLoader utilities:",
    "Dentaphone, Nightingale Manifold, and Acoustic Manifold vendor Three.js 0.185.1\n"
      + "for local, offline-safe WebGL rendering. Dentaphone also vendors the GLTFLoader\n"
      + "utilities needed by its anatomical jaw:",
  ], [
    "## Tapezoid cassette\n\n"
      + "[“Cassette Tape” by joshtmc](https://sketchfab.com/3d-models/cassette-tape-4613411c569d4185a2e07f31b1bf9e49)\n"
      + "is licensed under [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/).\n"
      + "The author's 3D model and its three embedded textures are distributed unchanged\n"
      + "in `assets/tapezoid/cassette-tape.glb` (SHA-256\n"
      + "`19f27f4eb2b0c5463623dd1479fee7e6874c3b8f2df88bd022f28ef325009668`).\n"
      + "The bundled file is the user's smaller-texture download, **not** the cassette\n"
      + "from the earlier Sketchfab link `cassette-a9534b2dcaa94b299f1a5ae029517c3c`.\n"
      + "The full credit, original source, license and model limitations are alongside it\n"
      + "in [`assets/tapezoid/cassette-tape.LICENSE.txt`](../assets/tapezoid/cassette-tape.LICENSE.txt).\n"
      + "The model and adaptations retain CC BY-SA 4.0; separately authored Morphazoid\n"
      + "code remains MIT. The creator has not endorsed the instrument.\n\n",
    "",
  ]]],
  ["scripts/site/runtime-files.tsv", [[
    "# Tapezoid: overhead 3D tape with freehand routing and continuous virtual forks.\n"
      + "copy+require\tsrc/instruments/tapezoid/tapezoid-app.js\n"
      + "copy+require\tsrc/instruments/tapezoid/tapezoid.css\n"
      + "copy+require\tsrc/instruments/tapezoid/artist-cassette.js\n"
      + "copy+require\tsrc/instruments/tapezoid/path.js\n"
      + "copy+require\tsrc/instruments/tapezoid/full-presets.js\n"
      + "copy+require\tsrc/instruments/tapezoid/demo-material.js\n"
      + "copy+require\tsrc/instruments/tapezoid/tapezoid-processor.js\n"
      + "copy+require\tassets/instruments/tapezoid.webp\n"
      + "copy+require\tassets/tapezoid/cassette-tape.glb\n"
      + "copy+require\tassets/tapezoid/cassette-tape.LICENSE.txt\n"
      + "copy+require\tdocs/tapezoid.md\n",
    "",
  ]]],
  ["src/pages/manifest.js", [['  "tapezoid.html",\n', ""]]],
  ["src/site/instrument-registry.js", [[
    '    { id: "tapezoid", label: "Tapezoid", href: "tapezoid.html", picker: true, imageHref: "assets/instruments/tapezoid.webp" },\n', "",
  ]]],
  ["src/site/catalogue-taxonomy.js", [['  "tapezoid": ["3d", "graphic-ui"],\n', ""]]],
  ["src/site/instrument-catalog.js", [[
    '  "tapezoid": define(\n'
      + '    "Overhead 3D tape instrument · work in progress",\n'
      + '    "One cassette feeds a moving tape maze. Grab bare tape to draw several turns across the desk in one stroke; the route changes a bounded recording loop\'s travel and echo. Add movable REC/PLAY heads, up to 32 posts, and zigzag delay pools. Reich-inspired two/four/eight virtual-motor phase studies use original or local audio; head-to-REC feedback is a separate echo. TIME labels each stretch. Razor forks continuous routes with different arrivals; move its end or use Scotch on later tape for an adjustable A/B mixer, or Scotch the original join to restore one path. Bundled CC BY-SA 4.0 artist cassette by joshtmc, optional local GLB or generated shell. No microphone recording.",\n'
      + '    "Turn on Audio for Afterimage, then grab the bare tape and draw a maze. Try the Phase studies, or add a pool and Razor to send two paths out of sync; Scotch their new join to mix the arrivals.",\n'
      + '    ["Original track", "Local audio file", "Bundled 3D cassette", "Local 3D model", "3D", "Pointer", "Touch", "Freehand tape routing", "Tape echo", "Phase studies", "Delay pools", "Editable heads and posts", "Razor, fork and patch", "Presets"],\n'
      + "  ),\n",
    "",
  ]]],
  ["src/site/instrument-midi-capabilities.js", [
    ['    "splice-ring",\n    "tapezoid",\n    "onset-atlas",\n',
      '    "splice-ring",\n    "onset-atlas",\n'],
    ['  "algorithmic-mazes",\n  "tapezoid",\n',
      '  "algorithmic-mazes",\n'],
    ['"head-shed", "splice-ring", "tapezoid", "onset-atlas"', '"head-shed", "splice-ring", "onset-atlas"'],
  ]],
]);

export function restoreTapezoidSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string" || !changes.has(file)) return source;
  const replacements = changes.get(file);
  const counts = replacements.map(([after]) => source.split(after).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  for (const count of counts) assert.equal(count, 1, `${file}: exact Tapezoid addition`);
  for (const [after, before] of replacements) source = source.replace(after, () => before);
  return source;
}
