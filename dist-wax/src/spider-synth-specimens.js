import { SPIDER_SPECIMEN_DATA } from './spider-synth-specimen-data.js?v=ba050afc7c8e';
import { createSpiderCollisionProfile } from './spider-synth-collision.js?v=ba050afc7c8e';

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const SPIDER_SPECIMENS = freeze(SPIDER_SPECIMEN_DATA.map(specimen => ({
  ...specimen,
  bodyHeight: specimen.rig.bodyHeight,
  legs: specimen.rig.legs.map(leg => {
    const hip = leg.anchors[0], tip = leg.anchors[4], reach = leg.lengths.reduce((sum, value) => sum + value, 0);
    const dx = tip[0] - hip[0], dz = tip[2] - hip[2], span = Math.max(1e-9, Math.hypot(dx, dz));
    return { ...leg, hip, tip, reach, innerReach: Math.max(0, Math.max(...leg.lengths) * 2 - reach),
      reachMargin: specimen.id === 'argiope' ? .035 : Math.min(.035, reach * .08),
      neutral: [hip[0] + dx / span * reach * .68, 0, hip[2] + dz / span * reach * .68] };
  }),
  collisionProfile: createSpiderCollisionProfile(specimen.rig),
})));
const BY_ID = new Map(SPIDER_SPECIMENS.map(specimen => [specimen.id, specimen]));
export const getSpiderSpecimen = id => BY_ID.get(id) ?? SPIDER_SPECIMENS[0];
