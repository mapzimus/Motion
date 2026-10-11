# Motion UX overhaul: one layer list, two filters, bottom sheet

## Why

Measured on the live site (2026-10-11, Greater Boston): the side panel is a
3,300 px scroll holding 40 layer switches; four separate controls do the same
job (Default/Routes/Clear, the "Show" chips, the "Scenes" chips, and the
switches themselves); the right-hand Key repeats 26 of the panel's rows with
no switches; on a phone the Key covers half the map on first load; and the
header spends 110 px explaining Census clipping before the user has done
anything. First paint is an empty outline for several seconds, then
everything at once.

Decisions (approved in chat, all five):

1. **One list, not two.** The Key folds into the layer list. The right-hand
   legend goes away.
2. **Two filter controls.** Mode chips + a "Live only" switch. Scenes move into
   the Geography picker. Default/Routes/Clear and the four Include checkboxes
   go away.
3. **Header to one line.** Title and region on one row, tagline behind an (i).
4. **Phone gets a bottom sheet** with peek / half / full heights, replacing
   the Layers button and the Key overlay.
5. **First paint feels alive.** Map draws before feeds; counts skeleton; and
   `hashchange` moves the map (today a new hash on the same page does nothing).

## 1. The merged layer list

### Component

`src/components/LayerPanel.tsx` (Preact) replaces, in `index.html`:
`.master-row` (subway master), `#layer-rows`, `#modal-rows`, `#drill-down`,
and `#legend-root` + `Legend.tsx`. It mounts into `#layers-root`.

Structure, top to bottom:

- **Section** (Subway · Ground & rail · Air & water · Shared & active travel ·
  Conditions & alerts · Movement infrastructure). A section head is a button
  that collapses its rows (chevron, `aria-expanded`), shows "N on", and
  carries a section switch that turns every row in it on or off. This
  generalises today's subway-only master switch.
- **Group row**: legend swatch (the same ribbon / dot / ring / area / glyph
  the map draws, from `swatchKind`), name, truth tag, counts, switch. The
  initials bullet is gone; the swatch *is* the key. Clicking the name drills
  (drillable groups) or zooms (zoomable groups), as today. Rows needing a
  gateway keep the disabled switch and "setup" link.
- **Key block**, nested under a row while the row is on and the group's
  legend section has operator rows, fixed rows, viewport routes, or notes.
  Subway lines have no key block (the row swatch is the key). A chevron on
  the row collapses the block; default open; collapse state is per group in
  a signal (not persisted).
- **Drill mode**: while `drillLegend` is set the list is replaced by one
  drill section (back header, route rows, dimming), exactly the data
  `legendSections` already produces for a drill.
- **Footer note** (`STALE_NOTE`) under the list when any fading group is on.

### State

`stores/layers.ts` becomes the source of truth for `groupOn`,
`manualOverrides`, `statuses`. Group *definitions* move from `ui.js
buildGroups` to `src/model/groups.ts` (`buildGroups(routeInfo, capabilities)`,
`groupStartsOn(group, region)`, `SECTIONS`). Counts come straight from
`stores/counts.ts`.

`ui.js` keeps region select, basemap, alerts, status footer, overlay, and the
preset resolver, but every group read/write goes through the store:
`applyLayerPreset`, `applyVisibleState`, `ensureGroupVisible`,
`getVisibleGroups`, `getVisibleStatuses`, `getDefaultGroups`. One effect in
`boot.ts` watches `visibleGroups`/`visibleStatuses` and calls
`setVisibleGroups` + `schedulePermalinkUpdate`, replacing the
`onVisibleChange` callback plumbing.

`legendCollapsed` is deleted; `viewportWanted` becomes "a route group is on".
`Legend.tsx`, its tests, and the `.legend*` CSS are deleted; the useful tests
are ported to `LayerPanel.test.tsx`.

## 2. Two filter controls

- **Chips** (`#vehicle-presets`): Rail · Buses · Water · Air · Roads ·
  Bike & walk · Disruptions · **Everything**. "Everything" is the old
  Default preset. Default/Routes/Clear buttons are removed from the HTML;
  `resolvePreset('routes')` and `'clear'` stay in `presets.js` for
  permalink/back-compat but have no button.
- **Scenes** become an `<optgroup label="Scenes">` at the top of
  `#region-select`, option value `scene:<key>`. Choosing one runs
  `applyLayerPreset(key)`; the select then shows the scene's region. The
  `#scene-presets` chip row is removed.
- **Live only** (`#live-only`, a `.switch`) replaces the four Include
  checkboxes. On ⇒ `statuses = ['live']`; off ⇒ all four. A permalink `s=`
  with any non-live status shows the switch off. `applyVisibleState` and
  `ensureGroupVisible` keep working on the full status list.

## 3. Header

```
Motion · Greater Boston                                  (i)
[ search …                                                 ]
```

`.panel-head` holds `h1` + region name on one line and an (i) button that
toggles `.panel-about` (the old tagline + region definition + the Census
note). The `#map-stats` line and `.region-note` are removed; the footer
status line already says "Live · 415 vehicles". The Find section is the
first thing under the header (it already is); the Geography section keeps
the select and basemap chips.

## 4. Bottom sheet (≤ 760 px)

`#panel` becomes a bottom sheet. `body[data-sheet]` ∈ `peek | half | full`,
default `peek`. Heights: peek `148px` (grip + title row + search + chips),
half `50vh`, full `calc(100vh - 12px)`. The grip (`.sheet-grip`) is a
button: tap cycles peek → half → full → peek; pointer drag on it snaps to
the nearest state on release (threshold by drag distance). Choosing a region
or scene, picking a search result, or focusing an alert snaps to `peek`
(today: closes the drawer). `#panel-toggle` is removed. While a trip card is
open the sheet is hidden (`body.trip-open #panel { display: none }`), so the
two bottom surfaces never stack; closing the card brings the sheet back at
`peek`. Map `fitPadding()` bottom inset follows the sheet height on mobile.

## 5. First paint

- `boot()` starts `initMap()` as soon as regions are loaded, in parallel with
  the route index and the gateway health check (5 s timeout) instead of
  after them. The overlay lifts on the map's first `idle`, not after feeds
  start; feeds, shapes and reference data keep streaming in behind it.
- Counts render `…` until a source has reported (null), `–` only when a
  source reported nothing. The status footer shows "Connecting…" until the
  first MBTA poll, as today.
- `window.addEventListener('hashchange')` re-reads the permalink and applies
  region, camera, on/off groups, statuses and follow, through the same
  functions a cold load uses.

## Testing

- `src/components/LayerPanel.test.tsx`: section switch toggles all rows;
  row switch writes `groupOn` and marks manual; key block appears under an
  on row with operator rows and not under a subway line; drill mode shows
  only the drill section; needs-key row is disabled.
- `src/stores/layers.test.ts`: `liveOnly` derivation and setter.
- `src/model/presets.test.ts`: unchanged resolver contract.
- `src/feeds/permalink` hashchange: a unit test that `applyPermalink`
  dispatches region + groups.
- Browser pass on desktop and 375 px: toggles, drill, scenes from the
  select, live-only, sheet snaps, trip card + sheet, first paint order.

## Out of scope

Light theme, search ranking, alert list design, the Preact port of the
region select / alerts / status footer (they stay in `ui.js`).
