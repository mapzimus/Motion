import { createExecutionContext, env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { cameraImageUrl, constructionProjectFeatures } from '../src/index';

const call = (path, init) =>
  exports.default.fetch(new Request(`http://motion.test${path}`, init));

describe('Motion gateway', () => {
  it('reports provider configuration without exposing secrets', async () => {
    const response = await call('/health');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      service: 'Motion gateway',
      status: 'ok',
      providers: {
        regionalTransit: true,
        metroNorth: true,
        roadEvents: true,
        cameras: true,
        roadWeather: true,
        messageSigns: true,
        plows: true,
        traffic: true,
        airportStatus: true,
        weatherAlerts: true,
        airportWeather: true,
        tfrs: true,
      },
    });
    // Aircraft come from the Vercel relay, not this Worker.
    expect(body.providers).not.toHaveProperty('aircraft');
    expect(JSON.stringify(body)).not.toContain('API_KEY');
  });

  it('no longer serves the retired Worker aircraft endpoint', async () => {
    const response = await call('/api/planes?region=ma');
    expect(response.status).toBe(404);
  });

  it('validates weather-alert regions before calling NWS', async () => {
    const response = await call('/api/weather-alerts?region=california');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Unknown region' });
  });

  it('validates airport TAF station ids before calling AviationWeather.gov', async () => {
    for (const id of ['', 'bos', 'KBOSX', 'KB%26S', '..%2Fx']) {
      const response = await call(`/api/airport-taf?id=${id}`);
      expect(response.status, id).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'Invalid station id' });
    }
    expect((await call('/api/airport-taf')).status).toBe(400);
  });

  it('validates TFR NOTAM ids before calling the FAA', async () => {
    for (const id of ['', '6-7153', '6%2F7153%26x%3D1', 'abc']) {
      const response = await call(`/api/tfr-detail?id=${id}`);
      expect(response.status, id).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'Invalid NOTAM id' });
    }
  });

  it('rejects browser origins outside the allowlist', async () => {
    const response = await call('/health', {
      headers: { origin: 'https://example.net' },
    });
    expect(response.status).toBe(403);
  });

  it('returns CORS headers to an allowed local frontend', async () => {
    const response = await call('/health', {
      headers: { origin: 'http://localhost:5500' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:5500',
    );
  });

  it('validates regional feed requests before calling providers', async () => {
    const response = await call('/api/transit?region=california');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Unknown region' });
  });

  it('relays the public 511 traffic tiles without a commercial key', async () => {
    const response = await call('/api/traffic/10/302/385.png');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
  });

  it('validates camera detail requests before calling providers', async () => {
    const response = await call('/api/camera-detail?provider=flock&id=secret');
    expect(response.status).toBe(400);
  });

  it('validates road-detail requests before calling 511', async () => {
    const response = await call('/api/road-detail?catalog=Cameras&provider=north&id=1');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid road detail request' });
  });
});

// The AIS key is a secret, so these call the module directly with a patched
// env instead of going through the configured worker. No socket is opened:
// every case is rejected before the WebSocketPair is created.
describe('AIS relay', () => {
  const callWith = (path, extraEnv, init) =>
    worker.fetch(
      new Request(`http://motion.test${path}`, init),
      { ...env, ...extraEnv },
      createExecutionContext(),
    );
  const upgrade = { headers: { upgrade: 'websocket' } };

  it('still offers the vessel relay when no AISStream key is configured', async () => {
    const response = await callWith('/api/ais?region=ma', { AISSTREAM_API_KEY: undefined });
    expect(response.status).toBe(426);
    expect(response.headers.get('upgrade')).toBe('websocket');
  });

  it('treats a placeholder key as unset and still offers the relay', async () => {
    const response = await callWith('/api/ais?region=ma', { AISSTREAM_API_KEY: 'replace-me' });
    expect(response.status).toBe(426);
  });

  it('requires a WebSocket upgrade once a key is set', async () => {
    const response = await callWith('/api/ais?region=ma', { AISSTREAM_API_KEY: 'test-key' });
    expect(response.status).toBe(426);
    expect(response.headers.get('upgrade')).toBe('websocket');
  });

  it('validates the region before opening any socket', async () => {
    const response = await callWith('/api/ais?region=california', { AISSTREAM_API_KEY: 'test-key' }, upgrade);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Unknown region' });
  });

  it('reflects AIS key presence in /health without leaking it', async () => {
    const without = await (await callWith('/health', { AISSTREAM_API_KEY: undefined })).json();
    expect(without.providers.ais).toBe(true);
    const withKey = await (await callWith('/health', { AISSTREAM_API_KEY: 'test-key-123' })).json();
    expect(withKey.providers.ais).toBe(true);
    expect(JSON.stringify(withKey)).not.toContain('test-key-123');
  });
});

describe('keyless road and camera feeds', () => {
  it('encodes spaces in a RIDOT camera still URL', () => {
    expect(cameraImageUrl(
      'https://www.dot.ri.gov/img/travel/camimages/95_42.4_N_CAM - Broadway (Pawt).jpg',
    )).toBe(
      'https://www.dot.ri.gov/img/travel/camimages/95_42.4_N_CAM%20-%20Broadway%20(Pawt).jpg',
    );
    expect(cameraImageUrl('not a url')).toBe('');
  });

  it('keeps only CTDOT construction-phase polygons and does not call them work zones', () => {
    const features = constructionProjectFeatures([
      {
        geometry: { type: 'Polygon', coordinates: [[[-72.6, 41.7], [-72.5, 41.7], [-72.5, 41.8], [-72.6, 41.7]]] },
        properties: {
          ProjectNumber: '0172-0001',
          Title: 'Bridge replacement',
          ProjectDescription: 'Replace the span',
          CurrentSchedulePhase: '05_Construction',
        },
      },
      {
        geometry: { type: 'Polygon', coordinates: [[[-72.6, 41.7], [-72.5, 41.7], [-72.5, 41.8], [-72.6, 41.7]]] },
        properties: { ProjectNumber: '0001', Title: 'Still planning', CurrentSchedulePhase: '01_Planning' },
      },
      {
        geometry: { type: 'LineString', coordinates: [[-72.6, 41.7], [-72.5, 41.8]] },
        properties: { CurrentSchedulePhase: '05_Construction', Title: 'Not a polygon' },
      },
    ]);
    expect(features).toHaveLength(1);
    expect(features[0].properties).toMatchObject({
      kind: 'construction-project',
      status: 'Construction project',
      title: 'Bridge replacement',
      dataStatus: 'reference',
      provider: 'CTDOT active capital projects · construction phase',
    });
    expect(JSON.stringify(features)).not.toMatch(/work zone/i);
  });
});
