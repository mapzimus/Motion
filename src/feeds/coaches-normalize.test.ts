import { describe, expect, it } from 'vitest';
import { coachItem } from './coaches-normalize.js';

const NOW = Date.parse('2026-10-06T23:50:00Z');
const OPTS = { busColor: '#f2b84b', staleAfterMs: 10 * 60 * 1000 };
const coach = {
  id: 'pp_42.34660_-71.03876',
  lng: -71.03876,
  lat: 42.3466,
  bearing: 270,
  speedMph: 31,
  updatedAt: '2026-10-06T23:49:00Z',
  title: 'Peter Pan · BZ 200',
  dest: 'Boston, MA → Springfield, MA',
  route: 'BZ200',
};

describe('coachItem', () => {
  it('draws a moving coach as a Peter Pan bus with a heading', () => {
    const item = coachItem(coach, NOW, OPTS);
    expect(item.id).toBe('coaches-pp_42.34660_-71.03876');
    expect(item.props).toMatchObject({
      group: 'bus',
      legendKey: 'peter-pan',
      legendLabel: 'Peter Pan Bus Lines',
      shadeKey: 'peter-pan:BZ200',
      hasBearing: true,
      bearing: 270,
      status: '31 mph',
      title: 'Peter Pan · BZ 200',
      stale: false,
    });
  });

  it('keeps a C&J coach on its own legend entry', () => {
    const item = coachItem({
      ...coach,
      id: 'cj_43.05962_-70.80386',
      title: 'C&J · DVLG',
      dest: 'Dover, NH → Logan Airport',
      route: 'DVLG',
      legendKey: 'cj',
      legendLabel: 'C&J Bus Lines',
      provider: 'C&J Bus Lines',
      sourceUrl: 'https://bustracker.ridecj.com/',
      meta: 'C&J tracker',
    }, NOW, OPTS);
    expect(item.props).toMatchObject({
      group: 'bus',
      legendKey: 'cj',
      legendLabel: 'C&J Bus Lines',
      shadeKey: 'cj:DVLG',
      provider: 'C&J Bus Lines',
      sourceUrl: 'https://bustracker.ridecj.com/',
      meta: 'C&J tracker',
      title: 'C&J · DVLG',
    });
  });

  it('does not aim a parked coach north just because the azimuth is zero', () => {
    const item = coachItem({ ...coach, speedMph: 0, bearing: 0, updatedAt: '2026-10-06T23:30:00Z' }, NOW, OPTS);
    expect(item.props.hasBearing).toBe(false);
    expect(item.props.status).toBe('Stopped');
    expect(item.props.stale).toBe(true);
  });
});
