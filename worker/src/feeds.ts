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
    id: 'river-valley',
    agency: 'River Valley Transit',
    states: ['ct'],
    url: 'https://my.ridervt.com/InfoPoint/GTFS-Realtime.ashx?Type=VehiclePosition',
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
  {
    id: 'the-current',
    agency: 'The Current',
    states: ['vt'],
    url: 'https://api.goswift.ly/real-time/thecurrent/gtfs-rt-vehicle-positions',
    authorization: 'swiftly',
  },
];

export function feedsForRegion(region: RegionId): TransitFeed[] {
  if (region === 'boston') return [];
  if (region === 'new-england') return TRANSIT_FEEDS;
  return TRANSIT_FEEDS.filter((feed) => feed.states.includes(region));
}
