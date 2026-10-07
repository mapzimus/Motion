import { describe, expect, it } from 'vitest';
import { groupFor, titleFor } from './mbta.js';

describe('MBTA rail-replacement buses', () => {
  it('paints an unlisted Shuttle route as a bus', () => {
    expect(groupFor('Shuttle-Generic', undefined)).toBe('bus');
    expect(groupFor('Shuttle-Generic-CommuterRail', undefined)).toBe('bus');
    expect(titleFor('bus', 'Shuttle-Generic', undefined)).toBe('Rail replacement bus');
    expect(titleFor('bus', 'Shuttle-Generic-CommuterRail', { shortName: 'Shuttle', type: 3 })).toBe('Rail replacement bus');
  });

  it('still classifies a listed bus and a subway line', () => {
    expect(groupFor('1', { type: 3, shortName: '1' })).toBe('bus');
    expect(titleFor('bus', '1', { type: 3, shortName: '1' })).toBe('Bus 1');
    expect(groupFor('Red', undefined)).toBe('red');
  });
});
