// Body ownership is shared by the mixer, pose controls and audio renderer.
// Palps/mouth are fused into the scanned head; they are not fictitious joints.
export const ROACH_BODY_GROUPS = Object.freeze([
  ['legs', 'Legs'], ['covers', 'Outer wings'], ['hindwings', 'Hind wings'],
  ['thorax', 'Thorax'], ['abdomen', 'Abdomen'], ['neck', 'Neck'],
  ['head', 'Head'], ['antennae', 'Antennae'],
].map(([id, label]) => Object.freeze({ id, label })));

export const ROACH_BODY_SOURCES = Object.freeze([
  ['resonance', 'Dark resonance', false], ['drone', 'Hollow drone', false],
  ['sub', 'Sub pressure', false], ['shimmer', 'Spectral shimmer', false],
  ['buzz', 'Wing buzz', true], ['zing', 'Wire zing', true],
  ['skuttle', 'Skuttle', true], ['walls', 'Wall scratches', true],
  ['rustle', 'Roach rustle', true], ['shriek', 'Small shriek', true],
  ['hiss', 'Friction hiss', true], ['growl', 'Crusty growl', true],
].map(([id, label, motionOnly]) => Object.freeze({ id, label, motionOnly })));
export const ROACH_BODY_SOURCE_INDEX = new Map(ROACH_BODY_SOURCES.map(({ id }, index) => [id, index]));
const DEFAULT_SOURCES = ['skuttle', 'walls', 'rustle', 'resonance', 'drone', 'growl', 'sub', 'shimmer'];
const DEFAULT_LEVELS = [.85, .48, .65, .68, .6, .36, .36, .24];

export function createDefaultRoachBodyMix() {
  return ROACH_BODY_GROUPS.map(({ id }, index) => ({ groupId: id, source: DEFAULT_SOURCES[index], level: DEFAULT_LEVELS[index] }));
}
export function normalizeRoachBodyMix(value) {
  const result = createDefaultRoachBodyMix();
  if (!Array.isArray(value)) return result;
  for (const row of value.slice(0, 64)) {
    const index = ROACH_BODY_GROUPS.findIndex(({ id }) => id === row?.groupId);
    if (index < 0) continue;
    if (ROACH_BODY_SOURCE_INDEX.has(row.source)) result[index].source = row.source;
    const level = Number(row.level);
    if (Number.isFinite(level)) result[index].level = Math.max(0, Math.min(1, level));
  }
  return result;
}
export function getRoachJointBodyGroup(joint) {
  const name = `${joint?.jointId || ''} ${joint?.name || ''}`.toLowerCase();
  if (/antenna/.test(name)) return 7;
  if (/wing/.test(name)) return joint?.wingLayer === 'hind' || /hind.*wing|wing.*hind/.test(name) ? 2 : 1;
  if (/leg|proximal|distal|foot|front_|middle_|hind_/.test(name)) return 0;
  if (/abdomen/.test(name)) return 4;
  if (/neck/.test(name)) return 5;
  if (/head|palp|mouth/.test(name)) return 6;
  return 3;
}
export function getRoachBodyGroupId(joint) { return ROACH_BODY_GROUPS[getRoachJointBodyGroup(joint)].id; }
