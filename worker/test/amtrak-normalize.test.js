import { describe, expect, it } from 'vitest';
import {
  ageAmtrakItems,
  delayLabel,
  normalizeAmtrakTrain,
} from '../../js/amtrak-normalize.js';

const options = {
  box: { latMin: 40.7, latMax: 47.75, lonMin: -74.1, lonMax: -65.8 },
  color: '#5b9bd5',
  now: Date.parse('2026-08-19T18:00:00-04:00'),
  staleAfterMs: 5 * 60_000,
};

const activeTrain = {
  trainID: '56-19',
  trainNum: '56',
  routeName: 'Vermonter',
  trainState: 'Active',
  lat: 43.05,
  lon: -72.47,
  heading: 'NW',
  velocity: 57.7,
  origName: 'Washington Union',
  destName: 'St. Albans',
  updatedAt: '2026-08-19T17:59:55-04:00',
  lastValTS: '2026-08-19T17:52:00-04:00',
  stations: [
    { name: 'Washington Union', status: 'Departed' },
    {
      name: 'Bellows Falls',
      status: 'Enroute',
      schArr: '2026-08-19T18:05:00-04:00',
      arr: '2026-08-19T18:12:00-04:00',
    },
    { name: 'St. Albans', status: 'Enroute' },
  ],
};

describe('Amtraker normalization', () => {
  it('uses the last position fix for freshness and exposes trip details', () => {
    const item = normalizeAmtrakTrain(activeTrain, options);
    expect(item.props).toMatchObject({
      dataStatus: 'live',
      stale: true,
      updatedAt: activeTrain.lastValTS,
      dest: 'Washington Union → St. Albans',
      status: 'Next stop Bellows Falls · 7 min late',
      meta: 'train 56 · 58 mph',
      bearing: 315,
    });
  });

  it('drops completed trains and coordinates outside the New England probe', () => {
    expect(normalizeAmtrakTrain({ ...activeTrain, trainState: 'Completed' }, options)).toBeNull();
    expect(normalizeAmtrakTrain({ ...activeTrain, lat: 39 }, options)).toBeNull();
  });

  it('labels predeparture coordinates estimated and ages them from fetch time', () => {
    const item = normalizeAmtrakTrain({
      ...activeTrain,
      trainState: 'Predeparture',
      updatedAt: null,
      lastValTS: '2026-08-19T19:00:00-04:00',
    }, options);
    expect(item.props).toMatchObject({
      dataStatus: 'estimated',
      stale: false,
      updatedAt: '2026-08-19T22:00:00.000Z',
      status: 'Scheduled to depart Washington Union',
    });
  });

  it('ages retained markers when a later feed poll fails', () => {
    const item = normalizeAmtrakTrain({
      ...activeTrain,
      lastValTS: '2026-08-19T17:59:00-04:00',
    }, options);
    expect(item.props.stale).toBe(false);
    const [aged] = ageAmtrakItems([item], options.now + 6 * 60_000, options.staleAfterMs);
    expect(aged.props.stale).toBe(true);
  });

  it('handles on-time, early, and malformed arrival estimates', () => {
    expect(delayLabel({ schArr: '2026-08-19T18:00:00Z', arr: '2026-08-19T18:01:00Z' })).toBe('on time');
    expect(delayLabel({ schArr: '2026-08-19T18:00:00Z', arr: '2026-08-19T17:55:00Z' })).toBe('5 min early');
    expect(delayLabel({ schArr: 'bad', arr: null })).toBe('');
  });
});
