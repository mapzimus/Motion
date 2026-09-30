// Shape loading: MBTA polyline ribbons and regional route GeoJSON.
// Extracted from js/app.js (lines 223-314).

import { CONFIG } from '../feeds/config.js';
import { fetchShapes } from '../feeds/api.js';
import { decodePolyline } from '../feeds/polyline.js';
import { groupFor } from '../feeds/mbta.js';

interface RouteEntry {
  id: string;
  color?: string;
  [key: string]: unknown;
}

interface ShapeSet {
  id: string;
  group: string;
  color: string;
  polylines: string[];
}

/**
 * Fetch regional-routes.geojson with retries.
 */
export async function loadRegionalRouteFeatures(): Promise<GeoJSON.Feature[]> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(CONFIG.REGIONAL_ROUTE_URL, {
        cache: attempt === 1 ? 'default' : 'reload',
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`regional routes ${response.status}`);
      const collection = await response.json();
      if (!Array.isArray(collection.features) || !collection.features.length) {
        throw new Error('regional routes contained no features');
      }
      return collection.features;
    } catch (error: any) {
      if (attempt === attempts) {
        console.warn('Scheduled regional route ribbons unavailable after retries:', error.message);
        return [];
      }
      console.warn(`Scheduled regional route ribbons retry ${attempt}/${attempts}:`, error.message);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  return [];
}

/**
 * Fetch MBTA shape polylines for all routes, with localStorage caching.
 */
export async function loadShapeFeatures(
  ribbonRoutes: RouteEntry[],
  routeInfo: Map<string, RouteEntry>,
): Promise<GeoJSON.Feature[]> {
  localStorage.removeItem('bim-shapes-v2'); // superseded cache format
  const routesKey = ribbonRoutes.map((r) => r.id).join(',');

  const buildFeatures = (sets: ShapeSet[]) =>
    sets.flatMap((set) =>
      set.polylines.map((polyline) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: decodePolyline(polyline) },
        properties: {
          route: set.id,
          group: set.group,
          color: set.color,
          kind: 'mbta',
          dataStatus: 'scheduled',
          provider: 'MBTA static route geometry',
        },
      })),
    );

  try {
    const cached = JSON.parse(localStorage.getItem(CONFIG.SHAPE_CACHE_KEY)!);
    if (
      cached &&
      cached.routes === routesKey &&
      Date.now() - cached.at < CONFIG.SHAPE_CACHE_TTL_MS
    ) {
      return buildFeatures(cached.sets);
    }
  } catch {
    /* corrupt cache -> refetch */
  }

  const settled = await Promise.allSettled(
    ribbonRoutes.map(async (r) => ({
      id: r.id,
      group: groupFor(r.id, routeInfo.get(r.id)),
      color: routeInfo.get(r.id)?.color ?? '#8a939c',
      polylines: await fetchShapes(r.id),
    })),
  );
  const failed = ribbonRoutes.filter((_, i) => settled[i].status === 'rejected');
  if (failed.length) {
    console.warn(
      `Route ribbons unavailable this load: ${failed.map((r) => r.id).join(', ')}`,
    );
  }
  const sets = settled
    .filter((s): s is PromiseFulfilledResult<ShapeSet> => s.status === 'fulfilled')
    .map((s) => s.value);

  if (!failed.length) {
    try {
      localStorage.setItem(
        CONFIG.SHAPE_CACHE_KEY,
        JSON.stringify({ at: Date.now(), routes: routesKey, sets }),
      );
    } catch {
      /* storage full/blocked -> fine, just refetch next time */
    }
  }
  return buildFeatures(sets);
}
