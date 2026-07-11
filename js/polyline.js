// Decoder for Google's encoded polyline format, which the MBTA /shapes
// endpoint uses. Returns [lng, lat] pairs (GeoJSON axis order).

export function decodePolyline(encoded) {
  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const readDelta = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += readDelta();
    lng += readDelta();
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}
