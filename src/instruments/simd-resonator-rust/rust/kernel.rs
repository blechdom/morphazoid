//! SIMD Resonator's damped quadrature bank, ported from the original
//! AssemblyScript kernels. ABI 2: fixed f32 arrays; one non-reentrant owner.
//! Coefficients are prepared/validated outside the render callback. No allocator,
//! imports, shared memory, or memory growth; scalar and SIMD use the same layout.
#![no_std]

const MAX_MODES: usize = 4096;
const BLOCK_SIZE: usize = 128;
const TILE: usize = 4;
const MAX_SPATIAL_CHANNELS: usize = 16;

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
    spatial_output: [f32; MAX_SPATIAL_CHANNELS * BLOCK_SIZE],
    route_index_a: [u32; MAX_MODES],
    route_index_b: [u32; MAX_MODES],
    route_index_c: [u32; MAX_MODES],
    route_index_d: [u32; MAX_MODES],
    route_gain_a: [f32; MAX_MODES],
    route_gain_b: [f32; MAX_MODES],
    route_gain_c: [f32; MAX_MODES],
    route_gain_d: [f32; MAX_MODES],
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
    spatial_output: [0.0; MAX_SPATIAL_CHANNELS * BLOCK_SIZE],
    route_index_a: [0; MAX_MODES],
    route_index_b: [0; MAX_MODES],
    route_index_c: [0; MAX_MODES],
    route_index_d: [0; MAX_MODES],
    route_gain_a: [0.0; MAX_MODES],
    route_gain_b: [0.0; MAX_MODES],
    route_gain_c: [0.0; MAX_MODES],
    route_gain_d: [0.0; MAX_MODES],
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
pointer!(spatial_output_ptr, spatial_output);
pointer!(route_index_a_ptr, route_index_a);
pointer!(route_index_b_ptr, route_index_b);
pointer!(route_index_c_ptr, route_index_c);
pointer!(route_index_d_ptr, route_index_d);
pointer!(route_gain_a_ptr, route_gain_a);
pointer!(route_gain_b_ptr, route_gain_b);
pointer!(route_gain_c_ptr, route_gain_c);
pointer!(route_gain_d_ptr, route_gain_d);

#[no_mangle]
pub extern "C" fn max_spatial_channels() -> u32 {
    MAX_SPATIAL_CHANNELS as u32
}

#[no_mangle]
pub extern "C" fn abi_version() -> u32 {
    2
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
    buffers.spatial_output.fill(0.0);
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
fn render_tile<const COUNT: usize, const SPATIAL: bool>(
    buffers: &mut Buffers,
    frame: usize,
    modes: usize,
    impulse: f32,
    output_scale: f32,
    route_frames: usize,
) {
    let mut left = [0.0_f32; COUNT];
    let mut right = [0.0_f32; COUNT];
    for mode in 0..modes {
        let mut spatial_samples = [0.0_f32; COUNT];
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
            if SPATIAL {
                spatial_samples[offset] = sample;
            }
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
        if SPATIAL {
            if COUNT == 4 {
                route_four_scalar(buffers, mode, frame, &spatial_samples, route_frames);
            } else {
                route_sample(
                    buffers,
                    mode,
                    frame,
                    spatial_samples[0],
                    (frame + 1) as f32 / route_frames as f32,
                );
            }
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
fn render_tile<const COUNT: usize, const SPATIAL: bool>(
    buffers: &mut Buffers,
    frame: usize,
    modes: usize,
    impulse: f32,
    output_scale: f32,
    route_frames: usize,
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
            let mut spatial_samples = [zero; COUNT];
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
                if SPATIAL {
                    spatial_samples[offset] = sample;
                }
                left[offset] = f32x4_add(left[offset], f32x4_mul(sample, pan_left));
                right[offset] = f32x4_add(right[offset], f32x4_mul(sample, pan_right));
                energy = f32x4_max(f32x4_mul(energy, energy_fall), f32x4_abs(sample));
            }
            if SPATIAL {
                if COUNT == 4 {
                    // Transpose4 simultaneous modes×4 times, then pan over
                    // time with contiguous SIMD loads/stores instead of32
                    // scalar scatter updates. Every mode retains its own route.
                    let a = i32x4_shuffle::<0, 1, 4, 5>(spatial_samples[0], spatial_samples[1]);
                    let b = i32x4_shuffle::<2, 3, 6, 7>(spatial_samples[0], spatial_samples[1]);
                    let c = i32x4_shuffle::<0, 1, 4, 5>(spatial_samples[2], spatial_samples[3]);
                    let d = i32x4_shuffle::<2, 3, 6, 7>(spatial_samples[2], spatial_samples[3]);
                    route_four(
                        buffers,
                        mode,
                        frame,
                        i32x4_shuffle::<0, 2, 4, 6>(a, c),
                        route_frames,
                    );
                    route_four(
                        buffers,
                        mode + 1,
                        frame,
                        i32x4_shuffle::<1, 3, 5, 7>(a, c),
                        route_frames,
                    );
                    route_four(
                        buffers,
                        mode + 2,
                        frame,
                        i32x4_shuffle::<0, 2, 4, 6>(b, d),
                        route_frames,
                    );
                    route_four(
                        buffers,
                        mode + 3,
                        frame,
                        i32x4_shuffle::<1, 3, 5, 7>(b, d),
                        route_frames,
                    );
                } else {
                    let mix = (frame + 1) as f32 / route_frames as f32;
                    route_sample(
                        buffers,
                        mode,
                        frame,
                        f32x4_extract_lane::<0>(spatial_samples[0]),
                        mix,
                    );
                    route_sample(
                        buffers,
                        mode + 1,
                        frame,
                        f32x4_extract_lane::<1>(spatial_samples[0]),
                        mix,
                    );
                    route_sample(
                        buffers,
                        mode + 2,
                        frame,
                        f32x4_extract_lane::<2>(spatial_samples[0]),
                        mix,
                    );
                    route_sample(
                        buffers,
                        mode + 3,
                        frame,
                        f32x4_extract_lane::<3>(spatial_samples[0]),
                        mix,
                    );
                }
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

fn render<const SPATIAL: bool>(
    buffers: &mut Buffers,
    frames: usize,
    modes: usize,
    impulse: f32,
    output_scale: f32,
) {
    let mut frame = 0;
    // Specialize the common tile so Wasm keeps each sum in registers instead
    // of indexing a scratch array. Partial calls remain sample-exact.
    while frame + TILE <= frames {
        render_tile::<TILE, SPATIAL>(buffers, frame, modes, impulse, output_scale, frames);
        frame += TILE;
    }
    while frame < frames {
        render_tile::<1, SPATIAL>(buffers, frame, modes, impulse, output_scale, frames);
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
    render::<false>(
        buffers,
        frames,
        modes,
        finite(impulse),
        finite(output_scale),
    );
}

/// Sparse per-mode panning, before any stereo sum. The previous and next
/// equal-power route are crossfaded over one quantum, including speaker-pair
/// changes. A common two-speaker route needs only two output accumulations.
#[inline(always)]
fn route_sample(buffers: &mut Buffers, mode: usize, frame: usize, sample: f32, mix: f32) {
    let a = (buffers.route_index_a[mode] as usize).min(MAX_SPATIAL_CHANNELS - 1);
    let b = (buffers.route_index_b[mode] as usize).min(MAX_SPATIAL_CHANNELS - 1);
    let c = (buffers.route_index_c[mode] as usize).min(MAX_SPATIAL_CHANNELS - 1);
    let d = (buffers.route_index_d[mode] as usize).min(MAX_SPATIAL_CHANNELS - 1);
    let old_a = finite(buffers.route_gain_a[mode]);
    let old_b = finite(buffers.route_gain_b[mode]);
    let next_c = finite(buffers.route_gain_c[mode]);
    let next_d = finite(buffers.route_gain_d[mode]);
    let sample = finite(sample);
    if a == c && b == d {
        buffers.spatial_output[a * BLOCK_SIZE + frame] += sample * (old_a + (next_c - old_a) * mix);
        buffers.spatial_output[b * BLOCK_SIZE + frame] += sample * (old_b + (next_d - old_b) * mix);
    } else {
        buffers.spatial_output[a * BLOCK_SIZE + frame] += sample * old_a * (1.0 - mix);
        buffers.spatial_output[b * BLOCK_SIZE + frame] += sample * old_b * (1.0 - mix);
        buffers.spatial_output[c * BLOCK_SIZE + frame] += sample * next_c * mix;
        buffers.spatial_output[d * BLOCK_SIZE + frame] += sample * next_d * mix;
    }
}

#[no_mangle]
pub extern "C" fn process_resonator_spatial(
    frames: i32,
    modes: i32,
    impulse: f32,
    output_scale: f32,
) {
    let frames = frames.clamp(0, BLOCK_SIZE as i32) as usize;
    let modes = (modes.clamp(4, MAX_MODES as i32) as usize) & !3;
    let buffers = unsafe { &mut *core::ptr::addr_of_mut!(BUFFERS) };
    for input in &mut buffers.input[..frames] {
        *input = finite(*input);
    }
    for channel in 0..MAX_SPATIAL_CHANNELS {
        buffers.spatial_output[channel * BLOCK_SIZE..channel * BLOCK_SIZE + frames].fill(0.0);
    }
    render::<true>(
        buffers,
        frames,
        modes,
        finite(impulse),
        finite(output_scale),
    );
    for channel in 0..MAX_SPATIAL_CHANNELS {
        for frame in 0..frames {
            let index = channel * BLOCK_SIZE + frame;
            buffers.spatial_output[index] =
                soft_clip(buffers.spatial_output[index] * finite(output_scale));
        }
    }
}

#[cfg(feature = "simd")]
#[inline(always)]
fn route_four(
    buffers: &mut Buffers,
    mode: usize,
    frame: usize,
    samples: core::arch::wasm32::v128,
    frames: usize,
) {
    use core::arch::wasm32::*;
    let a = (buffers.route_index_a[mode] as usize).min(MAX_SPATIAL_CHANNELS - 1);
    let b = (buffers.route_index_b[mode] as usize).min(MAX_SPATIAL_CHANNELS - 1);
    let c = (buffers.route_index_c[mode] as usize).min(MAX_SPATIAL_CHANNELS - 1);
    let d = (buffers.route_index_d[mode] as usize).min(MAX_SPATIAL_CHANNELS - 1);
    let old_a = finite(buffers.route_gain_a[mode]);
    let old_b = finite(buffers.route_gain_b[mode]);
    let next_c = finite(buffers.route_gain_c[mode]);
    let next_d = finite(buffers.route_gain_d[mode]);
    unsafe {
        let mix = f32x4_mul(
            f32x4(
                (frame + 1) as f32,
                (frame + 2) as f32,
                (frame + 3) as f32,
                (frame + 4) as f32,
            ),
            f32x4_splat(1.0 / frames as f32),
        );
        let samples = v128_and(samples, f32x4_le(f32x4_abs(samples), f32x4_splat(f32::MAX)));
        let output = buffers.spatial_output.as_mut_ptr();
        if a == c && b == d {
            let ga = f32x4_add(
                f32x4_splat(old_a),
                f32x4_mul(f32x4_splat(next_c - old_a), mix),
            );
            let gb = f32x4_add(
                f32x4_splat(old_b),
                f32x4_mul(f32x4_splat(next_d - old_b), mix),
            );
            let pa = output.add(a * BLOCK_SIZE + frame).cast();
            let pb = output.add(b * BLOCK_SIZE + frame).cast();
            v128_store(pa, f32x4_add(v128_load(pa), f32x4_mul(samples, ga)));
            v128_store(pb, f32x4_add(v128_load(pb), f32x4_mul(samples, gb)));
        } else {
            let old = f32x4_mul(samples, f32x4_sub(f32x4_splat(1.0), mix));
            let next = f32x4_mul(samples, mix);
            let pa = output.add(a * BLOCK_SIZE + frame).cast();
            let pb = output.add(b * BLOCK_SIZE + frame).cast();
            let pc = output.add(c * BLOCK_SIZE + frame).cast();
            let pd = output.add(d * BLOCK_SIZE + frame).cast();
            v128_store(
                pa,
                f32x4_add(v128_load(pa), f32x4_mul(old, f32x4_splat(old_a))),
            );
            v128_store(
                pb,
                f32x4_add(v128_load(pb), f32x4_mul(old, f32x4_splat(old_b))),
            );
            v128_store(
                pc,
                f32x4_add(v128_load(pc), f32x4_mul(next, f32x4_splat(next_c))),
            );
            v128_store(
                pd,
                f32x4_add(v128_load(pd), f32x4_mul(next, f32x4_splat(next_d))),
            );
        }
    }
}

#[cfg(not(feature = "simd"))]
#[inline(always)]
fn route_four_scalar(
    buffers: &mut Buffers,
    mode: usize,
    frame: usize,
    samples: &[f32],
    frames: usize,
) {
    let a = (buffers.route_index_a[mode] as usize).min(MAX_SPATIAL_CHANNELS - 1);
    let b = (buffers.route_index_b[mode] as usize).min(MAX_SPATIAL_CHANNELS - 1);
    let c = (buffers.route_index_c[mode] as usize).min(MAX_SPATIAL_CHANNELS - 1);
    let d = (buffers.route_index_d[mode] as usize).min(MAX_SPATIAL_CHANNELS - 1);
    let old_a = finite(buffers.route_gain_a[mode]);
    let old_b = finite(buffers.route_gain_b[mode]);
    let next_c = finite(buffers.route_gain_c[mode]);
    let next_d = finite(buffers.route_gain_d[mode]);
    let step = 1.0 / frames as f32;
    let output = buffers.spatial_output.as_mut_ptr();
    // SAFETY: the full four-frame tile and clamped channel indices stay within
    // the fixed output array. Reads and writes are sequential even if routes
    // share a channel; no overlapping mutable references are created.
    unsafe {
        if a == c && b == d {
            for offset in 0..4 {
                let mix = (frame + offset + 1) as f32 * step;
                let sample = finite(samples[offset]);
                *output.add(a * BLOCK_SIZE + frame + offset) +=
                    sample * (old_a + (next_c - old_a) * mix);
                *output.add(b * BLOCK_SIZE + frame + offset) +=
                    sample * (old_b + (next_d - old_b) * mix);
            }
        } else {
            for offset in 0..4 {
                let mix = (frame + offset + 1) as f32 * step;
                let sample = finite(samples[offset]);
                *output.add(a * BLOCK_SIZE + frame + offset) += sample * old_a * (1.0 - mix);
                *output.add(b * BLOCK_SIZE + frame + offset) += sample * old_b * (1.0 - mix);
                *output.add(c * BLOCK_SIZE + frame + offset) += sample * next_c * mix;
                *output.add(d * BLOCK_SIZE + frame + offset) += sample * next_d * mix;
            }
        }
    }
}
