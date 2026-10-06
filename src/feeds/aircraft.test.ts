import { describe, expect, it } from 'vitest';
import { PLANE_ICON_BY_KIND, aircraftKind, emergencyLine, planeIcon, verticalTrend } from './aircraft.js';
import { tripCardData } from './trip-data.js';

describe('aircraft icon selection', () => {
  it('follows the ADS-B emitter category', () => {
    expect(planeIcon('A1', 'C172')).toBe('icon-plane-light');
    expect(planeIcon('A2', 'CRJ2')).toBe('icon-plane-light');
    expect(planeIcon('A3', 'A320')).toBe('icon-plane');
    expect(planeIcon('A4', 'B752')).toBe('icon-plane');
    expect(planeIcon('A5', 'B77W')).toBe('icon-plane');
    expect(planeIcon('A7', 'EC35')).toBe('icon-plane-heli');
    expect(planeIcon('B1', 'GLID')).toBe('icon-plane-other');
    expect(planeIcon('B2', '')).toBe('icon-plane-other');
    expect(planeIcon('C1', '')).toBe('icon-plane-other');
  });

  it('category wins over a type code that suggests otherwise', () => {
    expect(aircraftKind('A3', 'R44')).toBe('airliner');
    expect(aircraftKind('a7', 'A320')).toBe('heli');
  });

  it('falls back to the type code when no category is sent', () => {
    expect(aircraftKind(null, 'R44')).toBe('heli');
    expect(aircraftKind('A0', 'EC45')).toBe('heli');
    expect(aircraftKind('', 'C172')).toBe('light');
    expect(aircraftKind(undefined, 'P28A')).toBe('light');
    expect(aircraftKind(null, 'C402')).toBe('light'); // Cape Air
    expect(aircraftKind(null, 'E75L')).toBe('airliner'); // unknown jets keep the airliner shape
    expect(aircraftKind(null, '')).toBe('other');
  });

  it('every kind maps to a distinct icon', () => {
    expect(new Set(Object.values(PLANE_ICON_BY_KIND)).size).toBe(4);
    expect(PLANE_ICON_BY_KIND.airliner).toBe('icon-plane');
  });
});

describe('emergency line', () => {
  it('names the emergency squawks', () => {
    expect(emergencyLine('7700', 'none')).toBe('Squawking 7700 · general emergency');
    expect(emergencyLine('7600', null)).toBe('Squawking 7600 · radio failure');
    expect(emergencyLine('7500', undefined)).toBe('Squawking 7500 · unlawful interference');
  });

  it('prefers the decoded emergency status when both are present', () => {
    expect(emergencyLine('7700', 'minfuel')).toBe('Squawking 7700 · minimum fuel');
  });

  it('reports an emergency status without an emergency squawk', () => {
    expect(emergencyLine('2731', 'general')).toBe('Emergency status · general emergency');
    expect(emergencyLine(null, 'nordo')).toBe('Emergency status · radio failure');
    expect(emergencyLine(null, 'something-new')).toBe('Emergency status · emergency');
  });

  it('stays quiet for normal traffic', () => {
    expect(emergencyLine('1200', 'none')).toBe('');
    expect(emergencyLine(null, null)).toBe('');
  });

  it('reads the vertical trend only outside level flight', () => {
    expect(verticalTrend(1200)).toBe('climbing');
    expect(verticalTrend(-704)).toBe('descending');
    expect(verticalTrend(128)).toBe('');
    expect(verticalTrend(null)).toBe('');
  });
});

describe('plane trip card', () => {
  const plane = (props: Record<string, unknown>) => ({
    id: 'plane-a1b2c3',
    lng: -71,
    lat: 42.3,
    props: {
      group: 'plane', color: '#9be1ff', title: 'JBU1123', callsign: 'JBU1123', dest: 'A320',
      status: '3,500 ft · descending · 209 mph', meta: 'N123JB · icao a1b2c3', updatedAt: '', ...props,
    },
  });

  it('shows the emergency line', () => {
    const card = tripCardData('plane', plane({ alert: 'Squawking 7700 · general emergency' }), null);
    expect(card?.alert).toBe('Squawking 7700 · general emergency');
  });

  it('shows helicopters generically', () => {
    const card = tripCardData('plane', plane({
      planeKind: 'heli', title: 'Helicopter', callsign: '', dest: 'EC35', meta: '', alert: '',
    }), null);
    expect(card).toMatchObject({ title: 'Helicopter', badge: 'EC35', meta: '', alert: '' });
    expect(card?.stopsNote).toBe('Helicopters are shown by type only, without callsign or registration.');
  });
});
