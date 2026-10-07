// The map key: one section per switched-on layer group with its glyph, operator
// or route rows, counts and notes. Renders the legend store; computes nothing.
import { useState } from 'preact/hooks';
import { askDrill, drillLegend, legendCollapsed, legendFooter, legendSections, setLegendCollapsed, type DrillLegendState } from '../stores/legend.js';
import { region } from '../stores/region.js';
import { regionName } from '../feeds/regions.js';
import { glyphSvgPath } from '../map/glyphs.js';
import { LEGEND_GROUPS, type LegendGlyph } from '../model/legendConfig.js';
import { VIEWPORT_GROUPS, type LegendRowView, type LegendSection, type OperatorBlock } from '../model/legendRows.js';

const drillableGroup = (group: string) => Boolean(LEGEND_GROUPS[group]?.drillable);

function onActivate(event: { key: string; preventDefault: () => void }, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
}

type SwatchKind = 'line' | 'glyph' | 'ring' | 'dot' | 'area';

const RING_GROUPS = new Set(['taxi', 'drawbridge', 'camera']);
const GLYPH_GROUPS = new Set(['local', 'plane', 'vessel', 'bike', 'bikeshare']);

/** How a row's color sample is drawn: ribbon, vehicle shape, ring, dot or area. */
function swatchKind(group: string, glyph: LegendGlyph): SwatchKind {
  if (RING_GROUPS.has(group)) return 'ring';
  if (group === 'subway' || VIEWPORT_GROUPS.includes(group) || glyph === 'line') return 'line';
  if (GLYPH_GROUPS.has(group)) return 'glyph';
  if (glyph === 'area') return 'area';
  return 'dot';
}

const GLYPH_SHAPE: Partial<Record<LegendGlyph, string>> = {
  bus: 'bus', boat: 'boat', plane: 'plane', bike: 'dock', rail: 'train',
};

/** The section's mode glyph as inline SVG on the 64-unit sprite grid. */
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

function Row({ row, kind, glyph, onPick, dimmed }: {
  row: LegendRowView;
  kind: SwatchKind;
  glyph: LegendGlyph;
  onPick?: (row: LegendRowView) => void;
  dimmed?: boolean;
}) {
  const pick = onPick
    ? (event: Event) => {
      event.stopPropagation();
      onPick(row);
    }
    : undefined;
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

function RowList({ rows, extra, kind, glyph, onPick, selectedKey }: {
  rows: LegendRowView[];
  extra: LegendRowView[];
  kind: SwatchKind;
  glyph: LegendGlyph;
  onPick?: (row: LegendRowView) => void;
  selectedKey?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? [...rows, ...extra] : rows;
  if (!shown.length) return null;
  return (
    <>
      <ul class="legend-rows">
        {shown.map((row) => (
          <Row
            key={row.key}
            row={row}
            kind={kind}
            glyph={glyph}
            onPick={onPick}
            dimmed={Boolean(selectedKey && selectedKey !== row.key)}
          />
        ))}
      </ul>
      {extra.length > 0 && (
        <button type="button" class="legend-more" aria-expanded={open} onClick={() => setOpen(!open)}>
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
      <RowList rows={block.rows} extra={block.extra} kind="line" glyph={glyph} onPick={onRoute} />
    </div>
  );
}

function Section({ section, drill }: { section: LegendSection; drill: DrillLegendState | null }) {
  const kind = swatchKind(section.group, section.glyph);
  const drilled = Boolean(drill);
  const headAction = drilled
    ? () => askDrill(null)
    : (drillableGroup(section.group) ? () => askDrill(section.group) : null);
  const onRow = drilled
    ? (row: LegendRowView) => askDrill(drill!.group, {
      operator: drill!.operator,
      operatorLabel: drill!.operatorLabel,
      route: drill!.route === row.key ? null : row.key,
    })
    : (section.group === 'subway'
      ? (row: LegendRowView) => { if (drillableGroup(row.key)) askDrill(row.key); }
      : (drillableGroup(section.group)
        ? (row: LegendRowView) => askDrill(section.group, { operator: row.key, operatorLabel: row.label })
        : undefined));
  return (
    <section class="legend-section">
      <h3
        class={`legend-section-head${headAction ? ' drillable' : ''}`}
        tabIndex={headAction ? 0 : undefined}
        title={drilled ? 'Back to all layers' : (headAction ? `Explore ${section.name} by route` : undefined)}
        onClick={headAction ?? undefined}
        onKeyDown={headAction ? (event) => onActivate(event, headAction) : undefined}
      >
        <Glyph glyph={section.glyph} />
        <span class="legend-section-name">{section.name}</span>
      </h3>
      <RowList
        rows={section.rows}
        extra={section.extra}
        kind={kind}
        glyph={section.glyph}
        onPick={onRow}
        selectedKey={drilled ? drill!.route : null}
      />
      {section.operators?.map((block) => (
        <Operator
          key={block.key}
          block={block}
          glyph={section.glyph}
          onRoute={drillableGroup(section.group)
            ? (row) => askDrill(section.group, { operator: block.key, operatorLabel: block.label, route: row.key })
            : undefined}
        />
      ))}
      {section.operators?.length === 0 && <p class="legend-empty">No routes in view</p>}
      {section.notes.length > 0 && <p class="legend-notes">{section.notes.join(' · ')}</p>}
    </section>
  );
}

export function Legend() {
  const collapsed = legendCollapsed.value;
  const sections = legendSections.value;
  const footer = legendFooter.value;
  const drill = drillLegend.value;
  return (
    <aside class={`legend${collapsed ? ' collapsed' : ''}`} aria-label="Map key">
      <button
        type="button"
        class="legend-head"
        aria-expanded={!collapsed}
        aria-controls="legend-body"
        onClick={() => setLegendCollapsed(!collapsed)}
      >
        <span class="legend-title">Key<span class="legend-region"> · {regionName(region.value)}</span></span>
        <span class="legend-chevron" aria-hidden="true" />
      </button>
      <div id="legend-body" class="legend-body" hidden={collapsed}>
        {sections.length
          ? sections.map((section) => <Section key={section.group} section={section} drill={drill} />)
          : <p class="legend-empty">Turn on a layer to see its key.</p>}
        {footer.map((line) => <p key={line} class="legend-footer">{line}</p>)}
      </div>
    </aside>
  );
}
