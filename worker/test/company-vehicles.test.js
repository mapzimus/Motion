import { describe, expect, it } from 'vitest';
import { keeneCityTrucks, peterPanCoaches } from '../src/company-vehicles';

const NOW = Date.parse('2026-10-06T23:50:00Z');

function departure(overrides) {
  return {
    active_vehicle: {
      current_wgs84_latitude_degrees: 42.34918,
      current_wgs84_longitude_degrees: -71.05661,
      current_speed_mph: 0,
      current_forward_azimuth_degrees: 0,
      last_update_time_unix: 1_791_331_200,
      ...overrides.vehicle,
    },
    tracking: {
      is_completed: false,
      is_future_trip: false,
      is_cancelled: false,
      has_no_gps: false,
      has_no_vehicle: false,
      ...overrides.tracking,
    },
    trip: {
      id: 'trip-a',
      route_id: 'PPB5744P',
      departure_location_name: 'Boston, MA',
      arrival_location_name: 'New York, NY',
      ...overrides.trip,
    },
  };
}

describe('Peter Pan coaches', () => {
  it('draws one coach when several trips share a fix', () => {
    const coaches = peterPanCoaches([{
      stops: [{
        chronological_departures: [
          departure({ trip: { id: 'older', route_id: 'A' }, vehicle: { last_update_time_unix: 1_791_331_000 } }),
          departure({
            trip: { id: 'newer', route_id: 'B' },
            vehicle: { last_update_time_unix: 1_791_331_500, current_speed_mph: 67, current_forward_azimuth_degrees: 180 },
          }),
          departure({
            trip: { id: 'cape', route_id: 'BZ0559B', departure_location_name: 'Boston, MA', arrival_location_name: 'Hyannis, MA' },
            vehicle: {
              current_wgs84_latitude_degrees: 41.7,
              current_wgs84_longitude_degrees: -70.3,
              current_speed_mph: 54,
              current_forward_azimuth_degrees: 90,
              last_update_time_unix: 1_791_331_400,
            },
          }),
        ],
      }],
    }]);
    expect(coaches).toHaveLength(2);
    const shared = coaches.find((coach) => coach.trip === 'newer');
    expect(shared).toMatchObject({
      id: 'peter-pan-newer',
      feed: 'peter-pan',
      agency: 'Peter Pan Bus Lines',
      route: 'B',
      from: 'Boston, MA',
      to: 'New York, NY',
      bearing: 180,
    });
    expect(shared.speedMps).toBeCloseTo(67 / 2.23694, 5);
    expect(coaches.map((coach) => coach.trip).sort()).toEqual(['cape', 'newer']);
  });

  it('drops completed, future, and out-of-region rows and collapses the same trip', () => {
    const coaches = peterPanCoaches([
      { stops: [{ chronological_departures: [
        departure({ tracking: { is_completed: true } }),
        departure({ trip: { id: 'later' }, tracking: { is_future_trip: true } }),
        departure({
          trip: { id: 'away' },
          vehicle: { current_wgs84_latitude_degrees: 40.75, current_wgs84_longitude_degrees: -73.99 },
        }),
      ] }] },
      { stops: [{ chronological_departures: [
        departure({ trip: { id: 'once' }, vehicle: { last_update_time_unix: 1_791_331_100, current_speed_mph: 10 } }),
      ] }] },
      { stops: [{ chronological_departures: [
        departure({ trip: { id: 'once' }, vehicle: { last_update_time_unix: 1_791_331_900, current_speed_mph: 40 } }),
      ] }] },
    ]);
    expect(coaches).toHaveLength(1);
    expect(coaches[0].trip).toBe('once');
    expect(coaches[0].speedMps).toBeCloseTo(40 / 2.23694, 5);
  });
});

describe('Keene city trucks', () => {
  it('keeps each truck and labels a fresh parked fix without calling it a storm tracker', () => {
    const [truck] = keeneCityTrucks({
      data: {
        fleetViewerToken: {
          devices: [{
            id: 7,
            name: 'YARD TRUCK',
            location: [
              { time: NOW - 60_000, latitude: 42.92, longitude: -72.26, heading: 0, speed: 0 },
            ],
          }],
        },
      },
    }, NOW);
    expect(truck.geometry.coordinates).toEqual([-72.26, 42.92]);
    expect(truck.properties).toMatchObject({
      group: 'city-truck',
      dataStatus: 'live',
      title: 'City truck · YARD TRUCK',
      status: 'Parked',
      provider: 'City of Keene',
    });
    expect(String(truck.properties.status)).not.toMatch(/storm|plow/i);
  });

  it('uses the last fix and marks a stale truck as last parked', () => {
    const [truck] = keeneCityTrucks({
      data: {
        fleetViewerToken: {
          devices: [{
            id: 8,
            name: 'SOUTH TRUCK',
            location: [
              { time: NOW - 86_400_000, latitude: 42.1, longitude: -72.2, speed: 0 },
              { time: NOW - 30 * 86_400_000, latitude: 42.925, longitude: -72.265, heading: 0, speed: 0 },
            ],
          }, {
            id: 9,
            name: 'NO FIX',
          }],
        },
      },
    }, NOW);
    expect(truck.id).toBe('keene-8');
    expect(truck.geometry.coordinates).toEqual([-72.265, 42.925]);
    expect(truck.properties).toMatchObject({
      dataStatus: 'reference',
      title: 'City truck · SOUTH TRUCK',
      status: 'Last parked',
    });
  });

  it('reports a recently moving truck in miles per hour', () => {
    const [truck] = keeneCityTrucks({
      fleetViewerToken: {
        devices: [{
          id: 3,
          name: 'ROUTE TRUCK',
          location: { time: NOW - 5_000, latitude: 42.93, longitude: -72.27, heading: 90, speed: 1.878 },
        }],
      },
    }, NOW);
    expect(truck.properties.status).toBe('City truck · 4 mph');
    expect(truck.properties.dataStatus).toBe('live');
  });
});
