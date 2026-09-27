# New England in Motion: interface redesign + follow-a-vehicle

## Context

The current dashboard is one tall dark sidebar (`js/ui.js`, `css/styles.css`) stacking a region picker, four stat cards, 25 layer rows in six collapsible sections, "data truth" pills, and a 43-item alert list. On a phone it becomes an off-canvas drawer behind a ☰ button. It reads as a control room, not a rider's app. There is no search, no selected-vehicle state, and no way to keep a moving vehicle on screen: vehicle clicks open a fire-and-forget MapLibre popup that never moves with the vehicle, so watching a commuter-rail train means panning by hand every 10 seconds.

Decisions made in this session:

- **Look**: clean consumer transit app (Transit / Citymapper feel), big touch targets, plain words.
- **Devices**: desktop and phone equally. Desktop gets a side rail, phone a bottom sheet, sharing components.
- **Stack**: full front-end rewrite in **Preact + Vite**, built and deployed to GitHub Pages by GitHub Actions.
- **Theme**: light + dark, follows system, manual toggle. Two CARTO basemaps (Positron / Dark Matter).
- **Data layer**: port the pollers and `fleet.js` as-is, wrapped in signal stores. Minimal edits.
- **No backend changes.** `worker/` and `aircraft-gateway/` stay untouched. Persistence is URL params + localStorage only.
- **Follow mode** includes all four: camera lock with smooth glide, trip card with next stops + ETAs, shareable `?follow=` URL, and find-by-number/route search.

Ordering: **ship follow mode first on the current app** (its core is DOM-free and ports straight into the rewrite; only ~150 lines of card DOM are throwaway), then do the rewrite in shippable phases. This gets the feature you actually wanted onto the train with you within days instead of after a multi-week rewrite.

## Verified facts that shape the plan

- Vanilla ES modules, no build step. `index.html` loads `js/app.js`. MapLibre GL 4.7.1 from unpkg. Only `js/map.js` touches the `maplibregl` global.
- `js/fleet.js` `createFleet()` keys by stable `item.id` and tweens positions over 900 ms (`CONFIG.ANIMATE_MS`) with one rAF loop per fleet, then everything sits still until the next poll (MBTA 10 s, regional 20 s, MNR 30 s, planes 45 s, Amtrak 90 s, AIS rebuild 2.5 s). `render()` (fleet.js:56-68) emits features with **no id**; sources have no `promoteId` (map.js:641). A click cannot resolve to a vehicle today.
- Camera calls are only `map.fitBounds` in `applyRegion` (map.js:1156), `focusAlert` (1309), `focusGroup` (1333). `fitPadding()` (1287) hard-codes a 420 px left inset above 760 px. 760 is also hard-coded at ui.js:161, 218, 496.
- MBTA `/vehicles` (api.js:64-99) already returns `relationships.trip.data.id` despite the `fields[vehicle]` restriction (the code reads `relationships.route` the same way), so trip id is a one-line read, not an `include` change.
- Worker CORS (`wrangler.jsonc:12-24`, `worker/src/index.ts:48`) allows only `localhost:5500`, `127.0.0.1:5500`, and `mapzimus.github.io`. **Vite dev must run on port 5500 with `strictPort`.**
- `regions.js:23` uses `new URL('../data/regions.geojson', import.meta.url)`, which breaks under Vite. `scripts/check-route-geometry.mjs` reads `../data/*.geojson` in four places. `worker/test/amtrak-normalize.test.js:6` imports `../../js/amtrak-normalize.js`.
- `vitest.config.mts` is wired to the Cloudflare Workers pool; UI tests need their own config.
- GitHub Pages currently serves the branch root. There is no deploy workflow. Switching Pages source to "GitHub Actions" is a one-time manual setting.
- Persisted keys that must keep their exact names/formats: `motion-region`, `motion-gateway`, `motion-aircraft-gateway`, `bim-shapes-v4`.
- Group keys emitted by pollers (red, orange, green, blue, silver, mattapan, commuter, bus, ferry, amtrak, plane, vessel, bike, plus reference/condition groups) **do not change**.

---

## Part A: Follow mode (on the current app)

Three new DOM-free modules plus one throwaway DOM module, and small hook edits to existing files.

| New file | Role |
|---|---|
| `js/follow.js` | Selection store + camera controller: `follow()`, `unfollow()`, `setMode()`, `getSelection()`, `subscribe()`, `restoreFromUrl()` |
| `js/predictions.js` | MBTA `/predictions` fetch/map/cache/poll + `tripCardData(fleetId, item)` adapters for every fleet |
| `js/search.js` | `searchVehicles(query, ctx)` pure matcher |
| `js/trip-card.js` | Card DOM, toast, search input wiring (replaced by Preact components in Part B) |

State: `{ fleetId, id, mode: 'pending' | 'selected' | 'following' | 'lost', zoom, lastSeenAt, item }`.
`selected` = card + ring, camera free. `following` = card + ring + camera lock. Map click → `selected` with a prominent **Follow** button (tapping a vehicle then having the map yank away is disorienting). Search pick and URL restore → `following`. User drag while following → `selected`. This is a one-flag change if click-to-follow turns out better.

### A1. `js/fleet.js` edits

- In `update()` after `latest.set(item.id, item)`: `item.props.id = item.id` (no provider sets `props.id` today). `render()` is unchanged since it passes `item.props`.
- Return `{ update, has(id), getItem(id), getDisplayed(id), items(), onFrame(cb), onUpdate(cb), setGlide(id, ms|null) }`. `onFrame` fires at the end of `render()`, `onUpdate` at the end of `update()`.
- Module-level `registry` Map; export `getFleet(fleetId)` and `findVehicle(id)`.
- Tween refactor: replace the `moves` array with `active = Map<id, {from, to, t0, dur, ease}>`. Upsert only when the target changed. This also fixes the existing bug where any poll cancels every other in-flight tween (visible on the 2.5 s AIS rebuild). `dur = glideOverrides.get(id) ?? CONFIG.ANIMATE_MS`; use linear easing when `dur > 2000` (a 9 s easeOutCubic sprints then crawls).

### A2. `js/map.js` edits

- `addSource('veh-…', { …, promoteId: 'id' })` at line 641 (enables `updateData` later; ids are unique per source).
- After the `FLEETS` loop (~line 710): source `veh-selected` + layers `veh-selected-halo` (pulsing stroke ring driven by a `pulse` prop 0–1) and `veh-selected-dot` (solid dot, radius matching `veh-*-dots`, opacity 0.5 when `stale`). Drawn above `veh-plane-icons`. Export `setSelectedFeature(lngLat, props|null)`.
  Why a separate source, not feature-state: it is independent of region clipping (`filterFeatureCollection`, map.js:1100) and of `applyGroupFilter`, so the followed vehicle stays visible when it leaves the region or its layer is toggled off.
- `wirePopupLayer(layerId, fleetId)`: at the top of the click handler, `if (p.id && vehicleClickHandler?.(fleetId, p.id, p)) return;`. Export `setVehicleClickHandler(fn)`. Non-vehicle popups untouched.
- Export `onCameraTakeover(fn)`; call it at the top of `focusAlert`, `focusGroup`, and in `applyRegion` when `fit` is true. Export `fitPadding`.
- `window.__follow = { getSelection, follow, unfollow }` next to `window.__map` for DevTools.

### A3. `js/api.js` + `js/mbta.js` + `js/amtrak-normalize.js`

- `fetchVehicles`: add `current_stop_sequence` to `fields[vehicle]`; map `tripId: v.relationships?.trip?.data?.id`, `stopSequence`. Do **not** add `include=trip` (~900 trip objects per 10 s).
- New `fetchPredictions(tripId)`:
  ```
  /predictions?filter[trip]=<id>&include=stop,schedule,trip
    &fields[prediction]=arrival_time,departure_time,status,stop_sequence,schedule_relationship
    &fields[stop]=name,platform_code&fields[schedule]=arrival_time,departure_time
    &fields[trip]=headsign,name&sort=stop_sequence
  ```
  If `include=schedule` is rejected (verify in step 0), fall back to one `/schedules?filter[trip]=` per trip change, cached for the follow duration.
- `mbta.js` `apply()`: add `detail: { tripId, stopSequence, route, label, directionId }` as a **sibling** of `props` (not serialized into GeoJSON every frame).
- `amtrak-normalize.js`: add `detail: { trainNum, stations: stations.filter(s => s.status !== 'Departed').slice(0,5).map(…) }` using existing `delayLabel()`. The fixture test uses `toMatchObject` on `props`, so this is safe; add one assertion.
- Other fleets: card shows what props already carry (MNR next stop + minutes; regional agency/route/label/speed; planes route via existing `lookupFlightRoute`, altitude, speed; vessels name/MMSI/SOG; bikes dock availability). MNR 3–5 stop list would need a Worker change, which is out of scope. Card says "next stop" honestly.

### A4. Camera strategy (`js/follow.js`)

**Stretch the followed vehicle's glide to ≈ 0.9 × its fleet's poll interval, linear, and `map.setCenter(pos)` every frame.** Marker and camera move continuously and stay coincident. Only the followed id gets the long glide via `setGlide`; the rest of the fleet keeps the 900 ms snap. The marker shows ~one poll interval behind reality, invisible at map scale and how every consumer tracker works.

`CONFIG.FOLLOW_GLIDE_MS = { mbta: 9000, regional: 18000, mnr: 27000, plane: 40000, amtrak: 80000, vessel: 2200, bike: 900 }`.

Rejected: `easeTo` per poll (camera lags the 0.9 s marker, vehicle wanders off center); dead reckoning (overshoots at stations; possible v2 for planes only).

On `follow()`: `ensureGroupVisible(group)` (mirror ui.js:210-216), `map.setPadding(fitPadding())`, one `easeTo({ center, zoom: max(current, DEFAULT_FOLLOW_ZOOM[group]), duration: 900 })`, then per-frame `setCenter`. Skip `setCenter` while `cameraSuspended`, while `document.hidden`, or when `mode !== 'following'`. `unfollow()` resets padding and clears the ring.

Breaking the lock (all gated on `e.originalEvent`; programmatic moves have none):
- `dragstart` / `rotatestart` / `pitchstart` → `setMode('selected')`, unless `originalEvent.touches?.length >= 2` (pinch).
- `zoomstart` → keep following, set `cameraSuspended = true` so we don't fight the zoom easing.
- `zoomend` / `moveend` while suspended → record new follow zoom, `cameraSuspended = false`, one 250 ms `easeTo` back to the vehicle.
- Escape, card close button → `unfollow('user')`. Clicking another vehicle → switch selection, keep mode.
- `prefers-reduced-motion`: no ring pulse, `jumpTo` instead of the initial `easeTo`.

### A5. Edge cases

| Case | Behaviour |
|---|---|
| Id vanishes | `mode='lost'`, freeze ring at last position, card dims "Signal lost, waiting". Grace = 3 × fleet poll interval (cap 180 s). Reappears → resume. Expires → `unfollow('lost')`, toast, URL param cleared. |
| Leaves region | Keep following; `veh-selected` is unclipped so it stays visible. (Watching a Providence train leave Boston is the whole point.) Gateway-scoped fleets eventually vanish → lost flow. |
| Feed stale/paused/error | Ring dims via `stale`; card footer mirrors status. No unfollow. |
| Tab hidden | rAF and pollers already pause; on return, one long glide from old to new position. Predictions poll also pauses. |
| Region change | `onCameraTakeover` → `unfollow('region')` + toast. |
| Layer toggled off | Keep following; ring/dot remain; card notes "layer hidden". |
| Fleet not polled here (MNR outside CT, planes/AIS without gateway) | URL restore times out with a fleet-specific hint. |

### A6. Predictions cadence and budget

Poll every 15 s (`CONFIG.PREDICTION_POLL_MS`) only while an MBTA vehicle is selected and the tab is visible; refetch immediately on `tripId` change; 15 s TTL cache by trip; back off to 60 s on 429/5xx; `AbortController` on unfollow. Card: headsign (trip `headsign`, fallback `props.dest`), CR train number (trip `name`), next 5 stops with `stop_sequence >= detail.stopSequence`, ETA = `arrival_time ?? departure_time`, delay = prediction minus included schedule using `delayLabel` thresholds (±2 min), CR textual `status` shown verbatim when present. Adds ~4 req/min per following visitor against the shared public key's 1000/min.

### A7. Search (`js/search.js`)

No maintained index. On each 120 ms-debounced keystroke iterate `fleet.items()` for every fleet except `bike` (≤ ~2000 items, sub-ms). `ui.js` exports `getRouteInfo()`. Rules, best score wins, deduped by `fleetId:id`:

1. Vehicle id exact (pasted from URL): 100.
2. Train/car number exact (≤ 6 alphanumerics): MBTA `detail.label.split(/[-,\s]/).includes(q)`, Amtrak `trainNum`, MNR/regional `detail.label` (add to their items): 95.
3. Callsign: exact 90, prefix 70 ("JBU" lists all JetBlue). ICAO hex via `plane-<hex>`: 90.
4. Route: filler tokens (`line|route|train|bus|the`) stripped; contained in `routeInfo` long/short name/id or a GROUPS `name` → **route result** with live-vehicle children: 60. "39" hits both rule 2 and 4; route group lists first.
5. Free text on `props.title`/`props.dest`: 40.

Result shapes: `{ kind:'vehicle', key, fleetId, id, title, subtitle, color, group, stale, score }` and `{ kind:'route', routeId, name, color, count, vehicles[] }`. Cap 30. A route with zero live vehicles renders disabled ("no live vehicles now"). Empty query shows recents. Pick → `follow(fleetId, id, { mode:'following' })`, closes the panel on mobile. Keyboard: arrows/Enter/Esc, `/` focuses.

### A8. URL / localStorage

- `?follow=<fleetId>:<encodeURIComponent(id)>` (split on first colon). Written via `history.replaceState` in `follow()`, removed in `unfollow()`. Factor a `setUrlParam(name, value|null)` helper mirroring `setActiveRegion` (regions.js:47-50). Stays while `selected`, dropped only on unfollow. Region is already in the URL so a shared link restores geography too.
- `motion-follow-recent`: JSON array, max 5, `{ key, title, subtitle, at }`, for the search empty state. **No** automatic restore from localStorage; the URL is the sole restore source.
- Restore in `app.js` after `setRegion(selectedRegion)`: `restoreFromUrl()` → `mode='pending'`, card skeleton "Looking for …", subscribe to that fleet's `onUpdate`; first update containing the id → lock. Timeout 3 × poll interval (30–120 s) → toast, clear param. `onCameraTakeover` ignored while pending so the initial `fitBounds` doesn't cancel the restore.

### A9. Steps and verification (dev server: `.claude/launch.json` → `transit-map`)

0. **Verify API assumptions, no code.** Network tab: confirm `/vehicles` `data[i].relationships.trip.data.id`. Request `/predictions?filter[trip]=…&include=stop,schedule,trip` directly and confirm `schedule` in `included`.
1. `fleet.js` registry/props.id/hooks/setGlide/tween refactor. Verify `__map.querySourceFeatures('veh-mbta')[0].properties.id` is a string; `__fleets.get('mbta').getDisplayed(id)` changes during a glide; boats keep gliding across an AIS rebuild.
2. `map.js` promoteId, `veh-selected`, hooks. Verify `__map.getStyle().layers.at(-1).id === 'veh-selected-halo'`; console `setSelectedFeature([-71.06,42.36], {color:'#f00'})` draws a ring on Boston Common.
3. `api.js`/`mbta.js`/`amtrak-normalize.js` detail fields. Verify `getItem(id).detail.tripId` matches Network; `npm test` passes.
4. `follow.js` store + camera, wired in `app.js`. Verify: click → ring, `mode==='selected'`, no camera move; `__follow.setMode('following')` → centers, then pans smoothly ~9 s after next poll; drag → `selected`; wheel-zoom → stays following, 250 ms recentre; region change → unfollowed; Escape → `__map.getPadding()` all zeros.
5. `predictions.js`. Verify one `/predictions` per 15 s only while selected, aborted on unfollow, none while hidden.
6. `trip-card.js` + CSS + containers. Desktop: floating card top-right 320 px. Mobile ≤ 760: bottom sheet. Verify at 1440 and 390 px; "Copy link" works; Amtrak lists stations; plane shows route.
7. URL write/read/restore/timeout. Verify reload restores; `?follow=mbta:nope` toasts after ~30 s.
8. `search.js` + input. Verify "5768", "franklin line", "red line", "route 39", "JBU", hidden-group pick turns layer on, empty query shows recents.
9. Lost/grace flow: simulate with `__fleets.get('mbta').update([])`.
10. `npm test`, `npm run check`.
11. Optional perf: if continuous full-fleet `setData` hurts on a mid-range phone, throttle the followed fleet's full render to every 3rd frame (the selected dot hides it) or use `getSource().updateData({ update:[{id,newGeometry}] })` (why promoteId was added).

---

## Part B: Preact + Vite rewrite

### B1. Target layout

```
index.html                 Vite entry; keeps meta/fonts/favicon; <div id="app">; inline pre-paint theme script
vite.config.ts             base '/Motion/', preact(), publicDir 'public', server { port 5500, strictPort, host }
tsconfig.json              unchanged (worker)
tsconfig.app.json          NEW: src/**, jsx react-jsx, jsxImportSource preact, allowJs
vitest.ui.config.mts       NEW: happy-dom, src/**/*.test.{ts,tsx}
.github/workflows/pages.yml NEW build + deploy dist/
.claude/launch.json        npm run dev, port 5500
public/data/               git mv from ./data
src/
  main.tsx                 render(<App/>); imports tokens/base css + maplibre css; boot()
  app/App.tsx  boot.ts (ex app.js main)  shapes.ts (ex loadShapeFeatures, keeps bim-shapes-v4)
  feeds/                   git mv js/*.js (config, fleet, api, mbta, amtrak, amtrak-normalize, planes, ais,
                           regional, metro-north, shared-mobility, roadwork, road-conditions, alerts, regions,
                           polyline, flight-routes, predictions, search)
  follow/follow.ts         ex js/follow.js, wrapped so `selection` is a signal
  map/map.js  adapter.ts  palette.ts  MapCanvas.tsx
  model/groups.ts (ex buildGroups)  modes.ts  format.ts  persist.ts
  stores/region layers counts status alerts theme layout selection capabilities boot
  components/
    shell/  DesktopRail MobileSheet SheetHandle TopBar SearchBox
    region/ RegionPicker
    layers/ ModeChips ModeChip MoreLayersDrawer LayerRow SubwayLines Presets TruthFilter
    alerts/ AlertsPanel AlertItem
    status/ StatusPill StatsStrip LoadingOverlay
    settings/ SettingsSheet ThemeToggle
    trip/   TripCard SearchResults Toast
    ui/     Switch Chip IconButton Sheet
  styles/tokens.css base.css map-popups.css
css/styles.css, server.js, js/, data/   deleted at the end
```

Ported-file edits (complete list): `regions.js:23` → `fetch(\`${import.meta.env.BASE_URL}data/regions.geojson\`)`; `config.js:63-68` data paths prefixed with `BASE_URL`, add `BASEMAP_STYLE_LIGHT`; `scripts/check-route-geometry.mjs` four `../data/` → `../public/data/`; `worker/test/amtrak-normalize.test.js:6` import path (one line in a test file, the only touch under `worker/`).

### B2. `map.js` as an imperative adapter (~80 lines of change)

- `import maplibregl from 'maplibre-gl'`; `initMap(container, { styleUrl, palette })`.
- `setupLayers(palette)`: every hard-coded theme colour (stroke `#f4f6f8`, halos `#0b0f14`/`#10151b`, label text, boundary, camera fill, in `makeIcon`/`registerModeIcons`/`chevronImage`) becomes `palette.*`.
- `setBasemap(styleUrl, palette)`: `layersReady=false; map.once('style.load', () => { setupLayers(palette); layersReady=true; rehydrate(); }); map.setStyle(styleUrl)`. `rehydrate()` = `applyRegion(false)` + `applyGroupFilter(pendingFilters)`; all datasets are already in module state. Do **not** re-run `wirePopups()`: layer click listeners survive `setStyle`. Fallback if the blank-frame flash is unacceptable: `transformStyle` keeping custom sources/layers.
- `setLayoutInsets({top,right,bottom,left})` replaces the `window.innerWidth > 760` in `fitPadding`.
- Selection hooks from Part A carry over unchanged.

### B3. Component tree

```
<App>
  <MapCanvas/>
  <TopBar> <RegionPicker/> <SearchBox/> <StatusPill/> <IconButton settings/> </TopBar>
  desktop: <DesktopRail width=380> <RailBody/> </DesktopRail>
  mobile:  <MobileSheet snapPoints=[peek 120px, half 50%, full 92%]> <SheetHandle/> <RailBody/> </MobileSheet>
  <TripCard/>        desktop: card at top of rail; mobile: replaces sheet peek content
  <SearchResults/>   dropdown under SearchBox
  <SettingsSheet> <ThemeToggle/> credits, gateway status </SettingsSheet>
  <Toast/> <LoadingOverlay/>
</App>

RailBody: <StatsStrip/> <ModeChips/> <MoreLayersDrawer> <Presets/> <TruthFilter/> <SubwayLines/> {19 LayerRows by section} </MoreLayersDrawer> <AlertsPanel/> <Credits/>
```

Mode chips (`src/model/modes.ts`), group keys unchanged: Subway (red, orange, green, blue, silver, mattapan; hidden outside boston/ma/new-england) · Trains (commuter, amtrak) · Bus (bus) · Ferries (ferry) · Planes (plane; disabled without gateway) · Boats (vessel; disabled without AIS) · Bikes (bike) · Roads (traffic, incident, roadwork, camera) · More… (opens drawer: walking, cycling, local, airport, air-service, roads, freight, border). Chip state on/mixed/off; tap toggles all enabled members (same `manualGroupOverrides` semantics); chevron opens the drawer scrolled to that section. Row click-to-zoom keeps `map.focusGroup(key, routes)`; on mobile a successful fly snaps the sheet to peek.

### B4. Stores (`@preact/signals`)

| Store | Signals | Persist |
|---|---|---|
| region | `region` (reuse `initialRegion()` regions.js:34) | `motion-region` + `?region=` (existing, unchanged) |
| layers | `groups`, `groupOn`, `manualOverrides`, `statuses`; computed `visibleGroups`, `visibleStatuses`; actions `toggleGroup`, `applyPreset` (port ui.js:96), `applyRegionDefaults` (ui.js:78), `setSubwayMaster`, `toggleChip`; effect → `adapter.setVisibleGroups` | `motion-layers-v1` (manual overrides only) + `?layers=bus,-plane`; `motion-truth-v1` + `?truth=-reference`. URL wins on load. Never persist `needsKey` groups. |
| counts | `countsBySource`, `scheduledCounts`, `stationCounts`, `referenceCounts`; computeds port `totalCount`/`renderCounts` | none |
| status | `status`, `now` (one 1 s interval) | none |
| alerts | `alertsBySource`; computed sorted list, `badgeForGroup` (port ui.js:447-461) | none |
| theme | `themePref` system/light/dark, `systemDark`, `resolvedTheme`; effect sets `data-theme`, `adapter.setBasemap`, `<meta theme-color>` | `motion-theme` |
| layout | `viewport` (one `matchMedia('(min-width: 760px)')`), `railOpen`, `sheetSnap`, `sheetHeightPx` (ResizeObserver); computed `mapInsets` → `adapter.setLayoutInsets` | none |
| selection | `selection` `{ fleetId, id, mode, … }` wrapping `follow.ts`; `card` data from `predictions.js` | `?follow=`, `motion-follow-recent` |
| capabilities, boot | gateway capabilities; loading/fatal overlay | none |
| map view | `?map=lng,lat,zoom` written on debounced `moveend`, read at init to skip the region fit | URL only |

`boot.ts` is a near-mechanical port of `app.js` `main()` with poller callbacks targeting store setters instead of `ui.*`.

### B5. Theme

`tokens.css`: `:root, [data-theme="dark"]` and `[data-theme="light"]` sets for bg/surface/hairline/text/accent/live/amber/red/shadow/radius/space/font. T-line colours stay; truth-pill colours get a light variant. Popup CSS moves to `map-popups.css` on tokens so MapLibre popups follow the theme. Inline `<head>` script reads `motion-theme` + `matchMedia` and sets `data-theme` before first paint. `palette.ts`: `MAP_PALETTE.light/.dark` and `BASEMAPS = { dark: dark-matter, light: positron-gl-style }`.

### B6. Build and deploy

- deps: `preact`, `@preact/signals`, `maplibre-gl@^4.7.1`; dev: `vite`, `@preact/preset-vite`, `happy-dom`. Remove unpkg tags + integrity hashes.
- scripts: `dev: vite` · `build: vite build` · `preview: vite preview --port 5500` · `check: tsc --noEmit && tsc -p tsconfig.app.json --noEmit && node scripts/check-route-geometry.mjs` · `test` unchanged (worker) · `test:ui: vitest run -c vitest.ui.config.mts` · keep `gateway:*`, `deploy:dry-run`.
- `pages.yml`: on push main + dispatch; permissions pages/id-token; `npm ci → check → test → build → configure-pages → upload-pages-artifact(dist) → deploy-pages`. `ci.yml` gains `build` + `test:ui`.
- **Manual, one-time (Max):** repo Settings → Pages → Source = GitHub Actions, in the same window the Phase B0 PR merges, or main will serve a broken page.

### B7. Phases and verification

| Phase | Scope | Verify |
|---|---|---|
| **A** (above) | Follow mode on current app, steps 0–11 | as listed in A9; deploy |
| **B0** Tooling | Vite/Preact deps, config, `public/data` move, path fixes, `pages.yml`, launch.json; `index.html` still loads legacy `app.js`; `map.js` imports maplibre | `npm run dev` on :5500 shows map + gateway feeds 200 (proves CORS); `build && preview` serves `/Motion/data/*.geojson`; `check`/`test` pass; Pages deploy green; `bim-shapes-v4` still hits on reload |
| **B1** Stores + boot | All stores, `boot.ts`, temporary `legacyBridge.ts` subscribing old `ui.js` to signals; move `js/` → `src/feeds/`, `follow.js` → `src/follow/` | Toggles, presets, region, alert click, row zoom, follow all behave as before; unit tests for `applyPreset('routes')` in `ct`, counts totals |
| **B2** Desktop shell | App, MapCanvas, DesktopRail, TopBar, RegionPicker, StatsStrip, ModeChips, MoreLayersDrawer, AlertsPanel, StatusPill, LoadingOverlay, TripCard, SearchBox/Results, Toast. Delete `ui.js`, `trip-card.js`, bridge | At 1440/1024: region fit clears rail; chip `mixed` state; needs-key chips disabled; Tab/Space keyboard; `?layers=-plane,bus&truth=-reference` restores; follow card + search work in the rail |
| **B3** Mobile sheet | `Sheet.tsx` with handle-only pointer drag, snap points, `touch-action: none` on handle, body scroll only at full, `100dvh`, `overscroll-behavior: none`; NavigationControl to top-right; TripCard in sheet | 375×812 + real phone via `host:true`: handle drag never pans map; pinch on exposed map zooms; row zoom snaps to peek; `mapInsets.bottom` tracks sheet; follow lock survives sheet drag |
| **B4** Theme | tokens, theme store, ThemeToggle, palette, `setBasemap`/`setupLayers(palette)`, popup CSS, pre-paint script | Toggle dark→light→system: `layers.filter(l=>l.source?.startsWith('veh-')).length` unchanged, vehicles keep animating, filters preserved, no `styleimagemissing`, labels legible on Positron; OS change flips both; reduced-motion honoured; follow ring survives swap |
| **B5** Polish | Delete `styles.css`, `server.js`, README dev section; `?map=` persistence; Lighthouse mobile; a11y (`aria-pressed` chips, `role=dialog` sheet at full, live region on status) | CI green, Pages deploy, no console errors cold-load in both themes, all test scripts pass |

### Risks

| Risk | Mitigation |
|---|---|
| `setStyle` drops images/sources/layers; diff fails across CARTO styles | Rebuild from module state on `style.load`; `transformStyle` fallback if flash is visible |
| Worker CORS allows only :5500 / github.io | `strictPort: 5500`; `?gateway=` override unchanged |
| Bottom sheet vs MapLibre touch; iOS address-bar resize | Handle-only drag, `100dvh`, ResizeObserver → insets; pinch check `touches >= 2` in follow |
| Continuous per-frame `setData` while following | Measure first; throttle or `updateData` (A9 step 11) |
| `include=schedule` on `/predictions` unverified | A9 step 0; `/schedules` fallback named |
| Shared public MBTA key | +4 req/min per follower; back off on 429 |
| Pages source switch | Flip to GitHub Actions at B0 merge |
| vitest Cloudflare pool | separate `vitest.ui.config.mts` |
| Popup double-binding after style swap | only `setupLayers()` reruns; popups wired once |

### Out of scope (flagged)

- MNR 3–5 stop list (needs `timedStops` emitted by the Worker).
- Dead-reckoned plane positions between polls.
- Self-hosting Google Fonts.
