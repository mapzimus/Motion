import type { RegionId, StateId } from './regions';

export type TransitFeed = {
  id: string;
  agency: string;
  states: StateId[];
  url: string;
  authorization?: 'swiftly';
};

// Public agency feeds are preferred. Vermont's statewide realtime program and
// Advance Transit publish through Swiftly, whose API requires one shared
// Authorization value; those feeds become active when SWIFTLY_API_KEY is set.
export const TRANSIT_FEEDS: TransitFeed[] = [
  {
    id: 'pvta',
    agency: 'Pioneer Valley Transit Authority',
    states: ['ma'],
    url: 'https://bustracker.pvta.com/infopoint/GTFS-Realtime.ashx?Type=VehiclePosition',
  },
  {
    id: 'mvrta',
    agency: 'Merrimack Valley Transit',
    states: ['ma'],
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
    id: 'norwalk',
    agency: 'Norwalk Transit District',
    states: ['ct'],
    url: 'https://mystop.norwalktransit.com/InfoPoint/gtfs-realtime.ashx?type=vehicleposition',
  },
  {
    id: 'ripta',
    agency: 'Rhode Island Public Transit Authority',
    states: ['ri'],
    url: 'http://realtime.ripta.com:81/api/vehiclepositions?format=gtfs.proto',
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
    id: 'south-portland',
    agency: 'South Portland Bus Service',
    states: ['me'],
    // Mobility Database mdb-2647 lists this Swiftly feed as keyless, but the
    // endpoint answers 401 without an Authorization header.
    url: 'https://api.goswift.ly/real-time/south-portland-transit/gtfs-rt-vehicle-positions',
    authorization: 'swiftly',
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
    id: 'advance-transit',
    agency: 'Advance Transit',
    states: ['nh', 'vt'],
    url: 'https://api.goswift.ly/real-time/advance-transit/gtfs-rt-vehicle-positions',
    authorization: 'swiftly',
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
    id: 'moover',
    agency: 'MOOver!',
    states: ['nh', 'vt'],
    url: 'https://api.goswift.ly/real-time/moover/gtfs-rt-vehicle-positions',
    authorization: 'swiftly',
  },
  {
    id: 'rct',
    agency: 'Rural Community Transportation',
    states: ['vt'],
    url: 'https://api.goswift.ly/real-time/rct/gtfs-rt-vehicle-positions',
    authorization: 'swiftly',
  },
  {
    id: 'tri-valley',
    agency: 'Tri-Valley Transit',
    states: ['vt'],
    url: 'https://api.goswift.ly/real-time/trivalleytransit/gtfs-rt-vehicle-positions',
    authorization: 'swiftly',
  },
];

export function feedsForRegion(region: RegionId): TransitFeed[] {
  if (region === 'boston') return [];
  if (region === 'new-england') return TRANSIT_FEEDS;
  return TRANSIT_FEEDS.filter((feed) => feed.states.includes(region));
}
