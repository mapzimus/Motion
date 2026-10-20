// Pure helpers for the 3D vehicle layer, kept free of WebGL and MapLibre so
// they can be unit-tested: which mesh a vehicle wears, how big it is at a
// given zoom, its color, and where it sits relative to the scene origin.

// Mesh dimensions in metres (length along the heading, height, width).
export const SHAPES = {
  train: [22, 4.5, 3.2],
  bus: [12, 3.4, 2.8],
  boat: [26, 6, 7],
  plane: [18, 3.5, 18],
  bike: [2.4, 2.4, 2.4],
  dot: [6, 6, 6],
};

const TRAIN_GROUPS = new Set(['red', 'orange', 'green', 'blue', 'mattapan', 'commuter', 'amtrak', 'nyc-subway']);

/** The mesh family for a vehicle's layer group. */
export function shapeFor(group) {
  if (TRAIN_GROUPS.has(group)) return 'train';
  if (group === 'bus' || group === 'silver' || group === 'coach') return 'bus';
  if (group === 'ferry' || group === 'vessel') return 'boat';
  if (group === 'plane') return 'plane';
  if (group === 'bike') return 'bike';
  return 'dot';
}

/**
 * Metres per model metre at this zoom. At street zoom a bus is life-size;
 * zoomed out the meshes grow so they stay a few pixels wide, like the icons.
 */
export function sizeScale(zoom) {
  return Math.max(1, 2 ** (15.5 - zoom));
}

/** The color the mesh wears: the map's ground-aware colors first, then the feed's. */
export function meshColor(props) {
  return props.mapRouteColor ?? props.mapColor ?? props.routeColor ?? props.color ?? '#8a939c';
}

/**
 * Altitude above ground in metres for a vehicle: aircraft fly at their
 * reported altitude (capped so cruising jets stay in frame), everything else
 * sits on the ground.
 */
export function altitudeMetres(props) {
  if (props.group !== 'plane' || props.stale) return 0;
  const feet = Number(props.altitudeFeet);
  if (!Number.isFinite(feet) || feet <= 0) return 60;
  return Math.min(feet * 0.3048, 3000);
}

/**
 * Position in the scene's local frame: x east and z south in model units
 * (metres at `metresPerUnit` = 1), y up. `point` and `origin` are Mercator
 * coordinates {x, y}; `metresPerUnit` is the Mercator size of one metre at
 * the origin latitude.
 */
export function localPosition(point, origin, metresPerUnit, altitude = 0) {
  return [
    (point.x - origin.x) / metresPerUnit,
    altitude,
    (point.y - origin.y) / metresPerUnit,
  ];
}

/** Three.js rotation about Y (radians) that turns a north-facing mesh to a compass bearing. */
export function headingRotation(bearing, hasBearing) {
  return hasBearing ? -((Number(bearing) || 0) * Math.PI) / 180 : 0;
}

/** True when the scene origin is far enough from the view to cost float precision. */
export function originStale(origin, center, metresPerUnit, limitMetres = 40_000) {
  if (!origin) return true;
  const dx = (center.x - origin.x) / metresPerUnit;
  const dy = (center.y - origin.y) / metresPerUnit;
  return Math.hypot(dx, dy) > limitMetres;
}
