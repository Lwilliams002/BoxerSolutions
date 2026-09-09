import { pool } from '../config/db';
import { logger } from '../utils/logger';

/**
 * Address → coordinates so every customer gets a map pin automatically.
 * US Census geocoder first (free, no key, US only), OpenStreetMap Nominatim
 * as a fallback (free, 1 request/second, requires a contact header).
 */
export interface GeocodeInput { addressLine1: string; city?: string | null; state?: string | null; postalCode?: string | null }
export interface GeocodeResult { latitude: number; longitude: number; source: 'census' | 'nominatim' }

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const CONTACT = 'ServiceFinanceAnt/1.0 (service@boxersolutionspestcontrol.com)';

export function formatAddress(input: GeocodeInput): string {
  return [input.addressLine1, input.city, [input.state, input.postalCode].filter(Boolean).join(' ')]
    .map((p) => (p ?? '').trim()).filter(Boolean).join(', ');
}

/** Census response → coordinates (pure, for tests). */
export function parseCensusResponse(json: unknown): { latitude: number; longitude: number } | null {
  const matches = (json as { result?: { addressMatches?: Array<{ coordinates?: { x?: number; y?: number } }> } })?.result?.addressMatches;
  const first = Array.isArray(matches) ? matches[0] : null;
  const x = first?.coordinates?.x; const y = first?.coordinates?.y;
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { latitude: y, longitude: x } : null;
}

/** Nominatim response → coordinates (pure, for tests). */
export function parseNominatimResponse(json: unknown): { latitude: number; longitude: number } | null {
  const first = Array.isArray(json) ? (json[0] as { lat?: string; lon?: string } | undefined) : undefined;
  const lat = Number(first?.lat); const lon = Number(first?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && first?.lat != null ? { latitude: lat, longitude: lon } : null;
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': CONTACT }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function geocodeAddress(input: GeocodeInput): Promise<GeocodeResult | null> {
  const address = formatAddress(input);
  if (!address || !input.addressLine1?.trim()) return null;
  try {
    const url = `${CENSUS_URL}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
    const hit = parseCensusResponse(await fetchJson(url));
    if (hit) return { ...hit, source: 'census' };
  } catch (err) {
    logger.debug({ err, address }, 'census geocode failed');
  }
  try {
    const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(address)}`;
    const hit = parseNominatimResponse(await fetchJson(url));
    if (hit) return { ...hit, source: 'nominatim' };
  } catch (err) {
    logger.debug({ err, address }, 'nominatim geocode failed');
  }
  return null;
}

/** Geocode one service location row and store the result (no-op if it already has coordinates). */
export async function geocodeServiceLocation(locationId: string): Promise<GeocodeResult | null> {
  const { rows } = await pool.query(
    'SELECT id, address_line1, city, state, postal_code, latitude, longitude FROM service_locations WHERE id = $1 AND deleted_at IS NULL',
    [locationId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.latitude != null && row.longitude != null) return { latitude: Number(row.latitude), longitude: Number(row.longitude), source: 'census' };
  const result = await geocodeAddress({ addressLine1: row.address_line1, city: row.city, state: row.state, postalCode: row.postal_code });
  await pool.query(
    `UPDATE service_locations SET latitude = COALESCE($2, latitude), longitude = COALESCE($3, longitude),
       geocode_attempted_at = now(), geocode_source = $4, updated_at = now() WHERE id = $1`,
    [locationId, result?.latitude ?? null, result?.longitude ?? null, result?.source ?? null],
  );
  if (!result) logger.info({ locationId }, 'address could not be geocoded');
  return result;
}

/** Fire-and-forget geocode after a create/update; never fails the request. */
export function queueGeocode(locationId: string) {
  void geocodeServiceLocation(locationId).catch((err) => logger.warn({ err, locationId }, 'background geocode failed'));
}

/** Job: geocode locations that still have no coordinates (retry failures daily). */
export async function geocodePendingLocations(limit = 25) {
  const { rows } = await pool.query(
    `SELECT id FROM service_locations
     WHERE deleted_at IS NULL AND (latitude IS NULL OR longitude IS NULL)
       AND (geocode_attempted_at IS NULL OR geocode_attempted_at < now() - interval '1 day')
     ORDER BY geocode_attempted_at NULLS FIRST, created_at LIMIT $1`,
    [limit],
  );
  let geocoded = 0;
  for (const row of rows) {
    const r = await geocodeServiceLocation(row.id);
    if (r) geocoded++;
    // Be polite to the free services.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  return { attempted: rows.length, geocoded };
}
