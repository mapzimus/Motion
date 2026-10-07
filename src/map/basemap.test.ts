import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../feeds/config.js';
import { getCartoKey, setCartoKey, usableCartoKey, withCartoKey } from '../feeds/carto.js';
import { satelliteStyle } from './basemap.js';

afterEach(() => setCartoKey(''));

describe('CARTO key', () => {
  it('treats a missing or placeholder key as unset', () => {
    expect(usableCartoKey(undefined)).toBe(false);
    expect(usableCartoKey('')).toBe(false);
    expect(usableCartoKey('replace-with-carto-key')).toBe(false);
    expect(usableCartoKey('placeholder-key')).toBe(false);
    expect(usableCartoKey('carto-live-key')).toBe(true);
  });

  it('adds the key only to CARTO basemap hosts', () => {
    setCartoKey('carto-live-key');
    expect(getCartoKey()).toBe('carto-live-key');
    const style = withCartoKey('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json');
    expect(style).toBe('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json?key=carto-live-key');
    const tile = withCartoKey('https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/10/300/400.mvt');
    expect(tile).toContain('key=carto-live-key');
    expect(withCartoKey(style)).toBe(style);
    expect(withCartoKey('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/8/1/2'))
      .not.toContain('key=');
    setCartoKey('replace-with-carto-key');
    expect(getCartoKey()).toBe('');
    expect(withCartoKey('https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'))
      .toBe('https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json');
  });
});

describe('BASEMAPS', () => {
  it('offers Dark, Light, Dark without labels, and Satellite', () => {
    expect(CONFIG.BASEMAPS.map((basemap) => basemap.key)).toEqual(['dark', 'light', 'dark-plain', 'satellite']);
    expect(CONFIG.BASEMAPS.map((basemap) => basemap.label)).toEqual(['Dark', 'Light', 'Dark, no labels', 'Satellite']);
    expect(CONFIG.BASEMAPS.map((basemap) => basemap.ground)).toEqual(['dark', 'light', 'dark', 'imagery']);
    expect(CONFIG.BASEMAPS[0].style).toContain('dark-matter-gl-style');
    expect(CONFIG.BASEMAPS[1].style).toContain('positron-gl-style');
    expect(CONFIG.BASEMAPS[2].style).toContain('dark-matter-nolabels-gl-style');
    expect(CONFIG.BASEMAPS[3].style).toBeUndefined();
    expect(JSON.stringify(CONFIG.BASEMAPS)).not.toMatch(/arcgisonline|mapbox|maptiler|stadiamaps/i);
  });
});

interface BuiltStyle {
  sprite?: string;
  sources: {
    imagery: { tiles: string[]; attribution: string };
    carto?: { type: string; url: string };
  };
  layers: Array<{ id: string; paint?: { 'raster-saturation': number; 'raster-brightness-max': number } }>;
}

describe('satelliteStyle', () => {
  const labelStyle = {
    glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite',
    sources: { carto: { type: 'vector', url: 'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json' } },
    layers: [
      { id: 'background', type: 'background' },
      { id: 'road', type: 'line', source: 'carto' },
      { id: 'place_city', type: 'symbol', source: 'carto' },
      { id: 'roadname_major', type: 'symbol', source: 'carto' },
      { id: 'place_state', type: 'symbol', source: 'carto' },
    ],
  };

  it('mutes USGS imagery and keeps only Dark Matter place names', () => {
    const style = satelliteStyle(labelStyle) as BuiltStyle;
    expect(style.sources.imagery.tiles[0]).toContain('USGSImageryOnly');
    expect(style.sources.imagery.attribution).toContain('U.S. Geological Survey');
    expect(style.layers[0].paint).toEqual({ 'raster-saturation': -0.2, 'raster-brightness-max': 0.85 });
    expect(style.layers.slice(1).map((layer) => layer.id)).toEqual(['place_city', 'place_state']);
    expect(style.sources.carto).toBe(labelStyle.sources.carto);
    expect(style.sprite).toBe(labelStyle.sprite);
    expect(JSON.stringify(style)).not.toMatch(/arcgisonline|esri/i);
  });

  it('drops the place-name layer when the labels cut has no tiles', () => {
    const style = satelliteStyle(null) as BuiltStyle;
    expect(style.layers.map((layer) => layer.id)).toEqual(['imagery']);
    expect(style.sources.carto).toBeUndefined();
    expect(style.sprite).toBeUndefined();
  });
});
