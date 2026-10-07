// Satellite is USGS Imagery Only plus place names cut from CARTO Dark Matter.
// The other three basemaps are style URLs. A CARTO key, when set, is added
// on the request rather than baked into the style document.

import { withCartoKey } from '../feeds/carto.js';

export const DARK_MATTER_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const USGS_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
const USGS_CREDIT = 'Map services and data available from U.S. Geological Survey, National Geospatial Program';
const CARTO_GLYPHS = 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf';

/**
 * Imagery, muted the way the previous satellite style was, with Dark Matter's
 * place-name layers when that style could be read. Road names stay off so the
 * photo does not become a street map. No label style means imagery alone.
 */
export function satelliteStyle(labelStyle) {
  const layers = Array.isArray(labelStyle?.layers) ? labelStyle.layers : [];
  const places = layers.filter((layer) =>
    layer?.type === 'symbol' && typeof layer.id === 'string' && layer.id.startsWith('place_'));
  const carto = labelStyle?.sources?.carto;
  const style = {
    version: 8,
    glyphs: labelStyle?.glyphs || CARTO_GLYPHS,
    sources: {
      imagery: {
        type: 'raster',
        tiles: [USGS_TILES],
        tileSize: 256,
        maxzoom: 16,
        attribution: USGS_CREDIT,
      },
    },
    layers: [
      {
        id: 'imagery',
        type: 'raster',
        source: 'imagery',
        paint: { 'raster-saturation': -0.2, 'raster-brightness-max': 0.85 },
      },
    ],
  };
  if (places.length && carto) {
    if (labelStyle.sprite) style.sprite = labelStyle.sprite;
    style.sources.carto = carto;
    for (const layer of places) style.layers.push({ ...layer });
  }
  return style;
}

let satellitePromise = null;

async function loadSatelliteStyle() {
  let labelStyle = null;
  try {
    const response = await fetch(withCartoKey(DARK_MATTER_STYLE));
    if (response.ok) labelStyle = await response.json();
  } catch {
    labelStyle = null;
  }
  return satelliteStyle(labelStyle);
}

/** A style URL, or the satellite document. Satellite is fetched once per page. */
export function resolveBasemapStyle(basemap) {
  if (!basemap || basemap.key !== 'satellite') return Promise.resolve(basemap?.style);
  if (!satellitePromise) satellitePromise = loadSatelliteStyle();
  return satellitePromise;
}
