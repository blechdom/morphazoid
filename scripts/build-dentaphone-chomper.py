#!/usr/bin/env python3
"""Build Dentaphone's hinged 32-tooth GLB from MakeHuman's CC0 teeth.

Source archive:
  https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/
  makehuman_system_assets_cc0.zip
Internal path:
  teeth/teeth_base/teeth_base.obj

Run with Blender 4.x:
  blender --background --python scripts/build-dentaphone-chomper.py -- \
    teeth_base.obj assets/models/dentaphone-chomper.glb

The source OBJ SHA-256 used for the checked-in GLB is
f55198069e55d360c4b4cc7ecb1cc292b2c7665753ab8b65eabf46a8783f2875.
"""

import hashlib
import pathlib
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


SOURCE_URL = (
    "https://static.makehumancommunity.org/assets/assetpacks/"
    "makehuman_system_assets.html"
)
ARCHIVE_URL = (
    "https://files2.makehumancommunity.org/asset_packs/"
    "makehuman_system_assets/makehuman_system_assets_cc0.zip"
)
SOURCE_SHA256 = "f55198069e55d360c4b4cc7ecb1cc292b2c7665753ab8b65eabf46a8783f2875"
ARCH_SCORE_SPLIT = 6.55
MODEL_SCALE = 100.0


def arguments():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) != 2:
        raise SystemExit("Expected input OBJ and output GLB paths after --")
    return pathlib.Path(values[0]).resolve(), pathlib.Path(values[1]).resolve()


def verify_source_hash(source):
    digest = hashlib.sha256()
    with source.open("rb") as source_file:
        for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(chunk)
    actual_sha256 = digest.hexdigest()
    if actual_sha256 != SOURCE_SHA256:
        raise RuntimeError(
            "Dentaphone source OBJ SHA-256 mismatch: "
            f"expected {SOURCE_SHA256}, got {actual_sha256} for {source}"
        )


def object_bounds(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = Vector(min(point[axis] for point in points) for axis in range(3))
    maximum = Vector(max(point[axis] for point in points) for axis in range(3))
    return minimum, maximum, (minimum + maximum) * 0.5


def smooth_mesh(obj):
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def arch_score(obj):
    """Return MakeHuman's Y + .25 Z score after Blender's OBJ axis conversion."""
    center = object_bounds(obj)[2]
    return center.z - 0.25 * center.y


def ordered_arch(objects):
    """Order rear-left through incisors to rear-right for the 16 pitch slots."""
    negative = [obj for obj in objects if object_bounds(obj)[2].x < 0]
    positive = [obj for obj in objects if object_bounds(obj)[2].x > 0]
    if len(negative) != 8 or len(positive) != 8:
        raise RuntimeError(
            f"Expected eight teeth per side, found {len(negative)} and {len(positive)}"
        )
    negative.sort(key=lambda obj: object_bounds(obj)[2].y, reverse=True)
    positive.sort(key=lambda obj: object_bounds(obj)[2].y)
    return negative + positive


def bake_centered_mesh(obj, center_offset):
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    for vertex in obj.data.vertices:
        vertex.co = (vertex.co - center_offset) * MODEL_SCALE


def split_gum(source, name, keep_upper, split_z, center_offset, material, parent):
    """Cut MakeHuman's connected mouth shell into independently hinged halves."""
    obj = source.copy()
    obj.data = source.data.copy()
    bpy.context.collection.objects.link(obj)
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)

    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    bmesh.ops.bisect_plane(
        mesh,
        geom=[*mesh.verts, *mesh.edges, *mesh.faces],
        dist=0.00001,
        plane_co=Vector((0, 0, split_z)),
        plane_no=Vector((0, 0, 1)),
        clear_inner=keep_upper,
        clear_outer=not keep_upper,
    )
    mesh.to_mesh(obj.data)
    mesh.free()

    for vertex in obj.data.vertices:
        vertex.co = (vertex.co - center_offset) * MODEL_SCALE
    obj.name = name
    obj.data.name = f"{name}-mesh"
    obj.data.materials.clear()
    obj.data.materials.append(material)
    smooth_mesh(obj)
    obj.parent = parent
    obj["dentaphonePart"] = "gum"
    return obj


def main():
    source, output = arguments()
    if not source.is_file():
        raise FileNotFoundError(source)
    verify_source_hash(source)
    output.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.wm.obj_import(filepath=str(source))
    imported = bpy.context.selected_objects[0]
    bpy.context.view_layer.objects.active = imported
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")

    components = list(bpy.context.selected_objects)
    if len(components) != 33:
        raise RuntimeError(f"Expected 33 loose components, found {len(components)}")
    gum_source = max(components, key=lambda obj: len(obj.data.vertices))
    teeth = [obj for obj in components if obj is not gum_source]
    if len(gum_source.data.vertices) != 1852:
        raise RuntimeError("The MakeHuman mouth shell no longer matches the source contract")
    if len(teeth) != 32 or any(len(obj.data.vertices) != 63 for obj in teeth):
        raise RuntimeError("Expected 32 independent 63-vertex MakeHuman tooth shells")

    upper_teeth = [obj for obj in teeth if arch_score(obj) >= ARCH_SCORE_SPLIT]
    lower_teeth = [obj for obj in teeth if arch_score(obj) < ARCH_SCORE_SPLIT]
    if len(upper_teeth) != 16 or len(lower_teeth) != 16:
        raise RuntimeError(
            f"Arch classifier produced {len(upper_teeth)} upper and "
            f"{len(lower_teeth)} lower teeth"
        )

    centers = [object_bounds(obj)[2] for obj in teeth]
    center_offset = Vector(
        (
            sum(center.x for center in centers) / len(centers),
            sum(center.y for center in centers) / len(centers),
            sum(center.z for center in centers) / len(centers),
        )
    )
    split_z = center_offset.z

    enamel = bpy.data.materials.new("Dentaphone Enamel")
    enamel.diffuse_color = (0.72, 0.62, 0.43, 1.0)
    enamel.roughness = 0.42
    gum = bpy.data.materials.new("Dentaphone Gum")
    gum.diffuse_color = (0.22, 0.055, 0.045, 1.0)
    gum.roughness = 0.72

    root = bpy.data.objects.new("DentaphoneChomper", None)
    upper_parent = bpy.data.objects.new("UpperJaw", None)
    lower_parent = bpy.data.objects.new("LowerJaw", None)
    for obj in (root, upper_parent, lower_parent):
        bpy.context.collection.objects.link(obj)
    upper_parent.parent = root
    lower_parent.parent = root
    upper_parent["dentaphoneArch"] = "upper"
    lower_parent["dentaphoneArch"] = "lower"

    for arch, objects, parent in (
        ("upper", upper_teeth, upper_parent),
        ("lower", lower_teeth, lower_parent),
    ):
        for index, obj in enumerate(ordered_arch(objects), 1):
            bake_centered_mesh(obj, center_offset)
            obj.name = f"{arch}-{index:02d}"
            obj.data.name = f"{obj.name}-mesh"
            obj.data.materials.clear()
            obj.data.materials.append(enamel)
            smooth_mesh(obj)
            obj.parent = parent
            obj["dentaphonePart"] = "tooth"
            obj["dentaphoneArch"] = arch
            obj["dentaphoneIndex"] = index - 1

    split_gum(
        gum_source,
        "upper-gum",
        True,
        split_z,
        center_offset,
        gum,
        upper_parent,
    )
    split_gum(
        gum_source,
        "lower-gum",
        False,
        split_z,
        center_offset,
        gum,
        lower_parent,
    )
    bpy.data.objects.remove(gum_source, do_unlink=True)

    root["source"] = "MakeHuman system asset: teeth_base"
    root["sourceUrl"] = SOURCE_URL
    root["sourceArchive"] = ARCHIVE_URL
    root["sourceSha256"] = SOURCE_SHA256
    root["license"] = "CC0 1.0 Universal"
    root["adaptation"] = "32 named teeth, split gum shell, jaw groups, display scale"

    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_extras=True,
        export_materials="EXPORT",
        export_yup=True,
    )
    print(f"Wrote {output} with 32 native playable tooth meshes")


if __name__ == "__main__":
    main()
