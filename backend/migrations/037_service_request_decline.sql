-- Declining a service request records why, so the portal and the customer email can show it.
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS decline_reason TEXT;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

ALTER TABLE communications DROP CONSTRAINT IF EXISTS communications_template_key_check;
ALTER TABLE communications
  ADD CONSTRAINT communications_template_key_check CHECK (template_key IN (
    'appointment_confirmation','appointment_reminder','technician_on_my_way','appointment_rescheduled',
    'invoice_created','payment_received','payment_failed','payment_refunded',
    'agreement_review_sign','agreement_signed_copy','service_completed','service_request_declined'
  ));
