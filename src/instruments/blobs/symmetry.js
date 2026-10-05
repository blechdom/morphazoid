import { reflectionTransforms, sanitizeReflectionAxes } from '../playhead-paint/playhead-paint.js';
import { boundsFromPoints } from '../../geometry.js';

export { reflectionTransforms, sanitizeReflectionAxes };
export const reflectPoint = (point, matrix) => ({ x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f });
export function unreflectPoint(point, matrix) {
  const x = point.x - matrix.e, y = point.y - matrix.f;
  return { x: matrix.a * x + matrix.b * y, y: matrix.c * x + matrix.d * y };
}
export function rotateUnitPoint(point, degrees) {
  const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), x = point.x - .5, y = point.y - .5;
  return { x: .5 + x * c - y * s, y: .5 + x * s + y * c };
}

// Reflect after the form controls, then rotate the whole ornament at playback.
// Isometries retain distances and corner magnitudes; reflections reverse turns.
export function expandPaths(paths, axes) {
  return reflectionTransforms(axes).flatMap(reflection => paths.map((path, sourceIndex) => {
    const determinant = reflection.a * reflection.d - reflection.b * reflection.c;
    const points = reflection.id === 'identity' ? path.points : path.points.map(p => ({ x: reflection.a * p.x + reflection.c * p.y, y: reflection.b * p.x + reflection.d * p.y }));
    return { ...path, points, bounds: boundsFromPoints(points), cornerTurns: path.cornerTurns.map(turn => turn * determinant), sourceIndex, reflection, reflectionId: reflection.id, pathKey: `blob:${sourceIndex}:${reflection.id}` };
  }));
}
