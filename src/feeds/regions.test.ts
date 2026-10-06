import { beforeAll, describe, expect, it } from 'vitest';
import { registerRegions, smallestRegionAt, stateAt } from './regions.js';
import { regionFixture } from './test-fixtures.js';

beforeAll(() => registerRegions(regionFixture));

describe('stateAt', () => {
  it('names the state containing a point', () => {
    expect(stateAt([-71.2, 42.5])).toBe('ma');
    expect(stateAt([-71.5, 43.5])).toBe('nh');
  });

  it('is null outside every state', () => {
    expect(stateAt([-60, 40])).toBeNull();
  });
});

describe('smallestRegionAt', () => {
  it('prefers the narrowest region that contains the point', () => {
    expect(smallestRegionAt([-70.8, 42.55])).toBe('north-shore');
    expect(smallestRegionAt([-72, 42.3])).toBe('ma');
  });

  it('never returns the all-New-England union', () => {
    expect(smallestRegionAt([-71.5, 43.5])).toBe('nh');
  });

  it('is null where no region reaches', () => {
    expect(smallestRegionAt([-60, 40])).toBeNull();
  });
});
