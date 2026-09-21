import { DEFAULTS } from './puggler.js';
const posterSeedFor = id => [...id].reduce((seed,letter)=>Math.imul(seed^letter.charCodeAt(0),16777619)>>>0,2166136261);
export const PAGE_DEFAULTS = { ...DEFAULTS, count:6, pattern:'many-6', tempo:360, loft:1.8, cast:'trio', autoRide:true, phrase:'verse', assist:42, chaos:40, ridePattern:'double-step',rideSpeed:.85,rideRange:44,posterSeed:posterSeedFor('ballet'), propIds:['guitar','can','boot','vinyl','cassette','plushrat','skateboard','mic','brick','cone'] };
const act=(id,name,config)=>({id,name,config:{...PAGE_DEFAULTS,...config,posterSeed:posterSeedFor(id)}});
export const PRESETS = Object.freeze([
  act('ballet','Trash trio',{}),
  act('bell','One dumb bell',{count:1,pattern:'single',propIds:['bell'],tempo:240,cast:'puggler',phrase:'evolve',loft:2,chaos:15,ridePattern:'sweep',rideSpeed:.55,rideRange:62}),
  act('roxy','Roxy’s boot solo',{count:1,pattern:'single-hand',propIds:['boot'],tempo:280,cast:'roxy',phrase:'loop',loft:1.5,chaos:12,ridePattern:'lurch',rideSpeed:1.12,rideRange:46}),
  act('moss','Moss and the rat',{count:1,pattern:'single',propIds:['plushrat'],tempo:180,cast:'moss',phrase:'verse',loft:2.5,chaos:18,ridePattern:'rock',rideSpeed:.52,rideRange:24}),
  act('cans','Two cans, no plan',{count:2,pattern:'two-shower',propIds:['can','can'],tempo:320,cast:'puggler',phrase:'loop',loft:1.1,chaos:30,ridePattern:'double-step',rideSpeed:1.45,rideRange:38}),
  act('roxy-moss','Roxy + Moss / filthy duet',{count:4,pattern:'fountain',propIds:['mic','boot','cassette','plushrat'],cast:'roxy-moss',tempo:380,phrase:'verse',passMode:'three',chaos:25,ridePattern:'sweep',rideSpeed:.8,rideRange:74}),
  act('puggler-moss','Puggler + Moss / brick trade',{count:3,pattern:'tower',propIds:['brick','can','brick'],cast:'puggler-moss',tempo:270,phrase:'loop',passMode:'every',chaos:20,ridePattern:'surge',rideSpeed:.78,rideRange:52}),
  act('float','Puggler + Roxy / two-player pit',{count:4,pattern:'fountain',propIds:['guitar','duck','boot','mic'],cast:'puggler-roxy',autoRide:false,tempo:420,phrase:'verse',chaos:30,ridePattern:'rock',rideSpeed:1.15,rideRange:58}),
  act('cassettes','Demo tape shower',{count:3,pattern:'shower',propIds:['cassette','cassette','vinyl'],cast:'roxy',tempo:460,phrase:'loop',loft:1.3,chaos:15,ridePattern:'double-step',rideSpeed:1.75,rideRange:32}),
  act('columns','Dead-straight columns',{count:2,pattern:'sync-columns',propIds:['bottle','can'],cast:'moss',tempo:220,phrase:'loop',loft:1.5,assist:65,chaos:0,ridePattern:'rock',rideSpeed:.65,rideRange:18}),
  act('skate','Skatepark breakdown',{count:5,pattern:'many-5',propIds:['skateboard','cone','boot','can','guitar'],cast:'puggler-moss',tempo:540,phrase:'evolve',passMode:'phrase',chaos:42,ridePattern:'surge',rideSpeed:1.45,rideRange:78}),
  act('rats','Rat choir',{count:3,pattern:'half-box',propIds:['plushrat','plushrat','plushrat'],riffs:['oi','woo','oi'],cast:'trio',tempo:300,phrase:'verse',loft:2.2,chaos:16,ridePattern:'rock',rideSpeed:.72,rideRange:30}),
  act('heavy','Heavy hands',{count:4,pattern:'534',propIds:['guitar','brick','bowling','skateboard'],cast:'puggler',tempo:250,phrase:'loop',loft:1.1,chaos:20,ridePattern:'lurch',rideSpeed:.55,rideRange:38}),
  act('fish','Fish stink refrain',{count:5,pattern:'many-5',propIds:['fish','fish','boot','fish','mic'],cast:'roxy-moss',tempo:480,phrase:'verse',passMode:'phrase',chaos:35,ridePattern:'sweep',rideSpeed:1.35,rideRange:74}),
  act('seven','Seven-inch meltdown',{count:7,pattern:'shower-7',propIds:Array(7).fill('vinyl'),cast:'trio',tempo:650,phrase:'loop',loft:1.8,chaos:20,ridePattern:'surge',rideSpeed:1.85,rideRange:40}),
  act('eight','Eight-way gutter fountain',{count:8,pattern:'sync-8',cast:'trio',tempo:800,phrase:'loop',loft:2.4,chaos:24,ridePattern:'double-step',rideSpeed:1.4,rideRange:42}),
  act('nine','Nine lives in the pit',{count:9,pattern:'many-9',cast:'trio',tempo:960,phrase:'evolve',loft:2.4,chaos:38,ridePattern:'lurch',rideSpeed:1.9,rideRange:60}),
  act('metal','1,200 BPM / ten-object riot',{count:10,pattern:'many-10',tempo:1200,cast:'trio',phrase:'evolve',loft:2.5,chaos:25,ridePattern:'surge',rideSpeed:2.2,rideRange:62}),
  act('gutter-buffet','Gutter buffet',{count:4,pattern:'fountain',propIds:['icecream','pickle','banana','plant'],cast:'roxy-moss',tempo:340,phrase:'verse',passMode:'three',loft:1.6,chaos:18,ridePattern:'double-step',rideSpeed:.95,rideRange:48}),
  act('curbside-requiem','Curbside requiem',{count:4,pattern:'534',propIds:['deadcat','skull','violin','axe'],cast:'trio',tempo:280,phrase:'verse',passMode:'phrase',loft:2,chaos:16,ridePattern:'lurch',rideSpeed:.68,rideRange:46}),
  act('plumbing-riot','Street plumbing riot',{count:3,pattern:'tower',propIds:['hydrant','plunger','snake'],cast:'puggler-moss',tempo:300,phrase:'evolve',loft:1.25,chaos:22,ridePattern:'surge',rideSpeed:.9,rideRange:58}),
  act('bootleg-bin','Bootleg bargain bin',{count:5,pattern:'many-5',propIds:['cd','vhs','cassette','vinyl','mic'],cast:'roxy',tempo:510,phrase:'verse',loft:1.75,chaos:24,ridePattern:'sweep',rideSpeed:1.55,rideRange:66}),
]);
