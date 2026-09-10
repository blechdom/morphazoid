// Small local-coordinate silhouettes used only when an era photograph cannot
// be drawn. The caller owns position, scale, rotation and its outer Canvas save.
const COLORS = Object.freeze({
  'history-bones': '#ded0ad', 'history-hamhock': '#be7446', 'history-baby': '#e3cfac',
  'history-harpsichord': '#a4824d', 'history-boulder': '#a6a39c',
  'history-club': '#987147', 'future-octopus': '#55efd0',
});
function ellipse(c, x, y, rx, ry, color, outline = null) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = color; c.fill();
  if (outline) { c.strokeStyle = outline; c.lineWidth = 1.5; c.stroke(); }
}
function polygon(c, points, color, outline = '#594537') {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
  c.fillStyle = color; c.fill(); c.strokeStyle = outline; c.lineWidth = 1.5; c.stroke();
}
function line(c, points, color, width = 2) {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.strokeStyle = color; c.lineWidth = width; c.stroke();
}

export function drawEraProp(c, prop) {
  const id = prop?.sprite;
  if (!Object.hasOwn(COLORS, id)) return false;
  const color = typeof prop.color === 'string' ? prop.color : COLORS[id];
  c.save();
  try {
    c.lineCap = 'round'; c.lineJoin = 'round';
    switch (id) {
      case 'history-bones':
        for (const direction of [-1, 1]) {
          const a = [-18 * direction, -21], b = [18 * direction, 21];
          line(c, [a, b], '#877961', 9); line(c, [a, b], color, 6);
          for (const [x, y] of [a, b]) {
            ellipse(c, x - 3, y, 4.5, 5, color, '#877961');
            ellipse(c, x + 3, y, 4.5, 5, color, '#877961');
          }
        }
        break;
      case 'history-hamhock':
        line(c, [[9, -5], [25, -22]], '#cbb897', 10);
        line(c, [[10, -6], [25, -22]], '#eddbb6', 6);
        ellipse(c, 23, -25, 4.5, 4, '#ead8b2', '#9d896e');
        ellipse(c, 28, -21, 4, 4.5, '#ead8b2', '#9d896e');
        polygon(c, [[-20, 3], [-11, -11], [7, -13], [18, 0], [13, 16], [-4, 23], [-20, 15]], color, '#6c3d25');
        ellipse(c, -6, 4, 12, 13, '#a9572e');
        for (let i = 0; i < 3; i++) line(c, [[-14 + i * 6, -5], [-10 + i * 6, 12]], '#e0a05a', 2);
        break;
      case 'history-baby':
        ellipse(c, 0, 5, 17, 27, color, '#8b785e');
        ellipse(c, 0, -13, 12, 14, '#eddfc2', '#a59173');
        ellipse(c, 0, -13, 8, 9, '#d6ad89', '#ad896b');
        line(c, [[-5, -14], [-2, -13]], '#765547', 1.3);
        line(c, [[2, -13], [5, -14]], '#765547', 1.3);
        line(c, [[-1, -8], [1, -8]], '#8e6451', 1);
        polygon(c, [[-15, -3], [13, 9], [9, 25], [0, 31], [-12, 23]], color, '#a99575');
        line(c, [[12, -2], [-12, 15], [9, 22]], '#baa583', 2);
        line(c, [[-8, 24], [4, 27]], '#f2e5c8', 2);
        break;
      case 'history-harpsichord':
        line(c, [[-25, 9], [-24, 29]], '#64482f', 4);
        line(c, [[21, 7], [22, 26]], '#64482f', 4);
        line(c, [[-1, 15], [0, 34]], '#64482f', 4);
        polygon(c, [[-30, -5], [-6, -21], [27, -17], [29, 5], [9, 19], [-30, 12]], color, '#46372b');
        polygon(c, [[-27, -7], [17, -31], [29, -18], [20, 5]], '#6a4c30', '#b49763');
        line(c, [[20, 3], [17, -24]], '#d0b57b', 2);
        for (let i = 0; i < 5; i++) line(c, [[-11 + i * 4, -10], [5 + i * 3, 6]], '#caad66', 1);
        polygon(c, [[-28, 2], [6, 2], [6, 12], [-28, 12]], '#e6d9b7', '#48382c');
        for (let i = 1; i < 8; i++) line(c, [[-28 + i * 4.2, 3], [-28 + i * 4.2, 11]], '#62513c', 1);
        c.fillStyle = '#2a2420';
        for (const x of [-23, -19, -11, -7, -3]) c.fillRect(x, 2, 2.5, 6);
        break;
      case 'history-boulder':
        polygon(c, [[-24, -11], [-9, -26], [14, -22], [28, -5], [23, 18], [4, 26], [-22, 16], [-29, 0]], color, '#686965');
        polygon(c, [[-24, -11], [-9, -26], [3, -4], [-22, 16]], '#b9b7ad', '#86867e');
        polygon(c, [[3, -4], [14, -22], [28, -5], [23, 18]], '#838780', '#686965');
        line(c, [[-15, -8], [-6, -13], [-1, -6]], '#dad5c2', 2);
        line(c, [[5, 6], [13, 12], [6, 18]], '#686d66', 2);
        break;
      case 'history-club':
        polygon(c, [[-5, 28], [2, 31], [12, 7], [22, -10], [17, -28], [5, -31], [-7, -19], [-10, -3]], color, '#573f2d');
        line(c, [[-2, 23], [4, 1], [14, -20]], '#c2a172', 3);
        line(c, [[-4, -4], [3, -15], [2, -25]], '#6a4b31', 3);
        ellipse(c, 12, -12, 4, 5, '#7c5838', '#b19061');
        break;
      case 'future-octopus':
        for (let i = 0; i < 8; i++) {
          const side = i < 4 ? -1 : 1, start = -10.5 + i * 3;
          const x = -28 + i * 8, y = 18 + Math.sin(i / 7 * Math.PI) * 11;
          c.beginPath(); c.moveTo(start, 1);
          c.bezierCurveTo(start + side * 6, 12, x + side * 6, y + 8, x, y);
          c.bezierCurveTo(x - side * 5, y - 6, x - side * 8, y, x - side * 4, y + 3);
          c.strokeStyle = '#493c7a'; c.lineWidth = 7; c.stroke();
          c.strokeStyle = color; c.lineWidth = 4; c.stroke();
          ellipse(c, x - side * 2, y, 1.6, 1.6, '#c4f14a');
        }
        ellipse(c, 0, -11, 14, 18, '#528ca7', '#443d71');
        ellipse(c, -4, -16, 6, 9, color);
        ellipse(c, -7, -4, 4, 4.5, '#d8e889', '#3c5769');
        ellipse(c, 7, -4, 4, 4.5, '#d8e889', '#3c5769');
        ellipse(c, -7, -4, 1.5, 3, '#263043');
        ellipse(c, 7, -4, 1.5, 3, '#263043');
        break;
    }
  } finally {
    c.restore();
  }
  return true;
}
