import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Legend } from './Legend.js';
import { setVisibleGroupList } from '../stores/layers.js';
import { LEGEND_GROUPS, STALE_NOTE } from '../model/legendConfig.js';
import {
  setLegendCollapsed,
  setLegendZoom,
  setLiveKeyCounts,
  setSubwayColors,
  setRouteKeyIndex,
  setViewportRoutes,
} from '../stores/legend.js';

let root: HTMLElement;
const $ = (sel: string) => root.querySelector(sel);
const $$ = (sel: string) => [...root.querySelectorAll(sel)];
const BUS = LEGEND_GROUPS.bus.name;
const sectionNames = () => $$('.legend-section-name').map((el) => el.textContent);

function mount() {
  act(() => render(<Legend />, root));
}

describe('Legend', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* storage blocked */ }
    root = document.createElement('div');
    document.body.appendChild(root);
    setVisibleGroupList([]);
    setRouteKeyIndex(new Map());
    setLiveKeyCounts(new Map());
    setViewportRoutes(new Map());
    setLegendZoom(10);
    setLegendCollapsed(false);
    try { localStorage.clear(); } catch { /* storage blocked */ }
  });

  afterEach(() => {
    act(() => render(null, root));
    root.remove();
  });

  it('renders a labelled key with a region header', () => {
    mount();
    expect($('aside.legend')!.getAttribute('aria-label')).toBe('Map key');
    expect($('.legend-head')!.textContent).toContain('Key');
  });

  it('adds and removes sections as groups switch on and off', () => {
    mount();
    expect(sectionNames()).toEqual([]);
    act(() => setVisibleGroupList(['ferry', 'bus']));
    expect(sectionNames()).toEqual([BUS, 'Ferries']);
    act(() => setVisibleGroupList(['ferry']));
    expect(sectionNames()).toEqual(['Ferries']);
  });

  it('collapses and expands, remembering the choice', () => {
    act(() => setVisibleGroupList(['bus']));
    mount();
    const toggle = $('.legend-head') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('legend-body');
    expect(($('#legend-body') as HTMLElement).hidden).toBe(true);
    expect(localStorage.getItem('motion-legend')).toBe('collapsed');
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(sectionNames()).toEqual([BUS]);
  });

  it('shows operator rows with counts and expands "+N more"', () => {
    const ops = Array.from({ length: 15 }, (_, i) => [`op${i}`, { label: `Op ${i}`, routes: 100 - i, stops: 0 }] as const);
    act(() => {
      setRouteKeyIndex(new Map([['bus', new Map(ops)]]));
      setLiveKeyCounts(new Map([['bus', new Map([['op0', { n: 7 }]])]]));
      setVisibleGroupList(['bus']);
    });
    mount();
    expect($$('.legend-row')).toHaveLength(12);
    expect($('.legend-row')!.textContent).toContain('Op 0');
    expect($('.legend-row')!.textContent).toContain('7 live');
    expect($('.legend-row')!.textContent).toContain('100 routes');
    expect($('.legend-row .legend-swatch')!.getAttribute('style')).toContain('--c:');
    const more = $('.legend-more') as HTMLButtonElement;
    expect(more.textContent).toBe('+3 more');
    act(() => more.click());
    expect($$('.legend-row')).toHaveLength(15);
  });

  it('switches to the routes in view when zoomed in', () => {
    act(() => {
      setRouteKeyIndex(new Map([['bus', new Map([['mbta', { label: 'MBTA', routes: 150, stops: 0 }]])]]));
      setViewportRoutes(new Map([['bus', new Map([
        ['1', { label: 'Route 1', color: '#aaaaaa', operatorKey: 'mbta', operatorLabel: 'MBTA', live: true }],
      ])]]));
      setVisibleGroupList(['bus']);
    });
    mount();
    expect($$('.legend-row').map((r) => r.textContent)).toEqual([expect.stringContaining('MBTA')]);
    act(() => setLegendZoom(14));
    expect($('.legend-operator')!.textContent).toContain('MBTA');
    expect($$('.legend-row').map((r) => r.textContent)).toEqual([expect.stringContaining('Route 1')]);
  });

  it('shows one Subway section with a row per line that is on', () => {
    act(() => {
      setSubwayColors(new Map([['red', '#da291c'], ['orange', '#ed8b00']]));
      setVisibleGroupList(['red', 'orange', 'bus']);
    });
    mount();
    expect(sectionNames()).toEqual(['Subway', BUS]);
    const subway = $('.legend-section')!;
    expect([...subway.querySelectorAll('.legend-label')].map((e) => e.textContent)).toEqual(['Red Line', 'Orange Line']);
    act(() => setVisibleGroupList(['orange']));
    expect([...$('.legend-section')!.querySelectorAll('.legend-label')].map((e) => e.textContent)).toEqual(['Orange Line']);
  });

  it('shows the stale note exactly once, as a footer', () => {
    act(() => setVisibleGroupList(['red', 'bus', 'ferry', 'commuter']));
    mount();
    const hits = [...root.querySelectorAll('p')].filter((p) => p.textContent?.includes(STALE_NOTE));
    expect(hits).toHaveLength(1);
    expect(hits[0].classList.contains('legend-footer')).toBe(true);
  });

  it('says so when no routes are in view while zoomed in', () => {
    act(() => {
      setVisibleGroupList(['bus']);
      setLegendZoom(15);
    });
    mount();
    expect($('.legend-section .legend-empty')!.textContent).toBe('No routes in view');
  });

  it('shows notes as a muted line', () => {
    act(() => setVisibleGroupList(['ev-charging']));
    mount();
    expect($('.legend-notes')!.textContent).toBe('White ring = DC fast charging');
  });
});
