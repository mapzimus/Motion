// MassDOT Highway Division roadway events (the ERS feed behind mass511.com).
// Pure parsing only: index.ts owns the fetch, caching and provider health.
import { insideNewEngland } from './regions';

// Plain http on purpose: the https endpoint on this host times out (no working
// TLS listener), while http answers in well under a second. Workers can fetch
// http origins, and the payload is public road-condition data with no secrets.
export const MASSDOT_EVENTS_URL = 'http://events.massdot.evbg.net/';

export type MassDotEventFeature = {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    group: 'incident';
    dataStatus: 'live';
    color: string;
    title: string;
    status: string;
    details: string;
    provider: string;
    sourceUrl: string;
    updatedAt: string;
  };
};

const XML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, key: string) => {
      if (key[0] === '#') {
        const code = key[1] === 'x' || key[1] === 'X'
          ? parseInt(key.slice(2), 16)
          : parseInt(key.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      return XML_ENTITIES[key.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1]) : '';
}

// "-0400", "-04:00", "+0000" or "Z" at the end of <UpdateDate>. Event
// timestamps carry no zone, so this is the only offset the feed gives us.
function feedOffset(updateDate: string): string | null {
  if (/Z$/i.test(updateDate)) return 'Z';
  const match = updateDate.match(/([+-])(\d{2}):?(\d{2})$/);
  return match ? `${match[1]}${match[2]}:${match[3]}` : null;
}

function isoTimestamp(local: string, offset: string | null, now: Date): string {
  if (offset && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(local)) {
    const parsed = Date.parse(`${local}${offset}`);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return now.toISOString();
}

// "Travel Lane(s) Affected: 1 of 2 Lane(s) Affected Description: Left 1 lane closed"
// → "1 of 2 lanes affected: Left 1 lane closed". Unknown wording passes through.
function laneSummary(raw: string): string {
  if (!raw) return '';
  const match = raw.match(/(\d+)\s+of\s+(\d+)\s+Lane\(s\)\s+Affected(?:\s+Description:\s*(.*))?$/i);
  if (!match) return raw;
  const summary = `${match[1]} of ${match[2]} lanes affected`;
  const description = (match[3] ?? '').trim();
  return description ? `${summary}: ${description}` : summary;
}

export function parseErsEvents(xml: string, now: Date = new Date()): MassDotEventFeature[] {
  if (typeof xml !== 'string' || !xml.includes('<Event>')) return [];
  const offset = feedOffset(tag(xml, 'UpdateDate'));
  const features: MassDotEventFeature[] = [];
  for (const match of xml.matchAll(/<Event>([\s\S]*?)<\/Event>/g)) {
    const event = match[1];
    const id = tag(event, 'EventId');
    if (!/^[\w-]+$/.test(id)) continue;
    if (tag(event, 'EventStatus').toLowerCase() !== 'open') continue;
    if (tag(event, 'LocationType').toLowerCase() !== 'point') continue;
    // Planned closures duplicate what the WZDx roadwork layer already shows.
    if (tag(event, 'EventCategory').toLowerCase() === 'planned event') continue;

    const latText = tag(event, 'PrimaryLatitude');
    const lngText = tag(event, 'PrimaryLongitude');
    if (!latText || !lngText) continue;
    const lat = Number(latText);
    const lng = Number(lngText);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !insideNewEngland(lng, lat)) continue;

    const road = [tag(event, 'RoadwayName'), tag(event, 'Direction')].filter(Boolean).join(' ');
    const kind = tag(event, 'EventSubType') || tag(event, 'EventType');
    features.push({
      type: 'Feature',
      id: `ma-${id}`,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        group: 'incident',
        dataStatus: 'live',
        color: '#ff5c5c',
        title: tag(event, 'LocationDescription') || road || 'MassDOT roadway event',
        status: [kind, road].filter(Boolean).join(' · '),
        details: [laneSummary(tag(event, 'LaneBlockageDescription')), tag(event, 'RecurrenceDescription')]
          .filter(Boolean)
          .join(' · '),
        provider: 'MassDOT Highway Division roadway events',
        sourceUrl: 'https://www.mass511.com/',
        updatedAt: isoTimestamp(tag(event, 'LastUpdate') || tag(event, 'EventCreatedDate'), offset, now),
      },
    });
  }
  return features;
}
