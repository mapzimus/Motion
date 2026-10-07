// Vehicle marker shapes on a 64-unit grid, pointing north. Each GLYPHS entry
// traces a path on a 2D canvas context (map sprites fill and stroke it); the
// polygon data is exported so the legend can draw the same shapes as SVG.
// Sprite names are `icon-<shape>-<hex6>`, one image per shape and color.

// Airliner from above, nose up: fuselage, swept wings, tailplane.
export const PLANE_HALF = [
  [32, 2], [35, 8], [36, 20], [62, 36], [62, 43], [36, 33],
  [35, 46], [45, 56], [45, 61], [32, 57],
];
// Light aircraft from above: short fuselage, straight high wing, small tail.
const LIGHT_PLANE_HALF = [
  [32, 8], [35, 11], [35, 21], [61, 21], [61, 29], [35, 30],
  [34, 47], [44, 48], [44, 54], [33, 55], [32, 58],
];
// Anything else that flies (glider, balloon, drone, unknown): a plain dart.
const DART_HALF = [
  [32, 6], [50, 56], [32, 46],
];
// Boat hull from above, bow up.
export const BOAT_HALF = [
  [32, 2], [45, 14], [48, 34], [45, 58], [32, 61],
];
// Two-car train from above, nose up. A tapered cab and a pinched coupler
// keep it from reading as the bus's single rounded box.
const TRAIN_HALF = [
  [32, 2], [38, 10], [40, 16], [40, 32], [36, 35],
  [40, 38], [40, 54], [36, 60], [32, 61],
];

/** The full outline of a left/right symmetric shape from its right half (64-unit grid). */
export function mirrorHalf(rightHalf) {
  return [...rightHalf, ...[...rightHalf].reverse().map(([x, y]) => [64 - x, y])];
}

function polygon(points) {
  return (ctx, size) => {
    const u = size / 64;
    ctx.beginPath();
    ctx.moveTo(points[0][0] * u, points[0][1] * u);
    for (const [x, y] of points.slice(1)) ctx.lineTo(x * u, y * u);
    ctx.closePath();
  };
}

// Helicopter from above: crossed rotor blades over a cabin and tail boom.
// Every sub-path winds the same way so the fill is one clean silhouette.
function helicopter(ctx, size) {
  const u = size / 64;
  const blade = (angle) => {
    const [cx, cy, half, width] = [32, 27, 27, 2.6];
    const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
    const [nx, ny] = [dy * width, -dx * width]; // keeps the blade clockwise like rect()
    ctx.moveTo((cx - dx * half + nx) * u, (cy - dy * half + ny) * u);
    ctx.lineTo((cx + dx * half + nx) * u, (cy + dy * half + ny) * u);
    ctx.lineTo((cx + dx * half - nx) * u, (cy + dy * half - ny) * u);
    ctx.lineTo((cx - dx * half - nx) * u, (cy - dy * half - ny) * u);
    ctx.closePath();
  };
  ctx.beginPath();
  ctx.ellipse(32 * u, 28 * u, 9 * u, 13 * u, 0, 0, Math.PI * 2);
  ctx.closePath();
  ctx.rect(30 * u, 38 * u, 4 * u, 20 * u);
  ctx.rect(25 * u, 55 * u, 14 * u, 4 * u);
  blade(Math.PI / 4);
  blade((3 * Math.PI) / 4);
}

// Rounded boxes on the 64-unit grid: [x, y, w, h, radius].
const BUS_BOX = [21, 8, 22, 48, 9];
const DOCK_BOX = [15, 15, 34, 34, 8];
// Station place-mark: a sharp square, smaller than a vehicle silhouette.
const STATION_BOX = [18, 18, 28, 28];

const roundedRect = (x, y, w, h, r) => (ctx, size) => {
  const u = size / 64;
  ctx.beginPath();
  ctx.roundRect(x * u, y * u, w * u, h * u, r * u);
};

const station = (ctx, size) => {
  const u = size / 64;
  const [x, y, w, h] = STATION_BOX;
  ctx.beginPath();
  ctx.rect(x * u, y * u, w * u, h * u);
};

const diamond = (ctx, size) => {
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.08);
  ctx.lineTo(size * 0.92, size * 0.5);
  ctx.lineTo(size * 0.5, size * 0.92);
  ctx.lineTo(size * 0.08, size * 0.5);
  ctx.closePath();
};

const scooter = (ctx, size) => {
  const u = size / 64;
  ctx.beginPath();
  ctx.roundRect(12 * u, 40 * u, 38 * u, 11 * u, 5 * u);
  ctx.moveTo(43 * u, 42 * u);
  ctx.lineTo(48 * u, 12 * u);
  ctx.lineTo(57 * u, 12 * u);
  ctx.lineTo(57 * u, 18 * u);
  ctx.lineTo(51 * u, 18 * u);
  ctx.lineTo(47 * u, 42 * u);
};

/** shape name -> (ctx, size) => void path builder. */
export const GLYPHS = {
  plane: polygon(mirrorHalf(PLANE_HALF)),
  'plane-light': polygon(mirrorHalf(LIGHT_PLANE_HALF)),
  'plane-heli': helicopter,
  'plane-other': polygon(mirrorHalf(DART_HALF)),
  boat: polygon(mirrorHalf(BOAT_HALF)),
  train: polygon(mirrorHalf(TRAIN_HALF)),
  bus: roundedRect(...BUS_BOX),
  station,
  dock: roundedRect(...DOCK_BOX),
  'share-bike': diamond,
  'share-scooter': scooter,
};

const svgPolygon = (points) => `M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
const svgRoundedRect = (x, y, w, h, r) =>
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
  `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
  `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;

const svgRect = (x, y, w, h) => `M${x} ${y}H${x + w}V${y + h}H${x}Z`;

const SVG_PATHS = {
  plane: svgPolygon(mirrorHalf(PLANE_HALF)),
  boat: svgPolygon(mirrorHalf(BOAT_HALF)),
  train: svgPolygon(mirrorHalf(TRAIN_HALF)),
  bus: svgRoundedRect(...BUS_BOX),
  station: svgRect(...STATION_BOX),
  dock: svgRoundedRect(...DOCK_BOX),
};

/** SVG path `d` (64x64 viewBox) for a legend shape, '' when the shape has none. */
export function glyphSvgPath(shape) {
  return SVG_PATHS[shape] ?? '';
}

/** Sprite name for a shape in a color: iconName('bus', '#F2B84B') -> 'icon-bus-f2b84b'. */
export function iconName(shape, hex) {
  return `icon-${shape}-${String(hex).replace(/^#/, '').toLowerCase()}`;
}

/** The shape and color a sprite name asks for, or null when it is not one of our sprites. */
export function parseIconName(name) {
  const match = /^icon-(.+)-([0-9a-f]{6})$/i.exec(String(name));
  if (!match || !Object.hasOwn(GLYPHS, match[1])) return null;
  return { shape: match[1], color: `#${match[2].toLowerCase()}` };
}
