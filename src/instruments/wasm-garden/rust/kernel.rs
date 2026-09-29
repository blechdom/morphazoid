//! Dependency-free Rust Garden render kernel. See README.md for memory ABI.
#![no_std]

const MAX_MODES: usize = 32768;
const MAX_FRAMES: usize = 2048;
const HEADER: usize = 16;
const STATE_LEN: usize = HEADER + 14 * MAX_MODES;
// Pair loads may include one inactive lane, but may never cross lane capacity.
const _: () = assert!(MAX_MODES % 2 == 0);

static mut STATE: [f64; STATE_LEN] = [0.0; STATE_LEN];
static mut OUTPUT: [f32; 2 * MAX_FRAMES] = [0.0; 2 * MAX_FRAMES];

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[no_mangle]
pub extern "C" fn garden_abi_version() -> u32 { 1 }
#[no_mangle]
pub extern "C" fn garden_max_modes() -> u32 { MAX_MODES as u32 }
#[no_mangle]
pub extern "C" fn garden_max_frames() -> u32 { MAX_FRAMES as u32 }
#[no_mangle]
pub extern "C" fn garden_state_ptr() -> *mut f64 { core::ptr::addr_of_mut!(STATE).cast() }
#[no_mangle]
pub extern "C" fn garden_output_ptr() -> *mut f32 { core::ptr::addr_of_mut!(OUTPUT).cast() }

#[no_mangle]
pub extern "C" fn garden_process(frames: u32) -> u32 {
    use core::arch::wasm32::*;
    const TILE: usize = 8;
    if frames as usize > MAX_FRAMES { return 0; }
    // SAFETY: STATE and OUTPUT are disjoint fixed allocations owned exclusively
    // by this single-threaded, non-reentrant instance. The adapter initializes
    // finite coefficients/state; no allocation or memory growth occurs here.
    let state = unsafe { &mut *core::ptr::addr_of_mut!(STATE) };
    let output = unsafe { &mut *core::ptr::addr_of_mut!(OUTPUT) };
    let mut active = (state[0] as usize).min(MAX_MODES);
    let target = (state[1] as usize).min(MAX_MODES);
    let mut remaining = state[2] as usize;
    let mut frame = 0;
    // SAFETY: active/target are capped at MAX_MODES, frames at MAX_FRAMES.
    // Every structure-of-arrays lane has the full, even MAX_MODES capacity.
    // mode advances by two. Thus each vector load has two allocated doubles,
    // including the final pair when active is odd: then active < MAX_MODES.
    // In that last pair the inactive state is masked out of rendering, and
    // scalar stores preserve ALL of its existing state/coefficients/gains.
    // Inactive coefficients can retain old deltas; advancing them would make
    // a later expansion depend on the previously selected rendering backend.
    unsafe {
        let ptr = state.as_mut_ptr();
        while frame < frames as usize {
            let mut count = TILE.min(frames as usize - frame);
            if remaining > 0 { count = count.min(remaining); }
            let mut sums_l = [f64x2_splat(0.0); TILE];
            let mut sums_r = [f64x2_splat(0.0); TILE];
            let mut mode = 0;
            while mode < active {
                let index = HEADER + mode;
                let paired = mode + 1 < active;
                let mut re = v128_load(ptr.add(index).cast());
                let mut im = v128_load(ptr.add(index + MAX_MODES).cast());
                if !paired {
                    re = f64x2_replace_lane::<1>(re, 0.0);
                    im = f64x2_replace_lane::<1>(im, 0.0);
                }
                let mut c = v128_load(ptr.add(index + 2 * MAX_MODES).cast());
                let mut s = v128_load(ptr.add(index + 3 * MAX_MODES).cast());
                let mut gl = v128_load(ptr.add(index + 4 * MAX_MODES).cast());
                let mut gr = v128_load(ptr.add(index + 5 * MAX_MODES).cast());
                if remaining > 0 {
                    let dc = v128_load(ptr.add(index + 6 * MAX_MODES).cast());
                    let ds = v128_load(ptr.add(index + 7 * MAX_MODES).cast());
                    let dl = v128_load(ptr.add(index + 8 * MAX_MODES).cast());
                    let dr = v128_load(ptr.add(index + 9 * MAX_MODES).cast());
                    for offset in 0..count {
                        c = f64x2_add(c, dc);
                        s = f64x2_add(s, ds);
                        gl = f64x2_add(gl, dl);
                        gr = f64x2_add(gr, dr);
                        let next_re = f64x2_sub(f64x2_mul(c, re), f64x2_mul(s, im));
                        im = f64x2_add(f64x2_mul(s, re), f64x2_mul(c, im));
                        re = next_re;
                        sums_l[offset] = f64x2_add(sums_l[offset], f64x2_mul(re, gl));
                        sums_r[offset] = f64x2_add(sums_r[offset], f64x2_mul(re, gr));
                    }
                    if paired {
                        v128_store(ptr.add(index + 2 * MAX_MODES).cast(), c);
                        v128_store(ptr.add(index + 3 * MAX_MODES).cast(), s);
                        v128_store(ptr.add(index + 4 * MAX_MODES).cast(), gl);
                        v128_store(ptr.add(index + 5 * MAX_MODES).cast(), gr);
                    } else {
                        *ptr.add(index + 2 * MAX_MODES) = f64x2_extract_lane::<0>(c);
                        *ptr.add(index + 3 * MAX_MODES) = f64x2_extract_lane::<0>(s);
                        *ptr.add(index + 4 * MAX_MODES) = f64x2_extract_lane::<0>(gl);
                        *ptr.add(index + 5 * MAX_MODES) = f64x2_extract_lane::<0>(gr);
                    }
                } else {
                    for offset in 0..count {
                        let next_re = f64x2_sub(f64x2_mul(c, re), f64x2_mul(s, im));
                        im = f64x2_add(f64x2_mul(s, re), f64x2_mul(c, im));
                        re = next_re;
                        sums_l[offset] = f64x2_add(sums_l[offset], f64x2_mul(re, gl));
                        sums_r[offset] = f64x2_add(sums_r[offset], f64x2_mul(re, gr));
                    }
                }
                if paired {
                    v128_store(ptr.add(index).cast(), re);
                    v128_store(ptr.add(index + MAX_MODES).cast(), im);
                } else {
                    *ptr.add(index) = f64x2_extract_lane::<0>(re);
                    *ptr.add(index + MAX_MODES) = f64x2_extract_lane::<0>(im);
                }
                mode += 2;
            }
            for offset in 0..count {
                let l = f64x2_extract_lane::<0>(sums_l[offset]) + f64x2_extract_lane::<1>(sums_l[offset]);
                let r = f64x2_extract_lane::<0>(sums_r[offset]) + f64x2_extract_lane::<1>(sums_r[offset]);
                output[frame + offset] = (0.8 * l / (1.0 + l.abs())) as f32;
                output[MAX_FRAMES + frame + offset] = (0.8 * r / (1.0 + r.abs())) as f32;
            }
            frame += count;
            if remaining > 0 {
                remaining -= count;
                if remaining == 0 {
                    for mode in 0..active {
                        let index = HEADER + mode;
                        state[index + 2 * MAX_MODES] = state[index + 10 * MAX_MODES];
                        state[index + 3 * MAX_MODES] = state[index + 11 * MAX_MODES];
                        state[index + 4 * MAX_MODES] = state[index + 12 * MAX_MODES];
                        state[index + 5 * MAX_MODES] = state[index + 13 * MAX_MODES];
                    }
                    active = target;
                }
            }
        }
    }
    state[0] = active as f64;
    state[2] = remaining as f64;
    frames
}
