// Pure gateway vehicle -> map item conversion for the regional bus and ferry
// feeds, kept free of browser globals so it can be fixture-tested (same split
// as amtrak-normalize.js). Operator colors are applied by the caller.

const MPS_TO_MPH = 2.23694;

export function regionalVehicleItem(vehicle, now, { ferryFeeds, busColor, ferryColor, staleAfterMs }) {
  const isFerry = ferryFeeds.includes(vehicle.feed);
  const modeColor = isFerry ? ferryColor : busColor;
  return {
    id: `regional-${vehicle.id}`,
    detail: {
      label: vehicle.label ? String(vehicle.label) : '',
      routeName: vehicle.route ?? '',
      agency: vehicle.agency ?? '',
    },
    lng: vehicle.lng,
    lat: vehicle.lat,
    props: {
      group: isFerry ? 'ferry' : 'bus',
      route: vehicle.route || vehicle.agency || '',
      dataStatus: 'live',
      legendKey: vehicle.feed,
      legendLabel: vehicle.agency ?? vehicle.feed,
      modeColor,
      color: modeColor,
      // Static route features carry `${feed}:${routeId}`; matching it gives the same shade.
      shadeKey: vehicle.route ? `${vehicle.feed}:${vehicle.route}` : '',
      bearing: vehicle.bearing ?? 0,
      hasBearing: Number.isFinite(vehicle.bearing),
      stale: now - Date.parse(vehicle.updatedAt) > staleAfterMs,
      title: vehicle.route ? `${vehicle.agency} · ${vehicle.route}` : vehicle.agency,
      dest: vehicle.label ? `Vehicle ${vehicle.label}` : '',
      status: Number.isFinite(vehicle.speedMps)
        ? `${Math.round(vehicle.speedMps * MPS_TO_MPH)} mph`
        : 'In service',
      meta: `GTFS-RT · ${vehicle.feed}`,
      provider: `${vehicle.agency} GTFS-Realtime`,
      updatedAt: vehicle.updatedAt,
    },
  };
}
