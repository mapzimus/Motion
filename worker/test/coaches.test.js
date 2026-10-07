import { describe, expect, it } from 'vitest';
import { CJ, coachesFromStopFeeds, parsePeterPanConfig, parseUtrackConfig } from '../src/coaches';

const NOW = Date.parse('2026-10-06T23:50:00Z');
const FRESH = Math.floor(NOW / 1000) - 60;

function departure(overrides = {}) {
  return {
    trip: {
      short_name: 'BZ 0544B',
      route_id: 'BZ0544B',
      departure_location_name: 'Woods Hole, MA',
      arrival_location_name: 'Boston, MA',
    },
    tracking: { has_no_gps: false, has_no_vehicle: false, is_cancelled: false },
    active_vehicle: {
      current_wgs84_latitude_degrees: 41.65712,
      current_wgs84_longitude_degrees: -70.2793,
      current_forward_azimuth_degrees: 0,
      current_speed_mph: 0,
      last_update_time_unix: FRESH,
    },
    ...overrides,
  };
}

describe('Peter Pan coaches', () => {
  it('reads the public tracker config and ignores a key that is not public', () => {
    expect(parsePeterPanConfig(`
      window.configs = {
        API_URL: 'https://peterpan.origin.utrack.com/api',
        API_KEY: 'PUBLICEXAMPLEKEY123',
      };
    `)).toEqual({
      apiUrl: 'https://peterpan.origin.utrack.com/api',
      apiKey: 'PUBLICEXAMPLEKEY123',
    });
    expect(parsePeterPanConfig("API_URL: 'https://example.test/api', API_KEY: 'PUBLICEXAMPLEKEY123'")).toBeNull();
    expect(parsePeterPanConfig("API_URL: 'https://peterpan.origin.utrack.com/api', API_KEY: 'SECRETKEY123456'")).toBeNull();
  });

  it('keeps one coach per GPS fix and drops a shared copy of an older report', () => {
    const coaches = coachesFromStopFeeds([{
      stops: [{
        chronological_departures: [
          departure(),
          departure({
            trip: { short_name: 'BZ 0100', route_id: 'BZ0100', departure_location_name: 'Hyannis, MA', arrival_location_name: 'Boston, MA' },
            active_vehicle: {
              current_wgs84_latitude_degrees: 41.657121,
              current_wgs84_longitude_degrees: -70.279301,
              current_forward_azimuth_degrees: 90,
              current_speed_mph: 32,
              last_update_time_unix: FRESH + 30,
            },
          }),
        ],
      }],
    }], NOW);
    expect(coaches).toHaveLength(1);
    expect(coaches[0]).toMatchObject({
      id: 'pp_41.65712_-70.27930',
      title: 'Peter Pan · BZ 0100',
      dest: 'Hyannis, MA → Boston, MA',
      speedMph: 32,
      bearing: 90,
      route: 'BZ0100',
    });
    expect(coaches[0].lng).toBe(-70.279301);
  });

  it('drops coaches with no GPS, a stale fix, or a position outside New England', () => {
    const coaches = coachesFromStopFeeds([{
      stops: [{ chronological_departures: [
      departure({ tracking: { has_no_gps: true } }),
      departure({
        active_vehicle: {
          current_wgs84_latitude_degrees: 42.35,
          current_wgs84_longitude_degrees: -71.05,
          current_speed_mph: 28,
          current_forward_azimuth_degrees: 15,
          last_update_time_unix: FRESH - 21 * 60,
        },
      }),
      departure({
        trip: { short_name: 'NY 1', route_id: 'NY1', departure_location_name: 'New York, NY', arrival_location_name: 'Philadelphia, PA' },
        active_vehicle: {
          current_wgs84_latitude_degrees: 40.10543,
          current_wgs84_longitude_degrees: -74.97334,
          current_speed_mph: 0,
          current_forward_azimuth_degrees: 0,
          last_update_time_unix: FRESH,
        },
      }),
      departure({
        trip: { short_name: 'BZ 200', route_id: 'BZ200', departure_location_name: 'Boston, MA', arrival_location_name: 'Springfield, MA' },
        active_vehicle: {
          current_wgs84_latitude_degrees: 42.3466,
          current_wgs84_longitude_degrees: -71.03876,
          current_speed_mph: 31,
          current_forward_azimuth_degrees: 270,
          last_update_time_unix: FRESH,
        },
      }),
      ] }],
    }], NOW);
    expect(coaches.map((coach) => coach.route)).toEqual(['BZ200']);
  });

  it('reads the C&J tracker and drops a coach that is outside New England', () => {
    expect(parseUtrackConfig(`
      API_URL: 'https://cj.origin.utrack.com/api',
      API_KEY: 'PUBLICEXAMPLEKEY123',
    `, 'cj.origin.utrack.com')).toEqual({
      apiUrl: 'https://cj.origin.utrack.com/api',
      apiKey: 'PUBLICEXAMPLEKEY123',
    });
    const coaches = coachesFromStopFeeds([{
      stops: [{ chronological_departures: [
        departure({
          trip: {
            short_name: 'DVLG',
            route_id: 'DVLG',
            departure_location_name: 'Dover, NH',
            arrival_location_name: 'Logan Airport',
          },
          active_vehicle: {
            current_wgs84_latitude_degrees: 43.05962,
            current_wgs84_longitude_degrees: -70.80386,
            current_forward_azimuth_degrees: 180,
            current_speed_mph: 40,
            last_update_time_unix: FRESH,
          },
        }),
        departure({
          trip: {
            short_name: 'NY',
            route_id: 'NY',
            departure_location_name: 'New York, NY',
            arrival_location_name: 'Dover, NH',
          },
          active_vehicle: {
            current_wgs84_latitude_degrees: 40.75695,
            current_wgs84_longitude_degrees: -73.9905,
            current_speed_mph: 10,
            current_forward_azimuth_degrees: 0,
            last_update_time_unix: FRESH,
          },
        }),
      ] }],
    }], NOW, CJ);
    expect(coaches).toHaveLength(1);
    expect(coaches[0]).toMatchObject({
      id: 'cj_43.05962_-70.80386',
      legendKey: 'cj',
      provider: 'C&J Bus Lines',
      title: 'C&J · DVLG',
      route: 'DVLG',
    });
  });
});
