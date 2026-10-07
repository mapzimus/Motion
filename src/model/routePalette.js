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
let currentOperator = null;

function propsOf(itemOrProps) {
  return itemOrProps?.properties || itemOrProps?.props || itemOrProps || {};
}

/** Stable id shared by a live vehicle and its route ribbon. */
export function drillKey(itemOrProps) {
  const props = propsOf(itemOrProps);
  return props.shadeKey || props.route || '';
}

/** Short label for a drill row. Prefers the rider-facing route id or name. */
export function drillLabel(itemOrProps) {
  const props = propsOf(itemOrProps);
  const route = props.route ? String(props.route) : '';
  const shade = props.shadeKey ? String(props.shadeKey) : '';
  if (route && route !== shade && !route.includes(':')) return route;
  if (shade.includes(':')) return shade.slice(shade.lastIndexOf(':') + 1);
  return route || shade;
}

/**
 * @param {Array<{ properties?: Record<string, any>, props?: Record<string, any> }>} items
 * @param {string | null} groupKey
 * @param {string | null} [operator]
 */
export function assignRouteColors(items, groupKey, operator = null) {
  const counts = new Map();
  for (const item of items) {
    const route = drillKey(item);
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
  currentOperator = operator || null;
  return map;
}

/** Route color while this group (and operator, when set) is drilled into. */
export function drillColorFor(props) {
  if (!props || !currentGroup || props.group !== currentGroup) return null;
  if (currentOperator && props.legendKey !== currentOperator) return null;
  const key = props.shadeKey || props.route || '';
  const color = currentMap.get(key) || (props.route ? currentMap.get(props.route) : null);
  if (!color) return null;
  return { color, routeColor: color };
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
  currentOperator = null;
}

export function buildMatchExpression(routeColorMap, fallback = '#888888') {
  if (routeColorMap.size === 0) return ['get', 'color'];
  const pairs = [];
  for (const [route, color] of routeColorMap) {
    pairs.push(route, color);
  }
  return ['match', ['get', 'route'], ...pairs, fallback];
}
