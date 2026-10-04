// Harbor and coastal traffic from AISStream, relayed through the Motion
// gateway so the API key stays server-side and browser cross-origin limits do
// not break the stream. Class A and Class B position reports are supported.
// The gateway shares one upstream between all viewers and opens each socket
// with a Snapshot frame of every vessel it already knows in the region.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';
import { gatewayRegion } from './regions.js';
import { operatorFerryNames } from './regional.js';

export function startAis(onCounts, initialRegion, enabled = true) {
  if (!CONFIG.GATEWAY_BASE || !enabled) {
    onCounts({ vessel: null });
    return { setRegion() {} };
  }

  const fleet = createFleet('vessel');
  const vessels = new Map();
  const statics = new Map(); // mmsi -> { name, shipType, at }, kept before a first position
  let region = initialRegion;
  let socket = null;
  let reconnectTimer = null;
  let reconnectMs = 5000;
  let generation = 0;

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
        vessels.set(mmsi, {
          lng,
          lat,
          name: cleanName(meta.ShipName) || info?.name || existing?.name || '',
          sog: numberOrNaN(report.Sog),
          heading: numberOrNaN(heading),
          shipType: firstFinite(info?.shipType, existing?.shipType, metaType),
          at: Date.now(),
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

  // Bulk-load the gateway's known vessels. Each carries the server time it was
  // last heard; shift it onto this browser's clock so the stale (3 min) and
  // prune (10 min) rules treat old positions as old.
  function loadSnapshot(msg) {
    const serverNow = Number(msg.At);
    const skew = Number.isFinite(serverNow) ? Date.now() - serverNow : 0;
    for (const vessel of msg.Vessels ?? []) {
      const mmsi = String(vessel.mmsi);
      const lng = numberOrNaN(vessel.lng);
      const lat = numberOrNaN(vessel.lat);
      const heardAt = numberOrNaN(vessel.at);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(heardAt)) continue;
      const at = Math.min(heardAt + skew, Date.now());
      const existing = vessels.get(mmsi);
      if (existing && existing.at >= at) continue; // a live frame already beat it
      const info = statics.get(mmsi);
      vessels.set(mmsi, {
        lng,
        lat,
        name: cleanName(vessel.name) || info?.name || existing?.name || '',
        sog: numberOrNaN(vessel.sog),
        heading: firstFinite(vessel.heading, vessel.cog),
        shipType: firstFinite(vessel.shipType, info?.shipType, existing?.shipType),
        at,
      });
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
      if (now - vessel.at > CONFIG.AIS_PRUNE_MS) vessels.delete(mmsi);
    }
    for (const [mmsi, info] of statics) {
      if (now - info.at > CONFIG.AIS_PRUNE_MS && !vessels.has(mmsi)) statics.delete(mmsi);
    }
    const items = [...vessels.entries()]
      // An operator feed already shows this boat with route and trip detail.
      .filter(([, vessel]) => !operatorFerryNames.has(String(vessel.name ?? '').trim().toUpperCase()))
      .map(([mmsi, vessel]) => {
      const looksLikeFerry =
        (vessel.shipType >= 60 && vessel.shipType <= 69) ||
        /ferry|seastreak|steamship|island queen|cape flyer/i.test(vessel.name);
      return {
        id: `vessel-${mmsi}`,
        lng: vessel.lng,
        lat: vessel.lat,
        props: {
          group: looksLikeFerry ? 'ferry' : 'vessel',
          dataStatus: 'live',
          color: looksLikeFerry ? CONFIG.FERRY_COLOR : CONFIG.VESSEL_COLOR,
          bearing: vessel.heading ?? 0,
          hasBearing: Number.isFinite(vessel.heading),
          stale: now - vessel.at > CONFIG.AIS_STALE_MS,
          title: vessel.name || `MMSI ${mmsi}`,
          dest: Number.isFinite(vessel.heading) ? `Heading ${Math.round(vessel.heading)}°` : '',
          status: Number.isFinite(vessel.sog) ? `${vessel.sog.toFixed(1)} kn` : '',
          meta: `MMSI ${mmsi}${Number.isFinite(vessel.shipType) ? ` · AIS type ${vessel.shipType}` : ''}`,
          provider: 'AISStream public vessel telemetry',
          sourceUrl: 'https://aisstream.io/',
          updatedAt: new Date(vessel.at).toISOString(),
        },
      };
    });
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
