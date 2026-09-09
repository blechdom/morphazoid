import { DEFAULTS } from './puggler.js';
export const PAGE_DEFAULTS = { ...DEFAULTS, count:6, pattern:'many-6', tempo:360, loft:1.8, cast:'trio', autoRide:true, phrase:'verse', assist:42, chaos:40, propIds:['guitar','can','boot','vinyl','cassette','plushrat','skateboard','mic','brick','cone'] };
const act=(id,name,config)=>({id,name,config:{...PAGE_DEFAULTS,...config}});
export const PRESETS = Object.freeze([
  act('ballet','Trash trio',{}),
  act('bell','One dumb bell',{count:1,pattern:'single',propIds:['bell'],tempo:240,cast:'puggler',phrase:'evolve',loft:2,chaos:15}),
  act('roxy','Roxy’s boot solo',{count:1,pattern:'single-hand',propIds:['boot'],tempo:280,cast:'roxy',phrase:'loop',loft:1.5,chaos:12}),
  act('moss','Moss and the rat',{count:1,pattern:'single',propIds:['plushrat'],tempo:180,cast:'moss',phrase:'verse',loft:2.5,chaos:18}),
  act('cans','Two cans, no plan',{count:2,pattern:'two-shower',propIds:['can','can'],tempo:320,cast:'puggler',phrase:'loop',loft:1.1,chaos:30}),
  act('roxy-moss','Roxy + Moss / filthy duet',{count:4,pattern:'fountain',propIds:['mic','boot','cassette','plushrat'],cast:'roxy-moss',tempo:380,phrase:'verse',passMode:'three',chaos:25}),
  act('puggler-moss','Puggler + Moss / brick trade',{count:3,pattern:'tower',propIds:['brick','can','brick'],cast:'puggler-moss',tempo:270,phrase:'loop',passMode:'every',chaos:20}),
  act('float','Puggler + Roxy / two-player pit',{count:4,pattern:'fountain',propIds:['guitar','duck','boot','mic'],cast:'puggler-roxy',autoRide:false,tempo:420,phrase:'verse',chaos:30}),
  act('cassettes','Demo tape shower',{count:3,pattern:'shower',propIds:['cassette','cassette','vinyl'],cast:'roxy',tempo:460,phrase:'loop',loft:1.3,chaos:15}),
  act('columns','Dead-straight columns',{count:2,pattern:'sync-columns',propIds:['bottle','can'],cast:'moss',tempo:220,phrase:'loop',loft:1.5,assist:65,chaos:0}),
  act('skate','Skatepark breakdown',{count:5,pattern:'many-5',propIds:['skateboard','cone','boot','can','guitar'],cast:'puggler-moss',tempo:540,phrase:'evolve',passMode:'phrase',chaos:42}),
  act('rats','Rat choir',{count:3,pattern:'half-box',propIds:['plushrat','plushrat','plushrat'],riffs:['oi','woo','oi'],cast:'trio',tempo:300,phrase:'verse',loft:2.2,chaos:16}),
  act('heavy','Heavy hands',{count:4,pattern:'534',propIds:['guitar','brick','bowling','skateboard'],cast:'puggler',tempo:250,phrase:'loop',loft:1.1,chaos:20}),
  act('fish','Fish stink refrain',{count:5,pattern:'many-5',propIds:['fish','fish','boot','fish','mic'],cast:'roxy-moss',tempo:480,phrase:'verse',passMode:'phrase',chaos:35}),
  act('seven','Seven-inch meltdown',{count:7,pattern:'shower-7',propIds:Array(7).fill('vinyl'),cast:'trio',tempo:650,phrase:'loop',loft:1.8,chaos:20}),
  act('eight','Eight-way gutter fountain',{count:8,pattern:'sync-8',cast:'trio',tempo:800,phrase:'loop',loft:2.4,chaos:24}),
  act('nine','Nine lives in the pit',{count:9,pattern:'many-9',cast:'trio',tempo:960,phrase:'evolve',loft:2.4,chaos:38}),
  act('metal','1,200 BPM / ten-object riot',{count:10,pattern:'many-10',tempo:1200,cast:'trio',phrase:'evolve',loft:2.5,chaos:25}),
]);
