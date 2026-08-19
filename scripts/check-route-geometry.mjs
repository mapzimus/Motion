import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MAX_BUS_CHORD_KM = 20.05;
const MAX_ROAD_DETOUR_RATIO = 1.6;
const MAX_ROAD_DETOUR_ALLOWANCE_KM = 5;
const ROAD_ROUTING_VERSION = 'osrm-driving-bus-controls-v4';
const RESTRICTED_BUS_ROAD_PATTERN = /\b(?:Merritt|Wilbur Cross|Hutchinson River|Saw Mill River|Henry Hudson|Mosholu|Palisades Interstate|Taconic State|Bronx River|Belt|Cross Island|Jackie Robinson|Grand Central|Cross County|Sprain Brook|Bear Mountain|Lake Welch|Pelham|Ocean|Korean War Veterans) (?:Parkway|Pkwy)\b|\b(?:FDR|Franklin D\.? Roosevelt|Harlem River) (?:Drive|Dr)\b/i;
const cacheRaw = readFileSync(new URL('./road-route-cache.json', import.meta.url));
const controlsRaw = readFileSync(new URL('./road-route-controls.json', import.meta.url));
const cache = JSON.parse(cacheRaw);
const collection = JSON.parse(readFileSync(new URL('../data/regional-routes.geojson', import.meta.url), 'utf8'));

function normalizedSha256(raw) {
  return createHash('sha256').update(raw.toString('utf8').replaceAll('\r\n', '\n')).digest('hex');
}

function distanceKm(start, end) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const lat1 = radians(start[1]);
  const lat2 = radians(end[1]);
  const dlat = radians(end[1] - start[1]);
  const dlon = radians(end[0] - start[0]);
  const value = Math.sin(dlat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(value));
}

function pathLengthKm(path) {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    length += distanceKm(path[index - 1], path[index]);
  }
  return length;
}

function coordinateToken(point) {
  return `${Number(point[0]).toFixed(5)},${Number(point[1]).toFixed(5)}`;
}

function samePoint(first, second) {
  return coordinateToken(first) === coordinateToken(second);
}

function loopMetrics(path) {
  const start = path[0];
  const end = path.at(-1);
  const meanLatitude = (start[1] + end[1]) * Math.PI / 360;
  const xScale = 111.32 * Math.cos(meanLatitude);
  const yScale = 110.57;
  const endX = (end[0] - start[0]) * xScale;
  const endY = (end[1] - start[1]) * yScale;
  const magnitude = Math.hypot(endX, endY) || 1;
  const unitX = endX / magnitude;
  const unitY = endY / magnitude;
  const progress = path.map((point) => (
    (point[0] - start[0]) * xScale * unitX + (point[1] - start[1]) * yScale * unitY
  ));
  let backtrackingKm = 0;
  let maxProgress = progress[0];
  let maxDrawdownKm = 0;
  for (let index = 1; index < progress.length; index += 1) {
    backtrackingKm += Math.max(0, progress[index - 1] - progress[index]);
    maxProgress = Math.max(maxProgress, progress[index]);
    maxDrawdownKm = Math.max(maxDrawdownKm, maxProgress - progress[index]);
  }

  const cumulative = [0];
  for (let index = 1; index < path.length; index += 1) {
    cumulative.push(cumulative.at(-1) + distanceKm(path[index - 1], path[index]));
  }
  const firstOccurrence = new Map();
  let maxRepeatSeparationKm = 0;
  path.forEach((point, index) => {
    const token = coordinateToken(point);
    if (firstOccurrence.has(token) && index - firstOccurrence.get(token).index > 2) {
      maxRepeatSeparationKm = Math.max(
        maxRepeatSeparationKm,
        cumulative[index] - firstOccurrence.get(token).distance,
      );
    } else if (!firstOccurrence.has(token)) {
      firstOccurrence.set(token, { index, distance: cumulative[index] });
    }
  });
  return { backtrackingKm, maxDrawdownKm, maxRepeatSeparationKm };
}

if (cache.routingVersion !== ROAD_ROUTING_VERSION) {
  throw new Error(`Road cache routing version must be ${ROAD_ROUTING_VERSION}.`);
}
const controlsHash = normalizedSha256(controlsRaw);
if (cache.controlsSha256 !== controlsHash) {
  throw new Error('Road cache was not built with the current bus-route controls.');
}

const cacheOffenders = [];
for (const [key, record] of Object.entries(cache.segments ?? {})) {
  const endpoints = key.replace(/^driving:/, '').split('|').map(
    (token) => token.split(',').map(Number),
  );
  const path = record.coordinates ?? [];
  if (endpoints.length !== 2 || endpoints.some((point) => point.some((value) => !Number.isFinite(value)))) {
    cacheOffenders.push(`${key}: malformed cache key`);
    continue;
  }
  if (path.length < 4 || path.some((point) => point.length !== 2 || point.some((value) => !Number.isFinite(value)))) {
    cacheOffenders.push(`${key}: malformed coordinates`);
    continue;
  }
  if (record.requestSignature !== `${ROAD_ROUTING_VERSION}|${controlsHash}|${key}`) {
    cacheOffenders.push(`${key}: stale request signature`);
  }
  if (record.roadAudit?.version !== 'osrm-steps-road-names-v2'
      || !Array.isArray(record.roadAudit?.roads)
      || record.roadAudit.roads.length === 0) {
    cacheOffenders.push(`${key}: missing bus-restriction road audit`);
  } else if (record.roadAudit.roads.some((road) => RESTRICTED_BUS_ROAD_PATTERN.test(road))) {
    cacheOffenders.push(`${key}: audited road list contains a bus-restricted roadway`);
  }
  for (const segment of record.roadAudit?.ct15Segments ?? []) {
    const bbox = segment.bbox;
    if (!Array.isArray(bbox) || bbox.length !== 4
        || bbox.some((value) => !Number.isFinite(value))
        || bbox[1] < 41.65 || bbox[0] < -72.75 || Number(segment.distanceKm) > 8) {
      cacheOffenders.push(`${key}: audited CT 15 segment enters a bus-restricted parkway`);
    }
  }
  if (!samePoint(record.from, path[0]) || !samePoint(record.to, path.at(-1))) {
    cacheOffenders.push(`${key}: from/to fields do not match the geometry`);
  }
  if (!samePoint(endpoints[0], path[0]) || !samePoint(endpoints[1], path.at(-1))) {
    cacheOffenders.push(`${key}: geometry does not match the cache-key endpoints`);
  }
  const directKm = distanceKm(path[0], path.at(-1));
  const lengthKm = pathLengthKm(path);
  if (Math.abs(Number(record.directKm) - directKm) > 0.05
      || Math.abs(Number(record.distanceKm) - lengthKm) > 0.1) {
    cacheOffenders.push(`${key}: stored distance metadata is stale`);
  }
  for (let index = 1; index < path.length; index += 1) {
    const chordKm = distanceKm(path[index - 1], path[index]);
    if (samePoint(path[index - 1], path[index])) {
      cacheOffenders.push(`${key}: consecutive duplicate coordinate`);
      break;
    }
    if (chordKm > MAX_BUS_CHORD_KM) {
      cacheOffenders.push(`${key}: ${chordKm.toFixed(1)} km cache chord`);
      break;
    }
  }
  if (lengthKm > directKm * MAX_ROAD_DETOUR_RATIO + MAX_ROAD_DETOUR_ALLOWANCE_KM) {
    cacheOffenders.push(`${key}: ${lengthKm.toFixed(1)} km detour for ${directKm.toFixed(1)} km endpoints`);
  }
  const { backtrackingKm, maxDrawdownKm, maxRepeatSeparationKm } = loopMetrics(path);
  const excess = lengthKm - directKm > Math.max(20, directKm * 0.35);
  const backtracking = backtrackingKm > Math.max(5, directKm * 0.08);
  const drawdown = maxDrawdownKm > Math.max(5, directKm * 0.03);
  const repeated = maxRepeatSeparationKm > Math.max(5, directKm * 0.02);
  if (repeated || (backtracking && drawdown) || (excess && (backtracking || drawdown))) {
    cacheOffenders.push(`${key}: loop/backtracking detected`);
  }
}

if (cacheOffenders.length) {
  throw new Error(`Invalid cached road geometry:\n${[...new Set(cacheOffenders)].join('\n')}`);
}

const expectedCacheHash = normalizedSha256(cacheRaw);
if (collection.metadata?.roadGeometryRoutingVersion !== ROAD_ROUTING_VERSION
    || collection.metadata?.roadGeometryControlsSha256 !== controlsHash
    || collection.metadata?.roadGeometryCacheSha256 !== expectedCacheHash) {
  throw new Error('Regional route data was not built from the current road cache.');
}

const offenders = [];
for (const feature of collection.features ?? []) {
  if (feature.properties?.group !== 'bus') continue;
  const paths = feature.geometry?.type === 'LineString'
    ? [feature.geometry.coordinates]
    : feature.geometry?.coordinates ?? [];
  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      const distance = distanceKm(path[index - 1], path[index]);
      if (distance > MAX_BUS_CHORD_KM) {
        offenders.push(`${feature.properties.route}: ${distance.toFixed(1)} km`);
      }
    }
  }
}

if (offenders.length) {
  throw new Error(`Straight-line bus geometry exceeds ${MAX_BUS_CHORD_KM} km:\n${offenders.join('\n')}`);
}

const vineyardFerry = collection.features.find(
  (feature) => feature.properties?.route === 'vineyard-fast-ferry:2100',
);
if (vineyardFerry?.properties?.group !== 'ferry') {
  throw new Error('Vineyard Fast Ferry must be classified as a ferry, not a bus.');
}

const approximate = collection.features.filter(
  (feature) => feature.properties?.geometryAccuracy === 'approximate',
);
const requiredRoadRoutedRoutes = [
  'greyhound-flix:2610',
  'greyhound-flix:2611',
  'greyhound-flix:2614',
  'greyhound-flix:2681',
  'greyhound-flix:N2605',
  'greyhound-flix:US0231',
  'greyhound-flix:US0235',
  'boston-express:BX3N',
  'boston-express:BX3S',
  'boston-express:BX93N',
  'boston-express:BX93S',
  'dartmouth-coach:boston-logan',
  'dartmouth-coach:nyc',
];
const approximateRouteIds = new Set(approximate.map((feature) => feature.properties.route));
const missingRepairs = requiredRoadRoutedRoutes.filter((route) => !approximateRouteIds.has(route));
if (missingRepairs.length) {
  throw new Error(`Expected road-routed geometry is missing for: ${missingRepairs.join(', ')}`);
}
console.log(
  `Route geometry check passed: ${approximate.length} road-routed scheduled features; `
  + `${Object.keys(cache.segments ?? {}).length} loop-free cache segments; `
  + `no bus chord exceeds ${MAX_BUS_CHORD_KM} km.`,
);
