import { measureGraphDelayCapacity } from './graph-delay-capacity.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: measureGraphDelayCapacity(data.module, data.plan, data.sampleRate) }); }
  catch (error) { self.postMessage({ error: String(error.message || error) }); }
};
