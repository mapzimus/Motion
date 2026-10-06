import { describe, expect, it } from 'vitest';
import { regionalVehicleItem } from './regional-normalize.js';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const OPTS = { ferryFeeds: ['casco-bay'], busColor: '#f2b84b', ferryColor: '#2eb7c5', staleAfterMs: 120_000 };
const bus = {
  id: 'v1', feed: 'cj', agency: 'C&J', route: 'boston-south-station', label: '42',
  lng: -71.1, lat: 42.3, bearing: 90, speedMps: 10, updatedAt: '2026-10-05T11:59:30Z',
};

describe('regionalVehicleItem', () => {
  it('keys a bus by its feed and labels it with the agency', () => {
    const item = regionalVehicleItem(bus, NOW, OPTS);
    expect(item.id).toBe('regional-v1');
    expect(item.props.group).toBe('bus');
    expect(item.props.legendKey).toBe('cj');
    expect(item.props.legendLabel).toBe('C&J');
    expect(item.props.modeColor).toBe('#f2b84b');
    expect(item.props.color).toBe('#f2b84b');
  });

  it('builds the shade key the static route features use', () => {
    expect(regionalVehicleItem(bus, NOW, OPTS).props.shadeKey).toBe('cj:boston-south-station');
    expect(regionalVehicleItem({ ...bus, route: '' }, NOW, OPTS).props.shadeKey).toBe('');
  });

  it('treats ferry feeds as ferries with the ferry mode color', () => {
    const item = regionalVehicleItem({ ...bus, feed: 'casco-bay', agency: 'Casco Bay Lines', route: 'DB' }, NOW, OPTS);
    expect(item.props.group).toBe('ferry');
    expect(item.props.modeColor).toBe('#2eb7c5');
    expect(item.props.legendKey).toBe('casco-bay');
    expect(item.props.shadeKey).toBe('casco-bay:DB');
  });

  it('keeps the popup fields and staleness', () => {
    const item = regionalVehicleItem(bus, NOW, OPTS);
    expect(item.props.title).toBe('C&J · boston-south-station');
    expect(item.props.status).toBe('22 mph');
    expect(item.props.stale).toBe(false);
    expect(regionalVehicleItem({ ...bus, updatedAt: '2026-10-05T11:00:00Z' }, NOW, OPTS).props.stale).toBe(true);
    expect(item.detail).toEqual({ label: '42', routeName: 'boston-south-station', agency: 'C&J' });
  });
});
