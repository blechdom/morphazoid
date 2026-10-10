/** Live gain controls are separate from musical scene controls, as in L-system Delay. */
export const DEFAULT_PERFORMANCE = Object.freeze({ inputGain:.85,wet:.7,dry:.3,outputLevel:1,outputBoostDb:6,
  hpfHz:30,lpfHz:18000,compressorThresholdDb:-12,compressorRatio:3,compressorAttackMs:5,compressorReleaseMs:120,compressorMakeupDb:0 });
export const PERFORMANCE_LIMITS = Object.freeze({inputGain:[0,4],wet:[0,1],dry:[0,1],outputLevel:[0,1],outputBoostDb:[-12,18],hpfHz:[5,2000],lpfHz:[400,22000],compressorThresholdDb:[-48,0],compressorRatio:[1,20],compressorAttackMs:[.1,100],compressorReleaseMs:[10,1000],compressorMakeupDb:[0,18]});
export const LIVE_GAIN_KEYS = Object.freeze(['inputGain','outputLevel','outputBoostDb']);
export function sanitizePerformance(value={}) { const next={};for(const [key,[lo,hi]] of Object.entries(PERFORMANCE_LIMITS)){const n=Number(value[key]);next[key]=Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):DEFAULT_PERFORMANCE[key];}return next; }
export function musicalMix(value) { const out=sanitizePerformance(value);for(const key of LIVE_GAIN_KEYS)delete out[key];return out; }
export function recallMix(scene,current) {const next=sanitizePerformance({...current,...scene});for(const key of LIVE_GAIN_KEYS)next[key]=current[key];return next;}
export const MASTERING_PRESETS = Object.freeze([
 {id:'open',label:'Open / gentle',mix:{hpfHz:30,lpfHz:18000,compressorThresholdDb:-12,compressorRatio:2,compressorAttackMs:12,compressorReleaseMs:180,compressorMakeupDb:0}},
 {id:'clear',label:'Clear / controlled',mix:{hpfHz:80,lpfHz:14000,compressorThresholdDb:-18,compressorRatio:3,compressorAttackMs:5,compressorReleaseMs:120,compressorMakeupDb:3}},
 {id:'warm',label:'Warm / close',mix:{hpfHz:45,lpfHz:6500,compressorThresholdDb:-20,compressorRatio:4,compressorAttackMs:15,compressorReleaseMs:260,compressorMakeupDb:4}},
 {id:'dense',label:'Dense / restrained',mix:{hpfHz:140,lpfHz:11000,compressorThresholdDb:-24,compressorRatio:6,compressorAttackMs:2,compressorReleaseMs:200,compressorMakeupDb:4}}
]);
