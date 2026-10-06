// Maps a route feature or route id to the operator key the legend colors by.
// Pure string handling; the shapes come from the map's route sources.

/** The feed prefix of a route id: 'mbta-stations:749' -> 'mbta', 'amtrak:88' -> 'amtrak'. */
export function feedIdFromRouteId(routeId: string | null | undefined): string {
  const prefix = String(routeId ?? '').split(':')[0] ?? '';
  return prefix.replace(/-stations$/, '');
}

interface RouteFeatureProps {
  kind?: string;
  route?: string;
  routeIds?: string[];
}

/** The legend operator key for a route feature's properties, or '' when unknown. */
export function legendKeyForRouteFeature(props: RouteFeatureProps | null | undefined): string {
  if (!props) return '';
  if (props.kind === 'mbta') return 'mbta';
  if (props.kind === 'regional-static') return feedIdFromRouteId(props.route);
  if (props.kind === 'regional-station') return feedIdFromRouteId(props.routeIds?.[0]);
  return '';
}
