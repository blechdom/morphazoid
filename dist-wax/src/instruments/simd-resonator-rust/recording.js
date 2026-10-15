import { mountChannelRecording } from '../spartial/spartial-recording.js';

/** The shared capture/export workflow with Rezoidinator's name and input rule. */
export function mountResonatorRecording(options) {
  return mountChannelRecording({ ...options, instrumentName: 'Rezoidinator', namePrefix: 'rezoidinator',
    labels: { record: 'Record channels', stop: 'Stop recording', export: 'Export channels',
      unavailable: 'Enable Surround and Audio to record speaker channels.' } });
}
