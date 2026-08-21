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
const supplementalRoutes = JSON.parse(
  readFileSync(new URL('./supplemental-routes.json', import.meta.url), 'utf8'),
);
const supplementalFerries = JSON.parse(
  readFileSync(new URL('./supplemental-ferry-routes.json', import.meta.url), 'utf8'),
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

// These inland-water paths were checked against current OpenStreetMap water
// polygons, including island holes. Lock their coordinate fingerprints so a
// later cleanup cannot quietly restore straight chords across land.
const reviewedWaterGeometry = new Map(Object.entries({
  'lake-champlain-ferries:grand-isle-plattsburgh': '80795dc54cffe3dc5351741b33f827c1b38cf8af0e82ef867631858b5419fa0d',
  'lake-champlain-ferries:charlotte-essex': '0925aca5390ffb8237a67911cc40ce2145f9e2500728109d16e332522ecaa02f',
  'mount-washington:weirs-wolfeboro': '9dce4733b14114098565b8753363153ec069bbcee911c1fdcd410f8f1538c61e',
  'winnipesaukee-spirit:center-harbor-wolfeboro': 'cb08e5731fe12a334295a2ab25327f1d00ec7594ebc9859ee13a83809228c50d',
  'winnipesaukee-belle:meredith-weirs': 'b4d0d6523276db2ddd9df8953a20d1354187bc20ce68645e60b62f07fe94e22d',
  'mount-washington:weirs-alton-bay': '5f35853e1e0b6757a653a96978088f026d205e06ec6e929c78103ad53b384c0b',
  'sophie-c:mailboat': 'd0c1eebf26b13afbbd07f2b7eb799cad93e897a2eebf49fecba8338845e28eb5',
  'fort-ti-ferry:shoreham-ticonderoga': '25a49cc7997a03b3bebb71ae6063085012fd71416bba3839936f8b5d2631587e',
  'frye-island-ferry:raymond-cape-frye': 'e46f9caa14c06f5dffc2fdfde4f2b60546bbc03475f0395311bb7c52b0dc5a53',
  'mount-kineo-shuttle:rockwood-kineo': '148b91dcd97af191fa470c03e957d8873a804da38d44ed5b48427d4d4fef97b9',
}));
const allSupplementalFeatures = [
  ...supplementalRoutes.features,
  ...supplementalFerries.features,
];
const invalidWaterGeometry = [];
for (const [route, expectedHash] of reviewedWaterGeometry) {
  const sourceFeature = allSupplementalFeatures.find(
    (feature) => feature.properties?.route === route,
  );
  const generatedFeature = collection.features.find(
    (feature) => feature.properties?.route === route,
  );
  const actualHash = sourceFeature
    ? createHash('sha256').update(JSON.stringify(sourceFeature.geometry.coordinates)).digest('hex')
    : '';
  if (actualHash !== expectedHash
      || sourceFeature?.properties?.waterGeometryReviewed !== '2026-08-20'
      || !sourceFeature?.properties?.waterGeometrySource
      || JSON.stringify(generatedFeature?.geometry?.coordinates)
        !== JSON.stringify(sourceFeature?.geometry?.coordinates)) {
    invalidWaterGeometry.push(route);
  }
}
if (invalidWaterGeometry.length) {
  throw new Error(
    `Reviewed water-following geometry changed without a new shoreline audit: ${invalidWaterGeometry.join(', ')}`,
  );
}
console.log(
  `Route geometry check passed: ${approximate.length} approximate-geometry scheduled features; `
  + `${Object.keys(cache.segments ?? {}).length} loop-free cache segments; `
  + `${amtrakRoutes.length} official Amtrak routes; `
  + `${supplementalFerries.features.length} verified supplemental ferry routes; `
  + `${reviewedWaterGeometry.size} shoreline-reviewed inland-water routes; `
  + `no bus or Amtrak chord exceeds ${MAX_BUS_CHORD_KM} km.`,
);
