-- 029_service_location_geocoding: track automatic geocoding so every customer gets a map pin
ALTER TABLE service_locations
  ADD COLUMN IF NOT EXISTS geocode_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS geocode_source TEXT;
CREATE INDEX IF NOT EXISTS idx_service_locations_needs_geocode
  ON service_locations (geocode_attempted_at) WHERE deleted_at IS NULL AND latitude IS NULL;
