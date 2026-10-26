import { describe, expect, it } from 'vitest';
import { SWIFTLY_APPROVED_AGENCIES, TRANSIT_FEEDS, feedsForRegion, swiftlyAgencyKey, swiftlyApproved, vehiclesFromTrilliumMap } from '../src/feeds';
import staticFeeds from '../../scripts/regional-feeds.json';

const MAP_STATES = new Set(['ct', 'ma', 'me', 'nh', 'ri', 'vt', 'ny', 'nj', 'philadelphia', 'washington', 'chicago', 'bay-area']);
const NORTHEAST_IDS = TRANSIT_FEEDS.filter((feed) => feed.states.some((state) => !['philadelphia', 'washington', 'chicago', 'bay-area'].includes(state))).map((feed) => feed.id);
// A static feed may name the live feed its routes join (`realtime_feed`).
const staticIds = new Set(staticFeeds.flatMap((feed) => [feed.id, feed.realtime_feed].filter(Boolean)));

describe('realtime transit feed registry', () => {
  it('uses unique ids and only map-area state keys', () => {
    const ids = TRANSIT_FEEDS.map((feed) => feed.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const feed of TRANSIT_FEEDS) {
      expect(feed.states.length, feed.id).toBeGreaterThan(0);
      for (const state of feed.states) expect(MAP_STATES.has(state), `${feed.id}:${state}`).toBe(true);
    }
  });

  it('keys every realtime feed to a static schedule feed so route ids can join', () => {
    // Connecticut Children's publishes positions only; its GTFS zip is 404.
    const liveWithoutStaticGtfs = new Set(['ccmc']);
    const orphans = TRANSIT_FEEDS.map((feed) => feed.id).filter((id) => !staticIds.has(id));
    expect(orphans.sort()).toEqual([...liveWithoutStaticGtfs].sort());
  });

  it('never points at the out-of-region Williamsport, PA tracker again', () => {
    // my.ridervt.com is River Valley Transit of Williamsport, Pennsylvania.
    for (const feed of TRANSIT_FEEDS) expect(feed.url, feed.id).not.toMatch(/ridervt\.com/i);
  });

  it('maps the live-verified campus and RTA feeds to their states', () => {
    const ids = (region) => feedsForRegion(region).map((feed) => feed.id);
    expect(ids('ma')).toEqual(expect.arrayContaining(['wrta', 'gatra', 'mit', 'tufts']));
    expect(ids('ct')).toContain('uconn-wrtd');
    expect(ids('ri')).toEqual(expect.arrayContaining(['brown', 'uri', 'providence-college']));
    expect(ids('ct')).toEqual(expect.arrayContaining(['quinnipiac', 'uhartford', 'unewhaven', 'harbor-point', 'ccmc']));
    expect(ids('me')).toEqual(expect.arrayContaining(['bangor', 'citylink']));
    expect(ids('ma')).toEqual(expect.arrayContaining(['lrta', 'ezride', 'longwood', 'mgb', 'lexpress', 'nantucket-wave', 'bu', 'bc', 'umb', 'wellesley']));
  });

  it('serves New York feeds only to New York, New Jersey and the Northeast union', () => {
    const ids = (region) => feedsForRegion(region).map((feed) => feed.id);
    expect(ids('ny')).toEqual(expect.arrayContaining(['nyct-bus', 'nyc-ferry', 'ny-waterway', 'tcat', 'cdta', 'suffolk']));
    expect(ids('nj')).toEqual(['ny-waterway']);
    expect(ids('new-england')).not.toContain('nyct-bus');
    expect(ids('new-england')).toContain('cttransit');
    expect(ids('northeast')).toEqual(NORTHEAST_IDS);
    expect(ids('northeast')).not.toContain('septa-bus');
    expect(ids('ct')).not.toContain('nyct-bus');
  });

  it('serves each metro its own feeds and nothing from the Northeast', () => {
    const ids = (region) => feedsForRegion(region).map((feed) => feed.id);
    expect(ids('philadelphia')).toEqual(['septa-bus', 'septa-rail', 'pottstown-part']);
    expect(ids('washington')).toEqual(['wmata-rail', 'wmata-bus', 'marc', 'vre', 'fairfax-connector', 'dash']);
    expect(ids('chicago')).toEqual(['cta-train', 'cta-bus', 'metra']);
    expect(ids('bay-area')).toEqual(expect.arrayContaining(['muni', 'bart', 'caltrain', 'ac-transit', 'sc-vta', 'sf-bay-ferry', 'emery-go-round']));
    for (const metro of ['philadelphia', 'washington', 'chicago', 'bay-area']) {
      expect(ids(metro)).not.toContain('nyct-bus');
      expect(ids(metro)).not.toContain('pvta');
    }
  });

  it('flags trains and boats so the browser draws them in their own groups', () => {
    const rail = TRANSIT_FEEDS.filter((feed) => feed.rail).map((feed) => feed.id);
    expect(rail).toEqual(expect.arrayContaining(['septa-rail', 'wmata-rail', 'marc', 'vre', 'cta-train', 'metra', 'bart', 'caltrain', 'smart']));
    expect(TRANSIT_FEEDS.filter((feed) => feed.ferry).map((feed) => feed.id)).toEqual(['sf-bay-ferry', 'golden-gate-ferry']);
    // Every keyed feed names how its key travels.
    for (const feed of TRANSIT_FEEDS.filter((feed) => /wmata\.com|metrarr\.com|511\.org/.test(feed.url))) {
      expect(feed.authorization, feed.id).toBeTruthy();
    }
  });

  it('serves only MBTA-core shuttles for the legacy boston region', () => {
    const core = feedsForRegion('boston');
    expect(core.map((feed) => feed.id).sort()).toEqual(['bc', 'bu', 'ezride', 'longwood', 'mgb', 'mit', 'tufts', 'umb']);
    for (const feed of core) expect(feed.states, feed.id).toContain('ma');
  });

  it('sends the Swiftly key only to agencies that approved sharing', () => {
    const swiftly = TRANSIT_FEEDS.filter((feed) => feed.authorization === 'swiftly');
    expect(swiftly.length).toBeGreaterThan(1);
    for (const feed of swiftly) expect(swiftlyAgencyKey(feed), feed.id).toBeTruthy();
    expect(swiftly.filter(swiftlyApproved).map((feed) => feed.id)).toEqual(['casco-bay']);
    expect([...SWIFTLY_APPROVED_AGENCIES]).toEqual(['casco-bay-lines']);
    // A keyless feed is never "Swiftly approved", whatever its URL.
    expect(swiftlyApproved(TRANSIT_FEEDS.find((feed) => feed.id === 'ripta'))).toBe(false);
  });

  it('reads Advance, MOOver, RCT, and Tri-Valley from the public Trillium map', () => {
    const slugs = {
      'advance-transit': 'advancetransit-vt-us',
      moover: 'sevt-vt-us',
      rct: 'ruralcommunity-vt-us',
      'tri-valley': 'trivalleytransit-vt-us',
    };
    for (const [id, slug] of Object.entries(slugs)) {
      const feed = TRANSIT_FEEDS.find((item) => item.id === id);
      expect(feed?.source, id).toBe('trillium');
      expect(feed?.authorization, id).toBeUndefined();
      expect(feed?.url, id).toBe(`https://maps.trilliumtransit.com/gtfsmap-realtime/feed/${slug}/vehicles`);
      expect(swiftlyApproved(feed), id).toBe(false);
    }
    expect([...SWIFTLY_APPROVED_AGENCIES]).toEqual(['casco-bay-lines']);
    for (const id of ['gmt', 'gmcn', 'marble-valley', 'nashua', 'mvrta']) {
      expect(TRANSIT_FEEDS.find((feed) => feed.id === id)?.url, id).toMatch(/goswift\.ly/);
    }
  });

  it('requests Merrimack Valley, RCT, and Tri-Valley on a New Hampshire visit', () => {
    const ids = feedsForRegion('nh').map((feed) => feed.id);
    expect(ids).toEqual(expect.arrayContaining(['mvrta', 'rct', 'tri-valley', 'advance-transit', 'moover']));
    const mvrta = TRANSIT_FEEDS.find((feed) => feed.id === 'mvrta');
    expect(mvrta?.states).toEqual(['ma', 'nh']);
    expect(swiftlyApproved(mvrta)).toBe(false);
  });

  it('maps Trillium vehicle JSON onto the regional vehicle shape', () => {
    const feed = TRANSIT_FEEDS.find((item) => item.id === 'advance-transit');
    const vehicles = vehiclesFromTrilliumMap(feed, {
      status: 'success',
      data: [
        { id: '2254', lat: 43.6958955, lon: -72.279929, route_id: '7130', heading: 335.8893, headsign: 'To Hanover' },
        { id: '9', lat: 21.3, lon: -157.86, route_id: '1', heading: 10, headsign: 'Out of area' },
        { lat: 43.7, lon: -72.2, route_id: '1' },
      ],
    }, new Date('2026-10-07T18:00:00Z'));
    expect(vehicles).toEqual([{
      id: 'advance-transit-2254',
      feed: 'advance-transit',
      agency: 'Advance Transit',
      lng: -72.279929,
      lat: 43.6958955,
      route: '7130',
      trip: '',
      label: '2254',
      bearing: 335.8893,
      speedMps: null,
      updatedAt: '2026-10-07T18:00:00.000Z',
      headsign: 'To Hanover',
      positionSource: 'Trillium map',
    }]);
  });
});
