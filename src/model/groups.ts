// Layer group definitions: one entry per switch in the layer panel, in panel
// order, plus the sections that group them. Built once at boot because route
// membership and subway colors come from the MBTA route index, and whether a
// gateway-backed layer is usable comes from the gateway health check.
import { CONFIG } from '../feeds/config.js';
import { busDefaultOn } from '../feeds/regions.js';

export type SectionKey = 'subway' | 'ground' | 'airwater' | 'shared' | 'conditions' | 'infrastructure';

export interface GroupDef {
  key: string;
  name: string;
  section: SectionKey;
  /** Static route ids this group draws (empty for non-GTFS layers). */
  routes: string[];
  color?: string;
  /** Where the data comes from, shown as a small tag under the name. */
  truth?: string;
  /** The gateway or key this layer needs is missing: switch disabled, link shown. */
  needsKey?: boolean;
  keyUrl?: string;
  setupText?: string;
  /** False for reference layers that are not vehicles (left out of the live total). */
  countAsVehicle?: boolean;
  /** False when clicking the row should not fly the map anywhere. */
  zoomable?: boolean;
  /** A map overlay with no feature count. */
  overlay?: boolean;
}

export const SECTIONS: ReadonlyArray<{ key: SectionKey; name: string }> = [
  { key: 'subway', name: 'Subway' },
  { key: 'ground', name: 'Ground & rail' },
  { key: 'airwater', name: 'Air & water' },
  { key: 'shared', name: 'Shared & active travel' },
  { key: 'conditions', name: 'Conditions & alerts' },
  { key: 'infrastructure', name: 'Movement infrastructure' },
];

const SETUP = 'https://github.com/mapzimus/Motion#gateway-setup';

interface RouteLike { id: string; type: number; color?: string }
type Capabilities = Record<string, unknown> | undefined;

export function buildGroups(routeInfo: Map<string, RouteLike>, capabilities: Capabilities): GroupDef[] {
  const routesOfType = (t: number) =>
    [...routeInfo.values()].filter((r) => r.type === t).map((r) => r.id);
  const colorOf = (routeId: string) => routeInfo.get(routeId)?.color;
  const gated = (flag: string, setupText = 'gateway') =>
    ({ needsKey: !capabilities?.[flag], keyUrl: SETUP, setupText });
  const c = CONFIG as Record<string, any>;

  return [
    // Subway lines. Green's four branches toggle as one because that's how
    // riders think of them. Mattapan is branded Red but is its own light-rail
    // trolley, so it keeps its own row.
    { key: 'red', name: 'Red Line', section: 'subway', routes: ['Red'], color: colorOf('Red') },
    { key: 'orange', name: 'Orange Line', section: 'subway', routes: ['Orange'], color: colorOf('Orange') },
    { key: 'green', name: 'Green Line', section: 'subway', routes: ['Green-B', 'Green-C', 'Green-D', 'Green-E'], color: colorOf('Green-B') },
    { key: 'blue', name: 'Blue Line', section: 'subway', routes: ['Blue'], color: colorOf('Blue') },
    { key: 'silver', name: 'Silver Line', section: 'subway', routes: [...c.SILVER_ROUTES], color: colorOf('741') },
    { key: 'mattapan', name: 'Mattapan Trolley', section: 'subway', routes: ['Mattapan'], color: colorOf('Mattapan') },
    // The wider fleet.
    { key: 'commuter', name: 'Commuter & regional rail', section: 'ground', routes: routesOfType(2), color: c.COMMUTER_COLOR, truth: 'live + schedule' },
    { key: 'bus', name: 'Buses, shuttles & coaches', section: 'ground', routes: routesOfType(3).filter((id) => !c.SILVER_ROUTES.includes(id)), color: c.BUS_COLOR, truth: 'live + schedule' },
    { key: 'amtrak', name: 'Amtrak', section: 'ground', routes: [], color: c.AMTRAK_COLOR, truth: 'live + schedule' },
    { key: 'local', name: 'On-demand & community services', section: 'ground', routes: [], color: c.LOCAL_COLOR, truth: 'catalog', countAsVehicle: false },
    { key: 'taxi', name: 'Taxi & cab services', section: 'ground', routes: [], color: c.TAXI_COLOR, truth: 'directory', countAsVehicle: false },
    { key: 'ferry', name: 'Ferries & passenger boats', section: 'airwater', routes: routesOfType(4), color: c.FERRY_COLOR, truth: 'live + schedule' },
    { key: 'plane', name: 'Live aircraft', section: 'airwater', routes: [], color: c.PLANE_COLOR, truth: 'live', ...gated('aircraft', 'setup') },
    { key: 'air-service', name: 'Island & regional air services', section: 'airwater', routes: [], color: c.PLANE_COLOR, truth: 'schedule/catalog', countAsVehicle: false },
    { key: 'airport', name: 'Airports & landing facilities', section: 'airwater', routes: [], color: c.AIRPORT_COLOR, truth: 'FAA reference', countAsVehicle: false },
    { key: 'airport-status', name: 'Airport delays (FAA)', section: 'airwater', routes: [], color: c.AIRPORT_STATUS_COLORS['ground-delay'], truth: 'live', ...gated('airportStatus'), countAsVehicle: false },
    { key: 'airport-weather', name: 'Airport weather (METAR)', section: 'airwater', routes: [], color: c.FLIGHT_CATEGORY_COLORS.VFR, truth: 'live', ...gated('airportWeather'), countAsVehicle: false },
    { key: 'tfr', name: 'Temporary flight restrictions (FAA)', section: 'airwater', routes: [], color: c.TFR_COLORS.SECURITY, truth: 'live', ...gated('tfrs'), countAsVehicle: false },
    { key: 'airspace', name: 'Airspace (Class B/C/D & special use)', section: 'airwater', routes: [], color: c.AIRSPACE_COLORS.B, truth: 'FAA reference', countAsVehicle: false },
    { key: 'vessel', name: 'Live vessels (AIS)', section: 'airwater', routes: [], color: c.VESSEL_COLOR, truth: 'live', ...gated('ais', 'AIS key') },
    { key: 'bike', name: 'Public bike & scooter share', section: 'shared', routes: [], color: c.BIKE_COLOR, truth: 'live' },
    { key: 'bikeshare', name: 'Other bike-share systems (no live feed)', section: 'shared', routes: [], color: c.BIKESHARE_REF_COLOR, truth: 'operator reference', countAsVehicle: false },
    { key: 'walking', name: 'Marked walking & hiking routes', section: 'shared', routes: [], color: c.WALK_COLOR, truth: 'OSM routes', countAsVehicle: false, zoomable: false, overlay: true },
    { key: 'cycling', name: 'Marked cycling routes', section: 'shared', routes: [], color: c.CYCLE_COLOR, truth: 'OSM routes', countAsVehicle: false, zoomable: false, overlay: true },
    { key: 'traffic', name: 'Live congestion speeds', section: 'conditions', routes: [], color: c.INCIDENT_COLOR, truth: 'live 511', ...gated('traffic'), countAsVehicle: false, zoomable: false, overlay: true },
    { key: 'roadwork', name: 'Work zones & construction projects', section: 'conditions', routes: [], color: c.ROADWORK_COLOR, truth: 'WZDx · CT projects · CTroads', ...gated('roadwork'), countAsVehicle: false },
    { key: 'incident', name: 'Traffic incidents', section: 'conditions', routes: [], color: c.INCIDENT_COLOR, truth: 'live 511', ...gated('roadEvents'), countAsVehicle: false },
    { key: 'camera', name: 'Public traffic cameras', section: 'conditions', routes: [], color: c.CAMERA_COLOR, truth: 'live / viewer', ...gated('cameras'), countAsVehicle: false },
    { key: 'road-weather', name: 'Road weather stations', section: 'conditions', routes: [], color: c.ROAD_WEATHER_COLOR, truth: 'live', ...gated('roadWeather'), countAsVehicle: false },
    { key: 'message-sign', name: 'Highway message signs', section: 'conditions', routes: [], color: c.MESSAGE_SIGN_COLOR, truth: 'live', ...gated('messageSigns'), countAsVehicle: false },
    { key: 'plow', name: 'Snowplows', section: 'conditions', routes: [], color: c.PLOW_COLOR, truth: 'live + reference', countAsVehicle: false },
    { key: 'weather', name: 'Weather alerts (NWS)', section: 'conditions', routes: [], color: c.WEATHER_COLORS.moderate, truth: 'live', ...gated('weatherAlerts'), countAsVehicle: false },
    { key: 'roads', name: 'Major roadways', section: 'infrastructure', routes: [], color: c.ROAD_COLOR, truth: 'reference', countAsVehicle: false },
    { key: 'freight', name: 'Freight rail network', section: 'infrastructure', routes: [], color: c.FREIGHT_COLOR, truth: 'FRA reference', countAsVehicle: false },
    { key: 'border', name: 'Canada border crossings', section: 'infrastructure', routes: [], color: c.BORDER_COLOR, truth: 'CBSA reference', countAsVehicle: false },
    { key: 'heritage-rail', name: 'Heritage & scenic railroads', section: 'infrastructure', routes: [], color: c.HERITAGE_RAIL_COLOR, truth: 'operator reference', countAsVehicle: false },
    { key: 'aerialway', name: 'Ski lifts, gondolas & tramways', section: 'infrastructure', routes: [], color: c.AERIALWAY_COLOR, truth: 'OSM reference', countAsVehicle: false },
    { key: 'park-ride', name: 'Park & ride lots', section: 'infrastructure', routes: [], color: c.PARK_RIDE_COLOR, truth: 'state DOT reference', countAsVehicle: false },
    { key: 'ev-charging', name: 'Public EV charging', section: 'infrastructure', routes: [], color: c.EV_CHARGING_COLOR, truth: 'AFDC reference', countAsVehicle: false },
    { key: 'drawbridge', name: 'Drawbridges & movable bridges', section: 'infrastructure', routes: [], color: c.DRAWBRIDGE_COLOR, truth: 'USCG reference', countAsVehicle: false },
  ];
}

/** Whether a group is switched on when a region is first shown. */
export function groupStartsOn(group: GroupDef, region: string): boolean {
  if (group.needsKey) return false;
  if (group.key === 'bus' && busDefaultOn(region)) return true;
  return !(CONFIG as Record<string, any>).DEFAULT_OFF_GROUPS.includes(group.key);
}
