import { describe, expect, it } from 'vitest';
import { LIRR_ROUTES, MNR_GPS_MAX_AGE_SECONDS, lirrTrips, metroNorthTrips } from '../src/metro-north';
import { trainItem } from '../../src/feeds/metro-north-normalize.js';

const NOW = 1_791_137_786;
const stop = (stopId, offsetSeconds) => ({ stopId, departure: { time: NOW + offsetSeconds } });
const entity = (overrides = {}) => ({
  id: '6332',
  tripUpdate: {
    trip: { routeId: '3', tripId: '6332' },
    stopTimeUpdate: [stop('1', -1800), stop('124', -120), stop('116', 480), stop('149', 2400)],
  },
  vehicle: {
    position: { latitude: 41.0399, longitude: -73.552 },
    timestamp: NOW - 20,
    vehicle: { id: '6332', label: '6332' },
  },
  ...overrides,
});

describe('Metro-North trips', () => {
  it('reports a running train at its GPS fix', () => {
    const [trip] = metroNorthTrips([entity()], NOW);
    expect(trip.positioning).toBe('gps');
    expect(trip.position).toMatchObject({ lat: 41.0399, lng: -73.552 });
    expect(trip.previousStopId).toBe('124');
    expect(trip.nextStopId).toBe('116');
    expect(trip.destinationStopId).toBe('149');
    expect(trip.routeName).toBe('New Haven');
  });

  it('falls back to a station estimate when there is no GPS fix', () => {
    const [trip] = metroNorthTrips([entity({ vehicle: { vehicle: { label: '6332' } } })], NOW);
    expect(trip.positioning).toBe('estimated');
    expect(trip.position).toBeNull();
    expect(trip.progress).toBeCloseTo(120 / 600, 5);
  });

  it('ignores a stale or out-of-area GPS fix', () => {
    const stale = entity({ vehicle: { position: { latitude: 41.04, longitude: -73.55 }, timestamp: NOW - MNR_GPS_MAX_AGE_SECONDS - 1 } });
    const zeroed = entity({ vehicle: { position: { latitude: 0, longitude: 0 }, timestamp: NOW } });
    expect(metroNorthTrips([stale], NOW)[0].positioning).toBe('estimated');
    expect(metroNorthTrips([zeroed], NOW)[0].positioning).toBe('estimated');
  });

  it('keeps a GPS train whose passed stops were dropped, and drops one with no GPS', () => {
    const upcomingOnly = { trip: { routeId: '5', tripId: '1850' }, stopTimeUpdate: [stop('116', 300), stop('162', 1500)] };
    const withGps = entity({ id: '1850', tripUpdate: upcomingOnly });
    const withoutGps = entity({ id: '1851', tripUpdate: upcomingOnly, vehicle: null });
    const trips = metroNorthTrips([withGps, withoutGps], NOW);
    expect(trips.map((trip) => trip.id)).toEqual(['1850']);
    expect(trips[0]).toMatchObject({ positioning: 'gps', previousStopId: '', nextStopId: '116', routeName: 'Danbury' });
  });

  it('drops finished trips and unknown routes, and keeps the Hudson and Harlem lines', () => {
    const finished = entity({ tripUpdate: { trip: { routeId: '3' }, stopTimeUpdate: [stop('1', -900), stop('149', -60)] } });
    const unknown = entity({ tripUpdate: { trip: { routeId: '9' }, stopTimeUpdate: [stop('1', -60), stop('4', 600)] } });
    const hudson = entity({ id: '800', tripUpdate: { trip: { routeId: '1', tripId: '800' }, stopTimeUpdate: [stop('1', -60), stop('4', 600)] } });
    const trips = metroNorthTrips([finished, unknown, hudson], NOW);
    expect(trips.map((trip) => trip.id)).toEqual(['800']);
    expect(trips[0]).toMatchObject({ routeName: 'Hudson', color: '#009b3a' });
  });
});

describe('Long Island Rail Road trips', () => {
  it('joins a separate GPS vehicle entity to its trip update by trip id', () => {
    const update = {
      id: 'GO202_26_809_T',
      tripUpdate: {
        trip: { routeId: '6', tripId: 'GO202_26_809' },
        stopTimeUpdate: [stop('113', -600), stop('99', -60), stop('155', 240), stop('225', 900)],
      },
    };
    const vehicle = {
      id: 'GO202_26_809_V',
      vehicle: {
        trip: { tripId: 'GO202_26_809' },
        position: { latitude: 40.7551, longitude: -73.9754 },
        timestamp: NOW - 15,
        vehicle: { id: '7615_809', label: '7615' },
      },
    };
    const [trip] = lirrTrips([update, vehicle], NOW);
    expect(trip).toMatchObject({
      id: 'GO202_26_809_T',
      tripId: 'GO202_26_809',
      label: '7615',
      routeName: 'Long Beach',
      color: LIRR_ROUTES['6'].color,
      positioning: 'gps',
      previousStopId: '99',
      nextStopId: '155',
      destinationStopId: '225',
    });
    expect(trip.position).toMatchObject({ lat: 40.7551, lng: -73.9754 });
    // The vehicle entity on its own is not a second train.
    expect(lirrTrips([update, vehicle], NOW)).toHaveLength(1);
  });

  it('estimates a train between stations when no vehicle entity matches', () => {
    const update = {
      id: 'T1',
      tripUpdate: { trip: { routeId: '9', tripId: 'T1' }, stopTimeUpdate: [stop('a', -300), stop('b', 300)] },
    };
    const [trip] = lirrTrips([update], NOW);
    expect(trip).toMatchObject({ routeName: 'Port Washington', positioning: 'estimated', progress: 0.5 });
  });
});

describe('Metro-North map items', () => {
  const stops = {
    124: { name: 'Stamford', lat: 41.0465, lng: -73.5425 },
    116: { name: 'South Norwalk', lat: 41.0958, lng: -73.4218 },
    149: { name: 'New Haven', lat: 41.2975, lng: -72.9267 },
  };

  it('labels a GPS train live and puts it at the reported fix', () => {
    const [trip] = metroNorthTrips([entity()], NOW);
    const item = trainItem(trip, stops, { now: NOW * 1000 });
    expect(item.props.dataStatus).toBe('live');
    expect([item.lat, item.lng]).toEqual([41.0399, -73.552]);
    expect(item.props.meta).toMatch(/GPS/);
    expect(item.props.status).toMatch(/^Stamford → South Norwalk/);
  });

  it('labels an interpolated train estimated', () => {
    const [trip] = metroNorthTrips([entity({ vehicle: null })], NOW);
    const item = trainItem(trip, stops, { now: NOW * 1000 });
    expect(item.props.dataStatus).toBe('estimated');
    expect(item.lat).toBeGreaterThan(41.0465);
    expect(item.lat).toBeLessThan(41.0958);
  });

  it('shows a GPS train with no previous station, and skips an estimate without one', () => {
    const upcomingOnly = { trip: { routeId: '3' }, stopTimeUpdate: [stop('116', 300), stop('149', 1500)] };
    const [trip] = metroNorthTrips([entity({ tripUpdate: upcomingOnly })], NOW);
    const item = trainItem(trip, stops, { now: NOW * 1000 });
    expect(item.props.status).toMatch(/^Next stop South Norwalk/);
    expect(item.props.hasBearing).toBe(false);
    expect(trainItem({ ...trip, position: null }, stops, { now: NOW * 1000 })).toBeNull();
  });
});
