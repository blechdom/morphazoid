#!/usr/bin/env python3
"""Train the four original, tiny Synthesis Lab teaching models.

Only the training tool needs NumPy (2.2.6). Runtime inference is dependency-free
Rust. Corpus generation, Adam, back-propagation and exports are all below.
Run: OPENBLAS_NUM_THREADS=1 python scripts/train-synthesis-models.py
"""
from pathlib import Path
import argparse
import hashlib
import json
import time
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
N = 64
TAU = 2 * np.pi
PHASE = np.arange(N, dtype=np.float32) / N
SEED = 20260929


class Network:
    def __init__(self, widths, rng, activations=None):
        self.activations = activations or ['tanh'] * (len(widths) - 2) + ['linear']
        self.w = [(rng.normal(size=(a, b)) * np.sqrt(2 / (a + b))).astype(np.float32)
                  for a, b in zip(widths[:-1], widths[1:])]
        self.b = [np.zeros(b, np.float32) for b in widths[1:]]
        self.m = [np.zeros_like(p) for p in self.w + self.b]
        self.v = [np.zeros_like(p) for p in self.w + self.b]
        self.t = 0

    def forward(self, x):
        self.cache = [x]
        for w, b, act in zip(self.w, self.b, self.activations):
            x = x @ w + b
            if act == 'tanh':
                x = np.tanh(x)
            elif act == 'sigmoid':
                x = 1 / (1 + np.exp(-np.clip(x, -30, 30)))
            self.cache.append(x)
        return x

    def step(self, gradient, rate):
        dw, db = [None] * len(self.w), [None] * len(self.w)
        for i in range(len(self.w) - 1, -1, -1):
            y = self.cache[i + 1]
            act = self.activations[i]
            if act == 'tanh':
                gradient = gradient * (1 - y * y)
            elif act == 'sigmoid':
                gradient = gradient * y * (1 - y)
            dw[i] = self.cache[i].T @ gradient
            db[i] = gradient.sum(axis=0)
            gradient = gradient @ self.w[i].T
        self.t += 1
        for i, (p, g) in enumerate(zip(self.w + self.b, dw + db)):
            g = np.clip(g, -2, 2)
            self.m[i] = .9 * self.m[i] + .1 * g
            self.v[i] = .999 * self.v[i] + .001 * g * g
            p -= rate * (self.m[i] / (1 - .9 ** self.t)) / (
                np.sqrt(self.v[i] / (1 - .999 ** self.t)) + 1e-8)

    def mse_step(self, x, target, rate):
        prediction = self.forward(x)
        error = prediction - target
        self.step(2 * error / error.size, rate)
        return float(np.mean(error ** 2))


def ar_wave(phase, controls):
    a, b, c = controls.T
    angle = TAU * phase
    # Original synthetic training examples, never evaluated by runtime inference.
    return (.38 * np.sin(angle) + (.02 + .19 * a) * np.sin(2 * angle + .8 * c)
            + (.01 + .13 * b + .10 * c) * np.sin(3 * angle - 1.3 * c)
            + (.005 + .055 * a * b + .08 * c) * np.sin(5 * angle + 3 * c)).astype(np.float32)


def ar_batch(rng, size):
    c = rng.random((size, 3), dtype=np.float32)
    p = rng.random(size, dtype=np.float32)
    step = rng.uniform(.003, .14, size).astype(np.float32)
    prev = np.stack([ar_wave(p - step, c), ar_wave(p - 2 * step, c)], 1)
    # Corrupt teacher histories so inference remains stable when predicting itself.
    prev += rng.normal(0, .045, prev.shape).astype(np.float32)
    prev *= (rng.random((size, 1)) > .12)
    x = np.column_stack([prev, np.sin(TAU * p), np.cos(TAU * p), 2 * c - 1,
                         step / .075 - 1]).astype(np.float32)
    return x, ar_wave(p, c)[:, None]


def ae_frames(c):
    p = TAU * PHASE[None, :]
    a, b, d, e = [v[:, None] for v in c.T]
    return (.34 * np.sin(p) + (.015 + .095 * (a + 1)) * np.sin(2 * p)
            + (.015 + .08 * (b + 1)) * np.sin(3 * p + .4)
            + (.005 + .0725 * (d + 1)) * np.sin(5 * p - .7)
            + (.005 + .0675 * (e + 1)) * np.sin(7 * p + .9)
            + .01 * (a + 1) * (b + 1) * np.sin(4 * p + d)).astype(np.float32)


def ddsp_target(c):
    h = np.arange(1, 9, dtype=np.float32)[None, :]
    brightness, balance, formant, noise = [v[:, None] for v in c.T]
    amp = h ** (-2.5 + 2.1 * brightness)
    amp *= np.where((h.astype(int) % 2) == 0, .08 + 1.5 * balance, 1.15 - .5 * balance)
    amp *= .5 + 1.4 * np.exp(-.5 * ((h - (1 + 7 * formant)) / 1.35) ** 2)
    amp = amp / amp.sum(axis=1, keepdims=True) * (.68 - .20 * noise)
    return np.column_stack([amp, .18 * noise[:, 0]]).astype(np.float32)


def diffusion_frames(rng, controls):
    size = len(controls)
    h = np.arange(1, 13, dtype=np.float32)[None, :]
    bright, shape = controls[:, :1], controls[:, 1:2]
    amp = h ** (-2.8 + 2.3 * bright)
    amp *= np.where((h.astype(int) % 2) == 0, .04 + shape * 1.6, 1)
    # Unconditioned spectral variations make the reverse process seed-sensitive.
    amp *= np.exp(rng.normal(0, .35, (size, 12))).astype(np.float32)
    amp[:, 0] += .3
    amp *= .82 / amp.sum(axis=1, keepdims=True)
    phases = rng.normal(0, .55, (size, 12)).astype(np.float32)
    phases[:, 0] *= .1
    return np.sum(amp[:, :, None] * np.sin(TAU * h[:, :, None] * PHASE
                  + phases[:, :, None]), axis=1).astype(np.float32)


def diffusion_batch(rng, size):
    c = rng.random((size, 2), dtype=np.float32)
    clean = diffusion_frames(rng, c)
    t = rng.uniform(.002, .998, size).astype(np.float32)
    alpha, sigma = np.cos(t * np.pi / 2), np.sin(t * np.pi / 2)
    noisy = alpha[:, None] * clean + sigma[:, None] * rng.normal(size=clean.shape)
    x = np.column_stack([noisy, 2 * c - 1, 2 * t - 1]).astype(np.float32)
    return x, clean


def diffusion_sample(net, controls, seed, steps=12):
    rng = np.random.default_rng(seed)
    x = rng.normal(size=(1, N)).astype(np.float32)
    for i in range(steps, 0, -1):
        t, nxt = i / steps * .995, (i - 1) / steps * .995
        inp = np.column_stack([x, np.array([controls]) * 2 - 1, [2 * t - 1]]).astype(np.float32)
        clean = net.forward(inp)
        alpha, sigma = np.cos(t * np.pi / 2), np.sin(t * np.pi / 2)
        eps = (x - alpha * clean) / max(.001, sigma)
        x = np.cos(nxt * np.pi / 2) * clean + np.sin(nxt * np.pi / 2) * eps
    return x[0]


def export_array(name, arr):
    a = np.asarray(arr, dtype=np.float32)
    values = [f'{float(v):.8e}_f32' for v in a.ravel()]
    lines = [', '.join(values[i:i + 6]) for i in range(0, len(values), 6)]
    return f'#[rustfmt::skip]\npub const {name}: [f32; {a.size}] = [\n    ' + ',\n    '.join(lines) + '\n];\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--steps-scale', type=float, default=1.0)
    args = parser.parse_args()
    rng = np.random.default_rng(SEED)
    results = {'seed': SEED, 'numpy': np.__version__, 'frame_samples': N,
               'corpus': 'original deterministic procedural waveforms; no recordings or third-party weights',
               'models': {}}
    exports = ['// Generated by scripts/train-synthesis-models.py. Original locally trained weights.\n']
    started = time.monotonic()

    ar = Network([8, 24, 1], rng, ['tanh', 'tanh'])
    ar_test = ar_batch(np.random.default_rng(SEED + 101), 4096)
    initial = float(np.mean((ar.forward(ar_test[0]) - ar_test[1]) ** 2))
    steps = round(10000 * args.steps_scale)
    for i in range(steps):
        x, y = ar_batch(rng, 192)
        loss = ar.mse_step(x, y, .003 * (1 - .8 * i / steps))
    test = float(np.mean((ar.forward(ar_test[0]) - ar_test[1]) ** 2))
    rollout_rng = np.random.default_rng(SEED + 105)
    rollout_c = rollout_rng.random((32, 3), dtype=np.float32)
    rollout_steps = rollout_rng.uniform(.004, .12, 32).astype(np.float32)
    rollout_phase = np.zeros(32, np.float32)
    history = np.zeros((32, 2), np.float32)
    rollout_errors = []
    for tick in range(1024):
        rollout_phase = (rollout_phase + rollout_steps) % 1
        inputs = np.column_stack([history, np.sin(TAU * rollout_phase), np.cos(TAU * rollout_phase),
                                  2 * rollout_c - 1, rollout_steps / .075 - 1]).astype(np.float32)
        predicted = ar.forward(inputs)[:, 0]
        history[:, 1] = history[:, 0]
        history[:, 0] = predicted
        if tick >= 256:
            rollout_errors.append(np.mean((predicted - ar_wave(rollout_phase, rollout_c)) ** 2))
    rollout_error = float(np.mean(rollout_errors))
    results['models']['ar'] = {'architecture': [8, 24, 1], 'training_updates': steps,
        'initial_validation_mse': initial, 'validation_mse': test, 'final_training_mse': loss,
        'free_running_validation_mse': rollout_error}
    print('AR', results['models']['ar'], flush=True)

    ae = Network([64, 24, 4, 32, 64], rng, ['tanh', 'tanh', 'tanh', 'linear'])
    ae_train = ae_frames(rng.uniform(-1, 1, (4096, 4)).astype(np.float32))
    ae_test = ae_frames(np.random.default_rng(SEED + 102).uniform(-1, 1, (1024, 4)).astype(np.float32))
    initial = float(np.mean((ae.forward(ae_test) - ae_test) ** 2))
    steps = round(7000 * args.steps_scale)
    for i in range(steps):
        batch = ae_train[rng.integers(0, len(ae_train), 128)]
        loss = ae.mse_step(batch, batch, .0025 * (1 - .9 * i / steps))
    test = float(np.mean((ae.forward(ae_test) - ae_test) ** 2))
    ae.forward(ae_train)
    z = ae.cache[2]
    latent_low, latent_high = np.quantile(z, [.03, .97], axis=0)
    results['models']['autoencoder'] = {'architecture': [64, 24, 4, 32, 64], 'training_examples': 4096,
        'training_updates': steps, 'initial_validation_mse': initial, 'validation_mse': test,
        'latent_low': latent_low.tolist(), 'latent_high': latent_high.tolist()}
    print('AE', results['models']['autoencoder'], flush=True)

    ddsp = Network([4, 24, 9], rng, ['tanh', 'sigmoid'])
    basis = np.sin(TAU * np.arange(1, 9)[:, None] * PHASE).astype(np.float32)
    ddsp_c = np.random.default_rng(SEED + 103).random((1024, 4), dtype=np.float32)
    test_controls = ddsp_target(ddsp_c)
    initial = float(np.mean((ddsp.forward(2 * ddsp_c - 1) * .8 - test_controls) ** 2))
    steps = round(8000 * args.steps_scale)
    for i in range(steps):
        c = rng.random((128, 4), dtype=np.float32)
        target = ddsp_target(c)
        coeff = ddsp.forward(2 * c - 1) * .8
        noise_basis = rng.uniform(-1, 1, (128, N)).astype(np.float32)
        # Loss is in synthesized AUDIO; backpropagate through the actual bank.
        audio_error = ((coeff[:, :8] - target[:, :8]) @ basis
                       + (coeff[:, 8:] - target[:, 8:]) * noise_basis)
        gradient = np.column_stack([audio_error @ basis.T,
                                   np.sum(audio_error * noise_basis, axis=1)]) * (1.6 / audio_error.size)
        ddsp.step(gradient, .003 * (1 - .9 * i / steps))
        loss = float(np.mean(audio_error ** 2))
    test_coeff = ddsp.forward(2 * ddsp_c - 1) * .8
    test = float(np.mean((test_coeff - test_controls) ** 2))
    test_audio = float(np.mean(((test_coeff[:, :8] - test_controls[:, :8]) @ basis) ** 2)
                       + np.mean((test_coeff[:, 8] - test_controls[:, 8]) ** 2) / 3)
    results['models']['ddsp'] = {'architecture': [4, 24, 9], 'training_updates': steps,
        'objective': 'waveform MSE through differentiable eight-sine plus white-noise synthesizer',
        'initial_validation_coefficient_mse': initial, 'validation_coefficient_mse': test,
        'validation_audio_mse': test_audio, 'final_training_audio_mse': loss}
    print('DDSP', results['models']['ddsp'], flush=True)

    diff = Network([67, 64, 64], rng, ['tanh', 'linear'])
    diff_test = diffusion_batch(np.random.default_rng(SEED + 104), 4096)
    initial = float(np.mean((diff.forward(diff_test[0]) - diff_test[1]) ** 2))
    steps = round(12000 * args.steps_scale)
    for i in range(steps):
        x, y = diffusion_batch(rng, 128)
        loss = diff.mse_step(x, y, .0018 * (1 - .85 * i / steps))
    test = float(np.mean((diff.forward(diff_test[0]) - diff_test[1]) ** 2))
    frames = [diffusion_sample(diff, [.7, .3], seed) for seed in range(8)]
    results['models']['diffusion'] = {'architecture': [67, 64, 64], 'training_updates': steps,
        'objective': 'conditional clean-frame prediction from cosine-schedule Gaussian corruption',
        'initial_validation_mse': initial, 'validation_mse': test,
        'final_training_mse': loss, 'sampling': 'deterministic DDIM, 4..20 reverse steps',
        'eight_seed_minimum_frame_distance': float(min(np.sqrt(np.mean((a-b)**2))
            for i, a in enumerate(frames) for b in frames[i+1:]))}
    print('DIFFUSION', results['models']['diffusion'], flush=True)

    for name, net in [('AR', ar), ('AE', ae), ('DDSP', ddsp), ('DIFF', diff)]:
        for i, (w, b) in enumerate(zip(net.w, net.b)):
            exports += [export_array(f'{name}_W{i}', w.T), export_array(f'{name}_B{i}', b)]
    exports += [export_array('AE_LATENT_LOW', latent_low), export_array('AE_LATENT_HIGH', latent_high)]
    destination = ROOT / 'src/instruments/synthesis/rust/core/src/neural_weights.rs'
    destination.parent.mkdir(parents=True, exist_ok=True)
    data = '\n'.join(exports)
    destination.write_text(data)
    results['weights_sha256'] = hashlib.sha256(data.encode()).hexdigest()
    results['train_seconds'] = round(time.monotonic() - started, 3)
    results['parameter_count'] = {name: sum(p.size for p in net.w + net.b)
        for name, net in [('ar', ar), ('autoencoder', ae), ('ddsp', ddsp), ('diffusion', diff)]}
    result_path = ROOT / 'docs/synthesis-neural-training-results.json'
    result_path.write_text(json.dumps(results, indent=2) + '\n')
    print('Wrote', destination, 'in', results['train_seconds'], 'seconds', flush=True)
    assert test < initial * .4, 'Denoiser must improve substantially over initialization'
    assert results['models']['autoencoder']['validation_mse'] < .003
    assert results['models']['ar']['validation_mse'] < .008
    assert results['models']['ar']['free_running_validation_mse'] < .02
    assert results['models']['ddsp']['validation_audio_mse'] < .006


if __name__ == '__main__':
    main()
