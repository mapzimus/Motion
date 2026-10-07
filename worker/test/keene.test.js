import { describe, expect, it } from 'vitest';
import { combinePlowFeeds, parseKeeneViewer } from '../src/keene';

const NOW = Date.parse('2026-10-06T23:50:00Z');

function device(name, id, location) {
  return { name, id, location: [location] };
}

describe('Keene public-works trucks', () => {
  it('keeps a fresh parked truck and a moving truck, without a speed unit', () => {
    const features = parseKeeneViewer({
      data: {
        fleetViewerToken: {
          devices: [
            device('SLED ZEPPELIN (1412)', '100', {
              time: NOW - 60_000,
              latitude: 42.926061,
              longitude: -72.266057,
              heading: 0,
              speed: 0,
              formatted: 'Keene, NH, 03435',
            }),
            device('# 1724', '1724', {
              time: NOW - 30_000,
              latitude: 42.933,
              longitude: -72.278,
              heading: 40,
              speed: 1.87,
              formatted: 'West St, Keene, NH',
            }),
          ],
        },
      },
    }, NOW);
    expect(features).toHaveLength(2);
    expect(features[0]).toMatchObject({
      id: 'keene-100',
      geometry: { coordinates: [-72.266057, 42.926061] },
      properties: {
        group: 'plow',
        title: 'SLED ZEPPELIN (1412)',
        status: 'Parked · City of Keene',
        details: 'Keene, NH, 03435',
        provider: 'City of Keene public works',
      },
    });
    expect(features[1].properties.status).toBe('Moving · City of Keene');
    expect(JSON.stringify(features)).not.toMatch(/mph|driver/i);
  });

  it('drops a fix older than a day and a truck outside New England', () => {
    const features = parseKeeneViewer({
      data: {
        fleetViewerToken: {
          devices: [
            device('SNOW BE GONE KENOBI (2405)', 'old', {
              time: Date.parse('2025-12-02T15:00:00Z'),
              latitude: 42.93,
              longitude: -72.28,
              speed: 0,
              formatted: 'Keene, NH',
            }),
            device('AWAY', 'away', {
              time: NOW - 1000,
              latitude: 40.1,
              longitude: -74.97,
              speed: 0,
              formatted: 'Somewhere else',
            }),
          ],
        },
      },
    }, NOW);
    expect(features).toEqual([]);
  });

  it('still returns a plow collection when only one feed answered', () => {
    const keeneOnly = combinePlowFeeds(null, [{
      type: 'Feature',
      id: 'keene-1',
      geometry: { type: 'Point', coordinates: [-72.27, 42.93] },
      properties: { group: 'plow' },
    }]);
    expect(keeneOnly?.coverage).toEqual(['nh']);
    expect(keeneOnly?.provider).toBe('City of Keene public works');
    expect(keeneOnly?.note).toContain('Vermont plow file is unavailable');
    expect(combinePlowFeeds([], null)?.coverage).toEqual(['vt']);
    expect(combinePlowFeeds([], null)?.note).toContain('empty outside winter');
    expect(combinePlowFeeds([], null)?.note).toContain('Keene live share is unavailable');
    expect(combinePlowFeeds(null, null)).toBeNull();
  });
});
