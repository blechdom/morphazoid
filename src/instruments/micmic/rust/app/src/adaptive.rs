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
    trial_frames: usize,
    trial: bool,
    retry_step: usize,
    retirement_frames: usize,
    recovery_load: f64,
    jitter_margin: f64,
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
            trial_frames: 0,
            trial: false,
            retry_step: 0,
            retirement_frames: 0,
            recovery_load: 0.,
            jitter_margin: 0.,
        }
    }
    pub fn limit(&self) -> usize {
        self.limit
    }
    pub fn set_capacity(&mut self, capacity: usize) {
        self.maximum = capacity.max(1);
    }
    pub fn start_at_measured_limit(&mut self, limit: usize) {
        self.limit = limit.max(1).min(self.demand).min(self.maximum);
        self.last_good = self.limit;
        self.trial = false;
        self.stable_frames = 0;
    }
    pub fn set_demand(&mut self, demand: usize) {
        self.demand = demand.min(self.maximum);
        self.limit = self.limit.min(self.demand);
        self.last_good = self.last_good.min(self.limit);
        if self.demand == 0 {
            self.stable_frames = 0;
            self.trial = false;
        } else if self.limit == 0 {
            self.limit = 48.min(self.demand);
            self.last_good = self.limit;
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
        if frames == 0 || self.demand == 0 {
            return None;
        }
        let duration = frames as f64 / self.sample_rate;
        let load = if process_seconds.is_finite() && process_seconds >= 0. {
            process_seconds / duration
        } else {
            2.
        };
        if self.initialized {
            self.mean += (load - self.mean) * (1. - (-duration / 0.12).exp());
            self.peak = load.max(self.peak * (-duration / 0.25).exp());
        } else {
            self.mean = load;
            self.peak = load;
            self.initialized = true;
        }
        self.cooldown_frames = self.cooldown_frames.saturating_sub(frames);
        self.retirement_frames = self.retirement_frames.saturating_sub(frames);
        // Learn transient scheduling cost; it decays so extra capacity remains
        // discoverable when other activity on the device subsides.
        self.jitter_margin = (load - self.mean)
            .max(0.)
            .max(self.jitter_margin * (-duration / 3.).exp());
        let releasing = self.retirement_frames > 0
            && active > target
            && load < 1.5
            && load <= self.recovery_load * 1.15
            && !underrun;
        let old = self.limit;
        // One rejected probe may leave outgoing voices processing for several
        // blocks. Allow that fade to retire before judging the lower target.
        // Severe or worsening overload and output underruns still cut at once.
        if !releasing
            && (underrun || load >= 1. || (self.mean >= 0.95 && self.cooldown_frames == 0))
        {
            let failed_step = self.limit.saturating_sub(self.last_good).max(1);
            self.limit = if self.trial && self.last_good < self.limit && load < 1.5 && !underrun {
                self.last_good.max(1)
            } else {
                ((self.limit as f64 * (0.85 / load.max(self.mean).max(1.)).min(0.9)).floor()
                    as usize)
                    .max(1)
            }
            .min(self.demand);
            self.last_good = self.limit;
            self.trial = false;
            self.retry_step = (failed_step / 2).max(1);
            self.stable_frames = 0;
            self.cooldown_frames = (self.sample_rate * 1.5).round() as usize;
            self.retirement_frames = (self.sample_rate * 0.6).round() as usize;
            self.recovery_load = load.max(self.mean).max(1.);
        } else if self.cooldown_frames == 0
            && self.mean + self.jitter_margin < 0.95
            && self.peak < 0.995
        {
            if self.trial {
                self.trial_frames = self.trial_frames.saturating_add(frames);
                if self.trial_frames >= (self.sample_rate * 0.6).round() as usize {
                    self.last_good = self.limit;
                    self.trial = false;
                    self.retry_step = 0;
                    self.stable_frames = 0;
                }
            } else {
                self.stable_frames = self.stable_frames.saturating_add(frames);
                if self.stable_frames >= (self.sample_rate * 0.3).round() as usize
                    && self.limit < self.demand
                {
                    let step = if self.retry_step > 0 {
                        self.retry_step
                    } else if self.mean < 0.45 {
                        (self.limit / 4).max(16)
                    } else if self.mean < 0.7 {
                        (self.limit / 10).max(4)
                    } else {
                        ((self.limit as f64
                            * ((0.95 - self.mean) / self.mean.max(0.01) * 0.35).clamp(0., 0.08))
                            as usize)
                            .max(1)
                    };
                    let headroom_step = ((self.limit as f64
                        * ((0.95 - self.mean - self.jitter_margin) / self.mean.max(0.01) * 0.35)
                            .clamp(0., 0.25)) as usize)
                        .max(1);
                    let step = step.min(headroom_step);
                    self.last_good = self.limit;
                    self.limit = self
                        .limit
                        .saturating_add(step)
                        .min(self.demand)
                        .min(self.maximum);
                    self.trial = true;
                    self.trial_frames = 0;
                    self.stable_frames = 0;
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
    fn observe_load(controller: &mut Adaptive, load: f64, blocks: usize) {
        for _ in 0..blocks {
            controller.observe(load * 128. / 48_000., 128, false);
        }
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
    fn measured_low_load_grows_slowly_and_high_load_cuts_quickly() {
        let mut controller = Adaptive::new(48_000, 4096);
        assert_eq!(controller.limit(), 48);
        observe_load(&mut controller, 0.15, 100);
        assert_eq!(controller.limit(), 48, "startup needs sustained evidence");
        observe_load(&mut controller, 0.15, 1000);
        assert!(controller.limit() > 48 && controller.limit() < 4096);
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
        assert_eq!(controller.limit(), 48);
        observe_load(&mut controller, 0.1, 4000);
        assert_eq!(controller.limit(), 70);
        assert_eq!(controller.observe(0., 0, false), None);
    }
}
