// Pure Amtraker normalization helpers. Kept separate from the browser poller
// so feed truth, timestamps, and popup fields can be fixture-tested.

const COMPASS = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

export function delayLabel(station) {
  const scheduled = Date.parse(station?.schArr);
  const expected = Date.parse(station?.arr);
  if (!Number.isFinite(scheduled) || !Number.isFinite(expected)) return '';
  const minutes = Math.round((expected - scheduled) / 60_000);
  if (minutes >= 2) return `${minutes} min late`;
  if (minutes <= -2) return `${Math.abs(minutes)} min early`;
  return 'on time';
}

export function ageAmtrakItems(items, now, staleAfterMs) {
  return items.map((item) => {
    const updatedMs = Date.parse(item.props.updatedAt);
    return {
      ...item,
      props: {
        ...item.props,
        stale: !Number.isFinite(updatedMs) || now - updatedMs > staleAfterMs,
      },
    };
  });
}

export function normalizeAmtrakTrain(train, { box, color, now, staleAfterMs }) {
  const lat = Number(train.lat);
  const lon = Number(train.lon);
  if (
    train.trainState === 'Completed'
    || !Number.isFinite(lat)
    || !Number.isFinite(lon)
    || lat <= box.latMin
    || lat >= box.latMax
    || lon <= box.lonMin
    || lon >= box.lonMax
  ) {
    return null;
  }

  const heading = COMPASS[train.heading];
  const stations = train.stations ?? [];
  const nextStation = stations.find((station) => station.status === 'Enroute');
  const finalStation = stations.at(-1);
  const origin = train.origName || stations[0]?.name;
  const destination = train.destName || finalStation?.name;
  const predeparture = train.trainState === 'Predeparture';
  // Predeparture coordinates are estimates, not telemetry. Their age describes
  // this successful feed observation; active trains use the actual position fix.
  const updatedAt = predeparture
    ? new Date(now).toISOString()
    : (train.lastValTS ?? train.updatedAt);
  const delay = delayLabel(nextStation);
  const velocity = Number(train.velocity);
  const item = {
    id: `amtrak-${train.trainID ?? train.trainNum}`,
    lng: lon,
    lat,
    props: {
      group: 'amtrak',
      dataStatus: predeparture ? 'estimated' : 'live',
      color,
      bearing: heading ?? 0,
      hasBearing: heading !== undefined,
      stale: false,
      title: `Amtrak ${train.routeName ?? ''}`.trim(),
      dest: origin && destination
        ? `${origin} → ${destination}`
        : (destination ? `to ${destination}` : ''),
      status: predeparture
        ? `Scheduled to depart ${origin || nextStation?.name || 'origin station'}`
        : (nextStation?.name
          ? `Next stop ${nextStation.name}${delay ? ` · ${delay}` : ''}`
          : (train.trainState ?? '')),
      meta: [
        train.trainNum ? `train ${train.trainNum}` : '',
        Number.isFinite(velocity) ? `${Math.round(velocity)} mph` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      provider: 'Amtraker community Amtrak telemetry',
      sourceUrl: 'https://amtraker.com/',
      updatedAt,
    },
  };
  return ageAmtrakItems([item], now, staleAfterMs)[0];
}
