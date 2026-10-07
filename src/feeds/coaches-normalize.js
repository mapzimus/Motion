// Gateway coach -> map item. Operator color is applied by the caller.
// A parked coach often reports azimuth 0; that is not a heading.

const BEARING_MIN_MPH = 5;

export function coachItem(vehicle, now, { busColor, staleAfterMs }) {
  const speed = Number(vehicle.speedMph);
  const bearing = Number(vehicle.bearing);
  const hasSpeed = Number.isFinite(speed);
  const moving = hasSpeed && speed >= BEARING_MIN_MPH;
  return {
    id: `coaches-${vehicle.id}`,
    detail: {
      label: vehicle.route ? String(vehicle.route) : '',
      routeName: vehicle.dest ?? '',
      routeShortName: vehicle.route ? String(vehicle.route) : '',
    },
    lng: vehicle.lng,
    lat: vehicle.lat,
    props: {
      group: 'bus',
      dataStatus: 'live',
      legendKey: 'peter-pan',
      legendLabel: 'Peter Pan Bus Lines',
      modeColor: busColor,
      color: busColor,
      shadeKey: vehicle.route ? `peter-pan:${vehicle.route}` : '',
      bearing: Number.isFinite(bearing) ? bearing : 0,
      hasBearing: moving && Number.isFinite(bearing),
      stale: now - Date.parse(vehicle.updatedAt) > staleAfterMs,
      title: vehicle.title || 'Peter Pan',
      dest: vehicle.dest || '',
      status: !hasSpeed ? 'In service' : speed < 1 ? 'Stopped' : `${Math.round(speed)} mph`,
      meta: 'Peter Pan tracker',
      provider: 'Peter Pan Bus Lines',
      sourceUrl: 'https://bustracker.peterpanbus.com/',
      updatedAt: vehicle.updatedAt,
    },
  };
}
