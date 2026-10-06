import { describe, expect, it } from 'vitest';
import { feedIdFromRouteId, legendKeyForRouteFeature } from './legendKeys.js';

describe('feedIdFromRouteId', () => {
  it('takes the prefix before the first colon', () => {
    expect(feedIdFromRouteId('mbta-stations:749')).toBe('mbta');
    expect(feedIdFromRouteId('amtrak:88')).toBe('amtrak');
    expect(feedIdFromRouteId('metro-north:Hudson')).toBe('metro-north');
  });
  it('returns an empty string for junk', () => {
    expect(feedIdFromRouteId('')).toBe('');
    expect(feedIdFromRouteId(undefined)).toBe('');
  });
});

describe('legendKeyForRouteFeature', () => {
  it('maps the feature shapes', () => {
    expect(legendKeyForRouteFeature({ kind: 'mbta' })).toBe('mbta');
    expect(legendKeyForRouteFeature({ kind: 'regional-static', route: 'cttransit:5' })).toBe('cttransit');
    expect(legendKeyForRouteFeature({ kind: 'regional-station', routeIds: ['rta:9', 'rta:10'] })).toBe('rta');
  });
  it('returns "" for unknown shapes, never undefined', () => {
    expect(legendKeyForRouteFeature({})).toBe('');
    expect(legendKeyForRouteFeature(null)).toBe('');
    expect(legendKeyForRouteFeature({ kind: 'regional-station', routeIds: [] })).toBe('');
    expect(legendKeyForRouteFeature({ kind: 'regional-static' })).toBe('');
  });
});
