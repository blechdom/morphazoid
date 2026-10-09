//! Allocation-free device capacity search. Successful probes are retained;
//! failed probes roll back and are retried, never becoming permanent ceilings.
pub struct Adaptive {
    sample_rate: f64,
    maximum: usize,
    demand: usize,
    limit: usize,
    mean: f64,
    peak: f64,
    initialized: bool,
    stable_frames: usize,
    cooldown_frames: usize,
    last_good: usize,
    measured_limit: usize,
    trial_frames: usize,
    trial: bool,
    restored_trial: bool,
    retry_step: usize,
    retirement_frames: usize,
    recovery_load: f64,
    jitter_margin: f64,
    maintenance_recovery: bool,
}
impl Adaptive {
    pub fn new(sample_rate: u32, max_limit: usize) -> Self {
        let maximum = max_limit.max(1);
        let limit = 48.min(maximum);
        Self {
            sample_rate: f64::from(sample_rate.max(1)),
            maximum,
            demand: maximum,
            limit,
            mean: 0.,
            peak: 0.,
            initialized: false,
            stable_frames: 0,
            cooldown_frames: 0,
            last_good: limit,
            measured_limit: 0,
            trial_frames: 0,
            trial: false,
            restored_trial: false,
            retry_step: 0,
            retirement_frames: 0,
            recovery_load: 0.,
            jitter_margin: 0.,
            maintenance_recovery: false,
        }
    }
    pub fn limit(&self) -> usize {
        self.limit
    }
    pub fn measured_limit(&self) -> usize {
        self.measured_limit
    }
    pub fn set_capacity(&mut self, capacity: usize) {
        self.maximum = capacity.max(1);
    }
    pub fn start_at_measured_limit(&mut self, limit: usize) {
        self.limit = limit.max(1).min(self.demand).min(self.maximum);
        self.last_good = self.limit;
        self.measured_limit = self.limit;
        self.trial = false;
        self.restored_trial = false;
        self.stable_frames = 0;
    }
    /// A separate cold DSP benchmark can prove more work than the first scene
    /// contains. Retain that proof while clamping current admission to demand.
    pub fn seed_measured_capacity(&mut self, limit: usize) {
        if limit == 0 {
            return;
        }
        self.start_at_measured_limit(limit);
        self.measured_limit = limit;
    }
    pub fn set_demand(&mut self, demand: usize) {
        let previous_demand = self.demand;
        self.demand = demand.min(self.maximum);
        self.limit = self.limit.min(self.demand);
        self.last_good = self.last_good.min(self.limit);
        if self.demand == 0 {
            self.stable_frames = 0;
            self.trial = false;
            self.restored_trial = false;
        } else if self.limit == 0 {
            self.limit = 48.min(self.demand);
            self.last_good = self.limit;
        }
        // A small scene is not evidence that this device lost its measured
        // capacity. Restore proved work promptly and validate it again under
        // the current scheduling load; a missed deadline still rolls it back.
        let restored = self.measured_limit.min(self.demand);
        if self.demand > previous_demand && restored > self.limit && self.cooldown_frames == 0 {
            self.last_good = self.limit;
            self.limit = restored;
            self.trial = true;
            self.restored_trial = true;
            self.trial_frames = 0;
            self.stable_frames = 0;
        }
    }
    #[cfg(test)]
    fn observe(&mut self, process_seconds: f64, frames: usize, underrun: bool) -> Option<usize> {
        self.observe_active(process_seconds, frames, underrun, self.limit, self.limit)
    }
    pub fn observe_active(
        &mut self,
        process_seconds: f64,
        frames: usize,
        underrun: bool,
        active: usize,
        target: usize,
    ) -> Option<usize> {
        self.observe_active_with_maintenance(process_seconds, 0., frames, underrun, active, target)
    }
    /// Topology preparation consumes real deadline time, but does not prove
    /// that each rendered voice became more expensive. Protect the current
    /// block while retaining previously measured capacity for revalidation.
    pub fn observe_active_with_maintenance(
        &mut self,
        process_seconds: f64,
        maintenance_seconds: f64,
        frames: usize,
        underrun: bool,
        active: usize,
        target: usize,
    ) -> Option<usize> {
        if frames == 0 || self.demand == 0 {
            return None;
        }
        let duration = frames as f64 / self.sample_rate;
        let load = if process_seconds.is_finite() && process_seconds >= 0. {
            process_seconds / duration
        } else {
            2.
        };
        let maintenance = if maintenance_seconds.is_finite() && maintenance_seconds > 0. {
            (maintenance_seconds / duration).min(load)
        } else {
            0.
        };
        let recurring_load = load - maintenance;
        if self.initialized {
            self.mean += (recurring_load - self.mean) * (1. - (-duration / 0.12).exp());
            self.peak = recurring_load.max(self.peak * (-duration / 0.25).exp());
        } else {
            self.mean = recurring_load;
            self.peak = recurring_load;
            self.initialized = true;
        }
        self.cooldown_frames = self.cooldown_frames.saturating_sub(frames);
        self.retirement_frames = self.retirement_frames.saturating_sub(frames);
        // Learn transient scheduling cost; it decays so extra capacity remains
        // discoverable when other activity on the device subsides.
        self.jitter_margin = (recurring_load - self.mean)
            .max(0.)
            .max(self.jitter_margin * (-duration / 3.).exp());
        let releasing = self.retirement_frames > 0
            && active > target
            && load <= self.recovery_load * 1.15
            && !underrun;
        let old = self.limit;
        // One rejected probe may leave outgoing voices processing for several
        // blocks. Allow that fade to retire before judging the lower target.
        // The first severe overload still cuts immediately. The same outgoing
        // DSP workload must not repeatedly reduce an unrealized lower target;
        // worsening load and output underruns still bypass this bounded grace.
        if !releasing
            && (underrun || load >= 1. || (self.mean >= 0.95 && self.cooldown_frames == 0))
        {
            let failed_step = self.limit.saturating_sub(self.last_good).max(1);
            self.limit = if self.trial
                && !self.restored_trial
                && self.last_good < self.limit
                && load < 1.5
                && !underrun
            {
                self.last_good.max(1)
            } else {
                ((self.limit as f64 * (0.85 / load.max(self.mean).max(1.)).min(0.9)).floor()
                    as usize)
                    .max(1)
            }
            .min(self.demand);
            self.last_good = self.limit;
            let transient =
                maintenance > 0. && recurring_load < 1. && self.mean < 0.95 && !underrun;
            if transient {
                self.maintenance_recovery = true;
            } else {
                self.measured_limit = self.measured_limit.min(self.limit);
                self.maintenance_recovery = false;
            }
            self.trial = false;
            self.restored_trial = false;
            self.retry_step = (failed_step / 2).max(1);
            self.stable_frames = 0;
            self.cooldown_frames =
                (self.sample_rate * if transient { 0.06 } else { 1.5 }).round() as usize;
            self.retirement_frames = (self.sample_rate * 0.6).round() as usize;
            self.recovery_load = load.max(self.mean).max(1.);
        } else if maintenance == 0.
            && self.cooldown_frames == 0
            && self.mean + self.jitter_margin < 0.95
            && self.peak < 0.995
        {
            if self.trial {
                self.trial_frames = self.trial_frames.saturating_add(frames);
                if self.trial_frames >= (self.sample_rate * 0.18).round() as usize {
                    self.last_good = self.limit;
                    self.measured_limit = self.measured_limit.max(self.limit);
                    self.trial = false;
                    self.restored_trial = false;
                    self.retry_step = 0;
                    self.stable_frames = 0;
                }
            } else {
                self.stable_frames = self.stable_frames.saturating_add(frames);
                let warmup = if self.measured_limit == 0 { 0.3 } else { 0.06 };
                if self.stable_frames >= (self.sample_rate * warmup).round() as usize {
                    // Fully satisfied small scenes still provide real device
                    // evidence. Candidate admission is the separate operation.
                    self.measured_limit = self.measured_limit.max(self.limit);
                    if self.limit < self.demand {
                        // Extrapolating complete callback cost per admitted voice
                        // overestimates the slope because it includes fixed input
                        // and mastering work. Spend only 80% of measured headroom,
                        // then validate the actual candidate instead of walking
                        // through every generation in fixed 25% increments.
                        let sizing_load = self.mean.max(recurring_load).max(0.01);
                        let headroom = (0.95 - sizing_load - self.jitter_margin).max(0.);
                        let headroom_step =
                            (self.limit as f64 * headroom / sizing_load * 0.8) as usize;
                        let restored = self.measured_limit.min(self.demand);
                        let restoring = self.maintenance_recovery && restored > self.limit;
                        let step = if restoring {
                            restored - self.limit
                        } else if self.retry_step > 0 {
                            self.retry_step.min(headroom_step.max(1))
                        } else {
                            headroom_step.max(1)
                        };
                        self.last_good = self.limit;
                        self.limit = self
                            .limit
                            .saturating_add(step)
                            .min(self.demand)
                            .min(self.maximum);
                        self.trial = true;
                        self.restored_trial = restoring;
                        self.trial_frames = 0;
                        self.stable_frames = 0;
                        self.maintenance_recovery = false;
                    }
                }
            }
        } else {
            self.stable_frames = 0;
        }
        (self.limit != old).then_some(self.limit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cold_capacity_proof_survives_a_small_pool_and_revalidates_larger_demand() {
        let mut controller = Adaptive::new(48000, 14);
        controller.set_demand(14);
        controller.seed_measured_capacity(1024);
        assert_eq!(controller.limit(), 14);
        assert_eq!(controller.measured_limit(), 1024);
        controller.set_capacity(2048);
        controller.set_demand(1500);
        assert_eq!(controller.limit(), 1024);
        controller.observe(2. * 128. / 48000., 128, false);
        assert!(controller.limit() < 1024);
        assert_eq!(controller.measured_limit(), controller.limit());
    }
    fn observe_load(controller: &mut Adaptive, load: f64, blocks: usize) {
        for _ in 0..blocks {
            controller.observe(load * 128. / 48_000., 128, false);
        }
    }
    #[test]
    fn one_off_topology_cost_preserves_proved_capacity_and_restores_it_promptly() {
        let mut controller = Adaptive::new(48000, 20000);
        controller.start_at_measured_limit(6000);
        controller.set_demand(2);
        observe_load(&mut controller, 0.03, 200);
        controller.set_demand(16382);
        assert_eq!(controller.limit(), 6000);
        let quantum = 128. / 48000.;
        controller.observe_active_with_maintenance(
            1.1 * quantum,
            1.07 * quantum,
            128,
            false,
            2,
            6000,
        );
        assert!(
            controller.limit() > 4000 && controller.limit() < 6000,
            "unsafe restored work uses proportional backoff, not the tiny old scene"
        );
        assert_eq!(
            controller.measured_limit(),
            6000,
            "one-off preparation is not evidence of a slower device"
        );
        let mut restored_at = None;
        for block in 0..150 {
            controller.observe_active(0.03 * quantum, 128, false, 2, controller.limit());
            if controller.limit() >= 6000 {
                restored_at = Some((block + 1) as f64 * quantum);
                break;
            }
        }
        assert!(
            restored_at.unwrap() < 0.2,
            "proved capacity returns without walking each generation"
        );
        assert!(
            controller.trial,
            "restoration must validate the current audio workload"
        );
        controller.observe_active(1.1 * quantum, 128, false, 6000, 6000);
        assert!(controller.limit() < 6000);
        assert_eq!(
            controller.measured_limit(),
            controller.limit(),
            "true DSP overload invalidates old proof"
        );
    }

    #[test]
    fn maintenance_does_not_manufacture_capacity_proof_or_hide_recurring_overload() {
        let mut controller = Adaptive::new(48000, 20000);
        let quantum = 128. / 48000.;
        for _ in 0..400 {
            controller.observe_active_with_maintenance(
                0.7 * quantum,
                0.2 * quantum,
                128,
                false,
                48,
                48,
            );
        }
        assert_eq!(controller.limit(), 48);
        assert_eq!(
            controller.measured_limit(),
            0,
            "preparation blocks cannot approve an unvalidated candidate"
        );
        controller.start_at_measured_limit(6000);
        controller.observe_active_with_maintenance(
            1.3 * quantum,
            0.2 * quantum,
            128,
            false,
            6000,
            6000,
        );
        assert!(controller.limit() < 6000);
        assert_eq!(
            controller.measured_limit(),
            controller.limit(),
            "recurring audio cost itself missed the deadline"
        );
        controller.start_at_measured_limit(6000);
        controller.observe_active_with_maintenance(
            0.7 * quantum,
            0.2 * quantum,
            128,
            true,
            6000,
            6000,
        );
        assert!(controller.limit() < 6000);
        assert_eq!(
            controller.measured_limit(),
            controller.limit(),
            "actual underruns always invalidate unsafe proof"
        );
    }
    #[test]
    fn outgoing_fades_do_not_trigger_repeated_reductions() {
        let mut controller = Adaptive::new(48000, 2000);
        controller.start_at_measured_limit(1000);
        controller.last_good = 1000;
        controller.limit = 1100;
        controller.trial = true;
        controller.observe_active(1.05 * 128. / 48000., 128, false, 1100, 1100);
        assert_eq!(controller.limit(), 1000);
        for _ in 0..80 {
            controller.observe_active(1.05 * 128. / 48000., 128, false, 1100, 1000);
        }
        assert_eq!(
            controller.limit(),
            1000,
            "The same retiring workload is one rejected probe"
        );
        controller.observe_active(1.05 * 128. / 48000., 128, false, 1000, 1000);
        assert!(
            controller.limit() < 1000,
            "A lower target that still overloads must cut"
        );
        let cut = controller.limit();
        controller.observe_active(2. * 128. / 48000., 128, false, 1100, cut);
        assert!(
            controller.limit() < cut,
            "Severe overload bypasses retirement grace"
        );
        let cut = controller.limit();
        controller.observe_active(0.9 * 128. / 48000., 128, true, 1100, cut);
        assert!(
            controller.limit() < cut,
            "Output underruns bypass retirement grace"
        );
    }

    #[test]
    fn unchanged_severe_outgoing_workload_is_one_reduction_not_a_cascade() {
        let mut controller = Adaptive::new(48000, 2000);
        controller.start_at_measured_limit(1000);
        let quantum = 128. / 48000.;
        let first = controller.observe_active(2. * quantum, 128, false, 1000, 1000);
        assert_eq!(
            first,
            Some(425),
            "the initial severe overload cuts immediately"
        );
        assert_eq!(controller.measured_limit(), 425);
        for _ in 0..80 {
            assert_eq!(
                controller.observe_active(2. * quantum, 128, false, 1000, 425),
                None,
                "the original 1000 voices are still rendering their release"
            );
        }
        assert_eq!(controller.limit(), 425);
        assert_eq!(
            controller.measured_limit(),
            425,
            "the same unreduced workload cannot invalidate proof repeatedly to one voice"
        );
        controller.observe_active(2. * quantum, 128, false, 425, 425);
        assert!(
            controller.limit() < 425,
            "overload measured after the smaller workload is actually installed is new evidence"
        );
    }

    #[test]
    fn worsening_severe_load_and_real_underruns_bypass_outgoing_grace() {
        for underrun in [false, true] {
            let mut controller = Adaptive::new(48000, 2000);
            controller.start_at_measured_limit(1000);
            let quantum = 128. / 48000.;
            controller.observe_active(2. * quantum, 128, false, 1000, 1000);
            let first = controller.limit();
            let load = if underrun { 0.7 } else { 2.4 };
            controller.observe_active(load * quantum, 128, underrun, 1000, first);
            assert!(controller.limit() < first,
                "a real underrun or worsening load must reduce the target without waiting on old tails");
            assert_eq!(controller.measured_limit(), controller.limit());
        }
    }

    #[test]
    fn outgoing_grace_expires_even_if_the_reported_active_count_never_retires() {
        let mut controller = Adaptive::new(48000, 2000);
        controller.start_at_measured_limit(1000);
        let frames = 4096;
        let quantum = frames as f64 / 48000.;
        controller.observe_active(2. * quantum, frames, false, 1000, 1000);
        let first = controller.limit();
        for _ in 0..7 {
            controller.observe_active(2. * quantum, frames, false, 1000, first);
            assert_eq!(controller.limit(), first);
        }
        controller.observe_active(2. * quantum, frames, false, 1000, first);
        assert!(controller.limit() < first,
            "retirement grace is bounded in audio frames and cannot hide sustained overload indefinitely");
    }

    #[test]
    fn severe_finite_preparation_keeps_proof_and_revalidates_after_outgoing_tails() {
        let mut controller = Adaptive::new(48000, 2000);
        controller.start_at_measured_limit(1000);
        let quantum = 128. / 48000.;
        controller.observe_active_with_maintenance(
            4. * quantum,
            3.5 * quantum,
            128,
            false,
            1000,
            1000,
        );
        let reduced = controller.limit();
        assert!(
            reduced < 1000,
            "total deadline pressure still reduces the target immediately"
        );
        for _ in 0..40 {
            controller.observe_active_with_maintenance(
                4. * quantum,
                3.5 * quantum,
                128,
                false,
                1000,
                reduced,
            );
        }
        assert_eq!(
            controller.limit(),
            reduced,
            "unchanged finite preparation cannot repeatedly reduce the same outgoing workload"
        );
        assert_eq!(
            controller.measured_limit(),
            1000,
            "finite work does not disprove the previously measured recurring voice cost"
        );
        let mut restored = false;
        for _ in 0..80 {
            controller.observe_active(0.5 * quantum, 128, false, reduced, controller.limit());
            if controller.limit() >= 1000 {
                restored = true;
                break;
            }
        }
        assert!(
            restored,
            "headroom reopens after finite preparation finishes"
        );
        assert!(
            controller.trial,
            "restoration still needs real callback validation"
        );
        controller.observe_active(
            2. * quantum,
            128,
            false,
            controller.limit(),
            controller.limit(),
        );
        assert!(
            controller.limit() < 1000,
            "a restored workload that genuinely overloads is rejected immediately"
        );
        assert_eq!(controller.measured_limit(), controller.limit());
    }

    #[test]
    fn mean_overload_settles_without_repeated_cuts_but_actual_misses_override() {
        let mut controller = Adaptive::new(48000, 1000);
        controller.observe(0.96 * 128. / 48000., 128, false);
        let cut = controller.limit();
        for _ in 0..10 {
            controller.observe(0.85 * 128. / 48000., 128, false);
        }
        assert_eq!(controller.limit(), cut);
        controller.observe(1.1 * 128. / 48000., 128, false);
        assert!(controller.limit() < cut);
    }
    #[test]
    fn moderate_and_high_successful_loads_keep_exploring_capacity() {
        for load in [0.5, 0.7, 0.85, 0.93] {
            let mut controller = Adaptive::new(48000, 100000);
            observe_load(&mut controller, load, 48_000 / 128 * 12);
            assert!(controller.limit() > 48, "No permanent plateau at {load}");
        }
    }
    #[test]
    fn failed_probe_retries_and_can_exceed_a_previous_device_limit() {
        let mut controller = Adaptive::new(48000, 100000);
        for _ in 0..48_000 / 128 * 45 {
            let load = controller.limit() as f64 / 400.;
            controller.observe(load * 128. / 48000., 128, false);
        }
        let previous = controller.limit();
        assert!(
            previous > 300 && previous <= 400,
            "Search should use available deadline capacity: {previous}"
        );
        for _ in 0..48_000 / 128 * 35 {
            let load = controller.limit() as f64 / 800.;
            controller.observe(load * 128. / 48000., 128, false);
        }
        assert!(controller.limit() > previous && controller.limit() > 600);
        controller.observe(2. * 128. / 48000., 128, false);
        let cut = controller.limit();
        controller.observe(2. * 128. / 48000., 128, false);
        assert!(
            controller.limit() < cut,
            "A missed deadline overrides settling cooldown"
        );
    }
    #[test]
    fn installed_capacity_can_grow_beyond_the_old_library_guard() {
        let mut controller = Adaptive::new(48000, 20000);
        controller.set_capacity(40000);
        controller.set_demand(40000);
        observe_load(&mut controller, 0.01, 48_000 / 128 * 35);
        assert_eq!(controller.limit(), 40000);
    }
    #[test]
    fn measured_low_load_uses_headroom_and_high_load_cuts_quickly() {
        let mut controller = Adaptive::new(48_000, 4096);
        assert_eq!(controller.limit(), 48);
        observe_load(&mut controller, 0.15, 100);
        assert_eq!(controller.limit(), 48, "startup needs sustained evidence");
        observe_load(&mut controller, 0.15, 1000);
        assert_eq!(controller.limit(), 4096);
        let grown = controller.limit();
        assert!(controller
            .observe(1.1 * 128. / 48_000., 128, false)
            .is_some());
        assert!(controller.limit() < grown);
        let reduced = controller.limit();
        observe_load(&mut controller, 0.5, 30);
        assert_eq!(
            controller.limit(),
            reduced,
            "cooldown prevents rapid repeated cuts"
        );
        assert!(controller.observe(0., 128, true).is_some());
        assert!(controller.limit() < reduced);
    }
    #[test]
    fn ceiling_and_demand_are_bounded_and_midload_does_not_hunt() {
        let mut controller = Adaptive::new(48_000, 70);
        controller.set_demand(64);
        observe_load(&mut controller, 0.1, 3000);
        assert_eq!(controller.limit(), 64);
        observe_load(&mut controller, 0.5, 2000);
        assert_eq!(controller.limit(), 64);
        controller.set_demand(12);
        assert_eq!(controller.limit(), 12);
        controller.set_demand(0);
        assert_eq!(controller.limit(), 0);
        assert_eq!(controller.observe(f64::NAN, 128, true), None);
        controller.set_demand(500);
        assert_eq!(
            controller.limit(),
            64,
            "Previously proved capacity survives a small scene"
        );
        observe_load(&mut controller, 0.1, 4000);
        assert_eq!(controller.limit(), 70);
        assert_eq!(controller.observe(0., 0, false), None);
    }

    #[test]
    fn startup_does_not_walk_every_generation_when_measured_headroom_is_large() {
        let mut controller = Adaptive::new(48000, 16382);
        let mut first_full = None;
        for block in 0..48_000 / 128 * 3 {
            controller.observe(0.15 * 128. / 48000., 128, false);
            if controller.limit() == 16382 && first_full.is_none() {
                first_full = Some((block + 1) as f64 * 128. / 48000.);
            }
        }
        assert!(
            first_full.unwrap() < 1.2,
            "Low measured cost admits the requested tree promptly"
        );
        println!(
            "constant 15% callback load: full default-tree admission at {:.3}s",
            first_full.unwrap()
        );
        assert_eq!(controller.measured_limit(), 16382);
    }

    #[test]
    fn proportional_device_cost_settles_then_exploits_remaining_headroom() {
        let mut controller = Adaptive::new(48000, 16382);
        let mut early = 0;
        let mut misses = 0;
        for block in 0..48_000 / 128 * 20 {
            let load = 0.03 + controller.limit() as f64 / 8000.;
            misses += usize::from(load >= 1.);
            controller.observe(load * 128. / 48000., 128, false);
            if block == 48_000 / 128 * 3 - 1 {
                early = controller.limit();
            }
        }
        assert!(
            early > 5000,
            "Measured voice cost must make large useful trials: {early}"
        );
        assert!(
            controller.limit() > 7100 && controller.limit() < 7760,
            "Find actual deadline capacity: {}",
            controller.limit()
        );
        assert_eq!(
            misses, 0,
            "Conservative callback-cost extrapolation should not overshoot this linear device"
        );
        println!(
            "linear device: {early} voices at 3s; {} at 20s; {misses} missed deadlines",
            controller.limit()
        );
    }

    #[test]
    fn small_scene_keeps_proved_capacity_and_restores_it_as_a_validated_trial() {
        let mut controller = Adaptive::new(48000, 20000);
        controller.start_at_measured_limit(6000);
        controller.set_demand(63);
        observe_load(&mut controller, 0.02, 200);
        assert_eq!(controller.limit(), 63);
        assert_eq!(controller.measured_limit(), 6000);
        controller.set_demand(20000);
        assert_eq!(controller.limit(), 6000);
        assert!(
            controller.trial,
            "Restoration must measure the current device load again"
        );
        controller.observe(1.1 * 128. / 48000., 128, false);
        assert!(controller.limit() > 4000 && controller.limit() < 6000,
            "A restored budget uses measured proportional backoff rather than the tiny running scene");
        assert_eq!(controller.measured_limit(), controller.limit());
        observe_load(&mut controller, 0.01, 48_000 / 128 * 4);
        assert!(
            controller.limit() > 63,
            "A failed restoration is not a permanent ceiling"
        );
    }

    #[test]
    fn periodic_scheduling_jitter_is_reserved_then_device_recovery_reopens_headroom() {
        let mut controller = Adaptive::new(48000, 20000);
        for block in 0..48_000 / 128 * 15 {
            let jitter = if block % 375 < 5 { 0.25 } else { 0. };
            let load = 0.03 + controller.limit() as f64 / 8000. + jitter;
            controller.observe(load * 128. / 48000., 128, false);
        }
        let with_jitter = controller.limit();
        assert!(with_jitter > 3000 && with_jitter < 7760);
        for _ in 0..48_000 / 128 * 15 {
            let load = 0.03 + controller.limit() as f64 / 8000.;
            controller.observe(load * 128. / 48000., 128, false);
        }
        assert!(
            controller.limit() > with_jitter,
            "Temporary jitter must not become a permanent voice cap"
        );
        assert!(controller.limit() > 7100 && controller.limit() < 7760);
    }

    #[test]
    fn satisfied_small_scenes_record_capacity_only_after_measured_startup_warmup() {
        for demand in [1, 2, 48] {
            let mut controller = Adaptive::new(48000, 20000);
            controller.set_demand(demand);
            observe_load(&mut controller, 0.15, 100);
            assert_eq!(controller.limit(), demand);
            assert_eq!(
                controller.measured_limit(),
                0,
                "Startup availability alone is not measured evidence"
            );
            observe_load(&mut controller, 0.15, 13);
            assert_eq!(controller.measured_limit(), demand);
        }
    }

    #[test]
    fn proposed_large_trial_is_not_approved_before_callback_validation() {
        let mut controller = Adaptive::new(48000, 20000);
        observe_load(&mut controller, 0.15, 113);
        assert!(controller.limit() > 48);
        assert_eq!(controller.measured_limit(), 48);
        observe_load(&mut controller, 0.15, 10);
        assert_eq!(
            controller.measured_limit(),
            48,
            "A candidate must complete its own validation window"
        );
        controller.observe(1.1 * 128. / 48000., 128, false);
        assert_eq!(controller.limit(), 48);
        assert_eq!(
            controller.measured_limit(),
            48,
            "A failed candidate never becomes proved capacity"
        );
    }

    #[test]
    fn proportional_cost_small_scene_restores_and_revalidates_previous_capacity() {
        let mut controller = Adaptive::new(48000, 16382);
        for _ in 0..48_000 / 128 * 8 {
            let load = 0.03 + controller.limit() as f64 / 8000.;
            controller.observe(load * 128. / 48000., 128, false);
        }
        let proved = controller.measured_limit();
        assert!(proved > 6000);
        controller.set_demand(2);
        observe_load(&mut controller, 0.03 + 2. / 8000., 750);
        assert_eq!(controller.measured_limit(), proved);
        controller.set_demand(16382);
        assert_eq!(controller.limit(), proved);
        for _ in 0..48_000 / 128 * 2 {
            let load = 0.03 + controller.limit() as f64 / 8000.;
            controller.observe(load * 128. / 48000., 128, false);
        }
        assert!(controller.limit() >= proved && controller.limit() < 7760);
        controller.observe(2. * 128. / 48000., 128, false);
        assert!(
            controller.limit() < proved,
            "A changed device or more expensive pitch workload invalidates old proof immediately"
        );
    }
}
