import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../map/map.js', () => ({ applyRoutePalette: vi.fn(), refreshLegendFeeds: vi.fn() }));
vi.mock('../feeds/fleet.js', () => ({ recolorAllFleets: vi.fn() }));

import { initLegendBridge } from './legendBridge.js';
import { refreshLegendFeeds } from '../map/map.js';
import { setLegendCollapsed } from '../stores/legend.js';
import { setVisibleGroupList } from '../stores/layers.js';

describe('legend bridge', () => {
  let stop: () => void;

  beforeEach(() => {
    setLegendCollapsed(false);
    setVisibleGroupList(['plane']);
    stop = initLegendBridge();
    vi.mocked(refreshLegendFeeds).mockClear();
  });

  afterEach(() => stop());

  it('refreshes the legend feeds when a route group switches on', () => {
    setVisibleGroupList(['plane', 'bus']);
    expect(refreshLegendFeeds).toHaveBeenCalledTimes(1);
  });

  it('refreshes when the legend expands with a route group on', () => {
    setVisibleGroupList(['bus']);
    setLegendCollapsed(true);
    vi.mocked(refreshLegendFeeds).mockClear();
    setLegendCollapsed(false);
    expect(refreshLegendFeeds).toHaveBeenCalledTimes(1);
  });

  it('does not refresh for groups the route list ignores', () => {
    setVisibleGroupList(['plane', 'vessel']);
    expect(refreshLegendFeeds).not.toHaveBeenCalled();
  });
});
