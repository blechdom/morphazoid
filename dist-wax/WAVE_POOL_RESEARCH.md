# Wave Pool physical-model notes

Wave Pool is a sample-free musical reduction of an artificial wave basin. It does not treat a smooth visible gravity wave as broadband audio. The gravity wave is the slow control process; audible energy is emitted when machinery changes pressure, water breaks, drops strike the surface, air is entrained, a wave loads a boundary, a panel vibrates, or an aerated vortex forms.

## Causal model

```text
piston / pneumatic caisson
  -> gravity-wave scheduler and shallow-water travel
  -> breaking test
     -> contact pulse + spray cloud
     -> delayed, Minnaert-informed bubble bank
  -> wall arrival
     -> hydrodynamic slap
     -> trapped-air pocket
     -> wet boundary reflection + brief structural trace

circulation / drain jet
  -> filtered shear flow
  -> entrained-air gurgles and bubble events

all acoustic sources
  -> listener position filter
  -> DC block + bounded speaker monitor
```

The model keeps gravity-wave travel (usually seconds across the playable basin) separate from acoustic return time in water (milliseconds). Changing rhythm rate therefore does not retune bubble or wall modes.

## Artificial wave generation

Two generator types are represented:

- **Hydraulic piston bank:** a driven stroke launches the surge and a quieter return stroke follows. Real wave tanks use hydraulic actuation and piston or paddle motion; the instrument reduces the motor, cylinder, linkage, and paddle to a bounded mechanical transient.
- **Pneumatic caissons:** a valve and blower pressurize one or more chambers above the waterline. Water displaced through submerged passages launches the wave. Side-by-side chambers and their phase offsets create different rhythmic patterns.

The gravity-wave layer uses the linear dispersion relationship

`omega^2 = g k tanh(k h)`

with the shallow-water estimate `c = sqrt(g h)` used as a stable real-time guide. The user-facing wave height is bounded below `0.78 h`; the model then derives a continuous breaker severity rather than asserting that one threshold fits every pool shape and slope.

## Breaking, splashes, and bubbles

A splash contact produces a broadband pressure pulse followed by overlapping turbulence, foam, and spray. Only a subset of drop impacts traps air, so bubble events are delayed and probabilistic rather than attached to every droplet.

For an isolated, nearly spherical bubble, the starting estimate is the Minnaert relationship

`f = (1 / (2 pi r)) sqrt(3 gamma P / rho)`

where `r` is bubble radius, `P` ambient pressure, `rho` water density, and `gamma` the gas heat-capacity ratio. Near surface pressure, a 1 mm-radius bubble is approximately 3.26 kHz. The instrument uses that value as the statistical center of a fixed pool of short, chirped, noisy pressure grains with varied radius, phase, roughness, and delay. It labels the result *Minnaert-informed* because walls, the free surface, cloud interaction, surface tension, shape, and damping move real resonances; a bubble cloud is not rendered as a bank of clean notes.

## Water against boundaries

The boundary stage is split into four parts:

1. hydrodynamic impulse;
2. trapped-air compression or cushioning;
3. water-to-boundary pressure reflection;
4. a very quiet, rapidly damped structural trace.

The normal-incidence pressure estimate is `R = (Z_boundary - Z_water) / (Z_boundary + Z_water)`. This gives the presets an ordered reflective character, but material does not specify a musical note by itself. Panel dimensions, thickness, supports, wet loading, trapped air, and impact location all matter, so the UI calls these **wet boundaries** and exposes structure bleed plus water loading/damping. At zero structure bleed, the boundary remains an unpitched water-pressure and spray event.

## Whirlpool and drain sound

The vortex source is a low, colored shear-flow bed with slowly rotating stereo position. Aeration adds intermittent bubbles and gurgle-like pressure events. Ordinary visible whirlpool bubbles are treated as entrained air; cavitation is not assumed or enabled by default. Drain-vortex measurements are useful evidence for topology—surface dip, air-core neck, detached bubble, bubbly/slug flow—but their measured event rates are not presented as universal pool values.

## Playable bounds

The browser model deliberately uses compact instrument ranges rather than claiming to cover every commercial pool:

- water depth: 0.5–3 m;
- gravity-wave period: 1.5–8 s;
- wave height: 0.05–1.2 m, additionally bounded by depth;
- basin width: 8–40 m;
- one to eight independently phased generator chambers;
- bubble radii mapped roughly across sub-millimetre to centimetre scale, then clamped to a useful speaker band;
- conservative default master level: 30%;
- deterministic fixed event pools and a hard DSP ceiling.

## Primary and technical sources

- U.S. Army/NOAA-hosted wave-tank reports describe hydraulic piston/paddle wave generation: [NOAA 46717](https://repository.library.noaa.gov/view/noaa/46717/noaa_46717_DS1.pdf), [NOAA 46932](https://repository.library.noaa.gov/view/noaa/46932/noaa_46932_DS1.pdf), and [NOAA 40201](https://repository.library.noaa.gov/view/noaa/40201/noaa_40201_DS1.pdf).
- The pneumatic-caisson topology and independently valved chambers follow [U.S. Patent 4,730,355](https://patents.google.com/patent/US4730355A/en).
- Oguz and Prosperetti connect restricted drop-impact regimes, air entrainment, and underwater sound in [*Bubble entrainment by the impact of drops on liquid surfaces*](https://doi.org/10.1017/S0022112090002890).
- Melville reviews breaking-wave dynamics and the importance of bubble resonance to breaking-wave sound in [*The Role of Surface-Wave Breaking in Air-Sea Interaction*](https://airsea.ucsd.edu/wp-content/uploads/sites/10/2019/06/1996_Melville-ANNUAL_REVIEW_OF_FLUID_MECHANICS_vol_28.pdf).
- Crighton and Ffowcs Williams analyze the strong monopole contribution of bubbles in turbulent two-phase flow in [*Sound generation by turbulent two-phase flow*](https://doi.org/10.1017/S0022112069001868).
- Ahmed and Lim document air-core and bubble formation in a plughole vortex in [*Study of air-core vortical flow structure induced by a plughole vortex*](https://doi.org/10.1017/jfm.2017.329).
- Hu and Li separate air-pocket pressure oscillations from structural response in [*Breaking wave impacts on an elastic plate*](https://doi.org/10.1017/jfm.2025.10397).
- A NIST impact-echo report tabulates representative acoustic impedances for water, concrete, and steel: [NBSIR 86-3452](https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nbsir86-3452.pdf).

These relationships constrain topology and parameter direction. The result remains an expressive real-time instrument, not an engineering predictor for pool safety, structural loading, or sound-pressure level.
