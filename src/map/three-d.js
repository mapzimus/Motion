// 3D mode: CARTO building footprints raised to their recorded heights as
// fill extrusions, and every live vehicle drawn as a Three.js mesh in a
// MapLibre custom layer that shares the map camera and depth buffer, so a
// train passes behind a tower instead of over it.
//
// Three.js is loaded only when 3D is first switched on. The scene lives in a
// local metre frame around an origin near the view (Mercator units are too
// small for 32-bit floats across a whole state); the origin moves when the
// view wanders far from it.

import * as maplibregl from 'maplibre-gl';
import {
  SHAPES, altitudeMetres, headingRotation, localPosition, meshColor, originStale, shapeFor, sizeScale,
} from './three-d-math.js';

export const BUILDINGS_LAYER_ID = 'buildings-3d';
export const VEHICLES_LAYER_ID = 'vehicles-3d';
const STORAGE_KEY = 'motion-3d';
const BUILDING_SOURCE = 'carto';
const BUILDING_SOURCE_LAYER = 'building';

export function initialThreeD() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('3d')) return params.get('3d') !== '0';
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persist(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Private mode: keeping it for this visit is enough.
  }
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.set('3d', '1');
  else url.searchParams.delete('3d');
  history.replaceState(null, '', url);
}

function firstSymbolLayer(map) {
  return map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id;
}

function buildingPaint(ground) {
  const light = ground === 'light';
  return {
    'fill-extrusion-color': light ? '#d7dbe0' : '#2b3139',
    'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
    'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
    'fill-extrusion-opacity': 0.92,
    'fill-extrusion-vertical-gradient': true,
  };
}

/**
 * Creates the 3D controller for a map. `fleetIds` are the vehicle fleets whose
 * 2D icon layers are hidden while 3D is on; `activeGround` reports the
 * current basemap ground ('dark', 'light', 'imagery').
 */
export function createThreeD(map, { fleetIds, activeGround }) {
  let enabled = false;
  let three = null; // the three.js module, once loaded
  let scene = null;
  let renderer = null;
  let camera = null;
  let origin = null; // MercatorCoordinate of the local frame
  let metresPerUnit = 1;
  const fleets = new Map(); // fleetId -> FeatureCollection (region-filtered)
  const meshes = new Map(); // shape -> { mesh, capacity }
  let dirty = true;
  let lastZoom = null;

  function addBuildings() {
    if (map.getLayer(BUILDINGS_LAYER_ID) || !map.getSource(BUILDING_SOURCE)) return;
    map.addLayer({
      id: BUILDINGS_LAYER_ID,
      type: 'fill-extrusion',
      source: BUILDING_SOURCE,
      'source-layer': BUILDING_SOURCE_LAYER,
      minzoom: 13,
      filter: ['!=', ['get', 'hide_3d'], true],
      paint: buildingPaint(activeGround()),
    }, firstSymbolLayer(map));
  }

  function removeBuildings() {
    if (map.getLayer(BUILDINGS_LAYER_ID)) map.removeLayer(BUILDINGS_LAYER_ID);
  }

  function setIconsVisible(visible) {
    for (const fleetId of fleetIds) {
      const id = `veh-${fleetId}-icons`;
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }

  function resetOrigin() {
    const center = map.getCenter();
    origin = maplibregl.MercatorCoordinate.fromLngLat(center, 0);
    metresPerUnit = origin.meterInMercatorCoordinateUnits();
  }

  function ensureMesh(shape, count) {
    const entry = meshes.get(shape);
    if (entry && entry.capacity >= count) return entry.mesh;
    const capacity = Math.max(64, Math.ceil(count * 1.5));
    const [length, height, width] = SHAPES[shape];
    const geometry = shape === 'bike'
      ? new three.SphereGeometry(length / 2, 8, 6)
      : new three.BoxGeometry(width, height, length);
    // Boxes sit on the ground: lift by half their height.
    geometry.translate(0, height / 2, 0);
    const material = new three.MeshLambertMaterial({ vertexColors: false });
    const mesh = new three.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(three.DynamicDrawUsage);
    mesh.frustumCulled = false;
    if (entry) {
      scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
    }
    scene.add(mesh);
    meshes.set(shape, { mesh, capacity });
    return mesh;
  }

  // Rebuilds every instance matrix and color from the current fleets.
  function rebuild() {
    if (!scene) return;
    const zoom = map.getZoom();
    const scale = sizeScale(zoom);
    if (originStale(origin, maplibregl.MercatorCoordinate.fromLngLat(map.getCenter(), 0), metresPerUnit)) {
      resetOrigin();
    }
    const byShape = new Map();
    for (const collection of fleets.values()) {
      for (const feature of collection.features ?? []) {
        const props = feature.properties;
        const coordinates = feature.geometry?.coordinates;
        if (!props || !coordinates) continue;
        const shape = shapeFor(props.group);
        if (!byShape.has(shape)) byShape.set(shape, []);
        byShape.get(shape).push({ props, coordinates });
      }
    }
    const matrix = new three.Matrix4();
    const position = new three.Vector3();
    const quaternion = new three.Quaternion();
    const scaleVector = new three.Vector3();
    const color = new three.Color();
    const axis = new three.Vector3(0, 1, 0);
    for (const [shape, entry] of meshes) {
      if (!byShape.has(shape)) entry.mesh.count = 0;
    }
    for (const [shape, items] of byShape) {
      const mesh = ensureMesh(shape, items.length);
      mesh.count = items.length;
      items.forEach(({ props, coordinates }, index) => {
        const mercator = maplibregl.MercatorCoordinate.fromLngLat(coordinates, 0);
        const [x, y, z] = localPosition(mercator, origin, metresPerUnit, altitudeMetres(props));
        position.set(x, y, z);
        quaternion.setFromAxisAngle(axis, headingRotation(props.bearing, props.hasBearing));
        // Aircraft stay life-size-ish in plan but grow with the others; ground vehicles scale uniformly.
        scaleVector.set(scale, shape === 'plane' ? Math.max(1, scale * 0.6) : scale, scale);
        matrix.compose(position, quaternion, scaleVector);
        mesh.setMatrixAt(index, matrix);
        color.set(meshColor(props));
        if (props.stale) color.multiplyScalar(0.45);
        mesh.setColorAt(index, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    dirty = false;
    lastZoom = zoom;
  }

  const customLayer = {
    id: VEHICLES_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_map, gl) {
      scene = new three.Scene();
      camera = new three.Camera();
      scene.add(new three.HemisphereLight(0xffffff, 0x4a5058, 1.1));
      const sun = new three.DirectionalLight(0xfff4e0, 1.4);
      sun.position.set(-0.4, 1, 0.6);
      scene.add(sun);
      renderer = new three.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      resetOrigin();
      dirty = true;
    },
    onRemove() {
      for (const entry of meshes.values()) {
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
      }
      meshes.clear();
      renderer?.dispose();
      scene = null;
      renderer = null;
      camera = null;
    },
    render(_gl, options) {
      if (!scene || !renderer) return;
      const zoom = map.getZoom();
      if (dirty || lastZoom === null || Math.abs(zoom - lastZoom) > 0.05) rebuild();
      if (!origin) return;
      // Map clip space <- Mercator <- local metres (x east, y up, z south).
      const toMercator = new three.Matrix4()
        .makeTranslation(origin.x, origin.y, origin.z)
        .scale(new three.Vector3(metresPerUnit, -metresPerUnit, metresPerUnit))
        .multiply(new three.Matrix4().makeRotationX(Math.PI / 2));
      camera.projectionMatrix = new three.Matrix4()
        .fromArray(options.defaultProjectionData.mainMatrix)
        .multiply(toMercator);
      renderer.resetState();
      renderer.render(scene, camera);
    },
  };

  function addVehicles() {
    if (!map.getLayer(VEHICLES_LAYER_ID)) map.addLayer(customLayer);
  }

  let attachError = null;
  async function attach() {
    try {
      if (!three) three = await import('three');
      if (!enabled) return;
      addBuildings();
      addVehicles();
      setIconsVisible(false);
      dirty = true;
      map.triggerRepaint();
    } catch (error) {
      attachError = error;
      console.warn('3D view unavailable:', error.message);
    }
  }

  function detach() {
    if (map.getLayer(VEHICLES_LAYER_ID)) map.removeLayer(VEHICLES_LAYER_ID);
    removeBuildings();
    setIconsVisible(true);
  }

  return {
    isEnabled: () => enabled,
    /** Console/debug snapshot: what the scene currently holds. */
    debug: () => ({
      enabled,
      loaded: Boolean(three),
      sceneReady: Boolean(scene),
      error: attachError?.message ?? null,
      fleets: Object.fromEntries([...fleets].map(([id, fc]) => [id, fc.features?.length ?? 0])),
      meshes: Object.fromEntries([...meshes].map(([shape, entry]) => [shape, entry.mesh.count])),
      origin: origin ? [origin.x, origin.y] : null,
    }),
    /** Switch 3D on or off; pitches the camera to match. */
    setEnabled(next) {
      next = Boolean(next);
      if (next === enabled) return;
      enabled = next;
      persist(enabled);
      if (enabled) {
        void attach();
        if (map.getPitch() < 40) map.easeTo({ pitch: 60, duration: 800 });
      } else {
        detach();
        if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 600 });
      }
    },
    /** Call after every style (basemap) load: the style swap drops our layers. */
    reattach() {
      if (enabled) void attach();
    },
    /** A fleet's region-filtered features changed. */
    updateFleet(fleetId, collection) {
      fleets.set(fleetId, collection);
      if (!enabled || !scene) return;
      dirty = true;
      map.triggerRepaint();
    },
  };
}
