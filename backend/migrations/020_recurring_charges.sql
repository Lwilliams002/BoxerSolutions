-- Recurring "Regular" service charge captured from signed agreements.
-- One active recurring charge per customer; re-signing an agreement updates it.
CREATE TABLE IF NOT EXISTS recurring_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  description TEXT NOT NULL DEFAULT 'Regular recurring service',
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  source_agreement_file_id UUID REFERENCES files(id),
  active BOOLEAN NOT NULL DEFAULT true,
  last_charged_invoice_id UUID REFERENCES invoices(id),
  last_charged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_charges_customer_active
  ON recurring_charges(customer_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_recurring_charges_customer ON recurring_charges(customer_id);

