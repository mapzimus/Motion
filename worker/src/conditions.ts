// Pure parsing/filtering helpers for the "Conditions" providers: FAA airport
// status (XML, no DOM available in Workers) and NWS active weather alerts.
// Kept free of fetch() so they can be unit-tested with inline fixtures.

import type { RegionId } from './regions';

// ---- FAA airport status ----------------------------------------------------

export type AirportStatusType =
  | 'ground-stop'
  | 'ground-delay'
  | 'arrival-delay'
  | 'departure-delay'
  | 'closure';

export type AirportStatus = {
  iata: string;
  name?: string;
  type: AirportStatusType;
  reason: string;
  avgDelay?: string;
  maxDelay?: string;
  trend?: string;
  endTime?: string;
};

// FAA LIDs for New England airports that appear in the NAS status feed. The
// LID equals the IATA code for every airport here, and matches `faaId` in
// data/airports.geojson.
export const NEW_ENGLAND_AIRPORTS: Record<string, string> = {
  BOS: 'Boston Logan Intl',
  BDL: 'Bradley Intl',
  PVD: 'Rhode Island T.F. Green Intl',
  MHT: 'Manchester-Boston Regional',
  PWM: 'Portland Intl Jetport',
  BTV: 'Burlington Intl',
  HYA: 'Cape Cod Gateway',
  ACK: 'Nantucket Memorial',
  MVY: "Martha's Vineyard",
  BGR: 'Bangor Intl',
  ORH: 'Worcester Regional',
  HVN: 'Tweed New Haven',
  GON: 'Groton-New London',
  BED: 'Hanscom Field',
  OWD: 'Norwood Memorial',
  BVY: 'Beverly Regional',
  EWB: 'New Bedford Regional',
  PVC: 'Provincetown Municipal',
  PSM: 'Portsmouth Intl at Pease',
  LEB: 'Lebanon Municipal',
  RUT: 'Rutland Southern Vermont Regional',
  AUG: 'Augusta State',
  RKD: 'Knox County Regional',
  BHB: 'Hancock County-Bar Harbor',
  PQI: 'Presque Isle Intl',
  BID: 'Block Island State',
  WST: 'Westerly State',
};

const XML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, key: string) => {
      if (key.startsWith('#x')) return String.fromCharCode(parseInt(key.slice(2), 16));
      if (key.startsWith('#')) return String.fromCharCode(Number(key.slice(1)));
      return XML_ENTITIES[key.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// Every `<tag …>inner</tag>` block, in document order.
function xmlBlocks(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  const blocks: string[] = [];
  for (const match of xml.matchAll(pattern)) blocks.push(match[1]);
  return blocks;
}

// Every `<tag …>inner</tag>` block together with its attribute string.
function xmlBlocksWithAttributes(xml: string, tag: string): Array<{ attributes: string; inner: string }> {
  const pattern = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  const blocks: Array<{ attributes: string; inner: string }> = [];
  for (const match of xml.matchAll(pattern)) blocks.push({ attributes: match[1] ?? '', inner: match[2] });
  return blocks;
}

function xmlText(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1]) : '';
}

function xmlAttribute(attributes: string, name: string): string {
  const match = attributes.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function faaUpdateTime(xml: string): string {
  const raw = xmlText(xml, 'Update_Time');
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

export function parseFaaAirportStatus(
  xml: string,
  allowlist: Record<string, string> = NEW_ENGLAND_AIRPORTS,
): { updatedAt: string; airports: AirportStatus[] } {
  const airports: AirportStatus[] = [];
  const keep = (iata: string) => Boolean(iata) && Object.hasOwn(allowlist, iata);
  const base = (iata: string) => ({ iata, name: allowlist[iata] });

  for (const list of xmlBlocks(xml, 'Ground_Stop_List')) {
    for (const program of xmlBlocks(list, 'Program')) {
      const iata = xmlText(program, 'ARPT').toUpperCase();
      if (!keep(iata)) continue;
      airports.push({
        ...base(iata),
        type: 'ground-stop',
        reason: xmlText(program, 'Reason'),
        endTime: xmlText(program, 'End_Time') || undefined,
      });
    }
  }

  for (const list of xmlBlocks(xml, 'Ground_Delay_List')) {
    for (const delay of xmlBlocks(list, 'Ground_Delay')) {
      const iata = xmlText(delay, 'ARPT').toUpperCase();
      if (!keep(iata)) continue;
      airports.push({
        ...base(iata),
        type: 'ground-delay',
        reason: xmlText(delay, 'Reason'),
        avgDelay: xmlText(delay, 'Avg') || undefined,
        maxDelay: xmlText(delay, 'Max') || undefined,
      });
    }
  }

  for (const list of xmlBlocks(xml, 'Arrival_Departure_Delay_List')) {
    for (const delay of xmlBlocks(list, 'Delay')) {
      const iata = xmlText(delay, 'ARPT').toUpperCase();
      if (!keep(iata)) continue;
      const reason = xmlText(delay, 'Reason');
      for (const { attributes, inner } of xmlBlocksWithAttributes(delay, 'Arrival_Departure')) {
        const kind = xmlAttribute(attributes, 'Type').toLowerCase();
        const min = xmlText(inner, 'Min');
        const max = xmlText(inner, 'Max');
        airports.push({
          ...base(iata),
          type: kind.startsWith('arr') ? 'arrival-delay' : 'departure-delay',
          reason,
          avgDelay: [min, max].filter(Boolean).join(' – ') || undefined,
          maxDelay: max || undefined,
          trend: xmlText(inner, 'Trend') || undefined,
        });
      }
    }
  }

  for (const list of xmlBlocks(xml, 'Airport_Closure_List')) {
    for (const airport of xmlBlocks(list, 'Airport')) {
      const iata = xmlText(airport, 'ARPT').toUpperCase();
      if (!keep(iata)) continue;
      airports.push({
        ...base(iata),
        type: 'closure',
        reason: xmlText(airport, 'Reason'),
        endTime: xmlText(airport, 'Reopen') || undefined,
      });
    }
  }

  return { updatedAt: faaUpdateTime(xml), airports };
}

// ---- NWS active alerts -----------------------------------------------------

export const REGION_STATES: Record<RegionId, string[]> = {
  boston: ['MA'],
  ma: ['MA'],
  ct: ['CT'],
  ri: ['RI'],
  nh: ['NH'],
  vt: ['VT'],
  me: ['ME'],
  'new-england': ['MA', 'CT', 'RI', 'NH', 'VT', 'ME'],
};

export type NwsGeometry = {
  type: string;
  coordinates: unknown;
};

export type NwsAlertFeature = {
  id?: string;
  type?: string;
  geometry?: NwsGeometry | null;
  properties?: {
    id?: string;
    event?: string;
    severity?: string;
    urgency?: string;
    certainty?: string;
    headline?: string;
    description?: string;
    instruction?: string;
    onset?: string;
    ends?: string;
    expires?: string;
    sent?: string;
    senderName?: string;
    areaDesc?: string;
    affectedZones?: string[];
    geocode?: { UGC?: string[]; SAME?: string[] };
  };
};

const SEVERITY_RANK: Record<string, number> = { extreme: 0, severe: 1, moderate: 2, minor: 3 };

export function severityRank(severity: string | undefined): number {
  return SEVERITY_RANK[(severity ?? '').toLowerCase()] ?? 4;
}

export function severityColor(severity: string | undefined): string {
  switch ((severity ?? '').toLowerCase()) {
    case 'extreme':
    case 'severe':
      return '#ff5c5c';
    case 'moderate':
      return '#ffb454';
    default:
      return '#9aa3ad';
  }
}

export function zoneIdFromUrl(url: string): string {
  return url.split('/').filter(Boolean).at(-1) ?? '';
}

// States an alert touches, from its UGC codes ("CTZ009" → CT) with the zone
// URLs as a fallback. NWS returns whole alerts, so a warning that spans
// Connecticut and New York is kept for `ct` but not for `nh`.
export function alertStates(feature: NwsAlertFeature): string[] {
  const codes = [
    ...(feature.properties?.geocode?.UGC ?? []),
    ...(feature.properties?.affectedZones ?? []).map(zoneIdFromUrl),
  ];
  return [...new Set(codes.map((code) => code.slice(0, 2).toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code)))];
}

export function hasGeometry(feature: NwsAlertFeature): boolean {
  return Boolean(feature.geometry?.coordinates && feature.geometry.type);
}

// Keeps alerts touching any of `states` that either carry their own polygon
// or list forecast zones whose polygons can be resolved separately.
export function filterNwsAlerts(features: NwsAlertFeature[], states: string[]): NwsAlertFeature[] {
  const wanted = new Set(states.map((state) => state.toUpperCase()));
  return features
    .filter((feature) => alertStates(feature).some((state) => wanted.has(state)))
    .filter((feature) => hasGeometry(feature) || (feature.properties?.affectedZones?.length ?? 0) > 0)
    .sort((a, b) => severityRank(a.properties?.severity) - severityRank(b.properties?.severity));
}

// Zone URLs still needed for alerts without an inline polygon, most severe
// alerts first, so a fetch cap drops advisories before warnings.
export function zonesToResolve(features: NwsAlertFeature[], known: Set<string>, max: number): string[] {
  const urls: string[] = [];
  for (const feature of features) {
    if (hasGeometry(feature)) continue;
    for (const url of feature.properties?.affectedZones ?? []) {
      const id = zoneIdFromUrl(url);
      if (!id || known.has(id) || urls.includes(url)) continue;
      urls.push(url);
      if (urls.length >= max) return urls;
    }
  }
  return urls;
}

function truncate(value: string | undefined, max: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function normalizeNwsAlert(
  feature: NwsAlertFeature,
  geometry: NwsGeometry,
  sourceUrlFallback = 'https://www.weather.gov/',
): Record<string, unknown> {
  const p = feature.properties ?? {};
  const sourceUrl = /^https:\/\//.test(feature.id ?? '') ? feature.id : sourceUrlFallback;
  return {
    type: 'Feature',
    id: p.id ?? feature.id,
    geometry,
    properties: {
      group: 'weather',
      dataStatus: 'live',
      color: severityColor(p.severity),
      id: p.id ?? feature.id ?? '',
      event: p.event ?? 'Weather alert',
      severity: p.severity ?? 'Unknown',
      urgency: p.urgency ?? 'Unknown',
      headline: truncate(p.headline, 300),
      description: truncate(p.description, 600),
      onset: p.onset ?? '',
      ends: p.ends ?? p.expires ?? '',
      senderName: p.senderName ?? 'National Weather Service',
      areaDesc: truncate(p.areaDesc, 200),
      states: alertStates(feature),
      title: p.event ?? 'Weather alert',
      provider: 'NOAA National Weather Service',
      sourceUrl,
      updatedAt: p.sent ?? new Date().toISOString(),
    },
  };
}

// ---- geometry helpers ------------------------------------------------------

type Position = [number, number];

function perpendicularDistance(point: Position, start: Position, end: Position): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (start[0] + clamped * dx), point[1] - (start[1] + clamped * dy));
}

// Iterative Douglas–Peucker; zone polygons are far more detailed than a
// regional map needs and would otherwise dominate the response size.
export function simplifyRing(ring: Position[], tolerance: number): Position[] {
  if (ring.length <= 4 || tolerance <= 0) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let maxDistance = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistance(ring[i], ring[first], ring[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (index >= 0 && maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const simplified = ring.filter((_, i) => keep[i] === 1);
  return simplified.length >= 4 ? simplified : ring;
}

export function simplifyGeometry(geometry: NwsGeometry, tolerance: number): NwsGeometry {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: (geometry.coordinates as Position[][]).map((ring) => simplifyRing(ring, tolerance)),
    };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: (geometry.coordinates as Position[][][]).map((polygon) =>
        polygon.map((ring) => simplifyRing(ring, tolerance)),
      ),
    };
  }
  return geometry;
}

// Merges any mix of Polygon/MultiPolygon geometries into one MultiPolygon
// (no dissolve — overlapping zones simply overlap).
export function combinePolygons(geometries: NwsGeometry[]): NwsGeometry | null {
  const polygons: Position[][][] = [];
  for (const geometry of geometries) {
    if (geometry.type === 'Polygon') polygons.push(geometry.coordinates as Position[][]);
    else if (geometry.type === 'MultiPolygon') polygons.push(...(geometry.coordinates as Position[][][]));
  }
  if (!polygons.length) return null;
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}
