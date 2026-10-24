// The bundled, attributed GLB has one indexed mesh, but its two hub faces and
// cores are six disconnected islands. Find those islands in the original mesh
// coordinates so the downloaded binary and its textured shell stay unchanged.
// This signature deliberately applies only to that artist's cassette.
export function partitionArtistCassette(geometry) {
  const position = geometry?.getAttribute("position");
  const index = geometry?.getIndex();
  if (!position || !index || index.count % 3 || Object.keys(geometry.morphAttributes).length) return null;

  const parent = Uint32Array.from({ length: position.count }, (_, vertex) => vertex);
  function root(vertex) {
    while (parent[vertex] !== vertex) {
      parent[vertex] = parent[parent[vertex]];
      vertex = parent[vertex];
    }
    return vertex;
  }
  for (let offset = 0; offset < index.count; offset += 3) {
    const first = index.getX(offset);
    parent[root(index.getX(offset + 1))] = root(first);
    parent[root(index.getX(offset + 2))] = root(first);
  }
  const components = new Map();
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const id = root(vertex);
    if (!components.has(id)) components.set(id, {
      id, count: 0, minX: Infinity, maxX: -Infinity,
      minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity,
    });
    const part = components.get(id), x = position.getX(vertex);
    const y = position.getY(vertex), z = position.getZ(vertex);
    part.count += 1;
    part.minX = Math.min(part.minX, x); part.maxX = Math.max(part.maxX, x);
    part.minY = Math.min(part.minY, y); part.maxY = Math.max(part.maxY, y);
    part.minZ = Math.min(part.minZ, z); part.maxZ = Math.max(part.maxZ, z);
  }

  const sides = [-1, 1].map(sign => {
    const parts = [...components.values()].filter(part => {
      const x = (part.minX + part.maxX) / 2;
      const y = (part.minY + part.maxY) / 2;
      return part.count >= 110 && part.count <= 114
        && Math.abs(x - sign * .4195) < .025 && Math.abs(y - .057) < .02
        && part.maxX - part.minX >= .19 && part.maxX - part.minX <= .25
        && part.maxY - part.minY >= .19 && part.maxY - part.minY <= .24
        && part.maxZ - part.minZ < .03;
    });
    if (parts.length !== 3) return null;
    return {
      roots: new Set(parts.map(part => part.id)),
      pivot: {
        x: parts.reduce((sum, part) => sum + (part.minX + part.maxX) / 2, 0) / 3,
        y: parts.reduce((sum, part) => sum + (part.minY + part.maxY) / 2, 0) / 3,
        z: 0,
      },
      indices: [],
    };
  });
  if (sides.some(side => !side)) return null;
  const body = [];
  for (let offset = 0; offset < index.count; offset += 3) {
    const id = root(index.getX(offset));
    const owner = sides.find(side => side.roots.has(id));
    const target = owner?.indices ?? body;
    for (let corner = 0; corner < 3; corner += 1) target.push(index.getX(offset + corner));
  }
  if (sides.some(side => side.indices.length < 3) || !body.length) return null;
  return { body, reels: sides.map(({ pivot, indices }) => ({ pivot, indices })) };
}
