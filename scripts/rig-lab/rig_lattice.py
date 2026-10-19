"""Skin David Hall's CC BY 4.0 lattice to Rig Lab's 12 icosahedral joints.

blender --background --factory-startup --python scripts/rig-lab/rig_lattice.py \
  -- ~/Downloads/3d_lattice_of_icosahedra_and_octahedra.glb \
     assets/rig-lab/lattice-rig.glb

The source is a fixed, interlocking polyhedral topology (not a parametric
model). Its 2,600 tiny triangle objects are joined into one skinned mesh.
The 12 deform bones provide a smooth spatial envelope; the separate, exact
solver owns the icosahedral joints, edge lengths and audio. Octahedron and
tetrahedron modes continue to use the solver's procedural surfaces.
"""

import bpy
import hashlib
import json
import os
import struct
import sys
from math import sqrt
from mathutils import Matrix, Vector


SOURCE_SHA256 = "cbc243411ff629a955794bff4588db070fa5f37c3553372c8ad86de204299600"
SOURCE_URL = (
    "https://sketchfab.com/3d-models/"
    "3d-lattice-of-icosahedra-and-octahedra-c58fa5bbb8a74ef7ac6fc477715e1fc3"
)


def validate_source(path):
    with open(path, "rb") as file:
        raw = file.read()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError("This is not the approved David Hall lattice download")
    if raw[:4] != b"glTF" or struct.unpack_from("<I", raw, 4)[0] != 2:
        raise ValueError("Expected a glTF 2.0 binary file")
    gltf = json.loads(raw[20:20 + struct.unpack_from("<I", raw, 12)[0]])
    extras = gltf["asset"]["extras"]
    if (extras["source"] != SOURCE_URL or not extras["license"].startswith("CC-BY-4.0")
            or len(gltf.get("meshes", [])) != 2600 or gltf.get("skins")):
        raise ValueError("The source is not the approved unskinned CC BY lattice")


def icosahedron():
    phi = (1 + sqrt(5)) / 2
    points = []
    # Same ordering and orientation as src/instruments/polyhedral-lattice/demo-model.js.
    for a in (-1, 1):
        for b in (-1, 1):
            points.extend(((0, a, b * phi), (a, b * phi, 0), (a * phi, 0, b)))
    return [Vector(point).normalized() for point in points]


def smoothstep(value, start, end):
    t = min(1.0, max(0.0, (value - start) / (end - start)))
    return t * t * (3 - 2 * t)


def add_rig(mesh):
    points = icosahedron()
    armature = bpy.data.armatures.new("Twelve editable lattice joints")
    rig = bpy.data.objects.new("David Hall lattice - articulated derivative", armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    root = armature.edit_bones.new("root")
    root.head, root.tail = (0, -0.16, 0), (0, 0.16, 0)
    for index, point in enumerate(points):
        joint = armature.edit_bones.new(f"joint_{index:02d}")
        joint.head, joint.tail = point, point + Vector((0, 0.13, 0))
        joint.parent = root
        joint.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")

    root_group = mesh.vertex_groups.new(name="root")
    joint_groups = [mesh.vertex_groups.new(name=f"joint_{i:02d}") for i in range(12)]
    for vertex in mesh.data.vertices:
        p = vertex.co
        # Keep the interior steady and move the outer polyhedral facets with
        # the three closest joint handles, without sharp Voronoi weight seams.
        falloff = smoothstep(p.length, 0.13, 0.75)
        if falloff < 0.99999:
            root_group.add([vertex.index], 1 - falloff, "REPLACE")
        if falloff < 0.00001:
            continue
        nearest = sorted(
            ((1 / (0.14 + (p - point).length) ** 6, index)
             for index, point in enumerate(points)), reverse=True
        )[:3]
        total = sum(score for score, _ in nearest)
        for score, index in nearest:
            joint_groups[index].add([vertex.index], falloff * score / total, "REPLACE")

    mesh.parent = rig
    mesh.matrix_parent_inverse = Matrix.Identity(4)
    mesh.matrix_world = Matrix.Identity(4)
    modifier = mesh.modifiers.new("Movable icosahedral joints", "ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    return rig


def retain_attribution(path):
    """The Blender exporter omits Sketchfab asset.extras; restore them in GLB."""
    with open(path, "rb") as file:
        raw = file.read()
    if raw[:4] != b"glTF" or struct.unpack_from("<I", raw, 16)[0] != 0x4E4F534A:
        raise ValueError("Expected an exported GLB")
    length = struct.unpack_from("<I", raw, 12)[0]
    gltf = json.loads(raw[20:20 + length])
    gltf["asset"]["extras"] = {
        "title": "3D Lattice of Icosahedra and Octahedra - articulated Morphazoid derivative",
        "author": "David Hall (https://sketchfab.com/davidhall)",
        "license": "CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)",
        "source": SOURCE_URL,
        "modifications": (
            "Joined 2600 original pieces; normalized coordinates; added one root and "
            "twelve spatially weighted deform bones. Fixed original mesh topology."
        ),
    }
    encoded = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    binary = raw[20 + length:]
    with open(path, "wb") as file:
        file.write(struct.pack("<4sII", b"glTF", 2, 20 + len(encoded) + len(binary)))
        file.write(struct.pack("<II", len(encoded), 0x4E4F534A))
        file.write(encoded)
        file.write(binary)


def main(source, output):
    validate_source(source)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=source)
    parts = [ob for ob in bpy.context.scene.objects if ob.type == "MESH"]
    if len(parts) != 2600:
        raise ValueError("Unexpected number of source mesh objects")
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    mesh = bpy.context.view_layer.objects.active
    if len(mesh.data.polygons) != 5200:
        raise ValueError("Expected 5200 original triangles")
    mesh.data.transform(mesh.matrix_world)
    mesh.matrix_world = Matrix.Identity(4)
    # The download is centred on the origin and has a half-extent of 55.4508.
    # Normalize to the same unit sphere used by the editable icosahedron.
    extent = max(abs(co) for vertex in mesh.data.vertices for co in vertex.co)
    if not 55 < extent < 56:
        raise ValueError("Unexpected source coordinates")
    mesh.data.transform(Matrix.Scale(1 / extent, 4))
    mesh.name = "David Hall original lattice surfaces"
    rig = add_rig(mesh)
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output, export_format="GLB", use_selection=True,
        export_animations=False, export_extras=True, export_yup=False,
    )
    retain_attribution(output)
    print("Exported", output, os.path.getsize(output), "bytes", flush=True)


if __name__ == "__main__":
    if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1:]) != 2:
        raise SystemExit("Usage: blender -b --python rig_lattice.py -- source.glb out.glb")
    main(*sys.argv[sys.argv.index("--") + 1:])
