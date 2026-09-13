#!/usr/bin/env python3
"""Rig an individually calibrated real spider scan for Spider Synth.

python3 scripts/spider-build-skins.py SKIN_ID /path/to/extracted/gltf output.glb
Offline dependencies: NumPy, SciPy, Pillow. No triangles are removed from the
animal; only the publisher's separate calibration object is excluded. Landmarks
are authored from orthographic source inspection; four broad walking-leg links
and small mouth regions are a playable approximation, not measured anatomy.
"""
from pathlib import Path
import hashlib
import io
import json
import struct
import sys
import numpy as np
from scipy.spatial import cKDTree
from PIL import Image

skin_id, source_arg, target_arg = sys.argv[1:4]
source, target = Path(source_arg), Path(target_arg)
config = json.loads((Path(__file__).parent / 'spider-skin-landmarks' / f'{skin_id}.json').read_text())
gltf = json.loads((source / 'scene.gltf').read_text())
binary = (source / 'scene.bin').read_bytes()

def array(index):
    a = gltf['accessors'][index]
    v = gltf['bufferViews'][a['bufferView']]
    dt = {5126: '<f4', 5125: '<u4', 5123: '<u2'}[a['componentType']]
    n = {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[a['type']]
    return np.ndarray((a['count'], n), dtype=dt, buffer=binary,
                      offset=v.get('byteOffset', 0) + a.get('byteOffset', 0),
                      strides=(v.get('byteStride', np.dtype(dt).itemsize * n), np.dtype(dt).itemsize)).copy()

positions, normals, uvs, faces = [], [], [], []
for mesh in gltf['meshes'][0 if skin_id == 'tarantula' else 1:]:
    for p in mesh['primitives']:
        faces.append(array(p['indices']).reshape(-1, 3) + sum(map(len, positions)))
        positions.append(array(p['attributes']['POSITION']))
        normals.append(array(p['attributes']['NORMAL']))
        uvs.append(array(p['attributes']['TEXCOORD_0']))
vertices, normals, uvs, faces = map(np.concatenate, (positions, normals, uvs, faces))
if skin_id == 'tarantula':
    matrix = np.array(gltf['nodes'][0]['matrix']).reshape(4, 4).T
    vertices = (np.c_[vertices, np.ones(len(vertices))] @ matrix.T)[:, :3]
    normals = normals @ np.linalg.inv(matrix[:3, :3])
center = (vertices.min(0) + vertices.max(0)) / 2
source_scale = 1 / np.ptp(vertices, axis=0).max()
canonical = np.array([[0, 0, -1], [0, 1, 0], [1, 0, 0]]) if skin_id == 'tarantula' else np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]])
vertices = ((vertices - center) * source_scale - config['origin']) @ canonical.T
normals = normals @ canonical.T
normals /= np.maximum(1e-12, np.linalg.norm(normals, axis=1))[:, None]
scale = config['uniformScale']
tree = cKDTree(vertices[:, [0, 2]])

def surface_point(xz, count=64):
    distance, ids = tree.query(xz, k=count)
    # The median of a local surface cross-section estimates its interior, not
    # the upper skin surface. X/Z remain the reviewed source landmarks.
    return [xz[0], float(np.median(vertices[ids, 1])), xz[1]]

bones, legs = [], []
def bone(id, name, group, point, parent=None, **extra):
    record = dict(id=id, name=name, groupId=group, pivot=(np.array(point) * scale).tolist(), parent=parent, **extra)
    bones.append(record)
    return record
bone('cephalothorax', 'Cephalothorax', 'cephalothorax', [0, 0, 0])
abdomen_pivot = np.array(config['abd']) * .35
bone('abdomen', 'Abdomen', 'abdomen', abdomen_pivot, 'cephalothorax')
for kind, group in [('pedipalp', 'pedipalps'), ('chelicera', 'chelicerae')]:
    for side, sign in [('left', -1), ('right', 1)]:
        x = config['mouthSplit'] * (1.45 if kind == 'pedipalp' else .5) * sign
        z = config['mouthFront'] + (.012 if kind == 'chelicera' else 0)
        if kind == 'pedipalp' and config.get('palpGuides'): x, z = config['palpGuides'][0 if side == 'left' else 1]['pivot']
        bone(f'{kind}_{side}', f'{side.title()} {kind}', group, surface_point([x, z]), 'cephalothorax', side=side)
for i, guides in enumerate(config['guideXZ']):
    side, number = ('left' if i < 4 else 'right'), i % 4 + 1
    anchors = np.array([surface_point(xz) for xz in guides])
    # A downward pointing tarsus can have almost no top-view extent. Recover
    # its true terminal surface from the locally farthest end, not the median
    # height of its entire vertical shaft.
    _, tip_ids = tree.query(guides[-1], k=192)
    tip_candidates = vertices[tip_ids]
    far_order = np.argsort(np.linalg.norm(tip_candidates - anchors[-2], axis=1))
    anchors[-1] = np.median(tip_candidates[far_order[-12:]], axis=0)
    # Source-side ambiguity at two crossing museum legs is explicitly resolved
    # from the side projection, rather than welding them into one limb.
    if 'guideY' in config:
        for j, y in enumerate(config['guideY'][i]):
            if y is not None: anchors[j, 1] = y
    parent, ids = 'cephalothorax', []
    for segment, point in zip(['hip', 'knee', 'ankle', 'tip'], anchors):
        id = f'leg_{side}_{number}_{segment}'
        bone(id, f'{side.title()} leg {number} {segment}', 'legs', point, parent, side=side, leg=number, segment=segment)
        ids.append(id); parent = id
    a = anchors * scale
    legs.append(dict(id=f'leg_{side}_{number}', side=side, number=number, jointIds=ids,
                     anchors=a.tolist(), lengths=np.linalg.norm(np.diff(a, axis=0), axis=1).tolist(),
                     curve=a.tolist(), sourceLandmarks='Individually reviewed orthographic surface centerlines'))
vertices *= scale
nv = len(vertices)
bone_index = {b['id']: i for i, b in enumerate(bones)}

def segment_distance(a, b):
    a, b = np.array(a), np.array(b)
    delta = b - a
    t = np.clip((vertices - a) @ delta / max(1e-12, delta @ delta), 0, 1)
    return np.linalg.norm(vertices - (a + t[:, None] * delta), axis=1), t

fields, ts = [], []
for leg in legs:
    for a, b in zip(leg['anchors'], leg['anchors'][1:]):
        distance, t = segment_distance(a, b); fields.append(distance); ts.append(t)
fields = np.array(fields)
winner = np.argmin(fields, axis=0)
skin_indices = np.zeros((nv, 4), dtype='<u2')
skin_weights = np.zeros((nv, 4), dtype='<f4')
for i in range(32):
    selected = winner == i; leg = legs[i // 4]; n = i % 4
    idx = bone_index[leg['jointIds'][n]]
    next_idx = bone_index[leg['jointIds'][min(n + 1, 3)]]
    blend = np.clip((ts[i] - .83) / .17, 0, 1) * .5 if n < 3 else np.zeros(nv)
    skin_indices[selected, :2] = [idx, next_idx]
    skin_weights[selected, :2] = np.c_[1 - blend[selected], blend[selected]]

# Reviewed projected masks isolate actual body and mouth regions. They never
# remove surface geometry. Mouth appendages are fused in these real scans.
for index, item in enumerate(config['bodyMask']):
    p, radii = np.array(item['center']) * scale, np.array(item['radii']) * scale
    mask = ((vertices[:, 0] - p[0]) / radii[0]) ** 2 + ((vertices[:, 2] - p[2]) / radii[2]) ** 2 < 1
    if index == 1: mask &= vertices[:, 2] < -.018 * scale
    skin_indices[mask] = [index, 0, 0, 0]; skin_weights[mask] = [1, 0, 0, 0]
x, y, z = vertices.T
mouth = (z > config['mouthFront'] * scale) & (z < config['mouthEnd'] * scale) & (np.abs(x) < config['mouthWidth'] * scale)
for side, sign in [('left', -1), ('right', 1)]:
    for kind in ['pedipalp', 'chelicera']:
        mask = mouth & (x * sign >= 0) & ((np.abs(x) > config['mouthSplit'] * scale) if kind == 'pedipalp' else (np.abs(x) <= config['mouthSplit'] * scale))
        # Long tarantula palps are correctly palps, not an invented fifth leg.
        if skin_id == 'tarantula' and kind == 'chelicera': mask &= z < .22 * scale
        skin_indices[mask] = [bone_index[f'{kind}_{side}'], 0, 0, 0]; skin_weights[mask] = [1, 0, 0, 0]

if config.get('palpGuides'):
    for side, guide in zip(['left', 'right'], config['palpGuides']):
        a, b = np.array(guide['pivot']) * scale, np.array(guide['end']) * scale
        p = vertices[:, [0, 2]]; delta = b - a
        t = np.clip((p - a) @ delta / (delta @ delta), 0, 1)
        mask = (np.linalg.norm(p - (a + t[:, None] * delta), axis=1) < guide['radius'] * scale) & (z > guide['pivot'][1] * scale)
        skin_indices[mask] = [bone_index[f'pedipalp_{side}'], 0, 0, 0]; skin_weights[mask] = [1, 0, 0, 0]

collision = dict(bodies=[])
for idx, id in enumerate(['cephalothorax', 'abdomen']):
    body_vertices = vertices[skin_indices[:, 0] == idx]
    lo, hi = np.quantile(body_vertices, [.005, .995], axis=0)
    center_body, radii = (lo + hi) / 2, (hi - lo) / 2
    # Axial surface bounds make a fitted ellipsoid; neither bounding boxes nor
    # entire limb roots are treated as an impenetrable inflated body.
    collision['bodies'].append(dict(jointId=id, center=center_body.tolist(), radii=(radii * .98).tolist()))
for li, leg in enumerate(legs):
    leg['radii'] = []
    for si, id in enumerate(leg['jointIds']):
        selected = skin_indices[:, 0] == bone_index[id]
        assert selected.sum() > 12, (skin_id, id, int(selected.sum()))
        a, b = np.array(leg['anchors'][si]), np.array(leg['anchors'][si + 1])
        delta = b - a; axial = (vertices - a) @ delta / (delta @ delta)
        radial = np.linalg.norm(vertices - (a + axial[:, None] * delta), axis=1)
        central = selected & (axial > .18) & (axial < .8)
        measured = radial[central] if central.sum() >= 24 else radial[selected]
        leg['radii'].append(float(np.clip(np.quantile(measured, .82), .001, .05)))
assert len(bones) == 38
assert np.allclose(skin_weights.sum(1), 1)
assert np.isfinite(vertices).all()

# Preserve every triangle and all photographed UV seams. Microunit coordinate
# rounding (<=0.5e-6 per component) improves entropy coding below scan detail.
# Normals/UVs/weights are packed into normalized integers below; their maximum
# component errors are explicitly recorded in the manifest.
vertices = np.round(vertices, 6).astype('<f4')
normals = normals.astype('<f4')
uvs = uvs.astype('<f4')
all_attributes = np.c_[vertices, normals, uvs, skin_indices, skin_weights]
_, retained, remap = np.unique(all_attributes, axis=0, return_index=True, return_inverse=True)
vertices, normals, uvs, skin_indices, skin_weights = [a[retained] for a in (vertices, normals, uvs, skin_indices, skin_weights)]
faces = remap[faces].astype('<u4')

license_id = 'CC-BY-4.0' if skin_id == 'tarantula' else 'CC0-1.0'
source_url = config['sourceUrl']
creator = 'Auckland Museum' if skin_id == 'tarantula' else 'Yuichi Kano / ffish.asia / floraZia.com'
out = dict(asset=dict(version='2.0', generator='Morphazoid calibrated real spider scan skin preparation',
    extras=dict(specimen=skin_id, source=source_url, author=creator, license=license_id,
    modifications='Separate calibration object removed; canonical coordinates; authored38-joint skin; sub-microunit geometry rounding; WebP4K color.')),
    scene=0, scenes=[dict(nodes=[0, 1])], nodes=[dict(name=config['species']+' scanned surface', mesh=0, skin=0)],
    buffers=[{}], bufferViews=[], accessors=[], meshes=[], skins=[], images=[], textures=[],
    samplers=[dict(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)], extensionsUsed=['EXT_texture_webp', 'KHR_mesh_quantization'], extensionsRequired=['EXT_texture_webp', 'KHR_mesh_quantization'])
chunks = bytearray()
def append(data, target_type=None):
    while len(chunks) % 4: chunks.append(0)
    index = len(out['bufferViews']); view = dict(buffer=0, byteOffset=len(chunks), byteLength=len(data))
    if target_type: view['target'] = target_type
    out['bufferViews'].append(view); chunks.extend(data); return index
def accessor(data, kind, component, target_type=None, bounds=False, normalized=False, stride=None):
    data = np.ascontiguousarray(data); record = dict(bufferView=append(data.tobytes(), target_type), componentType=component, count=len(data), type=kind)
    if bounds: record.update(min=data.min(0).tolist(), max=data.max(0).tolist())
    if normalized: record['normalized'] = True
    if stride: out['bufferViews'][record['bufferView']]['byteStride'] = stride
    out['accessors'].append(record); return len(out['accessors']) - 1
# glTF-standard normalized UV/weights and KHR_mesh_quantization normals keep
# all faces, positions and4K texture while reducing mobile decode/transfer.
normal_packed = np.zeros((len(normals), 4), dtype='<i2')
normal_packed[:, :3] = np.rint(np.clip(normals, -1, 1) * 32767).astype('<i2')
uv_packed = np.rint(np.clip(uvs, 0, 1) * 65535).astype('<u2')
weight_packed = np.zeros((len(skin_weights), 4), dtype='u1')
weight_packed[:, 1] = np.rint(skin_weights[:, 1] * 255).astype('u1')
weight_packed[:, 0] = 255 - weight_packed[:, 1]
attrs = dict(POSITION=accessor(vertices, 'VEC3', 5126, 34962, True),
    NORMAL=accessor(normal_packed, 'VEC3', 5122, 34962, normalized=True, stride=8),
    TEXCOORD_0=accessor(uv_packed, 'VEC2', 5123, 34962, normalized=True),
    JOINTS_0=accessor(skin_indices, 'VEC4', 5123, 34962),
    WEIGHTS_0=accessor(weight_packed, 'VEC4', 5121, 34962, normalized=True))
out['meshes'] = [dict(name=config['species']+' real scan', primitives=[dict(attributes=attrs, indices=accessor(faces.reshape(-1, 1), 'SCALAR', 5125, 34963), material=0)])]
for b in bones:
    parent = bones[bone_index[b['parent']]] if b['parent'] else None
    translation = np.array(b['pivot']) - (np.array(parent['pivot']) if parent else 0)
    extras = {key: value for key, value in b.items() if key != 'pivot'}; extras.update(spiderJoint=True, spiderRestPivot=b['pivot'])
    out['nodes'].append(dict(name=b['id'], translation=translation.tolist(), children=[], extras=extras))
for i, b in enumerate(bones):
    if b['parent']: out['nodes'][bone_index[b['parent']] + 1]['children'].append(i + 1)
inverses = np.tile(np.eye(4), (38, 1, 1))
for i, b in enumerate(bones): inverses[i, :3, 3] = -np.array(b['pivot'])
out['skins'] = [dict(name='Authored approximate38-joint specimen skin', joints=list(range(1, 39)), skeleton=1,
    inverseBindMatrices=accessor(inverses.transpose(0, 2, 1).astype('<f4').reshape(38, 16), 'MAT4', 5126))]
image = Image.open(source / gltf['images'][-1]['uri']).convert('RGB'); encoded = io.BytesIO(); image.save(encoded, format='WEBP', quality=90, method=6)
out['images'] = [dict(bufferView=append(encoded.getvalue()), mimeType='image/webp', name='Original4K color atlas, WebP q90')]
out['textures'] = [dict(sampler=0, extensions=dict(EXT_texture_webp=dict(source=0)))]
out['materials'] = [dict(name='Photographed specimen cuticle', doubleSided=True, pbrMetallicRoughness=dict(baseColorTexture=dict(index=0), metallicFactor=0, roughnessFactor=.86))]
out['buffers'][0]['byteLength'] = len(chunks)
while len(chunks) % 4: chunks.append(0)
j = json.dumps(out, separators=(',', ':')).encode(); j += b' ' * ((4 - len(j) % 4) % 4)
data = struct.pack('<III', 0x46546c67, 2, 28 + len(j) + len(chunks)) + struct.pack('<II', len(j), 0x4e4f534a) + j + struct.pack('<II', len(chunks), 0x004e4942) + chunks
target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
manifest = dict(version=2, id=skin_id, label=config['label'], species=config['species'], units='web radius1; independent uniform specimen normalization',
    axis=dict(up='+Y', forward='+Z', right='+X'), bodyLength=float((config['bodyMask'][0]['radii'][2] - config['abd'][2] + config['bodyMask'][1]['radii'][2]) * scale),
    bodyHeight=float(max(b['radii'][1]*2 for b in collision['bodies'])), neutralBodyHeight=max(config['neutralBodyHeight'], max(b['radii'][1] - b['center'][1] for b in collision['bodies']) + .014),
    joints=bones, legs=legs, collision=collision, triangles=len(faces), vertices=len(vertices),
    texture=dict(width=image.width, height=image.height, encoding='WebP q90', bytes=len(encoded.getvalue())),
    sourceTransform=dict(boundsCenter=center.tolist(), normalization=float(source_scale), origin=config['origin'], basis=canonical.tolist(), uniformScale=scale),
    precision=dict(positionMaxComponentError=.0000005, normalMaxComponentError=1/65534, uvMaxComponentError=1/131070, weightMaxComponentError=1/510, trianglesRemovedFromAnimal=0),
    sourceSha256=hashlib.sha256(binary).hexdigest(), outputSha256=hashlib.sha256(data).hexdigest(),
    caveat='Authored four-link articulation and approximate mouth regions on a real static scan; source overlaps and texture detail are retained. Collision ellipsoids/capsules approximate the photographed surface.')
(target.parent/'rig-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
np.savez(target.parent/'prepared.npz', vertices=vertices, normals=normals, uvs=uvs, faces=faces, indices=skin_indices, weights=skin_weights)
print(json.dumps(dict(id=skin_id, bytes=len(data), triangles=len(faces), vertices=len(vertices), bones=38, usage=np.bincount(skin_indices[:,0], minlength=38).tolist())))
