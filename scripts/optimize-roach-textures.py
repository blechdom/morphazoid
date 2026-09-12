#!/usr/bin/env python3
"""Pinned, offline texture stage for optimize-roach-asset.mjs.

Lossless mode preserves original JPEG bytes and verifies every WebP pixel.
Other named profiles explicitly trade texture quality/resolution for size and
record pixel and sampled normal-direction errors. No browser dependency.
"""
import hashlib
import io
import json
import math
from pathlib import Path
import sys

from PIL import Image, ImageChops, ImageStat, features

if Image.__version__ != '10.2.0' or features.version('webp') != '1.3.2':
    raise SystemExit('Reproducible build requires Pillow 10.2.0 with libwebp 1.3.2; see scripts/roach-asset-requirements.txt.')

root = Path(sys.argv[1])
jobs = json.loads((root / 'texture-jobs.json').read_text())
profile = sys.argv[2]
results = []
for job in jobs:
    source = (root / job['input']).read_bytes()
    image = Image.open(io.BytesIO(source)).convert('RGBA')
    half_normal = profile == 'normalhalf' and 'normal' in job.get('roles', [])
    mode = 'lossy' if profile in ('mobile', 'compact', 'normalhalf') and not half_normal or (profile == 'color95' and job['colorOnly']) else 'lossless'
    quality = (94 if 'normal' in job.get('roles', []) else 95 if job.get('faceColor') else 90) if profile in ('compact', 'normalhalf') else (100 if 'normal' in job.get('roles', []) else 95)
    encoded_image = image.resize((image.width // 2, image.height // 2), Image.Resampling.LANCZOS) if half_normal else image
    result = dict(job, inputBytes=len(source), width=image.width, height=image.height,
                  rgbaSha256=hashlib.sha256(image.tobytes()).hexdigest(), mode='original',
                  mimeType=job['mimeType'], output=job['input'], outputBytes=len(source),
                  maximumPixelError=0, rmsPixelError=0, psnr=None)
    if profile != 'original' and (mode == 'lossy' or job['mimeType'] != 'image/jpeg'):
        output = io.BytesIO()
        encoded_image.save(output, format='WEBP', lossless=mode == 'lossless', quality=quality if mode == 'lossy' else 100, method=6)
        encoded = output.getvalue()
        decoded = Image.open(io.BytesIO(encoded)).convert('RGBA')
        exact_difference = ImageChops.difference(encoded_image, decoded)
        compared = decoded.resize(image.size, Image.Resampling.BILINEAR) if half_normal else decoded
        difference = ImageChops.difference(image, compared)
        maximum = max(high for low, high in difference.getextrema())
        rms = math.sqrt(sum(v * v for v in ImageStat.Stat(difference).rms) / 4)
        if mode == 'lossless' and max(high for low, high in exact_difference.getextrema()) != 0:
            raise ValueError(f"Lossless WebP changed RGBA pixels of image {job['index']}")
        # Never inflate an image merely to change its container.
        if len(encoded) < len(source):
            filename = f"texture-{job['index']}.webp"
            (root / filename).write_bytes(encoded)
            result.update(mode='resampled-lossless' if half_normal else mode, mimeType='image/webp', output=filename,
                          outputBytes=len(encoded), maximumPixelError=maximum,
                          rmsPixelError=rms, psnr=20 * math.log10(255 / rms) if rms else None)
            if half_normal: result.update(outputWidth=decoded.width, outputHeight=decoded.height, resampling='Lanczos half-size; error compared after bilinear upsampling')
            if mode == 'lossy': result['quality'] = quality
            if (mode == 'lossy' or half_normal) and 'normal' in job.get('roles', []):
                # A deterministic, evenly spaced sample of at most 65,536
                # texels; angular error concerns directions, not RGB PSNR.
                before = image.convert('RGB').tobytes()
                after = compared.convert('RGB').tobytes()
                pixel_count = image.width * image.height
                stride = max(1, math.ceil(pixel_count / 65536))
                angles = []
                for pixel in range(0, pixel_count, stride):
                    k = pixel * 3
                    a = [before[k + c] / 127.5 - 1 for c in range(3)]
                    b = [after[k + c] / 127.5 - 1 for c in range(3)]
                    length = math.sqrt(sum(v*v for v in a) * sum(v*v for v in b))
                    if length > 1e-12:
                        angles.append(math.degrees(math.acos(max(-1, min(1, sum(a[c]*b[c] for c in range(3)) / length)))))
                angles.sort()
                result['normalAngularDegrees'] = {'samples': len(angles), 'mean': sum(angles)/len(angles),
                    'p95': angles[int((len(angles)-1)*.95)], 'p99': angles[int((len(angles)-1)*.99)], 'maximumSampled': angles[-1]}
    results.append(result)
    print(f"texture {job['index'] + 1}/{len(jobs)}: {result['inputBytes']} -> {result['outputBytes']} ({result['mode']})", file=sys.stderr)
(root / 'texture-results.json').write_text(json.dumps(results, indent=2) + '\n')
