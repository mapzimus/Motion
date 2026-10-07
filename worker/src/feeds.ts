import { insideNewEngland, type RegionId, type StateId } from './regions';

export type TransitFeed = {
  id: string;
  agency: string;
  states: StateId[];
  url: string;
  authorization?: 'swiftly';
  // Keyless vehicle JSON from the agency's public Trillium map. Not a Swiftly call.
  source?: 'trillium';
  // Service area lies inside the 17-municipality MBTA core, so the feed is also
  // served for the `boston` gateway region.
  mbtaCore?: true;
};

export type RegionalVehicle = {
  id: string;
  feed: string;
  agency: string;
  lng: number;
  lat: number;
  route: string;
  trip: string;
  label: string;
  bearing: number | null;
  speedMps: number | null;
  updatedAt: string;
  headsign?: string;
  positionSource?: string;
};

// Public agency feeds are preferred. Some Vermont and New Hampshire agencies
// publish official GTFS-realtime through Swiftly, whose API needs a key that
// is enabled agency by agency; see SWIFTLY_APPROVED_AGENCIES below. Advance
// Transit, MOOver, RCT, and Tri-Valley are read from their public Trillium
// maps instead, which return vehicle JSON with no key.
export const TRANSIT_FEEDS: TransitFeed[] = [
  {
    id: 'pvta',
    agency: 'Pioneer Valley Transit Authority',
    states: ['ma'],
    url: 'https://bustracker.pvta.com/infopoint/GTFS-Realtime.ashx?Type=VehiclePosition',
  },
  {
    // Still Swiftly (`massdot-mvrta`). A New Hampshire visit requests it for the
    // Plaistow and Salem ribbons; nothing is drawn until that agency is approved.
    id: 'mvrta',
    agency: 'Merrimack Valley Transit',
    states: ['ma', 'nh'],
    url: 'https://api.goswift.ly/real-time/massdot-mvrta/gtfs-rt-vehicle-positions',
    authorization: 'swiftly',
  },
  {
    id: 'bat',
    agency: 'Brockton Area Transit Authority',
    states: ['ma'],
    url: 'https://passio3.com/brockton/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    id: 'mart',
    agency: 'Montachusett Regional Transit Authority',
    states: ['ma'],
    url: 'https://passio3.com/montachusett/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    id: 'frta',
    agency: 'Franklin Regional Transit Authority',
    states: ['ma'],
    url: 'https://passio3.com/frta/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    // Cadavl producer (same platform as Greater Portland METRO). Route ids match the
    // gtfs.wrta.cadavl.com static GTFS. Live-verified 2026-09-27: vehicles in Worcester.
    id: 'wrta',
    agency: 'Worcester Regional Transit Authority',
    states: ['ma'],
    url: 'https://gtfsrt.wrta.cadavl.com/ProfilGtfsRt2_0RSProducer-WRTA/VehiclePosition.pb',
  },
  {
    // Cadavl producer; live-verified 2026-09-27 with vehicles around Taunton/Attleboro.
    // Vehicle entities currently omit trip.route_id.
    id: 'gatra',
    agency: 'Greater Attleboro Taunton Regional Transit Authority',
    states: ['ma'],
    url: 'https://gtfsrt.gatra.cadavl.com/ProfilGtfsRt2_0RSProducer-GATRA/VehiclePosition.pb',
  },
  {
    // Cadavl producer on the agency's own host, same platform as WRTA and GATRA; route ids
    // match the gtfs.lrta.cadavl.com static GTFS. LRTA runs no Sunday service, so both 2026
    // checks (09-27, 10-04) saw a valid, fresh feed with zero vehicles.
    id: 'lrta',
    agency: 'Lowell Regional Transit Authority',
    states: ['ma'],
    url: 'https://gtfsrt.lrta.cadavl.com/ProfilGtfsRt2_0RSProducer-LRTA/VehiclePosition.pb',
  },
  {
    // Campus shuttles; route ids join the passio static GTFS (regional-feeds id "mit").
    id: 'mit',
    agency: 'MIT shuttles',
    states: ['ma'],
    url: 'https://passio3.com/mit/passioTransit/gtfs/realtime/vehiclePositions',
    mbtaCore: true,
  },
  {
    id: 'tufts',
    agency: 'Tufts University shuttles',
    states: ['ma'],
    url: 'https://passio3.com/tufts/passioTransit/gtfs/realtime/vehiclePositions',
    mbtaCore: true,
  },
  {
    // Live-verified 2026-10-04: one vehicle at Lechmere/Kendall.
    id: 'ezride',
    agency: 'EZRide · Charles River TMA',
    states: ['ma'],
    url: 'https://passio3.com/charlesriver/passioTransit/gtfs/realtime/vehiclePositions',
    mbtaCore: true,
  },
  {
    // Weekday-only Longwood Medical Area shuttles (formerly MASCO).
    id: 'longwood',
    agency: 'Longwood Collective shuttles',
    states: ['ma'],
    url: 'https://passio3.com/longwoodcollective/passioTransit/gtfs/realtime/vehiclePositions',
    mbtaCore: true,
  },
  {
    // Live-verified 2026-10-04: one vehicle near North Station / MGH.
    id: 'mgb',
    agency: 'Mass General Brigham shuttles',
    states: ['ma'],
    url: 'https://passio3.com/mgb/passioTransit/gtfs/realtime/vehiclePositions',
    mbtaCore: true,
  },
  {
    // Weekday-only Lexington town bus.
    id: 'lexpress',
    agency: 'Lexpress',
    states: ['ma'],
    url: 'https://passio3.com/lexpress/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    // TransLoc tenants publish keyless GTFS-realtime at /subscriptions/gtfsrt/vehicles.ashx.
    // Route ids (TL-n) join the tenant's own GTFS export, which is why the static feeds for
    // these systems read <tenant>.transloc.com rather than a catalog mirror.
    // Live-verified 2026-10-04: ten vehicles on Nantucket.
    id: 'nantucket-wave',
    agency: 'Nantucket WAVE',
    states: ['ma'],
    url: 'https://nrtawave.transloc.com/subscriptions/gtfsrt/vehicles.ashx',
  },
  {
    // Valid, fresh feed with no vehicles on Sunday 2026-10-04 (the BU Shuttle was not running).
    id: 'bu',
    agency: 'Boston University shuttles',
    states: ['ma'],
    url: 'https://bu.transloc.com/subscriptions/gtfsrt/vehicles.ashx',
    mbtaCore: true,
  },
  {
    // Live-verified 2026-10-04: four vehicles around Chestnut Hill.
    id: 'bc',
    agency: 'Boston College shuttles',
    states: ['ma'],
    url: 'https://bc.transloc.com/subscriptions/gtfsrt/vehicles.ashx',
    mbtaCore: true,
  },
  {
    // Live-verified 2026-10-04: five vehicles between JFK/UMass and the campus.
    id: 'umb',
    agency: 'UMass Boston shuttles',
    states: ['ma'],
    url: 'https://umb.transloc.com/subscriptions/gtfsrt/vehicles.ashx',
    mbtaCore: true,
  },
  {
    // Wellesley College Local Motion. Public GTFS and a keyless vehicle feed.
    // The campus is outside the 17-municipality MBTA core.
    id: 'wellesley',
    agency: 'Wellesley College (Local Motion)',
    states: ['ma'],
    url: 'https://wellesleycollege.transloc.com/subscriptions/gtfsrt/vehicles.ashx',
  },
  {
    id: 'cttransit',
    agency: 'CTtransit',
    states: ['ct'],
    url: 'https://cttprdtmgtfs.ctttrpcloud.com/TMGTFSRealTimeWebService/Vehicle/VehiclePositions.pb',
  },
  {
    id: 'hart',
    agency: 'HARTransit',
    states: ['ct'],
    url: 'https://passio3.com/hart/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    // Connecticut's River Valley Transit (the 2023 merger of Middletown Area
    // Transit and Estuary Transit District / 9 Town Transit) publishes through
    // Passio under the legacy "9town" system key (Mobility Database mdb-2271).
    // The earlier my.ridervt.com InfoPoint host belongs to the unrelated River
    // Valley Transit of Williamsport, Pennsylvania; its buses were always
    // outside the New England bounding box, so this feed reported zero vehicles.
    id: 'river-valley',
    agency: 'River Valley Transit (Middletown / 9 Town Transit)',
    states: ['ct'],
    url: 'https://passio3.com/9town/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    // Connecticut Children's hospital shuttle (Passio username ccmc). The
    // static GTFS zip returns 404, so these buses are drawn from positions
    // only and do not join a schedule ribbon.
    id: 'ccmc',
    agency: "Connecticut Children's",
    states: ['ct'],
    url: 'https://passio3.com/ccmc/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    id: 'norwalk',
    agency: 'Norwalk Transit District',
    states: ['ct'],
    url: 'https://mystop.norwalktransit.com/InfoPoint/gtfs-realtime.ashx?type=vehicleposition',
  },
  {
    // Passio "uconn" system; route ids match the tld-4473 static feed (uconn-wrtd).
    id: 'uconn-wrtd',
    agency: 'UConn / Windham Region Transit District',
    states: ['ct'],
    url: 'https://passio3.com/uconn/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    // Live-verified 2026-10-04: three vehicles between Hamden and North Haven.
    id: 'quinnipiac',
    agency: 'Quinnipiac University shuttles',
    states: ['ct'],
    url: 'https://passio3.com/quinnUni/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    id: 'uhartford',
    agency: 'University of Hartford shuttles',
    states: ['ct'],
    url: 'https://passio3.com/HartfordAmerica/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    id: 'unewhaven',
    agency: 'University of New Haven shuttles',
    states: ['ct'],
    url: 'https://passio3.com/newhaven/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    // Stamford's free Harbor Point / downtown trolley, Passio system "buildingland"
    // (Building and Land Technology). Live-verified 2026-10-04: one vehicle near the station.
    id: 'harbor-point',
    agency: 'Harbor Point Trolley',
    states: ['ct'],
    url: 'https://passio3.com/buildingland/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    // Live-verified 2026-10-04: one vehicle on the Farmington campus.
    id: 'uconn-health',
    agency: 'UConn Health shuttles',
    states: ['ct'],
    url: 'https://uconnhealth.transloc.com/subscriptions/gtfsrt/vehicles.ashx',
  },
  {
    id: 'easternct',
    agency: 'Eastern Connecticut State University shuttles',
    states: ['ct'],
    url: 'https://easternct.transloc.com/subscriptions/gtfsrt/vehicles.ashx',
  },
  {
    id: 'ripta',
    agency: 'Rhode Island Public Transit Authority',
    states: ['ri'],
    url: 'http://realtime.ripta.com:81/api/vehiclepositions?format=gtfs.proto',
  },
  {
    id: 'brown',
    agency: 'Brown University shuttles',
    states: ['ri'],
    url: 'https://passio3.com/brown/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    id: 'providence-college',
    agency: 'Providence College shuttles',
    states: ['ri'],
    url: 'https://passio3.com/providence/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    id: 'uri',
    agency: 'University of Rhode Island shuttles',
    states: ['ri'],
    url: 'https://uri.transloc.com/subscriptions/gtfsrt/vehicles.ashx',
  },
  {
    id: 'greater-portland',
    agency: 'Greater Portland METRO',
    states: ['me'],
    url: 'https://gtfsrt.gptd.cadavl.com/ProfilGtfsRt2_0RSProducer-GPTD/VehiclePosition.pb',
  },
  {
    id: 'island-explorer',
    agency: 'Island Explorer',
    states: ['me'],
    url: 'https://islandexplorertracker.availtec.com/InfoPoint/GTFS-Realtime.ashx?&Type=VehiclePosition&serverid=0',
  },
  {
    // No Sunday service; the static feed (regional-feeds id "bangor") is this same Passio system.
    id: 'bangor',
    agency: 'Bangor Community Connector',
    states: ['me'],
    url: 'https://passio3.com/bangor/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    // Passio; Saturday-only Star City Connector loop in Presque Isle (static feed id "arts").
    id: 'arts',
    agency: 'Aroostook Regional Transportation System',
    states: ['me'],
    url: 'https://passio3.com/arts/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    // Passio system "avcog"; its GTFS route ids match the AVCOG-published static feed.
    id: 'citylink',
    agency: 'Lewiston-Auburn citylink',
    states: ['me'],
    url: 'https://passio3.com/avcog/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    id: 'casco-bay',
    agency: 'Casco Bay Lines',
    states: ['me'],
    // Agency key confirmed from the operator's own live map proxy
    // (https://livemap.cascobaylines.com/api/vessels reports agencyKey
    // "casco-bay-lines"); the GTFS-RT endpoint itself needs the Swiftly key.
    url: 'https://api.goswift.ly/real-time/casco-bay-lines/gtfs-rt-vehicle-positions',
    authorization: 'swiftly',
  },
  {
    id: 'coast',
    agency: 'COAST',
    states: ['nh', 'me'],
    url: 'https://passio3.com/coast/passioTransit/gtfs/realtime/vehiclePositions',
  },
  {
    id: 'nashua',
    agency: 'Nashua Transit System',
    states: ['nh'],
    url: 'https://api.goswift.ly/real-time/nashua-transit-system/gtfs-rt-vehicle-positions',
    authorization: 'swiftly',
  },
  {
    // Public Trillium map. Route ids match the GTFS already drawn. The official
    // GTFS-RT is Swiftly agency `advance-transit` and is not called.
    id: 'advance-transit',
    agency: 'Advance Transit',
    states: ['nh', 'vt'],
    url: 'https://maps.trilliumtransit.com/gtfsmap-realtime/feed/advancetransit-vt-us/vehicles',
    source: 'trillium',
  },
  {
    id: 'gmt',
    agency: 'Green Mountain Transit',
    states: ['vt'],
    url: 'https://api.goswift.ly/real-time/green-mountain/gtfs-rt-vehicle-positions',
    authorization: 'swiftly',
  },
  {
    id: 'gmcn',
    agency: 'Green Mountain Community Network',
    states: ['ma', 'vt'],
    url: 'https://api.goswift.ly/real-time/bennington-gmcn/gtfs-rt-vehicle-positions',
    authorization: 'swiftly',
  },
  {
    id: 'marble-valley',
    agency: 'Marble Valley Regional Transit District',
    states: ['vt'],
    url: 'https://api.goswift.ly/real-time/marble-valley/gtfs-rt-vehicle-positions',
    authorization: 'swiftly',
  },
  {
    // Southeast Vermont Transit / MOOver. Public Trillium map, slug sevt-vt-us.
    // The official GTFS-RT is Swiftly agency `moover` and is not called.
    id: 'moover',
    agency: 'MOOver!',
    states: ['nh', 'vt'],
    url: 'https://maps.trilliumtransit.com/gtfsmap-realtime/feed/sevt-vt-us/vehicles',
    source: 'trillium',
  },
  {
    // Public Trillium map. The official GTFS-RT is Swiftly agency `rct` and is not called.
    // `nh` is here so a New Hampshire visit requests the Greenleaf ribbon.
    id: 'rct',
    agency: 'Rural Community Transportation',
    states: ['vt', 'nh'],
    url: 'https://maps.trilliumtransit.com/gtfsmap-realtime/feed/ruralcommunity-vt-us/vehicles',
    source: 'trillium',
  },
  {
    // Public Trillium map. The official GTFS-RT is Swiftly agency `trivalleytransit`
    // and is not called. `nh` covers the 89er South, River Route, Saturday Shopper,
    // and Bradford Area Circulator ribbons.
    id: 'tri-valley',
    agency: 'Tri-Valley Transit',
    states: ['vt', 'nh'],
    url: 'https://maps.trilliumtransit.com/gtfsmap-realtime/feed/trivalleytransit-vt-us/vehicles',
    source: 'trillium',
  },
];

// Swiftly issues one key but switches it on per agency, and only for agencies
// that pre-approve third-party sharing or approve in writing (Swiftly support
// ticket G5MJJP-E6GZZ, 2026-09-30). The key is rejected for every other agency,
// and those rejected calls would still spend the key's allowance of 180
// requests per 15 minutes, so the gateway only calls agencies listed here.
// RIPTA is approved too but is read from its own keyless feed.
export const SWIFTLY_APPROVED_AGENCIES: ReadonlySet<string> = new Set(['casco-bay-lines']);

export function swiftlyAgencyKey(feed: TransitFeed): string | null {
  return /\/real-time\/([^/]+)\//.exec(feed.url)?.[1] ?? null;
}

export function swiftlyApproved(feed: TransitFeed): boolean {
  const key = swiftlyAgencyKey(feed);
  return feed.authorization === 'swiftly' && key !== null && SWIFTLY_APPROVED_AGENCIES.has(key);
}

export function feedsForRegion(region: RegionId): TransitFeed[] {
  if (region === 'boston') return TRANSIT_FEEDS.filter((feed) => feed.mbtaCore);
  if (region === 'new-england') return TRANSIT_FEEDS;
  return TRANSIT_FEEDS.filter((feed) => feed.states.includes(region));
}

// The public Trillium map returns `{ status, data: [{ id, lat, lon, route_id, heading, headsign }] }`.
// Route ids match the static GTFS. There is no timestamp, trip id, or speed.
export function vehiclesFromTrilliumMap(
  feed: TransitFeed,
  payload: unknown,
  now = new Date(),
): RegionalVehicle[] {
  const rows = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: unknown[] }).data
    : [];
  const updatedAt = now.toISOString();
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const record = row as {
      id?: unknown;
      lat?: unknown;
      lon?: unknown;
      route_id?: unknown;
      heading?: unknown;
      headsign?: unknown;
    };
    const lat = typeof record.lat === 'number' ? record.lat : Number(record.lat);
    const lng = typeof record.lon === 'number' ? record.lon : Number(record.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !insideNewEngland(lng, lat)) return [];
    const vehicleId = record.id == null ? '' : String(record.id);
    if (!vehicleId) return [];
    const heading = typeof record.heading === 'number' ? record.heading : Number(record.heading);
    const headsign = record.headsign == null ? '' : String(record.headsign);
    return [{
      id: `${feed.id}-${vehicleId}`,
      feed: feed.id,
      agency: feed.agency,
      lng,
      lat,
      route: record.route_id == null ? '' : String(record.route_id),
      trip: '',
      label: vehicleId,
      bearing: Number.isFinite(heading) ? heading : null,
      speedMps: null,
      updatedAt,
      ...(headsign ? { headsign } : {}),
      positionSource: 'Trillium map',
    }];
  });
}
