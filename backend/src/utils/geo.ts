export interface LatLng { latitude: number; longitude: number }

/** Ray-casting point-in-polygon; polygon may be open or closed. */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude, yi = polygon[i].latitude;
    const xj = polygon[j].longitude, yj = polygon[j].latitude;
    const intersects = (yi > point.latitude) !== (yj > point.latitude)
      && point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
