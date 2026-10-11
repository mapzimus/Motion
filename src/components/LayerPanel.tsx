// The layer list: every switch, with the map key for each switched-on group
// nested under its row. One list replaces the old panel rows plus the
// separate right-hand key. Renders the stores; the map is driven by effects.
import { glyphSvgPath } from '../map/glyphs.js';
import { regionName, hasSubway } from '../feeds/regions.js';
import { LEGEND_GROUPS, STALE_NOTE, type LegendGlyph } from '../model/legendConfig.js';
import { SECTIONS, type GroupDef, type SectionKey } from '../model/groups.js';
import { VIEWPORT_GROUPS, type LegendRowView, type LegendSection, type OperatorBlock } from '../model/legendRows.js';
import { SUBWAY_GROUPS } from '../model/presets.js';
import {
  countsBySource, scheduledCounts, stationCounts, referenceCounts,
} from '../stores/counts.js';
import {
  groups, groupOn, collapsedSections, closedKeys, alertBadges,
  setGroupOn, setGroupsOn, toggleSection, toggleKey, askZoom, clearActivePreset,
} from '../stores/layers.js';
import { askDrill, drillLegend, legendSections, type DrillLegendState } from '../stores/legend.js';
import { region } from '../stores/region.js';

// ---- pure helpers -----------------------------------------------------------

type SwatchKind = 'line' | 'glyph' | 'ring' | 'dot' | 'area';

const RING_GROUPS = new Set(['taxi', 'drawbridge', 'camera']);
const GLYPH_GROUPS = new Set(['local', 'plane', 'vessel', 'bike', 'bikeshare']);

/** How a group's color sample is drawn: ribbon, vehicle shape, ring, dot or area. */
export function swatchKind(group: string, glyph: LegendGlyph): SwatchKind {
  if (RING_GROUPS.has(group)) return 'ring';
  if (SUBWAY_GROUPS.includes(group) || VIEWPORT_GROUPS.includes(group) || glyph === 'line') return 'line';
  if (GLYPH_GROUPS.has(group)) return 'glyph';
  if (glyph === 'area') return 'area';
  return 'dot';
}

export interface CountView { main: string; sub?: string; title?: string; pending?: boolean }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The count cell for a row. `live` is null until any feed has reported for
 * the group (shown as a pending "…"), 0 when feeds reported nothing.
 */
export function countView(
  group: GroupDef,
  live: number | null,
  scheduled: number,
  stations: number,
  references: number,
  anyFeed: boolean,
): CountView {
  const secondary = [
    scheduled ? plural(scheduled, 'route') : '',
    stations ? plural(stations, 'stop') : '',
  ].filter(Boolean).join(' · ');
  if (secondary) {
    return {
      main: live ? `${live} live` : '',
      sub: secondary,
      title: `${plural(live ?? 0, 'live vehicle')} · ${secondary}`,
    };
  }
  if (references && live) {
    return { main: `${live} live`, sub: `${references} mapped`, title: `${live} live · ${references} mapped reference features` };
  }
  if (references) {
    return { main: String(references), sub: 'mapped', title: plural(references, 'mapped reference feature') };
  }
  if (group.overlay) return { main: 'overlay', title: 'Map overlay; it has no feature count' };
  if (live === null) return anyFeed ? { main: '–' } : { main: '…', pending: true, title: 'Waiting for the first update' };
  return { main: String(live) };
}

function onActivate(event: { key: string; preventDefault: () => void }, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
}

// ---- swatches ---------------------------------------------------------------

const GLYPH_SHAPE: Partial<Record<LegendGlyph, string>> = {
  bus: 'bus', boat: 'boat', plane: 'plane', bike: 'dock', rail: 'train',
};

function Glyph({ glyph, color = 'currentColor' }: { glyph: LegendGlyph; color?: string }) {
  const shape = GLYPH_SHAPE[glyph];
  let body;
  if (shape) body = <path d={glyphSvgPath(shape)} fill={color} />;
  else if (glyph === 'line') body = <path d="M6 44C22 44 26 20 58 20" stroke={color} stroke-width="9" fill="none" stroke-linecap="round" />;
  else if (glyph === 'area') body = <rect x="8" y="12" width="48" height="40" rx="8" fill={color} fill-opacity="0.45" stroke={color} stroke-width="4" />;
  else body = <circle cx="32" cy="32" r="16" fill={color} />;
  return <svg class="legend-glyph" viewBox="0 0 64 64" aria-hidden="true">{body}</svg>;
}

function Swatch({ kind, glyph, color }: { kind: SwatchKind; glyph: LegendGlyph; color: string }) {
  return (
    <span class={`legend-swatch ${kind}`} style={`--c: ${color}`} aria-hidden="true">
      {kind === 'glyph' && <Glyph glyph={glyph} color={color} />}
    </span>
  );
}

// ---- key rows (the old legend body) ------------------------------------------

function KeyRow({ row, kind, glyph, onPick, dimmed }: {
  row: LegendRowView;
  kind: SwatchKind;
  glyph: LegendGlyph;
  onPick?: (row: LegendRowView) => void;
  dimmed?: boolean;
}) {
  const pick = onPick ? (event: Event) => { event.stopPropagation(); onPick(row); } : undefined;
  return (
    <li
      class={`legend-row${onPick ? ' drillable' : ''}${dimmed ? ' dimmed' : ''}`}
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? 0 : undefined}
      title={onPick ? `Show ${row.label}` : undefined}
      onClick={pick}
      onKeyDown={onPick ? (event) => onActivate(event, () => onPick(row)) : undefined}
    >
      <Swatch kind={kind} glyph={glyph} color={row.color} />
      <span class="legend-label">{row.label}</span>
      {row.moving && <span class="legend-live-dot" title="Live vehicle in view" />}
      <span class="legend-counts">
        {row.live ? <span class="num">{row.live} live</span> : null}
        {row.routes ? <span class="num">{row.routes} {row.routes === 1 ? 'route' : 'routes'}</span> : null}
      </span>
    </li>
  );
}

function KeyRows({ rows, extra, kind, glyph, onPick, selectedKey, expandKey }: {
  rows: LegendRowView[];
  extra: LegendRowView[];
  kind: SwatchKind;
  glyph: LegendGlyph;
  onPick?: (row: LegendRowView) => void;
  selectedKey?: string | null;
  /** Identifies this list in `closedKeys` for its "+N more" state. */
  expandKey: string;
}) {
  const open = closedKeys.value.has(expandKey);
  const shown = open ? [...rows, ...extra] : rows;
  if (!shown.length) return null;
  return (
    <>
      <ul class="legend-rows">
        {shown.map((row) => (
          <KeyRow key={row.key} row={row} kind={kind} glyph={glyph} onPick={onPick}
            dimmed={Boolean(selectedKey && selectedKey !== row.key)} />
        ))}
      </ul>
      {extra.length > 0 && (
        <button type="button" class="legend-more" aria-expanded={open} onClick={() => toggleKey(expandKey)}>
          {open ? 'Show fewer' : `+${extra.length} more`}
        </button>
      )}
    </>
  );
}

function Operator({ block, glyph, onRoute }: {
  block: OperatorBlock;
  glyph: LegendGlyph;
  onRoute?: (row: LegendRowView) => void;
}) {
  return (
    <div class="legend-operator">
      <div class="legend-operator-name" style={`--c: ${block.color}`}>{block.label}</div>
      <KeyRows rows={block.rows} extra={block.extra} kind="line" glyph={glyph} onPick={onRoute} expandKey={`more:${block.key}`} />
    </div>
  );
}

/** A group's key, nested under its row: operator rows, routes in view, fixed rows, notes. */
function KeyBlock({ section }: { section: LegendSection }) {
  const kind = swatchKind(section.group, section.glyph);
  const drillable = Boolean(LEGEND_GROUPS[section.group]?.drillable);
  const onRow = drillable
    ? (row: LegendRowView) => askDrill(section.group, { operator: row.key, operatorLabel: row.label })
    : undefined;
  return (
    <div class="key-block" data-group={section.group}>
      <KeyRows rows={section.rows} extra={section.extra} kind={kind} glyph={section.glyph} onPick={onRow} expandKey={`more:${section.group}`} />
      {section.operators?.map((block) => (
        <Operator key={block.key} block={block} glyph={section.glyph}
          onRoute={drillable
            ? (row) => askDrill(section.group, { operator: block.key, operatorLabel: block.label, route: row.key })
            : undefined} />
      ))}
      {section.operators?.length === 0 && <p class="legend-empty">No routes in view</p>}
      {section.notes.length > 0 && <p class="legend-notes">{section.notes.join(' · ')}</p>}
    </div>
  );
}

function hasKeyContent(section: LegendSection | undefined): section is LegendSection {
  return Boolean(section && (section.rows.length || section.operators || section.notes.length));
}

// ---- rows and sections --------------------------------------------------------

function liveFor(key: string): { live: number | null; anyFeed: boolean } {
  let live: number | null = null;
  const sources = countsBySource.value;
  for (const sourceMap of sources.values()) {
    const n = sourceMap.get(key);
    if (n === null || n === undefined) continue;
    live = (live ?? 0) + n;
  }
  return { live, anyFeed: sources.size > 0 };
}

function GroupRow({ group, keySection }: { group: GroupDef; keySection: LegendSection | undefined }) {
  const on = Boolean(groupOn.value.get(group.key));
  const config = LEGEND_GROUPS[group.key];
  const glyph: LegendGlyph = config?.glyph ?? 'dot';
  const kind = swatchKind(group.key, glyph);
  const color = group.color ?? '#39424c';
  const { live, anyFeed } = liveFor(group.key);
  const count = countView(
    group, live,
    scheduledCounts.value.get(group.key) ?? 0,
    stationCounts.value.get(group.key) ?? 0,
    referenceCounts.value.get(group.key) ?? 0,
    anyFeed,
  );
  const badge = alertBadges.value.get(group.key);
  const drillable = Boolean(config?.drillable) && !group.needsKey;
  const zoomable = !group.needsKey && group.zoomable !== false;
  const showKey = on && !SUBWAY_GROUPS.includes(group.key) && hasKeyContent(keySection);
  const keyOpen = showKey && !closedKeys.value.has(group.key);

  const activate = () => {
    if (!on) setGroupOn(group.key, true, true);
    clearActivePreset();
    if (drillable) askDrill(group.key);
    else askZoom(group.key);
  };
  const toggle = (event: Event) => {
    setGroupOn(group.key, (event.target as HTMLInputElement).checked, true);
    clearActivePreset();
  };

  return (
    <div class={`line-row${on ? ' on' : ''}${group.needsKey ? ' needs-key' : ''}`} data-key={group.key} data-section={group.section}>
      <div class="line-main">
        <Swatch kind={kind} glyph={glyph} color={color} />
        <span class="line-name">
          {zoomable ? (
            <button
              type="button"
              class={`line-label${drillable ? ' drillable' : ''}`}
              title={drillable ? `Explore ${group.name} by route` : `Zoom to ${group.name}`}
              onClick={activate}
            >{group.name}</button>
          ) : <span class="line-label">{group.name}</span>}
          {badge && <span class={`badge ${badge}`} />}
          <span class="line-meta">
            <span class={`count${count.pending ? ' pending' : ''}`} title={count.title}>
              {count.main && <strong>{count.main}</strong>}
              {count.sub && <small>{count.sub}</small>}
            </span>
            {group.truth && <span class="truth-tag">{group.truth}</span>}
            {group.needsKey && (
              <a class="get-key" href={group.keyUrl} target="_blank" rel="noopener"
                title="This layer needs the Motion gateway — see the README">{group.setupText ?? 'setup'}</a>
            )}
          </span>
        </span>
        {showKey && (
          <button type="button" class="key-toggle" aria-expanded={keyOpen} aria-label={`${keyOpen ? 'Hide' : 'Show'} the ${group.name} key`}
            onClick={() => toggleKey(group.key)}>
            <span class="section-chevron" aria-hidden="true">⌄</span>
          </button>
        )}
        <label class="switch">
          <input type="checkbox" checked={on} disabled={group.needsKey} aria-label={`Toggle ${group.name}`} onChange={toggle} />
          <span class="knob" />
        </label>
      </div>
      {keyOpen && <KeyBlock section={keySection} />}
    </div>
  );
}

function Section({ section, rows, keyByGroup }: {
  section: { key: SectionKey; name: string };
  rows: GroupDef[];
  keyByGroup: Map<string, LegendSection>;
}) {
  const collapsed = collapsedSections.value.has(section.key);
  const on = rows.filter((group) => groupOn.value.get(group.key));
  const switchable = rows.filter((group) => !group.needsKey).map((group) => group.key);
  const flip = (event: Event) => {
    setGroupsOn(switchable, (event.target as HTMLInputElement).checked, true);
    clearActivePreset();
  };
  return (
    <section class="layer-section" data-section={section.key}>
      <div class="layer-subhead-row">
        <button type="button" class="layer-subhead" aria-expanded={!collapsed} onClick={() => toggleSection(section.key)}>
          <span class="section-chevron" aria-hidden="true">⌄</span>
          <span class="section-name">{section.name}</span>
          <span class="section-count num">{on.length ? `${on.length} on` : ''}</span>
        </button>
        <label class="switch section-switch">
          <input type="checkbox" checked={on.length > 0} disabled={!switchable.length}
            aria-label={`Toggle every ${section.name} layer`} onChange={flip} />
          <span class="knob" />
        </label>
      </div>
      {!collapsed && rows.map((group) => (
        <GroupRow key={group.key} group={group} keySection={keyByGroup.get(group.key)} />
      ))}
    </section>
  );
}

// ---- drill mode ---------------------------------------------------------------

function DrillView({ drill, section }: { drill: DrillLegendState; section: LegendSection | undefined }) {
  const group = groups.value.find((item) => item.key === drill.group);
  const config = LEGEND_GROUPS[drill.group];
  const glyph: LegendGlyph = config?.glyph ?? 'dot';
  const title = drill.operatorLabel ?? group?.name ?? drill.group;
  const back = () => askDrill(null);
  const onRow = (row: LegendRowView) => askDrill(drill.group, {
    operator: drill.operator,
    operatorLabel: drill.operatorLabel,
    route: drill.route === row.key ? null : row.key,
  });
  return (
    <div class="drill" data-group={drill.group}>
      <button type="button" class="drill-header" onClick={back}>
        <span class="drill-back" aria-hidden="true">←</span>
        <Swatch kind={swatchKind(drill.group, glyph)} glyph={glyph} color={group?.color ?? '#39424c'} />
        <span class="drill-title">{title} · {drill.vehicles} vehicles</span>
      </button>
      {drill.operatorLabel && group && <p class="legend-notes">{group.name}</p>}
      {section && (
        <KeyRows rows={section.rows} extra={section.extra} kind="line" glyph={glyph}
          onPick={onRow} selectedKey={drill.route} expandKey={`more:drill`} />
      )}
      {!drill.rows.length && <p class="legend-empty">No vehicles reporting right now.</p>}
    </div>
  );
}

// ---- panel --------------------------------------------------------------------

export function LayerPanel() {
  const defs = groups.value;
  const drill = drillLegend.value;
  const sections = legendSections.value;
  const keyByGroup = new Map(sections.map((section) => [section.group, section]));
  const subway = hasSubway(region.value);
  const fades = defs.some((group) => groupOn.value.get(group.key) && LEGEND_GROUPS[group.key]?.fades);

  if (drill) return <DrillView drill={drill} section={sections[0]} />;
  return (
    <div class="layer-list" aria-label={`Layers · ${regionName(region.value)}`}>
      {SECTIONS.filter((section) => section.key !== 'subway' || subway).map((section) => {
        const rows = defs.filter((group) => group.section === section.key);
        return rows.length ? <Section key={section.key} section={section} rows={rows} keyByGroup={keyByGroup} /> : null;
      })}
      {fades && <p class="legend-footer">{STALE_NOTE}</p>}
    </div>
  );
}
