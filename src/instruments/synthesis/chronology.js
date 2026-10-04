/**
 * Selected historical anchors for the Synthesaurus methods.
 *
 * These are evidence-bearing milestones, not a uniform list of invention dates.
 * `dateKind` states what each date actually represents, while `dateNote` records
 * the scope limit that keeps the milestone from becoming an origin claim.
 */
const milestone = (dateLabel, dateKind, dateNote, label, url) => ({
  dateLabel,
  dateNote,
  dateKind,
  dateSource: { label, url }
});

export const SYNTHESIS_DATES = Object.freeze({
  "sampling": milestone(
    "1979",
    "commercial sampler milestone",
    "The Fairlight CMI appeared in 1979 with facilities for recording, storing and manipulating sound. This dates a documented commercial digital instrument, not sampling as a whole; tape-based sampling practices are substantially older.",
    "National Film and Sound Archive, Fairlight CMI history (1979)",
    "https://www.nfsa.gov.au/stories/articles/fairlight-instrument-invented-sampling"
  ),
  "wavetable": milestone(
    "1961",
    "computer-music publication",
    "Mathews's MUSIC III paper describes periodic waveforms read repeatedly from stored functions. This is an early digital table-lookup implementation, not the later scanning and interpolation meaning often attached to commercial wavetable synthesis.",
    "Mathews, An Acoustic Compiler for Music and Psychological Stimuli (1961)",
    "https://archive.org/download/bstj40-3-677/bstj40-3-677.pdf"
  ),
  "additive": milestone(
    "1969",
    "analysis-resynthesis publication",
    "Risset and Mathews published digital analysis and resynthesis with time-varying sinusoidal components in 1969. Additive summation and Fourier theory are much older, so the date belongs to this computer-music implementation.",
    "Risset & Mathews, Analysis of Musical-Instrument Tones (1969)",
    "https://doi.org/10.1063/1.3035399"
  ),
  "walsh": milestone(
    "1973",
    "music-device publication",
    "Hutchins described electronic music devices that use a complete orthonormal set of Walsh functions to generate periodic waveforms and envelopes. Walsh's mathematical functions date to 1923; 1973 dates the explicit music-synthesis devices.",
    "Hutchins, Experimental Electronic Music Devices Employing Walsh Functions (1973)",
    "https://aes.org/publications/elibrary-page/?id=1940"
  ),
  "multiple-wavetable": milestone(
    "1986",
    "commercial instrument milestone",
    "Sequential's Prophet VS introduced its named Vector Synthesis system for dynamically mixing four stored digital waveforms. Crossfading among tables predates the product, so 1986 is a close instrument milestone rather than the technique's universal origin.",
    "Sequential, Prophet VS contemporary advertisement (1986)",
    "https://www.worldradiohistory.com/Archive-All-Audio/Mix-Magazine/80s/86/Mix-1986-02.pdf"
  ),
  "wave-terrain": milestone(
    "1978",
    "early implementation publication",
    "Bischoff, Gold and Horton documented Rich Gold's two-variable, terrain-oriented synthesis work in a network of microcomputers. It is an early implementation milestone; the date does not establish when Wave Terrain became a settled category name.",
    "Bischoff, Gold & Horton, Music for an Interactive Network of Microcomputers (1978)",
    "https://doi.org/10.2307/3679453"
  ),
  "granular": milestone(
    "1978",
    "digital synthesis publication",
    "Roads published an automated computer implementation of granular synthesis in 1978. Gabor's 1946 time-frequency quanta remain an important theoretical precursor, but 1978 is the more direct musical-synthesis milestone.",
    "Roads, Automated Granular Synthesis of Sound (1978)",
    "https://doi.org/10.2307/3680222"
  ),
  "subtractive": milestone(
    "1964",
    "modular-system presentation",
    "Moog's voltage-controlled oscillator, filter and amplifier modules established a canonical electronic-instrument signal path. This AES presentation does not date the invention of filtering or every earlier subtractive practice; journal publication followed in 1965.",
    "Moog, Voltage-Controlled Electronic Music Modules (1964 AES preprint)",
    "https://www.moogfoundation.org/wp-content/uploads/AES-1964-No0320-Modules.pdf"
  ),
  "lpc": milestone(
    "1971",
    "analysis-synthesis publication",
    "Atal and Hanauer gave a direct speech analysis-and-synthesis account based on linear prediction. Predictive coding has earlier roots, but this is the canonical full LPC synthesis publication.",
    "Atal & Hanauer, Speech Analysis and Synthesis by Linear Prediction (1971)",
    "https://doi.org/10.1121/1.1912679"
  ),
  "am": milestone(
    "1961",
    "computer-music publication",
    "MUSIC III explicitly supported signal structures in which one unit generator amplitude-modulates another. Electrical and radio amplitude modulation long predates this early programmable audio-synthesis account.",
    "Mathews, An Acoustic Compiler for Music and Psychological Stimuli (1961)",
    "https://archive.org/download/bstj40-3-677/bstj40-3-677.pdf"
  ),
  "ring": milestone(
    "1970",
    "musical-instrument publication",
    "Oberheim documented a balanced ring-modulator device designed for performing musicians and reviewed its operating principle. Ring-modulator circuitry and studio practice were already established, so this is an instrument milestone rather than an invention claim.",
    "Oberheim, A Ring Modulator Device for the Performing Musician (1970)",
    "https://aes.org/publications/elibrary-page/?id=1304"
  ),
  "fm": milestone(
    "1967 / 1973",
    "development / publication",
    "John Chowning developed audio-rate digital FM's useful musical spectral behavior in 1967 and published the landmark description in 1973. Frequency modulation as a communications process is older.",
    "Chowning, The Synthesis of Complex Audio Spectra by Means of Frequency Modulation (1973)",
    "https://secure.aes.org/forum/pubs/journal/?elib=1954"
  ),
  "pm": milestone(
    "1973",
    "phase formulation publication",
    "Chowning's oscillator equation varies instantaneous phase and supplies a defensible musical phase-modulation formulation. Sinusoidal FM and PM are closely related and their terminology overlaps, so this is not a clean, separate PM invention date.",
    "Chowning, The Synthesis of Complex Audio Spectra by Means of Frequency Modulation (1973)",
    "https://secure.aes.org/forum/pubs/journal/?elib=1954"
  ),
  "phase-distortion": milestone(
    "1984",
    "commercial introduction",
    "Casio released the CZ-101 and CZ-1000 in November 1984 with its newly developed PD sound source. This dates Casio's named implementation rather than every earlier method that warps oscillator phase.",
    "Casio corporate history, CZ-101 and CZ-1000 (1984)",
    "https://world.casio.com/corporate/history/chapter02/"
  ),
  "waveshaping": milestone(
    "1979",
    "digital synthesis publication",
    "Le Brun presented digital waveshaping as a synthesis method built around nonlinear transfer functions. Analog nonlinear distortion and earlier transfer-function experiments predate this focused digital synthesis account.",
    "Le Brun, Digital Waveshaping Synthesis (1979)",
    "https://secure.aes.org/forum/pubs/journal/?elib=3212"
  ),
  "dsf": milestone(
    "1976",
    "synthesis publication",
    "Moorer introduced discrete summation formulas as an economical way to synthesize complex audio spectra. The trigonometric identities are older; 1976 dates their articulated musical-synthesis use.",
    "Moorer, The Synthesis of Complex Audio Spectra by Means of DSF (1976)",
    "https://aes.org/publications/elibrary-page/?id=2590"
  ),
  "physical": milestone(
    "1971",
    "early physical-model publication",
    "Hiller and Ruiz synthesized musical sounds by numerically solving wave equations for vibrating objects. It is an early computer physical-model milestone, not the origin of the equations or of every physical-model family.",
    "Hiller & Ruiz, Synthesizing Musical Sounds by Solving the Wave Equation (1971)",
    "https://aes.org/publications/elibrary-page/?id=2164"
  ),
  "modal": milestone(
    "1993",
    "framework publication",
    "Morrison and Adrien published MOSAIC as an integrated framework for modal synthesis. Modal analysis and individual resonator models are older, so 1993 is a framework milestone rather than the technique's invention.",
    "Morrison & Adrien, MOSAIC: A Framework for Modal Synthesis (1993)",
    "https://doi.org/10.2307/3680569"
  ),
  "waveguide": milestone(
    "1986",
    "musical implementation publication",
    "Smith's 1986 work applied digital waveguides directly to reed-bore and bow-string mechanisms. Acoustic-tube models and waveguide theory are older; the date marks an early musical-instrument implementation.",
    "Smith, historical account of digital-waveguide synthesis (1986 work)",
    "https://www.aes.org/technical/heyser/downloads/AES121heyser-Smith.pdf"
  ),
  "karplus-strong": milestone(
    "1978 / 1983",
    "development / publication",
    "Karplus and Strong report that the named plucked-string algorithm was developed in December 1978; its canonical paper appeared in 1983. The pair does not date all delay-loop or physical-model synthesis.",
    "Karplus & Strong, Digital Synthesis of Plucked-String and Drum Timbres (1983)",
    "https://doi.org/10.2307/3680062"
  ),
  "fof": milestone(
    "1984",
    "named technique publication",
    "Rodet's Formant-Wave-Function paper formally described the time-domain FOF technique. CHANT research and development began earlier, so 1984 is the direct publication milestone.",
    "Rodet, Time-Domain Formant-Wave-Function Synthesis (1984)",
    "https://doi.org/10.2307/3679809"
  ),
  "vosim": milestone(
    "1972 / 1978",
    "development / publication",
    "Kaegi's VOSIM research began in 1972, while Kaegi and Tempelaars published the named synthesis system in 1978. The paired date avoids turning a reported research start into a precisely established invention date.",
    "Kaegi & Tempelaars, VOSIM—A New Sound Synthesis System (1978)",
    "https://kaegi.nl/werner/userfiles/downloads/vosim-system.pdf"
  ),
  "window-formant": milestone(
    "1981",
    "mechanism publication",
    "Bass and Goeddel published the recurring windowed-pulse mechanism later classified as Window Function synthesis. Their title calls it efficient subtractive synthesis, so the date does not imply that the later category name was already settled.",
    "Bass & Goeddel, The Efficient Digital Implementation of Subtractive Music Synthesis (1981)",
    "https://doi.org/10.1109/MM.1981.290896"
  ),
  "waveform-segment": milestone(
    "1976",
    "direct precursor publication",
    "Bernstein and Cooper described direct waveform control through connected piecewise-linear breakpoints, closely matching this segment engine. Broader waveform-segment systems extended the idea, so 1976 is labeled as a precursor rather than an origin.",
    "Bernstein & Cooper, The Piecewise-Linear Technique of Electronic Music Synthesis (1976)",
    "https://aes.org/publications/elibrary-page/?id=2611"
  ),
  "graphic": milestone(
    "1977",
    "graphic synthesizer milestone",
    "The first complete UPIC prototype was finished in 1977 and enabled users to draw waveforms, envelopes and musical structures. Optical drawn sound and earlier computer-graphics experiments remain important precursors.",
    "Centre Iannis Xenakis, UPIC presentation (1977 prototype)",
    "https://www.centre-iannis-xenakis.org/cix_upic_presentation?lang=en"
  ),
  "noise-modulation": milestone(
    "1961",
    "computer-music publication",
    "MUSIC III included programmable random-signal generation with amplitude and frequency controls. Analog noise sources and modulation are older, and the paper does not originate all colored or correlated-noise methods.",
    "Mathews, An Acoustic Compiler for Music and Psychological Stimuli (1961)",
    "https://archive.org/download/bstj40-3-677/bstj40-3-677.pdf"
  ),
  "stochastic": milestone(
    "1991",
    "named implementation milestone",
    "Xenakis completed the GENDY program in 1991 and used dynamic stochastic synthesis for Gendy3. His probability-based proposals appeared earlier, so this dates a concrete named implementation and composition rather than stochastic music as a whole.",
    "Official Iannis Xenakis biography, GENDY and Gendy3 (1991)",
    "https://www.iannis-xenakis.org/en/biographie/"
  ),
  "pulsar": milestone(
    "1991",
    "named technique development",
    "Curtis Roads states that he developed pulsar synthesis in 1991 while composing Clang-Tint. This dates the named musical technique, not the older use of periodic impulses or windowed pulse trains; software and book accounts followed.",
    "Roads, The Path to Half-life (1991 development account)",
    "https://www.curtisroads.net/s/04-Path-to-Half-Life.pdf"
  ),
  "phase-vocoder": milestone(
    "1966",
    "publication",
    "Flanagan and Golden's paper describes analysis and reconstruction using channel amplitude and phase information. Later FFT implementations and musical time-stretching systems extend this speech-processing work.",
    "Nokia Bell Labs, Flanagan & Golden, Phase Vocoder (1966)",
    "https://www.nokia.com/bell-labs/publications-and-media/publications/phase-vocoder/"
  ),
  "scanned": milestone(
    "2000",
    "named technique publication",
    "Verplank, Mathews and Shaw named and explained scanned synthesis as a slowly evolving dynamical system scanned at audio rate. Their work was underway before publication, but 2000 is the precise primary-source publication milestone.",
    "Verplank, Mathews & Shaw, Scanned Synthesis (2000)",
    "https://peabody.sapp.org/class/st2/read/ScannedSynthesis.PDF"
  ),
  "corpus": milestone(
    "2000",
    "musical implementation publication",
    "Schwarz presented a data-driven concatenative sound-synthesis system in 2000. Concatenative speech synthesis is older; later real-time corpus instruments such as CataRT extend this musical implementation lineage.",
    "Schwarz, A System for Data-Driven Concatenative Sound Synthesis (2000)",
    "https://dafx.de/paper-archive/2000/pdf/Diemo_Schwarz_cussdafx.pdf"
  ),
  "padsynth": milestone(
    "2005",
    "named algorithm publication",
    "Nasca publicly documented the PADsynth algorithm in the ZynAddSubFX project in 2005. ZynAddSubFX itself began earlier, and later implementations do not change the named algorithm's publication date.",
    "Nasca, PADsynth algorithm (2005)",
    "https://zynaddsubfx.sourceforge.io/doc/PADsynth/PADsynth.htm"
  ),
  "vector-phase": milestone(
    "2011",
    "named technique publication",
    "Kleimola and colleagues published vector phaseshaping synthesis in 2011. Earlier phase-distortion methods are related precursors, not the same named formulation.",
    "Kleimola et al., Vector Phaseshaping Synthesis (2011)",
    "https://www.dafx.de/paper-archive/2011/Papers/55_e.pdf"
  ),
  "neural-ar": milestone(
    "2016",
    "family publication landmark",
    "WaveNet demonstrated autoregressive raw-waveform generation for speech and music in 2016. Neural sequence models and autoregression are older; this is a landmark for modern neural audio synthesis, not their invention.",
    "van den Oord et al., WaveNet (2016)",
    "https://arxiv.org/abs/1609.03499"
  ),
  "neural-latent": milestone(
    "2021",
    "family exemplar publication",
    "RAVE appeared as a preprint in 2021 and is a useful landmark for real-time neural synthesis in a learned audio latent space. Audio autoencoders predate it, and this compendium's compact model is not RAVE.",
    "Caillon & Esling, RAVE (2021)",
    "https://arxiv.org/abs/2111.05011"
  ),
  "ddsp": milestone(
    "2020",
    "named framework publication",
    "The DDSP paper formalized a framework that combines differentiable signal-processing elements with learned control. Differentiable optimization and each individual DSP component are older.",
    "Google Research, Engel et al., DDSP (2020)",
    "https://research.google/pubs/ddsp-differentiable-digital-signal-processing/"
  ),
  "diffusion": milestone(
    "2020",
    "audio-family preprint",
    "DiffWave appeared as a preprint in September 2020 and demonstrated diffusion-based raw-audio generation. Its formal ICLR publication was in 2021, while diffusion probabilistic models themselves are older.",
    "Kong et al., DiffWave (2020 preprint)",
    "https://arxiv.org/abs/2009.09761"
  ),
  "antialias-oscillator": milestone(
    "2010",
    "implementation reference",
    "Välimäki and colleagues published a strong reference for differentiated-polynomial-waveform oscillators. This demonstration also includes PolyBLEP and minBLEP, whose separate histories are not dated by the DPW paper.",
    "Välimäki et al., Alias-Suppressed Oscillators Based on DPW (2010)",
    "https://research.aalto.fi/en/publications/alias-suppressed-oscillators-based-on-differentiated-polynomial-w/"
  ),
  "antiderivative-waveshaping": milestone(
    "2016",
    "named method publication",
    "Parker, Zavalishin and Le Bivic introduced the continuous-time-convolution approach now generally called antiderivative antialiasing. Ordinary nonlinear waveshaping is substantially older.",
    "Parker, Zavalishin & Le Bivic, Reducing the Aliasing of Nonlinear Waveshaping (2016)",
    "https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf"
  ),
  "hard-sync": milestone(
    "1972",
    "early product implementation",
    "The original ARP Odyssey, introduced in 1972, included oscillator sync and supplies a defensible early commercial musical implementation. This does not claim that ARP invented synchronization; later work addresses alias-reduced digital hard sync.",
    "Korg, official ARP Odyssey history and oscillator-sync feature (1972)",
    "https://www.korg.com/in/products/synthesizers/arpodyssey/index.php"
  ),
  "single-sideband": milestone(
    "1965",
    "musical-audio publication",
    "Bode documented a solid-state audio-frequency spectrum shifter using sideband selection to translate every component by a fixed offset. Radio-frequency single-sideband modulation is older, and Bode built musical shifters before this publication.",
    "Bode, Solid State Audio Frequency Spectrum Shifter (1965)",
    "https://secure.aes.org/forum/pubs/journal/?elib=1045"
  ),
  "wavelet": milestone(
    "1988",
    "audio application publication",
    "Kronland-Martinet applied the wavelet transform to analysis, synthesis and processing of speech and musical sound. Wavelet mathematics has older precursors; 1988 dates a direct audio-synthesis milestone.",
    "Kronland-Martinet, The Wavelet Transform for Speech and Music Sounds (1988)",
    "https://doi.org/10.2307/3680149"
  ),
  "colored-noise": milestone(
    "1978",
    "musical study publication",
    "Voss and Clarke published a landmark study of 1/f behavior in music and of music generated from 1/f noise. It does not date the physical discovery of colored noise or the first electronic white- or pink-noise generator.",
    "Voss & Clarke, 1/f Noise in Music: Music from 1/f Noise (1978)",
    "https://doi.org/10.1121/1.381721"
  ),
  "particle-shaker": milestone(
    "1997",
    "family publication milestone",
    "Cook's PhISM paper documents physically informed stochastic collision and resonator models for percussive sounds, including shaker-like instruments. It is not the origin of particle dynamics or every collision model.",
    "Cook, Physically Informed Sonic Modeling (PhISM) (1997)",
    "https://doi.org/10.2307/3681012"
  ),
  "fdtd-membrane": milestone(
    "2009",
    "technical reference",
    "Bilbao gives a detailed finite-difference treatment of the two-dimensional wave equation and membrane simulation. FDTD methods and earlier musical string simulations predate the book, so this is deliberately a reference date rather than an invention claim.",
    "Bilbao, Numerical Sound Synthesis (2009)",
    "https://www.research.ed.ac.uk/en/publications/numerical-sound-synthesis-finite-difference-schemes-and-simulatio/"
  ),
  "fdn-resonator": milestone(
    "1982",
    "network implementation publication",
    "Stautner and Puckette described parallel delays coupled through a feedback matrix, a close published ancestor of the general feedback-delay network. Earlier reverberators exist; this compendium repurposes the network as an excited resonator.",
    "Stautner & Puckette, Designing Multi-Channel Reverberators (1982)",
    "https://www.ee.columbia.edu/~dpwe/papers/StautP82-reverb.pdf"
  ),
  "rossler": milestone(
    "1976",
    "mathematical precursor",
    "Rössler published this continuous chaotic system in 1976. The date belongs to the mathematical model, not its later mapping into audible oscillation or computer-music control.",
    "Rössler, An Equation for Continuous Chaos (1976)",
    "https://doi.org/10.1016/0375-9601(76)90101-8"
  ),
  "formant-voice": milestone(
    "1980",
    "speech-synthesis publication",
    "Klatt documented a software cascade/parallel formant synthesizer in 1980. Formant theory, vocoders and earlier speech synthesizers predate it; this compendium implements an educational subset rather than the complete system.",
    "Klatt, Software for a Cascade/Parallel Formant Synthesizer (1980)",
    "https://doi.org/10.1121/1.383940"
  ),
  "psg-pulse": milestone(
    "1979 / 1983",
    "hardware lineage",
    "General Instrument's February 1979 AY-3-8910 manual dates the stepped-envelope side of this hybrid, while Nintendo's 1983 Famicom dates its NES-like timer and duty-sequence side. Neither date claims one chip invented clock-divider pulse synthesis.",
    "General Instrument, AY-3-8910/8912 Programmable Sound Generator Data Manual (1979)",
    "https://archive.org/details/rearc_atari-st-e-tt-toolkit-b1-73-ay-3-8910-8912-psg-data-manual-1979-02"
  ),
  "lfsr-noise": milestone(
    "1983",
    "product lineage",
    "Nintendo's 1983 Famicom is the product anchor for the demonstrated NES-style 15-bit and short-mode noise lineage. Linear-feedback shift registers and pseudorandom-noise generators are much older, and the separate maximal 7-bit mode is generic.",
    "Nintendo official company history, Family Computer launch (1983)",
    "https://www.nintendo.co.jp/corporate/en/history/index.html"
  ),
  "dpcm": milestone(
    "1950",
    "coding precursor patent filing",
    "Cutler filed his differential-quantization patent in 1950; it was granted in 1952. This is a foundational DPCM precursor, not the exact one-bit delta encoder or later NES-style seven-bit, plus-or-minus-two playback setting demonstrated here.",
    "Cutler, Differential Quantization of Communication Signals, US2605361A (filed 1950)",
    "https://patents.google.com/patent/US2605361A/en"
  ),
  "bytebeat": milestone(
    "2011",
    "documented musical practice",
    "Viznut's October 2011 essay crystallized the modern bytebeat practice of interpreting tiny integer expressions directly as sample streams. Integer computer waveforms and algorithmic music are older.",
    "Viznut, Algorithmic Symphonies from One Line of Code (2011)",
    "http://countercomplex.blogspot.com/2011/10/algorithmic-symphonies-from-one-line-of.html"
  ),
  "chebyshev": milestone(
    "1979",
    "musical synthesis publication",
    "Le Brun's digital-waveshaping paper develops prescribed harmonic spectra with weighted Chebyshev polynomials. The mathematics is nineteenth-century and nonlinear musical shaping is older; 1979 dates this explicit harmonic construction.",
    "Le Brun, Digital Waveshaping Synthesis (1979)",
    "https://secure.aes.org/forum/pubs/journal/?elib=3212"
  ),
  "fx-biquad": milestone(
    "1971",
    "topology publication",
    "Thomas's paper gives a comprehensive account of the named active biquad, a second-order filter topology. This browser processor is a later digital two-pole/two-zero realization, so the date does not originate second-order filtering or digital EQ.",
    "Thomas, The Biquad: Part I (1971)",
    "https://doi.org/10.1109/TCT.1971.1083277"
  ),
  "fx-svf": milestone(
    "1967",
    "circuit publication",
    "Kerwin, Huelsman and Newcomb published state-variable synthesis and low-sensitivity second-order integrated-circuit realizations. The browser's digital multimode filter is later, so the date anchors the circuit method rather than all state-space filtering.",
    "Kerwin, Huelsman & Newcomb, State-Variable Synthesis (1967)",
    "https://doi.org/10.1109/JSSC.1967.1049798"
  ),
  "fx-ladder": milestone(
    "1966",
    "patent filing",
    "Robert Moog filed his voltage-controlled four-section transistor filter patent on 10 October 1966; its feedback path produces resonance and oscillation. The browser's nonlinear ladder is a later digital model, and 1966 is the filing date.",
    "Moog, US3475623A transistor filter (filed 1966)",
    "https://patents.google.com/patent/US3475623A/en"
  ),
  "fx-fir": milestone(
    "1968",
    "digital-filter publication",
    "Helms published methods for designing nonrecursive digital filters to frequency-response specifications. This is an early FIR-design milestone; the browser's particular windowed-sinc construction and named windows are later-standardized details.",
    "Helms, Nonrecursive Digital Filters (1968)",
    "https://doi.org/10.1109/TAU.1968.1161999"
  ),
  "fx-comb": milestone(
    "1962",
    "audio-processing publication",
    "Schroeder described electronic artificial-reverberation structures made from parallel comb-filter delay loops. Feedforward combs and delay cancellation are broader ideas, so this dates an influential audio application rather than every comb configuration.",
    "Schroeder, Natural Sounding Artificial Reverberation (1962)",
    "https://aes2.org/publications/elibrary-page/?id=849"
  ),
  "fx-delay": milestone(
    "1973",
    "commercial processor milestone",
    "Eventide's DDL 1745A added signal recirculation, labeled Repeat, to its digital delay line in 1973. This directly anchors feedback delay hardware; the browser adds damping, cross-feedback and stereo offset and is not a 1745A emulation.",
    "Eventide, DDL 1745A archive (1973)",
    "https://www.eventideaudio.com/rackmount/ddl-1745a/"
  ),
  "fx-modulated-delay": milestone(
    "1975",
    "commercial processor milestone",
    "Eventide released the FL 201 Instant Flanger in 1975 as an electronic variable-delay simulation of tape flanging. The browser spans both flanging and chorus, whose lineages are distinct and older, so this is a hardware exemplar.",
    "Eventide, FL 201 Instant Flanger archive (1975)",
    "https://www.eventideaudio.com/rackmount/fl-201-instant-flanger/"
  ),
  "fx-phaser": milestone(
    "1971–72",
    "commercial processor period",
    "Eventide says PS 101 production began in 1971, while its timeline and manuals label release as 1972; the unit swept eight FET all-pass sections. The span preserves that official discrepancy and does not date all-pass phase shifting itself.",
    "Eventide, PS 101 Instant Phaser archive",
    "https://www.eventideaudio.com/rackmount/ps-101-instant-phaser/"
  ),
  "fx-reverb": milestone(
    "1982",
    "network publication",
    "Stautner and Puckette described recursive multichannel delay networks foundational to feedback-delay-network reverberation. Jot and Chaigne later formalized tunable designs; this browser processor is a simplified stereo FDN.",
    "Stautner & Puckette, Designing Multi-Channel Reverberators (1982)",
    "https://doi.org/10.2307/3680358"
  ),
  "fx-saturation": milestone(
    "2016",
    "antialiasing algorithm publication",
    "Parker, Zavalishin and Le Bivic introduced the continuous-time-convolution method now called antiderivative antialiasing for nonlinear waveshaping. Saturation is much older; 2016 dates this processor's optional ADAA method.",
    "Parker, Zavalishin & Le Bivic, Reducing the Aliasing of Nonlinear Waveshaping (2016)",
    "https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf"
  ),
  "fx-decimator": milestone(
    "1938",
    "patent priority",
    "Reeves's PCM patent claims 3 October 1938 priority and describes amplitude sampling plus selection from finite amplitude levels. The processor intentionally reduces bit depth and update rate, so 1938 is a quantization-and-sampling ancestor, not a musical bitcrusher origin.",
    "Reeves, US2272070A Electric Signaling System (1938 priority)",
    "https://patents.google.com/patent/US2272070A/en"
  ),
  "fx-compressor": milestone(
    "1925",
    "patent filing",
    "Mathes filed a speech-and-music transmission patent that rectifies signal energy, smooths a control signal and varies impedance to compress the transmitted range. Modern threshold, ratio, knee and detector controls are later developments.",
    "Mathes, US1757729A Wave-Transmission System (filed 1925)",
    "https://patents.google.com/patent/US1757729A/en"
  ),
  "fx-expander": milestone(
    "1973",
    "commercial processor milestone",
    "Eventide documents a 1972 prototype and 1973 introduction of the Omnipressor, whose range included gating and expansion as well as compression. It is a flexible studio-dynamics milestone, not the origin of expansion or companding.",
    "Eventide, Flashback: The Omnipressor (1973 introduction)",
    "https://www.eventideaudio.com/blog/50th-flashback-3-the-omnipressor/"
  ),
  "fx-envelope-filter": milestone(
    "1972",
    "commercial processor milestone",
    "Mu-Tron's inventor archive dates development of the Mu-Tron III automatic-wah envelope-controlled filter to 1972. Signal-envelope-controlled filtering is broader than this product, and the browser adds independently adjustable timing, Q and direction.",
    "Mu-Tron inventor's collection, Mu-Tron III (developed 1972)",
    "https://mu-tron.com/inventprs-collection/"
  ),
  "fx-frequency-shifter": milestone(
    "1965",
    "conference publication",
    "Bode presented his Solid State Audio Frequency Spectrum Shifter at AES in 1965; journal publication followed in 1966. It anchors a music-oriented quadrature processor, while frequency translation itself is older and this Hilbert implementation is digital.",
    "Bode, Solid State Audio Frequency Spectrum Shifter (1965)",
    "https://zkm.de/en/texts-and-publications-by-harald-bode"
  ),
  "fx-vocoder": milestone(
    "1935",
    "patent filing",
    "Dudley filed Signal Transmission on 30 October 1935; it analyzes speech into bands and applies their average-power controls to corresponding locally generated bands. The current eight-band musical-carrier vocoder is a simplified digital descendant.",
    "Dudley, US2151091A Signal Transmission (filed 1935)",
    "https://patents.google.com/patent/US2151091A/en"
  ),
  "fx-spectral": milestone(
    "1976",
    "FFT phase-vocoder publication",
    "Portnoff published an FFT implementation of digital phase-vocoder analysis and synthesis in June 1976. This anchors the analysis–resynthesis architecture, not the invention date of spectral gating or freeze; the browser's four-mode WOLA processor is a contemporary implementation.",
    "Portnoff, Implementation of the digital phase vocoder using the fast Fourier transform (1976)",
    "https://www.ee.columbia.edu/~dpwe/papers/Portnoff76-pvoc.pdf"
  )
});
