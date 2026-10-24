import {
  BRANCH_POOL_GAP, BRANCH_POOL_MARGIN, buildPath, clampRoller, copyNodes, DEFAULT_HEADS, DEFAULT_NODES,
  EDIT_MAX, EDIT_MIN, makeSplit, MAX_DELAY_POOLS, MAX_GUIDE_POSTS,
  MAX_PLAY_HEADS, MAX_POOL_SECONDS, MAX_RECORD_HEADS, MIN_POOL_SECONDS,
  MIN_SPLIT_SPAN, razorSplitRange, ROLLER_BOUNDS,
} from "./path.js";

const ROLLER_IDS = DEFAULT_NODES.filter(node => node.kind === "roller").map(node => node.id);
// Hand-drawn tape may extend to the bottom of a portrait screen. Factory
// dice still starts with a legible, compact route instead of throwing guides
// past the initial camera framing.
const DICE_ROUTE_FRONT = 3.8;
const isPosition = value => Number.isFinite(value) && value >= EDIT_MIN && value <= EDIT_MAX;
const isPostId = id => {
  const match = /^post-([1-9]\d?)$/.exec(id);
  return Boolean(match && Number(match[1]) <= MAX_GUIDE_POSTS);
};
const isPoolId = id => {
  const match = /^pool-([1-9]\d?)$/.exec(id);
  return Boolean(match && Number(match[1]) <= MAX_DELAY_POOLS);
};
export const TAPEZOID_MEMORY_DEFAULTS = Object.freeze({
  feedback: .45, phaseSlip: 0, printing: true,
  echoReturn: 0, returnHead: "play-1", monitorMix: .75, voices: 1,
});

/** Complete editable tape and overdub settings belong to the musical scene.
 * Audio, output level, speed, motor phases, PCM and recorded tape do not. */
export function captureTapezoidPreset(state) {
  return {
    rollers: state.nodes.filter(node => node.kind === "roller").map(({ id, x, z }) => ({ id, x, z })),
    heads: state.heads.map(({ id, kind, position }) => ({ id, kind, position })),
    pools: state.pools.map(({ id, laneId, position, seconds }) => ({
      id, ...(laneId ? { laneId } : {}), position, seconds,
    })),
    patches: [...state.patches],
    cut: null, // Legacy saved scenes may contain a cut; new tape is never open.
    split: state.split ? {
      start: state.split.start, end: state.split.end,
      guides: state.split.guides.map(({ id, x, z }) => ({ id, x, z })),
      ...(state.split.join !== undefined
        ? { join: state.split.join, mix: state.split.mix } : {}),
    } : null,
    feedback: state.feedback,
    phaseSlip: state.phaseSlip,
    printing: state.printing,
    echoReturn: state.echoReturn,
    returnHead: state.returnHead,
    monitorMix: state.monitorMix,
    voices: state.voices,
  };
}

export function validateTapezoidPreset(snapshot) {
  const keys = Object.keys(snapshot ?? {}).sort().join(",");
  const originalKeys = "cut,echoReturn,feedback,heads,monitorMix,patches,phaseSlip,printing,returnHead,rollers,voices";
  const splitKeys = originalKeys.replace(/,voices$/, ",split,voices");
  const currentKeys = splitKeys.replace(/,printing/, ",pools,printing");
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || ![originalKeys, splitKeys, currentKeys].includes(keys)) {
    throw new TypeError("Expected a complete Tapezoid tape scene");
  }
  // First-generation presets stored three numeric heads and no pool field.
  // Convert them before validation so recall is transactional and new captures
  // always have one complete, self-describing format.
  const scene = keys === currentKeys && !snapshot.heads?.some(head => typeof head === "number")
    ? snapshot
    : {
      ...snapshot,
      heads: Array.isArray(snapshot.heads) && snapshot.heads.every(head => typeof head === "number")
        ? snapshot.heads.map((position, index) => ({ ...DEFAULT_HEADS[index], position }))
        : snapshot.heads,
      split: snapshot.split ?? null,
      pools: snapshot.pools ?? [],
    };
  if (!Array.isArray(scene.rollers) || scene.rollers.length < ROLLER_IDS.length
    || scene.rollers.length > ROLLER_IDS.length + MAX_GUIDE_POSTS
    || scene.rollers.filter(item => ROLLER_IDS.includes(item?.id)).map(item => item.id).join(",") !== ROLLER_IDS.join(",")
    || new Set(scene.rollers.map(item => item?.id)).size !== scene.rollers.length
    || scene.rollers.some(roller => !roller
      || Object.keys(roller).sort().join(",") !== "id,x,z"
      || (!ROLLER_IDS.includes(roller.id) && !isPostId(roller.id))
      || !Number.isFinite(roller.x)
      || !Number.isFinite(roller.z) || roller.x < ROLLER_BOUNDS.minX || roller.x > ROLLER_BOUNDS.maxX
      || roller.z < ROLLER_BOUNDS.minZ || roller.z > ROLLER_BOUNDS.maxZ)) {
    throw new TypeError(`Tapezoid needs its six factory guides and at most ${MAX_GUIDE_POSTS} movable posts`);
  }
  const heads = scene.heads;
  if (!Array.isArray(heads) || heads.length < 2 || heads.length > MAX_RECORD_HEADS + MAX_PLAY_HEADS
    || new Set(heads.map(head => head?.id)).size !== heads.length
    || heads.some(head => !head || Object.keys(head).sort().join(",") !== "id,kind,position"
      || !isPosition(head.position)
      || !(head.kind === "record" && (head.id === "record" || /^record-[2-3]$/.test(head.id))
        || head.kind === "play" && /^play-[1-4]$/.test(head.id)))
    || !heads.some(head => head.kind === "record") || !heads.some(head => head.kind === "play")
    || heads.filter(head => head.kind === "record").length > MAX_RECORD_HEADS
    || heads.filter(head => head.kind === "play").length > MAX_PLAY_HEADS) {
    throw new TypeError("Tapezoid needs one REC and one PLAY, with at most three REC and four PLAY heads");
  }
  if (!Array.isArray(scene.pools) || scene.pools.length > MAX_DELAY_POOLS
    || new Set(scene.pools.map(pool => pool?.id)).size !== scene.pools.length
    || scene.pools.some(pool => !pool
      || !["id,position,seconds", "id,laneId,position,seconds"].includes(Object.keys(pool).sort().join(","))
      || !isPoolId(pool.id) || !isPosition(pool.position)
      || pool.laneId !== undefined && !["lane-a", "lane-b"].includes(pool.laneId)
      || !Number.isFinite(pool.seconds) || pool.seconds < MIN_POOL_SECONDS || pool.seconds > MAX_POOL_SECONDS)) {
    throw new TypeError("Delay pools need bounded positions and storage times");
  }
  if (!Array.isArray(scene.patches) || scene.patches.length > 8
    || !scene.patches.every(isPosition)
    || (scene.cut !== null && !isPosition(scene.cut))) {
    throw new TypeError("Tapezoid joins and the optional cut must be on exposed tape");
  }
  const split = scene.split;
  if (split === null && scene.pools.some(pool => pool.laneId)) {
    throw new TypeError("Branch pools need a fork");
  }
  if (split !== null && (!split || typeof split !== "object" || Array.isArray(split)
    || !["end,guides,start", "end,guides,join,mix,start"].includes(Object.keys(split).sort().join(","))
    || !isPosition(split.start) || !isPosition(split.end)
    || split.end - split.start < MIN_SPLIT_SPAN || scene.cut !== null
    || Object.hasOwn(split, "join") && (!isPosition(split.join)
      || split.join <= split.end + .035 || !Number.isFinite(split.mix)
      || split.mix < 0 || split.mix > 1
      || !heads.some(head => head.kind === "play" && head.position > split.join + .02))
    || heads.some(head => head.kind === "record" && head.position > split.start - .02
      || head.kind === "play" && head.position > split.start - .015 && head.position < split.end + .015)
    || scene.pools.some(pool => {
      if (!pool.laneId) return pool.position > split.start - .025 && pool.position < split.end + .025;
      const end = pool.laneId === "lane-b" ? (split.join ?? split.end) : split.end;
      const progress = (pool.position - split.start) / (end - split.start);
      return progress < BRANCH_POOL_MARGIN - 1e-8 || progress > 1 - BRANCH_POOL_MARGIN + 1e-8;
    })
    || scene.pools.some((pool, index) => pool.laneId && scene.pools.slice(index + 1).some(other =>
      other.laneId === pool.laneId
        && Math.abs(pool.position - other.position)
          / ((pool.laneId === "lane-b" ? (split.join ?? split.end) : split.end) - split.start)
          < BRANCH_POOL_GAP - 1e-8))
    || !Array.isArray(split.guides) || split.guides.length !== 2
    || split.guides.some((guide, index) => !guide
      || Object.keys(guide).sort().join(",") !== "id,x,z"
      || guide.id !== (index ? "lane-b" : "lane-a")
      || !Number.isFinite(guide.x) || !Number.isFinite(guide.z)
      || guide.x < ROLLER_BOUNDS.minX || guide.x > ROLLER_BOUNDS.maxX
      || guide.z < ROLLER_BOUNDS.minZ || guide.z > ROLLER_BOUNDS.maxZ))) {
    throw new TypeError("Tapezoid split needs two bounded lanes on intact tape after REC");
  }
  if (!Number.isFinite(scene.feedback) || scene.feedback < 0 || scene.feedback > .88
    || !Number.isFinite(scene.phaseSlip) || scene.phaseSlip < 0 || scene.phaseSlip > .06
    || !Number.isFinite(scene.echoReturn) || scene.echoReturn < 0 || scene.echoReturn > .8
    || !Number.isFinite(scene.monitorMix) || scene.monitorMix < 0 || scene.monitorMix > 1
    || !heads.some(head => head.kind === "play" && head.id === scene.returnHead)
    || ![1, 2, 4, 8].includes(scene.voices)
    || typeof scene.printing !== "boolean") {
    throw new TypeError("Tapezoid tape memory settings must be bounded");
  }
  // A pre-fork scene may have saved open ends. Preserve its edit mark as a
  // Scotch patch, but never recall a broken path or stop a running transport.
  return scene.cut === null ? scene : {
    ...scene, cut: null, patches: [...scene.patches.slice(-7), scene.cut],
  };
}

const baseRollers = () => DEFAULT_NODES.filter(node => node.kind === "roller").map(({ id, x, z }) => ({ id, x, z }));
function scene(positions, heads, patches = [], cut = null, feedback = .63, phaseSlip = .008,
  printing = true, echoReturn = .42, returnHead = "play-1", monitorMix = .5, voices = 2, split = null) {
  const rollers = baseRollers();
  positions.forEach(([x, z], index) => { rollers[index].x = x; rollers[index].z = z; });
  return validateTapezoidPreset({
    rollers, heads: heads.map((position, index) => ({ ...DEFAULT_HEADS[index], position })),
    pools: [], patches, cut, split, feedback, phaseSlip, printing,
    echoReturn, returnHead, monitorMix, voices,
  });
}

function forkForLayout(positions, start, end) {
  const nodes = copyNodes();
  nodes.filter(node => node.kind === "roller").forEach((node, index) => {
    [node.x, node.z] = positions[index];
  });
  return makeSplit(buildPath(nodes), start, end);
}

// Routes, head separation and bounded print/feedback/slip all change the
// delayed recording. None of these scenes change Audio, phase or tape contents.
const layouts = [
  ["Original workbench", [[-5.05, -.75], [-4.3, 2.6], [-1.95, -.2], [.25, 2.55], [3.65, 2.3], [5.1, -.75]], [.19, .37, .52]],
  ["Short circuit", [[-4.2, -.45], [-3.55, .85], [-1.7, -.15], [.4, 1], [3.5, .85], [4.6, -.5]], [.11, .25, .44], [], null, .35, .002, true, .7, "play-1", .8, 1],
  ["Long way round", [[-5.55, -1], [-5.4, 2.95], [-1.4, -.9], [.2, 3], [4.2, 2.9], [5.55, -1]], [.16, .43, .65], [], null, .76, .012, true, .62, "play-2", .78],
  ["Hairpin alley", [[-5.15, -.35], [-4.75, 3], [-3.15, -.8], [-.25, 2.85], [3.8, 1.65], [5.35, -.8]], [.28, .36, .57], [], null, .51, 0, true, .16, "play-1", .4],
  ["Twin peaks", [[-5.45, -1.05], [-4.15, 2.8], [-2.45, -.7], [.75, 2.45], [3.65, -.75], [5.45, 2.85]], [.12, .31, .59], [], null, .71, .02, true, .7, "play-2", .85, 4],
  ["Ribbon stair", [[-4.55, -.45], [-4.45, 1.2], [-2.7, 2.9], [-.65, .3], [2.75, 2.8], [5.15, -.5]], [.17, .48, .61], [], null, .65, .036, true, .38, "play-1", .7, 4],
  ["S-bend", [[-5.3, -.8], [-4.7, 2.9], [-2.05, -.2], [.85, 3], [3.65, -.65], [5.3, 1.9]], [.31, .46, .67], [], null, .3, .06, true, .72, "play-2", 1, 8],
  ["Downstairs", [[-5, -.3], [-4.3, .85], [-2.9, 2.6], [-.3, 1.65], [2.95, 2.8], [5.1, -.35]], [.07, .32, .47], [], null, .45, .001],
  ["Crossing paths", [[-5.35, 2.65], [-2, -.35], [-3.25, 2.35], [1.65, -.4], [.45, 2.85], [5.3, -.45]], [.24, .41, .62], [.3], null, .79, .027, true, .65, "play-2", .55, 8],
  ["Blue echo", [[-5.05, -.8], [-4, 2.1], [-1.6, -.2], [.45, 2.7], [3.2, 1.1], [5.05, -.65]], [.14, .28, .39], [.26, .55], null, .86, .01, true, .75, "play-2", .9, 1],
  ["Detour and repair", [[-5.45, -.7], [-4.55, 2.95], [-1.25, -.8], [.6, 2.55], [3.55, 2.05], [5.55, -.9]], [.2, .38, .6], [.34], null, .59, .004, false],
  ["Fork circuit", [[-5.15, -.8], [-4.2, 2.8], [-2, -.15], [.25, 2.8], [3.5, 2.2], [5.2, -.75]],
    [.18, .55, .67], [], null, .72, .008, true, .45, "play-1", .7, 4,
    forkForLayout([[-5.15, -.8], [-4.2, 2.8], [-2, -.15], [.25, 2.8], [3.5, 2.2], [5.2, -.75]], .32, .42)],
  ["Bifurcation", [[-5.05, -.75], [-4.3, 2.6], [-1.95, -.2], [.25, 2.55], [3.65, 2.3], [5.1, -.75]],
    [.17, .64, .76], [], null, .69, .015, true, .56, "play-2", .9, 2,
    forkForLayout([[-5.05, -.75], [-4.3, 2.6], [-1.95, -.2], [.25, 2.55], [3.65, 2.3], [5.1, -.75]], .32, .41)],
];

const originalScenes = layouts.map(([label, positions, heads, patches, cut, feedback, phaseSlip,
  printing, echoReturn, returnHead, monitorMix, voices, split], index) => {
  const snapshot = scene(positions, heads, patches, cut, feedback, phaseSlip, printing,
    echoReturn, returnHead, monitorMix, voices, split);
  return {
    id: `route-${index + 1}`, label,
    snapshot: index === 12
      ? validateTapezoidPreset({ ...snapshot, pools: [{
        id: "pool-1", laneId: "lane-b",
        position: split.start + (split.end - split.start) * .47, seconds: 1.35,
      }] })
      : snapshot,
  };
});

// Reich described two independently moving loops drifting into and out of
// phase, then layering them to four and eight. These are original/user-provided
// sounds on virtual motors; head echo and the fork are separate inventions.
const reference = originalScenes[0].snapshot;
const scribble = [
  [-4.9, 3.35], [4.85, 3.3], [4.85, -1.35], [-4.65, -1.35],
  [-4.55, 2.55], [4.35, 2.5], [4.3, -.55], [-3.9, -.6],
  [-3.8, 1.65], [3.7, 1.6], [3.6, .3], [-3.15, .25],
];
const mazeRollers = [...reference.rollers.slice(0, 3),
  ...scribble.map(([x, z], index) => ({ id: `post-${index + 1}`, x, z })),
  ...reference.rollers.slice(3)];
const pairStudy = validateTapezoidPreset({
  ...reference,
  heads: [{ id: "record", kind: "record", position: .15 },
    { id: "play-1", kind: "play", position: .37 },
    { id: "play-2", kind: "play", position: .72 }],
  printing: false, feedback: .18, echoReturn: 0, monitorMix: 0,
  phaseSlip: .002, voices: 2,
});
const fourStudy = validateTapezoidPreset({
  ...reference,
  rollers: [...reference.rollers.slice(0, 3), ...mazeRollers.slice(3, 9),
    ...reference.rollers.slice(3)],
  heads: [{ id: "record", kind: "record", position: .14 },
    { id: "play-1", kind: "play", position: .43 },
    { id: "play-2", kind: "play", position: .71 }],
  printing: true, feedback: .25, echoReturn: 0, monitorMix: .24,
  phaseSlip: .007, voices: 4,
});
const eightStudy = validateTapezoidPreset({
  ...fourStudy, rollers: mazeRollers, feedback: .33, phaseSlip: .018,
  monitorMix: .31, voices: 8,
});
const echoMaze = validateTapezoidPreset({
  ...reference, rollers: mazeRollers,
  heads: [{ id: "record", kind: "record", position: .12 },
    { id: "play-1", kind: "play", position: .38 },
    { id: "play-2", kind: "play", position: .65 },
    { id: "play-3", kind: "play", position: .85 }],
  pools: [{ id: "pool-1", position: .47, seconds: 1.8 }],
  printing: true, feedback: .57, echoReturn: .62,
  returnHead: "play-2", monitorMix: .83, phaseSlip: 0, voices: 1,
});

export const TAPEZOID_FULL_PRESETS = Object.freeze([...originalScenes, {
  id: "route-14", label: "Storage spool",
  snapshot: validateTapezoidPreset({
    ...originalScenes[3].snapshot, pools: [{ id: "pool-1", position: .32, seconds: 2.15 }],
  }),
}, {
  id: "route-15", label: "Head orchard",
  snapshot: validateTapezoidPreset({
    ...originalScenes[0].snapshot,
    rollers: [...originalScenes[0].snapshot.rollers.slice(0, 3),
      { id: "post-1", x: -1.2, z: 2.05 }, ...originalScenes[0].snapshot.rollers.slice(3)],
    heads: [...originalScenes[0].snapshot.heads, { id: "record-2", kind: "record", position: .26 },
      { id: "play-3", kind: "play", position: .69 }],
    pools: [{ id: "pool-1", position: .33, seconds: 1.3 }],
    returnHead: "play-3",
  }),
}, {
  id: "route-16", label: "Phase · two loops (slow drift)",
  description: "Reich-inspired: two virtual reads of your track slowly separate. No head return; Re-sync to hear unison again.",
  snapshot: pairStudy,
}, {
  id: "route-17", label: "Phase · double to four",
  description: "Reich-inspired layering: four virtual reads slowly diverge; a drawn route adds a little tape sound.",
  snapshot: fourStudy,
}, {
  id: "route-18", label: "Phase · double to eight",
  description: "Reich-inspired layering taken faster for playability; eight independent virtual reads, not eight real tape machines.",
  snapshot: eightStudy,
}, {
  id: "route-19", label: "Head echo · tangled return",
  description: "Our tape-echo extension, not a Reich technique: a serpentine route, one storage pool and PLAY returning to REC.",
  snapshot: echoMaze,
}, {
  id: "route-20", label: "Fork · two arrival times",
  description: "Our virtual split extension: two paths join at different times and the blue branch waits in a pool.",
  snapshot: validateTapezoidPreset({
    ...originalScenes[12].snapshot, phaseSlip: .003, feedback: .44,
    echoReturn: .08, monitorMix: .88, voices: 2,
  }),
}]);

const unit = random => {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new TypeError("Expected a finite unit random value");
  return value;
};
const between = (random, min, max) => Math.round((min + unit(random) * (max - min)) * 1000) / 1000;

/** A bounded, pure complete-scene dice. Never randomizes Audio, external
 * transport, loaded PCM, physical model or output level. */
export function randomizeTapezoidPreset(_previous, random = Math.random) {
  const rollers = baseRollers().map(roller => ({
    id: roller.id,
    x: between(random, Math.max(ROLLER_BOUNDS.minX, roller.x - 1.15),
      Math.min(ROLLER_BOUNDS.maxX, roller.x + 1.15)),
    z: between(random, ROLLER_BOUNDS.minZ + .1, DICE_ROUTE_FRONT - .1),
  }));
  // Bias toward a readable handful but allow the dice to fill the whole desk.
  const postCount = Math.floor(unit(random) ** 2 * (MAX_GUIDE_POSTS + 1));
  for (let i = 0; i < postCount; i += 1) {
    const near = rollers[Math.floor(unit(random) * rollers.length)];
    rollers.splice(Math.floor(unit(random) * (rollers.length + 1)), 0, {
      id: `post-${i + 1}`,
      x: between(random, Math.max(ROLLER_BOUNDS.minX, near.x - .8),
        Math.min(ROLLER_BOUNDS.maxX, near.x + .8)),
      z: between(random, Math.max(ROLLER_BOUNDS.minZ, near.z - .8),
        Math.min(DICE_ROUTE_FRONT, near.z + .8)),
    });
  }
  const record = between(random, .06, .29);
  const heads = [record, between(random, record + .09, record + .23), between(random, record + .25, record + .47)];
  const patches = Array.from({ length: Math.floor(unit(random) * 3) }, () => between(random, .06, .94));
  const edit = unit(random);
  const cut = null;
  let split = null;
  if (edit < .42) {
    const originals = copyNodes();
    const pathNodes = [originals[0], ...rollers.map(roller => ({ ...roller, kind: "roller" })), ...originals.slice(-2)];
    const path = buildPath(pathNodes);
    const range = razorSplitRange(path, (record + heads[1]) / 2, pathNodes,
      heads.map((position, index) => ({ ...DEFAULT_HEADS[index], position })));
    if (range) {
      split = makeSplit(path, range.start, range.end);
      const lastPlay = heads[2];
      if (unit(random) < .32 && lastPlay > split.end + .09) {
        split.join = between(random, split.end + .045, lastPlay - .025);
        split.mix = between(random, 0, 1);
      }
      const guide = clampRoller(split.guides[1].x + between(random, -.45, .45),
        split.guides[1].z + between(random, -.45, .45));
      split.guides[1] = {
        ...split.guides[1], ...guide, z: Math.min(DICE_ROUTE_FRONT, guide.z),
      };
    }
  }
  const feedback = Math.round((.15 + unit(random) * .7) * 100) / 100;
  const phaseSlip = between(random, 0, .06);
  const printing = unit(random) > .15;
  const echoReturn = Math.round(unit(random) * 80) / 100;
  const monitorMix = Math.round(unit(random) * 100) / 100;
  const voices = [1, 2, 4, 8][Math.floor(unit(random) * 4)];
  const headParts = heads.map((position, index) => ({ ...DEFAULT_HEADS[index], position }));
  const extraRecords = Math.floor(unit(random) * MAX_RECORD_HEADS);
  const extraPlays = Math.floor(unit(random) * (MAX_PLAY_HEADS - 1));
  for (let i = 0; i < extraRecords; i += 1) {
    headParts.push({ id: `record-${i + 2}`, kind: "record",
      position: between(random, .055, split ? Math.max(.055, split.start - .023) : .49) });
  }
  for (let i = 0; i < extraPlays; i += 1) {
    headParts.push({ id: `play-${i + 3}`, kind: "play",
      position: between(random, split ? split.end + .04 : .22, .94) });
  }
  const poolCount = Math.floor(unit(random) * (MAX_DELAY_POOLS + 1));
  const pools = [];
  // Leave distinct places for every possible shared pool. Independent
  // random positions made six pools collapse into the same short ribbon,
  // even though the stored audio times were still valid.
  const sharedStart = split ? split.end + .035 : .06;
  const sharedSpan = .94 - sharedStart;
  for (let index = 0; index < poolCount; index += 1) {
    let laneId = null;
    if (split && unit(random) < .52) {
      const side = unit(random) < .5 ? "lane-a" : "lane-b";
      if (!pools.some(pool => pool.laneId === side)) laneId = side;
    }
    pools.push({
      id: `pool-${index + 1}`,
      ...(laneId ? { laneId } : {}),
      position: laneId
        ? split.start + ((laneId === "lane-b" ? (split.join ?? split.end) : split.end) - split.start)
          * between(random, .2, .8)
        : between(random, sharedStart + sharedSpan * (index + .45) / poolCount,
          sharedStart + sharedSpan * (index + .55) / poolCount),
      seconds: between(random, MIN_POOL_SECONDS, MAX_POOL_SECONDS),
    });
  }
  const playParts = headParts.filter(head => head.kind === "play");
  const returnHead = playParts[Math.floor(unit(random) * playParts.length)].id;
  return validateTapezoidPreset({
    rollers, heads: headParts, pools, patches, cut, split, feedback, phaseSlip, printing,
    echoReturn, returnHead, monitorMix, voices,
  });
}
