// Fixed engine trims measured through the shared output graph, 2026-10-01.
// These do not follow the signal or cancel the performer's amplitude edits.
export const NATIVE_OUTPUT_TRIMS=Object.freeze({
  espeak:1.564,'espeak-klatt':4.714,
  'flite-slt':.917,'flite-awb':1.508,'flite-rms':1.605,'flite-kal':1.413,'flite-kal16':3.378,
  gnuspeech:.69,pico:1.269,hts:3.46,vizsn:1.4,mea8000:.943,
  singer:1.127,'stk-voicform':.653,'csound-fof':1.119,'csound-vosim':1.677,sinsy:3.635,
});
