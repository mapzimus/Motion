// The aircraft relay is a separate Vercel project (aircraft-gateway/), but its
// handlers are plain fetch(Request) => Response modules, so they run here too.
import { afterEach, describe, expect, it, vi } from 'vitest';
import planes, { normalizeAircraft } from '../../aircraft-gateway/api/planes.ts';
import route from '../../aircraft-gateway/api/route.ts';

const NOW = Date.parse('2026-10-05T16:00:00Z');

const record = (overrides = {}) => ({
  hex: 'a1b2c3',
  lat: 42.36,
  lon: -71.01,
  flight: 'JBU1123 ',
  t: 'A320',
  r: 'N123JB',
  category: 'A3',
  squawk: '2731',
  emergency: 'none',
  track: 41.2,
  alt_baro: 3500,
  gs: 182,
  baro_rate: -704,
  seen: 2,
  dbFlags: 0,
  ...overrides,
});

describe('normalizeAircraft', () => {
  it('keeps the original fields and adds category, squawk, emergency, registration and climb rate', () => {
    expect(normalizeAircraft(record(), NOW)).toEqual({
      id: 'a1b2c3',
      lng: -71.01,
      lat: 42.36,
      callsign: 'JBU1123',
      aircraftType: 'A320',
      bearing: 41.2,
      altitudeFeet: 3500,
      groundSpeedKnots: 182,
      onGround: false,
      updatedAt: '2026-10-05T15:59:58.000Z',
      category: 'A3',
      squawk: '2731',
      emergency: 'none',
      registration: 'N123JB',
      verticalRateFpm: -704,
      dbFlags: 0,
    });
  });

  it('withholds the registration for PIA and LADD aircraft', () => {
    expect(normalizeAircraft(record({ dbFlags: 4 }), NOW).registration).toBeNull();
    expect(normalizeAircraft(record({ dbFlags: 8 }), NOW).registration).toBeNull();
    expect(normalizeAircraft(record({ dbFlags: 1 | 8 }), NOW).registration).toBeNull();
    // Military / interesting bits alone do not change what is shown.
    expect(normalizeAircraft(record({ dbFlags: 1 }), NOW).registration).toBe('N123JB');
    expect(normalizeAircraft(record({ dbFlags: 2 }), NOW).registration).toBe('N123JB');
  });

  it('withholds the registration for rotorcraft', () => {
    const helicopter = normalizeAircraft(record({ category: 'A7', t: 'EC35', r: 'N911BM' }), NOW);
    expect(helicopter.category).toBe('A7');
    expect(helicopter.aircraftType).toBe('EC35');
    expect(helicopter.registration).toBeNull();
  });

  it('never passes owner/operator or other unlisted upstream fields through', () => {
    const normalized = normalizeAircraft(record({ ownOp: 'Jane Doe Trust', desc: 'AIRBUS A-320', year: '2014' }), NOW);
    const text = JSON.stringify(normalized);
    expect(text).not.toContain('Jane Doe');
    expect(normalized).not.toHaveProperty('ownOp');
    expect(normalized).not.toHaveProperty('desc');
  });

  it('validates category, squawk and emergency values', () => {
    const odd = normalizeAircraft(record({ category: 'Z9', squawk: '7800', emergency: '<b>' }), NOW);
    expect(odd.category).toBeNull();
    expect(odd.squawk).toBeNull();
    expect(odd.emergency).toBeNull();
    const emergency = normalizeAircraft(record({ squawk: '7700', emergency: 'general', category: 'a5' }), NOW);
    expect(emergency).toMatchObject({ squawk: '7700', emergency: 'general', category: 'A5' });
  });

  it('falls back to geometric rate and handles ground and missing data', () => {
    const ground = normalizeAircraft(record({ alt_baro: 'ground', baro_rate: undefined, geom_rate: 64 }), NOW);
    expect(ground).toMatchObject({ onGround: true, altitudeFeet: null, verticalRateFpm: 64 });
    const bare = normalizeAircraft({ hex: 'abc123', lat: 42, lon: -71 }, NOW);
    expect(bare).toMatchObject({ category: null, squawk: null, emergency: null, registration: null, verticalRateFpm: null, dbFlags: 0 });
    expect(normalizeAircraft({ hex: 'abc123', lat: null, lon: -71 }, NOW)).toBeNull();
    expect(normalizeAircraft({ lat: 42, lon: -71 }, NOW)).toBeNull();
  });
});

describe('relay handlers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('planes returns normalized aircraft without owner data', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({
      ac: [record({ ownOp: 'Jane Doe Trust' }), record({ hex: 'ladd01', dbFlags: 8 })],
    }));
    const response = await planes.fetch(new Request('https://relay.test/api/planes?region=boston'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.aircraft).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('Jane Doe');
    expect(body.aircraft.find((a) => a.id === 'ladd01').registration).toBeNull();
    expect(body.aircraft.find((a) => a.id === 'a1b2c3').registration).toBe('N123JB');
  });

  it('route answers 502 JSON when the route catalog cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));
    const response = await route.fetch(new Request('https://relay.test/api/route?callsign=JBU1123'));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Route provider unavailable' });
  });

  it('route answers 502 JSON when the route catalog sends a bad body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json', { status: 200 }));
    const response = await route.fetch(new Request('https://relay.test/api/route?callsign=JBU1123'));
    expect(response.status).toBe(502);
  });

  it('route keeps 404 for an unknown callsign', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('missing', { status: 404 }));
    const response = await route.fetch(new Request('https://relay.test/api/route?callsign=ZZZ999'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Route unavailable' });
  });
});
