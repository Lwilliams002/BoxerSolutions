-- 031_products_used: chemical/product catalog and per-visit application records
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'oz',
  epa_registration_no TEXT,
  default_quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_name ON products (lower(name));

CREATE TABLE IF NOT EXISTS appointment_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'oz',
  application_method TEXT,
  target_pests TEXT,
  applied_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointment_products_appt ON appointment_products(appointment_id);

INSERT INTO products (name, unit, epa_registration_no, default_quantity) VALUES
  ('Suspend SC', 'oz', '432-763', 2),
  ('Max Force Bait', 'oz', '432-1259', 1),
  ('Termidor SC', 'oz', '7969-210', 4),
  ('Talstar P', 'oz', '279-3206', 2),
  ('Advion Ant Gel', 'g', '100-1498', 5),
  ('Alpine WSG', 'g', '499-561', 10),
  ('Demand CS', 'oz', '100-1066', 1),
  ('Bifen I/T', 'oz', '53883-118', 2),
  ('Nyguard IGR', 'oz', '1021-1603', 1),
  ('Delta Dust', 'oz', '432-772', 1)
ON CONFLICT DO NOTHING;

ALTER TABLE communications DROP CONSTRAINT communications_template_key_check;
ALTER TABLE communications
  ADD CONSTRAINT communications_template_key_check CHECK (template_key IN (
    'appointment_confirmation','appointment_reminder','technician_on_my_way','appointment_rescheduled',
    'invoice_created','payment_received','payment_failed','payment_refunded',
    'agreement_review_sign','agreement_signed_copy','service_completed'
  ));
