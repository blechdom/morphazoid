// Lightweight source recipes shared by the authoring script and gesture owner.
// PCM lives only in the audio bank. Ending windows use original source seconds.
export const WITCH_BLECH_PHRASES = Object.freeze([
  { id: 'black-pattern-3-beat-funnel-128', label: 'rin-w · Funnel 128' },
  { id: 'black-bleed-chasing-wind', label: 'Chasing Wind · final cascade', start: 172.25, end: 176.75 },
  { id: 'black-pattern-4-beat-block-gliss-128', label: 'rin-w · Block Gliss 128' },
  { id: 'black-bleed-lightstorm', label: 'Lightstorm · ending barrage', start: 234, end: 238.5 },
  { id: 'black-pattern-webs-volcanic', label: 'rin-w · Volcanic web' },
  { id: 'black-bleed-swmg', label: 'SWMG · ending clusters', start: 184.75, end: 189.25 },
  { id: 'black-pattern-3-beat-block-gliss-88', label: 'rin-w · Block Gliss 88' },
  { id: 'black-pattern-4-beat-funnel-88', label: 'rin-w · Funnel 88' },
].map(phrase => Object.freeze({ ...phrase, speed: 1.6 })));

export const witchTasteVariantCount = kind => kind === 'drop-blech' ? WITCH_BLECH_PHRASES.length : 3;
