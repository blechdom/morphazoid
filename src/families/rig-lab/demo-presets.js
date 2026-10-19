import { ANT_DEFAULTS, antSettings } from '../../instruments/ant-farm/demo-model.js';
import { FOAM_DEFAULTS, foamSettings } from '../../instruments/voronoi-foam/demo-model.js';
import { LATTICE_DEFAULTS, latticeSettings } from '../../instruments/polyhedral-lattice/demo-model.js';
import { OCTOPUS_DEFAULTS, octopusSettings } from '../../instruments/octopus/demo-model.js';
import { PANCAKE_DEFAULTS, pancakePose, pancakeSettings } from '../../instruments/pancakes/demo-model.js';
import { MOSQUITO_DEFAULTS, mosquitoSettings } from '../../instruments/mosquito/demo-model.js';
import { MOTH_DEFAULTS, mothSettings } from '../../instruments/moth/demo-model.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const phaseOf = cycles => ((Number.isFinite(cycles) ? cycles : 0) % 1 + 1) % 1;
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const validators = {
  'ant-farm': antSettings, 'voronoi-foam': foamSettings,
  'polyhedral-lattice': latticeSettings, octopus: octopusSettings,
  pancakes: pancakeSettings, mosquito: mosquitoSettings, moth: mothSettings,
};
const scene = (id, label, description, animation, values, extras = {}) =>
  Object.freeze({ id, label, description, animation, values, ...extras });

/** Complete, bounded demonstration scenes. Geometric stages own live topology;
 * animal and kitchen stages keep their credited imported surfaces. */
const SCENES = Object.freeze({
  'ant-farm': Object.freeze([
    scene('forage', 'Forage · matched footsteps',
      'Both downloaded ants walk in sync with their legs, plant their feet, then turn.', 'walk',
      ANT_DEFAULTS, { antStyle: 'mixed' }),
    scene('convoy', 'Worker convoy · faster gait',
      'Three Worker ants advance on offset paths; body travel follows the three-stride Walk clip.', 'walk',
      { ...ANT_DEFAULTS, travelRate: 0.55, foodX: 1.04, trail: 0.19,
        guide: [[-0.18, -0.1], [0.12, 0.03], [-0.06, 0.12]] }, { antStyle: 'worker' }),
    scene('dig', 'Dig site · working legs',
      'Workers dig at the food; VFX ants hold their planted legs and search with their antennae.', 'dig',
      { ...ANT_DEFAULTS, travelRate: 0.46, foodX: 0.72, foodY: -0.1,
        chamberSize: 0.58 }, { antStyle: 'mixed' }),
  ]),
  'voronoi-foam': Object.freeze([
    scene('drift', 'Five cube cells · slow drift',
      'Five real clipped cube cells deform as their seeds drift; each audible volume follows its rendered faces.', 'drift',
      FOAM_DEFAULTS),
    scene('constellation', 'Icosahedron · twelve cells',
      'Twelve live cells share an icosahedral boundary; the face tessellation and pitch retune together.', 'orbit',
      { ...FOAM_DEFAULTS, shape: 'icosahedron', count: 12, sweepRate: 0.3, selected: 4 }),
    scene('duet', 'Octahedron · two breathing cells',
      'Two large cells swap volume and pitch inside a real octahedral silhouette.', 'breathe',
      { ...FOAM_DEFAULTS, shape: 'octahedron', count: 2, selected: 1, sweepRate: 0.26,
        seeds: [[-0.5, -0.2, 0.1], [0.36, 0.28, -0.2]] }),
  ]),
  'polyhedral-lattice': Object.freeze([
    scene('spring', 'Icosahedron · twelve vertices',
      'One live icosahedron: pull vertex 8 to bend connected faces, struts and its edge-length tone.', 'spring',
      LATTICE_DEFAULTS),
    scene('torsion', 'Two subdivided octahedra',
      'Subdivide an octahedron into eighteen editable vertices per solid; pull one of the two connected units in depth.', 'torsion',
      { ...LATTICE_DEFAULTS, shape: 'octahedron', unitCount: 2, detail: 1,
        selected: 18, pullZ: 0.21,
        softness: 0.68, pulseRate: 0.34 }),
    scene('bridge', 'Four refined tetrahedra',
      'Two subdivision steps grow four connected tetrahedra to 136 playable vertices; vertex 90 bends the third solid.', 'bridge',
      { ...LATTICE_DEFAULTS, shape: 'tetrahedron', unitCount: 4, detail: 2,
        selected: 89, pullX: 0.16,
        softness: 0.56, pulseRate: 0.54 }),
  ]),
  octopus: Object.freeze([
    scene('breathe', 'Reef · warm mottled mantle',
      'Warm reef pigments and a damp PBR finish follow the original skinned mesh as six long chains and two short appendages move.', 'breathe',
      OCTOPUS_DEFAULTS),
    scene('choir', 'Abyss · luminous tentacle choir',
      'Blue chromatophore-like light spots and wet sheen accompany independently retuned imported chains.', 'choir',
      { ...OCTOPUS_DEFAULTS, skin: 'abyss', wetness: 0.88,
        grip: 0.32, current: 0.28, pulseRate: 0.76,
        lengths: [1.55, 0.86, 1.48, 0.9, 1.44, 0.84, 1.19, 1.1],
        curls: [0.38, -0.42, 0.45, -0.4, 0.52, -0.32, 0.28, -0.18] }),
    scene('undertow', 'Pearl · iridescent undertow',
      'Pale iridescent pigment and a brighter material expose a deep mantle squeeze and rolling asymmetric curls.', 'undertow',
      { ...OCTOPUS_DEFAULTS, skin: 'pearl', wetness: 0.67,
        grip: 0.68, current: -0.32, pulseRate: 0.42,
        lengths: [1.24, 1.54, 0.98, 1.48, 0.88, 1.57, 0.86, 1.25],
        curls: [-0.42, 0.54, -0.34, 0.48, -0.28, 0.55, -0.17, 0.38] }),
  ]),
  pancakes: Object.freeze([
    scene('sizzle', 'Butter sizzle · pan',
      'A single imported pancake cooks while the pan and flipper rock gently.', 'sizzle',
      PANCAKE_DEFAULTS),
    scene('flip-stack', 'Flip, scoop, stack, peel',
      'The pan cake flips, rides the downloaded spatula onto the stack, then returns to the pan.', 'flip-stack',
      { ...PANCAKE_DEFAULTS, heat: 0.73, butter: 0.7, cookRate: 0.32, selected: 2,
        syrup: 0.36, cakes: [
          { place: 'plate', order: 0, syrup: 0.14 },
          { place: 'plate', order: 1, syrup: 0.24 },
          { place: 'pan', order: 0, syrup: 0.36 },
        ] }),
    scene('tower', 'Syrup tower · four layers',
      'Four downloaded cakes, syrup and butter on the imported plate; the pan keeps cooking.', 'sizzle',
      { ...PANCAKE_DEFAULTS, heat: 0.63, butter: 0.82, cookRate: 0.54, selected: 3,
        syrup: 0.78, cakes: [
          { place: 'plate', order: 0, syrup: 0.12 },
          { place: 'plate', order: 1, syrup: 0.24 },
          { place: 'plate', order: 2, syrup: 0.48 },
          { place: 'plate', order: 3, syrup: 0.78 },
          { place: 'pan', order: 0, syrup: 0 },
        ] }),
  ]),
  mosquito: Object.freeze([
    scene('hover', 'Hover · six-legged drone',
      'Both skinned wings flap while the six leg joints breathe around a steady hover.', 'hover',
      MOSQUITO_DEFAULTS),
    scene('probe', 'Probe · landing feelers',
      'A slower wing tone, bowed proboscis and alternating curled legs demonstrate the new skin.', 'probe',
      { ...MOSQUITO_DEFAULTS, wingRate: 250, stroke: 0.74, flightRate: 0.24,
        y: -0.16, probe: 24, legs: [-0.32, 0.18, 0.22, -0.24, 0.28, -0.18] }),
    scene('dart', 'Dart · restless wings',
      'A fast, bright wing tone with active legs and a wide flight loop.', 'dart',
      { ...MOSQUITO_DEFAULTS, wingRate: 680, stroke: 0.9, flightRate: 0.92,
        z: 0.13, legs: [0.21, -0.17, 0.14, -0.21, 0.25, -0.12] }),
  ]),
  moth: Object.freeze([
    scene('eyespots', 'Eyespots · source flight',
      'The moth’s original clip moves both wings, feelers and torso; editable symmetric folds ride over it.', 'fan',
      MOTH_DEFAULTS, { brushMode: false }),
    scene('paper', 'Papery wings · alternating folds',
      'The original flap stays intact while left/right fold offsets and papery voices answer each other.', 'alternate',
      { ...MOTH_DEFAULTS, leftFold: 0.32, rightFold: 0.62,
        span: 1.12, flapRate: 1.12 }, { brushMode: false }),
    scene('brush', 'Brush study · wide span',
      'Spread the original textured wings for direct brushing over the slowed source clip.', 'breathe',
      { ...MOTH_DEFAULTS, leftFold: 0.08, rightFold: 0.08,
        span: 1.26, flapRate: 0.38 }, { brushMode: true }),
  ]),
});

export const rigLabSceneIds = Object.freeze(Object.keys(SCENES));
export function rigLabScenes(id) {
  return (SCENES[id] ?? []).map(({ id: key, label, description, animation }) =>
    ({ id: key, label, description, animation }));
}
export function rigLabScene(id, key) {
  const found = SCENES[id]?.find(item => item.id === key);
  return found && { id: found.id, label: found.label, description: found.description,
    animation: found.animation, settings: validators[id](found.values),
    antStyle: found.antStyle, brushMode: found.brushMode };
}

/**
 * Play changes a *derived* pose; the complete preset and the musician's edits
 * remain untouched. Sound scheduling samples this same derived state.
 */
export function animatedRigSettings(id, values, cycles, playing, animation) {
  if (!playing) return values;
  const phase = phaseOf(cycles), turn = phase * TAU;
  const wave = Math.sin(turn);
  switch (id) {
    case 'voronoi-foam': {
      const seeds = values.seeds.map((seed, index) => {
        const lag = index * 0.43;
        const amplitude = animation === 'orbit' ? 0.1 : animation === 'breathe' ? 0.16 : 0.065;
        return [
          seed[0] + amplitude * (Math.sin(turn - lag) - Math.sin(-lag)),
          seed[1] + amplitude * 0.52 * (Math.sin(turn - lag * 0.5) - Math.sin(-lag * 0.5)),
          seed[2] + amplitude * 0.68 * (Math.cos(turn - lag) - Math.cos(-lag)),
        ];
      });
      return foamSettings({ ...values, seeds });
    }
    case 'polyhedral-lattice':
      return latticeSettings({ ...values,
        pullX: values.pullX + (animation === 'bridge' ? 0.41 : 0.3) * wave,
        pullY: values.pullY + (animation === 'torsion' ? 0.19 : 0.13) * Math.sin(turn * 2),
        pullZ: values.pullZ + (animation === 'torsion' ? 0.37 : 0.19) *
          Math.sin(turn - 0.45) + (animation === 'torsion' ? 0.37 : 0.19) * Math.sin(0.45),
      });
    case 'octopus': {
      const reach = animation === 'choir' ? 0.16 : animation === 'undertow' ? 0.21 : 0.09;
      return octopusSettings({ ...values,
        grip: values.grip + 0.16 * (1 - Math.cos(turn)),
        current: values.current + 0.18 * wave,
        lengths: values.lengths.map((length, index) =>
          length + reach * (Math.sin(turn - index * 0.68) - Math.sin(-index * 0.68))),
        curls: values.curls.map((curl, index) =>
          curl + (animation === 'breathe' ? 0.2 : 0.32) *
          (Math.sin(turn - index * 0.81) - Math.sin(-index * 0.81))),
      });
    }
    case 'pancakes':
      return pancakeSettings({ ...values,
        tilt: values.tilt + (animation === 'flip-stack' ? 7 : 3) * wave,
        spatulaX: animation === 'flip-stack' ? values.spatulaX : values.spatulaX + 0.1 * wave,
      });
    case 'mosquito':
      return mosquitoSettings({ ...values,
        stroke: values.stroke + (animation === 'dart' ? 0.08 : 0.04) * wave,
        probe: values.probe + (animation === 'probe' ? 11 : 5) * wave,
        legs: values.legs.map((curl, index) =>
          curl + (animation === 'probe' ? 0.17 : 0.23) *
          (Math.sin(turn - index * 1.04) - Math.sin(-index * 1.04))),
      });
    case 'moth':
      return mothSettings({ ...values,
        leftFold: values.leftFold + (animation === 'alternate' ? 0.22 : 0.11) * wave,
        rightFold: values.rightFold + (animation === 'alternate' ? -0.22 : 0.11) * wave,
        span: values.span + 0.05 * (1 - Math.cos(turn)),
      });
    default: return values;
  }
}

export const KITCHEN_SCENE_CONTACTS = Object.freeze([
  Object.freeze({ phase: 0.28, kind: 'land' }),
  Object.freeze({ phase: 0.36, kind: 'scoop' }),
  Object.freeze({ phase: 0.6, kind: 'stack' }),
  Object.freeze({ phase: 0.68, kind: 'peel' }),
  Object.freeze({ phase: 0.94, kind: 'land' }),
]);

/** Only source cakes/tools move. The tour returns to its start without teleporting. */
export function pancakeScenePose(values, cycles, playing, animation,
  seconds = 0, flipAt = null, flightId = 0) {
  const effective = animatedRigSettings('pancakes', values, cycles, playing, animation);
  const pose = pancakePose(effective, seconds, flipAt, cycles, playing, flightId);
  // Manual flips temporarily take precedence; a performer's edited scene can
  // switch out of this tour entirely without fighting a scripted cake path.
  if (!playing || animation !== 'flip-stack' ||
      flipAt != null && seconds - flipAt < 0.68) return pose;
  const id = values.cakes.findIndex(cake => cake.place === 'pan');
  if (id < 0) return pose;
  const phase = phaseOf(cycles), cake = pose.cakes[id];
  const layer = pose.stackCount;
  const plate = [-1.58, -0.4 + layer * 0.11, 0];
  const pan = [0, -0.17, 0], spade = [0, -0.16, 0.72];
  const plateSpade = [-1.58, -0.16 + layer * 0.11, 0.72];
  const idleTool = [values.spatulaX, values.spatulaY, 0.72];
  const panTool = [0, 0, 0.72], plateTool = [-1.48, 0.28, 0.72];
  const between = (start, end, amount) =>
    start.map((from, axis) => lerp(from, end[axis], amount));
  let place = 'pan', position = pan, rotation = [0, 0, 0], airborne = false;
  if (phase >= 0.12 && phase < 0.28) {
    const t = (phase - 0.12) / 0.16;
    position = [0, -0.17 + Math.sin(t * Math.PI) * 1.18, 0];
    rotation = [0, 0, t * Math.PI * 2];
    airborne = true;
  } else if (phase >= 0.28 && phase < 0.36) {
    pose.spatulaPosition = between(idleTool, panTool, (phase - 0.28) / 0.08);
  } else if (phase >= 0.36 && phase < 0.42) {
    place = 'spatula';
    position = between(pan, spade, (phase - 0.36) / 0.06);
    pose.spatulaPosition = panTool;
  } else if (phase >= 0.42 && phase < 0.56) {
    const t = (phase - 0.42) / 0.14;
    place = 'spatula';
    position = between(spade, plateSpade, t);
    pose.spatulaPosition = between(panTool, plateTool, t);
  } else if (phase >= 0.56 && phase < 0.6) {
    place = 'spatula';
    position = between(plateSpade, plate, (phase - 0.56) / 0.04);
    pose.spatulaPosition = plateTool;
  } else if (phase >= 0.6 && phase < 0.68) {
    place = 'plate'; position = plate;
    pose.spatulaPosition = plateTool;
  } else if (phase >= 0.68 && phase < 0.74) {
    place = 'spatula';
    position = between(plate, plateSpade, (phase - 0.68) / 0.06);
    pose.spatulaPosition = plateTool;
  } else if (phase >= 0.74 && phase < 0.88) {
    const t = (phase - 0.74) / 0.14;
    place = 'spatula';
    position = between(plateSpade, spade, t);
    pose.spatulaPosition = between(plateTool, panTool, t);
  } else if (phase >= 0.88 && phase < 0.94) {
    place = 'spatula';
    position = between(spade, pan, (phase - 0.88) / 0.06);
    pose.spatulaPosition = panTool;
  } else if (phase >= 0.94) {
    pose.spatulaPosition = between(panTool, idleTool, (phase - 0.94) / 0.06);
  }
  if (place === 'plate') pose.stackCount += 1;
  pose.cakes[id] = { ...cake, place, layer: place === 'plate' ? layer : -1,
    position, rotation, airborne };
  pose.airborne = airborne;
  if (pose.selected === id) {
    pose.pancakePosition = position;
    pose.pancakeRotation = rotation;
  }
  return pose;
}
