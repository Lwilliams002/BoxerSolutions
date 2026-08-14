-- 011_payment_refunds_autopay_receipts: refunds, AutoPay retry tracking, receipt files
ALTER TABLE files DROP CONSTRAINT files_file_type_check;
ALTER TABLE files
  ADD CONSTRAINT files_file_type_check CHECK (file_type IN
    ('customer_photo','service_photo','technician_photo','invoice_pdf','receipt_pdf','document','signature','attachment'));

ALTER TABLE communications DROP CONSTRAINT communications_template_key_check;
ALTER TABLE communications
  ADD CONSTRAINT communications_template_key_check CHECK (template_key IN (
    'appointment_confirmation',
    'appointment_reminder',
    'technician_on_my_way',
    'appointment_rescheduled',
    'invoice_created',
    'payment_received',
    'payment_failed',
    'payment_refunded'
  ));

ALTER TABLE payments
  ADD COLUMN receipt_file_id UUID REFERENCES files(id),
  ADD COLUMN parent_payment_id UUID REFERENCES payments(id),
  ADD COLUMN provider_refund_id TEXT,
  ADD COLUMN refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN payment_source TEXT NOT NULL DEFAULT 'manual' CHECK (payment_source IN ('manual','autopay','refund')),
  ADD COLUMN autopay_attempt_date DATE;

ALTER TABLE files
  ADD COLUMN payment_id UUID REFERENCES payments(id);

ALTER TABLE invoices
  ADD COLUMN autopay_retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN next_autopay_retry_date DATE,
  ADD COLUMN last_autopay_attempt_date DATE;

CREATE INDEX idx_payments_parent ON payments(parent_payment_id) WHERE parent_payment_id IS NOT NULL;
CREATE INDEX idx_payments_receipt_file ON payments(receipt_file_id) WHERE receipt_file_id IS NOT NULL;
CREATE INDEX idx_files_payment ON files(payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX idx_invoices_autopay_retry ON invoices(next_autopay_retry_date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_payments_autopay_invoice_day
  ON payments(invoice_id, autopay_attempt_date)
  WHERE payment_source = 'autopay' AND invoice_id IS NOT NULL AND autopay_attempt_date IS NOT NULL;
