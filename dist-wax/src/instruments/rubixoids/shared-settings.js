/** Only explicit, equivalent parameter edits cross dimensions. Native presets,
 * algorithms, voices, puzzle arrangements and defaults retain their owners. */
export const RUBIXOIDS_ROUTES = Object.freeze({
  '2d': { href: 'rubixoids.html?dimension=2d', label: 'Sliding puzzle' },
  '3d': { href: 'rubixoids.html?dimension=3d', label: 'Rubix cube' },
  '4d': { href: 'rubixoids.html?dimension=4d', label: 'Hyper Rubix' },
});
const binding = (key, read = value => value, write = value => value) => ({ key, read, write });
const same = key => Object.fromEntries(Object.keys(RUBIXOIDS_ROUTES).map(dim => [dim, binding(key)]));
export const SHARED_PARAMETERS = Object.freeze({
  tempo: same('tempo'), swing: same('swing'), output: same('output'),
  voice: { '2d': binding('soundBank'), '3d': binding('soundBank'), '4d': binding('voice') },
  decay: { '2d': binding('decay'), '3d': binding('acidDecay'), '4d': binding('decay') },
  brightness: { '2d': binding('brightness'), '3d': binding('cutoff', v => (v - 160) / 4040, v => 160 + v * 4040), '4d': binding('tone') },
  subdivisions: { '2d': binding('pulseDivision', v => v / 4, v => v * 4), '4d': binding('subdivisionsPerBeat') },
  direction: { '2d': binding('playbackDirection'), '4d': binding('playbackMode') },
  positionInfluence: { '2d': binding('positionInfluence'), '4d': binding('pitchInfluence') },
  filterInfluence: { '2d': binding('filterInfluence'), '4d': binding('filterInfluence') },
  neighborResponse: { '2d': binding('neighborResponse'), '4d': binding('neighborResponse') },
  disorderInfluence: { '2d': binding('disorderInfluence'), '4d': binding('disorderInfluence') },
  stereoWidth: { '2d': binding('stereoWidth'), '4d': binding('stereoInfluence') },
  moveSpeed: { '2d': binding('autoSlideSpeed'), '3d': binding('randomTwistSpeed') },
  autoMove: { '2d': binding('autoSlide'), '3d': binding('randomTwists') },
});

export function sharedParameterChanges(dimension, before, after) {
  const changes = {};
  for (const [name, dimensions] of Object.entries(SHARED_PARAMETERS)) {
    const field = dimensions[dimension];
    if (!field || after[field.key] === undefined || Object.is(before[field.key], after[field.key])) continue;
    const value = field.read(after[field.key]);
    // A native kit or performance scene is never replaced by a similarly named proxy.
    if (name === 'voice' && !String(value).startsWith('shared-')) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    changes[name] = value;
  }
  const orderKey = dimension === '2d' ? 'rows' : dimension === '3d' ? 'rubixSize' : 'puzzleSize';
  if (after[orderKey] !== undefined && after[orderKey] !== before[orderKey]
    && (dimension !== '2d' || after.rows === after.columns)) changes.order = after[orderKey];
  return changes;
}

export function nativeParameterPatch(dimension, shared) {
  const patch = {};
  for (const [name, value] of Object.entries(shared)) {
    const field = SHARED_PARAMETERS[name]?.[dimension];
    if (field) patch[field.key] = field.write(value);
  }
  if (shared.order >= 2 && shared.order <= ({ '2d': 8, '3d': 6, '4d': 4 })[dimension]) {
    if (dimension === '2d') Object.assign(patch, { rows: shared.order, columns: shared.order });
    else patch[dimension === '3d' ? 'rubixSize' : 'puzzleSize'] = shared.order;
  }
  return patch;
}
