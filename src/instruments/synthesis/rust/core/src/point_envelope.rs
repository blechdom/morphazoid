//! Optional five-point note envelope. Legacy ADSR does not use this path.
//! T/A/D/S run from gate-on in seconds; S holds until note-off. The R point
//! defines release duration relative to S and its own independent target level.
use crate::bounded;

pub const ENVELOPE_POINT_COUNT: usize = 5;
pub const MAX_ENVELOPE_TIME: f32 = 64.0;
const MIN_SEGMENT: f32 = 0.001;
const SAFETY_SECONDS: f64 = 0.005;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EnvelopePoint {
    pub time: f32,
    pub level: f32,
}

/// Leave room for every following node even when a hostile first time is huge.
/// Sanitization preserves node identities and never sorts or couples levels.
pub fn sanitize_envelope_points(
    mut points: [EnvelopePoint; ENVELOPE_POINT_COUNT],
) -> [EnvelopePoint; ENVELOPE_POINT_COUNT] {
    let mut minimum: f32 = 0.0;
    for (index, point) in points.iter_mut().enumerate() {
        let maximum = MAX_ENVELOPE_TIME - (ENVELOPE_POINT_COUNT - 1 - index) as f32 * MIN_SEGMENT;
        let lower = minimum.min(maximum);
        point.time = bounded(point.time, lower, maximum, lower);
        point.level = bounded(point.level, 0.0, 1.0, 0.0);
        minimum = (point.time + MIN_SEGMENT).min(MAX_ENVELOPE_TIME);
    }
    points
}

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Idle,
    Held,
    Release,
}

pub(crate) struct PointEnvelope {
    points: [EnvelopePoint; ENVELOPE_POINT_COUNT],
    phase: Phase,
    elapsed: f64,
    release_from: f32,
    correction: f32,
    correction_left: u32,
    correction_frames: u32,
}

impl PointEnvelope {
    pub(crate) fn new(points: [EnvelopePoint; ENVELOPE_POINT_COUNT], sample_rate: f32) -> Self {
        Self {
            points: sanitize_envelope_points(points),
            phase: Phase::Idle,
            elapsed: 0.0,
            release_from: 0.0,
            correction: 0.0,
            correction_left: 0,
            correction_frames: (sample_rate as f64 * SAFETY_SECONDS).ceil().max(1.0) as u32,
        }
    }

    pub(crate) fn reset(&mut self) {
        self.phase = Phase::Idle;
        self.elapsed = 0.0;
        self.correction = 0.0;
        self.correction_left = 0;
    }

    pub(crate) fn is_active(&self) -> bool {
        self.phase != Phase::Idle
    }

    fn smooth_from(&mut self, current: f32) {
        self.correction = current - self.target();
        self.correction_left = self.correction_frames;
    }

    pub(crate) fn update(&mut self, points: [EnvelopePoint; ENVELOPE_POINT_COUNT], current: f32) {
        let points = sanitize_envelope_points(points);
        if self.points == points {
            return;
        }
        self.points = points;
        if self.is_active() {
            // Retain the audio-clock position, not a freshly triggered attack.
            self.smooth_from(current);
        }
    }

    pub(crate) fn note_on(&mut self, current: f32, elapsed: f64) {
        self.phase = Phase::Held;
        self.elapsed = elapsed;
        // T may start at time zero above zero. The 5 ms correction also makes
        // retriggers and switching from a live legacy ADSR continuous.
        self.smooth_from(current);
    }

    pub(crate) fn note_off(&mut self, current: f32) {
        if self.phase != Phase::Held {
            return;
        }
        self.phase = Phase::Release;
        self.elapsed = 0.0;
        self.release_from = current;
        self.correction = 0.0;
        self.correction_left = 0;
    }

    fn release_duration(&self) -> f64 {
        (self.points[4].time as f64 - self.points[3].time as f64).max(MIN_SEGMENT as f64)
    }

    fn target(&self) -> f32 {
        match self.phase {
            Phase::Idle => 0.0,
            Phase::Held => {
                let mut previous = EnvelopePoint {
                    time: 0.0,
                    level: 0.0,
                };
                for point in &self.points[..4] {
                    if self.elapsed < point.time as f64 {
                        let span = point.time as f64 - previous.time as f64;
                        let fraction = ((self.elapsed - previous.time as f64) / span) as f32;
                        return previous.level + (point.level - previous.level) * fraction;
                    }
                    previous = *point;
                }
                self.points[3].level
            }
            Phase::Release => {
                let duration = self.release_duration();
                let end = self.points[4].level;
                if self.elapsed < duration {
                    self.release_from + (end - self.release_from) * (self.elapsed / duration) as f32
                } else {
                    // A freely movable nonzero R must never become a stuck tail.
                    end * (1.0 - ((self.elapsed - duration) / SAFETY_SECONDS) as f32).max(0.0)
                }
            }
        }
    }

    pub(crate) fn next(&mut self, sample_rate: f32) -> f32 {
        if !self.is_active() {
            return 0.0;
        }
        self.elapsed =
            (self.elapsed + 1.0 / sample_rate as f64).min(MAX_ENVELOPE_TIME as f64 + 1.0);
        self.correction_left = self.correction_left.saturating_sub(1);
        let correction =
            self.correction * self.correction_left as f32 / self.correction_frames as f32;
        let output = (self.target() + correction).clamp(0.0, 1.0);
        if self.phase == Phase::Release
            && self.elapsed >= self.release_duration() + SAFETY_SECONDS
            && self.correction_left == 0
        {
            self.phase = Phase::Idle;
            return 0.0;
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f32 = 48_000.0;

    fn shape() -> [EnvelopePoint; 5] {
        [
            (0.01, 0.2),
            (0.03, 0.9),
            (0.05, 0.3),
            (0.08, 0.7),
            (0.10, 0.4),
        ]
        .map(|(time, level)| EnvelopePoint { time, level })
    }
    fn advance(envelope: &mut PointEnvelope, frames: usize) -> f32 {
        let mut value = 0.0;
        for _ in 0..frames {
            value = envelope.next(SR);
            assert!(value.is_finite() && (0.0..=1.0).contains(&value));
        }
        value
    }
    #[test]
    fn independently_visits_all_held_points_then_holds_s() {
        let points = shape();
        let mut envelope = PointEnvelope::new(points, SR);
        envelope.note_on(0.0, 0.0);
        let mut previous_frame = 0;
        for point in &points[..4] {
            let frame = (point.time * SR).round() as usize;
            assert!((advance(&mut envelope, frame - previous_frame) - point.level).abs() < 1.0e-5);
            previous_frame = frame;
        }
        assert!((advance(&mut envelope, 48000) - points[3].level).abs() < 1.0e-6);
        assert!(envelope.is_active());
    }
    #[test]
    fn release_from_every_stage_reaches_r_then_finishes_even_with_nonzero_r() {
        for held_frames in [0, 120, 480, 1200, 2400, 4800] {
            let mut envelope = PointEnvelope::new(shape(), SR);
            envelope.note_on(0.0, 0.0);
            let current = advance(&mut envelope, held_frames);
            envelope.note_off(current);
            let next = envelope.next(SR);
            assert!((next - current).abs() <= 1.0 / 960.0);
            assert!((advance(&mut envelope, 959) - 0.4).abs() < 1.0e-5);
            assert!(advance(&mut envelope, 241) < 1.0e-6);
            assert!(!envelope.is_active());
            assert_eq!(advance(&mut envelope, 100), 0.0);
        }
    }
    #[test]
    fn live_edits_keep_time_and_smooth_the_level_without_retriggering() {
        let mut envelope = PointEnvelope::new(shape(), SR);
        envelope.note_on(0.0, 0.0);
        let current = advance(&mut envelope, 4800);
        let elapsed = envelope.elapsed;
        let points = shape().map(|point| EnvelopePoint {
            level: 1.0 - point.level,
            ..point
        });
        envelope.update(points, current);
        assert_eq!(envelope.elapsed, elapsed);
        let first = envelope.next(SR);
        assert!((first - current).abs() < 0.005);
        assert!((advance(&mut envelope, 240) - 0.3).abs() < 1.0e-6);
        // Reapplying identical settings cannot perpetually delay a transition.
        for _ in 0..300 {
            let current = envelope.next(SR);
            envelope.update(points, current);
        }
        assert_eq!(envelope.correction_left, 0);
    }
    #[test]
    fn live_release_retiming_is_continuous_and_always_finishes() {
        for release_time in [0.081, 0.18] {
            let mut envelope = PointEnvelope::new(shape(), SR);
            envelope.note_on(0.0, 0.0);
            let current = advance(&mut envelope, 4800);
            envelope.note_off(current);
            let current = advance(&mut envelope, 480);
            let elapsed = envelope.elapsed;
            let mut edited = shape();
            edited[4] = EnvelopePoint {
                time: release_time,
                level: 0.8,
            };
            envelope.update(edited, current);
            assert_eq!(envelope.elapsed, elapsed);
            assert!((envelope.next(SR) - current).abs() < 0.005);
            assert_eq!(advance(&mut envelope, 9600), 0.0);
            assert!(!envelope.is_active());
        }
    }
    #[test]
    fn positive_t_is_an_initial_ramp_from_zero_not_a_discontinuity() {
        let mut envelope = PointEnvelope::new(shape(), SR);
        envelope.note_on(0.0, 0.0);
        assert!((advance(&mut envelope, 240) - 0.1).abs() < 1.0e-6);
        assert!((advance(&mut envelope, 240) - 0.2).abs() < 1.0e-6);
    }
    #[test]
    fn nonzero_origin_gets_onset_safety_and_retrigger_remains_continuous() {
        let points = [
            (0.0, 1.0),
            (0.02, 1.0),
            (0.04, 1.0),
            (0.06, 1.0),
            (0.08, 0.0),
        ]
        .map(|(time, level)| EnvelopePoint { time, level });
        let mut envelope = PointEnvelope::new(points, SR);
        envelope.note_on(0.0, 0.0);
        assert!(envelope.next(SR) < 0.005);
        assert_eq!(advance(&mut envelope, 239), 1.0);
        envelope.note_on(0.7, 0.0);
        assert!((envelope.next(SR) - 0.7).abs() < 0.005);
    }
    #[test]
    fn hostile_nodes_are_finite_ordered_and_bounded_without_level_linking() {
        let shapes = [
            [(f32::NAN, f32::NAN); 5],
            [(f32::INFINITY, f32::NEG_INFINITY); 5],
            [
                (1.0e20, 2.0),
                (-20.0, -3.0),
                (64.0, 0.3),
                (64.0, 0.8),
                (0.0, 0.2),
            ],
        ];
        for shape in shapes {
            let points =
                sanitize_envelope_points(shape.map(|(time, level)| EnvelopePoint { time, level }));
            for (index, point) in points.iter().enumerate() {
                assert!(point.time.is_finite() && (0.0..=64.0).contains(&point.time));
                assert!(point.level.is_finite() && (0.0..=1.0).contains(&point.level));
                if index > 0 {
                    assert!(point.time - points[index - 1].time >= 0.000995);
                }
            }
        }
    }
    #[test]
    fn longest_release_and_edits_at_its_end_always_finish() {
        let points = [
            (0.0, 1.0),
            (0.001, 1.0),
            (0.002, 1.0),
            (0.003, 1.0),
            (64.0, 1.0),
        ]
        .map(|(time, level)| EnvelopePoint { time, level });
        let mut envelope = PointEnvelope::new(points, 8_000.0);
        envelope.note_on(0.0, 0.0);
        for _ in 0..100 {
            envelope.next(8_000.0);
        }
        envelope.note_off(1.0);
        for _ in 0..512_001 {
            envelope.next(8_000.0);
        }
        let current = envelope.next(8_000.0);
        let edited = points.map(|point| EnvelopePoint {
            level: point.level * 0.2,
            ..point
        });
        envelope.update(edited, current);
        for _ in 0..80 {
            assert!(envelope.next(8_000.0).is_finite());
        }
        assert!(!envelope.is_active());
        assert_eq!(envelope.next(8_000.0), 0.0);
    }
}
