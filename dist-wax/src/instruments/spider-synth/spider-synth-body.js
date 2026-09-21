// Stable ownership shared by the scan rig, MIDI gestures, mixer and worklet.
export const SPIDER_BODY_GROUPS = Object.freeze([
  ['legs', 'Legs'], ['cephalothorax', 'Head / thorax'], ['abdomen', 'Abdomen'],
  ['pedipalps', 'Palps'], ['chelicerae', 'Fangs'], ['spinnerets', 'Spinnerets'],
  ['radials', 'Radial silk'], ['spirals', 'Spiral silk'],
].map(([id, label]) => Object.freeze({ id, label })));
export function getSpiderJointBodyGroup(joint) {
  const explicit = SPIDER_BODY_GROUPS.findIndex(group => group.id === joint?.groupId);
  if (explicit >= 0) return explicit;
  const name = `${typeof joint === 'string' ? joint : joint?.id ?? joint?.jointId ?? ''} ${joint?.name ?? ''}`.toLowerCase();
  if (/leg|hip|knee|ankle|tip/.test(name)) return 0;
  if (/abdomen/.test(name)) return 2;
  if (/palp/.test(name)) return 3;
  if (/chelicera|fang/.test(name)) return 4;
  if (/spinneret/.test(name)) return 5;
  if (/radial/.test(name)) return 6;
  if (/spiral/.test(name)) return 7;
  return 1;
}
export function getSpiderBodyGroupId(joint) { return SPIDER_BODY_GROUPS[getSpiderJointBodyGroup(joint)].id; }
