import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MAX_BUS_CHORD_KM = 20.05;
const MAX_AMTRAK_CHORD_KM = 20.05;
const MAX_ROAD_DETOUR_RATIO = 1.6;
const MAX_ROAD_DETOUR_ALLOWANCE_KM = 5;
const ROAD_ROUTING_VERSION = 'osrm-driving-bus-controls-v4';
const RESTRICTED_BUS_ROAD_PATTERN = /\b(?:Merritt|Wilbur Cross|Hutchinson River|Saw Mill River|Henry Hudson|Mosholu|Palisades Interstate|Taconic State|Bronx River|Belt|Cross Island|Jackie Robinson|Grand Central|Cross County|Sprain Brook|Bear Mountain|Lake Welch|Pelham|Ocean|Korean War Veterans) (?:Parkway|Pkwy)\b|\b(?:FDR|Franklin D\.? Roosevelt|Harlem River) (?:Drive|Dr)\b/i;
const cacheRaw = readFileSync(new URL('./road-route-cache.json', import.meta.url));
const controlsRaw = readFileSync(new URL('./road-route-controls.json', import.meta.url));
const cache = JSON.parse(cacheRaw);
const collection = JSON.parse(readFileSync(new URL('../data/regional-routes.geojson', import.meta.url), 'utf8'));
const airports = JSON.parse(readFileSync(new URL('../data/airports.geojson', import.meta.url), 'utf8'));
const borderCrossings = JSON.parse(
  readFileSync(new URL('../data/border-crossings.geojson', import.meta.url), 'utf8'),
);
const localServices = JSON.parse(
  readFileSync(new URL('../data/local-services.geojson', import.meta.url), 'utf8'),
);
const supplementalFerries = JSON.parse(
  readFileSync(new URL('./supplemental-ferry-routes.json', import.meta.url), 'utf8'),
);
const supplementalAir = JSON.parse(
  readFileSync(new URL('./supplemental-air-routes.json', import.meta.url), 'utf8'),
);
const ferryWaterAudit = JSON.parse(
  readFileSync(new URL('./ferry-water-audit.json', import.meta.url), 'utf8'),
);

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
if (supplementalFerries.features.length < 50 || duplicateSupplementalFerryIds.length) {
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

// Every generated ferry path is locked after the external shoreline/water
// audit. Provider or hand-authored geometry cannot change silently and put a
// line back across land.
const reviewedWaterGeometry = new Map(Object.entries(ferryWaterAudit.geometrySha256 ?? {}));
const invalidWaterGeometry = [];
const generatedFerries = collection.features.filter(
  (feature) => feature.properties?.group === 'ferry',
);
for (const feature of generatedFerries) {
  const route = feature.properties?.route;
  const actualHash = createHash('sha256')
    .update(canonicalCoordinates(feature.geometry.coordinates))
    .digest('hex');
  if (reviewedWaterGeometry.get(route) !== actualHash) invalidWaterGeometry.push(route);
}
if (ferryWaterAudit.auditVersion !== 'gshhg-census-water-v1'
    || ferryWaterAudit.routeCount !== generatedFerries.length
    || reviewedWaterGeometry.size !== generatedFerries.length
    || invalidWaterGeometry.length) {
  throw new Error(
    `Ferry geometry changed without a complete shoreline/water audit: ${invalidWaterGeometry.join(', ')}`,
  );
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
if (supplementalAir.features.length !== 11
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
console.log(
  `Route geometry check passed: ${approximate.length} approximate-geometry scheduled features; `
  + `${Object.keys(cache.segments ?? {}).length} loop-free cache segments; `
  + `${amtrakRoutes.length} official Amtrak routes; `
  + `${supplementalFerries.features.length} verified supplemental ferry routes; `
  + `${reviewedWaterGeometry.size} shoreline/water-reviewed ferry routes; `
  + `${airports.features.length} FAA landing facilities; `
  + `${borderCrossings.features.length} Canada border crossings; `
  + `${supplementalAir.features.length} scheduled/on-demand air corridors; `
  + `no bus or Amtrak chord exceeds ${MAX_BUS_CHORD_KM} km.`,
);
