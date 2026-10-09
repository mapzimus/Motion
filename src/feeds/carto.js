// Optional CARTO basemap key. A build env wins; otherwise the gateway may
// hand one to an allowed origin. Unset, the vector styles load as they do
// without a key. Never commit a real key.

let cartoKey = '';

/** True for a real key. Placeholders in example env files count as unset. */
export function usableCartoKey(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('placeholder')
    && !value.startsWith('replace-');
}

export function setCartoKey(value) {
  cartoKey = usableCartoKey(value) ? value : '';
}

export function getCartoKey() {
  return cartoKey;
}

/** Append `key` to a basemaps.cartocdn.com URL. Other hosts are unchanged. */
export function withCartoKey(url) {
  if (!cartoKey || typeof url !== 'string') return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname;
  if (host !== 'basemaps.cartocdn.com' && !host.endsWith('.basemaps.cartocdn.com')) return url;
  if (parsed.searchParams.has('key')) return url;
  parsed.searchParams.set('key', cartoKey);
  return parsed.toString();
}

/**
 * Use a build-time key when one is set. Otherwise ask the gateway, which
 * only answers an allowed origin. Failure leaves the key unset.
 */
export async function ensureCartoKey(gatewayBase) {
  const built = import.meta.env?.VITE_CARTO_API_KEY;
  if (usableCartoKey(built)) {
    setCartoKey(built);
    return;
  }
  if (!gatewayBase) return;
  try {
    const response = await fetch(`${gatewayBase}/api/basemap-key`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    const body = await response.json();
    setCartoKey(body?.key);
  } catch {
    // Vector styles still load without a key.
  }
}
