import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { OPEN_WATERS_URL, openWatersCredit, openWatersEventToAisstream } from '../src/ais-hub';
import { AIS_BOUNDS } from '../src/regions';

// A fake AISStream socket: the hub never touches the network in tests.
class FakeUpstream {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closedWith = null;
    this.listeners = {};
  }
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  emit(type, event = {}) {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
  open() {
    this.readyState = 1;
    this.emit('open');
  }
  send(data) {
    this.sent.push(data);
  }
  close(code) {
    this.readyState = 3;
    this.closedWith = code ?? 1000;
  }
}

const BOSTON = [42.35, -71.0];
const PORTLAND_ME = [43.65, -70.25];
const MIN = 60_000;
const HOUR = 60 * MIN;

const position = (mmsi, [lat, lng], name = '', sog = 7.5) => ({
  MessageType: 'PositionReport',
  MetaData: { MMSI: mmsi, ShipName: name, latitude: lat, longitude: lng },
  Message: { PositionReport: { Sog: sog, Cog: 91, TrueHeading: 511, Latitude: lat, Longitude: lng } },
});
const shipStatic = (mmsi, name, type) => ({
  MessageType: 'ShipStaticData',
  MetaData: { MMSI: mmsi, ShipName: name },
  Message: { ShipStaticData: { Name: name, Type: type } },
});

let hubCount = 0;
async function freshHub(apiKey = 'test-key') {
  hubCount += 1;
  const stub = env.AIS_HUB.getByName(`test-hub-${hubCount}`);
  await armHub(stub, apiKey);
  return stub;
}

// Install the fake upstream on the (possibly new) instance behind the stub.
async function armHub(stub, apiKey = 'test-key') {
  await runInDurableObject(stub, (hub) => {
    hub.upstreamCreated = 0;
    hub.upstreamFactory = (url) => {
      hub.upstreamCreated += 1;
      return new FakeUpstream(url);
    };
    hub.apiKeyOverride = apiKey;
    hub.refreshCredits = async () => {};
  });
}

async function connect(stub, region) {
  const response = await stub.fetch(`http://hub.test/?region=${region}`, {
    headers: { upgrade: 'websocket' },
  });
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  const messages = [];
  ws.addEventListener('message', (event) => {
    messages.push(JSON.parse(event.data));
  });
  ws.accept();
  await vi.waitFor(() => expect(messages.length).toBeGreaterThan(0));
  return { ws, messages };
}

const feed = (stub, ...frames) =>
  runInDurableObject(stub, (hub) => {
    for (const frame of frames) hub.handleFrame(JSON.stringify(frame));
  });

// Pin the hub's clock to a fixed real time.
const setNow = (stub, at) =>
  runInDurableObject(stub, (hub) => {
    hub.now = () => at;
  });

// Open the fake upstream at `at`, which starts the listening clock.
const listen = (stub, at) =>
  runInDurableObject(stub, (hub) => {
    hub.now = () => at;
    hub.ensureUpstream();
    hub.upstream.open();
  });

const pruneAt = (stub, at) =>
  runInDurableObject(stub, (hub) => {
    hub.now = () => at;
    hub.prune();
    return { vessels: [...hub.vessels.keys()], statics: [...hub.statics.keys()], clock: hub.listenClock() };
  });

describe('AisHub', () => {
  it('requires a WebSocket upgrade', async () => {
    const stub = await freshHub();
    const response = await stub.fetch('http://hub.test/?region=ma');
    expect(response.status).toBe(426);
  });

  it('sends a region-filtered snapshot with server timestamps on connect', async () => {
    const stub = await freshHub();
    await feed(stub, position(111, BOSTON, 'HARBOR TUG'), position(222, PORTLAND_ME, 'CASCO BAY'));

    const boston = await connect(stub, 'boston');
    const [snapshot] = boston.messages;
    expect(snapshot.MessageType).toBe('Snapshot');
    expect(snapshot.Vessels.map((vessel) => vessel.mmsi)).toEqual(['111']);
    expect(snapshot.Vessels[0]).toMatchObject({ name: 'HARBOR TUG', heading: null, cog: 91, sog: 7.5, quietMs: 0 });
    expect(Number.isFinite(snapshot.Vessels[0].at)).toBe(true);
    expect(snapshot.Vessels[0]).not.toHaveProperty('heard');

    const maine = await connect(stub, 'me');
    expect(maine.messages[0].Vessels.map((vessel) => vessel.mmsi)).toEqual(['222']);

    const all = await connect(stub, 'new-england');
    expect(all.messages[0].Vessels).toHaveLength(2);
    for (const socket of [boston, maine, all]) socket.ws.close(1000, 'done');
  });

  it('shares one upstream subscribed to the New England box across viewers', async () => {
    const stub = await freshHub();
    const sockets = [];
    for (let i = 0; i < 4; i += 1) sockets.push(await connect(stub, 'boston'));
    const upstream = await runInDurableObject(stub, (hub) => {
      hub.upstream.open();
      return { created: hub.upstreamCreated, url: hub.upstream.url, sent: hub.upstream.sent };
    });
    expect(upstream.created).toBe(1);
    expect(upstream.url).toBe('wss://stream.aisstream.io/v0/stream');
    const subscription = JSON.parse(upstream.sent[0]);
    expect(subscription.APIKey).toBe('test-key');
    expect(subscription.BoundingBoxes).toEqual([AIS_BOUNDS['new-england']]);
    expect(subscription.FilterMessageTypes).toContain('ShipStaticData');
    for (const socket of sockets) socket.ws.close(1000, 'done');
  });

  it('uses Open Waters when the AISStream key is unset', async () => {
    const stub = await freshHub('');
    const viewer = await connect(stub, 'ma');
    const upstream = await runInDurableObject(stub, (hub) => {
      hub.upstream.open();
      return { created: hub.upstreamCreated, url: hub.upstream.url, sent: hub.upstream.sent };
    });
    const [[south, west], [north, east]] = AIS_BOUNDS['new-england'];
    expect(upstream.created).toBe(1);
    expect(upstream.url).toBe(OPEN_WATERS_URL);
    expect(JSON.parse(upstream.sent[0])).toEqual({
      type: 'subscribe',
      bbox: [[south, west, north, east]],
      snapshot: true,
    });
    expect(JSON.parse(upstream.sent[0]).APIKey).toBeUndefined();
    viewer.ws.close(1000, 'done');
  });

  it('credits an Open Waters vessel and relays an AISStream-shaped frame', async () => {
    const stub = await freshHub('');
    await runInDurableObject(stub, (hub) => {
      hub.handleOpenWatersFrame(JSON.stringify({
        type: 'welcome',
        role: 'anonymous',
      }));
      hub.handleOpenWatersFrame(JSON.stringify({
        type: 'event',
        source: 'aishub',
        mmsi: 111,
        msg_type: 'PositionReport',
        lat: BOSTON[0],
        lon: BOSTON[1],
        time: '2026-10-06T20:00:00.000Z',
        message: {
          UserID: 111,
          Sog: 4.2,
          Cog: 10,
          TrueHeading: 511,
          Latitude: BOSTON[0],
          Longitude: BOSTON[1],
        },
      }));
      hub.handleOpenWatersFrame(JSON.stringify({ type: 'error', error: 'ignored' }));
    });
    const viewer = await connect(stub, 'boston');
    expect(viewer.messages[0].Vessels).toHaveLength(1);
    expect(viewer.messages[0].Vessels[0]).toMatchObject({
      mmsi: '111',
      source: 'aishub',
      credit: 'AISHub',
      sog: 4.2,
    });
    expect(viewer.messages[0].Attribution).toEqual(['AISHub']);
    expect(openWatersCredit('kystverket')).toBe(
      'Contains data under the Norwegian licence for Open Government data (NLOD) distributed by the Norwegian Coastal Administration.',
    );
    expect(openWatersCredit('barentswatch')).toBe('Data delivered by BarentsWatch');
    expect(openWatersCredit('digitraffic')).toBe('Source: Fintraffic / digitraffic.fi, license CC 4.0 BY.');
    expect(openWatersEventToAisstream({ type: 'welcome' })).toBeNull();
    viewer.ws.close(1000, 'done');
  });

  it('forwards live binary frames only to sockets whose region contains them', async () => {
    const stub = await freshHub();
    const boston = await connect(stub, 'boston');
    const maine = await connect(stub, 'me');
    const encode = (frame) => new TextEncoder().encode(JSON.stringify(frame)).buffer;

    await runInDurableObject(stub, (hub) => {
      hub.upstream.open();
      hub.upstream.emit('message', { data: encode(position(333, BOSTON)) });
      hub.upstream.emit('message', { data: encode(position(444, PORTLAND_ME)) });
    });
    await vi.waitFor(() => {
      expect(boston.messages).toHaveLength(2);
      expect(maine.messages).toHaveLength(2);
    });
    expect(boston.messages[1].MetaData.MMSI).toBe(333);
    expect(maine.messages[1].MetaData.MMSI).toBe(444);
    boston.ws.close(1000, 'done');
    maine.ws.close(1000, 'done');
  });

  it('keeps static data that arrives before the first position and merges it', async () => {
    const stub = await freshHub();
    const boston = await connect(stub, 'boston');
    await feed(stub, shipStatic(555, 'ISLAND QUEEN@@', 60));
    const before = await runInDurableObject(stub, (hub) => ({
      statics: hub.statics.get('555'),
      vessel: hub.vessels.get('555') ?? null,
    }));
    expect(before.statics).toMatchObject({ name: 'ISLAND QUEEN', shipType: 60 });
    expect(before.vessel).toBeNull();

    // Capitalized coordinate keys are accepted too.
    const frame = position(555, BOSTON);
    frame.MetaData = { MMSI: 555, ShipName: '', Latitude: BOSTON[0], Longitude: BOSTON[1] };
    await feed(stub, frame);
    const vessel = await runInDurableObject(stub, (hub) => hub.vessels.get('555'));
    expect(vessel).toMatchObject({ name: 'ISLAND QUEEN', shipType: 60, lat: BOSTON[0], lng: BOSTON[1] });

    // The relayed position frame carries the known ship type for the browser.
    await vi.waitFor(() => expect(boston.messages.at(-1).MessageType).toBe('PositionReport'));
    expect(boston.messages.at(-1).MetaData).toMatchObject({ ShipType: 60, ShipName: 'ISLAND QUEEN' });
    boston.ws.close(1000, 'done');
  });

  it('does not age vessels while the upstream is closed', async () => {
    const stub = await freshHub();
    const t0 = Date.now();
    await setNow(stub, t0);
    await feed(stub, position(666, BOSTON, 'QUIET HOURS'), shipStatic(777, 'NO POSITION', 70));

    // Five hours with nobody listening: silence is not evidence they left.
    await runInDurableObject(stub, async (hub, state) => {
      hub.now = () => t0 + 5 * HOUR;
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const left = await runInDurableObject(stub, (hub) => [hub.vessels.size, hub.statics.size, hub.listenClock()]);
    expect(left).toEqual([1, 1, 0]);

    // The next visitor sees the boat with its true age and no listening silence.
    const viewer = await connect(stub, 'boston');
    expect(viewer.messages[0].Vessels).toEqual([
      expect.objectContaining({ mmsi: '666', at: t0, quietMs: 0 }),
    ]);
    viewer.ws.close(1000, 'done');
  });

  it('prunes moving vessels after 15 and moored vessels after 60 minutes of listening', async () => {
    const stub = await freshHub();
    const t0 = Date.now();
    await listen(stub, t0);
    await feed(
      stub,
      position(611, BOSTON, 'UNDER WAY', 7.5),
      position(612, BOSTON, 'AT THE PIER', 0.2),
      position(613, BOSTON, 'NO SPEED', null),
      shipStatic(614, 'STATIC ONLY', 70),
    );

    expect(await pruneAt(stub, t0 + 14 * MIN)).toMatchObject({
      vessels: ['611', '612', '613'],
      statics: ['614'],
      clock: 14 * MIN,
    });

    // The alarm prunes at 16 minutes: moving, unknown speed and the orphan
    // static go; the moored boat stays.
    await runInDurableObject(stub, async (hub, state) => {
      hub.now = () => t0 + 16 * MIN;
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await pruneAt(stub, t0 + 16 * MIN)).toMatchObject({ vessels: ['612'], statics: [] });

    expect((await pruneAt(stub, t0 + 59 * MIN)).vessels).toEqual(['612']);
    expect((await pruneAt(stub, t0 + 61 * MIN)).vessels).toEqual([]);
  });

  it('always prunes positions older than 6 hours of real time', async () => {
    const stub = await freshHub();
    const t0 = Date.now();
    await setNow(stub, t0);
    await feed(stub, position(621, BOSTON, 'LONG MOORED', 0), shipStatic(622, 'OLD STATIC', 70));

    expect(await pruneAt(stub, t0 + 6 * HOUR - MIN)).toMatchObject({ vessels: ['621'], statics: ['622'] });

    // A visitor past the cap gets an empty snapshot without waiting for an alarm.
    await setNow(stub, t0 + 6 * HOUR + MIN);
    const viewer = await connect(stub, 'boston');
    expect(viewer.messages[0].Vessels).toEqual([]);
    expect(await pruneAt(stub, t0 + 6 * HOUR + MIN)).toMatchObject({ vessels: [], statics: [] });
    viewer.ws.close(1000, 'done');
  });

  it('persists the snapshot as one row and reloads it after eviction', async () => {
    const stub = await freshHub();
    await feed(stub, position(888, BOSTON, 'PILOT BOAT'));
    const rows = await runInDurableObject(stub, (hub, state) => {
      hub.saveSnapshot();
      hub.saveSnapshot();
      return state.storage.sql.exec('SELECT COUNT(*) AS n FROM snapshot').one().n;
    });
    expect(rows).toBe(1);

    await evictDurableObject(stub);
    await armHub(stub);
    const reloaded = await runInDurableObject(stub, (hub) => hub.vessels.get('888'));
    expect(reloaded).toMatchObject({ name: 'PILOT BOAT' });
    const viewer = await connect(stub, 'ma');
    expect(viewer.messages[0].Vessels.map((vessel) => vessel.mmsi)).toEqual(['888']);
    viewer.ws.close(1000, 'done');
  });

  it('keeps the listening clock across saveSnapshot and a cold start', async () => {
    const stub = await freshHub();
    const t0 = Date.now();
    await listen(stub, t0);
    await feed(stub, position(631, BOSTON, 'HARBOR PILOT'));
    const savedClock = await runInDurableObject(stub, (hub) => {
      hub.now = () => t0 + 10 * MIN;
      hub.saveSnapshot();
      return hub.listenClock();
    });
    expect(savedClock).toBe(10 * MIN);

    await evictDurableObject(stub);
    await armHub(stub);

    // Two hours later with nobody listening, the boat has still only gone
    // unheard for 10 minutes of listening time.
    expect(await pruneAt(stub, t0 + 2 * HOUR)).toEqual({ vessels: ['631'], statics: [], clock: 10 * MIN });
    const viewer = await connect(stub, 'boston');
    expect(viewer.messages[0].Vessels).toEqual([
      expect.objectContaining({ mmsi: '631', at: t0, quietMs: 10 * MIN }),
    ]);

    // Six more minutes of listening make 16: pruned. A clock that restarted at
    // zero after the eviction would still keep it.
    await runInDurableObject(stub, (hub) => hub.upstream.open());
    expect(await pruneAt(stub, t0 + 2 * HOUR + 6 * MIN)).toMatchObject({ vessels: [], clock: 16 * MIN });
    viewer.ws.close(1000, 'done');
  });

  it('reads snapshot rows saved before the listening clock existed', async () => {
    const stub = await freshHub();
    const savedAt = Date.now();
    await runInDurableObject(stub, (hub, state) => {
      const body = {
        savedAt,
        vessels: [{ mmsi: '641', lat: BOSTON[0], lng: BOSTON[1], sog: 5, cog: 0, heading: null, name: 'OLD ROW', shipType: null, at: savedAt - 5 * MIN }],
        statics: [],
      };
      state.storage.sql.exec('INSERT OR REPLACE INTO snapshot (id, saved_at, body) VALUES (1, ?, ?)', savedAt, JSON.stringify(body));
    });
    await evictDurableObject(stub);
    await armHub(stub);
    const vessel = await runInDurableObject(stub, (hub) => ({ ...hub.vessels.get('641'), clock: hub.listenClock() }));
    // Real age at save counts as listening silence.
    expect(vessel).toMatchObject({ name: 'OLD ROW', heard: -5 * MIN, clock: 0 });
  });

  it('reconnects a dropped upstream with backoff while viewers remain', async () => {
    const stub = await freshHub();
    const viewer = await connect(stub, 'boston');
    const dropped = await runInDurableObject(stub, (hub) => {
      hub.upstream.open();
      hub.upstream.emit('close', { code: 1006 });
      return { upstream: hub.upstream, wait: hub.nextReconnectAt - Date.now() };
    });
    expect(dropped.upstream).toBeNull();
    expect(dropped.wait).toBeGreaterThan(0);

    await runInDurableObject(stub, (hub) => {
      hub.now = () => hub.nextReconnectAt + 1;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const after = await runInDurableObject(stub, (hub) => ({
      created: hub.upstreamCreated,
      live: hub.upstream !== null,
    }));
    expect(after).toEqual({ created: 2, live: true });
    viewer.ws.close(1000, 'done');
  });

  it('closes the upstream after 20 minutes with no viewers and stops the listening clock', async () => {
    const stub = await freshHub();
    const t0 = Date.now();
    await setNow(stub, t0);
    const viewer = await connect(stub, 'boston');
    await runInDurableObject(stub, (hub) => hub.upstream.open());
    viewer.ws.close(1000, 'bye');
    await vi.waitFor(async () => {
      expect(await runInDurableObject(stub, (hub) => hub.viewerCount())).toBe(0);
    });

    // Not idle long enough yet: the upstream stays warm at 6 and 19 minutes.
    for (const minutes of [6, 19]) {
      await setNow(stub, t0 + minutes * MIN);
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      expect(await runInDurableObject(stub, (hub) => hub.upstream !== null)).toBe(true);
    }

    const fake = await runInDurableObject(stub, (hub) => {
      const upstream = hub.upstream;
      hub.now = () => t0 + 21 * MIN;
      return upstream;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const state = await runInDurableObject(stub, async (hub, doState) => ({
      upstream: hub.upstream,
      alarm: await doState.storage.getAlarm(),
      clock: hub.listenClock(),
      later: hub.listenClock(t0 + 3 * HOUR),
      saved: JSON.parse(doState.storage.sql.exec('SELECT body FROM snapshot WHERE id = 1').one().body).listenedMs,
    }));
    expect(state).toEqual({ upstream: null, alarm: null, clock: 21 * MIN, later: 21 * MIN, saved: 21 * MIN });
    expect(fake.closedWith).toBe(1000);
  });
});
