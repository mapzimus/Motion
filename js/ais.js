// Harbor and coastal traffic from AISStream, relayed through the Motion
// gateway so the API key stays server-side and browser cross-origin limits do
// not break the stream. Class A and Class B position reports are supported.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';

export function startAis(onCounts, initialRegion, enabled = true) {
  if (!CONFIG.GATEWAY_BASE || !enabled) {
    onCounts({ vessel: null });
    return { setRegion() {} };
  }

  const fleet = createFleet('vessel');
  const vessels = new Map();
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
    endpoint.searchParams.set('region', region);
    socket = new WebSocket(endpoint);

    socket.onopen = () => {
      reconnectMs = 5000;
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const meta = msg.MetaData ?? {};
        const report = msg.Message?.[msg.MessageType];
        if (!report) return;
        const mmsi = String(meta.MMSI);
        const existing = vessels.get(mmsi);
        if (msg.MessageType === 'ShipStaticData') {
          if (existing) {
            existing.shipType = Number(
              report.Type ?? report.TypeAndCargo ?? report.ShipType,
            );
            existing.name = String(report.Name ?? meta.ShipName ?? existing.name).trim();
          }
          return;
        }
        const lng = Number(meta.longitude);
        const lat = Number(meta.latitude);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
        const heading =
          Number.isFinite(report.TrueHeading) && report.TrueHeading !== 511
            ? report.TrueHeading
            : report.Cog;
        vessels.set(mmsi, {
          lng,
          lat,
          name: String(meta.ShipName ?? '').trim(),
          sog: Number(report.Sog),
          heading: Number(heading),
          shipType: existing?.shipType ?? Number(meta.ShipType),
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
    const items = [...vessels.entries()].map(([mmsi, vessel]) => {
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
