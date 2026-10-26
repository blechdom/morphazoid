#!/usr/bin/env python3
"""Extract the licensed teardrop mesh, without its large unused textures.

Usage: python3 scripts/prepare-oculoid-drop.py SOURCE.glb assets/oculoid/drop.glb
SOURCE is the locally downloaded Sketchfab "CC0 - Drops" GLB. Despite its
title, the embedded license is CC BY 4.0; see assets/oculoid/SOURCE.LICENSE.txt.
This is an asset-preparation tool, not a runtime dependency.
"""

import hashlib
import json
import struct
import sys
from pathlib import Path

SOURCE_HASH = "db1a15a107dcd74404110a802ad58910c72080cb81466e223d81d9edcd255076"
SOURCE_URL = "https://sketchfab.com/3d-models/cc0-drops-f8f24228aebf41f297c878ad82ea7db0"


def read_source(source):
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != SOURCE_HASH:
        raise ValueError("Unrecognized drop GLB: expected the attributed source's exact SHA-256")
    magic, version, total = struct.unpack_from("<4sII", data)
    if (magic, version, total) != (b"glTF", 2, len(data)):
        raise ValueError("Not a complete glTF 2.0 binary")
    json_length, json_type = struct.unpack_from("<II", data, 12)
    binary_start = 20 + json_length
    binary_length, binary_type = struct.unpack_from("<II", data, binary_start)
    if (json_type, binary_type) != (0x4E4F534A, 0x004E4942):
        raise ValueError("Expected JSON and BIN chunks")
    gltf = json.loads(data[20:binary_start])
    binary = data[binary_start + 8:binary_start + 8 + binary_length]
    extras = gltf["asset"]["extras"]
    if extras["source"] != SOURCE_URL or not extras["license"].startswith("CC-BY-4.0"):
        raise ValueError("The source and CC BY 4.0 license must be preserved")
    primitive = gltf["meshes"][0]["primitives"][0]
    if len(gltf["meshes"]) != 1 or len(gltf["meshes"][0]["primitives"]) != 1:
        raise ValueError("Expected one teardrop mesh")
    if primitive.get("mode", 4) != 4 or gltf.get("animations") or gltf.get("skins"):
        raise ValueError("Expected a static triangle mesh, not an animation or rig")
    return gltf, binary, extras, primitive


def accessor_bytes(gltf, binary, index, component_type, kind, width):
    accessor = gltf["accessors"][index]
    if accessor["componentType"] != component_type or accessor["type"] != kind:
        raise ValueError("Unexpected accessor layout")
    view = gltf["bufferViews"][accessor["bufferView"]]
    if view["buffer"] != 0 or accessor.get("sparse"):
        raise ValueError("Expected plain, single-buffer attributes")
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", width)
    if stride < width or start + (accessor["count"] - 1) * stride + width > len(binary):
        raise ValueError("Accessor extends beyond the source BIN chunk")
    return b"".join(binary[start + i * stride:start + i * stride + width]
                    for i in range(accessor["count"]))


def prepare(source, destination):
    gltf, binary, extras, primitive = read_source(source)
    attributes = primitive["attributes"]
    positions = accessor_bytes(gltf, binary, attributes["POSITION"], 5126, "VEC3", 12)
    normals = accessor_bytes(gltf, binary, attributes["NORMAL"], 5126, "VEC3", 12)
    indices32 = accessor_bytes(gltf, binary, primitive["indices"], 5125, "SCALAR", 4)
    count = len(positions) // 12
    indices = struct.unpack(f"<{len(indices32) // 4}I", indices32)
    if count != 526 or len(indices) != 2880 or max(indices) >= count:
        raise ValueError("Unexpected teardrop topology")
    indices16 = struct.pack(f"<{len(indices)}H", *indices)
    payload = positions + normals + indices16
    position_range = gltf["accessors"][attributes["POSITION"]]
    compact = {
        "asset": {
            "version": "2.0",
            "generator": "Morphazoid: scripts/prepare-oculoid-drop.py",
            "extras": {
                **extras,
                "morphazoid": {
                    "source_sha256": SOURCE_HASH,
                    "changes": "Unchanged vertex positions, normals and triangle winding; textures, "
                               "material, UVs, tangents and unit-conversion scene transforms removed.",
                },
            },
        },
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "Drops_Drops_0", "mesh": 0}],
        "meshes": [{"name": "Drops_Drops_0", "primitives": [{
            "attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "mode": 4,
        }]}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": count, "type": "VEC3",
             "min": position_range["min"], "max": position_range["max"]},
            {"bufferView": 1, "componentType": 5126, "count": count, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5123, "count": len(indices), "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(positions), "target": 34962},
            {"buffer": 0, "byteOffset": len(positions), "byteLength": len(normals), "target": 34962},
            {"buffer": 0, "byteOffset": len(positions) + len(normals),
             "byteLength": len(indices16), "target": 34963},
        ],
        "buffers": [{"byteLength": len(payload)}],
    }
    header = json.dumps(compact, separators=(",", ":"), sort_keys=True).encode("utf8")
    header += b" " * (-len(header) % 4)
    payload += b"\0" * (-len(payload) % 4)
    result = (
        struct.pack("<4sII", b"glTF", 2, 28 + len(header) + len(payload))
        + struct.pack("<II", len(header), 0x4E4F534A) + header
        + struct.pack("<II", len(payload), 0x004E4942) + payload
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(result)
    print(f"{destination}: {len(result)} bytes; SHA-256 {hashlib.sha256(result).hexdigest()}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: prepare-oculoid-drop.py SOURCE.glb DESTINATION.glb")
    prepare(Path(sys.argv[1]), Path(sys.argv[2]))
