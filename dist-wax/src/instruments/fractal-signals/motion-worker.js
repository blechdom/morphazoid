import { buildMotionBank } from './motion-bank.js';
import { generateStructure } from './model.js';

self.onmessage = ({ data }) => {
  try {
    const bank = buildMotionBank(data.state, { version: data.version, generateStructure });
    self.postMessage({ bank });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
