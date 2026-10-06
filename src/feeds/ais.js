// Harbor and coastal traffic relayed through the Motion gateway. AISStream is
// the upstream when the Worker has AISSTREAM_API_KEY; otherwise the gateway
// uses keyless Open Waters and the browser still opens only /api/ais. Class A
// and Class B position reports are supported.
// The gateway shares one upstream between all viewers and opens each socket
// with a Snapshot frame of every vessel it already knows in the region.
// Retention rules (moving 15 min, moored 60 min, 6 h cap) live in
// ais-retention.js.

import { CONFIG } from './config.js';
import { isStaleVessel, shouldPruneVessel, snapshotQuietSince } from './ais-retention.js';
import { createFleet } from './fleet.js';
import { gatewayRegion } from './regions.js';
import { operatorFerryNames } from './regional.js';
import { vesselBand } from '../model/palette.js';
import { paintVehicle, setLegendNotes } from '../stores/legend.js';

export function startAis(onCounts, initialRegion, enabled = true) {
  if (!CONFIG.GATEWAY_BASE || !enabled) {
    onCounts({ vessel: null });
    return { setRegion() {} };
  }

  const fleet = createFleet('vessel');
  const vessels = new Map();
  const statics = new Map(); // mmsi -> { name, shipType, at }, kept before a first position
  const credits = new Set();
  let region = initialRegion;
  let socket = null;
  let reconnectTimer = null;
  let reconnectMs = 5000;
  let generation = 0;

  function rememberCredit(line) {
    const credit = String(line ?? '').trim();
    if (credit) credits.add(credit);
  }

  function publishCredits() {
    if (credits.size) setLegendNotes('vessel', [...credits]);
  }

  function connect() {
    clearTimeout(reconnectTimer);
    const thisGeneration = ++generation;
    const endpoint = new URL(`${CONFIG.GATEWAY_BASE}/api/ais`);
    endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    endpoint.searchParams.set('region', gatewayRegion(region));
    socket = new WebSocket(endpoint);

    socket.onopen = () => {
      reconnectMs = 5000;
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.MessageType === 'Snapshot') {
          loadSnapshot(msg);
          for (const line of msg.Attribution ?? []) rememberCredit(line);
          publishCredits();
          return;
        }
        const meta = msg.MetaData ?? {};
        const report = msg.Message?.[msg.MessageType];
        if (!report) return;
        const mmsi = String(meta.MMSI);
        const existing = vessels.get(mmsi);
        if (msg.MessageType === 'ShipStaticData') {
          // Keep static data even when the position report has not arrived yet.
          const info = {
            name: cleanName(report.Name) || cleanName(meta.ShipName) || statics.get(mmsi)?.name || '',
            shipType: numberOrNaN(report.Type ?? report.TypeAndCargo ?? report.ShipType),
            at: Date.now(),
          };
          statics.set(mmsi, info);
          if (existing) {
            if (Number.isFinite(info.shipType)) existing.shipType = info.shipType;
            if (info.name) existing.name = info.name;
          }
          return;
        }
        const lng = numberOrNaN(meta.longitude ?? meta.Longitude);
        const lat = numberOrNaN(meta.latitude ?? meta.Latitude);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
        const heading =
          Number.isFinite(report.TrueHeading) && report.TrueHeading !== 511
            ? report.TrueHeading
            : report.Cog;
        const info = statics.get(mmsi);
        const metaType = numberOrNaN(meta.ShipType);
        const heardAt = Date.now();
        const credit = cleanName(meta.Credit) || existing?.credit || '';
        rememberCredit(credit);
        vessels.set(mmsi, {
          lng,
          lat,
          name: cleanName(meta.ShipName) || info?.name || existing?.name || '',
          sog: numberOrNaN(report.Sog),
          heading: numberOrNaN(heading),
          shipType: firstFinite(info?.shipType, existing?.shipType, metaType),
          credit,
          at: heardAt,
          quietSince: heardAt,
        });
      } catch {
        // Malformed provider frame: skip it and keep the live connection.
      }
    };

    socket.onclose = () => {
      if (thisGeneration !== generation || document.hidden) return;
      reconnectTimer = setTimeout(connect, reconnectMs);
      reconnectMs = Math.min(reconnectMs * 2, 60_000);
    };
    socket.onerror = () => socket?.close();
  }

  // Bulk-load the gateway's known vessels. Each carries the real server time
  // it was last heard; shift it onto this browser's clock so old positions dim
  // (3 min) and show their true age. Pruning counts only the gateway's
  // listening time (quietMs), so boats kept through a quiet spell (up to 6 h
  // old) appear dimmed rather than being dropped.
  function loadSnapshot(msg) {
    const receivedAt = Date.now();
    const serverNow = Number(msg.At);
    const skew = Number.isFinite(serverNow) ? receivedAt - serverNow : 0;
    for (const vessel of msg.Vessels ?? []) {
      const mmsi = String(vessel.mmsi);
      const lng = numberOrNaN(vessel.lng);
      const lat = numberOrNaN(vessel.lat);
      const heardAt = numberOrNaN(vessel.at);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(heardAt)) continue;
      const at = Math.min(heardAt + skew, receivedAt);
      const quietSince = snapshotQuietSince(at, numberOrNaN(vessel.quietMs), receivedAt);
      const existing = vessels.get(mmsi);
      if (existing && existing.at >= at) {
        // A live frame already beat it; the gateway may still know it was heard
        // more recently in listening time.
        existing.quietSince = Math.max(existing.quietSince ?? existing.at, quietSince);
        continue;
      }
      const info = statics.get(mmsi);
      const credit = cleanName(vessel.credit) || existing?.credit || '';
      rememberCredit(credit);
      const record = {
        lng,
        lat,
        name: cleanName(vessel.name) || info?.name || existing?.name || '',
        sog: numberOrNaN(vessel.sog),
        heading: firstFinite(vessel.heading, vessel.cog),
        shipType: firstFinite(vessel.shipType, info?.shipType, existing?.shipType),
        credit,
        at,
        quietSince,
      };
      if (!shouldPruneVessel(record, receivedAt)) vessels.set(mmsi, record);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      generation += 1;
      clearTimeout(reconnectTimer);
      socket?.close();
    } else {
      connect();
    }
  });

  setInterval(() => {
    const now = Date.now();
    for (const [mmsi, vessel] of vessels) {
      if (shouldPruneVessel(vessel, now)) vessels.delete(mmsi);
    }
    // Statics carry no speed, so on their own they follow the moving rule.
    for (const [mmsi, info] of statics) {
      if (!vessels.has(mmsi) && shouldPruneVessel(info, now)) statics.delete(mmsi);
    }
    const items = [...vessels.entries()]
      // An operator feed already shows this boat with route and trip detail.
      .filter(([, vessel]) => !operatorFerryNames.has(String(vessel.name ?? '').trim().toUpperCase()))
      .map(([mmsi, vessel]) => {
      const looksLikeFerry =
        (vessel.shipType >= 60 && vessel.shipType <= 69) ||
        /ferry|seastreak|steamship|island queen|cape flyer/i.test(vessel.name);
      // Ferries join the ferry operators' palette; other vessels are colored by
      // AIS ship-type band.
      const band = looksLikeFerry ? null : vesselBand(vessel.shipType);
      return paintVehicle({
        id: `vessel-${mmsi}`,
        lng: vessel.lng,
        lat: vessel.lat,
        props: {
          group: looksLikeFerry ? 'ferry' : 'vessel',
          dataStatus: 'live',
          legendKey: band ? band.key : 'ais-ferry',
          legendLabel: band ? band.label : 'Other ferries (AIS)',
          modeColor: band ? band.color : CONFIG.FERRY_COLOR,
          color: band ? band.color : CONFIG.FERRY_COLOR,
          bearing: vessel.heading ?? 0,
          hasBearing: Number.isFinite(vessel.heading),
          stale: isStaleVessel(vessel, now),
          title: vessel.name || `MMSI ${mmsi}`,
          dest: Number.isFinite(vessel.heading) ? `Heading ${Math.round(vessel.heading)}°` : '',
          status: Number.isFinite(vessel.sog) ? `${vessel.sog.toFixed(1)} kn` : '',
          meta: `MMSI ${mmsi}${Number.isFinite(vessel.shipType) ? ` · AIS type ${vessel.shipType}` : ''}`,
          provider: vessel.credit || 'AISStream public vessel telemetry',
          sourceUrl: vessel.credit ? 'https://openwaters.io/ais/' : 'https://aisstream.io/',
          // Real time last heard; popups and trip cards read "Last heard 12 min ago".
          updatedAt: new Date(vessel.at).toISOString(),
          ageLabel: 'Last heard',
        },
      });
    });
    publishCredits();
    const visible = fleet.update(items);
    onCounts({
      vessel: visible.filter((item) => item.props.group === 'vessel').length,
      ferry: visible.filter((item) => item.props.group === 'ferry').length,
    });
  }, 2500);

  connect();
  return {
    setRegion(nextRegion) {
      region = nextRegion;
      vessels.clear();
      credits.clear();
      setLegendNotes('vessel', []);
      generation += 1;
      clearTimeout(reconnectTimer);
      socket?.close();
      connect();
    },
  };
}

// null/undefined/'' become NaN rather than 0, so "unknown" stays unknown.
function numberOrNaN(value) {
  if (value === null || value === undefined || value === '') return NaN;
  return Number(value);
}

function firstFinite(...values) {
  for (const value of values) {
    const number = numberOrNaN(value);
    if (Number.isFinite(number)) return number;
  }
  return NaN;
}

// AIS pads names with '@' and spaces.
function cleanName(value) {
  return typeof value === 'string' ? value.replace(/@+$/, '').trim() : '';
}
