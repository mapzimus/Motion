// Vehicle marker shapes on a 64-unit grid, pointing north. Each GLYPHS entry
// traces a path on a 2D canvas context (map sprites fill and stroke it); the
// polygon data is exported so the legend can draw the same shapes as SVG.
// Sprite names are `icon-<shape>-<hex6>`, one image per shape and color.

// Airliner from above, nose up: fuselage, swept wings, tailplane.
export const PLANE_HALF = [
  [32, 2], [35, 8], [36, 20], [62, 36], [62, 43], [36, 33],
  [35, 46], [45, 56], [45, 61], [32, 57],
];
// Boat hull from above, bow up.
export const BOAT_HALF = [
  [32, 2], [45, 14], [48, 34], [45, 58], [32, 61],
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

// Rounded boxes on the 64-unit grid: [x, y, w, h, radius].
const BUS_BOX = [21, 8, 22, 48, 9];
const DOCK_BOX = [15, 15, 34, 34, 8];

const roundedRect = (x, y, w, h, r) => (ctx, size) => {
  const u = size / 64;
  ctx.beginPath();
  ctx.roundRect(x * u, y * u, w * u, h * u, r * u);
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
  boat: polygon(mirrorHalf(BOAT_HALF)),
  bus: roundedRect(...BUS_BOX),
  dock: roundedRect(...DOCK_BOX),
  'share-bike': diamond,
  'share-scooter': scooter,
};

const svgPolygon = (points) => `M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
const svgRoundedRect = (x, y, w, h, r) =>
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
  `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
  `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;

const SVG_PATHS = {
  plane: svgPolygon(mirrorHalf(PLANE_HALF)),
  boat: svgPolygon(mirrorHalf(BOAT_HALF)),
  bus: svgRoundedRect(...BUS_BOX),
  dock: svgRoundedRect(...DOCK_BOX),
};

/** SVG path `d` (64x64 viewBox) for the plane, boat, bus or dock shape, '' for others. */
export function glyphSvgPath(shape) {
  return SVG_PATHS[shape] ?? '';
}

/** Sprite name for a shape in a color: iconName('bus', '#F2B84B') -> 'icon-bus-f2b84b'. */
export function iconName(shape, hex) {
  return `icon-${shape}-${String(hex).replace(/^#/, '').toLowerCase()}`;
}

/** The shape and color a sprite name asks for, or null when it is not a vehicle sprite. */
export function parseIconName(name) {
  const match = /^icon-(.+)-([0-9a-f]{6})$/i.exec(String(name));
  if (!match || !Object.hasOwn(GLYPHS, match[1])) return null;
  return { shape: match[1], color: `#${match[2].toLowerCase()}` };
}
