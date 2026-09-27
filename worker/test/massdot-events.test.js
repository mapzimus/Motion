import { describe, expect, it } from 'vitest';
import { MASSDOT_EVENTS_URL, parseErsEvents } from '../src/massdot-events';

const event = (fields) => {
  const defaults = {
    EventId: '1',
    EventCreatedDate: '2026-09-26T19:31:32',
    LastUpdate: '2026-09-26T19:31:32',
    EventStatus: 'Open',
    EventCategory: 'Current Event',
    EventType: 'Traffic Incidents',
    EventSubType: '',
    RoadwayName: 'I-90',
    Direction: 'EB',
    LocationType: 'Point',
    PrimaryLatitude: '42.3',
    PrimaryLongitude: '-71.1',
    LocationDescription: '',
    LaneBlockageDescription: '',
    RecurrenceDescription: '',
  };
  const merged = { ...defaults, ...fields };
  return `<Event>${Object.entries(merged).map(([key, value]) => `<${key}>${value}</${key}>`).join('')}</Event>`;
};

const FEED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ERSEvents>
  <UpdateDate>2026-09-26T19:38:20.828-0400</UpdateDate>
  <Events>
    ${event({
      EventId: '2754793634310369',
      EventSubType: 'Traffic (DMV/Crash)',
      PrimaryLatitude: '42.34634826672078',
      PrimaryLongitude: '-71.06030023870962',
      LocationDescription: 'I-90 EB Exit 134A',
      LaneBlockageDescription: 'Travel Lane(s) Affected: 1 of 2 Lane(s) Affected Description: ',
    })}
    ${event({ EventId: '2', EventStatus: 'Closed' })}
    ${event({ EventId: '3', EventCategory: 'Planned Event' })}
    ${event({ EventId: '4', PrimaryLatitude: '', PrimaryLongitude: '' })}
    ${event({ EventId: '5', PrimaryLatitude: '40.71', PrimaryLongitude: '-74.01' })}
    ${event({ EventId: '6', LocationType: 'Segment' })}
    ${event({
      EventId: '7',
      EventType: 'Acts of Nature',
      RoadwayName: 'Route 2',
      Direction: 'WB',
      LastUpdate: '2026-09-26T23:59:00',
      LaneBlockageDescription: 'Travel Lane(s) Affected: 2 of 3 Lane(s) Affected Description: Left &amp; center &#8211; &quot;flooded&quot;',
      RecurrenceDescription: 'Until &lt;further&gt; notice &apos;TBD&apos;',
    })}
  </Events>
</ERSEvents>`;

describe('MassDOT roadway events', () => {
  it('fetches over plain http because the https listener times out', () => {
    expect(MASSDOT_EVENTS_URL).toBe('http://events.massdot.evbg.net/');
  });

  it('keeps only open, unplanned point events inside New England', () => {
    const features = parseErsEvents(FEED);
    expect(features.map((feature) => feature.id)).toEqual(['ma-2754793634310369', 'ma-7']);
  });

  it('shapes a kept event like the other incident features', () => {
    const [feature] = parseErsEvents(FEED);
    expect(feature).toEqual({
      type: 'Feature',
      id: 'ma-2754793634310369',
      geometry: { type: 'Point', coordinates: [-71.06030023870962, 42.34634826672078] },
      properties: {
        group: 'incident',
        dataStatus: 'live',
        color: '#ff5c5c',
        title: 'I-90 EB Exit 134A',
        status: 'Traffic (DMV/Crash) · I-90 EB',
        details: '1 of 2 lanes affected',
        provider: 'MassDOT Highway Division roadway events',
        sourceUrl: 'https://www.mass511.com/',
        updatedAt: '2026-09-26T23:31:32.000Z',
      },
    });
  });

  it('decodes XML entities, falls back to road for title and converts across midnight UTC', () => {
    const feature = parseErsEvents(FEED)[1];
    expect(feature.properties.title).toBe('Route 2 WB');
    expect(feature.properties.status).toBe('Acts of Nature · Route 2 WB');
    expect(feature.properties.details).toBe(
      '2 of 3 lanes affected: Left & center – "flooded" · Until <further> notice \'TBD\'',
    );
    expect(feature.properties.updatedAt).toBe('2026-09-27T03:59:00.000Z');
  });

  it('falls back to now when the feed gives no offset', () => {
    const now = new Date('2026-09-27T12:00:00Z');
    const xml = `<ERSEvents><UpdateDate></UpdateDate><Events>${event({})}</Events></ERSEvents>`;
    const [feature] = parseErsEvents(xml, now);
    expect(feature.properties.updatedAt).toBe('2026-09-27T12:00:00.000Z');
    expect(feature.properties.title).toBe('I-90 EB');
  });

  it('returns no features for empty or malformed input', () => {
    expect(parseErsEvents('')).toEqual([]);
    expect(parseErsEvents('<html>Service Unavailable</html>')).toEqual([]);
    expect(parseErsEvents('<ERSEvents><Events><Event><EventId>9</EventId>')).toEqual([]);
    expect(parseErsEvents(undefined)).toEqual([]);
  });
});
