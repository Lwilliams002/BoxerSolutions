-- 021_ach_authorizations
-- Web-initiated ACH debits require the merchant to retain proof of the
-- customer's authorization. One row per consented bank payment.
CREATE TABLE ach_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  invoice_id UUID REFERENCES invoices(id),
  payment_id UUID REFERENCES payments(id),
  payment_method_id UUID REFERENCES payment_methods(id),
  amount NUMERIC(12,2) NOT NULL,
  terms_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ach_authorizations_customer ON ach_authorizations(customer_id);
CREATE INDEX idx_ach_authorizations_payment ON ach_authorizations(payment_id);
