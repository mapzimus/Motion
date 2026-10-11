import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../map/map.js', () => ({
  applyRoutePalette: vi.fn(),
  refreshLegendFeeds: vi.fn(),
  setDrillDown: vi.fn(),
}));
vi.mock('../feeds/fleet.js', () => ({ recolorAllFleets: vi.fn() }));

import { initLegendBridge } from './legendBridge.js';
import { refreshLegendFeeds } from '../map/map.js';
import { drillRequest } from '../stores/legend.js';
import { setVisibleGroupList } from '../stores/layers.js';

describe('legend bridge', () => {
  let stop: () => void;

  beforeEach(() => {
    drillRequest.value = null;
    setVisibleGroupList(['plane']);
    stop = initLegendBridge();
    vi.mocked(refreshLegendFeeds).mockClear();
  });

  afterEach(() => stop());

  it('refreshes the legend feeds when a route group switches on', () => {
    setVisibleGroupList(['plane', 'bus']);
    expect(refreshLegendFeeds).toHaveBeenCalledTimes(1);
  });

  it('does not refresh for groups the route list ignores', () => {
    setVisibleGroupList(['plane', 'vessel']);
    expect(refreshLegendFeeds).not.toHaveBeenCalled();
  });
});
