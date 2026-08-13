-- 006_payments
CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  payment_provider TEXT NOT NULL DEFAULT 'mock',
  provider_payment_method_id TEXT NOT NULL, -- tokenized reference; never store PAN/CVV
  method_type TEXT NOT NULL DEFAULT 'card' CHECK (method_type IN ('card','bank_account')),
  brand TEXT,
  last4 TEXT,
  expiration_month INT,
  expiration_year INT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_payment_methods_customer ON payment_methods(customer_id) WHERE deleted_at IS NULL;

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  invoice_id UUID REFERENCES invoices(id),
  payment_method_id UUID REFERENCES payment_methods(id),
  amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded')),
  payment_provider TEXT NOT NULL DEFAULT 'mock',
  provider_transaction_id TEXT,
  failure_reason TEXT,
  collected_by UUID REFERENCES employees(id),
  receipt_number TEXT UNIQUE,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_customer ON payments(customer_id);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_status ON payments(status);

CREATE SEQUENCE receipt_number_seq START 5000;

CREATE TABLE autopay_settings (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  payment_method_id UUID REFERENCES payment_methods(id),
  next_payment_date DATE,
  failure_count INT NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
