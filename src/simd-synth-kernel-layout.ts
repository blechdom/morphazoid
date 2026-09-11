export const BLOCK_SIZE: i32 = 128;
export const VOICE_COUNT: i32 = 8;
export const PARAM_COUNT: i32 = 51;
export const SEQUENCE_LENGTH: i32 = 16;
export const SEQUENCE_COMPONENTS: i32 = 4;
export const MOD_ROUTE_COUNT: i32 = 4;
export const MOD_ROUTE_COMPONENTS: i32 = 4;
export const DELAY_FRAMES: i32 = 32768;
export const DELAY_MASK: i32 = DELAY_FRAMES - 1;

const FLOAT_BYTES: i32 = 4;
const BLOCK_BYTES: i32 = BLOCK_SIZE * FLOAT_BYTES;
const VOICE_BYTES: i32 = VOICE_COUNT * FLOAT_BYTES;
const PARAM_BYTES: i32 = PARAM_COUNT * FLOAT_BYTES;
const SEQUENCE_BYTES: i32 = SEQUENCE_LENGTH * SEQUENCE_COMPONENTS * FLOAT_BYTES;
const MOD_ROUTE_BYTES: i32 = MOD_ROUTE_COUNT * MOD_ROUTE_COMPONENTS * FLOAT_BYTES;
const DELAY_BYTES: i32 = DELAY_FRAMES * FLOAT_BYTES;

const OUTPUT_LEFT: usize = memory.data(BLOCK_BYTES, 16);
const OUTPUT_RIGHT: usize = memory.data(BLOCK_BYTES, 16);
const PARAMS: usize = memory.data(PARAM_BYTES, 16);
const SEQUENCE: usize = memory.data(SEQUENCE_BYTES, 16);
const MOD_ROUTES: usize = memory.data(MOD_ROUTE_BYTES, 16);

const VOICE_NOTE: usize = memory.data(VOICE_BYTES, 16);
const VOICE_GATE: usize = memory.data(VOICE_BYTES, 16);
const VOICE_VELOCITY: usize = memory.data(VOICE_BYTES, 16);
const VOICE_ENVELOPE: usize = memory.data(VOICE_BYTES, 16);
const VOICE_STAGE: usize = memory.data(VOICE_BYTES, 16);
const VOICE_PHASE_A: usize = memory.data(VOICE_BYTES, 16);
const VOICE_PHASE_B: usize = memory.data(VOICE_BYTES, 16);
const FILTER_1_LOW: usize = memory.data(VOICE_BYTES, 16);
const FILTER_1_BAND: usize = memory.data(VOICE_BYTES, 16);
const FILTER_2_LOW: usize = memory.data(VOICE_BYTES, 16);
const FILTER_2_BAND: usize = memory.data(VOICE_BYTES, 16);
const FILTER_FEEDBACK: usize = memory.data(VOICE_BYTES, 16);
const VOICE_AGE: usize = memory.data(VOICE_BYTES, 16);

const DELAY_1_LEFT: usize = memory.data(DELAY_BYTES, 16);
const DELAY_1_RIGHT: usize = memory.data(DELAY_BYTES, 16);
const DELAY_2_LEFT: usize = memory.data(DELAY_BYTES, 16);
const DELAY_2_RIGHT: usize = memory.data(DELAY_BYTES, 16);

let delayCursor1: i32 = 0;
let delayCursor2: i32 = 0;
let sequenceActive: i32 = 0;
let voiceCounter: f32 = 1.0;

export function output_left_ptr(): usize { return OUTPUT_LEFT; }
export function output_right_ptr(): usize { return OUTPUT_RIGHT; }
export function params_ptr(): usize { return PARAMS; }
export function sequence_ptr(): usize { return SEQUENCE; }
export function mod_routes_ptr(): usize { return MOD_ROUTES; }
export function voice_note_ptr(): usize { return VOICE_NOTE; }
export function voice_gate_ptr(): usize { return VOICE_GATE; }
export function voice_velocity_ptr(): usize { return VOICE_VELOCITY; }
export function voice_envelope_ptr(): usize { return VOICE_ENVELOPE; }
export function voice_stage_ptr(): usize { return VOICE_STAGE; }
export function voice_phase_a_ptr(): usize { return VOICE_PHASE_A; }
export function voice_phase_b_ptr(): usize { return VOICE_PHASE_B; }
export function filter_1_low_ptr(): usize { return FILTER_1_LOW; }
export function filter_1_band_ptr(): usize { return FILTER_1_BAND; }
export function filter_2_low_ptr(): usize { return FILTER_2_LOW; }
export function filter_2_band_ptr(): usize { return FILTER_2_BAND; }
export function filter_feedback_ptr(): usize { return FILTER_FEEDBACK; }
export function voice_age_ptr(): usize { return VOICE_AGE; }
export function delay_1_left_ptr(): usize { return DELAY_1_LEFT; }
export function delay_1_right_ptr(): usize { return DELAY_1_RIGHT; }
export function delay_2_left_ptr(): usize { return DELAY_2_LEFT; }
export function delay_2_right_ptr(): usize { return DELAY_2_RIGHT; }
export function delay_cursor_1(): i32 { return delayCursor1; }
export function delay_cursor_2(): i32 { return delayCursor2; }
export function advance_delay_cursor_1(): void { delayCursor1 = (delayCursor1 + 1) & DELAY_MASK; }
export function advance_delay_cursor_2(): void { delayCursor2 = (delayCursor2 + 1) & DELAY_MASK; }
export function sequence_active(): i32 { return sequenceActive; }
export function set_sequence_active(value: i32): void {
  const next = value != 0 ? 1 : 0;
  if (next != sequenceActive) {
    // Voice zero belongs to the sequencer while transport is active. Release
    // it on either edge so pausing cannot leave a held gate and resuming can
    // be recognized as a fresh gate by the sequence renderer.
    store<f32>(VOICE_GATE, 0.0);
    store<f32>(VOICE_STAGE, 0.0);
  }
  sequenceActive = next;
}

export function sample_ptr(base: usize, index: i32): usize { return base + <usize>(index << 2); }
export function bounded_frames(value: i32): i32 { return value < 0 ? 0 : value > BLOCK_SIZE ? BLOCK_SIZE : value; }
export function clampf(value: f32, minimum: f32, maximum: f32): f32 { return Mathf.min(maximum, Mathf.max(minimum, value)); }

export function note_on(noteValue: f32, velocityValue: f32): void {
  const note = clampf(noteValue, 0.0, 127.0);
  const velocity = clampf(velocityValue, 0.01, 1.0);
  const firstVoice = sequenceActive != 0 ? 1 : 0;
  let chosen: i32 = -1;
  let quietest: f32 = 2.0;
  let oldest: f32 = 1.0e30;
  let oldestVoice: i32 = firstVoice;
  for (let voice = firstVoice; voice < VOICE_COUNT; voice += 1) {
    const offset = <usize>(voice << 2);
    const activeNote = load<f32>(VOICE_NOTE + offset);
    const gate = load<f32>(VOICE_GATE + offset);
    const envelope = load<f32>(VOICE_ENVELOPE + offset);
    const age = load<f32>(VOICE_AGE + offset);
    if (gate > 0.5 && Mathf.abs(activeNote - note) < 0.01) { chosen = voice; break; }
    if (gate <= 0.5 && envelope < quietest) { chosen = voice; quietest = envelope; }
    if (gate > 0.5 && age < oldest) { oldestVoice = voice; oldest = age; }
  }
  if (chosen < 0) chosen = oldestVoice;
  const offset = <usize>(chosen << 2);
  store<f32>(VOICE_NOTE + offset, note);
  store<f32>(VOICE_GATE + offset, 1.0);
  store<f32>(VOICE_VELOCITY + offset, velocity);
  store<f32>(VOICE_STAGE + offset, 1.0);
  store<f32>(VOICE_PHASE_A + offset, 0.0);
  store<f32>(VOICE_PHASE_B + offset, 0.0);
  store<f32>(VOICE_AGE + offset, voiceCounter);
  voiceCounter += 1.0;
}

export function note_off(noteValue: f32): void {
  const note = clampf(noteValue, 0.0, 127.0);
  const firstVoice = sequenceActive != 0 ? 1 : 0;
  for (let voice = firstVoice; voice < VOICE_COUNT; voice += 1) {
    const offset = <usize>(voice << 2);
    if (Mathf.abs(load<f32>(VOICE_NOTE + offset) - note) < 0.01) {
      store<f32>(VOICE_GATE + offset, 0.0);
      store<f32>(VOICE_STAGE + offset, 0.0);
    }
  }
}

export function all_notes_off(): void {
  memory.fill(VOICE_GATE, 0, VOICE_BYTES);
  memory.fill(VOICE_STAGE, 0, VOICE_BYTES);
}

export function reset(): void {
  memory.fill(OUTPUT_LEFT, 0, BLOCK_BYTES);
  memory.fill(OUTPUT_RIGHT, 0, BLOCK_BYTES);
  memory.fill(VOICE_NOTE, 0, VOICE_BYTES);
  memory.fill(VOICE_GATE, 0, VOICE_BYTES);
  memory.fill(VOICE_VELOCITY, 0, VOICE_BYTES);
  memory.fill(VOICE_ENVELOPE, 0, VOICE_BYTES);
  memory.fill(VOICE_STAGE, 0, VOICE_BYTES);
  memory.fill(VOICE_PHASE_A, 0, VOICE_BYTES);
  memory.fill(VOICE_PHASE_B, 0, VOICE_BYTES);
  memory.fill(FILTER_1_LOW, 0, VOICE_BYTES);
  memory.fill(FILTER_1_BAND, 0, VOICE_BYTES);
  memory.fill(FILTER_2_LOW, 0, VOICE_BYTES);
  memory.fill(FILTER_2_BAND, 0, VOICE_BYTES);
  memory.fill(FILTER_FEEDBACK, 0, VOICE_BYTES);
  memory.fill(VOICE_AGE, 0, VOICE_BYTES);
  memory.fill(DELAY_1_LEFT, 0, DELAY_BYTES);
  memory.fill(DELAY_1_RIGHT, 0, DELAY_BYTES);
  memory.fill(DELAY_2_LEFT, 0, DELAY_BYTES);
  memory.fill(DELAY_2_RIGHT, 0, DELAY_BYTES);
  for (let voice = 0; voice < VOICE_COUNT; voice += 1) store<f32>(VOICE_NOTE + <usize>(voice << 2), -1.0);
  delayCursor1 = 0;
  delayCursor2 = 0;
  sequenceActive = 0;
  voiceCounter = 1.0;
}
