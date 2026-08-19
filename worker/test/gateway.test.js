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
      providers: { aircraft: true, regionalTransit: true },
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

  it('does not attempt traffic requests without a configured key', async () => {
    const response = await call('/api/traffic/10/302/385.png');
    expect(response.status).toBe(503);
  });
});
