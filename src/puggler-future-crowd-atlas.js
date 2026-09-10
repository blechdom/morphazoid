// Measured crops of the generated rear-view future audience. No runtime pixel
// processing. Exact prompt and provenance: assets/puggler/FUTURE_CROWD_CREDITS.md.
const rects={
  dread:[9,0,366,380],kid:[381,69,337,309],hat:[726,0,362,382],curls:[1095,52,346,328],
  punk:[4,402,380,333],braids:[389,379,323,356],ponytail:[715,386,388,350],baby:[1104,477,334,259],
  plasma:[139,739,161,347],holo:[455,743,211,343],robot:[816,747,190,339],alien:[1148,749,256,337],
};
export const FUTURE_CROWD_ATLAS=Object.freeze({
  url:new URL('../assets/puggler/future-crowd-collage.webp',import.meta.url),
  columns:4,rows:3,ids:Object.freeze(Object.keys(rects)),
  rects:Object.freeze(Object.fromEntries(Object.entries(rects).map(([id,rect])=>[id,Object.freeze(rect)]))),
});
