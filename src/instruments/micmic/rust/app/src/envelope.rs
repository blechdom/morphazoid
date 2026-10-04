//! Bounded input history for the original branch-travel display. The audio
//! callback writes one envelope sample per 10 ms without allocating; HTTP
//! readers copy a coherent chronological snapshot on the control thread.
use serde::Serialize;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

const CAPACITY: usize = 4000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub interval: f64,
    pub end_time: f64,
    pub values: Vec<f32>,
}

pub struct History {
    sequence: AtomicU64,
    ticks: AtomicU64,
    interval: AtomicU64,
    values: [AtomicU32; CAPACITY],
}

impl Default for History {
    fn default() -> Self {
        Self {
            sequence: AtomicU64::new(0),
            ticks: AtomicU64::new(0),
            interval: AtomicU64::new(0.01_f64.to_bits()),
            values: std::array::from_fn(|_| AtomicU32::new(0)),
        }
    }
}

impl History {
    fn push(&self, value: f32) {
        self.sequence.fetch_add(1, Ordering::AcqRel);
        let ticks = self.ticks.load(Ordering::Relaxed);
        self.values[ticks as usize % CAPACITY].store(value.to_bits(), Ordering::Relaxed);
        self.ticks.store(ticks + 1, Ordering::Relaxed);
        self.sequence.fetch_add(1, Ordering::Release);
    }

    pub fn snapshot(&self) -> Snapshot {
        let interval = f64::from_bits(self.interval.load(Ordering::Relaxed));
        for _ in 0..3 {
            let sequence = self.sequence.load(Ordering::Acquire);
            if !sequence.is_multiple_of(2) {
                continue;
            }
            let ticks = self.ticks.load(Ordering::Relaxed);
            let count = ticks.min(CAPACITY as u64) as usize;
            let start = ticks as usize - count;
            let values = (start..start + count)
                .map(|index| f32::from_bits(self.values[index % CAPACITY].load(Ordering::Relaxed)))
                .collect();
            std::sync::atomic::fence(Ordering::Acquire);
            if sequence == self.sequence.load(Ordering::Relaxed) {
                return Snapshot {
                    interval,
                    end_time: ticks as f64 * interval,
                    values,
                };
            }
        }
        Snapshot {
            interval,
            end_time: 0.,
            values: Vec::new(),
        }
    }
}

pub struct Sampler {
    window: usize,
    count: usize,
    sum: f64,
    peak: f64,
    level: f64,
    release: f64,
}

impl Sampler {
    pub fn new(rate: u32, history: &History) -> Self {
        let window = (rate as usize / 100).max(1);
        let interval = window as f64 / rate as f64;
        history
            .interval
            .store(interval.to_bits(), Ordering::Relaxed);
        Self {
            window,
            count: 0,
            sum: 0.,
            peak: 0.,
            level: 0.,
            release: (-interval / 0.16).exp(),
        }
    }

    pub fn sample(&mut self, frame: [f32; 2], history: &History) {
        let mono = (frame[0] as f64 + frame[1] as f64) * 0.5;
        self.sum += mono * mono;
        self.peak = self.peak.max(mono.abs());
        self.count += 1;
        if self.count == self.window {
            let next = ((self.sum / self.count as f64).sqrt() * 5.5)
                .max(self.peak * 0.9)
                .clamp(0., 1.);
            self.level = next.max(self.level * self.release);
            history.push(self.level as f32);
            self.count = 0;
            self.sum = 0.;
            self.peak = 0.;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_attacks_and_release_in_audio_time() {
        let history = History::default();
        let mut sampler = Sampler::new(48_000, &history);
        for _ in 0..480 {
            sampler.sample([0.1; 2], &history);
        }
        for _ in 0..7680 {
            sampler.sample([0.; 2], &history);
        }
        let result = history.snapshot();
        assert_eq!(result.values.len(), 17);
        assert_eq!(result.end_time, 0.17);
        assert!((result.values[0] - 0.55).abs() < 1e-5);
        assert!((result.values[16] - 0.55 / std::f32::consts::E).abs() < 1e-5);
    }

    #[test]
    fn wraps_chronologically_without_truncating_audio_history() {
        let history = History::default();
        for i in 0..CAPACITY + 37 {
            history.push(i as f32);
        }
        let result = history.snapshot();
        assert_eq!(result.values.len(), CAPACITY);
        assert_eq!(result.values[0], 37.);
        assert_eq!(result.values[CAPACITY - 1], (CAPACITY + 36) as f32);
        assert!((result.end_time - 40.37).abs() < 1e-10);
    }
}
