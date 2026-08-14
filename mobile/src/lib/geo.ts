export interface Coordinate {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METERS = 6371000;
const METERS_PER_MILE = 1609.344;
const AVG_URBAN_SPEED_KMH = 35;

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function estimateDriveMinutes(distanceMeters: number, averageKmh = AVG_URBAN_SPEED_KMH): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 0;
  const km = distanceMeters / 1000;
  return Math.max(1, Math.round((km / averageKmh) * 60));
}

export function formatDistanceEta(distanceMeters: number): string {
  const miles = distanceMeters / METERS_PER_MILE;
  const distance = miles < 0.1 ? '<0.1 mi' : `${miles.toFixed(1)} mi`;
  return `${distance} · ~${estimateDriveMinutes(distanceMeters)} min`;
}
