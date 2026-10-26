/// <reference types="geojson" />

import { CONFIG } from '../feeds/config.js';
import { fetchShapes } from '../feeds/api.js';
import { decodePolyline } from '../feeds/polyline.js';
import { groupFor } from '../feeds/mbta.js';
import { legendKeyForRouteFeature } from '../model/legendKeys.js';

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

/** Tag each feature with the legend operator key it is colored by. Mutates and returns the array. */
export function annotateLegendKeys(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  for (const feature of features) {
    const props = (feature.properties ??= {});
    props.legendKey = legendKeyForRouteFeature(props);
  }
  return features;
}

async function fetchJsonWithRetries(url: string, label: string): Promise<any> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: attempt === 1 ? 'default' : 'reload',
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`${label} ${response.status}`);
      return await response.json();
    } catch (error: any) {
      if (attempt === attempts) {
        console.warn(`${label} unavailable after retries:`, error.message);
        return null;
      }
      console.warn(`${label} retry ${attempt}/${attempts}:`, error.message);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  return null;
}

interface AreaEntry { key: string; file: string; features: number; bytes: number }

/**
 * The scheduled-route snapshot is one file per top-level area (state or
 * metro) under data/routes/, listed in index.json. The loader fetches only the
 * areas a view needs and keeps them; a route that touches several areas is in
 * each of their files and is deduped on `fid`.
 */
export function createRegionalRouteLoader() {
  const loaded = new Map<string, GeoJSON.Feature[]>();
  const pending = new Map<string, Promise<void>>();
  let indexPromise: Promise<AreaEntry[]> | null = null;

  const index = () => {
    if (!indexPromise) {
      indexPromise = fetchJsonWithRetries(CONFIG.REGIONAL_ROUTES_INDEX_URL, 'Scheduled route index')
        .then((payload) => (Array.isArray(payload?.areas) ? payload.areas as AreaEntry[] : []));
    }
    return indexPromise;
  };

  const loadArea = (area: AreaEntry) => {
    if (loaded.has(area.key)) return Promise.resolve();
    if (!pending.has(area.key)) {
      pending.set(area.key, fetchJsonWithRetries(`${CONFIG.REGIONAL_ROUTES_DIR}${area.file}`, `Scheduled routes (${area.key})`)
        .then((collection) => {
          loaded.set(area.key, Array.isArray(collection?.features) ? annotateLegendKeys(collection.features) : []);
        })
        .finally(() => pending.delete(area.key)));
    }
    return pending.get(area.key)!;
  };

  /** Every loaded feature, deduped on fid. */
  const features = () => {
    const seen = new Set<unknown>();
    const out: GeoJSON.Feature[] = [];
    for (const list of loaded.values()) {
      for (const feature of list) {
        const fid = feature.properties?.fid;
        if (fid !== undefined && seen.has(fid)) continue;
        seen.add(fid);
        out.push(feature);
      }
    }
    return out;
  };

  return {
    /** Make sure these areas are loaded; resolves to every loaded feature. */
    async ensure(areaKeys: readonly string[]): Promise<GeoJSON.Feature[]> {
      const areas = await index();
      const wanted = areas.filter((area) => areaKeys.includes(area.key));
      await Promise.all(wanted.map(loadArea));
      return features();
    },
    features,
  };
}

/** Legend label for an MBTA route: the bus number, else the long name. */
function routeName(set: ShapeSet, info: RouteEntry | undefined): string {
  const short = info?.shortName as string | undefined;
  const long = info?.longName as string | undefined;
  return (set.group === 'bus' ? short || long : long || short) || set.id;
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
          name: routeName(set, routeInfo.get(set.id)),
          group: set.group,
          color: set.color,
          kind: 'mbta',
          legendKey: 'mbta',
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
