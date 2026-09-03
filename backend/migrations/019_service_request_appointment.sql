-- Link scheduled service requests to the appointment created for them.
ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id);

CREATE INDEX IF NOT EXISTS idx_service_requests_appointment ON service_requests(appointment_id);

