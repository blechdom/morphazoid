// Presentation overrides only. Existing physical prop IDs, mass and sound stay
// owned by the simulation. Artwork provenance: assets/puggler/ERA_PROPS_CREDITS.md.
const ids = Object.freeze([
  'history-bones', 'history-hamhock', 'history-baby', 'history-harpsichord',
  'history-boulder', 'history-club', 'future-octopus',
]);
const rects = {
  'history-bones': [78, 60, 285, 336],
  'history-hamhock': [487, 45, 371, 361],
  'history-baby': [955, 45, 304, 364],
  'history-harpsichord': [1369, 15, 362, 422],
  'history-boulder': [27, 491, 385, 339],
  'history-club': [481, 461, 365, 393],
  'future-octopus': [906, 460, 407, 394],
};
export const ERA_PROP_ATLAS = Object.freeze({
  url: new URL('../assets/puggler/era-props-collage.webp', import.meta.url),
  columns: 4,
  rows: 2,
  ids,
  rects: Object.freeze(Object.fromEntries(Object.entries(rects).map(([id, rect]) => [id, Object.freeze(rect)]))),
});
const override = (name, color, sprite) => Object.freeze({ name, color, atlas: 'eraProps', sprite });
export const ERA_PROP_OVERRIDES = Object.freeze({
  history: Object.freeze({
    mic: override('Bones', '#ded0ad', 'history-bones'),
    banana: override('Ham hock', '#be7446', 'history-hamhock'),
    plushrat: override('Swaddled baby', '#e3cfac', 'history-baby'),
    skateboard: override('Harpsichord', '#a4824d', 'history-harpsichord'),
    bowling: override('Boulder', '#a6a39c', 'history-boulder'),
    club: override('Wooden club', '#987147', 'history-club'),
  }),
  future: Object.freeze({
    fish: override('Fluorescent octopus', '#55efd0', 'future-octopus'),
  }),
});
