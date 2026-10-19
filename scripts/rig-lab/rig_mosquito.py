"""Skin the CC BY adarshktk mosquito for Rig Lab.

Run with:
  blender --background --factory-startup --python scripts/rig-lab/rig_mosquito.py \
    -- ~/Downloads/mosquito.glb assets/rig-lab/mosquito-rig.glb

The original has twelve textured meshes but no bones or animations. This script
keeps its UVs/materials, splits the joined left/right surfaces, weights the
existing geometry to independently editable bones, and reduces 4K textures
for the browser. The original must be downloaded from the credited source:
https://sketchfab.com/3d-models/mosquito-474d2ea54af64114b2b5b1d2f6b18f8a
The output remains CC BY 4.0; see assets/rig-lab/SOURCE.LICENSE.txt.
"""

import bpy
import bmesh
import json
import os
import struct
import sys
from mathutils import Matrix, Vector


def check_source(path):
    with open(path, "rb") as file:
        header = file.read(20)
        magic, version, _, length, _ = struct.unpack("<4sIIII", header)
        if magic != b"glTF" or version != 2:
            raise ValueError("Expected the Sketchfab-converted mosquito GLB")
        gltf = json.loads(file.read(length))
    metadata = gltf.get("asset", {}).get("extras", {})
    if (
        metadata.get("source")
        != "https://sketchfab.com/3d-models/mosquito-474d2ea54af64114b2b5b1d2f6b18f8a"
        or not metadata.get("license", "").startswith("CC-BY-4.0")
        or len(gltf.get("meshes", [])) != 12
        or gltf.get("skins")
    ):
        raise ValueError("This is not the approved, unrigged CC BY textured mosquito")


def bone(armature, name, head, tail, parent=None):
    item = armature.edit_bones.new(name)
    item.head = head
    item.tail = tail
    if parent:
        item.parent = armature.edit_bones[parent]
        item.use_connect = False
    return item


def skin(obj, armature, assignments):
    """Bind using rest-world-space vertex positions (the mesh is already baked)."""
    assert len(assignments) == len(obj.data.vertices)
    groups = {}
    for index, influences in enumerate(assignments):
        for name, weight in influences.items():
            if weight < 0.00001:
                continue
            if name not in groups:
                groups[name] = obj.vertex_groups.new(name=name)
            group = groups[name]
            group.add([index], weight, "REPLACE")
    obj.parent = armature
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_world = Matrix.Identity(4)
    modifier = obj.modifiers.new("Joint skin", "ARMATURE")
    modifier.object = armature
    modifier.use_deform_preserve_volume = True


def rigid(obj, armature, bone_name):
    skin(obj, armature, [{bone_name: 1.0}] * len(obj.data.vertices))


def split_side(original, armature, left_name, right_name, assignments=None, bone_names=None):
    """Separate existing geometric halves; keep original loops, UVs and maps."""
    for side, name, joint in [
        (-1, left_name, bone_names[0] if bone_names else left_name),
        (1, right_name, bone_names[1] if bone_names else right_name),
    ]:
        instance = original.copy()
        instance.data = original.data.copy()
        bpy.context.collection.objects.link(instance)
        instance.matrix_world = original.matrix_world.copy()
        instance.data.transform(instance.matrix_world)
        instance.matrix_world = Matrix.Identity(4)
        mesh = bmesh.new()
        mesh.from_mesh(instance.data)
        mesh.verts.ensure_lookup_table()
        for vertex in list(mesh.verts):
            if (vertex.co.x < 0) != (side < 0):
                bmesh.ops.delete(mesh, geom=[vertex], context="VERTS")
        mesh.to_mesh(instance.data)
        mesh.free()
        instance.name = name
        if len(instance.data.vertices) < 100:
            raise ValueError(f"The mosquito's {name} surface cannot be separated")
        if assignments:
            skin(instance, armature, [assignments(side, v.co) for v in instance.data.vertices])
        else:
            rigid(instance, armature, joint)
    bpy.data.objects.remove(original, do_unlink=True)


def knee_weights(hip, knee, amount):
    bend = max(0, min(1, amount))
    return {hip: 1 - bend, knee: bend}


def clamp_transition(value, start, end):
    x = max(0, min(1, (value - start) / (end - start)))
    return x * x * (3 - 2 * x)


def retain_source_attribution(path):
    """Blender drops Sketchfab's asset.extras; keep the license inside the GLB."""
    with open(path, "rb") as file:
        raw = file.read()
    _, version, _, json_size, json_type = struct.unpack("<4sIIII", raw[:20])
    if version != 2 or json_type != 0x4E4F534A:
        raise ValueError("Expected Blender's GLB JSON chunk")
    gltf = json.loads(raw[20:20 + json_size])
    gltf["asset"]["extras"] = {
        "author": "adarshktk (https://sketchfab.com/adarshktk)",
        "license": "CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)",
        "source": "https://sketchfab.com/3d-models/mosquito-474d2ea54af64114b2b5b1d2f6b18f8a",
        "title": "Mosquito - articulated Morphazoid derivative",
        "modifications": "21 new bones; paired wing/leg geometry split; 2K color and 1K normal/ORM textures",
    }
    encoded = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((-len(encoded)) % 4)
    binary_chunk = raw[20 + json_size:]
    output = (
        struct.pack("<4sII", b"glTF", 2, 20 + len(encoded) + len(binary_chunk))
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded + binary_chunk
    )
    with open(path, "wb") as file:
        file.write(output)


def main(source_path, output_path):
    check_source(source_path)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=source_path)

    original = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if [len(obj.data.vertices) for obj in original] != [
        441, 2784, 2586, 2334, 962, 962, 441, 1450, 962, 962, 3913, 441
    ]:
        raise ValueError("Unexpected source mesh order; refusing to skin wrong anatomy")
    for obj in original:
        obj.data.transform(obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)

    rig_data = bpy.data.armatures.new("Mosquito armature")
    rig = bpy.data.objects.new("Textured Mosquito Rig", rig_data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bone(rig_data, "root", (0, 0.45, 0.48), (0, 0.85, 0.48))
    bone(rig_data, "thorax", (0, 0.25, 0.4), (0, 0.9, 0.46), "root")
    bone(rig_data, "head", (0, 0.05, 0.36), (0, -0.23, 0.35), "thorax")
    bone(rig_data, "abdomen", (0, 1.18, 0.56), (0, 2.25, 0.55), "thorax")
    bone(rig_data, "probe", (0, -0.24, 0.28), (0, -0.7, -0.28), "head")
    for side, suffix in [(-1, "left"), (1, "right")]:
        bone(rig_data, f"wing_{suffix}", (side * 0.07, 0.84, 0.38),
             (side * 0.85, 0.84, 0.5), "thorax")
        for section, hip, joint, tip in [
            ("front", (side * 0.04, 0.49, 0.82),
             (side * 0.51, 0.38, 1.26), (side * 1.0, 0.22, 1.72)),
            ("middle", (side * 0.08, 0.78, 0.43),
             (side * 0.58, 0.5, 0.33), (side * 0.84, 0.16, 0.05)),
            ("rear", (side * 0.04, 0.91, 0.72),
             (side * 0.5, 1.28, 0.82), (side * 1.16, 2.72, 0.48)),
        ]:
            prefix = f"leg_{suffix}_{section}"
            bone(rig_data, prefix + "_hip", hip, joint, "thorax")
            bone(rig_data, prefix + "_knee", joint, tip, prefix + "_hip")
        bone(rig_data, f"antenna_{suffix}", (side * 0.04, 0.63, 0.84),
             (side * 1.4, 0.48, 2.17), "head")
    bpy.ops.object.mode_set(mode="OBJECT")

    # The two pairs of rear/middle legs and the wing membrane were exported as
    # joined mirrored meshes, so physically split them at the symmetry plane.
    split_side(original[1], rig, "leg_left_rear", "leg_right_rear",
               lambda side, pos: knee_weights(
                   f"leg_{'left' if side < 0 else 'right'}_rear_hip",
                   f"leg_{'left' if side < 0 else 'right'}_rear_knee",
                   clamp_transition(pos.y, 1.18, 1.44)))
    split_side(original[2], rig, "leg_left_middle", "leg_right_middle",
               lambda side, pos: knee_weights(
                   f"leg_{'left' if side < 0 else 'right'}_middle_hip",
                   f"leg_{'left' if side < 0 else 'right'}_middle_knee",
                   clamp_transition(abs(pos.x), 0.51, 0.69)))
    split_side(original[3], rig, "wing_left_surface", "wing_right_surface",
               bone_names=("wing_left", "wing_right"))

    named = [
        (0, "eye_right", "head"), (6, "eye_left", "head"),
        (11, "head_shell", "head"), (7, "proboscis", "probe"),
        (5, "antenna_right", "antenna_right"),
        (9, "antenna_left", "antenna_left"),
    ]
    for index, name, joint in named:
        original[index].name = name
        rigid(original[index], rig, joint)
    for index, suffix in [(4, "right"), (8, "left")]:
        obj = original[index]
        obj.name = f"leg_{suffix}_front"
        skin(obj, rig, [
            knee_weights(f"leg_{suffix}_front_hip", f"leg_{suffix}_front_knee",
                         clamp_transition(abs(v.co.x), 0.45, 0.64))
            for v in obj.data.vertices
        ])
    body = original[10]
    body.name = "body_shell"
    skin(body, rig, [
        knee_weights("thorax", "abdomen", clamp_transition(v.co.y, 1.09, 1.55))
        for v in body.data.vertices
    ])

    # Sketchfab's original embeds three 4096px PNGs (~52 MB). Keep the diffuse
    # map detailed at 2K while limiting the utility maps to 1K. Resizing the
    # Blender images before export preserves UVs, including the wing opacity.
    for image in bpy.data.images:
        if image.source != "FILE" or image.size[0] < 2048:
            continue
        # Blender presents all imported images as RGBA, including the original
        # RGB normal/ORM maps. Sketchfab's Image_0 is the actual color+alpha map.
        pixels = 2048 if image.name == "Image_0" else 1024
        image.scale(pixels, pixels)
        image.pack()

    for obj in bpy.context.scene.objects:
        obj.select_set(obj == rig or obj.type == "MESH" and obj.parent == rig)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_extras=True,
    )
    retain_source_attribution(output_path)
    print("Exported", output_path, os.path.getsize(output_path), "bytes", flush=True)


if __name__ == "__main__":
    if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1:]) != 2:
        raise SystemExit("Usage: blender -b --python rig_mosquito.py -- source.glb out.glb")
    main(*sys.argv[sys.argv.index("--") + 1:])
