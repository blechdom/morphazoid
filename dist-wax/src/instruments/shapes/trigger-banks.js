export const SHAPES_PREPARED_KITS = Object.freeze([
  { id: "fm-kit", label: "Soft FM kit", method: "scheduleFmDrum" },
  { id: "analog", label: "Analog drums", method: "scheduleAnalogDrum" },
  { id: "modal", label: "Modal drums", method: "scheduleModalDrum" },
  { id: "noise", label: "Noise percussion", method: "scheduleNoiseDrum" },
  { id: "pitched-morph", label: "Mallets · Pitched Morph" },
  { id: "karplus-strong", label: "Karplus–Strong" },
].map(Object.freeze));
