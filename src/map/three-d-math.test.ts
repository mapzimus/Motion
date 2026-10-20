import { describe, expect, it } from 'vitest';
import {
  altitudeMetres, headingRotation, localPosition, meshColor, originStale, shapeFor, sizeScale,
} from './three-d-math.js';

describe('3D vehicle helpers', () => {
  it('picks a mesh family per layer group', () => {
    expect(shapeFor('red')).toBe('train');
    expect(shapeFor('nyc-subway')).toBe('train');
    expect(shapeFor('commuter')).toBe('train');
    expect(shapeFor('bus')).toBe('bus');
    expect(shapeFor('silver')).toBe('bus');
    expect(shapeFor('ferry')).toBe('boat');
    expect(shapeFor('vessel')).toBe('boat');
    expect(shapeFor('plane')).toBe('plane');
    expect(shapeFor('bike')).toBe('bike');
    expect(shapeFor('mystery')).toBe('dot');
  });

  it('keeps meshes life-size at street zoom and grows them zoomed out', () => {
    expect(sizeScale(16)).toBe(1);
    expect(sizeScale(15.5)).toBe(1);
    expect(sizeScale(13.5)).toBe(4);
    expect(sizeScale(10.5)).toBe(32);
  });

  it('prefers the ground-aware map colors over the feed color', () => {
    expect(meshColor({ color: '#111111' })).toBe('#111111');
    expect(meshColor({ color: '#111111', routeColor: '#222222' })).toBe('#222222');
    expect(meshColor({ color: '#111111', routeColor: '#222222', mapColor: '#333333' })).toBe('#333333');
    expect(meshColor({ mapColor: '#333333', mapRouteColor: '#444444' })).toBe('#444444');
    expect(meshColor({})).toBe('#8a939c');
  });

  it('flies aircraft at their altitude and keeps everything else on the ground', () => {
    expect(altitudeMetres({ group: 'bus' })).toBe(0);
    expect(altitudeMetres({ group: 'plane', altitudeFeet: 10_000 })).toBeCloseTo(3000, 5);
    expect(altitudeMetres({ group: 'plane', altitudeFeet: 1_000 })).toBeCloseTo(304.8, 3);
    expect(altitudeMetres({ group: 'plane', altitudeFeet: null })).toBe(60);
    expect(altitudeMetres({ group: 'plane', altitudeFeet: 5_000, stale: true })).toBe(0);
  });

  it('places a point east and south of the origin in metres, y up', () => {
    const origin = { x: 0.3, y: 0.4 };
    const point = { x: 0.3 + 2e-6, y: 0.4 - 1e-6 };
    const [x, y, z] = localPosition(point, origin, 1e-7, 12);
    expect(x).toBeCloseTo(20, 6);
    expect(y).toBe(12);
    expect(z).toBeCloseTo(-10, 6);
  });

  it('turns a north-facing mesh clockwise to its bearing', () => {
    expect(headingRotation(0, true)).toBe(-0);
    expect(headingRotation(90, true)).toBeCloseTo(-Math.PI / 2, 9);
    expect(headingRotation(90, false)).toBe(0);
  });

  it('moves the origin only when the view is far from it', () => {
    expect(originStale(null, { x: 0, y: 0 }, 1e-7)).toBe(true);
    expect(originStale({ x: 0.3, y: 0.4 }, { x: 0.3 + 1e-3, y: 0.4 }, 1e-7)).toBe(false);
    expect(originStale({ x: 0.3, y: 0.4 }, { x: 0.3 + 5e-3, y: 0.4 }, 1e-7)).toBe(true);
  });
});
