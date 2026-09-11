#!/usr/bin/env python3
"""Add approximate rigid body-part pivots to the CC-BY-4.0 cockroach scan.

Requires numpy and scipy (python -m pip install numpy scipy).
Usage: python build-roach-rig.py [input.glb] [output.glb]

Does not deform, retopologize, simplify, or resample the source. Original mesh,
material and image data are preserved byte-for-byte. These are approximate
articulation centers for exploration, not a biomechanically validated walk rig.
"""
import copy
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import numpy as np
from scipy.spatial import cKDTree

base = Path(__file__).resolve().parent
source = Path(sys.argv[1]) if len(sys.argv) > 1 else base / 'photogrammetry-cockroach.glb'
target = Path(sys.argv[2]) if len(sys.argv) > 2 else base / 'rigged-cockroach.glb'
data = source.read_bytes()
assert data[:4] == b'glTF'
assert struct.unpack_from('<I', data, 4)[0] == 2
json_size, json_type = struct.unpack_from('<II', data, 12)
assert json_type == 0x4E4F534A
scene = json.loads(data[20:20 + json_size])
original_scene = copy.deepcopy(scene)
bin_size, bin_type = struct.unpack_from('<II', data, 20 + json_size)
assert bin_type == 0x004E4942
source_binary = data[28 + json_size:28 + json_size + bin_size]
binary = bytearray(source_binary[:scene['buffers'][0]['byteLength']])


def positions(mesh_index):
    arrays = []
    for primitive in scene['meshes'][mesh_index]['primitives']:
        accessor = scene['accessors'][primitive['attributes']['POSITION']]
        assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
        view = scene['bufferViews'][accessor['bufferView']]
        offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        arrays.append(np.ndarray((accessor['count'], 3), dtype='<f4',
                                 buffer=source_binary, offset=offset,
                                 strides=(view.get('byteStride', 12), 4)).astype(float))
    return np.concatenate(arrays)


parts = {}
for index, node in enumerate(scene['nodes']):
    if not node.get('name', '').startswith('cock_'):
        continue
    assert not any(k in node for k in ('matrix', 'translation', 'rotation', 'scale'))
    key = node['name'].split('_rt')[0].split('_Plane')[0].removeprefix('cock_')
    vertices = np.concatenate([positions(scene['nodes'][child]['mesh'])
                               for child in node['children']])
    parts[key] = {'node': index, 'vertices': vertices}


def contact(a, b, fraction=0.01):
    """Center the closest 1% of samples from A to B; robust to a stray contact."""
    av, bv = parts[a]['vertices'], parts[b]['vertices']
    distances, indices = cKDTree(bv).query(av)
    nearest = np.argsort(distances, kind='stable')[:max(20, int(len(av) * fraction))]
    midpoints = (av[nearest] + bv[indices[nearest]]) / 2
    return np.median(midpoints, axis=0), {
        'method': 'median of midpoint pairs for closest source-vertex percentile',
        'sourcePart': a, 'adjacentPart': b, 'sourcePercentile': fraction * 100,
        'minimumSurfaceGap': float(distances.min()),
        'sampleCount': len(nearest), 'contactExtent': np.ptp(midpoints, axis=0).tolist(),
    }


def end_cap(part, opposite):
    """Infer proximal endpoint from the 3% farthest vertices from distal joint."""
    vertices = parts[part]['vertices']
    distances = np.linalg.norm(vertices - opposite, axis=1)
    cap = vertices[distances >= np.percentile(distances, 97)]
    return np.median(cap, axis=0)


def front_cap(part, percentile=95):
    vertices = parts[part]['vertices']
    return np.median(vertices[vertices[:, 1] >= np.percentile(vertices[:, 1], percentile)], axis=0)


# This coordinate system is the source's model space, underneath the unchanged
# two glTF conversion roots. +Y points to the head; -Y to the abdomen.
pivots = {}
manifest_joints = []
container_index = 1
old_children = list(scene['nodes'][container_index]['children'])
assert set(old_children) == {item['node'] for item in parts.values()}
scene['nodes'][container_index]['children'] = []


def add_joint(key, name, pivot, parent=None, part=None, group='Body',
              confidence='approximate', method=None, max_degrees=15):
    pivot = np.asarray(pivot, dtype=float)
    parent_pivot = pivots[parent]['position'] if parent else np.zeros(3)
    node_index = len(scene['nodes'])
    extras = {'roachJoint': True, 'displayName': name, 'jointId': key,
              'jointGroup': group, 'pivotConfidence': confidence,
              'suggestedRotationLimitDegrees': max_degrees,
              'rigType': 'approximate rigid articulation'}
    node = {'name': 'roach_joint_' + key, 'translation': (pivot - parent_pivot).tolist(),
            'children': [], 'extras': extras}
    scene['nodes'].append(node)
    parent_index = pivots[parent]['node'] if parent else container_index
    scene['nodes'][parent_index]['children'].append(node_index)
    if part:
        part_index = parts[part]['node']
        # Each mesh remains in the source's model-space coordinates. Cancel the
        # accumulated joint translation at its geometry-bearing part node.
        scene['nodes'][part_index]['translation'] = (-pivot).tolist()
        node['children'].append(part_index)
    pivots[key] = {'node': node_index, 'position': pivot}
    manifest_joints.append({'jointId': key, 'displayName': name,
        'nodeIndex': node_index, 'parentJointId': parent, 'sourcePart': part,
        'sourcePartNodeIndex': parts[part]['node'] if part else None,
        'pivotModelSpace': pivot.tolist(), 'confidence': confidence,
        'method': method or {'method': 'anatomical-region endpoint estimate'},
        'suggestedRotationLimitDegrees': max_degrees})


# Body is a control for the whole specimen; the scanned body mesh is the abdomen.
body_root = np.array([0.175, 0.45, -0.32])
add_joint('body', 'Body / thorax', body_root, max_degrees=45,
          method={'method': 'manual central thorax control, not a biological hinge'})
add_joint('abdomen', 'Abdomen', front_cap('body'), 'body', 'body', max_degrees=8)
neck_points = parts['neck']['vertices']
neck_base = np.median(neck_points[neck_points[:, 1] <= np.percentile(neck_points[:, 1], 12)], axis=0)
add_joint('neck', 'Neck / pronotum', neck_base, 'body', 'neck', max_degrees=8,
          method={'method': 'lower longitudinal cap of pronotum mesh; approximate shield articulation'})
head_contact, head_evidence = contact('head', 'neck', .01)
# Head-neck contact spans a ring. Use the bounding-box center of the close-contact
# band rather than a vertex-density weighted point on one side of that ring.
av, bv = parts['head']['vertices'], parts['neck']['vertices']
distances, indices = cKDTree(bv).query(av)
nearest = np.argsort(distances, kind='stable')[:max(20, int(len(av) * .01))]
ring = (av[nearest] + bv[indices[nearest]]) / 2
head_pivot = (ring.min(0) + ring.max(0)) / 2
head_evidence['method'] = 'center of close-contact band bounds for broad head/pronotum contact'
add_joint('head', 'Head', head_pivot, 'neck', 'head', method=head_evidence, max_degrees=12)
for side in ('left', 'right'):
    part = 'antler_' + side
    pivot, evidence = contact(part, 'head', .003)
    add_joint('antenna_' + side, side.title() + ' antenna', pivot, 'head', part,
              group='Antennae', confidence='high contact confidence', method=evidence, max_degrees=30)

add_joint('wings', 'Paired wing covers', front_cap('wings', 97), 'body', 'wings',
          max_degrees=8, method={'method': 'upper longitudinal cap; both wing covers share one source mesh'})

for tier, human_tier in [('up', 'Front'), ('mid', 'Middle'), ('down', 'Hind')]:
    for side in ('left', 'right'):
        segments = [f'{tier}_{side}_{i}' for i in range(4) if f'{tier}_{side}_{i}' in parts]
        contacts = [contact(a, b) for a, b in zip(segments, segments[1:])]
        proximal = end_cap(segments[0], contacts[0][0])
        previous = 'body'
        for number, part in enumerate(segments):
            suffix = ['proximal', 'middle', 'distal', 'foot'][number]
            key = f'{human_tier.lower()}_{side}_{suffix}'
            label = f'{human_tier} {side} leg · {suffix}'
            if number == 0:
                pivot = proximal
                evidence = {'method': 'median of farthest 3% of segment-0 vertices from segment-1 contact',
                            'sourcePart': part, 'distalReference': contacts[0][0].tolist()}
                confidence = 'moderate endpoint confidence'
            else:
                pivot, evidence = contacts[number - 1]
                confidence = 'high contact confidence'
            add_joint(key, label, pivot, previous, part,
                      group=f'{human_tier} {side} leg', confidence=confidence,
                      method=evidence, max_degrees=20 if number else 15)
            previous = key


# Preserve every original mesh's transform at rest to floating-point precision.
def world_matrices(gltf):
    result = {}
    def visit(index, parent):
        node = gltf['nodes'][index]
        if 'matrix' in node:
            matrix = np.asarray(node['matrix']).reshape((4, 4), order='F')
        else:
            assert 'rotation' not in node and 'scale' not in node
            matrix = np.eye(4)
            matrix[:3, 3] = node.get('translation', [0, 0, 0])
        result[index] = parent @ matrix
        for child in node.get('children', []):
            visit(child, result[index])
    for root in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
        visit(root, np.eye(4))
    return result


before, after = world_matrices(original_scene), world_matrices(scene)
mesh_nodes = [i for i, node in enumerate(original_scene['nodes']) if 'mesh' in node]
rest_error = max(float(np.max(np.abs(before[i] - after[i]))) for i in mesh_nodes)
assert rest_error < 1e-12, f'Rest geometry moved: {rest_error}'
assert scene['meshes'] == original_scene['meshes']
assert scene['materials'] == original_scene['materials']
assert scene['images'] == original_scene['images']


def append_floats(values, accessor_type, count, bounds=False):
    while len(binary) % 4:
        binary.append(0)
    array = np.asarray(values, dtype='<f4')
    offset = len(binary)
    binary.extend(array.tobytes())
    view = len(scene['bufferViews'])
    scene['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': array.nbytes})
    accessor = {'bufferView': view, 'componentType': 5126, 'count': count, 'type': accessor_type}
    if bounds:
        accessor.update(min=[float(array.min())], max=[float(array.max())])
    scene['accessors'].append(accessor)
    return len(scene['accessors']) - 1


# A gentle six-second articulation demo, explicitly not a locomotion/walk cycle.
times = np.linspace(0, 6, 25)
time_accessor = append_floats(times, 'SCALAR', len(times), bounds=True)
clip = {'name': 'Gentle joint demonstration', 'samplers': [], 'channels': [],
        'extras': {'description': 'Small procedural rigid-joint motion; not a validated biological walk cycle.'}}
animated_joints = [('antenna_left', 1, 8.0, 0), ('antenna_right', 1, -8.0, 0),
                   ('head', 1, 2.0, 0), ('wings', 0, 1.2, 0)]
for tier, side, sign in [('front', 'left', 1), ('front', 'right', -1),
                         ('middle', 'left', -1), ('middle', 'right', 1),
                         ('hind', 'left', 1), ('hind', 'right', -1)]:
    animated_joints.append((f'{tier}_{side}_middle', 1, sign * 3.0, 0))
for joint, axis, degrees, phase in animated_joints:
    angles = np.radians(degrees) * np.sin(times / 6 * 2 * np.pi + phase)
    quaternions = np.zeros((len(times), 4))
    quaternions[:, axis] = np.sin(angles / 2)
    quaternions[:, 3] = np.cos(angles / 2)
    output = append_floats(quaternions, 'VEC4', len(times))
    clip['samplers'].append({'input': time_accessor, 'output': output, 'interpolation': 'LINEAR'})
    clip['channels'].append({'sampler': len(clip['samplers']) - 1,
                             'target': {'node': pivots[joint]['node'], 'path': 'rotation'}})
scene['animations'] = [clip]
scene['buffers'][0]['byteLength'] = len(binary)
scene['asset'].setdefault('extras', {})['modifications'] = (
    'Added approximate rigid anatomical pivot hierarchy and gentle joint demonstration; '
    'original geometry, materials and textures unchanged. Not a biomechanical walk rig.')
scene['asset']['extras']['rigManifest'] = 'rig-manifest.json'
json_bytes = json.dumps(scene, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
json_bytes += b' ' * ((-len(json_bytes)) % 4)
binary += b'\0' * ((-len(binary)) % 4)
output = (struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(json_bytes) + 8 + len(binary))
          + struct.pack('<II', len(json_bytes), 0x4E4F534A) + json_bytes
          + struct.pack('<II', len(binary), 0x004E4942) + binary)
target.write_bytes(output)
manifest = {
    'source': source.name, 'output': target.name,
    'sourceSha256': hashlib.sha256(data).hexdigest(),
    'outputSha256': hashlib.sha256(output).hexdigest(),
    'sourceLicense': original_scene['asset']['extras'],
    'rigType': 'Approximate non-deforming body-part joint hierarchy; no skinned deformation',
    'coordinateSystem': 'Original glTF mesh coordinates; head +Y, abdomen -Y. Original conversion roots preserved.',
    'restPoseMaximumWorldMatrixError': rest_error,
    'originalMeshMaterialImageDataUnchanged': True,
    'originalBufferPrefixPreserved': bytes(binary[:original_scene['buffers'][0]['byteLength']]) == source_binary[:original_scene['buffers'][0]['byteLength']],
    'jointCount': len(manifest_joints), 'meshCount': len(scene['meshes']),
    'animation': {'name': clip['name'], 'durationSeconds': 6, 'channelCount': len(clip['channels'])},
    'limitations': [
        'Source is a dried specimen with curled limbs; this rig is not a validated locomotion system.',
        'Leg segment labels are neutral proximal/middle/distal/foot: trochanters and tarsi are not separately modeled for every leg.',
        'Both wing covers are in one mesh and move as one group.',
        'Leg-root, abdomen, pronotum and wing pivots use anatomical-region approximations.',
        'Large joint rotations can expose scan seams or cause intersections; suggested limits are visual guidance, not joint constraints.',
        'Antennae are rigid whole meshes; no flexible antenna deformation is added.'
    ],
    'joints': manifest_joints,
}
target.with_name('rig-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({k: manifest[k] for k in ['output', 'jointCount', 'meshCount',
      'restPoseMaximumWorldMatrixError', 'originalBufferPrefixPreserved', 'animation']}, indent=2))
