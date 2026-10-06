import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MAX_BUS_CHORD_KM = 20.05;
const MAX_AMTRAK_CHORD_KM = 20.05;
const MAX_RAIL_CHORD_KM = 20.05;
const MAX_FERRY_TERMINAL_KM = 1.5;
const FERRY_AUDIT_VERSION = 'osm-land-v3';
const MAX_FERRY_INTERIOR_DRY_M = 25;
const MAX_FERRY_ENDPOINT_DRY_M = 150;
const MIN_FERRY_PATH_KM = 0.15;
const MIN_FERRY_LENGTH_RATIO = 0.95;
const FERRY_UPDATE_COMMAND = 'py -3 -X utf8 scripts/build-regional-routes.py --update-ferry-cache';
const MAX_ROAD_DETOUR_RATIO = 1.6;
const MAX_ROAD_DETOUR_ALLOWANCE_KM = 5;
const ROAD_ROUTING_VERSION = 'osrm-driving-bus-controls-v4';
const RESTRICTED_BUS_ROAD_PATTERN = /\b(?:Merritt|Wilbur Cross|Hutchinson River|Saw Mill River|Henry Hudson|Mosholu|Palisades Interstate|Taconic State|Bronx River|Belt|Cross Island|Jackie Robinson|Grand Central|Cross County|Sprain Brook|Bear Mountain|Lake Welch|Pelham|Ocean|Korean War Veterans) (?:Parkway|Pkwy)\b|\b(?:FDR|Franklin D\.? Roosevelt|Harlem River) (?:Drive|Dr)\b/i;
const cacheRaw = readFileSync(new URL('./road-route-cache.json', import.meta.url));
const controlsRaw = readFileSync(new URL('./road-route-controls.json', import.meta.url));
const cache = JSON.parse(cacheRaw);
const collection = JSON.parse(readFileSync(new URL('../public/data/regional-routes.geojson', import.meta.url), 'utf8'));
const airports = JSON.parse(readFileSync(new URL('../public/data/airports.geojson', import.meta.url), 'utf8'));
const borderCrossings = JSON.parse(
  readFileSync(new URL('../public/data/border-crossings.geojson', import.meta.url), 'utf8'),
);
const localServices = JSON.parse(
  readFileSync(new URL('../public/data/local-services.geojson', import.meta.url), 'utf8'),
);
const referencePlaces = JSON.parse(
  readFileSync(new URL('../public/data/reference-places.geojson', import.meta.url), 'utf8'),
);
const supplementalFerries = JSON.parse(
  readFileSync(new URL('./supplemental-ferry-routes.json', import.meta.url), 'utf8'),
);
const supplementalAir = JSON.parse(
  readFileSync(new URL('./supplemental-air-routes.json', import.meta.url), 'utf8'),
);
const ferryWaterCacheRaw = readFileSync(new URL('./ferry-water-cache.json', import.meta.url));
const ferryWaterCache = JSON.parse(ferryWaterCacheRaw);

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

const amtrakRoutes = collection.features.filter(
  (feature) => feature.properties?.group === 'amtrak'
    && feature.properties?.kind === 'regional-static',
);
const requiredNewEnglandAmtrak = [
  'Acela', 'Amtrak Hartford Line', 'Downeaster', 'Ethan Allen Express',
  'Lake Shore Limited', 'Northeast Regional', 'Valley Flyer', 'Vermonter',
];
const amtrakNames = new Set(amtrakRoutes.map((feature) => feature.properties.name));
if (amtrakNames.size !== requiredNewEnglandAmtrak.length
    || requiredNewEnglandAmtrak.some((name) => !amtrakNames.has(name))) {
  throw new Error('Official scheduled Amtrak coverage is missing a New England route.');
}
const vermontAmtrakNames = new Set(
  amtrakRoutes
    .filter((feature) => feature.properties?.regions?.includes('vt'))
    .map((feature) => feature.properties.name),
);
const requiredVermontAmtrak = ['Ethan Allen Express', 'Vermonter'];
if (vermontAmtrakNames.size !== requiredVermontAmtrak.length
    || requiredVermontAmtrak.some((name) => !vermontAmtrakNames.has(name))) {
  throw new Error('Vermont must contain scheduled Vermonter and Ethan Allen Express route geometry.');
}

const requiredVermontStationCodes = [
  'BLF', 'BRA', 'BTN', 'CNV', 'ESX', 'MBY', 'MPR',
  'RPH', 'RUD', 'SAB', 'VRN', 'WAB', 'WNM', 'WRJ',
];
const vermontStationCodes = new Set(
  collection.features
    .filter((feature) => feature.properties?.group === 'amtrak'
      && feature.properties?.kind === 'regional-station'
      && feature.properties?.regions?.includes('vt'))
    .map((feature) => feature.properties.stationCode),
);
if (vermontStationCodes.size !== requiredVermontStationCodes.length
    || requiredVermontStationCodes.some((code) => !vermontStationCodes.has(code))) {
  throw new Error('Vermont Amtrak station coverage must contain all 14 official station codes.');
}

const amtrakChordOffenders = [];
for (const feature of amtrakRoutes) {
  const paths = feature.geometry?.type === 'LineString'
    ? [feature.geometry.coordinates]
    : feature.geometry?.coordinates ?? [];
  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      const distance = distanceKm(path[index - 1], path[index]);
      if (distance > MAX_AMTRAK_CHORD_KM) {
        amtrakChordOffenders.push(`${feature.properties.route}: ${distance.toFixed(1)} km`);
      }
    }
  }
}
if (amtrakChordOffenders.length) {
  throw new Error(
    `Straight-line Amtrak geometry exceeds ${MAX_AMTRAK_CHORD_KM} km:\n${amtrakChordOffenders.join('\n')}`,
  );
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
  'cyr-bus:bangor-caribou',
  'cj:boston-south-station',
  'cj:logan',
  'cj:nyc',
  'go-buses:boston-nyc',
];
const approximateRouteIds = new Set(approximate.map((feature) => feature.properties.route));
const missingRepairs = requiredRoadRoutedRoutes.filter((route) => !approximateRouteIds.has(route));
if (missingRepairs.length) {
  throw new Error(`Expected road-routed geometry is missing for: ${missingRepairs.join(', ')}`);
}

function canonicalCoordinates(value) {
  if (Array.isArray(value)
      && value.length === 2
      && value.every((item) => Number.isFinite(item))) {
    return `${Number(value[0]).toFixed(6)},${Number(value[1]).toFixed(6)}`;
  }
  return `[${value.map(canonicalCoordinates).join('|')}]`;
}

const supplementalFerryIds = supplementalFerries.features.map(
  (feature) => feature.properties?.route,
);
const duplicateSupplementalFerryIds = supplementalFerryIds.filter(
  (route, index) => supplementalFerryIds.indexOf(route) !== index,
);
if (supplementalFerries.features.length < 45 || duplicateSupplementalFerryIds.length) {
  throw new Error(
    `Supplemental ferry inventory is incomplete or duplicated: ${duplicateSupplementalFerryIds.join(', ')}`,
  );
}
const allowedFerryServiceClasses = new Set([
  'international', 'island-access', 'lifeline', 'municipal', 'regional', 'venue-access',
]);
const invalidSupplementalFerries = supplementalFerries.features.filter((feature) => {
  const properties = feature.properties ?? {};
  return properties.group !== 'ferry'
    || !allowedFerryServiceClasses.has(properties.serviceClass)
    || !properties.serviceType
    || !properties.season
    || !/^https:\/\//.test(properties.sourceUrl ?? '')
    || !['LineString', 'MultiLineString'].includes(feature.geometry?.type);
});
if (invalidSupplementalFerries.length) {
  throw new Error(
    `Supplemental ferry metadata is invalid for: ${invalidSupplementalFerries.map((feature) => feature.properties?.route).join(', ')}`,
  );
}
const generatedRouteIds = new Set(collection.features.map((feature) => feature.properties?.route));
const missingSupplementalFerries = supplementalFerryIds.filter(
  (route) => !generatedRouteIds.has(route),
);
if (missingSupplementalFerries.length) {
  throw new Error(
    `Generated regional data is missing supplemental ferries: ${missingSupplementalFerries.join(', ')}`,
  );
}
const invalidGeneratedFerries = supplementalFerryIds.filter((route) => {
  const matches = collection.features.filter((feature) => feature.properties?.route === route);
  const properties = matches[0]?.properties ?? {};
  return matches.length !== 1
    || properties.kind !== 'regional-static'
    || properties.dataStatus !== 'scheduled'
    || properties.geometryAccuracy !== 'approximate'
    || !properties.geometryNote
    || !properties.serviceType
    || !properties.season;
});
if (invalidGeneratedFerries.length) {
  throw new Error(
    `Generated supplemental ferry metadata is invalid for: ${invalidGeneratedFerries.join(', ')}`,
  );
}

// Every ferry line comes from scripts/ferry-water-cache.json, whose entries
// were produced and audited against OpenStreetMap land/inland water by
// build-regional-routes.py --update-ferry-cache. The cache is checked on its
// own first (meaningful even before data/ is rebuilt), then every generated
// ferry must match its cache entry exactly.
function ferryPaths(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function segmentsCross(a, b, c, d) {
  const orient = (p, q, r) => {
    const value = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    if (Math.abs(value) < 1e-14) return 0;
    return value > 0 ? 1 : -1;
  };
  const onSegment = (p, q, r) => Math.min(p[0], r[0]) - 1e-12 <= q[0] && q[0] <= Math.max(p[0], r[0]) + 1e-12
    && Math.min(p[1], r[1]) - 1e-12 <= q[1] && q[1] <= Math.max(p[1], r[1]) + 1e-12;
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

function selfIntersects(path) {
  const closed = path.length > 3 && samePoint(path[0], path.at(-1));
  for (let i = 0; i < path.length - 1; i += 1) {
    for (let j = i + 2; j < path.length - 1; j += 1) {
      if (closed && i === 0 && j === path.length - 2) continue;
      if (segmentsCross(path[i], path[i + 1], path[j], path[j + 1])) return true;
    }
  }
  return false;
}

function ferryPathProblems(path) {
  const problems = [];
  if (path.length < 2 || path.some((point) => point.length !== 2 || point.some((value) => !Number.isFinite(value)))) {
    return ['malformed coordinates'];
  }
  const lengthKm = pathLengthKm(path);
  const directKm = distanceKm(path[0], path.at(-1));
  if (lengthKm <= MIN_FERRY_PATH_KM) problems.push(`path is only ${lengthKm.toFixed(3)} km long`);
  if (lengthKm < MIN_FERRY_LENGTH_RATIO * directKm - 1e-6) problems.push('path is shorter than its terminal distance');
  if (selfIntersects(path)) problems.push('path self-intersects');
  return problems;
}

const ferryCacheRoutes = ferryWaterCache.routes ?? {};
const ferryCacheOffenders = [];
if (ferryWaterCache.auditVersion !== FERRY_AUDIT_VERSION) {
  ferryCacheOffenders.push(`cache auditVersion must be ${FERRY_AUDIT_VERSION}`);
}
const ferryAliases = ferryWaterCache.aliases ?? {};
const ferryRoutesByHash = new Map();
for (const [route, record] of Object.entries(ferryCacheRoutes)) {
  const audit = record.waterAudit ?? {};
  const hash = createHash('sha256').update(canonicalCoordinates(record.coordinates ?? [])).digest('hex');
  if (!['LineString', 'MultiLineString'].includes(record.geometryType)) {
    ferryCacheOffenders.push(`${route}: invalid geometryType`);
    continue;
  }
  if (record.geometrySha256 !== hash) ferryCacheOffenders.push(`${route}: geometrySha256 does not match coordinates`);
  if (!String(record.requestSignature ?? '').startsWith(`${FERRY_AUDIT_VERSION}|`)) {
    ferryCacheOffenders.push(`${route}: stale request signature`);
  }
  if (!/^(gtfs-shape|hand|osm-way:\d+(\+\d+)*)(\+(gtfs-shape|hand|osm-way:\d+(\+\d+)*))*$/.test(record.source ?? '')) {
    ferryCacheOffenders.push(`${route}: unknown geometry source ${record.source}`);
  }
  if (audit.auditVersion !== FERRY_AUDIT_VERSION
      || audit.pass !== true
      || audit.selfIntersects !== false
      || !(Number(audit.interiorDryM) <= MAX_FERRY_INTERIOR_DRY_M)
      || !(Number(audit.endpointDryM) <= MAX_FERRY_ENDPOINT_DRY_M)) {
    ferryCacheOffenders.push(
      `${route}: water audit did not pass (${(audit.failures ?? []).join('; ') || 'missing or stale audit'})`,
    );
  }
  const paths = ferryPaths({ type: record.geometryType, coordinates: record.coordinates });
  let totalKm = 0;
  let totalDirectKm = 0;
  paths.forEach((path, index) => {
    for (const problem of ferryPathProblems(path)) ferryCacheOffenders.push(`${route} path ${index}: ${problem}`);
    if (path.length >= 2) {
      totalKm += pathLengthKm(path);
      totalDirectKm += distanceKm(path[0], path.at(-1));
    }
  });
  if (Math.abs(Number(record.lengthKm) - totalKm) > 0.05 || Math.abs(Number(record.directKm) - totalDirectKm) > 0.05) {
    ferryCacheOffenders.push(`${route}: stored lengthKm/directKm are stale`);
  }
  const canonical = ferryAliases[route] ?? route;
  if (!ferryRoutesByHash.has(hash)) ferryRoutesByHash.set(hash, new Map());
  ferryRoutesByHash.get(hash).set(canonical, route);
}
for (const routes of ferryRoutesByHash.values()) {
  if (routes.size > 1) {
    ferryCacheOffenders.push(
      `routes share identical geometry without an alias: ${[...routes.values()].join(', ')}`,
    );
  }
}
if (ferryCacheOffenders.length) {
  throw new Error(`Invalid ferry water cache:\n${[...new Set(ferryCacheOffenders)].join('\n')}`);
}

const generatedFerries = collection.features.filter(
  (feature) => feature.properties?.group === 'ferry'
    && ['LineString', 'MultiLineString'].includes(feature.geometry?.type),
);
const ferryMetadata = collection.metadata?.ferryWaterCache ?? {};
if ((ferryMetadata.missing ?? []).length) {
  throw new Error(
    `Ferry routes have no audited water geometry: ${ferryMetadata.missing.join(', ')}.\n`
    + `Run \`${FERRY_UPDATE_COMMAND}\` (after scripts/fetch-ferry-audit-data.py) and commit `
    + 'scripts/ferry-water-cache.json.',
  );
}
if (ferryMetadata.auditVersion !== FERRY_AUDIT_VERSION
    || ferryMetadata.cacheSha256 !== normalizedSha256(ferryWaterCacheRaw)) {
  throw new Error(
    'Regional route data was not built from the current ferry water cache. '
    + 'Rebuild with py -3 -X utf8 scripts/build-regional-routes.py.',
  );
}
const unauditedFerries = [];
for (const feature of generatedFerries) {
  const route = feature.properties?.route;
  const record = ferryCacheRoutes[route];
  if (!record) {
    unauditedFerries.push(`${route}: no ferry-water-cache entry (run ${FERRY_UPDATE_COMMAND})`);
    continue;
  }
  const actualHash = createHash('sha256')
    .update(canonicalCoordinates(feature.geometry.coordinates))
    .digest('hex');
  if (actualHash !== record.geometrySha256 || feature.geometry.type !== record.geometryType) {
    unauditedFerries.push(`${route}: geometry differs from its audited cache entry`);
  }
  ferryPaths(feature.geometry).forEach((path, index) => {
    for (const problem of ferryPathProblems(path)) unauditedFerries.push(`${route} path ${index}: ${problem}`);
  });
}
if (unauditedFerries.length) {
  throw new Error(`Ferry geometry failed the water-cache audit:\n${unauditedFerries.join('\n')}`);
}
if ((ferryMetadata.stale ?? []).length) {
  console.warn(
    `Note: ${ferryMetadata.stale.length} ferry route(s) reuse audited geometry although their source changed `
    + `(${ferryMetadata.stale.join(', ')}); run ${FERRY_UPDATE_COMMAND} to re-derive them.`,
  );
}

const scheduledStops = collection.features.filter(
  (feature) => feature.properties?.kind === 'regional-station'
    && feature.geometry?.type === 'Point',
);
const stopsByGroup = new Map();
for (const stop of scheduledStops) {
  const properties = stop.properties ?? {};
  const [longitude, latitude] = stop.geometry.coordinates ?? [];
  if (!Number.isFinite(longitude)
      || !Number.isFinite(latitude)
      || !properties.title
      || !properties.stopKind
      || !Array.isArray(properties.routeIds)
      || !properties.routeIds.length) {
    throw new Error(`Invalid scheduled stop: ${properties.title ?? properties.stationCode ?? 'unknown'}`);
  }
  stopsByGroup.set(properties.group, (stopsByGroup.get(properties.group) ?? 0) + 1);
}
for (const [group, minimum] of Object.entries({
  bus: 30000,
  ferry: 100,
  commuter: 140,
  amtrak: 45,
  red: 20,
  orange: 15,
  green: 55,
  blue: 10,
  silver: 30,
  mattapan: 8,
})) {
  if ((stopsByGroup.get(group) ?? 0) < minimum) {
    throw new Error(`Scheduled ${group} stop coverage is incomplete`);
  }
}

const ferryStops = scheduledStops.filter((feature) => feature.properties?.group === 'ferry');
const ferryTerminalOffenders = [];
for (const ferry of generatedFerries) {
  const route = ferry.properties?.route;
  const paths = ferry.geometry.type === 'LineString'
    ? [ferry.geometry.coordinates]
    : ferry.geometry.coordinates;
  const uniqueEndpoints = new Map();
  for (const path of paths) {
    for (const endpoint of [path[0], path.at(-1)]) {
      uniqueEndpoints.set(coordinateToken(endpoint), endpoint);
    }
  }
  for (const endpoint of uniqueEndpoints.values()) {
      const nearest = Math.min(...ferryStops.map(
        (stop) => distanceKm(endpoint, stop.geometry.coordinates),
      ));
      if (nearest > MAX_FERRY_TERMINAL_KM) {
        ferryTerminalOffenders.push(`${route}: endpoint is ${nearest.toFixed(2)} km from a named landing`);
      }
  }
}
if (ferryTerminalOffenders.length) {
  throw new Error(`Ferry endpoint/landing audit failed:\n${ferryTerminalOffenders.join('\n')}`);
}

const requiredLocalRoutes = [
  'concord-area-transit:crosstown',
  'concord-area-transit:heights',
  'concord-area-transit:penacook',
];
for (const route of requiredLocalRoutes) {
  if (!generatedRouteIds.has(route)) throw new Error(`Missing current local bus route: ${route}`);
}
const unhRoutes = collection.features.filter(
  (feature) => feature.properties?.kind === 'regional-static'
    && feature.properties?.route?.startsWith('unh-wildcat:'),
);
if (unhRoutes.length !== 8) throw new Error('UNH Wildcat Transit must contain all eight published route shapes');

const railChordOffenders = [];
for (const feature of collection.features.filter(
  (item) => item.properties?.kind === 'regional-static'
    && ['commuter', 'amtrak'].includes(item.properties?.group),
)) {
  const paths = feature.geometry.type === 'LineString'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates;
  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      const distance = distanceKm(path[index - 1], path[index]);
      if (distance > MAX_RAIL_CHORD_KM) {
        railChordOffenders.push(`${feature.properties.route}: ${distance.toFixed(1)} km`);
      }
    }
  }
}
if (railChordOffenders.length) {
  throw new Error(`Straight-line rail geometry exceeds ${MAX_RAIL_CHORD_KM} km:\n${railChordOffenders.join('\n')}`);
}
const airportIds = new Set();
for (const feature of airports.features ?? []) {
  const properties = feature.properties ?? {};
  const [longitude, latitude] = feature.geometry?.coordinates ?? [];
  if (feature.geometry?.type !== 'Point'
      || !Number.isFinite(longitude)
      || !Number.isFinite(latitude)
      || properties.group !== 'airport'
      || properties.dataStatus !== 'reference'
      || !properties.faaId
      || !['public', 'private'].includes(properties.facilityUse)) {
    throw new Error(`Invalid FAA landing-facility feature: ${properties.faaId ?? 'unknown'}`);
  }
  if (airportIds.has(properties.faaId)) throw new Error(`Duplicate FAA facility: ${properties.faaId}`);
  airportIds.add(properties.faaId);
}
if (airports.features.length < 750
    || airports.metadata?.publicUseCount < 170
    || !airportIds.has('35ME')
    || !airportIds.has('BOS')) {
  throw new Error('FAA New England landing-facility coverage is incomplete');
}

const borderKeys = new Set();
for (const feature of borderCrossings.features ?? []) {
  const properties = feature.properties ?? {};
  const [longitude, latitude] = feature.geometry?.coordinates ?? [];
  const key = `${properties.title}|${properties.usPort}`;
  if (feature.geometry?.type !== 'Point'
      || !Number.isFinite(longitude)
      || !Number.isFinite(latitude)
      || properties.group !== 'border'
      || properties.dataStatus !== 'reference'
      || !properties.title
      || !properties.usPort
      || !['NB', 'QC'].includes(properties.province)
      || borderKeys.has(key)) {
    throw new Error(`Invalid or duplicate Canada border crossing: ${key}`);
  }
  borderKeys.add(key);
}
if (borderCrossings.features.length !== 38
    || ![...borderKeys].some((key) => key.includes('Pittsburg'))
    || ![...borderKeys].some((key) => key.includes('Madawaska'))
    || ![...borderKeys].some((key) => key.includes('Derby'))) {
  throw new Error('CBSA New England border-crossing coverage is incomplete');
}

const airRouteIds = new Set(supplementalAir.features.map((feature) => feature.properties?.route));
const invalidAirRoutes = supplementalAir.features.filter((feature) => {
  const properties = feature.properties ?? {};
  return feature.geometry?.type !== 'LineString'
    || properties.group !== 'air-service'
    || !['scheduled', 'reference'].includes(properties.dataStatus ?? 'scheduled')
    || !properties.serviceType
    || !properties.season
    || !properties.geometryNote
    || !/^https:\/\//.test(properties.sourceUrl ?? '');
});
if (supplementalAir.features.length !== 18
    || airRouteIds.size !== supplementalAir.features.length
    || invalidAirRoutes.length
    || [...airRouteIds].filter((route) => route.startsWith('penobscot-island-air:')).length !== 4
    || [...airRouteIds].some((route) => !generatedRouteIds.has(route))) {
  throw new Error('Scheduled/on-demand New England air-service coverage is incomplete');
}

const localServiceNames = new Set(
  localServices.features.map((feature) => feature.properties?.title),
);
for (const required of [
  'Boston Water Taxi', 'Red Top Boats water taxi', 'Island Transporter',
  'Quicksilver Water Taxi', 'Bass Harbor Island Cruises', 'Cadillac Water Taxi',
  'Spring Beach Ferry', 'Spirit of Ethan Allen', 'Buttercup Cruises',
]) {
  if (!localServiceNames.has(required)) throw new Error(`Missing on-demand water service: ${required}`);
}
const REFERENCE_PLACE_MINIMUMS = { 'heritage-rail': 15, 'park-ride': 350, 'ev-charging': 5000, drawbridge: 20, taxi: 100 };
const referencePlaceCounts = {};
const referencePlaceIds = new Set();
for (const feature of referencePlaces.features ?? []) {
  const properties = feature.properties ?? {};
  const geometry = feature.geometry ?? {};
  const coordinates = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates;
  const validGeometry = (geometry.type === 'Point' || geometry.type === 'LineString')
    && Array.isArray(coordinates)
    && coordinates.length >= (geometry.type === 'Point' ? 1 : 2)
    && coordinates.every((point) => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]));
  if (!validGeometry
      || !(properties.group in REFERENCE_PLACE_MINIMUMS)
      || properties.dataStatus !== 'reference'
      || !properties.title
      || !properties.provider
      || !/^https:\/\//.test(properties.sourceUrl ?? '')
      || !Array.isArray(properties.regions) || !properties.regions.length
      || (properties.group === 'heritage-rail' && !['rail-network', 'approximate'].includes(properties.geometryAccuracy))
      || (properties.group === 'ev-charging' && typeof properties.fastCharge !== 'boolean')
      || (properties.group === 'drawbridge' && !/^33 CFR 117\.\d+$/.test(properties.cfrSection ?? ''))
      || (properties.group === 'taxi' && !['company', 'association', 'stand'].includes(properties.kind))
      || referencePlaceIds.has(feature.id)) {
    throw new Error(`Invalid or duplicate reference place: ${feature.id ?? properties.title}`);
  }
  referencePlaceIds.add(feature.id);
  referencePlaceCounts[properties.group] = (referencePlaceCounts[properties.group] ?? 0) + 1;
}
for (const [group, minimum] of Object.entries(REFERENCE_PLACE_MINIMUMS)) {
  if ((referencePlaceCounts[group] ?? 0) < minimum) {
    throw new Error(`Reference-place coverage for ${group} is incomplete (${referencePlaceCounts[group] ?? 0} < ${minimum})`);
  }
}

// Feed freshness (offline): scripts/feed-freshness.json is written by
// build-regional-routes.py / check-feed-freshness.py. Every configured feed must
// be listed, and each non-exempt feed must publish service at least
// FRESHNESS_GUARD_DAYS past the date the file was generated.
{
  const FRESHNESS_GUARD_DAYS = 7;
  const regionalFeeds = JSON.parse(readFileSync(new URL('./regional-feeds.json', import.meta.url), 'utf8'));
  const freshness = JSON.parse(readFileSync(new URL('./feed-freshness.json', import.meta.url), 'utf8'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(freshness.checkedAt ?? '')) {
    throw new Error('scripts/feed-freshness.json has no valid checkedAt date; rerun scripts/check-feed-freshness.py.');
  }
  const cutoff = new Date(`${freshness.checkedAt}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + FRESHNESS_GUARD_DAYS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const freshnessProblems = [];
  for (const feed of regionalFeeds) {
    const record = freshness.feeds?.[feed.id];
    if (!record) {
      freshnessProblems.push(`${feed.id}: missing from feed-freshness.json (rerun scripts/check-feed-freshness.py)`);
      continue;
    }
    if (feed.freshness_exempt) continue;
    if (!record.serviceEnd) {
      freshnessProblems.push(`${feed.id}: service end date unknown${record.lastError ? ` (${record.lastError})` : ''}`);
    } else if (record.serviceEnd < cutoffDate) {
      freshnessProblems.push(
        `${feed.id} (${feed.agency}): published service ends ${record.serviceEnd}, `
        + `before ${cutoffDate} (${FRESHNESS_GUARD_DAYS} days after the ${freshness.checkedAt} check); `
        + 'find a newer GTFS URL or add "freshness_exempt" with a reason in regional-feeds.json',
      );
    }
  }
  if (freshnessProblems.length) {
    throw new Error(`Scheduled feed freshness check failed:\n${freshnessProblems.join('\n')}`);
  }
  console.log(
    `Feed freshness check passed: ${regionalFeeds.length} feeds checked ${freshness.checkedAt}, `
    + `${regionalFeeds.filter((feed) => feed.freshness_exempt).length} exempt, all others run past ${cutoffDate}.`,
  );
}

// Region registry (offline): every region in scripts/regions-config.json must
// be built into data/regions.geojson with its configured member count, and
// every named region must have at least one scheduled route tagged for it, so
// a region can never silently come up empty.
{
  const regionConfig = JSON.parse(readFileSync(new URL('./regions-config.json', import.meta.url), 'utf8'));
  const MAX_REGIONS_BYTES = regionConfig.maxBytes;
  const regionsRaw = readFileSync(new URL('../public/data/regions.geojson', import.meta.url));
  const regionCollection = JSON.parse(regionsRaw);
  const builtRegions = new Map(
    (regionCollection.features ?? []).map((feature) => [feature.properties?.key, feature]),
  );
  const virtualRegions = new Map(
    (regionCollection.metadata?.virtualRegions ?? []).map((region) => [region.key, region]),
  );
  const regionProblems = [];
  if (regionsRaw.length > MAX_REGIONS_BYTES) {
    regionProblems.push(`data/regions.geojson is ${regionsRaw.length} bytes (limit ${MAX_REGIONS_BYTES})`);
  }
  const order = regionCollection.metadata?.order ?? [];
  const configOrder = regionConfig.regions.map((region) => region.key);
  if (order.join(',') !== configOrder.join(',')) {
    regionProblems.push('data/regions.geojson region order differs from regions-config.json; rerun scripts/build-regions.py');
  }
  const scheduledRoutesByRegion = new Map();
  for (const feature of collection.features) {
    const properties = feature.properties ?? {};
    if (properties.kind !== 'regional-static') continue;
    for (const region of properties.regions ?? []) {
      if (!scheduledRoutesByRegion.has(region)) scheduledRoutesByRegion.set(region, new Set());
      scheduledRoutesByRegion.get(region).add(properties.route);
    }
  }
  for (const region of regionConfig.regions) {
    if (region.kind === 'union') {
      if (!virtualRegions.has(region.key)) regionProblems.push(`${region.key}: missing from regions.geojson metadata`);
      continue;
    }
    const feature = builtRegions.get(region.key);
    if (!feature) {
      regionProblems.push(`${region.key}: missing from data/regions.geojson`);
      continue;
    }
    const properties = feature.properties;
    for (const flag of ['name', 'group', 'parent', 'hasSubway', 'busDefaultOn']) {
      if (properties[flag] !== region[flag]) regionProblems.push(`${region.key}: ${flag} differs from regions-config.json`);
    }
    if (region.memberCount !== undefined
        && (properties.memberCount !== region.memberCount || properties.members?.length !== region.memberCount)) {
      regionProblems.push(`${region.key}: ${properties.memberCount} members built, config says ${region.memberCount}`);
    }
    if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
      regionProblems.push(`${region.key}: boundary is not a polygon`);
    }
    if (!scheduledRoutesByRegion.get(region.key)?.size) {
      regionProblems.push(`${region.key}: no scheduled route is tagged for this region; rebuild data/regional-routes.geojson`);
    }
  }
  const greaterBoston = regionConfig.regions.find((region) => region.key === 'greater-boston');
  if (!greaterBoston || greaterBoston.members.length !== 128
      || builtRegions.get('greater-boston')?.properties.members.length !== 128) {
    regionProblems.push('greater-boston must hold the 128 cities and towns inside the I-495 ring');
  }
  for (const key of builtRegions.keys()) {
    if (!configOrder.includes(key)) regionProblems.push(`${key}: in regions.geojson but not in regions-config.json`);
  }
  if (regionProblems.length) throw new Error(`Region registry check failed:\n${regionProblems.join('\n')}`);
  const emptiest = [...builtRegions.keys()]
    .map((key) => [key, scheduledRoutesByRegion.get(key)?.size ?? 0])
    .sort((a, b) => a[1] - b[1])[0];
  console.log(
    `Region registry check passed: ${builtRegions.size} regions + ${virtualRegions.size} virtual, `
    + `${regionsRaw.length} bytes; fewest scheduled routes: ${emptiest[0]} (${emptiest[1]}).`,
  );
}

console.log(
  `Route geometry check passed: ${approximate.length} approximate-geometry scheduled features; `
  + `${Object.keys(cache.segments ?? {}).length} loop-free cache segments; `
  + `${amtrakRoutes.length} official Amtrak routes; `
  + `${supplementalFerries.features.length} verified supplemental ferry routes; `
  + `${generatedFerries.length} OSM shoreline-audited ferry routes; `
  + `${scheduledStops.length} scheduled stops with named ferry endpoints; `
  + `${airports.features.length} FAA landing facilities; `
  + `${borderCrossings.features.length} Canada border crossings; `
  + `${Object.values(referencePlaceCounts).reduce((sum, count) => sum + count, 0)} reference places; `
  + `${supplementalAir.features.length} scheduled/on-demand air corridors; `
  + `no bus or rail chord exceeds ${MAX_BUS_CHORD_KM} km.`,
);
