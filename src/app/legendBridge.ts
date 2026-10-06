// Keeps the map in step with the legend store. The route layers read opColor and
// routeColor from the features, so a palette change only needs the paint
// expression re-asserted. Fleet recoloring joins this effect later.
import { effect } from '@preact/signals';
import { paletteAssignment } from '../stores/legend.js';
import { applyRoutePalette } from '../map/map.js';

export function initLegendBridge(): () => void {
  return effect(() => {
    void paletteAssignment.value;
    applyRoutePalette();
  });
}
