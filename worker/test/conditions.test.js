import { describe, expect, it } from 'vitest';
import {
  alertStates,
  combinePolygons,
  filterNwsAlerts,
  normalizeNwsAlert,
  parseFaaAirportStatus,
  simplifyRing,
  zonesToResolve,
} from '../src/conditions';

const FAA_XML = `<AIRPORT_STATUS_INFORMATION><Update_Time>Sat Sep 26 23:47:12 2026 GMT</Update_Time>
<Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List>
  <Program><ARPT>EWR</ARPT><Reason>wind</Reason><End_Time>8:45 pm EDT</End_Time></Program>
  <Program><ARPT>PVD</ARPT><Reason>thunderstorms</Reason><End_Time>9:15 pm EDT</End_Time></Program>
</Ground_Stop_List></Delay_type>
<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List>
  <Ground_Delay><ARPT>BOS</ARPT><Reason>WIND</Reason><Avg>1 hour and 2 minutes</Avg><Max>2 hours and 39 minutes</Max></Ground_Delay>
  <Ground_Delay><ARPT>JFK</ARPT><Reason>wind</Reason><Avg>50 minutes</Avg><Max>1 hour and 44 minutes</Max></Ground_Delay>
</Ground_Delay_List></Delay_type>
<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List>
  <Delay><ARPT>BOS</ARPT><Reason>WX:Low Ceilings</Reason><Arrival_Departure Type="Departure"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay>
  <Delay><ARPT>BDL</ARPT><Reason>VOL:Volume &amp; weather</Reason><Arrival_Departure Type="Arrival"><Min>31 minutes</Min><Max>45 minutes</Max><Trend>Decreasing</Trend></Arrival_Departure></Delay>
</Arrival_Departure_Delay_List></Delay_type>
<Delay_type><Name>Airport Closures</Name><Airport_Closure_List>
  <Airport><ARPT>LAX</ARPT><Reason>!LAX 05/277 closed</Reason><Start>May 27 at 18:26 UTC.</Start><Reopen>May 28 at 16:00 UTC.</Reopen></Airport>
  <Airport><ARPT>BOS</ARPT><Reason>!BOS 09/572 BOS AD AP CLSD TO NON SKED TRANSIENT ACFT</Reason><Start>Sep 25 at 19:48 UTC.</Start><Reopen>Sep 29 at 03:59 UTC.</Reopen></Airport>
</Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>`;

describe('FAA airport status parser', () => {
  it('extracts New England airports across every delay type', () => {
    const { updatedAt, airports } = parseFaaAirportStatus(FAA_XML);
    expect(updatedAt).toBe('2026-09-26T23:47:12.000Z');
    expect(airports.map((a) => `${a.iata}:${a.type}`)).toEqual([
      'PVD:ground-stop',
      'BOS:ground-delay',
      'BOS:departure-delay',
      'BDL:arrival-delay',
      'BOS:closure',
    ]);
  });

  it('drops airports outside the allowlist and keeps delay details', () => {
    const { airports } = parseFaaAirportStatus(FAA_XML);
    expect(airports.some((a) => ['EWR', 'JFK', 'LAX'].includes(a.iata))).toBe(false);
    expect(airports.find((a) => a.type === 'ground-stop')).toMatchObject({
      iata: 'PVD',
      name: 'Rhode Island T.F. Green Intl',
      reason: 'thunderstorms',
      endTime: '9:15 pm EDT',
    });
    expect(airports.find((a) => a.type === 'ground-delay')).toMatchObject({
      avgDelay: '1 hour and 2 minutes',
      maxDelay: '2 hours and 39 minutes',
    });
    expect(airports.find((a) => a.type === 'arrival-delay')).toMatchObject({
      reason: 'VOL:Volume & weather',
      avgDelay: '31 minutes – 45 minutes',
      trend: 'Decreasing',
    });
    expect(airports.find((a) => a.type === 'closure')).toMatchObject({
      endTime: 'Sep 29 at 03:59 UTC.',
    });
  });

  it('returns an empty list for a quiet day', () => {
    const { airports } = parseFaaAirportStatus('<AIRPORT_STATUS_INFORMATION><Update_Time>x</Update_Time></AIRPORT_STATUS_INFORMATION>');
    expect(airports).toEqual([]);
  });
});

const polygon = (coords) => ({ type: 'Polygon', coordinates: [coords] });

const NWS_FEATURES = [
  {
    id: 'https://api.weather.gov/alerts/urn:1',
    geometry: null,
    properties: {
      id: 'urn:1', event: 'High Wind Warning', severity: 'Severe', urgency: 'Expected',
      headline: 'High Wind Warning until 6 PM', description: 'Gusts to 60 mph.', sent: '2026-09-26T20:00:00-04:00',
      onset: '2026-09-26T20:00:00-04:00', ends: '2026-09-27T18:00:00-04:00', senderName: 'NWS Boston/Norton MA',
      affectedZones: ['https://api.weather.gov/zones/forecast/MAZ007', 'https://api.weather.gov/zones/forecast/RIZ001'],
      geocode: { UGC: ['MAZ007', 'RIZ001'] },
    },
  },
  {
    id: 'https://api.weather.gov/alerts/urn:2',
    geometry: polygon([[-73, 41], [-72, 41], [-72, 42], [-73, 42], [-73, 41]]),
    properties: {
      id: 'urn:2', event: 'Special Weather Statement', severity: 'Minor', urgency: 'Expected',
      affectedZones: ['https://api.weather.gov/zones/forecast/CTZ005'], geocode: { UGC: ['CTZ005', 'NYZ071'] },
    },
  },
  {
    id: 'https://api.weather.gov/alerts/urn:3',
    geometry: null,
    properties: { id: 'urn:3', event: 'Flood Watch', severity: 'Moderate', geocode: { UGC: ['MAZ010'] } },
  },
  {
    id: 'https://api.weather.gov/alerts/urn:4',
    geometry: null,
    properties: {
      id: 'urn:4', event: 'Tornado Warning', severity: 'Extreme',
      affectedZones: ['https://api.weather.gov/zones/forecast/NYZ071'], geocode: { UGC: ['NYZ071'] },
    },
  },
];

describe('NWS alert filter', () => {
  it('reads states from UGC codes', () => {
    expect(alertStates(NWS_FEATURES[0])).toEqual(['MA', 'RI']);
    expect(alertStates(NWS_FEATURES[1])).toEqual(['CT', 'NY']);
  });

  it('keeps only alerts touching the requested states that can be drawn', () => {
    const ma = filterNwsAlerts(NWS_FEATURES, ['MA']);
    // urn:3 has neither geometry nor zones; urn:4 is New York only.
    expect(ma.map((f) => f.properties.id)).toEqual(['urn:1']);
    const ct = filterNwsAlerts(NWS_FEATURES, ['CT']);
    expect(ct.map((f) => f.properties.id)).toEqual(['urn:2']);
    expect(filterNwsAlerts(NWS_FEATURES, ['VT'])).toEqual([]);
  });

  it('orders the most severe alerts first and caps zone fetches', () => {
    const all = filterNwsAlerts(NWS_FEATURES, ['MA', 'CT', 'RI']);
    expect(all.map((f) => f.properties.severity)).toEqual(['Severe', 'Minor']);
    expect(zonesToResolve(all, new Set(), 10)).toEqual([
      'https://api.weather.gov/zones/forecast/MAZ007',
      'https://api.weather.gov/zones/forecast/RIZ001',
    ]);
    expect(zonesToResolve(all, new Set(['MAZ007']), 10)).toEqual([
      'https://api.weather.gov/zones/forecast/RIZ001',
    ]);
    expect(zonesToResolve(all, new Set(), 1)).toHaveLength(1);
  });

  it('normalizes pass-through properties and truncates long text', () => {
    const feature = {
      ...NWS_FEATURES[0],
      properties: { ...NWS_FEATURES[0].properties, description: 'x'.repeat(2000) },
    };
    const normalized = normalizeNwsAlert(feature, polygon([[0, 0], [1, 0], [1, 1], [0, 0]]));
    expect(normalized.properties).toMatchObject({
      group: 'weather',
      dataStatus: 'live',
      color: '#ff5c5c',
      event: 'High Wind Warning',
      severity: 'Severe',
      urgency: 'Expected',
      headline: 'High Wind Warning until 6 PM',
      onset: '2026-09-26T20:00:00-04:00',
      ends: '2026-09-27T18:00:00-04:00',
      senderName: 'NWS Boston/Norton MA',
      id: 'urn:1',
      sourceUrl: 'https://api.weather.gov/alerts/urn:1',
    });
    expect(normalized.properties.description.length).toBeLessThanOrEqual(600);
    expect(normalized.properties.description.endsWith('…')).toBe(true);
  });
});

describe('geometry helpers', () => {
  it('simplifies collinear detail but keeps ring corners', () => {
    const ring = [[0, 0], [0.5, 0.0001], [1, 0], [1, 1], [0, 1], [0, 0]];
    expect(simplifyRing(ring, 0.001)).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  });

  it('combines zone polygons into one MultiPolygon', () => {
    const a = polygon([[0, 0], [1, 0], [1, 1], [0, 0]]);
    const b = { type: 'MultiPolygon', coordinates: [[[[2, 2], [3, 2], [3, 3], [2, 2]]]] };
    expect(combinePolygons([a])).toEqual(a);
    expect(combinePolygons([a, b])).toEqual({
      type: 'MultiPolygon',
      coordinates: [a.coordinates, b.coordinates[0]],
    });
    expect(combinePolygons([])).toBeNull();
  });
});
