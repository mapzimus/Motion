import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
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

const position = (mmsi, [lat, lng], name = '') => ({
  MessageType: 'PositionReport',
  MetaData: { MMSI: mmsi, ShipName: name, latitude: lat, longitude: lng },
  Message: { PositionReport: { Sog: 7.5, Cog: 91, TrueHeading: 511, Latitude: lat, Longitude: lng } },
});
const shipStatic = (mmsi, name, type) => ({
  MessageType: 'ShipStaticData',
  MetaData: { MMSI: mmsi, ShipName: name },
  Message: { ShipStaticData: { Name: name, Type: type } },
});

let hubCount = 0;
async function freshHub() {
  hubCount += 1;
  const stub = env.AIS_HUB.getByName(`test-hub-${hubCount}`);
  await armHub(stub);
  return stub;
}

// Install the fake upstream on the (possibly new) instance behind the stub.
async function armHub(stub) {
  await runInDurableObject(stub, (hub) => {
    hub.upstreamCreated = 0;
    hub.upstreamFactory = (url) => {
      hub.upstreamCreated += 1;
      return new FakeUpstream(url);
    };
    hub.apiKeyOverride = 'test-key';
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
    expect(snapshot.Vessels[0]).toMatchObject({ name: 'HARBOR TUG', heading: null, cog: 91, sog: 7.5 });
    expect(Number.isFinite(snapshot.Vessels[0].at)).toBe(true);

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

  it('prunes vessels older than 15 minutes on the alarm', async () => {
    const stub = await freshHub();
    await feed(stub, position(666, BOSTON), shipStatic(777, 'NO POSITION', 70));
    await runInDurableObject(stub, async (hub, state) => {
      hub.now = () => Date.now() + 16 * 60_000;
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const left = await runInDurableObject(stub, (hub) => [hub.vessels.size, hub.statics.size]);
    expect(left).toEqual([0, 0]);
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

  it('closes the upstream after 5 minutes with no viewers', async () => {
    const stub = await freshHub();
    const viewer = await connect(stub, 'boston');
    await runInDurableObject(stub, (hub) => hub.upstream.open());
    viewer.ws.close(1000, 'bye');
    await vi.waitFor(async () => {
      expect(await runInDurableObject(stub, (hub) => hub.viewerCount())).toBe(0);
    });

    // Not idle long enough yet: the upstream stays warm.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await runInDurableObject(stub, (hub) => hub.upstream !== null)).toBe(true);

    const fake = await runInDurableObject(stub, (hub) => {
      const upstream = hub.upstream;
      hub.now = () => Date.now() + 6 * 60_000;
      return upstream;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const state = await runInDurableObject(stub, async (hub, doState) => ({
      upstream: hub.upstream,
      alarm: await doState.storage.getAlarm(),
    }));
    expect(state).toEqual({ upstream: null, alarm: null });
    expect(fake.closedWith).toBe(1000);
  });
});
