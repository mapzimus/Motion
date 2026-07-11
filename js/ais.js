// Real harbor traffic: AIS position reports streamed over WebSocket from
// aisstream.io. Needs a free key (GitHub sign-in at https://aisstream.io);
// without one this module reports 'no key' and stays quiet — MBTA ferries
// still appear via the ferry layer.
//
// Unlike the HTTP pollers this is a live stream: reports trickle in per-ship,
// so we accumulate into a roster and repaint on a 2.5 s cadence.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';

export function startAis(onCounts) {
  if (!CONFIG.AIS_KEY) {
    onCounts({ vessel: null }); // null = "needs key" in the UI
    return;
  }

  const fleet = createFleet('vessel');
  const vessels = new Map(); // mmsi -> latest report
  let socket = null;
  let reconnectMs = 5000;

  function connect() {
    socket = new WebSocket(CONFIG.AIS_URL);

    socket.onopen = () => {
      reconnectMs = 5000;
      socket.send(
        JSON.stringify({
          APIKey: CONFIG.AIS_KEY,
          BoundingBoxes: [CONFIG.AIS_BBOX],
          FilterMessageTypes: ['PositionReport'],
        }),
      );
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.MessageType !== 'PositionReport') return;
        const meta = msg.MetaData;
        const report = msg.Message.PositionReport;
        const heading =
          report.TrueHeading && report.TrueHeading !== 511
            ? report.TrueHeading
            : report.Cog;
        vessels.set(meta.MMSI, {
          lng: meta.longitude,
          lat: meta.latitude,
          name: (meta.ShipName ?? '').trim(),
          sog: report.Sog,
          heading,
          at: Date.now(),
        });
      } catch {
        /* malformed frame -> skip */
      }
    };

    socket.onclose = () => {
      // Stream dropped: retry with growing patience.
      setTimeout(() => {
        if (!document.hidden) connect();
      }, reconnectMs);
      reconnectMs = Math.min(reconnectMs * 2, 60_000);
    };
    socket.onerror = () => socket.close();
  }

  // Pause the stream while the tab is hidden; resume fresh on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) socket?.close();
    else if (socket?.readyState !== WebSocket.OPEN) connect();
  });

  setInterval(() => {
    const now = Date.now();
    for (const [mmsi, v] of vessels) {
      if (now - v.at > CONFIG.AIS_PRUNE_MS) vessels.delete(mmsi);
    }
    const items = [...vessels.entries()].map(([mmsi, v]) => ({
      id: `vessel-${mmsi}`,
      lng: v.lng,
      lat: v.lat,
      props: {
        group: 'vessel',
        color: CONFIG.VESSEL_COLOR,
        bearing: v.heading ?? 0,
        hasBearing: Number.isFinite(v.heading),
        stale: now - v.at > CONFIG.AIS_STALE_MS,
        title: v.name || `MMSI ${mmsi}`,
        dest: '',
        status: Number.isFinite(v.sog) ? `${v.sog.toFixed(1)} kn` : '',
        meta: `MMSI ${mmsi}`,
        updatedAt: new Date(v.at).toISOString(),
      },
    }));
    fleet.update(items);
    onCounts({ vessel: items.length });
  }, 2500);

  connect();
}
