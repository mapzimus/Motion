import { describe, expect, it } from 'vitest';
import { vehicleColors } from './vehicleColors.js';
import { routeShade } from './palette.js';

const colorFor = (group: string, key: string, fallback: string) =>
  group === 'bus' && key === 'cj' ? '#5c88df' : fallback;
const routeCountFor = (_group: string, key: string) => (key === 'cj' ? 4 : 0);

describe('vehicleColors', () => {
  it('colors a palette-group vehicle by operator and shades it by route', () => {
    const c = vehicleColors({ group: 'bus', legendKey: 'cj', modeColor: '#f2b84b', shadeKey: 'cj:1' }, colorFor, routeCountFor);
    expect(c).toEqual({ color: '#5c88df', routeColor: routeShade('#5c88df', 'cj:1', 4) });
    expect(c!.routeColor).not.toBe('#5c88df');
  });

  it('falls back to the mode color, then the current color', () => {
    expect(vehicleColors({ group: 'bus', legendKey: 'x', modeColor: '#111111', color: '#222222' }, colorFor, routeCountFor)!.color).toBe('#111111');
    expect(vehicleColors({ group: 'bus', legendKey: 'x', color: '#222222' }, colorFor, routeCountFor)!.color).toBe('#222222');
  });

  it('uses the operator color as the route color without a shade key', () => {
    expect(vehicleColors({ group: 'bus', legendKey: 'cj', modeColor: '#f2b84b' }, colorFor, routeCountFor))
      .toEqual({ color: '#5c88df', routeColor: '#5c88df' });
  });

  it('leaves non-palette groups and keyless vehicles alone', () => {
    expect(vehicleColors({ group: 'red', legendKey: 'mbta', color: '#da291c' }, colorFor, routeCountFor)).toBeNull();
    expect(vehicleColors({ group: 'vessel', legendKey: 'cargo', color: '#8fd16b' }, colorFor, routeCountFor)).toBeNull();
    expect(vehicleColors({ group: 'bus', color: '#f2b84b' }, colorFor, routeCountFor)).toBeNull();
  });
});
