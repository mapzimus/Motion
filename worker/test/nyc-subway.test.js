import { describe, expect, it } from 'vitest';
import { SUBWAY_MAX_AGE_SECONDS, stationOf, subwayLineLabel, subwayTrains } from '../src/nyc-subway';
import { subwayTrainItem } from '../../src/feeds/nyc-subway-normalize.js';

const NOW = 1_792_506_940;
const update = (tripId, routeId, stops) => ({
  id: `${tripId}-tu`,
  tripUpdate: {
    trip: { tripId, routeId },
    stopTimeUpdate: stops.map(([stopId, offset]) => ({ stopId, arrival: { time: NOW + offset } })),
  },
});
const vehicle = (tripId, routeId, stopId, currentStatus, timestamp = NOW - 5) => ({
  id: `${tripId}-v`,
  vehicle: { trip: { tripId, routeId }, stopId, currentStatus, currentStopSequence: 12, timestamp },
});

describe('New York City Subway trains', () => {
  it('joins a vehicle to its trip update and reports the station it is heading to', () => {
    const trains = subwayTrains([
      update('057800_1..N15R', '1', [['110N', 90], ['111N', 210], ['112N', 330]]),
      vehicle('057800_1..N15R', '1', '110N', 'IN_TRANSIT_TO'),
    ], NOW);
    expect(trains).toEqual([{
      id: '057800_1..N15R',
      tripId: '057800_1..N15R',
      routeId: '1',
      line: '1',
      routeName: 'Broadway - 7 Avenue Local',
      color: '#ee352e',
      stopId: '110N',
      status: 'IN_TRANSIT_TO',
      direction: 'N',
      nextTime: NOW + 90,
      destinationStopId: '112N',
      updatedAt: new Date((NOW - 5) * 1000).toISOString(),
    }]);
  });

  it('reads numeric status codes, SIR stop ids, and drops stale or unknown trains', () => {
    const trains = subwayTrains([
      vehicle('060100_SI.N03R', 'SI', 'S27N', 1),
      vehicle('old', 'A', 'A02S', 2, NOW - SUBWAY_MAX_AGE_SECONDS - 1),
      vehicle('mystery', 'ZZ', 'A02S', 2),
      { id: 'no-stop', vehicle: { trip: { tripId: 'x', routeId: 'A' }, currentStatus: 2 } },
    ], NOW);
    expect(trains).toHaveLength(1);
    expect(trains[0]).toMatchObject({ line: 'SIR', status: 'STOPPED_AT', direction: 'N', nextTime: null });
  });

  it('keeps one record per trip when a feed repeats a vehicle', () => {
    const trains = subwayTrains([
      vehicle('t', 'L', 'L01S', 'STOPPED_AT'),
      vehicle('t', 'L', 'L01S', 'STOPPED_AT'),
    ], NOW);
    expect(trains).toHaveLength(1);
  });

  it('labels shuttles S and strips direction suffixes from stop ids', () => {
    expect(subwayLineLabel('GS')).toBe('S');
    expect(subwayLineLabel('7X')).toBe('7X');
    expect(stationOf('101N')).toBe('101');
    expect(stationOf('S27S')).toBe('S27');
    expect(stationOf('901')).toBe('901');
  });
});

describe('subway train placement in the browser', () => {
  const network = {
    stops: {
      '110N': { name: 'Christopher St', lng: -74.003, lat: 40.733 },
      '111N': { name: '14 St', lng: -73.999, lat: 40.737 },
      '112N': { name: '18 St', lng: -73.998, lat: 40.741 },
      113: { name: '23 St', lng: -73.996, lat: 40.744 },
    },
    segments: { 1: { '111N': { '110N': 120 }, '112N': { '111N': 90, '999N': 90 } } },
  };
  const nowMs = NOW * 1000;
  const train = (overrides = {}) => ({
    id: 't1', tripId: 't1', routeId: '1', line: '1', routeName: 'Broadway - 7 Avenue Local', color: '#ee352e',
    stopId: '111N', status: 'IN_TRANSIT_TO', direction: 'N', nextTime: NOW + 60, destinationStopId: '113N',
    updatedAt: new Date(nowMs - 5000).toISOString(), ...overrides,
  });

  it('interpolates between the previous station and the one it is heading to', () => {
    const item = subwayTrainItem(train(), network, { now: nowMs });
    // 60 s left of a typical 120 s segment: halfway along.
    expect(item.lng).toBeCloseTo(-74.001, 5);
    expect(item.lat).toBeCloseTo(40.735, 5);
    expect(item.props).toMatchObject({
      group: 'nyc-subway', dataStatus: 'estimated', legendKey: 'nyc-subway', shadeKey: 'nyc-subway:1',
      color: '#ee352e', hasBearing: true, status: 'Christopher St → 14 St · 1 min', dest: '1 to 23 St', stale: false,
    });
    expect(item.detail.nextStop).toBe('14 St');
  });

  it('sits at the station when stopped there, or when the line branches behind it', () => {
    const stopped = subwayTrainItem(train({ status: 'STOPPED_AT' }), network, { now: nowMs });
    expect([stopped.lng, stopped.lat]).toEqual([-73.999, 40.737]);
    expect(stopped.props.status).toBe('At 14 St');
    const branched = subwayTrainItem(train({ stopId: '112N' }), network, { now: nowMs });
    expect([branched.lng, branched.lat]).toEqual([-73.998, 40.741]);
    expect(branched.props.hasBearing).toBe(false);
  });

  it('falls back to the parent station id and drops unknown stations', () => {
    expect(subwayTrainItem(train({ stopId: '113N', status: 'STOPPED_AT' }), network, { now: nowMs }).lat).toBe(40.744);
    expect(subwayTrainItem(train({ stopId: '999N' }), network, { now: nowMs })).toBeNull();
  });
});
