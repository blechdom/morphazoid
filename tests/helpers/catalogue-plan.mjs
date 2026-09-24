import { readFileSync } from 'node:fs';
export const cataloguePlan = JSON.parse(readFileSync(new URL('../../docs/catalogue-update-decisions.json', import.meta.url), 'utf8'));
const prior = JSON.parse(readFileSync(new URL('../fixtures/catalogue-before-20260918.json', import.meta.url), 'utf8'));
const byId = new Map(cataloguePlan.rows.flatMap(row => [[row.oldId, row], [row.id, row]]));
export const mainAdditions = [
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-main-d96793a.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-loopini.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-gesticulating-hand.json', import.meta.url), 'utf8')).additions,
];
for (const item of mainAdditions) byId.set(item.id, { id: item.id, oldId: item.id, categoryId: item.categoryId, categoryLabel: item.categoryLabel ?? "Work in Progress", tags: item.tags ?? [] });
const previousFaves = prior.registry.FAVE_TOOL_IDS.map(id => byId.get(id)?.id ?? id);
// Explicit owner follow-up on September 20; keep the pre-sheet fixture intact.
previousFaves.splice(previousFaves.indexOf("hiccup-head") + 1, 0, "creaturazoid");
previousFaves.splice(previousFaves.indexOf("spiral"), 1);
// Second owner follow-up: keep Creaturazoid after Hiccup, move the requested
// three before Hyper Rubix, and exchange Automatapoeia/Lattice.
const moved = ["hiccup-head", "creaturazoid", "hybrinx", "jaw-harp"];
const reordered = previousFaves.filter(id => !moved.includes(id));
reordered.splice(reordered.indexOf("hyper-rubix"), 0, ...moved);
const latticeIndex = reordered.indexOf("lattice");
const automataIndex = reordered.indexOf("cellular-automata");
[reordered[latticeIndex], reordered[automataIndex]] = [reordered[automataIndex], reordered[latticeIndex]];
// Shapes replaces the three individual geometry instruments in the first
// Faves section. Their ordinary Geometric catalogue records remain intact.
export const expectedFaveToolIds = Object.freeze([
  "shapes", ...reordered.filter(id => !["shape-synth", "solid-synth", "hyper-synth"].includes(id)),
]);
const faves = new Set(expectedFaveToolIds);
export function expectedTagIdsFor(id) {
  const row = byId.get(id);
  if (!row) throw new Error(`No approved catalogue plan row for ${id}`);
  return [...new Set([row.categoryId, ...row.tags.map(tag => tag.id), ...(faves.has(row.id) ? ['faves'] : [])])];
}
export function expectedCategoryFor(id) { return byId.get(id)?.categoryId; }
export function expectedStatusFor(id) { return expectedCategoryFor(id) === 'wip' ? 'Work in Progress' : null; }
export function expectedIdFor(id) { return byId.get(id)?.id ?? id; }
export function previousInstrumentFor(id) {
  const row = byId.get(id);
  return prior.INSTRUMENTS.find(item => item.id === (row?.oldId ?? id)) ?? mainAdditions.find(item => item.id === id);
}
export function expectedTagsFor(id) {
  const row = byId.get(id);
  const labels = new Map([[row.categoryId, row.categoryLabel], ...row.tags.map(tag => [tag.id, tag.label]), ['faves', 'Faves']]);
  return expectedTagIdsFor(id).map(id => ({ id, label: labels.get(id) }));
}
