import { describe, expect, it, vi } from 'vitest';

const { setFleetData } = vi.hoisted(() => ({ setFleetData: vi.fn() }));
vi.mock('../map/map.js', () => ({ setFleetData }));
vi.mock('./regions.js', () => ({ filterItems: (items: unknown[]) => items, fleetBoundaryOptions: () => ({}) }));

import { createFleet, recolorAllFleets } from './fleet.js';

const item = (id: string, props: Record<string, unknown>) => ({ id, lng: -71, lat: 42, props });

describe('fleet.recolor', () => {
  it('rewrites colors in place, re-renders and notifies once when something changed', () => {
    const fleet = createFleet('test-a');
    fleet.update([item('a', { group: 'bus', color: '#111111' }), item('b', { group: 'red', color: '#da291c' })]);
    const onUpdate = vi.fn();
    fleet.onUpdate(onUpdate);
    setFleetData.mockClear();

    const changed = fleet.recolor((p: any) => (p.group === 'bus' ? { color: '#222222', routeColor: '#333333' } : null));

    expect(changed).toBe(true);
    expect(fleet.getItem('a').props).toMatchObject({ color: '#222222', routeColor: '#333333' });
    expect(fleet.getItem('b').props.color).toBe('#da291c');
    expect(setFleetData).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the colors already match', () => {
    const fleet = createFleet('test-b');
    fleet.update([item('a', { group: 'bus', color: '#222222', routeColor: '#333333' })]);
    const onUpdate = vi.fn();
    fleet.onUpdate(onUpdate);
    setFleetData.mockClear();

    expect(fleet.recolor(() => ({ color: '#222222', routeColor: '#333333' }))).toBe(false);
    expect(setFleetData).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('recolorAllFleets reaches every registered fleet', () => {
    const fleet = createFleet('test-c');
    fleet.update([item('a', { group: 'ferry', color: '#2eb7c5' })]);
    recolorAllFleets(() => ({ color: '#00b3a3', routeColor: '#00b3a3' }));
    expect(fleet.getItem('a').props.color).toBe('#00b3a3');
  });
});
