// One shared AISStream connection for every Motion viewer.
//
// AISStream allows only 3 subscribed connections per account (and per IP), so
// a relay that opens one upstream per browser rejects the 4th viewer. AisHub
// is a single Durable Object ("new-england") that holds ONE upstream socket
// subscribed to the whole New England box, keeps the latest position of every
// vessel in memory, and fans frames out to browser sockets by region.
//
// - Browser sockets use the Hibernation API (ctx.acceptWebSocket) with the
//   region kept in the socket attachment.
// - A new browser socket immediately gets one Snapshot frame of every known
//   vessel in its region, with the real time it was last heard (`at`) so the
//   client can dim old positions and show their true age, and `quietMs`, the
//   listening time since then, so the client prunes by the same rule.
// - An alarm every 60 s reconnects the upstream (backoff + jitter), prunes old
//   entries, saves the snapshot as ONE SQLite row, and closes the upstream
//   after 20 minutes with no viewers. Deploys and evictions kill the upstream
//   socket; the saved snapshot lets a cold start serve old (dimmed) vessels
//   until live frames catch up.
//
// Vessels age by LISTENING time, not wall-clock time. The hub keeps a clock
// that only runs while the upstream is open; silence while nobody was
// listening is not evidence a boat left. A vessel is pruned after 15 minutes
// of listening without hearing it (60 minutes if it was moored, SOG < 1 kn:
// moored boats report every ~3 minutes but volunteer receivers pick them up
// only now and then), and anything older than 6 hours of real time is pruned
// regardless. The clock is saved in the snapshot row so it survives eviction.

import { DurableObject } from 'cloudflare:workers';
import { aisFrameToText } from './ais-frames';
import { AIS_BOUNDS, REGION_IDS, isRegionId, type RegionId } from './regions';

export const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
export const HUB_NAME = 'new-england';
export const AIS_MESSAGE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'ShipStaticData',
] as const;

export const ALARM_MS = 60_000;
// Listening time without a report before a vessel is dropped.
export const PRUNE_MOVING_MS = 15 * 60_000;
export const PRUNE_MOORED_MS = 60 * 60_000;
// Below this speed over ground (knots) a vessel counts as moored.
export const MOORED_SOG_KN = 1;
// Real-time cap: never serve a position older than this, listening or not.
export const MAX_AGE_MS = 6 * 60 * 60_000;
// Keep listening this long after the last viewer leaves, so the next visitor
// gets a warm snapshot instead of an empty map. Cost trade-off: an open
// upstream WebSocket keeps the Durable Object active (billed duration, no
// hibernation) for the whole idle tail. 20 minutes x 128 MB is about 150 GB-s
// per tail, versus about 38 GB-s at the previous 5 minutes.
export const IDLE_CLOSE_MS = 20 * 60_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const HEADING_UNAVAILABLE = 511;

// Just enough of the WebSocket surface for the upstream, so tests can inject
// a fake and never touch the network.
export interface UpstreamSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { code?: number }) => void): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
}
export type UpstreamFactory = (url: string) => UpstreamSocket;

export interface HubVessel {
  mmsi: string;
  lat: number;
  lng: number;
  sog: number | null;
  cog: number | null;
  // True heading, or null when the transponder reports 511 (not available).
  heading: number | null;
  name: string;
  shipType: number | null;
  // Real time (epoch ms) it was last heard.
  at: number;
  // Listening-clock value (ms) when it was last heard.
  heard: number;
}

interface StaticInfo {
  name: string;
  shipType: number | null;
  at: number;
  heard: number;
}

// Rows written before the listening clock have no `heard` or `listenedMs`.
type Saved<T> = Omit<T, 'heard'> & { heard?: number };

interface SavedSnapshot {
  savedAt: number;
  // Listening clock at save time.
  listenedMs?: number;
  vessels: Saved<HubVessel>[];
  statics: [string, Saved<StaticInfo>][];
}

interface SocketAttachment {
  region: RegionId;
}

type Box = [[number, number], [number, number]];

const finite = (value: unknown): number | null => {
  const number = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) ? number : null;
};

const cleanName = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/@+$/, '').trim() : '';

export const boxContains = ([[south, west], [north, east]]: Box, lat: number, lng: number): boolean =>
  lat >= south && lat <= north && lng >= west && lng <= east;

export const isMoored = (sog: number | null): boolean => sog !== null && sog >= 0 && sog < MOORED_SOG_KN;

// Listening time a vessel may go unheard. Unknown speed counts as moving.
export const quietLimitMs = (sog: number | null): number => (isMoored(sog) ? PRUNE_MOORED_MS : PRUNE_MOVING_MS);

const regionsContaining = (lat: number, lng: number): Set<RegionId> =>
  new Set(REGION_IDS.filter((region) => boxContains(AIS_BOUNDS[region], lat, lng)));

export class AisHub extends DurableObject<Env> {
  // Test hooks. Production uses the real WebSocket, the env secret and Date.now.
  upstreamFactory: UpstreamFactory = (url) => new WebSocket(url) as unknown as UpstreamSocket;
  apiKeyOverride: string | undefined;
  now: () => number = () => Date.now();

  vessels = new Map<string, HubVessel>();
  statics = new Map<string, StaticInfo>();
  upstream: UpstreamSocket | null = null;
  upstreamOpen = false;
  // Listening clock: banked ms of open upstream, plus the current open stretch.
  listenedMs = 0;
  listenSince: number | null = null;
  lastViewerAt: number;
  reconnectAttempts = 0;
  nextReconnectAt = 0;
  dirty = false;
  framesIn = 0;
  private relayQueue: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.lastViewerAt = Date.now();
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY, saved_at INTEGER NOT NULL, body TEXT NOT NULL)',
    );
    this.loadSnapshot();
  }

  // ---- Browser sockets ------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426, headers: { upgrade: 'websocket' } });
    }
    const requested = new URL(request.url).searchParams.get('region') ?? 'boston';
    if (!isRegionId(requested)) return new Response('Unknown region', { status: 400 });
    const region: RegionId = requested;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ region } satisfies SocketAttachment);
    // The alarm stops while idle, so drop anything past the 6-hour cap first.
    this.prune(this.now());
    server.send(JSON.stringify(this.snapshotFor(region)));

    this.lastViewerAt = this.now();
    this.ensureUpstream();
    await this.scheduleAlarm(this.now() + ALARM_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  snapshotFor(region: RegionId) {
    const box = AIS_BOUNDS[region];
    const now = this.now();
    const clock = this.listenClock(now);
    const vessels = [...this.vessels.values()]
      .filter((vessel) => boxContains(box, vessel.lat, vessel.lng))
      .map(({ heard, ...vessel }) => ({ ...vessel, quietMs: Math.max(0, clock - heard) }));
    return { MessageType: 'Snapshot', Region: region, At: now, Vessels: vessels };
  }

  // ---- Listening clock ------------------------------------------------------

  listenClock(now = this.now()): number {
    return this.listenedMs + (this.listenSince === null ? 0 : Math.max(0, now - this.listenSince));
  }

  private startListening(): void {
    if (this.listenSince === null) this.listenSince = this.now();
  }

  private stopListening(): void {
    if (this.listenSince === null) return;
    this.listenedMs = this.listenClock();
    this.listenSince = null;
    this.dirty = true; // save the banked clock even if no frame arrived
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Browsers only listen. Answer a text "ping" so clients can probe liveness.
    if (message === 'ping') ws.send('pong');
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.lastViewerAt = this.now();
    try {
      ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, reason.slice(0, 120));
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.lastViewerAt = this.now();
    try {
      ws.close(1011, 'Socket error');
    } catch {
      // Already closed.
    }
  }

  viewerCount(): number {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN).length;
  }

  private broadcast(text: string, lat: number | null, lng: number | null): void {
    const regions = lat !== null && lng !== null ? regionsContaining(lat, lng) : null;
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (!attachment || (regions && !regions.has(attachment.region))) continue;
      try {
        ws.send(text);
      } catch {
        // Closing socket; webSocketClose tidies up.
      }
    }
  }

  // ---- Upstream -------------------------------------------------------------

  private apiKey(): string | undefined {
    const key = this.apiKeyOverride ?? this.env.AISSTREAM_API_KEY;
    return key && !key.includes('placeholder') && !key.startsWith('replace-') ? key : undefined;
  }

  ensureUpstream(): void {
    if (this.upstream) return;
    const key = this.apiKey();
    if (!key || this.now() < this.nextReconnectAt) return;

    let socket: UpstreamSocket;
    try {
      socket = this.upstreamFactory(AISSTREAM_URL);
    } catch (error) {
      console.error('AIS upstream could not be created', error);
      this.upstreamDropped();
      return;
    }
    this.upstream = socket;
    this.upstreamOpen = false;

    socket.addEventListener('open', () => {
      if (this.upstream !== socket) return;
      this.upstreamOpen = true;
      this.startListening();
      // AISStream closes a connection that has not subscribed within 3 s.
      socket.send(JSON.stringify({
        APIKey: key,
        BoundingBoxes: [AIS_BOUNDS[HUB_NAME]],
        FilterMessageTypes: AIS_MESSAGE_TYPES,
      }));
    });
    socket.addEventListener('message', (event) => {
      if (this.upstream !== socket) return;
      // Decode sequentially so relayed messages keep their upstream order.
      this.relayQueue = this.relayQueue.then(async () => {
        const text = await aisFrameToText(event.data);
        if (text !== null) this.handleFrame(text);
      }).catch(() => {
        // Skip an undecodable frame; keep the relay open.
      });
    });
    socket.addEventListener('close', (event) => {
      if (this.upstream !== socket) return;
      console.warn(`AIS upstream closed (${event?.code ?? 'no code'})`);
      this.upstreamDropped();
    });
    socket.addEventListener('error', () => {
      if (this.upstream !== socket) return;
      console.warn('AIS upstream error');
      this.upstreamDropped();
      try {
        socket.close(1011, 'Upstream error');
      } catch {
        // Already closed.
      }
    });
  }

  private upstreamDropped(): void {
    this.stopListening();
    this.upstream = null;
    this.upstreamOpen = false;
    this.reconnectAttempts += 1;
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1));
    const delay = backoff / 2 + Math.random() * (backoff / 2); // jitter
    this.nextReconnectAt = this.now() + delay;
    // Wake up at the retry time rather than waiting a full alarm period.
    if (this.viewerCount() > 0) {
      this.scheduleAlarm(this.nextReconnectAt).catch(() => {});
    }
  }

  closeUpstream(reason: string): void {
    const socket = this.upstream;
    this.stopListening();
    this.upstream = null;
    this.upstreamOpen = false;
    if (!socket) return;
    try {
      socket.close(1000, reason);
    } catch {
      // Already closed.
    }
  }

  // Parse one AISStream JSON message, update state, and relay it.
  handleFrame(text: string): void {
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg?.error) {
      // AISStream reports bad keys or subscriptions as {"error": "..."}.
      console.error('AISStream error', String(msg.error).slice(0, 200));
      return;
    }
    const type = msg?.MessageType;
    const report = type ? msg.Message?.[type] : null;
    const meta = msg?.MetaData ?? {};
    const mmsi = String(meta.MMSI ?? report?.UserID ?? '');
    if (!report || !mmsi) return;

    this.framesIn += 1;
    if (this.reconnectAttempts) this.reconnectAttempts = 0;
    const now = this.now();
    const heard = this.listenClock(now);
    const lat = finite(meta.latitude ?? meta.Latitude ?? report.Latitude);
    const lng = finite(meta.longitude ?? meta.Longitude ?? report.Longitude);
    const existing = this.vessels.get(mmsi);

    if (type === 'ShipStaticData') {
      // Keep static data even before the vessel's first position report.
      const info: StaticInfo = {
        name: cleanName(report.Name) || cleanName(meta.ShipName) || this.statics.get(mmsi)?.name || '',
        shipType: finite(report.Type ?? report.TypeAndCargo ?? report.ShipType),
        at: now,
        heard,
      };
      this.statics.set(mmsi, info);
      if (existing) {
        if (info.name) existing.name = info.name;
        if (info.shipType !== null) existing.shipType = info.shipType;
      }
      this.dirty = true;
      this.broadcast(text, lat, lng);
      return;
    }

    if (lat === null || lng === null) return;
    const info = this.statics.get(mmsi);
    const trueHeading = finite(report.TrueHeading);
    const vessel: HubVessel = {
      mmsi,
      lat,
      lng,
      sog: finite(report.Sog),
      cog: finite(report.Cog),
      heading: trueHeading !== null && trueHeading !== HEADING_UNAVAILABLE ? trueHeading : null,
      name: cleanName(meta.ShipName) || info?.name || existing?.name || '',
      shipType: info?.shipType ?? existing?.shipType ?? finite(meta.ShipType),
      at: now,
      heard,
    };
    this.vessels.set(mmsi, vessel);
    this.dirty = true;

    // Fill in what the hub already knows so the browser can classify vessels
    // (ferry vs other) from the first position frame.
    let relay = text;
    if (vessel.shipType !== null && finite(meta.ShipType) === null) {
      msg.MetaData = { ...meta, ShipType: vessel.shipType, ShipName: meta.ShipName || vessel.name };
      relay = JSON.stringify(msg);
    }
    this.broadcast(relay, lat, lng);
  }

  // ---- Alarm, pruning, persistence -----------------------------------------

  async scheduleAlarm(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    const now = this.now();
    this.prune(now);
    const viewers = this.viewerCount();
    if (viewers > 0) this.lastViewerAt = now;

    const idle = viewers === 0 && now - this.lastViewerAt >= IDLE_CLOSE_MS;
    if (idle) this.closeUpstream('No viewers');
    else if (viewers > 0) this.ensureUpstream();

    if (this.dirty) this.saveSnapshot(now);

    // Keep ticking while anything is live; otherwise go quiet until a viewer
    // connects again (fetch schedules the next alarm).
    if (this.upstream || viewers > 0) {
      const next = this.upstream ? now + ALARM_MS : Math.min(now + ALARM_MS, Math.max(this.nextReconnectAt, now + 1_000));
      await this.ctx.storage.setAlarm(next);
    }
  }

  // Drop vessels unheard for their listening-time limit, or older than the
  // real-time cap. Static records live as long as their vessel; on their own
  // they follow the same rule with unknown speed (15 min of listening).
  prune(now = this.now()): void {
    const clock = this.listenClock(now);
    for (const [mmsi, vessel] of this.vessels) {
      if (now - vessel.at > MAX_AGE_MS || clock - vessel.heard > quietLimitMs(vessel.sog)) {
        this.vessels.delete(mmsi);
        this.dirty = true;
      }
    }
    for (const [mmsi, info] of this.statics) {
      const orphanQuiet = !this.vessels.has(mmsi) && clock - info.heard > quietLimitMs(null);
      if (now - info.at > MAX_AGE_MS || orphanQuiet) {
        this.statics.delete(mmsi);
        this.dirty = true;
      }
    }
  }

  // One row, replaced each time: ~1,440 writes a day at most.
  saveSnapshot(now = this.now()): void {
    const body: SavedSnapshot = {
      savedAt: now,
      listenedMs: this.listenClock(now),
      vessels: [...this.vessels.values()],
      statics: [...this.statics.entries()],
    };
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO snapshot (id, saved_at, body) VALUES (1, ?, ?)',
      now,
      JSON.stringify(body),
    );
    this.dirty = false;
  }

  private loadSnapshot(): void {
    const row = this.ctx.storage.sql.exec<{ body: string }>('SELECT body FROM snapshot WHERE id = 1').toArray()[0];
    if (!row) return;
    try {
      const saved = JSON.parse(row.body) as SavedSnapshot;
      // The upstream died with the old instance: resume the clock where the
      // save left it, stopped until the next upstream opens.
      const clock = Number.isFinite(saved.listenedMs) ? Number(saved.listenedMs) : 0;
      const savedAt = Number.isFinite(saved.savedAt) ? saved.savedAt : this.now();
      this.listenedMs = clock;
      this.listenSince = null;
      // Older rows have no listening stamp: count their real age as listening.
      const heardOf = (record: { at: number; heard?: number }): number =>
        Number.isFinite(record.heard) ? Number(record.heard) : clock - Math.max(0, savedAt - record.at);
      for (const vessel of saved.vessels ?? []) {
        this.vessels.set(vessel.mmsi, { ...vessel, heard: heardOf(vessel) });
      }
      for (const [mmsi, info] of saved.statics ?? []) this.statics.set(mmsi, { ...info, heard: heardOf(info) });
      this.prune(this.now());
      this.dirty = false;
    } catch {
      // Corrupt row: start empty and overwrite it on the next save.
    }
  }
}
