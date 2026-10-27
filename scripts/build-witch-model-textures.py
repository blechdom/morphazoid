#!/usr/bin/env python3
"""Derive smaller Witch textures while retaining the complete native mesh/rig.

Uses checked-in source GLBs. No download, geometry conversion or runtime change.
All image views must follow the non-image binary data; that prefix is copied
literally, including the spider's existing compressed meshopt streams.
"""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import struct

from PIL import Image, features

ROOT = Path(__file__).resolve().parent.parent
TOOLS = {
    "pillow": "10.2.0", "webp": "1.3.2", "jpg": "8.0",
    "libjpeg_turbo": "2.1.5", "zlib": "1.3",
}
MODELS = (
    ("hand-512.glb", "assets/gesticulating-hand/hand.glb", 512,
     "3eb51d0b612fb4b5f3b63c9e32ac145be191abcfd38ca7d3c5cf4fe0a7ee2d58"),
    ("hand-1024.glb", "assets/gesticulating-hand/hand.glb", 1024,
     "3eb51d0b612fb4b5f3b63c9e32ac145be191abcfd38ca7d3c5cf4fe0a7ee2d58"),
    ("tarantula-512.glb", "assets/spider-synth/skins/tarantula/spider-phone.glb", 512,
     "dce0fedb9965567af99b88acede759b40fb5a4a242dea0e3b193da835faa1d4e"),
    ("eye-512.glb", "assets/oculoid/eye.glb", 512,
     "c1b1747153264f34207e521cf9528576955892c5905644ce5638b5ab03bd137c"),
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_glb(data):
    require(len(data) >= 28, "Truncated GLB")
    magic, version, size, json_size, json_type = struct.unpack_from("<5I", data)
    require((magic, version, size, json_type) == (0x46546C67, 2, len(data), 0x4E4F534A), "Unexpected GLB header")
    bin_size, bin_type = struct.unpack_from("<2I", data, 20 + json_size)
    require(bin_type == 0x004E4942 and 28 + json_size + bin_size == len(data), "Unexpected binary chunk")
    document = json.loads(data[20:20 + json_size])
    binary = data[28 + json_size:]
    require(all("uri" not in buffer for buffer in document["buffers"]), "External buffer")
    require(all("uri" not in image for image in document["images"]), "External image")
    declared = document["buffers"][0]["byteLength"]
    require(0 <= len(binary) - declared <= 3 and not any(binary[declared:]), "Unexpected binary padding")
    return document, binary


def view_payload(binary, view):
    packed = view.get("extensions", {}).get("EXT_meshopt_compression", view)
    require(packed["buffer"] == 0, "Payload must be in the physical GLB buffer")
    start, size = packed.get("byteOffset", 0), packed["byteLength"]
    require(start >= 0 and size > 0 and start + size <= len(binary), "Buffer view out of bounds")
    return binary[start:start + size]


def image_tail(document, binary):
    indices = {image["bufferView"] for image in document["images"]}
    require(len(indices) == len(document["images"]), "Review shared image views")
    first = min(document["bufferViews"][index].get("byteOffset", 0) for index in indices)
    for index, view in enumerate(document["bufferViews"]):
        view_payload(binary, view)
        if index in indices:
            require(view["buffer"] == 0 and not view.get("extensions"), "Review image view extensions")
        else:
            packed = view.get("extensions", {}).get("EXT_meshopt_compression", view)
            require(packed.get("byteOffset", 0) + packed["byteLength"] <= first, "Images must follow every mesh/rig payload")
    require(not any(accessor.get("bufferView") in indices for accessor in document["accessors"]), "Image aliases an accessor")
    return first, indices


def resample_image(payload, edge):
    original = Image.open(io.BytesIO(payload))
    original.load()
    require(original.size in ((1024, 1024), (2048, 2048)), "Review new source texture dimensions")
    kind = original.format
    require(kind in ("JPEG", "PNG", "WEBP"), "Review texture encoding")
    if original.mode == "P":
        original = original.convert("RGBA" if original.info.get("transparency") is not None else "RGB")
    # Keep the native luminance+alpha specular map and all scalar PNG channels;
    # only color images that were already lossy receive lossy re-encoding.
    reference = original.resize((edge, edge), Image.Resampling.LANCZOS)
    stream = io.BytesIO()
    options = {"compress_level": 9}
    if kind == "JPEG":
        options = {"quality": 92, "subsampling": 0, "optimize": False, "progressive": False}
    elif kind == "WEBP":
        options = {"quality": 90, "method": 6, "exact": True}
    reference.save(stream, format=kind, **options)
    result = stream.getvalue()
    decoded = Image.open(io.BytesIO(result))
    require(decoded.size == (edge, edge) and decoded.format == kind, "Unexpected encoded image")
    if kind == "PNG":
        require(decoded.mode == reference.mode and decoded.tobytes() == reference.tobytes(), "Scalar/alpha PNG must remain lossless")
    return result


def validate(source, output, edge):
    """Reparse the completed artifact and independently inspect all its payloads."""
    original, original_binary = read_glb(source)
    derived, derived_binary = read_glb(output)
    first, images = image_tail(original, original_binary)
    require(derived_binary[:first] == original_binary[:first], "Mesh/rig/animation prefix changed")
    restored = copy.deepcopy(derived)
    restored["buffers"][0]["byteLength"] = original["buffers"][0]["byteLength"]
    require(len(derived["bufferViews"]) == len(original["bufferViews"]), "View count changed")
    for index, view in enumerate(derived["bufferViews"]):
        if index in images:
            source_view = original["bufferViews"][index]
            for key in ("byteOffset", "byteLength"):
                restored["bufferViews"][index][key] = source_view[key]
            require(view.get("byteOffset", 0) >= first and view.get("byteOffset", 0) % 4 == 0, "Unaligned image tail")
        else:
            require(view == original["bufferViews"][index], "Non-image buffer metadata changed")
            require(view_payload(derived_binary, view) == view_payload(original_binary, original["bufferViews"][index]), "Geometry/rig payload changed")
    require(restored == original, "Only image offsets/lengths and physical buffer size may change")
    for image in derived["images"]:
        payload = view_payload(derived_binary, derived["bufferViews"][image["bufferView"]])
        decoded = Image.open(io.BytesIO(payload))
        decoded.load()
        require(decoded.size == (edge, edge), "Decoded texture size changed")
        require(Image.MIME[decoded.format] == image["mimeType"], "Image MIME type changed")
    return first


def build(source, edge):
    document, binary = read_glb(source)
    first, _ = image_tail(document, binary)
    output_binary = bytearray(binary[:first])
    for image in document["images"]:
        view = document["bufferViews"][image["bufferView"]]
        resized = resample_image(view_payload(binary, view), edge)
        view["byteOffset"] = len(output_binary)
        view["byteLength"] = len(resized)
        output_binary.extend(resized)
        output_binary.extend(bytes(-len(output_binary) % 4))
    document["buffers"][0]["byteLength"] = len(output_binary)
    text = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf8")
    text += b" " * (-len(text) % 4)
    result = struct.pack("<5I", 0x46546C67, 2, 28 + len(text) + len(output_binary), len(text), 0x4E4F534A)
    result += text + struct.pack("<2I", len(output_binary), 0x004E4942) + output_binary
    validate(source, result, edge)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, default=ROOT / "assets/witch")
    parser.add_argument("--check", action="store_true", help="Compare committed derivatives without writing")
    parser.add_argument("--model", choices=[item[0] for item in MODELS], help="Build/check one named derivative")
    args = parser.parse_args()
    installed = {key: Image.__version__ if key == "pillow" else features.version(key) for key in TOOLS}
    require(installed == TOOLS, f"Reproducible build requires {TOOLS}; found {installed}. Use scripts/spider-phone-asset-requirements.txt.")
    for name, relative, edge, source_sha in MODELS:
        if args.model and name != args.model:
            continue
        source_path, target = ROOT / relative, args.output_root / name
        require(source_path.resolve() != target.resolve(), "Never overwrite source models")
        source = source_path.read_bytes()
        require(sha(source) == source_sha, f"Review changed source: {relative}")
        output = build(source, edge)
        if args.check:
            require(target.read_bytes() == output, f"Derivative is out of date: {target}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(output)
        print(f"{name}: {len(source):,} -> {len(output):,} bytes; {edge}px textures; sha256 {sha(output)}")


if __name__ == "__main__":
    main()
