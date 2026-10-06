// Pure parsing helpers for the aviation "Conditions" providers:
// AviationWeather.gov METAR observations and TAF forecasts, and FAA temporary
// flight restrictions (TFR list + GeoServer polygons + per-NOTAM web text).
// Kept free of fetch() so they can be unit-tested with inline fixtures.

import { insideNewEngland } from './regions';

const AWC_SITE = 'https://aviationweather.gov/';
const TFR_SITE = 'https://tfr.faa.gov/';

export const NEW_ENGLAND_STATES = ['MA', 'CT', 'RI', 'NH', 'VT', 'ME'];

// ---- shared ----------------------------------------------------------------

type Position = [number, number];

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function isoFrom(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // AWC JSON uses Unix seconds; GeoJSON uses ISO strings.
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function truncate(value: unknown, max: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// ---- METAR -----------------------------------------------------------------

export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | 'unknown';

const FLIGHT_CATEGORIES = new Set(['VFR', 'MVFR', 'IFR', 'LIFR']);

// ICAO station identifier: a letter then three letters/digits (KBOS, CYUL, K1B1).
export const STATION_ID_PATTERN = /^[A-Z][A-Z0-9]{3}$/;

export function validStationId(value: string | null | undefined): value is string {
  return STATION_ID_PATTERN.test(value ?? '');
}

export type MetarProperties = {
  id?: string;
  icaoId?: string;
  site?: string;
  name?: string;
  obsTime?: string | number;
  temp?: number | null;
  dewp?: number | null;
  wdir?: number | string | null;
  wspd?: number | null;
  wgst?: number | null;
  ceil?: number | null;
  cover?: string | null;
  fltcat?: string | null;
  visib?: number | string | null;
  wx?: string | null;
  altim?: number | null;
  rawOb?: string;
};

export type MetarFeature = {
  type?: string;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: MetarProperties;
};

// FAA flight-category rule (AIM 7-1-7 / AWC): the worse of ceiling and
// visibility decides. Used only when AWC leaves `fltcat` empty but reports both.
export function flightCategoryFrom(ceilingFt: number | null, visibilitySm: number | null): FlightCategory {
  if (visibilitySm === null) return 'unknown';
  const ceiling = ceilingFt ?? Infinity;
  if (ceiling < 500 || visibilitySm < 1) return 'LIFR';
  if (ceiling < 1000 || visibilitySm < 3) return 'IFR';
  if (ceiling <= 3000 || visibilitySm <= 5) return 'MVFR';
  return 'VFR';
}

// "10+" (10 statute miles or more) or a plain number.
export function visibilityMiles(value: unknown): number | null {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\+?$/);
    return match ? Number(match[1]) : null;
  }
  return finiteNumber(value);
}

export function windText(direction: unknown, speedKt: number | null, gustKt: number | null): string {
  if (speedKt === null) return '';
  if (speedKt === 0) return 'Calm';
  const from = typeof direction === 'string' && direction.toUpperCase() === 'VRB'
    ? 'Variable'
    : finiteNumber(direction) !== null
      ? `${String(finiteNumber(direction)).padStart(3, '0')}°`
      : '';
  const gust = gustKt ? `, gusts ${gustKt} kt` : '';
  return `${[from, `${speedKt} kt`].filter(Boolean).join(' ')}${gust}`;
}

function siteParts(site: string): { name: string; state: string; country: string } {
  // "Boston/Logan Intl, MA, US"
  const parts = site.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3 && /^[A-Z]{2}$/.test(parts.at(-1) ?? '')) {
    return { name: parts.slice(0, -2).join(', '), state: parts.at(-2) ?? '', country: parts.at(-1) ?? '' };
  }
  return { name: site, state: '', country: '' };
}

// Normalizes the AWC METAR GeoJSON (bbox query) into one compact point per
// New England station; the box also catches Quebec, New Brunswick and New York
// stations the map never shows. AWC reports `ceil` in hundreds of feet
// (OVC060 → 60).
export function normalizeMetars(
  features: MetarFeature[],
): { updatedAt: string; features: Array<Record<string, unknown>> } {
  const byStation = new Map<string, Record<string, unknown>>();
  let latest = 0;
  for (const feature of features) {
    const p = feature.properties ?? {};
    const station = String(p.id ?? p.icaoId ?? '').toUpperCase();
    const coordinates = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    if (!validStationId(station) || !Array.isArray(coordinates)) continue;
    const lng = finiteNumber(coordinates[0]);
    const lat = finiteNumber(coordinates[1]);
    if (lng === null || lat === null || !insideNewEngland(lng, lat)) continue;
    const { name, state, country } = siteParts(String(p.site ?? p.name ?? ''));
    // An unparseable site is kept; the browser clips points to the region anyway.
    if (state && !NEW_ENGLAND_STATES.includes(state)) continue;

    const observedAt = isoFrom(p.obsTime);
    const observedMs = Date.parse(observedAt);
    const existing = byStation.get(station);
    if (existing && Date.parse(String((existing.properties as Record<string, unknown>).observedAt)) >= observedMs) continue;

    const ceilingHundreds = finiteNumber(p.ceil);
    const ceilingFt = ceilingHundreds === null ? null : Math.round(ceilingHundreds * 100);
    const visibilitySm = visibilityMiles(p.visib);
    const reported = String(p.fltcat ?? '').toUpperCase();
    const flightCategory: FlightCategory = FLIGHT_CATEGORIES.has(reported)
      ? reported as FlightCategory
      // Without a cloud report a missing ceiling is unknown, not unlimited.
      : p.cover ? flightCategoryFrom(ceilingFt, visibilitySm) : 'unknown';
    const windKt = finiteNumber(p.wspd);
    const gustKt = finiteNumber(p.wgst);
    if (Number.isFinite(observedMs)) latest = Math.max(latest, observedMs);

    byStation.set(station, {
      type: 'Feature',
      id: station,
      geometry: { type: 'Point', coordinates: [roundCoordinate(lng), roundCoordinate(lat)] },
      properties: {
        group: 'airport-weather',
        dataStatus: 'live',
        station,
        title: name ? `${station} · ${name}` : station,
        name,
        state,
        country,
        flightCategory,
        observedAt,
        raw: truncate(p.rawOb, 400),
        wind: windText(p.wdir, windKt, gustKt),
        windKt,
        gustKt,
        visibility: typeof p.visib === 'string' && p.visib.endsWith('+')
          ? `${p.visib} mi`
          : visibilitySm === null ? '' : `${visibilitySm} mi`,
        visibilitySm,
        ceilingFt,
        cover: p.cover ?? '',
        weather: p.wx ?? '',
        tempC: finiteNumber(p.temp),
        dewpointC: finiteNumber(p.dewp),
        provider: 'NOAA Aviation Weather Center',
        sourceUrl: `${AWC_SITE}data/metar/?id=${station}`,
      },
    });
  }
  return {
    updatedAt: latest ? new Date(latest).toISOString() : new Date().toISOString(),
    features: [...byStation.values()],
  };
}

// ---- TAF -------------------------------------------------------------------

export type TafRecord = {
  icaoId?: string;
  name?: string;
  issueTime?: string | number;
  validTimeFrom?: string | number;
  validTimeTo?: string | number;
  rawTAF?: string;
  mostRecent?: number;
};

export function normalizeTaf(records: TafRecord[] | null | undefined, station: string): Record<string, unknown> {
  const list = Array.isArray(records) ? records : [];
  const taf = list.find((record) => record.mostRecent === 1) ?? list[0];
  const base = {
    station,
    provider: 'NOAA Aviation Weather Center',
    sourceUrl: `${AWC_SITE}data/taf/?id=${station}`,
  };
  if (!taf?.rawTAF) return { ...base, available: false };
  return {
    ...base,
    available: true,
    name: taf.name ?? '',
    issuedAt: isoFrom(taf.issueTime),
    validFrom: isoFrom(taf.validTimeFrom),
    validTo: isoFrom(taf.validTimeTo),
    raw: truncate(taf.rawTAF, 1500),
  };
}

// ---- TFRs ------------------------------------------------------------------

// FDC NOTAM number as the TFR API writes it: "6/7153".
export const NOTAM_ID_PATTERN = /^\d{1,2}\/\d{1,5}$/;

export function validNotamId(value: string | null | undefined): value is string {
  return NOTAM_ID_PATTERN.test(value ?? '');
}

// "6/7153-1-FDC-F" (NOTAM_KEY) or "V_TFR_LOC.6/7153" (WFS feature id) → "6/7153".
export function notamIdFrom(value: unknown): string {
  const match = String(value ?? '').match(/(\d{1,2}\/\d{1,5})/);
  return match ? match[1] : '';
}

export function tfrDetailUrl(notamId: string): string {
  return `${TFR_SITE}tfr3/?page=detail_${notamId.replace('/', '_')}`;
}

export type TfrListEntry = {
  notam_id?: string;
  type?: string;
  facility?: string;
  state?: string;
  description?: string;
  creation_date?: string;
};

export type TfrWfsFeature = {
  id?: string;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: {
    GID?: number;
    NOTAM_KEY?: string;
    TITLE?: string;
    STATE?: string;
    LEGAL?: string;
    CNS_LOCATION_ID?: string;
    LAST_MODIFICATION_DATETIME?: string;
  };
};

// "202610051111" (UTC, yyyymmddhhmm) → ISO.
function compactUtc(value: unknown): string {
  const match = String(value ?? '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return '';
  const [, y, mo, d, h, mi] = match.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return Number.isFinite(date.valueOf()) ? date.toISOString() : '';
}

// "10/05/2026" → "2026-10-05".
function usDate(value: unknown): string {
  const match = String(value ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : '';
}

function validRing(ring: unknown): ring is Position[] {
  return Array.isArray(ring) && ring.length >= 4 && ring.every((point) =>
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function roundedPolygon(geometry: TfrWfsFeature['geometry']): { type: string; coordinates: unknown } | null {
  const roundRing = (ring: Position[]) => ring.map(([x, y]) => [roundCoordinate(x), roundCoordinate(y)]);
  if (geometry?.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    const rings = (geometry.coordinates as unknown[]).filter(validRing).map(roundRing);
    return rings.length ? { type: 'Polygon', coordinates: rings } : null;
  }
  if (geometry?.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    const polygons = (geometry.coordinates as unknown[][])
      .map((polygon) => (Array.isArray(polygon) ? polygon.filter(validRing).map(roundRing) : []))
      .filter((polygon) => polygon.length);
    return polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null;
  }
  return null;
}

// Joins the GeoServer TFR polygons (V_TFR_LOC, New England bbox) to the TFR
// list by NOTAM number. The list adds the type/facility/creation date; when it
// is unavailable the polygon's own LEGAL/TITLE fields stand in. List entries
// for New England states that have no polygon are returned as `unmapped`.
export function normalizeTfrs(
  wfsFeatures: TfrWfsFeature[],
  list: TfrListEntry[] | null,
): { features: Array<Record<string, unknown>>; unmapped: Array<Record<string, string>> } {
  const byId = new Map<string, TfrListEntry>();
  for (const entry of list ?? []) {
    const id = notamIdFrom(entry.notam_id);
    if (id) byId.set(id, entry);
  }
  const mapped = new Set<string>();
  const counts = new Map<string, number>();
  const features: Array<Record<string, unknown>> = [];
  for (const feature of wfsFeatures) {
    const p = feature.properties ?? {};
    const notamId = notamIdFrom(p.NOTAM_KEY) || notamIdFrom(feature.id);
    const geometry = roundedPolygon(feature.geometry);
    if (!validNotamId(notamId) || !geometry) continue;
    const entry = byId.get(notamId);
    const part = (counts.get(notamId) ?? 0) + 1;
    counts.set(notamId, part);
    mapped.add(notamId);
    features.push({
      type: 'Feature',
      id: `${notamId}#${part}`,
      geometry,
      properties: {
        group: 'tfr',
        dataStatus: 'live',
        notamId,
        tfrType: (entry?.type || p.LEGAL || 'TFR').toUpperCase(),
        title: truncate(entry?.description || p.TITLE || `TFR ${notamId}`, 240),
        state: entry?.state || p.STATE || '',
        facility: entry?.facility || p.CNS_LOCATION_ID || '',
        createdOn: usDate(entry?.creation_date),
        updatedAt: compactUtc(p.LAST_MODIFICATION_DATETIME) || new Date().toISOString(),
        provider: 'FAA Temporary Flight Restrictions',
        sourceUrl: tfrDetailUrl(notamId),
      },
    });
  }
  const unmapped = (list ?? [])
    .filter((entry) => NEW_ENGLAND_STATES.includes(entry.state ?? '') && !mapped.has(notamIdFrom(entry.notam_id)))
    .map((entry) => ({
      notamId: notamIdFrom(entry.notam_id),
      tfrType: (entry.type ?? '').toUpperCase(),
      state: entry.state ?? '',
      title: truncate(entry.description, 240),
      sourceUrl: tfrDetailUrl(notamIdFrom(entry.notam_id)),
    }));
  return { features, unmapped };
}

// ---- TFR detail (getWebText) -------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '°', ordm: 'º',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, key: string) => {
    if (key.startsWith('#x') || key.startsWith('#X')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)));
    return HTML_ENTITIES[key.toLowerCase()] ?? match;
  });
}

// The FAA web text is a layout table; one text line per table cell is enough
// to read its "Label :" / value pairs in order.
export function tfrTextLines(html: string): string[] {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(td|tr|p|div|table)>/gi, '\n')
      .replace(/<[^>]*>/g, ' '),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const SECTION_BREAK = /^(Area [A-Z0-9]+|ENDSECTION\d*|Airspace Definition:|Altitude:|Effective Date\(s\):|Operating Restrictions and Requirements|Other Information:|Top)$/;

function valueAfter(lines: string[], label: string): string {
  const pattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)$`, 'i');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    if (!match) continue;
    return (match[1] || lines[index + 1] || '').trim();
  }
  return '';
}

export function parseTfrDetail(payload: unknown, notamId: string): Record<string, unknown> {
  const record = Array.isArray(payload) ? payload[0] as { notam_id?: string; text?: string } | undefined : undefined;
  const lines = tfrTextLines(String(record?.text ?? ''));
  const altitudes: string[] = [];
  const effective: string[] = [];
  let restrictions = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const altitude = line.match(/^Altitude:\s*(.*)$/i);
    if (altitude) {
      const value = (altitude[1] || lines[index + 1] || '').trim();
      if (value && !altitudes.includes(value)) altitudes.push(value);
      continue;
    }
    if (/^Effective Date\(s\):$/i.test(line)) {
      for (let next = index + 1; next < lines.length && !SECTION_BREAK.test(lines[next]); next += 1) {
        const value = lines[next];
        if (/^In UTC:$/i.test(value)) continue;
        if (!effective.includes(value)) effective.push(value);
      }
      continue;
    }
    // The section heading (followed by a "Top" link), not the "Jump To" link.
    if (!restrictions && /^Operating Restrictions and Requirements$/i.test(line) && lines[index + 1] === 'Top') {
      const next = lines[index + 2] ?? '';
      if (!/^Other Information:?$/i.test(next)) restrictions = next;
    }
  }
  // Older special notices carry only the raw NOTAM text.
  const plainIndex = lines.findIndex((line) => /Plain Language text is not available/i.test(line));
  const rawNotam = plainIndex >= 0 ? lines.slice(plainIndex).find((line) => /\bFDC \d/.test(line)) ?? '' : '';
  const notamText = truncate(rawNotam.slice(Math.max(0, rawNotam.search(/\bFDC \d/))), 600);
  return {
    notamId: notamIdFrom(record?.notam_id) || notamId,
    available: lines.length > 0,
    issued: valueAfter(lines, 'Issue Date'),
    location: valueAfter(lines, 'Location'),
    begins: valueAfter(lines, 'Beginning Date and Time'),
    ends: valueAfter(lines, 'Ending Date and Time'),
    reason: truncate(valueAfter(lines, 'Reason for NOTAM'), 300),
    type: valueAfter(lines, 'Type'),
    altitudes: altitudes.slice(0, 6),
    effective: effective.slice(0, 8),
    restrictions: truncate(restrictions, 300),
    notamText,
    provider: 'FAA Temporary Flight Restrictions',
    sourceUrl: tfrDetailUrl(notamId),
  };
}
