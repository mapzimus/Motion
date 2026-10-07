import { describe, expect, it } from 'vitest';
import {
  iconPointFeatures,
  parseVtransPlows,
  roadDetailFromTooltip,
  validRoadDetail,
} from '../src/road-extras';

const OPTIONS = {
  providerKey: 'north',
  provider: 'New England 511',
  catalog: 'WeatherStations',
  group: 'road-weather',
  color: '#7ec8e3',
  title: 'Road weather station',
  status: 'Click for the latest reading',
  sourceUrl: 'https://newengland511.org/',
  updatedAt: '2026-10-06T22:00:00.000Z',
};

const WEATHER_HTML = `
<div class="map-tooltip">
  <table><tr><td><b>I-89 BERLIN</b></td></tr></table>
  <table>
    <tr><td class="tooltipHeaders">Air Temperature</td><td>46.8 °F</td></tr>
    <tr><td class="tooltipHeaders">Visibility</td><td>N/A</td></tr>
    <tr><td class="tooltipHeaders">Wind Speed</td><td>0.4 mph</td></tr>
    <tr><td class="tooltipHeaders">Wind Direction</td><td>Northwest</td></tr>
    <tr><td class="tooltipHeaders">Surface Temperature</td><td>52.7 °F</td></tr>
    <tr><td class="tooltipHeaders">Last Updated</td><td>Oct 6 2026, 6:32 PM</td></tr>
  </table>
</div>`;

const SIGN_HTML = `
<div class="map-tooltip">
  <table>
    <tr><td><b>I-295 Mile 02 NB</b></td></tr>
    <tr><td class="msgContent"><div></div></td></tr>
  </table>
</div>`;

describe('road weather and message signs', () => {
  it('keeps numbered icons inside New England and drops the null island pair', () => {
    const features = iconPointFeatures([
      { itemId: '3000', location: [44.47, -71.18] },
      { itemId: '1', location: [0, 0] },
      { itemId: 'nope', location: [44.2, -71.1] },
    ], OPTIONS);
    expect(features).toHaveLength(1);
    expect(features[0].geometry.coordinates).toEqual([-71.18, 44.47]);
    expect(features[0].properties).toMatchObject({
      group: 'road-weather',
      itemId: '3000',
      catalog: 'WeatherStations',
      providerKey: 'north',
    });
  });

  it('reads a weather-station tooltip without the empty fields', () => {
    const detail = roadDetailFromTooltip(WEATHER_HTML, 'WeatherStations');
    expect(detail.title).toBe('I-89 BERLIN');
    expect(detail.status).toBe('Air 46.8 °F · Wind Speed 0.4 mph · Wind Direction Northwest · Surface 52.7 °F');
    expect(detail.details).not.toContain('N/A');
    expect(detail.updatedAt).toBe(new Date('Oct 6 2026, 6:32 PM').toISOString());
  });

  it('treats a blank message sign as no message posted', () => {
    const detail = roadDetailFromTooltip(SIGN_HTML, 'MessageSigns');
    expect(detail.title).toBe('I-295 Mile 02 NB');
    expect(detail.status).toBe('No message posted');
  });

  it('rejects a road-detail request that is not a known catalog and id', () => {
    expect(validRoadDetail('WeatherStations', 'north', '3000')).toBe(true);
    expect(validRoadDetail('Cameras', 'north', '3000')).toBe(false);
    expect(validRoadDetail('MessageSigns', 'flock', '1')).toBe(false);
    expect(validRoadDetail('MessageSigns', 'ct', '12a')).toBe(false);
  });
});

describe('Vermont plow trucks', () => {
  it('treats an empty winter file as no trucks', () => {
    expect(parseVtransPlows([{}])).toEqual([]);
    expect(parseVtransPlows([])).toEqual([]);
  });

  it('plots the first breadcrumb as longitude, latitude', () => {
    const [feature] = parseVtransPlows([{
      id: 'D12',
      name: 'D12',
      heading: 90,
      coords: [[44.26, -72.58, 1_700_000_000_000], [44.25, -72.57, 1_699_999_000_000]],
    }]);
    expect(feature.geometry.coordinates).toEqual([-72.58, 44.26]);
    expect(feature.properties).toMatchObject({
      group: 'plow',
      title: 'Plow D12',
      status: 'Heading 90°',
      dataStatus: 'live',
    });
    expect(feature.properties.updatedAt).toBe('2023-11-14T22:13:20.000Z');
  });
});
