// Pure MTA rail trip -> map item conversion (Metro-North and the Long Island
// Rail Road share one gateway shape), kept free of browser globals so the
// gateway test pool can exercise it (same split as amtrak-normalize.js).

export function bearingBetween(from, to) {
  const radians = Math.atan2(to.lng - from.lng, to.lat - from.lat);
  return (radians * 180 / Math.PI + 360) % 360;
}

export const METRO_NORTH = {
  idPrefix: 'mnr',
  legendKey: 'metro-north',
  legendLabel: 'Metro-North',
  operator: 'Metro-North',
  lineWord: 'Line',
  provider: 'MTA Metro-North GTFS-Realtime',
  gpsMeta: 'GPS position from MTA Metro-North',
};

export const LIRR = {
  idPrefix: 'lirr',
  legendKey: 'lirr',
  legendLabel: 'Long Island Rail Road',
  operator: 'LIRR',
  lineWord: 'Branch',
  provider: 'MTA Long Island Rail Road GTFS-Realtime',
  gpsMeta: 'GPS position from MTA LIRR',
};

export function trainItem(trip, stops, { color = '#ee0034', staleAfterMs = 120_000, now = Date.now(), service = METRO_NORTH } = {}) {
  const previous = stops[trip.previousStopId];
  const next = stops[trip.nextStopId];
  const destination = stops[trip.destinationStopId];
  const gps = trip.position && Number.isFinite(trip.position.lat) && Number.isFinite(trip.position.lng)
    ? trip.position
    : null;
  // An estimate needs both stations; a GPS fix only needs somewhere to head.
  if (!gps && (!previous || !next)) return null;
  const progress = Math.max(0, Math.min(1, Number(trip.progress) || 0));
  const minutes = Number.isFinite(trip.nextTime)
    ? Math.max(0, Math.round((trip.nextTime * 1000 - now) / 60_000))
    : null;
  const eta = minutes === null ? '' : ` · ${minutes ? `${minutes} min` : 'due'}`;
  const leg = previous && next
    ? `${previous.name} → ${next.name}${eta}`
    : next ? `Next stop ${next.name}${eta}` : 'In service';
  const updatedAt = gps?.at ?? trip.updatedAt;
  const modeColor = trip.color ?? color;
  const lineName = `${trip.routeName} ${service.lineWord}`;
  return {
    id: `${service.idPrefix}-${trip.id}`,
    detail: {
      trainNumber: trip.label ? String(trip.label) : '',
      routeName: lineName,
      headsign: destination?.name ?? '',
      nextStop: next?.name ?? '',
      nextMinutes: minutes,
    },
    lng: gps ? gps.lng : previous.lng + (next.lng - previous.lng) * progress,
    lat: gps ? gps.lat : previous.lat + (next.lat - previous.lat) * progress,
    props: {
      group: 'commuter',
      route: trip.routeName ?? '',
      dataStatus: gps ? 'live' : 'estimated',
      legendKey: service.legendKey,
      legendLabel: service.legendLabel,
      modeColor,
      color: modeColor,
      shadeKey: trip.routeId ? `${service.legendKey}:${trip.routeId}` : '',
      bearing: previous && next ? bearingBetween(previous, next) : 0,
      hasBearing: Boolean(previous && next),
      stale: now - Date.parse(updatedAt) > staleAfterMs,
      title: `${service.operator} · ${lineName}`,
      dest: `${trip.label ? `Train ${trip.label}` : 'Train'}${destination ? ` to ${destination.name}` : ''}`,
      status: leg,
      meta: gps ? service.gpsMeta : 'Estimated position from MTA trip updates',
      provider: service.provider,
      sourceUrl: 'https://www.mta.info/developers',
      updatedAt,
    },
  };
}
