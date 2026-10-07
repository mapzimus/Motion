// Assigns distinguishable colors to routes during legend drill-down.
// The palette is optimized for dark map backgrounds with reasonable
// colorblind accessibility (no pure red/green pairs at adjacent indices).

const PALETTE = [
  '#e6194b', // red
  '#3cb44b', // green
  '#4363d8', // blue
  '#f58231', // orange
  '#42d4f4', // cyan
  '#f032e6', // magenta
  '#ffe119', // yellow
  '#469990', // teal
  '#9a6324', // brown
  '#dcbeff', // lavender
  '#aaffc3', // mint
  '#e6beff', // light purple
  '#ffd8b1', // apricot
  '#fffac8', // beige
  '#800000', // maroon
  '#000075', // navy
];

let currentMap = new Map();
let currentGroup = null;

export function assignRouteColors(items, groupKey) {
  const counts = new Map();
  for (const item of items) {
    const route = item.props?.route ?? item.properties?.route ?? '';
    if (!route) continue;
    counts.set(route, (counts.get(route) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const map = new Map();
  for (let i = 0; i < sorted.length; i++) {
    map.set(sorted[i][0], PALETTE[i % PALETTE.length]);
  }
  currentMap = map;
  currentGroup = groupKey;
  return map;
}

export function getRouteColorMap() {
  return currentMap;
}

export function getDrillGroup() {
  return currentGroup;
}

export function clearRouteColors() {
  currentMap = new Map();
  currentGroup = null;
}

export function buildMatchExpression(routeColorMap, fallback = '#888888') {
  if (routeColorMap.size === 0) return ['get', 'color'];
  const pairs = [];
  for (const [route, color] of routeColorMap) {
    pairs.push(route, color);
  }
  return ['match', ['get', 'route'], ...pairs, fallback];
}
