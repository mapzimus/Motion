// Keeps the map in step with the legend store. The route layers read opColor and
// routeColor from the features, so a palette change only needs the paint
// expression re-asserted; live vehicles have their color props rewritten.
import { effect } from '@preact/signals';
import { paletteAssignment, liveVehicleColors } from '../stores/legend.js';
import { applyRoutePalette } from '../map/map.js';
import { recolorAllFleets } from '../feeds/fleet.js';

export function initLegendBridge(): () => void {
  return effect(() => {
    void paletteAssignment.value;
    applyRoutePalette();
    recolorAllFleets(liveVehicleColors);
  });
}
