import { ERA_PROP_OVERRIDES } from './puggler-era-props.js';
// Skin identity joins artwork and era audio. The simulation keeps physical
// prop identity and assigned sound roles; skin changes do not re-rack the act.
export const SKINS = Object.freeze([
  { id: 'punk', name: 'Trashpunk', riders: ['Puggler', 'Roxy', 'Moss'] },
  { id: 'history', name: 'History mash-up', riders: ['Cavewoman', 'Dame Roxy', 'Maestro Moss'] },
  { id: 'future', name: 'Future 3026', riders: ['Futureman', 'Cyberwoman', 'Quor'] },
].map(skin => Object.freeze({ ...skin, riders: Object.freeze(skin.riders) })));

export const skinFor = id => SKINS.find(skin => skin.id === id) ?? SKINS[0];

const PROP_IDS = Object.freeze(["ball","can","club","bowling","bottle","boot","duck","fish","apple","bell","brick","balloon","guitar","cassette","skateboard","vinyl","mic","cone","glowstick","plushrat","icecream","axe","deadcat","hydrant","pickle","violin","skull","banana","snake","plant","plunger","cd","vhs"]);
const THEME_DATA = {
  "history": {
    "ball": {
      "name": "Polished stone sphere",
      "color": "#aaa59b"
    },
    "can": {
      "name": "Bronze beaker",
      "color": "#ad8954"
    },
    "club": {
      "name": "Knotted wooden club",
      "color": "#a27b51"
    },
    "bowling": {
      "name": "Iron cannonball",
      "color": "#8b7565"
    },
    "bottle": {
      "name": "Terracotta amphora",
      "color": "#c98662"
    },
    "boot": {
      "name": "Medieval leather boot",
      "color": "#947252"
    },
    "duck": {
      "name": "Carved wooden duck",
      "color": "#b89463"
    },
    "fish": {
      "name": "Dried fish",
      "color": "#b7a486"
    },
    "apple": {
      "name": "Pomegranate",
      "color": "#c75d67"
    },
    "bell": {
      "name": "Bronze temple bell",
      "color": "#99aa8d"
    },
    "brick": {
      "name": "Clay writing tablet",
      "color": "#c5986a"
    },
    "balloon": {
      "name": "Leather waterskin",
      "color": "#997450"
    },
    "guitar": {
      "name": "Oud",
      "color": "#d4a467"
    },
    "cassette": {
      "name": "Parchment scroll",
      "color": "#d3bf93"
    },
    "skateboard": {
      "name": "Small wooden cart",
      "color": "#b18a59"
    },
    "vinyl": {
      "name": "Bronze gong",
      "color": "#b8a26c"
    },
    "mic": {
      "name": "Ram’s horn",
      "color": "#b9a080"
    },
    "cone": {
      "name": "Conical straw hat",
      "color": "#c8b080"
    },
    "glowstick": {
      "name": "Beeswax candle",
      "color": "#e2bb64"
    },
    "plushrat": {
      "name": "Stitched cloth doll",
      "color": "#c9bd9c"
    },
    "icecream": {
      "name": "Honeycomb wedge",
      "color": "#d6a54c"
    },
    "axe": {
      "name": "Stone axe",
      "color": "#aaa292"
    },
    "deadcat": {
      "name": "Carved stone cat",
      "color": "#898d88"
    },
    "hydrant": {
      "name": "Bronze ewer",
      "color": "#aa956c"
    },
    "pickle": {
      "name": "Dried herb bundle",
      "color": "#879167"
    },
    "violin": {
      "name": "Bowed rebec",
      "color": "#c79458"
    },
    "skull": {
      "name": "Memento mori skull",
      "color": "#d6cbb0"
    },
    "banana": {
      "name": "Crescent bread loaf",
      "color": "#be905f"
    },
    "snake": {
      "name": "Coiled rope",
      "color": "#b79c73"
    },
    "plant": {
      "name": "Ceramic herb pot",
      "color": "#91a27b"
    },
    "plunger": {
      "name": "Wooden butter churn",
      "color": "#a88c62"
    },
    "cd": {
      "name": "Brass astrolabe",
      "color": "#c3a453"
    },
    "vhs": {
      "name": "Bound manuscript",
      "color": "#947953"
    }
  },
  "future": {
    "ball": {
      "name": "Gravipod",
      "color": "#d5e7ee"
    },
    "can": {
      "name": "Pulse canister",
      "color": "#ffbd5c"
    },
    "club": {
      "name": "Phase baton",
      "color": "#66ded8"
    },
    "bowling": {
      "name": "Singularity seed",
      "color": "#7496ff"
    },
    "bottle": {
      "name": "Memory ampoule",
      "color": "#c28cef"
    },
    "boot": {
      "name": "Drift talon",
      "color": "#bccdd7"
    },
    "duck": {
      "name": "Echo hatchling",
      "color": "#ecb955"
    },
    "fish": {
      "name": "Ribbon resonator",
      "color": "#ad99e2"
    },
    "apple": {
      "name": "Choral knot",
      "color": "#ee8fb3"
    },
    "bell": {
      "name": "Vacuum bloom",
      "color": "#c5a1e6"
    },
    "brick": {
      "name": "Time ingot",
      "color": "#b6d2d3"
    },
    "balloon": {
      "name": "Cloud bladder",
      "color": "#b4ece9"
    },
    "guitar": {
      "name": "Nerve harp",
      "color": "#76cbd5"
    },
    "cassette": {
      "name": "Quanta wafer",
      "color": "#c29478"
    },
    "skateboard": {
      "name": "Vector sled",
      "color": "#e78388"
    },
    "vinyl": {
      "name": "Halo lattice",
      "color": "#e4bd6d"
    },
    "mic": {
      "name": "Tongue antenna",
      "color": "#ef9ebb"
    },
    "cone": {
      "name": "Prism nest",
      "color": "#c3e079"
    },
    "glowstick": {
      "name": "Ion thorn",
      "color": "#b9e765"
    },
    "plushrat": {
      "name": "Mneme grub",
      "color": "#b090e7"
    },
    "icecream": {
      "name": "Cryofizz spiral",
      "color": "#73c6ec"
    },
    "axe": {
      "name": "Cleave arc",
      "color": "#d796b0"
    },
    "deadcat": {
      "name": "Dormant oracle",
      "color": "#ddd7c2"
    },
    "hydrant": {
      "name": "Flux manifold",
      "color": "#e58986"
    },
    "pickle": {
      "name": "Spore capsule",
      "color": "#94b674"
    },
    "violin": {
      "name": "Void lyre",
      "color": "#6f9ee3"
    },
    "skull": {
      "name": "Fossil processor",
      "color": "#c99c74"
    },
    "banana": {
      "name": "Crescent relay",
      "color": "#e0be68"
    },
    "snake": {
      "name": "Loop organism",
      "color": "#a9d9d4"
    },
    "plant": {
      "name": "Root reactor",
      "color": "#b79677"
    },
    "plunger": {
      "name": "Pressure petal",
      "color": "#e59dbe"
    },
    "cd": {
      "name": "Möbius dial",
      "color": "#b4cee2"
    },
    "vhs": {
      "name": "Archive brick",
      "color": "#bb95e7"
    }
  }
};
for (const props of Object.values(THEME_DATA)) {
  for (const presentation of Object.values(props)) Object.freeze(presentation);
  Object.freeze(props);
}
Object.freeze(THEME_DATA);

// Each live prop identity keeps at most one immutable result per skin. Weak keys
// allow temporary prop variants to disappear with the caller's objects.
const presentations = new WeakMap();
const origins = new WeakMap();
function sameSource(record, prop) {
  const keys = Object.keys(prop);
  return keys.length === record.keys.length && keys.every(key =>
    Object.hasOwn(record.source, key) && Object.is(record.source[key], prop[key]));
}
export function presentProp(prop, skinId = 'punk') {
  if (!prop || typeof prop !== 'object') return prop;
  prop = origins.get(prop) ?? prop;
  const skin = skinFor(skinId).id;
  if (skin === 'punk' && prop.skin === undefined) return prop;
  let cache = presentations.get(prop);
  if (!cache) presentations.set(prop, cache = new Map());
  const previous = cache.get(skin);
  if (previous && sameSource(previous, prop)) return previous.value;
  const styles = THEME_DATA[skin];
  const style = styles && Object.hasOwn(styles, prop.id) ? styles[prop.id] : null;
  const overrides = ERA_PROP_OVERRIDES[skin];
  const extra = overrides && Object.hasOwn(overrides, prop.id) ? overrides[prop.id] : null;
  const value = Object.freeze({ ...prop, ...style, ...extra, skin });
  cache.set(skin, { source: { ...prop }, keys: Object.keys(prop), value });
  origins.set(value, prop);
  return value;
}

const HISTORY_RECTS = {
  club: [429, 22, 178, 196],
  bottle: [882, 22, 129, 196],
  boot: [1080, 31, 176, 184],
  can: [244, 41, 130, 174],
  bowling: [655, 46, 168, 167],
  ball: [34, 52, 164, 162],
  duck: [1277, 61, 192, 141],
  bell: [447, 226, 166, 196],
  balloon: [862, 226, 173, 201],
  guitar: [1091, 229, 134, 194],
  apple: [252, 236, 160, 180],
  brick: [654, 242, 171, 172],
  cassette: [1281, 253, 172, 163],
  fish: [19, 295, 212, 92],
  plushrat: [1082, 431, 157, 197],
  vinyl: [245, 433, 185, 186],
  glowstick: [922, 438, 94, 178],
  icecream: [1274, 440, 186, 166],
  mic: [450, 447, 180, 168],
  skateboard: [13, 459, 216, 148],
  cone: [639, 463, 231, 135],
  hydrant: [480, 613, 139, 203],
  axe: [43, 616, 167, 210],
  violin: [908, 617, 123, 208],
  deadcat: [252, 619, 142, 200],
  skull: [1070, 639, 174, 182],
  banana: [1282, 642, 190, 172],
  plunger: [487, 816, 100, 221],
  plant: [234, 827, 172, 203],
  vhs: [843, 832, 201, 206],
  snake: [13, 857, 196, 148],
  pickle: [645, 627, 200, 190],
  cd: [650, 831, 181, 193],
};
const FUTURE_RECTS = {
  bottle: [900, 7, 104, 197],
  can: [261, 14, 91, 185],
  club: [452, 17, 152, 176],
  bowling: [661, 27, 158, 156],
  boot: [1090, 29, 158, 160],
  ball: [21, 36, 163, 154],
  duck: [1301, 48, 156, 119],
  guitar: [1083, 209, 168, 208],
  bell: [432, 214, 188, 184],
  balloon: [863, 219, 185, 180],
  fish: [17, 228, 169, 169],
  apple: [225, 229, 164, 160],
  cassette: [1294, 233, 171, 152],
  brick: [652, 234, 176, 154],
  cone: [653, 409, 163, 196],
  icecream: [1314, 410, 138, 202],
  mic: [474, 420, 118, 187],
  vinyl: [222, 422, 179, 182],
  glowstick: [868, 424, 166, 185],
  plushrat: [1073, 451, 191, 145],
  skateboard: [13, 463, 177, 127],
  axe: [15, 625, 182, 196],
  violin: [887, 625, 132, 196],
  skull: [1077, 625, 179, 192],
  deadcat: [232, 626, 155, 185],
  hydrant: [433, 628, 177, 184],
  pickle: [671, 629, 144, 185],
  banana: [1292, 643, 179, 169],
  plant: [216, 825, 186, 201],
  snake: [19, 831, 162, 195],
  plunger: [439, 832, 172, 194],
  vhs: [861, 851, 187, 157],
  cd: [643, 867, 191, 125],
};
const atlas = (id, rects) => Object.freeze({
  url: new URL(`../assets/puggler/${id}-props-collage.webp`, import.meta.url),
  columns: 7, rows: 5, ids: PROP_IDS,
  rects: Object.freeze(Object.fromEntries(Object.entries(rects).map(([key, rect]) => [key, Object.freeze(rect)]))),
});
export const SKIN_ATLASES = Object.freeze({
  history: atlas('history', HISTORY_RECTS),
  future: atlas('future', FUTURE_RECTS),
});
