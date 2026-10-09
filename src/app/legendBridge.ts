// Keeps the map in step with the legend store. The route layers read opColor and
// routeColor from the features, so a palette change only needs the paint
// expression re-asserted; live vehicles have their color props rewritten.
import { effect } from '@preact/signals';
import { paletteAssignment, displayVehicleColors, viewportWanted, drillRequest } from '../stores/legend.js';
import { applyRoutePalette, refreshLegendFeeds, setDrillDown } from '../map/map.js';
import { recolorAllFleets } from '../feeds/fleet.js';

export function initLegendBridge(): () => void {
  const stopPalette = effect(() => {
    void paletteAssignment.value;
    applyRoutePalette();
    recolorAllFleets(displayVehicleColors);
  });
  // The map skips the viewport query while no route list can show (legend
  // collapsed or no route group on). When that turns true, by expanding the
  // legend or switching a route group on, ask for a fresh query right away.
  const stopRefresh = effect(() => {
    if (viewportWanted.value) refreshLegendFeeds();
  });
  // Clicks on the map key ask for a drill; this is what actually filters the map.
  const stopDrill = effect(() => {
    const request = drillRequest.value;
    if (!request) return;
    if (request.group) {
      setDrillDown(request.group, request.route ?? null, request.operator ?? null, request.operatorLabel ?? null);
    } else {
      setDrillDown(null);
    }
  });
  return () => { stopPalette(); stopRefresh(); stopDrill(); };
}
