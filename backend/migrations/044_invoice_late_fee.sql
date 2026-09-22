-- 044_invoice_late_fee: daily late fee on unpaid invoices after a grace period.
-- The fee is carried as a real invoice line item (so PDFs, emails, the portal
-- and payments all see it); these columns track how many days have been billed
-- and let the office waive the fee on a single invoice.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS late_fee_days INT NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS late_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS late_fee_waived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS late_fee_item_id UUID REFERENCES invoice_items(id) ON DELETE SET NULL;
