import { describe, expect, it } from 'vitest';
import { SWIFTLY_APPROVED_AGENCIES, TRANSIT_FEEDS, feedsForRegion, swiftlyAgencyKey, swiftlyApproved } from '../src/feeds';
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
    const orphans = TRANSIT_FEEDS.map((feed) => feed.id).filter((id) => !staticIds.has(id));
    expect(orphans).toEqual([]);
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
    expect(ids('ct')).toEqual(expect.arrayContaining(['quinnipiac', 'uhartford', 'unewhaven', 'harbor-point']));
    expect(ids('me')).toEqual(expect.arrayContaining(['bangor', 'citylink']));
    expect(ids('ma')).toEqual(expect.arrayContaining(['lrta', 'ezride', 'longwood', 'mgb', 'lexpress', 'nantucket-wave', 'bu', 'bc', 'umb']));
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
});
