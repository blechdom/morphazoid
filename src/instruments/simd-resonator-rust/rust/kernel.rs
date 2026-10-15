//! SIMD Resonator's damped quadrature bank, ported from the original
//! AssemblyScript kernels. ABI 1: fixed f32 arrays; one non-reentrant owner.
//! Coefficients are prepared/validated outside the render callback. No allocator,
//! imports, shared memory, or memory growth; scalar and SIMD use the same layout.
#![no_std]

const MAX_MODES: usize = 4096;
const BLOCK_SIZE: usize = 128;
const TILE: usize = 4;

#[repr(C, align(16))]
struct Buffers {
    input: [f32; BLOCK_SIZE],
    output_left: [f32; BLOCK_SIZE],
    output_right: [f32; BLOCK_SIZE],
    real: [f32; MAX_MODES],
    imaginary: [f32; MAX_MODES],
    cosine: [f32; MAX_MODES],
    sine: [f32; MAX_MODES],
    decay: [f32; MAX_MODES],
    strike: [f32; MAX_MODES],
    gain: [f32; MAX_MODES],
    pan_left: [f32; MAX_MODES],
    pan_right: [f32; MAX_MODES],
    energy: [f32; MAX_MODES],
}

static mut BUFFERS: Buffers = Buffers {
    input: [0.0; BLOCK_SIZE],
    output_left: [0.0; BLOCK_SIZE],
    output_right: [0.0; BLOCK_SIZE],
    real: [0.0; MAX_MODES],
    imaginary: [0.0; MAX_MODES],
    cosine: [0.0; MAX_MODES],
    sine: [0.0; MAX_MODES],
    decay: [0.0; MAX_MODES],
    strike: [0.0; MAX_MODES],
    gain: [0.0; MAX_MODES],
    pan_left: [0.0; MAX_MODES],
    pan_right: [0.0; MAX_MODES],
    energy: [0.0; MAX_MODES],
};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

macro_rules! pointer {
    ($export:ident, $field:ident) => {
        #[no_mangle]
        pub extern "C" fn $export() -> *mut f32 {
            // SAFETY: returning a raw pointer does not create a shared reference.
            unsafe { core::ptr::addr_of_mut!(BUFFERS.$field).cast() }
        }
    };
}
pointer!(input_ptr, input);
pointer!(output_left_ptr, output_left);
pointer!(output_right_ptr, output_right);
pointer!(real_ptr, real);
pointer!(imaginary_ptr, imaginary);
pointer!(cosine_ptr, cosine);
pointer!(sine_ptr, sine);
pointer!(decay_ptr, decay);
pointer!(strike_ptr, strike);
pointer!(gain_ptr, gain);
pointer!(pan_left_ptr, pan_left);
pointer!(pan_right_ptr, pan_right);
pointer!(energy_ptr, energy);

#[no_mangle]
pub extern "C" fn abi_version() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn max_modes() -> u32 {
    MAX_MODES as u32
}
#[no_mangle]
pub extern "C" fn block_size() -> u32 {
    BLOCK_SIZE as u32
}
#[no_mangle]
pub extern "C" fn lane_width() -> u32 {
    if cfg!(feature = "simd") {
        4
    } else {
        1
    }
}

#[no_mangle]
pub extern "C" fn reset_resonator() {
    // SAFETY: the caller exclusively owns this synchronous Wasm instance.
    let buffers = unsafe { &mut *core::ptr::addr_of_mut!(BUFFERS) };
    buffers.real.fill(0.0);
    buffers.imaginary.fill(0.0);
    buffers.energy.fill(0.0);
}

#[no_mangle]
pub extern "C" fn reset() {
    reset_resonator();
    let buffers = unsafe { &mut *core::ptr::addr_of_mut!(BUFFERS) };
    buffers.input.fill(0.0);
    buffers.output_left.fill(0.0);
    buffers.output_right.fill(0.0);
}

#[inline(always)]
fn finite(value: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

#[inline(always)]
fn soft_clip(value: f32) -> f32 {
    let value = finite(value);
    value / (1.0 + value.abs())
}

#[cfg(not(feature = "simd"))]
#[inline(always)]
fn render_tile<const COUNT: usize>(
    buffers: &mut Buffers,
    frame: usize,
    modes: usize,
    impulse: f32,
    output_scale: f32,
) {
    let mut left = [0.0_f32; COUNT];
    let mut right = [0.0_f32; COUNT];
    for mode in 0..modes {
        let mut re = buffers.real[mode];
        let mut im = buffers.imaginary[mode];
        let mut energy = buffers.energy[mode];
        let cosine = buffers.cosine[mode];
        let sine = buffers.sine[mode];
        let decay = buffers.decay[mode];
        let strike = buffers.strike[mode];
        let gain = buffers.gain[mode];
        let pan_left = buffers.pan_left[mode];
        let pan_right = buffers.pan_right[mode];
        for offset in 0..COUNT {
            let index = frame + offset;
            let excitation = buffers.input[index] + if index == 0 { impulse } else { 0.0 };
            im += excitation * strike;
            let next_re = (re * cosine - im * sine) * decay;
            im = (re * sine + im * cosine) * decay;
            re = next_re;
            let sample = re * gain;
            left[offset] += sample * pan_left;
            right[offset] += sample * pan_right;
            let falling = energy * 0.997;
            let magnitude = sample.abs();
            energy = if falling > magnitude {
                falling
            } else {
                magnitude
            };
        }
        buffers.real[mode] = finite(re);
        buffers.imaginary[mode] = finite(im);
        buffers.energy[mode] = finite(energy);
    }
    for offset in 0..COUNT {
        buffers.output_left[frame + offset] = soft_clip(left[offset] * output_scale);
        buffers.output_right[frame + offset] = soft_clip(right[offset] * output_scale);
    }
}

#[cfg(feature = "simd")]
#[inline(always)]
fn render_tile<const COUNT: usize>(
    buffers: &mut Buffers,
    frame: usize,
    modes: usize,
    impulse: f32,
    output_scale: f32,
) {
    use core::arch::wasm32::*;
    // SAFETY: each array is 16-byte aligned with MAX_MODES allocated elements.
    // The count is a multiple of four, bounded before entering. Every load/store
    // visits a complete group within its own array, including the last group.
    // Buffers are exclusively borrowed; inputs and outputs do not alias states.
    unsafe {
        let energy_fall = f32x4_splat(0.997);
        let zero = f32x4_splat(0.0);
        let max_finite = f32x4_splat(f32::MAX);
        let mut left = [zero; COUNT];
        let mut right = [zero; COUNT];
        let mut excitation = [zero; COUNT];
        for offset in 0..COUNT {
            let index = frame + offset;
            excitation[offset] =
                f32x4_splat(buffers.input[index] + if index == 0 { impulse } else { 0.0 });
        }
        for mode in (0..modes).step_by(4) {
            let mut re = v128_load(buffers.real.as_ptr().add(mode).cast());
            let mut im = v128_load(buffers.imaginary.as_ptr().add(mode).cast());
            let mut energy = v128_load(buffers.energy.as_ptr().add(mode).cast());
            let cosine = v128_load(buffers.cosine.as_ptr().add(mode).cast());
            let sine = v128_load(buffers.sine.as_ptr().add(mode).cast());
            let decay = v128_load(buffers.decay.as_ptr().add(mode).cast());
            let strike = v128_load(buffers.strike.as_ptr().add(mode).cast());
            let gain = v128_load(buffers.gain.as_ptr().add(mode).cast());
            let pan_left = v128_load(buffers.pan_left.as_ptr().add(mode).cast());
            let pan_right = v128_load(buffers.pan_right.as_ptr().add(mode).cast());
            for offset in 0..COUNT {
                im = f32x4_add(im, f32x4_mul(excitation[offset], strike));
                let next_re =
                    f32x4_mul(f32x4_sub(f32x4_mul(re, cosine), f32x4_mul(im, sine)), decay);
                im = f32x4_mul(f32x4_add(f32x4_mul(re, sine), f32x4_mul(im, cosine)), decay);
                re = next_re;
                let sample = f32x4_mul(re, gain);
                left[offset] = f32x4_add(left[offset], f32x4_mul(sample, pan_left));
                right[offset] = f32x4_add(right[offset], f32x4_mul(sample, pan_right));
                energy = f32x4_max(f32x4_mul(energy, energy_fall), f32x4_abs(sample));
            }
            // A corrupt/overflowing lane is cleared without poisoning its
            // neighbors or following blocks. Normal finite math is unchanged.
            re = v128_and(re, f32x4_le(f32x4_abs(re), max_finite));
            im = v128_and(im, f32x4_le(f32x4_abs(im), max_finite));
            energy = v128_and(energy, f32x4_le(f32x4_abs(energy), max_finite));
            v128_store(buffers.real.as_mut_ptr().add(mode).cast(), re);
            v128_store(buffers.imaginary.as_mut_ptr().add(mode).cast(), im);
            v128_store(buffers.energy.as_mut_ptr().add(mode).cast(), energy);
        }
        for offset in 0..COUNT {
            let l = f32x4_extract_lane::<0>(left[offset])
                + f32x4_extract_lane::<1>(left[offset])
                + f32x4_extract_lane::<2>(left[offset])
                + f32x4_extract_lane::<3>(left[offset]);
            let r = f32x4_extract_lane::<0>(right[offset])
                + f32x4_extract_lane::<1>(right[offset])
                + f32x4_extract_lane::<2>(right[offset])
                + f32x4_extract_lane::<3>(right[offset]);
            buffers.output_left[frame + offset] = soft_clip(l * output_scale);
            buffers.output_right[frame + offset] = soft_clip(r * output_scale);
        }
    }
}

fn render(buffers: &mut Buffers, frames: usize, modes: usize, impulse: f32, output_scale: f32) {
    let mut frame = 0;
    // Specialize the common tile so Wasm keeps each sum in registers instead
    // of indexing a scratch array. Partial calls remain sample-exact.
    while frame + TILE <= frames {
        render_tile::<TILE>(buffers, frame, modes, impulse, output_scale);
        frame += TILE;
    }
    while frame < frames {
        render_tile::<1>(buffers, frame, modes, impulse, output_scale);
        frame += 1;
    }
}

#[no_mangle]
pub extern "C" fn process_resonator(frames: i32, modes: i32, impulse: f32, output_scale: f32) {
    let frames = frames.clamp(0, BLOCK_SIZE as i32) as usize;
    let modes = (modes.clamp(4, MAX_MODES as i32) as usize) & !3;
    // SAFETY: the browser adapter owns this instance and must not re-enter.
    let buffers = unsafe { &mut *core::ptr::addr_of_mut!(BUFFERS) };
    for input in &mut buffers.input[..frames] {
        *input = finite(*input);
    }
    render(
        buffers,
        frames,
        modes,
        finite(impulse),
        finite(output_scale),
    );
}
