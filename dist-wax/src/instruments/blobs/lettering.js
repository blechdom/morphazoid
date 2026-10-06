// Lowercase bubble lettering with a small stencil opening in each bowl. Each
// letter is one connected, closed pen contour, so its reader visits the inside
// and outside and every point remains editable using the ordinary drawing tools.
function contour(x, y, width, height, start, segments) {
  const anchor = ([px, py]) => ({ x: x + px * width, y: y + py * height, hx: 0, hy: 0, inHx: 0, inHy: 0 });
  const points = [anchor(start)];
  for (const [c1x, c1y, c2x, c2y, px, py] of segments) {
    const previous = points.at(-1);
    previous.hx = x + c1x * width - previous.x;
    previous.hy = y + c1y * height - previous.y;
    const next = px === start[0] && py === start[1] ? points[0] : anchor([px, py]);
    next.inHx = x + c2x * width - next.x;
    next.inHy = y + c2y * height - next.y;
    if (next !== points[0]) points.push(next);
  }
  return { tool: 'pen', points };
}

function letterB(x) {
  return contour(x, .29, .20, .44, [.12, 0], [
    [.16, 0, .27, 0, .3, 0],
    [.35, 0, .36, .02, .36, .06],
    [.36, .16, .36, .28, .36, .39],
    [.42, .35, .53, .33, .62, .33],
    [.83, .33, .97, .46, .99, .655],
    [.9, .655, .81, .655, .72, .655],
    [.7, .56, .63, .51, .55, .51],
    [.44, .51, .35, .58, .35, .675],
    [.35, .78, .44, .84, .55, .84],
    [.64, .84, .7, .8, .72, .72],
    [.81, .72, .9, .72, .99, .72],
    [.97, .9, .82, 1, .58, 1],
    [.42, 1, .23, 1, .12, 1],
    [.03, 1, 0, .95, 0, .88],
    [0, .63, 0, .28, 0, .08],
    [0, .02, .04, 0, .12, 0],
  ]);
}

function letterL() {
  return contour(.345, .29, .09, .44, [.16, 0], [
    [.25, 0, .47, 0, .55, 0],
    [.68, 0, .72, .03, .72, .08],
    [.72, .3, .72, .55, .72, .76],
    [.72, .82, .79, .84, .88, .84],
    [.97, .84, 1, .87, 1, .92],
    [1, .99, .89, 1, .71, 1],
    [.21, 1, 0, .92, 0, .74],
    [0, .52, 0, .24, 0, .08],
    [0, .02, .04, 0, .16, 0],
  ]);
}

function letterO() {
  return contour(.48, .4352, .20, .2948, [.45, 1], [
    [.45, .92, .45, .85, .45, .77],
    [.32, .75, .25, .65, .25, .5],
    [.25, .33, .35, .23, .5, .23],
    [.65, .23, .75, .33, .75, .5],
    [.75, .65, .68, .75, .55, .77],
    [.55, .85, .55, .92, .55, 1],
    [.83, .98, 1, .8, 1, .5],
    [1, .2, .82, 0, .5, 0],
    [.18, 0, 0, .2, 0, .5],
    [0, .8, .17, .98, .45, 1],
  ]);
}

/** Four independently editable loops spell “blob” on a shared baseline. */
export function createBlobWord() {
  return [letterB(.10), letterL(), letterO(), letterB(.725)];
}
