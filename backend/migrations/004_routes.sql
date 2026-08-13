-- 004_routes
CREATE TABLE routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_date DATE NOT NULL,
  technician_id UUID NOT NULL REFERENCES employees(id),
  name TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed','cancelled')),
  start_lat DOUBLE PRECISION,
  start_lng DOUBLE PRECISION,
  optimized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (route_date, technician_id)
);
CREATE INDEX idx_routes_date ON routes(route_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_routes_technician ON routes(technician_id);

CREATE TABLE route_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id),
  stop_order INT NOT NULL,
  estimated_arrival TIME,
  estimated_travel_minutes INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_route_stops_route ON route_stops(route_id, stop_order);
