#!/usr/bin/env python3
"""Prepare the real CC0 Argiope scan: remove the calibration cube and author a skin.

Usage: python scripts/spider-build-asset.py /path/to/extracted/gltf output.glb
Requires numpy, scipy and Pillow for offline preparation only. No decimation.
The authored four-link legs group the specimen's smaller anatomical segments;
this is a playable approximation, not a supplied or measured biological rig.
"""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter1d
from PIL import Image
import io
import struct

source = Path(sys.argv[1])
target = Path(sys.argv[2])
gltf = json.loads((source / 'scene.gltf').read_text())
binary = (source / 'scene.bin').read_bytes()


def array(index):
    a = gltf['accessors'][index]
    v = gltf['bufferViews'][a['bufferView']]
    dt = {5126: '<f4', 5125: '<u4', 5123: '<u2'}[a['componentType']]
    n = {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[a['type']]
    return np.ndarray((a['count'], n), dtype=dt, buffer=binary,
                      offset=v.get('byteOffset', 0) + a.get('byteOffset', 0),
                      strides=(v.get('byteStride', np.dtype(dt).itemsize * n),
                               np.dtype(dt).itemsize)).copy()


positions, normals, uvs, faces = [], [], [], []
for mesh in gltf['meshes'][1:]:  # Mesh 0 is the explicitly named calibration Cube.
    for p in mesh['primitives']:
        faces.append(array(p['indices']).reshape(-1, 3) + sum(map(len, positions)))
        positions.append(array(p['attributes']['POSITION']))
        normals.append(array(p['attributes']['NORMAL']))
        uvs.append(array(p['attributes']['TEXCOORD_0']))
positions = np.concatenate(positions)
normals = np.concatenate(normals)
uvs = np.concatenate(uvs)
faces = np.concatenate(faces)
matrix = np.array(gltf['nodes'][5]['matrix']).reshape(4, 4).T
world = (np.c_[positions, np.ones(len(positions))] @ matrix.T)[:, :3]
normal_matrix = np.linalg.inv(matrix[:3, :3]).T
normals = normals @ normal_matrix.T
normals /= np.linalg.norm(normals, axis=1)[:, None]
# Source meters -> instrument units. Body length ~.25, leg span ~.80.
canonical = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]])
center = np.array([-.003, -.0005, 0])
vertices = (world - center) @ canonical.T * 10
normals = normals @ canonical.T

# Eight connected outer legs provide unambiguous branch seeds even though the
# original animal is a single surface. Position welding is for analysis only;
# UV-split source vertices and every spider triangle remain in the output.
points, weld = np.unique(np.round(world * 1000, 4), axis=0, return_inverse=True)
wf = weld[faces]
edges = np.concatenate([wf[:, [0, 1]], wf[:, [1, 2]], wf[:, [2, 0]]])
edges = np.unique(np.sort(edges, axis=1), axis=0)
edges = np.concatenate([edges, edges[:, ::-1]])
lengths = np.linalg.norm(points[edges[:, 0]] - points[edges[:, 1]], axis=1)
graph = coo_matrix((lengths, (edges[:, 0], edges[:, 1])), shape=(len(points), len(points))).tocsr()
outer = (points[:, 0] < -10) | (points[:, 0] > 22) | (np.abs(points[:, 2]) > 7)
leg_edges = edges[np.all(outer[edges], axis=1)]
adj = coo_matrix((np.ones(len(leg_edges)), (leg_edges[:, 0], leg_edges[:, 1])), shape=graph.shape)
_, labels = connected_components(adj, directed=False)
counts = np.bincount(labels)
branches = [np.where(labels == i)[0] for i in np.argsort(counts)[-8:]]
assert min(map(len, branches)) > 1000
left = sorted([b for b in branches if points[b, 2].mean() < 0], key=lambda b: points[b, 0].mean())
right = sorted([b for b in branches if points[b, 2].mean() > 0], key=lambda b: points[b, 0].mean())
assert len(left) == len(right) == 4
all_bones = []
leg_data = []


def canonical_point(mm):
    return ((np.array(mm) / 1000 - center) @ canonical.T * 10).tolist()


def bone(id, name, group, pivot, parent=None, **extra):
    record = dict(id=id, name=name, groupId=group, pivot=list(pivot), parent=parent, **extra)
    all_bones.append(record)
    return record


bone('cephalothorax', 'Cephalothorax', 'cephalothorax', [0, 0, 0])
bone('abdomen', 'Abdomen', 'abdomen', canonical_point([.2, -.7, 0]), 'cephalothorax')
for kind, group, x, y, z in [('pedipalp', 'pedipalps', -7.5, -2, 2.1), ('chelicera', 'chelicerae', -8, -2, .8)]:
    for side, sign in [('left', -1), ('right', 1)]:
        bone(f'{kind}_{side}', f'{side.title()} {kind}', group,
             canonical_point([x, y, z * sign]), 'cephalothorax', side=side)

tree = cKDTree(points)
for side, sign, side_branches in [('left', -1, left), ('right', 1, right)]:
    for number, branch in enumerate(side_branches, 1):
        hip = np.array([[-5.8, -1.3, 2.9], [-3.9, -1.5, 3.3], [-1.8, -1.5, 3.4], [0, -1.5, 2.8]][number - 1])
        hip[2] *= sign
        # Start on the branch surface, then follow weighted graph distance.
        seed = branch[np.argmin(np.linalg.norm(points[branch] - hip, axis=1))]
        distance = dijkstra(graph, directed=False, indices=seed)
        far = branch[np.argmax(distance[branch])]
        # Medians of narrow geodesic shells estimate the centerline without
        # depending on mesh tessellation density around the segment.
        offset = np.linalg.norm(points[seed] - hip)
        total = float(distance[far] + offset)
        curve = [hip]
        for t in np.linspace(.04, 1, 49):
            g = total * t - offset
            if g < 0:
                curve.append(hip + (points[seed] - hip) * max(0, t * total / max(offset, 1e-6)))
            else:
                selected = branch[np.abs(distance[branch] - g) < max(.22, total * .018)]
                if len(selected) < 3:
                    selected = branch[np.argsort(np.abs(distance[branch] - g))[:12]]
                curve.append(np.median(points[selected], axis=0))
        curve = np.array(curve)
        curve = gaussian_filter1d(curve, .7, axis=0)
        curve[0] = hip
        # Four broad links retain the visible knee and distal bends. Small
        # patella/coxa subdivisions are grouped rather than falsely recovered.
        tangent = np.diff(curve, axis=0)
        tangent /= np.maximum(1e-8, np.linalg.norm(tangent, axis=1))[:, None]
        bend = np.linalg.norm(np.diff(tangent, axis=0), axis=1)
        knee_i = 11 + int(np.argmax(bend[11:32]))
        knee_i = max(14, min(31, knee_i + 1))
        ankle_i = min(41, max(knee_i + 7, 34))
        tip_i = 44
        indices = [0, knee_i, ankle_i, tip_i, len(curve) - 1]
        anchors = [canonical_point(curve[i]) for i in indices]
        parent = 'cephalothorax'
        joint_ids = []
        for segment, p in zip(['hip', 'knee', 'ankle', 'tip'], anchors):
            id = f'leg_{side}_{number}_{segment}'
            bone(id, f'{side.title()} leg {number} {segment}', 'legs', p,
                 parent, side=side, leg=number, segment=segment)
            parent = id
            joint_ids.append(id)
        leg_data.append(dict(id=f'leg_{side}_{number}', side=side, number=number,
                             jointIds=joint_ids, anchors=anchors,
                             lengths=np.linalg.norm(np.diff(anchors, axis=0), axis=1).tolist(),
                             curve=[canonical_point(p) for p in curve], sourceBranchVertices=len(branch)))

# Bind each source vertex to the closest anatomical capsule. Blend adjacent
# joints only near hinges, preserving the photographed exoskeleton elsewhere.
# The body ellipsoids beat leg capsules inside the cephalothorax/abdomen.
nv = len(vertices)
distance_fields = []
weight_indices = []
weight_values = []
bone_index = {b['id']: i for i, b in enumerate(all_bones)}


def segment_distance(a, b):
    a, b = np.array(a), np.array(b)
    delta = b - a
    t = np.clip((vertices - a) @ delta / max(1e-12, delta @ delta), 0, 1)
    return np.linalg.norm(vertices - (a + t[:, None] * delta), axis=1), t


for data in leg_data:
    for n, (a, b) in enumerate(zip(data['anchors'], data['anchors'][1:])):
        distance, t = segment_distance(a, b)
        distance_fields.append(distance)
        idx = bone_index[data['jointIds'][n]]
        next_idx = bone_index[data['jointIds'][min(n + 1, 3)]]
        # Smooth only around a link's far boundary; no whole-limb rubber bend.
        blend = np.clip((t - .82) / .18, 0, 1) * .5 if n < 3 else np.zeros(nv)
        weight_indices.append(np.c_[np.full(nv, idx), np.full(nv, next_idx)])
        weight_values.append(np.c_[1 - blend, blend])

distance_fields = np.array(distance_fields)
winner = np.argmin(distance_fields, axis=0)
skin_indices = np.zeros((nv, 4), dtype='<u2')
skin_weights = np.zeros((nv, 4), dtype='<f4')
for i in range(len(distance_fields)):
    selected = winner == i
    skin_indices[selected, :2] = weight_indices[i][selected]
    skin_weights[selected, :2] = weight_values[i][selected]

# Explicit body/mouth regions are in the original specimen's physical axes.
mm = world * 1000
body = ((mm[:, 0] + 3.8) / 5.9) ** 2 + (mm[:, 2] / 4.7) ** 2 < 1
abdomen = ((mm[:, 0] - 10) / 10.6) ** 2 + (mm[:, 2] / 7.1) ** 2 < 1
abdomen &= mm[:, 0] > .1
for mask, idx in [(body, 0), (abdomen, 1)]:
    skin_indices[mask] = 0
    skin_indices[mask, 0] = idx
    skin_weights[mask] = [1, 0, 0, 0]
mouth = (mm[:, 0] < -7.4) & (mm[:, 0] > -11) & (mm[:, 1] < -.8) & (np.abs(mm[:, 2]) < 3.2)
for side, sign in [('left', -1), ('right', 1)]:
    for kind, outer_mouth in [('pedipalp', True), ('chelicera', False)]:
        mask = mouth & (mm[:, 2] * sign >= 0) & ((np.abs(mm[:, 2]) > 1.25) if outer_mouth else (np.abs(mm[:, 2]) <= 1.25))
        skin_indices[mask] = 0
        skin_indices[mask, 0] = bone_index[f'{kind}_{side}']
        skin_weights[mask] = [1, 0, 0, 0]
assert len(all_bones) == 38
assert np.allclose(skin_weights.sum(axis=1), 1)

out = dict(asset=dict(version='2.0', generator='Morphazoid CC0 Argiope scan skin preparation',
                     extras=dict(source='https://sketchfab.com/3d-models/cc0-orb-weaver-spider-a-bruennichi-bb646be39dad44948a403366b0ebc977',
                                 author='Yuichi Kano / ffish.asia / floraZia.com', license='CC0-1.0',
                                 modifications='Calibration cube removed; canonical coordinates, authored38-joint skin, WebP color texture.')),
           scene=0, scenes=[dict(nodes=[0, 1])], nodes=[dict(name='Spider scan', mesh=0, skin=0)],
           buffers=[{}], bufferViews=[], accessors=[], meshes=[], skins=[], images=[], textures=[],
           samplers=[dict(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)],
           extensionsUsed=['EXT_texture_webp'], extensionsRequired=['EXT_texture_webp'])
chunks = bytearray()


def append(data, target_type=None):
    while len(chunks) % 4:
        chunks.append(0)
    index = len(out['bufferViews'])
    view = dict(buffer=0, byteOffset=len(chunks), byteLength=len(data))
    if target_type:
        view['target'] = target_type
    out['bufferViews'].append(view)
    chunks.extend(data)
    return index


def accessor(data, kind, component, target_type=None, bounds=False):
    data = np.ascontiguousarray(data)
    record = dict(bufferView=append(data.tobytes(), target_type), componentType=component,
                  count=len(data), type=kind)
    if bounds:
        record.update(min=data.min(axis=0).tolist(), max=data.max(axis=0).tolist())
    out['accessors'].append(record)
    return len(out['accessors']) - 1


attrs = dict(POSITION=accessor(vertices.astype('<f4'), 'VEC3', 5126, 34962, True),
             NORMAL=accessor(normals.astype('<f4'), 'VEC3', 5126, 34962),
             TEXCOORD_0=accessor(uvs.astype('<f4'), 'VEC2', 5126, 34962),
             JOINTS_0=accessor(skin_indices, 'VEC4', 5123, 34962),
             WEIGHTS_0=accessor(skin_weights, 'VEC4', 5126, 34962))
index = accessor(faces.astype('<u4').reshape(-1, 1), 'SCALAR', 5125, 34963)
out['meshes'] = [dict(name='Argiope bruennichi scanned surface', primitives=[dict(attributes=attrs, indices=index, material=0)])]
for b in all_bones:
    parent = all_bones[bone_index[b['parent']]] if b['parent'] else None
    translation = np.array(b['pivot']) - (np.array(parent['pivot']) if parent else 0)
    # `pivot` is reserved by Three's GLTFExporter pivot-container convention.
    # Our real skeletal transform is translation; custom evidence uses its own
    # name so GLTFLoader never rewrites the child bone's local position.
    extras = {key: value for key, value in b.items() if key != 'pivot'}
    extras.update(spiderJoint=True, spiderRestPivot=b['pivot'])
    out['nodes'].append(dict(name=b['id'], translation=translation.tolist(), children=[], extras=extras))
for i, b in enumerate(all_bones):
    if b['parent']:
        out['nodes'][bone_index[b['parent']] + 1]['children'].append(i + 1)
inverses = np.tile(np.eye(4), (38, 1, 1))
for i, b in enumerate(all_bones):
    inverses[i, :3, 3] = -np.array(b['pivot'])
inverse_accessor = accessor(inverses.transpose(0, 2, 1).astype('<f4').reshape(38, 16), 'MAT4', 5126)
out['skins'] = [dict(name='Authored approximate38-joint Spider skin', joints=list(range(1, 39)),
                    skeleton=1, inverseBindMatrices=inverse_accessor)]
image = Image.open(source / 'textures/QS1476-W08-1-5_baseColor.jpeg')
encoded = io.BytesIO()
image.save(encoded, format='WEBP', quality=92, method=6)
out['images'] = [dict(bufferView=append(encoded.getvalue()), mimeType='image/webp', name='Original4K color atlas, WebP q92')]
out['textures'] = [dict(sampler=0, extensions=dict(EXT_texture_webp=dict(source=0)))]
out['materials'] = [dict(name='Photographed spider cuticle', doubleSided=True,
                         pbrMetallicRoughness=dict(baseColorTexture=dict(index=0), metallicFactor=0,
                                                  roughnessFactor=.86))]
out['buffers'][0]['byteLength'] = len(chunks)
while len(chunks) % 4:
    chunks.append(0)
json_bytes = json.dumps(out, separators=(',', ':')).encode()
json_bytes += b' ' * ((4 - len(json_bytes) % 4) % 4)
data = struct.pack('<III', 0x46546c67, 2, 28 + len(json_bytes) + len(chunks))
data += struct.pack('<II', len(json_bytes), 0x4e4f534a) + json_bytes
data += struct.pack('<II', len(chunks), 0x004e4942) + chunks
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(data)
manifest = dict(version=1, species='Argiope bruennichi', units='web radius1; source meters multiplied by10',
                axis=dict(up='+Y', forward='+Z', right='+X'), bodyLength=.25, bodyHeight=.06,
                joints=all_bones, legs=leg_data, triangles=len(faces), vertices=len(vertices),
                texture=dict(width=image.width, height=image.height, encoding='WebP q92', bytes=len(encoded.getvalue())),
                sourceSha256=hashlib.sha256(binary).hexdigest(), outputSha256=hashlib.sha256(data).hexdigest(),
                caveat='Approximate authored articulation of a real static photogrammetry surface; small mouth and grouped leg segments are not measured biological joints.')
# Measured per-specimen collision surrogates. GLB surface/binds stay unchanged.
manifest['id'] = 'argiope'
manifest['collision'] = dict(bodies=[])
for idx, id in enumerate(['cephalothorax', 'abdomen']):
    selected = vertices[skin_indices[:, 0] == idx]
    lo, hi = np.quantile(selected, [.005, .995], axis=0)
    manifest['collision']['bodies'].append(dict(jointId=id, center=((lo + hi) / 2).tolist(), radii=((hi - lo) / 2 * .98).tolist()))
manifest['neutralBodyHeight'] = max(.06, max(b['radii'][1] - b['center'][1] for b in manifest['collision']['bodies']) + .014)
for leg in leg_data:
    leg['radii'] = []
    for segment, id in enumerate(leg['jointIds']):
        a, b = np.array(leg['anchors'][segment]), np.array(leg['anchors'][segment + 1])
        delta = b - a; axial = (vertices - a) @ delta / (delta @ delta)
        radial = np.linalg.norm(vertices - (a + axial[:, None] * delta), axis=1)
        selected = skin_indices[:, 0] == bone_index[id]
        central = selected & (axial > .18) & (axial < .8)
        measured = radial[central] if central.sum() >= 24 else radial[selected]
        leg['radii'].append(float(np.clip(np.quantile(measured, .82), .001, .05)))
(target.parent / 'rig-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
np.savez('/tmp/spider-source/prepared.npz', vertices=vertices, indices=skin_indices, weights=skin_weights, faces=faces)
print(json.dumps(dict(bytes=len(data), triangles=len(faces), bones=len(all_bones), sha256=manifest['outputSha256'])))
