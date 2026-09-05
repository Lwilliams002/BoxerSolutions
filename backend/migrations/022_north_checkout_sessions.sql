-- 022_north_checkout_sessions
-- One row per North Embedded Checkout session we hand to a client. Bank (ACH)
-- sessions move money inside checkout.submit(), so an unconfirmed bank row is
-- evidence that a debit may already be in flight for that invoice; the pay
-- session endpoint refuses to mint a second one. Only the sha256 of the session
-- token is stored — the raw token is never persisted.
CREATE TABLE north_checkout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash TEXT NOT NULL UNIQUE,
  invoice_id UUID REFERENCES invoices(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  mode TEXT NOT NULL CHECK (mode IN ('card','bank','store')),
  transaction_type TEXT NOT NULL,
  amount NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  confirm_outcome TEXT
);
CREATE INDEX idx_north_checkout_sessions_invoice ON north_checkout_sessions(invoice_id, mode, created_at);
