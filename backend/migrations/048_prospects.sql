-- 048_prospects: door-knocking pins. Any house can be a pin with a status the
-- reps update as they canvass; a pin becomes a customer when one is created at
-- that address. Every status change is logged so the team sees the history.
CREATE TABLE IF NOT EXISTS prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address_line1 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('not_home','talked_to','call_back','not_interested')),
  notes TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  callback_date DATE,
  knock_count INT NOT NULL DEFAULT 1,
  last_knocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_customer_id UUID REFERENCES customers(id),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_prospects_active ON prospects (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_callback ON prospects (callback_date) WHERE deleted_at IS NULL AND converted_customer_id IS NULL;

CREATE TABLE IF NOT EXISTS prospect_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  callback_date DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospect_events_prospect ON prospect_events (prospect_id, created_at DESC);
