// Keeps the map in step with the legend store. The route layers read opColor and
// routeColor from the features, so a palette change only needs the paint
// expression re-asserted; live vehicles have their color props rewritten.
import { effect } from '@preact/signals';
import { paletteAssignment, liveVehicleColors, legendCollapsed } from '../stores/legend.js';
import { applyRoutePalette, refreshLegendFeeds } from '../map/map.js';
import { recolorAllFleets } from '../feeds/fleet.js';

export function initLegendBridge(): () => void {
  const stopPalette = effect(() => {
    void paletteAssignment.value;
    applyRoutePalette();
    recolorAllFleets(liveVehicleColors);
  });
  // The map skips the viewport query while the legend is collapsed, so
  // expanding it asks for a fresh one.
  const stopRefresh = effect(() => {
    if (!legendCollapsed.value) refreshLegendFeeds();
  });
  return () => { stopPalette(); stopRefresh(); };
}
