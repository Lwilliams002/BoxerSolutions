-- 045_late_fee_notice: email the customer the first time a late fee lands on an invoice.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS late_fee_notified_at TIMESTAMPTZ;
ALTER TABLE communications DROP CONSTRAINT IF EXISTS communications_template_key_check;
ALTER TABLE communications
  ADD CONSTRAINT communications_template_key_check CHECK (template_key IN (
    'appointment_confirmation','appointment_reminder','technician_on_my_way','appointment_rescheduled',
    'invoice_created','payment_received','payment_failed','payment_refunded',
    'agreement_review_sign','agreement_signed_copy','service_completed','service_request_declined',
    'payment_method_request','late_fee_added'
  ));
