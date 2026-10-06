import { describe, expect, it } from 'vitest';
import {
  flightCategoryFrom,
  normalizeMetars,
  normalizeTaf,
  normalizeTfrs,
  notamIdFrom,
  parseTfrDetail,
  tfrTextLines,
  validNotamId,
  validStationId,
  visibilityMiles,
  windText,
} from '../src/aviation';

// Trimmed from https://aviationweather.gov/api/data/metar?bbox=40.9,-73.8,47.5,-66.9&format=geojson
const metar = (properties, coordinates) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Point', coordinates },
});

const METAR_FEATURES = [
  metar({
    id: 'KBOS', site: 'Boston/Logan Intl, MA, US', obsTime: '2026-10-06T00:54:00.000Z', temp: 14.4, dewp: 3.3,
    wdir: 280, wspd: 10, wgst: null, ceil: null, cover: 'CLR', fltcat: 'VFR', visib: '10+', wx: null,
    rawOb: 'METAR KBOS 060054Z 28010KT 10SM CLR 14/03 A2991 RMK AO2 SLP128 T01440033',
  }, [-71.0098, 42.3606]),
  metar({
    id: 'KMWN', site: 'Mount Washington, NH, US', obsTime: '2026-10-06T00:54:00.000Z', temp: -4, dewp: -4,
    wdir: 300, wspd: 64, wgst: 74, ceil: 0, cover: 'OVX', fltcat: 'LIFR', visib: 0, wx: '-SN FZFG BLSN',
    rawOb: 'METAR KMWN 060054Z 30064G74KT 0SM -SN FZFG BLSN VV000 M04/M04 RMK PK WND 30089/40 VRY LGT ICG',
  }, [-71.3034, 44.2706]),
  // No AWC category, but ceiling and visibility are both reported.
  metar({
    id: 'KBTV', site: 'Burlington Intl, VT, US', obsTime: '2026-10-06T00:54:00.000Z',
    wdir: 'VRB', wspd: 4, ceil: 25, cover: 'BKN', fltcat: null, visib: 6,
    rawOb: 'METAR KBTV 060054Z VRB04KT 6SM BKN025 11/01 A2998',
  }, [-73.1533, 44.4683]),
  // AUTO station with no sky or visibility report.
  metar({
    id: 'KHIE', site: 'Whitefield/Mt Washington Rgnl, NH, US', obsTime: '2026-10-06T00:56:00.000Z',
    wdir: 310, wspd: 6, ceil: null, cover: null, fltcat: null, visib: null,
    rawOb: 'METAR KHIE 060056Z AUTO 31006KT 08/01 A2995 RMK AO2',
  }, [-71.5445, 44.3676]),
  // Inside the query box but outside New England: dropped.
  metar({
    id: 'CWFQ', site: 'Frelighsburg, QC, CA', obsTime: '2026-10-06T01:00:00.000Z', fltcat: null,
    rawOb: 'METAR CWFQ 060100Z AUTO 31006KT 08/01 RMK AO1',
  }, [-72.85, 45.05]),
  metar({ id: 'KPLB', site: 'Plattsburgh Intl, NY, US', obsTime: '2026-10-06T00:56:00.000Z', fltcat: 'VFR' }, [-73.4681, 44.6509]),
  // An older observation for a station already seen is dropped.
  metar({ id: 'KBOS', site: 'Boston/Logan Intl, MA, US', obsTime: '2026-10-05T23:54:00.000Z', fltcat: 'IFR', rawOb: 'old' }, [-71.0098, 42.3606]),
  // Unusable rows: bad id, no geometry, outside New England.
  metar({ id: 'bad id', obsTime: '2026-10-06T00:54:00.000Z' }, [-71, 42]),
  { type: 'Feature', properties: { id: 'KPVD' }, geometry: null },
  metar({ id: 'KORD', obsTime: '2026-10-06T00:54:00.000Z' }, [-87.9, 41.98]),
];

describe('METAR normalizer', () => {
  it('keeps one compact point per New England station', () => {
    const { updatedAt, features } = normalizeMetars(METAR_FEATURES);
    expect(features.map((feature) => feature.id)).toEqual(['KBOS', 'KMWN', 'KBTV', 'KHIE']);
    expect(updatedAt).toBe('2026-10-06T00:56:00.000Z');
    const bos = features[0];
    expect(bos.geometry).toEqual({ type: 'Point', coordinates: [-71.0098, 42.3606] });
    expect(bos.properties).toMatchObject({
      group: 'airport-weather',
      dataStatus: 'live',
      station: 'KBOS',
      title: 'KBOS · Boston/Logan Intl',
      state: 'MA',
      flightCategory: 'VFR',
      observedAt: '2026-10-06T00:54:00.000Z',
      wind: '280° 10 kt',
      visibility: '10+ mi',
      visibilitySm: 10,
      ceilingFt: null,
      cover: 'CLR',
      sourceUrl: 'https://aviationweather.gov/data/metar/?id=KBOS',
    });
    expect(bos.properties.raw).toMatch(/^METAR KBOS 060054Z/);
  });

  it('reads ceilings in hundreds of feet and gusts', () => {
    const [, mwn, btv] = normalizeMetars(METAR_FEATURES).features;
    expect(mwn.properties).toMatchObject({
      flightCategory: 'LIFR', ceilingFt: 0, visibilitySm: 0, wind: '300° 64 kt, gusts 74 kt', weather: '-SN FZFG BLSN',
    });
    // BKN025 → 2,500 ft ceiling → MVFR when AWC leaves the category empty.
    expect(btv.properties).toMatchObject({ flightCategory: 'MVFR', ceilingFt: 2500, wind: 'Variable 4 kt' });
  });

  it('marks stations without sky or visibility as unknown', () => {
    const hie = normalizeMetars(METAR_FEATURES).features.find((feature) => feature.id === 'KHIE');
    expect(hie.properties).toMatchObject({ flightCategory: 'unknown', state: 'NH', visibility: '', ceilingFt: null });
  });

  it('applies the FAA flight-category thresholds', () => {
    expect(flightCategoryFrom(null, 10)).toBe('VFR');
    expect(flightCategoryFrom(3500, 6)).toBe('VFR');
    expect(flightCategoryFrom(3000, 10)).toBe('MVFR');
    expect(flightCategoryFrom(5000, 5)).toBe('MVFR');
    expect(flightCategoryFrom(900, 10)).toBe('IFR');
    expect(flightCategoryFrom(5000, 2)).toBe('IFR');
    expect(flightCategoryFrom(400, 10)).toBe('LIFR');
    expect(flightCategoryFrom(5000, 0.5)).toBe('LIFR');
    expect(flightCategoryFrom(5000, null)).toBe('unknown');
  });

  it('parses visibility and wind text', () => {
    expect(visibilityMiles('10+')).toBe(10);
    expect(visibilityMiles('1.5')).toBe(1.5);
    expect(visibilityMiles(3)).toBe(3);
    expect(visibilityMiles('M1/4')).toBeNull();
    expect(windText(0, 0, null)).toBe('Calm');
    expect(windText(50, 7, null)).toBe('050° 7 kt');
    expect(windText(null, null, null)).toBe('');
  });
});

describe('TAF normalizer and station ids', () => {
  it('accepts only ICAO-style station ids', () => {
    for (const id of ['KBOS', 'K1B1', 'CYUL']) expect(validStationId(id)).toBe(true);
    for (const id of ['kbos', 'BOS', 'KBOSX', 'KB S', '1BOS', '', null, 'KBOS&format=raw']) {
      expect(validStationId(id)).toBe(false);
    }
  });

  it('returns the most recent TAF', () => {
    const taf = normalizeTaf([
      { icaoId: 'KBOS', mostRecent: 0, rawTAF: 'TAF KBOS old' },
      {
        icaoId: 'KBOS', name: 'Boston/Logan Intl', mostRecent: 1, issueTime: '2026-10-05T23:30:00.000Z',
        validTimeFrom: 1791244800, validTimeTo: 1791352800,
        rawTAF: 'TAF KBOS 052330Z 0600/0706 29013G25KT P6SM SKC FM062100 29012KT P6SM SKC',
      },
    ], 'KBOS');
    expect(taf).toMatchObject({
      station: 'KBOS',
      available: true,
      issuedAt: '2026-10-05T23:30:00.000Z',
      validFrom: '2026-10-06T00:00:00.000Z',
      validTo: '2026-10-07T06:00:00.000Z',
      sourceUrl: 'https://aviationweather.gov/data/taf/?id=KBOS',
    });
    expect(taf.raw).toMatch(/^TAF KBOS 052330Z/);
  });

  it('reports stations without a TAF', () => {
    expect(normalizeTaf([], 'KOWD')).toMatchObject({ station: 'KOWD', available: false });
    expect(normalizeTaf(null, 'KOWD')).toMatchObject({ available: false });
  });
});

// Trimmed from the FAA TFR GeoServer (V_TFR_LOC) and /tfrapi/exportTfrList.
const ring = [[-71.676, 41.833], [-71.586, 41.766], [-71.497, 41.833], [-71.586, 41.899], [-71.676, 41.833]];
const TFR_SHAPES = [
  {
    type: 'Feature',
    id: 'V_TFR_LOC.6/7153',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      GID: 234413, CNS_LOCATION_ID: 'ZBW', NOTAM_KEY: '6/7153-1-FDC-F',
      TITLE: 'North Sicuate, RI, Saturday, October 10, 2026 through Monday, October 12, 2026 UTC',
      LAST_MODIFICATION_DATETIME: '202610051111', STATE: 'RI', LEGAL: 'UAS PUBLIC GATHERING',
    },
  },
  {
    type: 'Feature',
    id: 'V_TFR_LOC.6/8001',
    geometry: { type: 'Polygon', coordinates: [ring.map(([x, y]) => [x + 1.123456789, y])] },
    properties: { NOTAM_KEY: '6/8001-1-FDC-F', TITLE: 'Boston, MA', STATE: 'MA', LEGAL: 'VIP' },
  },
  // Degenerate ring and missing NOTAM key are dropped.
  { type: 'Feature', id: 'V_TFR_LOC.6/8002', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }, properties: { NOTAM_KEY: '6/8002-1-FDC-F' } },
  { type: 'Feature', id: 'nope', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} },
];
const TFR_LIST = [
  {
    notam_id: '6/7153', type: 'UAS PUBLIC GATHERING', facility: 'ZBW', state: 'RI',
    description: 'North Sicuate, RI, Saturday, October 10, 2026 through Monday, October 12, 2026 UTC',
    creation_date: '10/05/2026',
  },
  { notam_id: '6/9000', type: 'HAZARDS', facility: 'ZBW', state: 'ME', description: '5NM S BANGOR, ME', creation_date: '10/05/2026' },
  { notam_id: '6/7526', type: 'HAZARDS', facility: 'ZLA', state: 'CA', description: 'CMA249063, CA', creation_date: '10/06/2026' },
];

describe('TFR normalizer', () => {
  it('joins polygons to the TFR list by NOTAM number', () => {
    const { features, unmapped } = normalizeTfrs(TFR_SHAPES, TFR_LIST);
    expect(features.map((feature) => feature.id)).toEqual(['6/7153#1', '6/8001#1']);
    expect(features[0].properties).toEqual({
      group: 'tfr',
      dataStatus: 'live',
      notamId: '6/7153',
      tfrType: 'UAS PUBLIC GATHERING',
      title: 'North Sicuate, RI, Saturday, October 10, 2026 through Monday, October 12, 2026 UTC',
      state: 'RI',
      facility: 'ZBW',
      createdOn: '2026-10-05',
      updatedAt: '2026-10-05T11:11:00.000Z',
      provider: 'FAA Temporary Flight Restrictions',
      sourceUrl: 'https://tfr.faa.gov/tfr3/?page=detail_6_7153',
    });
    // Unlisted polygons fall back to their own fields; coordinates are rounded.
    expect(features[1].properties).toMatchObject({ tfrType: 'VIP', title: 'Boston, MA', state: 'MA', createdOn: '' });
    expect(features[1].geometry.coordinates[0][0]).toEqual([-70.55254, 41.833]);
    // New England list entries without a polygon are reported, others ignored.
    expect(unmapped).toEqual([{
      notamId: '6/9000', tfrType: 'HAZARDS', state: 'ME', title: '5NM S BANGOR, ME',
      sourceUrl: 'https://tfr.faa.gov/tfr3/?page=detail_6_9000',
    }]);
  });

  it('still maps polygons when the list is unavailable', () => {
    const { features, unmapped } = normalizeTfrs(TFR_SHAPES, null);
    expect(features).toHaveLength(2);
    expect(features[0].properties.tfrType).toBe('UAS PUBLIC GATHERING');
    expect(unmapped).toEqual([]);
  });

  it('numbers multi-polygon TFRs per NOTAM', () => {
    const twoAreas = [TFR_SHAPES[0], { ...TFR_SHAPES[0], properties: { ...TFR_SHAPES[0].properties, NOTAM_KEY: '6/7153-2-FDC-F' } }];
    expect(normalizeTfrs(twoAreas, TFR_LIST).features.map((feature) => feature.id)).toEqual(['6/7153#1', '6/7153#2']);
  });

  it('validates NOTAM numbers', () => {
    expect(notamIdFrom('6/7153-1-FDC-F')).toBe('6/7153');
    expect(notamIdFrom('V_TFR_LOC.6/7153')).toBe('6/7153');
    expect(validNotamId('6/7153')).toBe(true);
    expect(validNotamId('12/345')).toBe(true);
    for (const id of ['6-7153', '6/7153&x=1', '/7153', '6/', '', null, '6/123456']) expect(validNotamId(id)).toBe(false);
  });
});

// Shape of /tfrapi/getWebText (one layout table, trimmed).
const row = (label, value) => `<TR><TD colspan="3"><font>${label}     :</font></TD><TD><font>${value}</font></TD></TR>`;
const TFR_WEB_TEXT = [{
  notam_id: '6/7153',
  text: `<Table>${row('NOTAM Number', 'FDC 6/7153')}${row('Issue Date', 'October 05, 2026 at 1111 UTC')}`
    + `${row('Location', 'North Sicuate, Rhode Island near PROVIDENCE VOR/DME (PVD)')}`
    + `${row('Beginning Date and Time', 'October 10, 2026 UTC 1300-2100 Daily')}`
    + `${row('Ending Date and Time', 'October 12, 2026 UTC')}`
    + `${row('Reason for NOTAM', 'For protection of large public gatherings.')}`
    + `${row('Type', 'UAS Public Gathering')}`
    + '<TR><TD>Jump To:</TD><TD><a>Affected Areas</a><br/><a>Operating Restrictions and Requirements</a><br/><a>Other Information</a><br/></TD></TR></Table>'
    + '<Table><TR><TD>Affected Area(s)</TD></TR><TR><TD>Top</TD></TR><TR><TD>Airspace Definition:</TD></TR>'
    + '<TR><TD>Center:</TD><TD>On the PVD 327 degree radial at 9.6 nautical miles. (Latitude: 41&#xBA;49\'58"N)</TD></TR>'
    + '<TR><TD>Altitude:</TD><TD>From the surface up to and including 400 feet AGL</TD></TR>'
    + '<TR><TD>Effective Date(s):</TD></TR><TR><TD>In UTC:</TD></TR>'
    + '<TR><TD>1300 to 2100 UTC Daily starting October 10 and ending October 12.</TD></TR>'
    + '<TR><TD>ENDSECTION1</TD></TR></Table>'
    + '<Table><TR><TD>Operating Restrictions and Requirements</TD></TR><TR><TD>Top</TD></TR>'
    + '<TR><TD>UAS OPS FOR OPERATIONAL, SAFETY, SECURITY, OR COMPLIANCE OVERSIGHT PURPOSES MUST CTC POINT OF CONTACT.</TD></TR></Table>'
    + '<Table><TR><TD>Other Information:</TD></TR><TR><TD>ARTCC:</TD><TD>ZBW - Boston Center</TD></TR></Table>',
}];

describe('TFR detail parser', () => {
  it('reads the labeled fields, altitudes and effective times', () => {
    expect(parseTfrDetail(TFR_WEB_TEXT, '6/7153')).toEqual({
      notamId: '6/7153',
      available: true,
      issued: 'October 05, 2026 at 1111 UTC',
      location: 'North Sicuate, Rhode Island near PROVIDENCE VOR/DME (PVD)',
      begins: 'October 10, 2026 UTC 1300-2100 Daily',
      ends: 'October 12, 2026 UTC',
      reason: 'For protection of large public gatherings.',
      type: 'UAS Public Gathering',
      altitudes: ['From the surface up to and including 400 feet AGL'],
      effective: ['1300 to 2100 UTC Daily starting October 10 and ending October 12.'],
      restrictions: 'UAS OPS FOR OPERATIONAL, SAFETY, SECURITY, OR COMPLIANCE OVERSIGHT PURPOSES MUST CTC POINT OF CONTACT.',
      notamText: '',
      provider: 'FAA Temporary Flight Restrictions',
      sourceUrl: 'https://tfr.faa.gov/tfr3/?page=detail_6_7153',
    });
  });

  it('collects every area altitude once and decodes entities', () => {
    const areas = [{
      notam_id: '6/7489',
      text: '<TR><TD>Area A</TD></TR><TR><TD>Altitude:</TD><TD>From the surface up to and including 17999 feet MSL</TD></TR>'
        + '<TR><TD>Effective Date(s):</TD></TR><TR><TD>From October 05, 2026 at 2158 UTC</TD></TR><TR><TD>To October 06, 2026 at 0300 UTC</TD></TR>'
        + '<TR><TD>Area B</TD></TR><TR><TD>Altitude: From the surface up to and including 17999 feet MSL</TD></TR>'
        + '<TR><TD>Effective Date(s):</TD></TR><TR><TD>From October 05, 2026 at 2158 UTC</TD></TR><TR><TD>To October 06, 2026 at 0300 UTC</TD></TR>',
    }];
    const detail = parseTfrDetail(areas, '6/7489');
    expect(detail.altitudes).toEqual(['From the surface up to and including 17999 feet MSL']);
    expect(detail.effective).toEqual(['From October 05, 2026 at 2158 UTC', 'To October 06, 2026 at 0300 UTC']);
    expect(tfrTextLines('<td>41&#xBA;49&#39;58&quot;N&nbsp;W</td>')).toEqual(['41º49\'58"N W']);
  });

  it('falls back to raw NOTAM text for special notices', () => {
    const special = [{
      notam_id: '1/5060',
      text: '<TR><TD>Type :</TD><TD>Special</TD></TR><TR><TD>Plain Language text is not available for this NOTAM. The traditional NOTAM text is given below:<br/>FDC 1/5060 ZZZ SECURITY...SPECIAL SECURITY INSTRUCTIONS</TD></TR>',
    }];
    expect(parseTfrDetail(special, '1/5060')).toMatchObject({
      type: 'Special',
      notamText: 'FDC 1/5060 ZZZ SECURITY...SPECIAL SECURITY INSTRUCTIONS',
      altitudes: [],
    });
    expect(parseTfrDetail([], '6/1')).toMatchObject({ available: false, notamId: '6/1' });
  });
});
