import { describe, expect, it } from 'vitest';
import { CONFIG } from '../feeds/config.js';
import {
  OFFICIAL_COLORS, PALETTE, PALETTE_DIM, PALETTE_GROUPS, PLANE_BANDS, VESSEL_BANDS,
  PALETTE_START, assignPalette, groundFill, hashIndex, lightPaint, paletteColorFor, planeBand, routeShade, vesselBand,
} from './palette.js';

const BG = '#0b0f14';
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const distance = (a: string, b: string) => {
  const [p, q] = [rgb(a), rgb(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
const hue = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
};
const lightness = (hex: string) => {
  const v = rgb(hex).map((x) => x / 255);
  return (Math.max(...v) + Math.min(...v)) / 2;
};

describe('PALETTE', () => {
  it('has 16 lowercase hex colors', () => {
    expect(PALETTE).toHaveLength(16);
    for (const c of PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(PALETTE_DIM).toHaveLength(16);
    for (const c of PALETTE_DIM) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('slot 0 is the bus yellow', () => {
    expect(PALETTE[0]).toBe(CONFIG.BUS_COLOR);
  });
  it('every color reads at 3:1 against the map background', () => {
    for (const c of [...PALETTE, ...PALETTE_DIM]) expect(contrast(c, BG), c).toBeGreaterThanOrEqual(3);
  });
  it('colors are pairwise distinct (RGB distance >= 70)', () => {
    for (let i = 0; i < PALETTE.length; i++) {
      for (let j = i + 1; j < PALETTE.length; j++) {
        expect(distance(PALETTE[i], PALETTE[j]), `${PALETTE[i]} vs ${PALETTE[j]}`).toBeGreaterThanOrEqual(70);
      }
    }
  });
  it('stays 70+ RGB away from subway and official operator colors', () => {
    const fixed = ['#da291c', '#ed8b00', '#00843d', '#003da5', ...Object.values(OFFICIAL_COLORS)];
    for (const c of PALETTE) for (const f of fixed) expect(distance(c, f), `${c} vs ${f}`).toBeGreaterThanOrEqual(70);
  });
  it('dim colors are darker than their bright twins', () => {
    PALETTE.forEach((c, i) => expect(luminance(PALETTE_DIM[i])).toBeLessThan(luminance(c)));
  });
});

describe('assignPalette', () => {
  const stats = [
    { key: 'a', routes: 3, live: 1 },
    { key: 'b', routes: 10, live: 0 },
    { key: 'c', routes: 3, live: 5 },
    { key: 'd', routes: 3, live: 5 },
  ];
  it('ranks by routes, then live, then key', () => {
    const m = assignPalette('bus', stats);
    expect(m.get('b')).toBe(PALETTE[0]);
    expect(m.get('c')).toBe(PALETTE[1]);
    expect(m.get('d')).toBe(PALETTE[2]);
    expect(m.get('a')).toBe(PALETTE[3]);
  });
  it('is order-insensitive', () => {
    const a = assignPalette('bus', stats);
    const b = assignPalette('bus', [...stats].reverse());
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });
  it('uses the dim palette for ranks 16-31 and hashes beyond', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ key: `k${String(i).padStart(2, '0')}`, routes: 100 - i, live: 0 }));
    const m = assignPalette('bus', many);
    expect(m.get('k15')).toBe(PALETTE[15]);
    expect(m.get('k16')).toBe(PALETTE_DIM[0]);
    expect(m.get('k31')).toBe(PALETTE_DIM[15]);
    expect(m.get('k35')).toBe(PALETTE_DIM[hashIndex('bus:k35', 16)]);
  });
  it('starts each group on its own hue so modes never share a top color', () => {
    const one = [{ key: 'top', routes: 5, live: 0 }, { key: 'next', routes: 1, live: 0 }];
    expect(assignPalette('bus', one).get('top')).toBe('#f2b84b');
    expect(assignPalette('ferry', one).get('top')).toBe('#00cdef');
    expect(assignPalette('commuter', one).get('top')).toBe('#a378d4');
    expect(assignPalette('air-service', one).get('top')).toBe('#48c9ff');
    expect(assignPalette('ferry', one).get('next')).toBe(PALETTE[(PALETTE_START.ferry + 1) % 16]);
    expect(assignPalette('unknown-group', one).get('top')).toBe(PALETTE[0]);
  });
  it('rotates the dim palette with the same start and stays deterministic', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ key: `k${String(i).padStart(2, '0')}`, routes: 100 - i, live: 0 }));
    const m = assignPalette('ferry', many);
    const start = PALETTE_START.ferry;
    expect(m.get('k00')).toBe(PALETTE[start]);
    expect(m.get('k15')).toBe(PALETTE[(start + 15) % 16]);
    expect(m.get('k16')).toBe(PALETTE_DIM[start]);
    expect(m.get('k31')).toBe(PALETTE_DIM[(start + 15) % 16]);
    expect(m.get('k35')).toBe(PALETTE_DIM[hashIndex('ferry:k35', 16)]);
    expect([...assignPalette('ferry', [...many].reverse())].sort()).toEqual([...m].sort());
  });
  it('hashIndex is stable and bounded', () => {
    expect(hashIndex('x', 16)).toBe(hashIndex('x', 16));
    for (const s of ['a', 'bus:foo', '']) expect(hashIndex(s, 16)).toBeLessThan(16);
  });
});

describe('paletteColorFor', () => {
  const none = new Map<string, Map<string, string>>();
  it('official colors beat the palette', () => {
    const assignment = new Map([['commuter', new Map([['mbta', '#123456']])]]);
    expect(OFFICIAL_COLORS['commuter:mbta']).toBe('#80276c');
    expect(paletteColorFor('commuter', 'mbta', assignment, '#000000')).toBe('#80276c');
    expect(OFFICIAL_COLORS['commuter:metro-north']).toBe('#ee0034');
    expect(OFFICIAL_COLORS['commuter:hartford-line']).toBe('#0070c0');
  });
  it('uses the assignment, then the hash for unassigned palette groups', () => {
    const assignment = new Map([['bus', new Map([['mbta-bus', '#abcdef']])]]);
    expect(paletteColorFor('bus', 'mbta-bus', assignment, '#000000')).toBe('#abcdef');
    expect(paletteColorFor('bus', 'new-agency', none, '#000000')).toBe(PALETTE_DIM[hashIndex('bus:new-agency', 16)]);
  });
  it('non-palette groups keep the fallback', () => {
    expect(PALETTE_GROUPS).toEqual(['bus', 'ferry', 'commuter', 'air-service']);
    expect(paletteColorFor('amtrak', 'amtrak', none, '#00a3e0')).toBe('#00a3e0');
  });
});

describe('routeShade', () => {
  it('returns the operator color for a single-route operator', () => {
    expect(routeShade('#f2b84b', '1', 1)).toBe('#f2b84b');
  });
  it('is deterministic, lowercase hex, and stays within the bounds', () => {
    for (const id of ['1', '66', 'CT1', 'Red-Line', 'x']) {
      const s = routeShade('#4d9fec', id, 5);
      expect(s).toMatch(/^#[0-9a-f]{6}$/);
      expect(routeShade('#4d9fec', id, 5)).toBe(s);
      const dh = Math.abs(((hue(s) - hue('#4d9fec') + 540) % 360) - 180);
      expect(dh).toBeLessThanOrEqual(15);
      expect(Math.abs(lightness(s) - lightness('#4d9fec'))).toBeLessThanOrEqual(0.11);
    }
  });
  it('accepts uppercase hex', () => {
    expect(routeShade('#4D9FEC', '66', 5)).toBe(routeShade('#4d9fec', '66', 5));
  });
  it('keeps shades of dim colors readable (3:1)', () => {
    for (const base of PALETTE_DIM) {
      for (const id of ['1', '2', '3', '66', 'CT1', 'x', 'Red-Line', '9']) {
        expect(contrast(routeShade(base, id, 5), BG), `${base} ${id}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it('gives different routes different shades', () => {
    const shades = new Set(['1', '2', '3', '4', '5', '6'].map((id) => routeShade('#4d9fec', id, 6)));
    expect(shades.size).toBeGreaterThan(2);
  });
  it('darkens a light-ground shade to 3:1 on pale land and does not lighten it back', () => {
    const pale = '#e8e4dc';
    for (const base of ['#f2b84b', '#9be1ff', '#ed8b00', ...PALETTE_DIM]) {
      for (const id of ['1', '66', 'CT1', 'x']) {
        const shade = routeShade(base, id, 5, 'light');
        expect(contrast(shade, pale), `${base} ${id}`).toBeGreaterThanOrEqual(3);
        expect(lightness(shade), `${base} ${id}`).toBeLessThanOrEqual(lightness(base) + 0.11);
      }
    }
    for (const id of ['1', '66', 'CT1']) {
      expect(lightness(routeShade('#f2b84b', id, 5, 'light'))).toBeLessThan(lightness('#f2b84b'));
    }
    expect(routeShade('#f2b84b', '1', 1, 'light')).toBe('#f2b84b');
  });
});

describe('groundFill', () => {
  const pale = '#e8e4dc';
  const brands = ['#003da5', '#80276c', '#ee0034', '#0070c0', '#da291c', '#00843d'];

  it('keeps dark and imagery fills, including brands that the light casing carries', () => {
    for (const color of [...PALETTE, ...brands, '#9be1ff']) {
      expect(groundFill(color, 'dark')).toBe(color);
      expect(groundFill(color, 'imagery')).toBe(color);
    }
  });

  it('darkens only the fills that miss 3:1 on pale land', () => {
    for (const color of brands) {
      expect(contrast(color, pale), color).toBeGreaterThanOrEqual(3);
      expect(groundFill(color, 'light')).toBe(color);
    }
    for (const color of ['#f2b84b', '#ed8b00', '#9be1ff']) {
      const filled = groundFill(color, 'light');
      expect(contrast(color, pale), color).toBeLessThan(3);
      expect(contrast(filled, pale), color).toBeGreaterThanOrEqual(3);
      expect(lightness(filled)).toBeLessThan(lightness(color));
    }
  });

  it('paints a light-ground route without replacing the bright identity color', () => {
    const paint = lightPaint('#f2b84b', '#f2b84b', '#e0a030', '66', 4);
    expect(paint.mapColor).not.toBe('#f2b84b');
    expect(contrast(paint.mapColor!, pale)).toBeGreaterThanOrEqual(3);
    expect(contrast(paint.mapRouteColor!, pale)).toBeGreaterThanOrEqual(3);
    expect(paint.mapRouteColor).not.toBe(paint.mapColor);
    const blue = lightPaint('#003da5', undefined, undefined, '', 0);
    expect(blue).toEqual({ mapColor: '#003da5', mapRouteColor: '#003da5' });
  });
});

describe('vesselBand', () => {
  it('maps AIS ship types to bands', () => {
    expect(vesselBand(60).key).toBe('passenger');
    expect(vesselBand(79).key).toBe('cargo');
    expect(vesselBand(84).key).toBe('tanker');
    expect(vesselBand(52).key).toBe('workboat');
    expect(vesselBand(30).key).toBe('fishing');
    expect(vesselBand(37).key).toBe('pleasure');
    expect(vesselBand(42).key).toBe('high-speed');
    expect(vesselBand(0).key).toBe('other');
    expect(vesselBand(undefined).key).toBe('other');
    expect(vesselBand(NaN).key).toBe('other');
  });
  it('lists every band with a color', () => {
    expect(VESSEL_BANDS.map((b) => b.key)).toEqual(
      ['passenger', 'cargo', 'tanker', 'workboat', 'fishing', 'pleasure', 'high-speed', 'other']);
    for (const b of VESSEL_BANDS) expect(b.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('planeBand', () => {
  it('bands altitude in feet', () => {
    expect(PLANE_BANDS).toHaveLength(3);
    expect(planeBand(5000).key).toBe('low');
    expect(planeBand(10000).key).toBe('mid');
    expect(planeBand(25000).key).toBe('mid');
    expect(planeBand(25001).key).toBe('high');
    expect(planeBand(undefined).key).toBe('low');
  });
});
