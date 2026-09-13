#!/usr/bin/env python3
"""Derive 2K phone atlases without changing any packed spider geometry or rig.

Run from any directory; source GLBs are the checked-in full-detail deliveries.
No original scan archive, network access, geometry library or browser is needed.
"""
import argparse
import copy
import hashlib
import io
import json
import math
from pathlib import Path
import struct

from PIL import Image, ImageChops, ImageStat, features

ROOT = Path(__file__).resolve().parent.parent
SPECIMENS = ("argiope", "golden", "devil", "tarantula", "huntsman", "fishing")
PILLOW_VERSION = "10.2.0"
WEBP_VERSION = "1.3.2"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_glb(path):
    data = path.read_bytes()
    magic, version, size, json_size, json_type = struct.unpack_from("<5I", data)
    assert (magic, version, size, json_type) == (0x46546C67, 2, len(data), 0x4E4F534A)
    bin_size, bin_type = struct.unpack_from("<2I", data, 20 + json_size)
    assert bin_type == 0x004E4942 and 28 + json_size + bin_size == len(data)
    document = json.loads(data[20:20 + json_size])
    binary = data[28 + json_size:]
    assert all("uri" not in buffer for buffer in document["buffers"])
    assert all("uri" not in image for image in document["images"])
    return data, document, binary


def rgba_mip_bytes(width, height):
    texels = 0
    while True:
        texels += width * height
        if width == height == 1:
            return texels * 4
        width, height = max(1, width // 2), max(1, height // 2)


def build(specimen, output_root):
    relative = Path() if specimen == "argiope" else Path("skins") / specimen
    source_path = ROOT / "assets/spider-synth" / relative / "spider-mobile.glb"
    output_path = output_root / relative / "spider-phone.glb"
    assert source_path.resolve() != output_path.resolve(), "Never overwrite full detail"
    original, document, source_binary = read_glb(source_path)
    before = copy.deepcopy(document)
    assert len(document["images"]) == 1, "Review texture roles before adding another atlas"
    image_info = document["images"][0]
    image_view = image_info["bufferView"]
    image_layout = document["bufferViews"][image_view]
    assert image_layout["buffer"] == 0 and not image_layout.get("extensions")
    start = image_layout.get("byteOffset", 0)
    source_image = source_binary[start:start + image_layout["byteLength"]]
    image = Image.open(io.BytesIO(source_image))
    image.load()
    assert image.size == (4096, 4096) and image.mode in ("RGB", "RGBA")
    reference = image.resize((2048, 2048), Image.Resampling.LANCZOS)
    stream = io.BytesIO()
    reference.save(stream, format="WEBP", quality=90, method=6, exact=True)
    phone_image = stream.getvalue()
    decoded = Image.open(io.BytesIO(phone_image)).convert("RGBA")
    difference = ImageChops.difference(reference.convert("RGBA"), decoded)
    squared_error = sum(ImageStat.Stat(difference).sum2) / (2048 * 2048 * 4)
    psnr = None if not squared_error else round(10 * math.log10(255 ** 2 / squared_error), 6)

    binary = bytearray()
    payloads = []

    def append(data):
        offset = len(binary)
        binary.extend(data)
        binary.extend(bytes(-len(binary) % 4))
        return offset

    # Keep fallback buffer layouts and every meshopt stream literal. Only the
    # physical buffer-0 offsets move to accommodate the smaller embedded atlas.
    for index, view in enumerate(document["bufferViews"]):
        packed = view.get("extensions", {}).get("EXT_meshopt_compression")
        if packed:
            assert packed["buffer"] == 0 and view["buffer"] == 1
            at, size = packed.get("byteOffset", 0), packed["byteLength"]
            payload = source_binary[at:at + size]
            assert len(payload) == size
            packed["byteOffset"] = append(payload)
        else:
            assert view["buffer"] == 0
            at, size = view.get("byteOffset", 0), view["byteLength"]
            payload = source_binary[at:at + size]
            assert len(payload) == size
            if index == image_view:
                payload = phone_image
            view["byteOffset"] = append(payload)
            view["byteLength"] = len(payload)
        if index != image_view:
            payloads.append({"bufferView": index, "bytes": len(payload), "sha256": sha(payload), "meshopt": bool(packed)})
    document["buffers"][0]["byteLength"] = len(binary)
    image_info["name"] = "Photographed color atlas, phone 2K WebP q90"
    text = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf8")
    text += b" " * (-len(text) % 4)
    output = struct.pack("<5I", 0x46546C67, 2, 28 + len(text) + len(binary), len(text), 0x4E4F534A)
    output += text + struct.pack("<2I", len(binary), 0x004E4942) + binary
    for key in ("accessors", "meshes", "skins", "nodes", "animations", "materials", "samplers", "textures", "scenes", "scene", "extensionsUsed", "extensionsRequired"):
        assert document.get(key) == before.get(key), f"Changed {key}"
    report = {
        "version": 1,
        "specimen": specimen,
        "profile": "phone-2k-q90",
        "tools": {"pillow": Image.__version__, "libwebp": features.version("webp")},
        "source": {"file": str(source_path.relative_to(ROOT)), "bytes": len(original), "sha256": sha(original)},
        "output": {"file": str(Path("assets/spider-synth") / relative / "spider-phone.glb"), "bytes": len(output), "sha256": sha(output)},
        "texture": {
            "sourceWidth": 4096, "sourceHeight": 4096, "width": 2048, "height": 2048,
            "sourceBytes": len(source_image), "bytes": len(phone_image),
            "sourceSha256": sha(source_image), "sha256": sha(phone_image),
            "resampling": "Lanczos", "quality": 90, "method": 6,
            "sourceRgbaBytes": 4096 * 4096 * 4, "rgbaBytes": 2048 * 2048 * 4,
            "sourceRgbaMipBytes": rgba_mip_bytes(4096, 4096), "rgbaMipBytes": rgba_mip_bytes(2048, 2048),
            "encodingPsnrDbAgainstResampledReference": psnr,
            "maximumRgbaEncodingError": max(pair[1] for pair in difference.getextrema()),
            "decodedRgbaSha256": sha(decoded.tobytes()),
        },
        "preservedPayloads": payloads,
        "invariants": {"exactCompressedGeometryAndRigPayloads": True, "exactAccessorAndSceneMetadata": True,
                       "allTrianglesAndWeightsRetained": True, "selfContained": True},
        "decodedGeometryBytes": document["buffers"][1]["byteLength"],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(output)
    output_path.with_suffix(".glb.report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"{specimen}: {len(original):,} -> {len(output):,} bytes ({(1 - len(output) / len(original)) * 100:.1f}% smaller); atlas 64 -> 16 MiB")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("specimens", choices=("all",) + SPECIMENS, nargs="*", default=["all"])
    parser.add_argument("--output-root", type=Path, default=ROOT / "assets/spider-synth", help="Separate output root for reproducibility checks")
    args = parser.parse_args()
    if Image.__version__ != PILLOW_VERSION or features.version("webp") != WEBP_VERSION:
        raise SystemExit(f"Reproducible build requires Pillow {PILLOW_VERSION} and libwebp {WEBP_VERSION}; see scripts/spider-phone-asset-requirements.txt")
    for specimen in SPECIMENS if "all" in args.specimens else args.specimens:
        build(specimen, args.output_root)


if __name__ == "__main__":
    main()
