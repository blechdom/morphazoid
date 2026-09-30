import { createNativeSelectPicker } from '../../ui/patterns/native-select-picker.js';

export function createJawHarpSelectPicker(select, options) {
  return createNativeSelectPicker(select, { className: 'jaw-select-picker', releaseKeys: ['[', ']'], ...options });
}
