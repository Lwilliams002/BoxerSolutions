-- Invoices flagged charge_on_due are charged to the default payment method when due,
-- even if the customer has not turned on AutoPay (used for the agreed initial service charge).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS charge_on_due BOOLEAN NOT NULL DEFAULT false;
