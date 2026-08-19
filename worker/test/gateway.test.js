import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

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
        aircraft: true,
        regionalTransit: true,
        metroNorth: true,
        roadEvents: true,
        cameras: true,
        traffic: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain('API_KEY');
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
});
