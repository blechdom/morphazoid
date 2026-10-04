//! Control-thread memory checks. No fixed voice-count ceiling.
const ESTIMATED_BYTES_PER_VOICE: usize = 2048;

pub fn available_memory() -> Option<usize> {
    #[cfg(target_os = "linux")]
    {
        let info = std::fs::read_to_string("/proc/meminfo").ok()?;
        let kib = info.lines().find_map(|line| {
            line.strip_prefix("MemAvailable:")?
                .split_whitespace()
                .next()?
                .parse::<usize>()
                .ok()
        })?;
        kib.checked_mul(1024)
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}
pub fn voice_capacity() -> usize {
    // Budget the complete control/topology/retired-storage peak, leaving memory
    // for other instruments and the OS. Timing, rather than this generous memory
    // allowance, determines how many requested taps can actually sound.
    available_memory()
        .map_or(usize::MAX / ESTIMATED_BYTES_PER_VOICE, |bytes| {
            bytes / 4 / ESTIMATED_BYTES_PER_VOICE
        })
        .max(1)
}
pub fn check_voices(count: usize) -> Result<(), String> {
    if count > voice_capacity() {
        return Err(
            "Requested tree exceeds currently available memory; the previous tree is retained"
                .into(),
        );
    }
    Ok(())
}
pub fn reserve<T>(count: usize) -> Result<Vec<T>, String> {
    let mut values = Vec::new();
    values
        .try_reserve_exact(count)
        .map_err(|error| format!("Cannot grow delay storage: {error}"))?;
    Ok(values)
}

pub fn check_bytes(bytes: usize) -> Result<(), String> {
    if bytes > voice_capacity().saturating_mul(ESTIMATED_BYTES_PER_VOICE) {
        return Err(
            "Requested grammar exceeds currently available memory; the previous tree is retained"
                .into(),
        );
    }
    Ok(())
}
pub fn filled<T: Clone>(count: usize, value: T) -> Result<Vec<T>, String> {
    let mut values = reserve(count)?;
    values.resize(count, value);
    Ok(values)
}
pub fn copied<T: Copy>(values: &[T]) -> Result<Vec<T>, String> {
    let mut copy = reserve(values.len())?;
    copy.extend_from_slice(values);
    Ok(copy)
}
