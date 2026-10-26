import { describe, expect, it } from 'vitest';
import { chicagoOffsetMinutes, chicagoTimeToIso, chunk, ctaBusRouteIds, ctaBusVehicles, ctaTrainVehicles } from '../src/cta';
import { metraAuthorization, metraVehicles } from '../src/metra';

describe('CTA Train Tracker adapter', () => {
  it('normalizes trains on every line with the official color', () => {
    const payload = {
      ctatt: {
        tmst: '2026-10-26T14:03:12',
        route: [
          { '@name': 'red', train: [{ rn: '812', destNm: 'Howard', lat: '41.8781', lon: '-87.6298', heading: '355', prdt: '2026-10-26T14:03:00' }] },
          { '@name': 'brn', train: { rn: '411', destNm: 'Loop', lat: 41.95, lon: -87.68, heading: 90, prdt: '2026-10-26T14:02:30' } },
          { '@name': 'nope', train: [{ rn: '1', lat: 41, lon: -87 }] },
        ],
      },
    };
    const vehicles = ctaTrainVehicles(payload, new Date('2026-10-26T19:05:00Z'));
    expect(vehicles.map((v) => v.id)).toEqual(['cta-train-red-812', 'cta-train-brn-411']);
    expect(vehicles[0]).toMatchObject({ route: 'Red Line', color: '#c60c30', headsign: 'Howard', bearing: 355, lat: 41.8781, lng: -87.6298 });
    // 14:03 Chicago daylight time is 19:03 UTC.
    expect(vehicles[0].updatedAt).toBe('2026-10-26T19:03:00.000Z');
  });

  it('converts Chicago local time with the DST rule', () => {
    expect(chicagoOffsetMinutes(new Date('2026-07-01T12:00:00Z'))).toBe(-300);
    expect(chicagoOffsetMinutes(new Date('2026-12-01T12:00:00Z'))).toBe(-360);
    expect(chicagoTimeToIso('20261226 08:15', -360)).toBe('2026-12-26T14:15:00.000Z');
    expect(chicagoTimeToIso('garbage', -360)).toBeNull();
  });
});

describe('CTA Bus Tracker adapter', () => {
  it('normalizes buses and lists routes in batches of ten', () => {
    const buses = ctaBusVehicles({ 'bustime-response': { vehicle: [
      { vid: '1234', tmstmp: '20261026 14:03:10', lat: '41.88', lon: '-87.63', hdg: '180', rt: '22', des: 'Harrison', tatripid: '88' },
      { vid: '', lat: '41', lon: '-87' },
    ] } }, new Date('2026-10-26T19:05:00Z'));
    expect(buses).toHaveLength(1);
    expect(buses[0]).toMatchObject({ id: 'cta-bus-1234', route: '22', trip: '88', headsign: 'Harrison', bearing: 180 });
    expect(buses[0].updatedAt).toBe('2026-10-26T19:03:10.000Z');
    const routes = ctaBusRouteIds({ 'bustime-response': { routes: Array.from({ length: 23 }, (_, i) => ({ rt: String(i + 1) })) } });
    expect(chunk(routes, 10).map((batch) => batch.length)).toEqual([10, 10, 3]);
  });
});

describe('Metra GTFS API adapter', () => {
  it('reads the JSON entities with Long timestamps', () => {
    const vehicles = metraVehicles([
      { id: 'x', vehicle: { trip: { trip_id: 'UP-N_UN312', route_id: 'UP-N' }, vehicle: { id: '312', label: '312' }, position: { latitude: 41.9, longitude: -87.7, bearing: 10, speed: 20 }, timestamp: { low: 1_761_500_000, high: 0, unsigned: true } } },
      { id: 'y', vehicle: { position: {} } },
    ]);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toMatchObject({ id: 'metra-312', route: 'UP-N', trip: 'UP-N_UN312', speedMps: 20, updatedAt: '2025-10-26T17:33:20.000Z' });
    expect(metraAuthorization('user', 'pass')).toBe(`Basic ${btoa('user:pass')}`);
  });
});
