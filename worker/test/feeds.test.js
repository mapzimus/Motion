import { describe, expect, it } from 'vitest';
import { SWIFTLY_APPROVED_AGENCIES, TRANSIT_FEEDS, feedsForRegion, swiftlyAgencyKey, swiftlyApproved, vehiclesFromTrilliumMap } from '../src/feeds';
import staticFeeds from '../../scripts/regional-feeds.json';

const NEW_ENGLAND_STATES = new Set(['ct', 'ma', 'me', 'nh', 'ri', 'vt']);
const staticIds = new Set(staticFeeds.map((feed) => feed.id));

describe('realtime transit feed registry', () => {
  it('uses unique ids and only New England state keys', () => {
    const ids = TRANSIT_FEEDS.map((feed) => feed.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const feed of TRANSIT_FEEDS) {
      expect(feed.states.length, feed.id).toBeGreaterThan(0);
      for (const state of feed.states) expect(NEW_ENGLAND_STATES.has(state), `${feed.id}:${state}`).toBe(true);
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
        { id: '9', lat: 40.7, lon: -74.1, route_id: '1', heading: 10, headsign: 'Out of area' },
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
