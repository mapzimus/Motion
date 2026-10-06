// Pure helpers for road-weather stations, highway message signs, and Vermont
// plow trucks. index.ts owns the fetch, the cache, and provider health.

export const ROAD_DETAIL_CATALOGS = ['WeatherStations', 'MessageSigns'] as const;
export const ROAD_DETAIL_PROVIDERS = ['north', 'ct'] as const;

export type RoadCatalog = typeof ROAD_DETAIL_CATALOGS[number];

export interface IbiIcon {
  itemId?: string | number;
  location?: number[];
}

export interface RoadPointFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, string | number | boolean>;
}

export interface IconPointOptions {
  providerKey: string;
  provider: string;
  catalog: RoadCatalog;
  group: string;
  color: string;
  title: string;
  status: string;
  sourceUrl: string;
  updatedAt: string;
}

export interface RoadTooltipDetail {
  title: string;
  status: string;
  details: string;
  updatedAt: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', '#39': "'",
};

export function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&([a-z]+|#\d+);/gi, (match, key: string) => {
      if (key.startsWith('#')) return String.fromCharCode(Number(key.slice(1)));
      return ENTITIES[key.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function validRoadDetail(catalog: string | null, provider: string | null, id: string): boolean {
  return ROAD_DETAIL_CATALOGS.includes(catalog as RoadCatalog)
    && ROAD_DETAIL_PROVIDERS.includes(provider as typeof ROAD_DETAIL_PROVIDERS[number])
    && /^\d+$/.test(id);
}

function inNewEngland(lat: number, lon: number): boolean {
  return lat >= 40 && lat <= 48 && lon >= -75 && lon <= -66;
}

export function iconPointFeatures(icons: IbiIcon[], options: IconPointOptions): RoadPointFeature[] {
  return icons.flatMap((icon) => {
    const id = String(icon.itemId ?? '');
    const location = icon.location;
    if (!/^\d+$/.test(id) || !location || location.length < 2) return [];
    const lat = Number(location[0]);
    const lon = Number(location[1]);
    if (!inNewEngland(lat, lon)) return [];
    return [{
      type: 'Feature' as const,
      id: `${options.providerKey}-${options.catalog}-${id}`,
      geometry: { type: 'Point' as const, coordinates: [lon, lat] as [number, number] },
      properties: {
        group: options.group,
        dataStatus: 'live',
        color: options.color,
        title: options.title,
        status: options.status,
        provider: options.provider,
        providerKey: options.providerKey,
        itemId: id,
        catalog: options.catalog,
        sourceUrl: options.sourceUrl,
        updatedAt: options.updatedAt,
      },
    }];
  });
}

function tooltipRows(html: string): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const pattern = /<td[^>]*class=["'][^"']*tooltipHeaders[^"']*["'][^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  for (const match of html.matchAll(pattern)) {
    const label = decodeHtml(match[1] ?? '');
    const value = decodeHtml(match[2] ?? '');
    if (label && value) rows.push({ label, value });
  }
  return rows;
}

function boldTitle(html: string): string {
  const match = html.match(/<b[^>]*>([\s\S]*?)<\/b>/i);
  return match ? decodeHtml(match[1] ?? '') : '';
}

function messageText(html: string): string {
  const match = html.match(/class=["'][^"']*msgContent[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
  return match ? decodeHtml(match[1] ?? '') : '';
}

function parseUpdated(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

export function roadDetailFromTooltip(html: string, catalog: RoadCatalog): RoadTooltipDetail {
  const title = boldTitle(html);
  const rows = tooltipRows(html);
  const updated = rows.find((row) => row.label === 'Last Updated');
  const readings = rows.filter((row) => row.label !== 'Last Updated' && row.value.toUpperCase() !== 'N/A');
  if (catalog === 'MessageSigns') {
    const posted = messageText(html);
    return {
      title: title || 'Highway message sign',
      status: posted || 'No message posted',
      details: posted || 'The sign is not posting a message.',
      updatedAt: parseUpdated(updated?.value ?? ''),
    };
  }
  const status = readings.map((row) => `${row.label.replace(/ Temperature$/, '')} ${row.value}`).join(' · ');
  return {
    title: title || 'Road weather station',
    status: status || 'No current reading',
    details: readings.map((row) => `${row.label}: ${row.value}`).join(' · ') || 'No current reading',
    updatedAt: parseUpdated(updated?.value ?? ''),
  };
}

function numberAt(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampIso(value: unknown): string {
  const number = numberAt(value);
  if (number === null) {
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }
    return new Date().toISOString();
  }
  const millis = number < 1e12 ? number * 1000 : number;
  return new Date(millis).toISOString();
}

// VTrans plots coords as [lat, lon, timestamp]. The truck sits on the first
// pair; the rest of the array is the breadcrumb trail.
export function parseVtransPlows(payload: unknown): RoadPointFeature[] {
  const trucks = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { features?: unknown }).features)
      ? (payload as { features: unknown[] }).features
      : [];
  const features: RoadPointFeature[] = [];
  for (const truck of trucks) {
    if (!truck || typeof truck !== 'object') continue;
    const record = truck as { id?: unknown; name?: unknown; heading?: unknown; coords?: unknown };
    const coords = Array.isArray(record.coords) ? record.coords : [];
    const first = coords.find((entry) => Array.isArray(entry) && entry.length >= 2);
    if (!Array.isArray(first)) continue;
    const lat = numberAt(first[0]);
    const lon = numberAt(first[1]);
    if (lat === null || lon === null || !inNewEngland(lat, lon)) continue;
    const id = String(record.id ?? record.name ?? features.length + 1);
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : id;
    const heading = numberAt(record.heading);
    features.push({
      type: 'Feature',
      id: `vt-plow-${id}`,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        group: 'plow',
        dataStatus: 'live',
        color: '#d6e8ff',
        title: `Plow ${name}`,
        status: heading === null ? 'Vermont Agency of Transportation plow' : `Heading ${Math.round(heading)}°`,
        provider: 'VTrans live plow trucks',
        sourceUrl: 'https://plowtrucks.vtrans.vermont.gov/',
        updatedAt: timestampIso(first[2]),
      },
    });
  }
  return features;
}
