import * as THREE from '../../../vendor/three/three.module.min.js';
import { FOAM_MAX_CELLS } from '../../instruments/voronoi-foam/demo-model.js';
import { latticeStructure, LATTICE_MAX_DETAIL,
  LATTICE_MAX_UNITS } from '../../instruments/polyhedral-lattice/demo-model.js';

// Only geometry instruments use these live Three.js surfaces. Downloaded
// animals and kitchen props still enter through downloaded-models.js.
const proxyMaterial = new THREE.MeshBasicMaterial({
  colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
});
const proxyGeometry = new THREE.SphereGeometry(1, 8, 6);
const keyOf = (point) => point.map((value) => Math.round(value * 1e5)).join(',');

function grab(rig, kind, index, radius) {
  const object = new THREE.Mesh(proxyGeometry, proxyMaterial);
  object.layers.set(1);
  object.scale.setScalar(radius);
  object.userData.pick = { kind, index };
  rig.root.add(object);
  rig.pickTargets.push(object);
  return object;
}

/** Triangulate the solver's actual clipped 3D polygons; keep their outlines
 * and unique-vertex count derived from those same face coordinates. */
export function cellSurfaceGeometry(faces) {
  const vertices = new Set(), edges = new Set();
  const triangles = [], lines = [];
  for (const face of faces) {
    if (face.length < 3) continue;
    for (let i = 0; i < face.length; i += 1) {
      const a = face[i], b = face[(i + 1) % face.length];
      vertices.add(keyOf(a));
      const first = keyOf(a), second = keyOf(b);
      const edge = first < second ? `${first}/${second}` : `${second}/${first}`;
      if (!edges.has(edge)) {
        edges.add(edge);
        lines.push(...a, ...b);
      }
    }
    for (let i = 1; i < face.length - 1; i += 1) {
      triangles.push(...face[0], ...face[i], ...face[i + 1]);
    }
  }
  const surface = new THREE.BufferGeometry(), outline = new THREE.BufferGeometry();
  surface.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3));
  surface.computeVertexNormals();
  outline.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  return { surface, outline, vertices: vertices.size,
    faces: faces.length, triangles: triangles.length / 9 };
}

function useFoam(rig) {
  const film = [
    new THREE.MeshPhysicalMaterial({
      color: 0x3aadb4, roughness: 0.3, metalness: 0.14,
      transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide,
      clearcoat: 0.62,
    }),
    new THREE.MeshPhysicalMaterial({
      color: 0x72dccc, roughness: 0.2, metalness: 0.06,
      transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide,
      clearcoat: 0.88,
    }),
  ];
  const outline = [
    new THREE.LineBasicMaterial({ color: 0x4eaaad, transparent: true, opacity: 0.55 }),
    new THREE.LineBasicMaterial({ color: 0xc0fff2, transparent: true, opacity: 0.95 }),
  ];
  const beadGeometry = new THREE.SphereGeometry(0.055, 12, 8);
  const beads = [
    new THREE.MeshStandardMaterial({ color: 0x8de9e0, roughness: 0.25, metalness: 0.18 }),
    new THREE.MeshStandardMaterial({
      color: 0xffe4b3, roughness: 0.17, metalness: 0.15, emissive: 0x432510,
    }),
  ];
  const cells = Array.from({ length: FOAM_MAX_CELLS }, (_, index) => {
    const surface = new THREE.Mesh(new THREE.BufferGeometry(), film[0]);
    const edges = new THREE.LineSegments(new THREE.BufferGeometry(), outline[0]);
    const seed = new THREE.Mesh(beadGeometry, beads[0]);
    for (const mesh of [surface, edges, seed]) {
      mesh.userData.rigLabProcedural = 'voronoi-foam';
      mesh.frustumCulled = false;
      rig.root.add(mesh);
    }
    const hit = grab(rig, 'seed', index, 0.16);
    return { surface, edges, seed, hit, vertices: 0, faces: 0, triangles: 0, signature: 0 };
  });
  const sweep = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2),
    new THREE.MeshBasicMaterial({
      color: 0x65dfda, transparent: true, opacity: 0.075,
      side: THREE.DoubleSide, depthWrite: false,
    }));
  sweep.rotation.y = Math.PI / 2;
  sweep.userData.rigLabProcedural = 'voronoi-foam';
  rig.root.add(sweep);
  let lastCells = null, selected = 0, active = 0, shape = 'cube';
  return {
    update(pose) {
      active = pose.cells.length;
      selected = pose.selected;
      shape = pose.shape;
      sweep.visible = pose.showSlice;
      sweep.position.x = pose.sliceX;
      for (let index = 0; index < cells.length; index += 1) {
        const item = cells[index], cell = pose.cells[index], visible = Boolean(cell);
        for (const object of [item.surface, item.edges, item.seed, item.hit]) object.visible = visible;
        if (!cell) continue;
        item.seed.position.set(...cell.seed);
        item.seed.material = beads[Number(index === selected)];
        item.hit.position.set(...cell.seed);
        item.surface.material = film[Number(index === selected)];
        item.edges.material = outline[Number(index === selected)];
        if (pose.cells !== lastCells) {
          const geometry = cellSurfaceGeometry(cell.faces);
          item.surface.geometry.dispose();
          item.edges.geometry.dispose();
          item.surface.geometry = geometry.surface;
          item.edges.geometry = geometry.outline;
          item.vertices = geometry.vertices;
          item.faces = geometry.faces;
          item.triangles = geometry.triangles;
          // A browser test can verify that an edit changed the *rendered*
          // geometry, rather than merely its sound-volume readout.
          item.signature = geometry.surface.attributes.position.array.reduce(
            (sum, value, position) => sum + value * (position % 17 + 1), 0);
        }
      }
      lastCells = pose.cells;
    },
    getState() {
      return {
        shape, count: active,
        vertexCount: cells.slice(0, active).reduce((sum, cell) => sum + cell.vertices, 0),
        faceCount: cells.slice(0, active).reduce((sum, cell) => sum + cell.faces, 0),
        triangleCount: cells.slice(0, active).reduce((sum, cell) => sum + cell.triangles, 0),
        selectedSignature: cells[selected]?.signature ?? 0,
      };
    },
    dispose() {
      sweep.geometry.dispose();
      sweep.material.dispose();
      sweep.removeFromParent();
      for (const cell of cells) {
        cell.surface.geometry.dispose();
        cell.edges.geometry.dispose();
        cell.surface.removeFromParent();
        cell.edges.removeFromParent();
        cell.seed.removeFromParent();
        cell.hit.removeFromParent();
      }
      beadGeometry.dispose();
      for (const material of [...film, ...outline, ...beads]) material.dispose();
      rig.pickTargets.length = 0;
    },
  };
}

function useLattice(rig) {
  const capacity = latticeStructure({
    shape: 'icosahedron', unitCount: LATTICE_MAX_UNITS, detail: LATTICE_MAX_DETAIL,
  });
  const surface = new THREE.Mesh(new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      color: 0x8e7abe, roughness: 0.47, metalness: 0.22,
      transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
    }));
  const struts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.013, 0.013, 1, 6),
    new THREE.MeshStandardMaterial({
      color: 0xc0c4d9, roughness: 0.29, metalness: 0.48,
    }), capacity.edges.length);
  const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(0.042, 10, 7),
    new THREE.MeshStandardMaterial({
      color: 0xd2d7eb, roughness: 0.21, metalness: 0.32,
    }), capacity.restNodes.length);
  for (const mesh of [surface, struts, joints]) {
    mesh.userData.rigLabProcedural = 'polyhedral-lattice';
    mesh.frustumCulled = false; // The full deformed bounds change every pose.
    rig.root.add(mesh);
  }
  struts.count = joints.count = 0;
  struts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  joints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const low = new THREE.Color(0x8198b8), bright = new THREE.Color(0xffd192);
  const pulse = new THREE.Color(0xa7f6ef);
  const from = new THREE.Vector3(), to = new THREE.Vector3();
  const center = new THREE.Vector3(), direction = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), transform = new THREE.Object3D();
  const position = new THREE.Vector3(), matrix = new THREE.Matrix4();
  let signature = '', pickTargets = [], last = null;
  function rebuild(pose) {
    const previous = surface.geometry;
    const geometry = new THREE.BufferGeometry();
    const coordinates = new Float32Array(pose.nodes.length * 3);
    const attribute = new THREE.BufferAttribute(coordinates, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    geometry.setIndex(pose.triangles.flat());
    surface.geometry = geometry;
    previous.dispose();
    for (const target of pickTargets) target.removeFromParent();
    rig.pickTargets.length = 0;
    pickTargets = pose.nodes.map((_node, index) => grab(rig, 'node', index, 0.095));
    struts.count = pose.edges.length;
    joints.count = pose.nodes.length;
    signature = `${pose.shape}:${pose.unitCount}:${pose.detail}`;
  }
  return {
    update(pose) {
      if (`${pose.shape}:${pose.unitCount}:${pose.detail}` !== signature) rebuild(pose);
      last = pose;
      const attribute = surface.geometry.getAttribute('position');
      pose.nodes.forEach((point, index) => {
        attribute.setXYZ(index, ...point);
        pickTargets[index].position.set(...point);
        matrix.makeTranslation(...point);
        joints.setMatrixAt(index, matrix);
        joints.setColorAt(index, index === pose.selected ? bright
          : index === pose.pulseNode ? pulse : low);
      });
      attribute.needsUpdate = true;
      surface.geometry.computeVertexNormals();
      joints.instanceMatrix.needsUpdate = true;
      joints.instanceColor.needsUpdate = true;
      pose.edges.forEach(([a, b], index) => {
        from.set(...pose.nodes[a]);
        to.set(...pose.nodes[b]);
        center.copy(from).add(to).multiplyScalar(0.5);
        direction.copy(to).sub(from);
        const length = direction.length();
        transform.position.copy(center);
        transform.quaternion.setFromUnitVectors(up, direction.divideScalar(length));
        transform.scale.set(1, length, 1);
        transform.updateMatrix();
        struts.setMatrixAt(index, transform.matrix);
        struts.setColorAt(index, a === pose.selected || b === pose.selected ? bright : low);
      });
      struts.instanceMatrix.needsUpdate = true;
      struts.instanceColor.needsUpdate = true;
    },
    getState() {
      return {
        shape: last?.shape ?? 'icosahedron', detail: last?.detail ?? 0,
        unitCount: last?.unitCount ?? 0, verticesPerUnit: last?.verticesPerUnit ?? 0,
        vertexCount: joints.count, edgeCount: struts.count,
        faceCount: last?.triangles.length ?? 0,
        nodes: last?.nodes ?? [],
        selectedPoint: last?.nodes[last.selected] ?? null,
        geometrySelectedPoint: last ? position.fromBufferAttribute(
          surface.geometry.attributes.position, last.selected).toArray() : null,
      };
    },
    dispose() {
      for (const mesh of [surface, struts, joints]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
        mesh.removeFromParent();
      }
      for (const target of pickTargets) target.removeFromParent();
      rig.pickTargets.length = 0;
    },
  };
}

export function createProceduralModels(rigs) {
  const foam = useFoam(rigs['voronoi-foam']);
  const lattice = useLattice(rigs['polyhedral-lattice']);
  return {
    update(id, pose) {
      if (id === 'voronoi-foam') foam.update(pose);
      if (id === 'polyhedral-lattice') lattice.update(pose);
    },
    getState() { return { foam: foam.getState(), lattice: lattice.getState() }; },
    dispose() { foam.dispose(); lattice.dispose(); proxyGeometry.dispose(); proxyMaterial.dispose(); },
  };
}
