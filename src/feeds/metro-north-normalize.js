// Pure Metro-North trip -> map item conversion, kept free of browser globals so
// the gateway test pool can exercise it (same split as amtrak-normalize.js).

function bearingBetween(from, to) {
  const radians = Math.atan2(to.lng - from.lng, to.lat - from.lat);
  return (radians * 180 / Math.PI + 360) % 360;
}

export function trainItem(trip, stops, { color = '#ee0034', staleAfterMs = 120_000, now = Date.now() } = {}) {
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
  return {
    id: `mnr-${trip.id}`,
    detail: {
      trainNumber: trip.label ? String(trip.label) : '',
      routeName: `${trip.routeName} Line`,
      headsign: destination?.name ?? '',
      nextStop: next?.name ?? '',
      nextMinutes: minutes,
    },
    lng: gps ? gps.lng : previous.lng + (next.lng - previous.lng) * progress,
    lat: gps ? gps.lat : previous.lat + (next.lat - previous.lat) * progress,
    props: {
      group: 'commuter',
      dataStatus: gps ? 'live' : 'estimated',
      legendKey: 'metro-north',
      legendLabel: 'Metro-North',
      modeColor,
      color: modeColor,
      shadeKey: trip.routeId ? `metro-north:${trip.routeId}` : '',
      bearing: previous && next ? bearingBetween(previous, next) : 0,
      hasBearing: Boolean(previous && next),
      stale: now - Date.parse(updatedAt) > staleAfterMs,
      title: `Metro-North · ${trip.routeName} Line`,
      dest: `${trip.label ? `Train ${trip.label}` : 'Train'}${destination ? ` to ${destination.name}` : ''}`,
      status: leg,
      meta: gps ? 'GPS position from MTA Metro-North' : 'Estimated position from MTA trip updates',
      provider: 'MTA Metro-North GTFS-Realtime',
      sourceUrl: 'https://www.mta.info/developers',
      updatedAt,
    },
  };
}
