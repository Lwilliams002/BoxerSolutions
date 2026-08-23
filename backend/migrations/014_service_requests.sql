CREATE TABLE service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed', 'scheduled', 'declined')),
  assigned_technician_id UUID REFERENCES employees(id),
  quoted_price NUMERIC(12,2),
  owner_notes TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_requests_customer ON service_requests(customer_id, requested_at DESC);
CREATE INDEX idx_service_requests_status ON service_requests(status, requested_at DESC);
CREATE INDEX idx_service_requests_technician ON service_requests(assigned_technician_id, requested_at DESC);

CREATE TABLE service_request_files (
  service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (service_request_id, file_id)
);

CREATE INDEX idx_service_request_files_file ON service_request_files(file_id);
