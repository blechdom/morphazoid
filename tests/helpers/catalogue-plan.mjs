import { readFileSync } from 'node:fs';
export const cataloguePlan = JSON.parse(readFileSync(new URL('../../docs/catalogue-update-decisions.json', import.meta.url), 'utf8'));
const prior = JSON.parse(readFileSync(new URL('../fixtures/catalogue-before-20260918.json', import.meta.url), 'utf8'));
const byId = new Map(cataloguePlan.rows.flatMap(row => [[row.oldId, row], [row.id, row]]));
const faves = new Set(prior.registry.FAVE_TOOL_IDS.map(id => byId.get(id)?.id ?? id));
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
  return prior.INSTRUMENTS.find(item => item.id === (row?.oldId ?? id));
}
export function expectedTagsFor(id) {
  const row = byId.get(id);
  const labels = new Map([[row.categoryId, row.categoryLabel], ...row.tags.map(tag => [tag.id, tag.label]), ['faves', 'Faves']]);
  return expectedTagIdsFor(id).map(id => ({ id, label: labels.get(id) }));
}
