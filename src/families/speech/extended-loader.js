import { loadSpeechAtlas } from './atlas-loader.js';
export function loadExtendedAtlas({engine, parameters, ...options}) {
  return loadSpeechAtlas({...options, workerUrl:new URL('./extended-worker.js',import.meta.url),
    request:{type:'render',engine,parameters}});
}
